/**
 * relevance-guard.js
 *
 * PJ2 AOR（企業同一性バグ修正）: 検索由来のsourceが、対象企業とは無関係な別企業を
 * 主体的に説明している場合に、evidence_strengthとscoreを引き下げる軽量ガード。
 *
 * 【背景】guessCompanyName()（company-context.js）が曖昧な会社名候補を抽出した場合
 * （改善後も、サイトのtitle構成によっては完全には防げない）、検索結果に同名・類似名の
 * 無関係な別企業の情報が混入することがある。実際に弘和印刷株式会社のケースで、
 * 検索語が"KOWA"となった結果、無関係な興和株式会社のWikipedia記事等がcompany_contextへ
 * 混入し、DeepSeekがそれを対象企業自身の事業機会として扱ってしまう事故が発生した。
 * guessCompanyName()側の改善だけに頼らず、後段でも独立した防御を行う。
 *
 * 【設計方針】
 * - 対象企業名が本文に含まれないだけの「一般的な市場・政府情報」は排除しない
 *   （quality-rules.md必須条件2・3「政府/統計」「業界情報」を最低1件、を満たせなくなる
 *   リスクを避けるため。false negativeを避ける）。
 * - 本文中に対象企業とは明確に異なる「別の法人名（XXX株式会社等）」が主体として
 *   言及されており、かつ対象企業自身を指す情報がどこにも見当たらない場合のみ、
 *   低信頼として扱う（false positiveの主要因を狙い撃ちする）。
 * - source_type: "company"（入力URLから直接取得した自社ページ）はガード対象外
 *   （既にground truthとして信頼できるため）。
 * - 完全なNLPエンティティ解決ではなく、正規表現＋文字列重なりによる実用的な
 *   ヒューリスティックである（詳細は各関数のコメント参照）。
 * - evidence_strengthを"reference"へ格下げするだけでは、AIがそれでも企業固有の
 *   事実として利用できてしまうため（quality-rules.mdの既存ルールはsource_type: news
 *   単独の扱いのみを定めており、evidence_strengthは見ていない）、scoreも
 *   大きく引き下げてAIへ渡す上位20件から実質的に脱落しやすくする（score-sources.js
 *   自体は変更せず、後段でこのガードが上書きする設計に留めることで、既存の
 *   スコアリングロジック・その既存テストへの影響を避けている）。
 *
 * 【PJ2 AOR追加: 完全同名企業の識別】会社名だけでは、「株式会社タカハシ」（対象企業、
 * 東京都荒川区）と「株式会社タカハシ」（大阪の非鉄金属材料販売業者、無関係）のような
 * 完全同名の別企業を区別できない。これに対応するため、会社名が完全一致した場合に限り、
 * 追加で住所（都道府県）→業種キーワードの順で「同名だが別企業である可能性」を確認する
 * 層を設けた（buildTargetProfile/looksLikeDifferentCompanyDespiteSameName）。
 * 住所・業種のどちらの情報も得られない場合は判定を保留し、別企業と断定しない
 * （「情報がないから別企業」という危険なnegative判定を避けるため）。evidence_strength
 * には新しい値を追加せず、既存のprimary/secondary/referenceのみで実現している
 * （名前一致のみで信頼していたケースを、住所・業種の矛盾が見つかった場合だけ
 * "reference"側へ倒す、という形で組み込んでいる）。
 *
 * 【PJ2 AOR: 対象企業プロフィールはground truthのみを使う（投票方式は不採用）】
 * 当初、対象企業自身のページ本文（約300字要約）に住所が含まれないケース
 * （実際に発生: 東京都荒川区の対象企業ページに"荒川区"の記載がない）に対応するため、
 * 同一バッチ内の他source（名前が対象企業と一致するもの）から住所・業種を多数決で
 * 集約する「プロフィール補強」を試みたが、これは以下の理由で不採用とした。
 *
 * 1. 判定対象source自身をleave-one-outで除外すると、対象企業自身の正しい住所を
 *    含む唯一のsourceを評価する際に、その除外によって残った他source（無関係な
 *    別企業の情報のみ）だけでプロフィールが構築され、結果的に対象企業自身の
 *    sourceが「プロフィールと矛盾する」と誤判定される（実際にテストで発見した回帰）。
 * 2. leave-one-outをやめて自分自身を投票に含めても、無関係な同名別企業の
 *    sourceが複数存在する場合（例: 新潟の別会社が2件ヒットする等）、多数決が
 *    それらに引きずられ、対象企業自身の正しい住所が少数派として上書きされてしまう
 *    （Sybil的な脆弱性。是正できない）。
 *
 * 結論として、他の検索結果（真偽不明な情報源）からの投票によって「対象企業の
 * 住所」を決定する設計は原理的に安全ではない。対象企業自身を直接取得した
 * ページ（company-context.jsのcompanyResult.content、ground truth）のみを
 * 住所・業種の情報源とし、そこに情報がない場合は住所比較を行わず業種比較へ
 * フォールバックする（buildTargetProfileの戻り値をそのまま使う。実データ検証でも、
 * 業種グループ単体の比較のみで新潟・長岡ケースを正しく検出できることを確認済み）。
 */

const LEGAL_ENTITY_SUFFIX = "(?:株式会社|有限会社|合同会社|\\(株\\)|\\(有\\)|（株）|（有）)";
// 検索結果は日本語・英語いずれの表記で無関係企業を説明している場合もある
// （実際の事故ケースでは、興和株式会社の欧州子会社ページが英語で"Kowa Group"と
// 表記していた）。日本語の法人格パターンに加え、英語の法人格サフィックス
// （Group/Corporation/Corp./Inc./Co., Ltd./Ltd.）も法人名候補として検出する。
const EN_LEGAL_SUFFIX = "(?:Group|Corporation|Corp\\.|Inc\\.|Co\\.,?\\s*Ltd\\.|Ltd\\.)";
// 本文中の法人名候補を検出する。日本の法人名は「名前+法人格」（後株、例: 弘和印刷株式会社）と
// 「法人格+名前」（前株、例: 株式会社タカハシ工業）の両方が一般的に使われる。
// 【PJ2 AOR追加】旧実装は後株パターンしか検出しておらず、前株パターンの企業名
// （実際に"株式会社タカハシ工業"等で発生）が一切「言及」として抽出されず、ガードが
// 発動する前に見逃していた。前株は「法人格+名前が直接連結」「法人格+空白+名前」の
// 2形態を区別して扱う（直接連結のみだと"株式会社の概要"のような一般的な言い回しまで
// 誤検出しやすくなるため、名前部分の文字数は2〜20文字に制限して緩和している）。
const ENTITY_MENTION_PATTERN = new RegExp(
  `([一-龠ぁ-んァ-ヶーA-Za-z0-9]{2,20}${LEGAL_ENTITY_SUFFIX})` + // 後株（例: 弘和印刷株式会社）
    `|(${LEGAL_ENTITY_SUFFIX}[一-龠ァ-ヶー]{2,20})` + // 前株・直接連結（例: 株式会社タカハシ工業）
    `|(${LEGAL_ENTITY_SUFFIX}\\s+[一-龠ぁ-んァ-ヶーA-Za-z0-9]{2,20})` + // 前株・空白あり（例: 株式会社 タカハシ）
    `|([A-Z][A-Za-z]{1,20}(?:\\s+[A-Z][A-Za-z]{1,20}){0,2}\\s+${EN_LEGAL_SUFFIX})`, // 英語表記（例: Kowa Group）
  "g"
);

// 関連性ガードで「無関係な別企業の可能性が高い」と判定したsourceに適用する上限スコア。
// score-sources.jsの最低カテゴリ（SNS: 20）よりは高いが、正当な情報源より
// 明確に低くなるよう、既存のカテゴリスコア帯を踏まえて設定した。
const FLAGGED_SCORE_CAP = 30;

/**
 * 文字列から法人格（株式会社等）を除去した「名称の核」を取り出す。
 * @param {string} text
 * @returns {string}
 */
function coreName(text) {
  return (text || "")
    .replace(new RegExp(LEGAL_ENTITY_SUFFIX, "g"), "")
    .replace(new RegExp(EN_LEGAL_SUFFIX, "gi"), "")
    .replace(/\s/g, "")
    // 末尾の敬称は法人名の核ではないため除去する。前株パターンの名前部分の文字クラスは
    // 漢字を広く許容しており（例:"株式会社ヨシズミプレス様"のインタビュー記事タイトル）、
    // "様"のような敬称も一致対象に取り込んでしまうと、正当な自社情報が誤って
    // 「別企業」と判定される回帰が生じるため（実際にテスト中に発見・修正した）。
    .replace(/(様|殿|御中|さん)$/, "")
    .toLowerCase();
}

/**
 * 任意の文字列（対象企業の識別トークン、または検索結果本文）から、法人名として
 * 認識できる部分だけを抜き出す。ENTITY_MENTION_PATTERNに一致する部分があればその
 * 最初の一致を、なければ元の文字列全体をそのまま返す。
 *
 * 【背景】guessCompanyName()（company-context.js）が区切り文字を見つけられない
 * タイトルからは、"株式会社タカハシ　打ち抜きプレス加工屋"のように、末尾に説明文が
 * 残ったままの識別トークンが生成されることがある。このトークンをそのまま比較に
 * 使うと、法人名部分だけのクリーンな言及（例:"タカハシ"単独）と一致しなくなって
 * しまう。この関数を対象企業トークン・検索結果側の双方に適用することで、
 * ノイズの有無に関わらず法人名の核だけを公平に比較できるようにする。
 * @param {string} text
 * @returns {string}
 */
function extractCoreIdentity(text) {
  const matches = [...(text || "").matchAll(ENTITY_MENTION_PATTERN)].map((m) => m[0]);
  return matches.length > 0 ? matches[0] : text || "";
}

/**
 * 2つの文字列が「同一企業を指している」とみなせるか判定する。
 *
 * 【PJ2 AOR修正】旧実装は3文字以上の部分文字列が共通していれば「同一企業の可能性あり」
 * としていたが、これは"タカハシ"（対象企業）と"タカハシ工業"（無関係な別企業）のように、
 * 対象企業名が別企業名の一部に含まれているだけのケースを誤って「同一」と判定してしまう
 * 欠陥があった（実際に発生した事故）。「対象企業名の一部が別企業名に含まれている」ことと
 * 「別企業が対象企業と同一である」ことは異なるため、法人格を除去した名称の核が
 * **完全一致**する場合のみ同一企業とみなす設計へ変更した。
 * 例:
 *   "弘和印刷"と"弘和印刷株式会社"→true（法人格の有無だけの違い）
 *   "弘和印刷"と"興和"→false（無関係）
 *   "株式会社タカハシ"と"株式会社タカハシ工業"→false（"タカハシ"を含むだけの別企業）
 *   "株式会社タカハシ　打ち抜きプレス加工屋"と"タカハシ"→true
 *     （extractCoreIdentity()でノイズ入りトークンから法人名の核"株式会社タカハシ"を
 *     抜き出した上で比較するため、末尾の説明文に影響されない）
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isSameCompanyName(a, b) {
  const na = coreName(extractCoreIdentity(a));
  const nb = coreName(extractCoreIdentity(b));
  if (!na || !nb) return false;
  return na === nb;
}

// ---------------------------------------------------------------------------
// PJ2 AOR: 完全同名企業の識別（Company Identity = Name + Address + Industry + ...への第一歩）
// ---------------------------------------------------------------------------

// 47都道府県。住所の識別は市区町村までの完全な網羅を狙わず、まず都道府県レベルの
// 一致・不一致という最も取り違えにくい粒度から判定する（Step3の方針）。
const PREFECTURES = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
// 都道府県に続く市区町村レベルの手がかり（全国の市区町村を網羅する辞書は持たず、
// 「〇〇区/市/町/村」という表記パターンから緩く抽出する軽量ヒューリスティック）。
// 【注意】名前部分は非貪欲（lazy）にする必要がある。「区/市/町/村」自体も漢字として
// 文字クラスに含まれるため、貪欲マッチだと最初の区切りではなく最後の区切りまで
// 読み進めてしまう（例:"墨田区にある町工場"→貪欲だと"墨田区にある町"まで誤って一致）。
const CITY_WARD_PATTERN = /([一-龠ぁ-んァ-ヶー]{1,8}?(?:区|市|町|村))/;

/**
 * テキストから住所の手がかり（都道府県・市区町村）を抽出する。
 * @param {string} text
 * @returns {{prefecture:string|null, cityWard:string|null}}
 */
function extractAddressHint(text) {
  const t = text || "";
  const prefecture = PREFECTURES.find((p) => t.includes(p)) || null;
  // 市区町村パターンは、都道府県名を含む文字列全体に対してそのまま検索すると、
  // 「東京都墨田区」のように都道府県部分まで巻き込んで一致してしまう
  // （文字クラスが漢字を広く許容しているため）。都道府県が見つかった場合は、
  // その直後以降の文字列だけを対象に市区町村を探す。
  const afterPrefecture = prefecture ? t.slice(t.indexOf(prefecture) + prefecture.length) : t;
  const cityMatch = afterPrefecture.match(CITY_WARD_PATTERN);
  return { prefecture, cityWard: cityMatch ? cityMatch[1] : null };
}

// Step4: 業種・事業内容のキーワードを「業種グループ」単位でまとめた辞書。全業種を
// 網羅する分類辞書ではなく、住所情報が得られない場合の補助的な手がかりとして、
// 明確に異なる業種が言及されているかどうかを粗く検出するための実用的なリストである
// （今回の実データ・テストケースで実際に登場した業種を中心に構成）。
//
// 【PJ2 AOR追加: グループ化（新潟・長岡ケース対応）】単純な「一致したキーワード文字列の
// 集合」同士の重なりだけで比較すると、"プレス加工"と"打ち抜き"のように同じ業種の
// 表記揺れであるにもかかわらず一致しない、という取りこぼしが起きる。逆に"板金"は
// 短すぎる語で単純な部分文字列一致に戻すと誤爆しやすい。そこで、関連語を
// 「グループ」としてまとめ、グループ単位で一致・不一致を判定する（3文字一致のような
// 単純な部分文字列判定には戻していない）。実際の事故ケースだった"精密板金加工"を
// sheet_metalグループとして新規追加し、プレス加工（metal_press）とは明確に別の
// グループとして扱うことで、両者を正しく別業種と判定できるようにした。
const INDUSTRY_GROUPS = {
  metal_press: ["プレス加工", "金属プレス", "打ち抜き", "打ち抜きプレス", "絞り加工"],
  sheet_metal: ["精密板金加工", "精密板金", "板金加工", "板金"],
  rubber_resin: ["ゴムパッキン", "ゴムスポンジ", "ゴム加工", "樹脂加工"],
  printing: ["印刷", "製版"],
  construction: ["建設", "建築"],
  pharma: ["医薬品", "製薬"],
  optics: ["光学機器", "レンズ"],
  nonferrous_metal: ["非鉄金属"],
  welfare_equipment: ["介護用品", "福祉用具"],
  electronics: ["半導体", "電子部品"],
};

// 既存のextractIndustryKeywords()の戻り値（フラットなキーワード文字列の集合）との
// 後方互換性のため、グループ辞書から導出したフラット一覧も保持する。
const INDUSTRY_KEYWORDS = Object.values(INDUSTRY_GROUPS).flat();

/**
 * テキストから業種キーワードの集合を抽出する（後方互換のため、一致した
 * キーワード文字列そのものの集合を返す。グループ単位の比較には
 * extractIndustryGroups()を使うこと）。
 * @param {string} text
 * @returns {Set<string>}
 */
function extractIndustryKeywords(text) {
  const t = text || "";
  return new Set(INDUSTRY_KEYWORDS.filter((kw) => t.includes(kw)));
}

/**
 * テキストから業種"グループ"の集合を抽出する。表記揺れ（例:"打ち抜き"/"プレス加工"は
 * 同じmetal_pressグループ）を吸収した上で、グループ単位の一致・不一致を比較できる。
 * @param {string} text
 * @returns {Set<string>}
 */
function extractIndustryGroups(text) {
  const keywords = extractIndustryKeywords(text);
  const groups = new Set();
  for (const [group, kws] of Object.entries(INDUSTRY_GROUPS)) {
    if (kws.some((kw) => keywords.has(kw))) groups.add(group);
  }
  return groups;
}

/**
 * 対象企業プロフィール（住所・業種グループ）を作る。呼び出し元（company-context.js）が
 * 対象企業自身のページ本文（fetchCompany()の結果）を渡す想定。
 * @param {string} profileText - 対象企業自身を説明するテキスト
 * @returns {{address:{prefecture:string|null,cityWard:string|null}, industryGroups:Set<string>}}
 */
function buildTargetProfile(profileText) {
  return {
    address: extractAddressHint(profileText),
    industryGroups: extractIndustryGroups(profileText),
  };
}

/**
 * 会社名は一致しているが、住所・業種の観点から見て対象企業とは別の（完全同名の）
 * 企業である可能性が高いかどうかを判定する。
 *
 * 判定順序（Step3・Step6の方針）:
 *   1. 住所（都道府県）が両者で判明しており、かつ異なる → 別企業の強い証拠
 *   2. 住所が判明しない場合、業種グループが両者で判明しており、1つも重ならない
 *      → 別企業の証拠（住所より弱いが、判断材料として利用する）
 *   3. どちらの情報も得られない → 判定保留（別企業とは断定しない。安全側）
 * @param {{address:{prefecture:string|null,cityWard:string|null}, industryGroups:Set<string>}} targetProfile
 * @param {string} candidateText - 検索結果側の本文（title+content+organization）
 * @returns {boolean} trueなら「名前は一致するが別企業の可能性が高い」
 */
function looksLikeDifferentCompanyDespiteSameName(targetProfile, candidateText) {
  const candidateAddress = extractAddressHint(candidateText);
  if (targetProfile.address.prefecture && candidateAddress.prefecture) {
    return targetProfile.address.prefecture !== candidateAddress.prefecture;
  }

  const candidateGroups = extractIndustryGroups(candidateText);
  if (targetProfile.industryGroups.size > 0 && candidateGroups.size > 0) {
    const overlaps = [...candidateGroups].some((g) => targetProfile.industryGroups.has(g));
    return !overlaps;
  }

  return false; // 住所・業種いずれの判定材料もない場合は、別企業と断定しない
}

/**
 * URLから登録可能ドメイン（おおよそ eTLD+1）を粗く取り出す。完全なPublic Suffix List
 * は持たず、日本の co.jp / or.jp / ne.jp / go.jp / lg.jp / ac.jp 等の2階層TLDと
 * 一般的な .com/.jp 等を扱う軽量ヒューリスティック。
 * @param {string} url
 * @returns {string|null}
 */
function registrableDomain(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
  host = host.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLevelTld = /^(co|or|ne|go|lg|ac|ed|gr|ad)\.jp$/;
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelTld.test(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** @param {string} a @param {string} b @returns {boolean} */
function sameRegistrableDomain(a, b) {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return !!da && !!db && da === db;
}

// 「この source は別法人の自社公式ページである」ことを示す、コーポレートタグライン型
// タイトル（例:「株式会社ABI｜世の中の笑顔をつくる…」）。導入事例・インタビュー・
// ユーザーレポート等の第三者コンテンツを誤検出しないよう、それらを示す語は除外する。
const SELF_BRANDED_TITLE_MARKERS_EXCLUDE = /(様|導入事例|インタビュー|ユーザ[ーレ]|事例紹介|お客様の声|評判|口コミ|ニュース|プレスリリース)/;
// 名前トークン: ひらがな・空白・区切りを含まない1語（"株式会社ABIが新アニメ発表 |" のような
// 文章タイトルを弾くため、助詞になりうるひらがなを名前部分に許さない）。
const SELF_BRANDED_TITLE_PATTERN =
  /^\s*(?:株式会社|有限会社|合同会社|一般社団法人)?[A-Za-z0-9ァ-ヶー一-龠・･]{1,16}(?:株式会社|有限会社|合同会社)?\s*[｜|]/;

// ローカル自治体の移住・定住・空き家系プログラムページを示すパターン（市区町村名 + 制度キーワード）。
const LOCAL_MUNICIPAL_TITLE_PATTERN = /[一-龠ぁ-んァ-ヶー]{1,6}(?:市|区|町|村)/;
const LOCAL_MUNICIPAL_PROGRAM_KEYWORDS = /移住|定住|空き家|住宅取得助成|地域おこし協力隊|田舎暮らし/;

/**
 * source が「別ドメインの企業が、対象企業と同名を自社ブランドとして名乗っている公式ページ」
 * に見えるか判定する（Phase53 STEP10.12。例: ab-i.jp に対する abi-inc.co.jp）。
 * @param {{title?:string|null, url?:string|null}} item
 * @param {string} targetUrl - 対象企業のURL
 * @returns {boolean}
 */
function looksLikeDifferentCompanySameName(item, targetUrl) {
  if (!item || !item.url || !targetUrl) return false;
  if (sameRegistrableDomain(item.url, targetUrl)) return false;
  const title = item.title || "";
  if (SELF_BRANDED_TITLE_MARKERS_EXCLUDE.test(title)) return false;

  const selfBrandedTitle = SELF_BRANDED_TITLE_PATTERN.test(title);
  let rootish = false;
  try {
    rootish = new URL(item.url).pathname.replace(/\/+$/, "").length <= 1;
  } catch (e) {
    rootish = false;
  }
  return selfBrandedTitle || rootish;
}

/**
 * 検索由来source1件が、対象企業とは無関係な別企業／別地域の情報を主体的に説明して
 * いる可能性が高いかを判定する。
 * @param {{title?:string|null, content?:string|null, organization?:string|null, summary?:string|null, url?:string|null, source_type?:string|null}} item
 * @param {string[]} companyIdentityTokens - 対象企業を指す既知の文字列
 * @param {{address:{prefecture:string|null,cityWard:string|null}, industryGroups:Set<string>}} [targetProfile]
 * @param {{targetUrl?:string}} [options]
 * @returns {boolean} trueなら「無関係な別企業／別地域を指している可能性が高い」
 */
function looksLikeUnrelatedCompany(item, companyIdentityTokens, targetProfile, options = {}) {
  const title = item.title || "";
  const haystack = `${title} ${item.content || item.summary || ""} ${item.organization || ""}`;
  const tokens = (companyIdentityTokens || []).filter(Boolean);
  const cores = tokens.map((t) => coreName(t)).filter((c) => c.length >= 2);
  const haystackLower = haystack.toLowerCase();
  const titleLower = title.toLowerCase();
  const mentionsTargetName = cores.some((c) => haystackLower.includes(c));
  const titleMentionsTargetName = cores.some((c) => c.length >= 3 && titleLower.includes(c));

  // --- (1) 別ドメインで対象企業と同名を自社ブランドとして名乗る別法人の公式ページ ---
  // （Phase53 STEP10.12。ENTITY_MENTION_PATTERN は "株式会社ABI" のような英字前株名を
  //  検出できないため、法人名パターンより前に、ドメイン + 自社ブランド型タイトルで判定する。）
  if (
    options.targetUrl &&
    titleMentionsTargetName &&
    looksLikeDifferentCompanySameName(item, options.targetUrl)
  ) {
    return true;
  }

  // --- (2) ローカル自治体プログラムのミスマッチ（Phase53 STEP10.12・STEP8）---
  // 特定の市区町村の移住・定住・空き家系プログラムページで、対象企業名にも触れていない場合、
  // 「政府情報だから」という理由だけで company evidence 級に扱わない（reference へ降格）。
  if (
    !mentionsTargetName &&
    LOCAL_MUNICIPAL_TITLE_PATTERN.test(title) &&
    LOCAL_MUNICIPAL_PROGRAM_KEYWORDS.test(haystack)
  ) {
    return true;
  }

  // --- (3) 対象企業の所在都道府県（ground truth）と異なる地域の補助金・移住系情報 ---
  if (
    targetProfile &&
    targetProfile.address.prefecture &&
    !mentionsTargetName &&
    /補助金|助成金|移住|定住|空き家|地域おこし|ふるさと/.test(haystack)
  ) {
    const cand = extractAddressHint(haystack);
    if (cand.prefecture && cand.prefecture !== targetProfile.address.prefecture) return true;
  }

  // --- (4) 本文中に主体として言及される法人名が、対象企業と一致しない ---
  const mentions = [...haystack.matchAll(ENTITY_MENTION_PATTERN)].map((m) => m[0]);
  if (mentions.length === 0) return false; // 法人名の明示的な言及がない一般情報は対象外

  const matchesTarget = mentions.some((mention) =>
    tokens.some((token) => isSameCompanyName(mention, token))
  );
  if (!matchesTarget) return true;

  // 会社名は一致しているが、住所・業種の矛盾から完全同名の別企業と判断できるか。
  if (targetProfile) {
    return looksLikeDifferentCompanyDespiteSameName(targetProfile, haystack);
  }
  return false;
}

/**
 * スコア付与済みsource配列に関連性ガードを適用する。無関係な別企業を主体的に
 * 説明していると判断したsourceは、company_contextからは除外せず
 * （false negativeを避けるため）、evidence_strengthを"reference"へ、scoreを
 * FLAGGED_SCORE_CAP以下へ引き下げる。
 * @param {Array<Object>} items - scoreSources()の出力（scoreが確定済み）
 * @param {string[]} companyIdentityTokens
 * @param {string} [targetProfileText] - 対象企業自身を説明するテキスト（省略可。
 *   渡した場合のみ、完全同名の別企業を住所・業種から識別する追加チェックが働く）
 * @param {{targetUrl?:string}} [options] - targetUrl を渡すと、別ドメインで同名を名乗る
 *   別法人の公式ページ（例: ab-i.jp に対する abi-inc.co.jp）を降格する（Phase53 STEP10.12）
 * @returns {Array<Object>} 同じ形の配列（evidence_strength/scoreのみ変わりうる）
 */
function applyRelevanceGuard(items, companyIdentityTokens, targetProfileText, options = {}) {
  const tokens = (companyIdentityTokens || []).filter(Boolean);
  if (tokens.length === 0) return items || []; // 対象企業を特定できない場合はガードを適用しない（安全側）

  // PJ2 AOR: targetProfileは対象企業自身のページ本文（ground truth）から一度だけ
  // 構築し、全sourceの判定に共通して使う。他sourceからの投票による補強は行わない
  // （不採用理由は本ファイル冒頭のコメント参照。leave-one-outによる自己矛盾・
  // 同名別企業の多数決による上書きという2つの回帰を避けるため）。
  const targetProfile = targetProfileText ? buildTargetProfile(targetProfileText) : null;

  return (items || []).map((item) => {
    if (item.source_type === "company") return item; // 自社ページはガード対象外
    if (!looksLikeUnrelatedCompany(item, tokens, targetProfile, options)) return item;
    return {
      ...item,
      evidence_strength: "reference",
      score: Math.min(item.score ?? FLAGGED_SCORE_CAP, FLAGGED_SCORE_CAP),
    };
  });
}

module.exports = {
  applyRelevanceGuard,
  looksLikeUnrelatedCompany,
  looksLikeDifferentCompanySameName,
  registrableDomain,
  sameRegistrableDomain,
  isSameCompanyName,
  extractCoreIdentity,
  extractAddressHint,
  extractIndustryKeywords,
  extractIndustryGroups,
  buildTargetProfile,
  looksLikeDifferentCompanyDespiteSameName,
  FLAGGED_SCORE_CAP,
};
