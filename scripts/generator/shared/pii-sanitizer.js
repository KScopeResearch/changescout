/**
 * pii-sanitizer.js — Phase56 STEP9-D（P4: Privacy / Context Guard）
 *
 * 【背景】STEP9-B / STEP9-C で、illegame.com のレポート `why_company` に
 * 「gBizINFOによれば本店所在地は東京都千代田区外神田で、法人として登録されている（src-11）」
 * という記述が混入した。原因は、gBizINFO（法人番号公表サイト）の法人ページが
 * `会社概要` クエリで取得され、その本文（本店所在地の番地・法人番号などの登記
 * ボイラープレート）が company_context → LLM プロンプトへそのまま渡っていたこと。
 * 登記上の番地・法人番号・代表者個人名は AOR レポートの価値に寄与せず、privacy 上も
 * 不要な情報である。
 *
 * 【設計方針】
 * - **LLM へ渡す前**に company_context.sources[] のテキスト（title / summary / quote /
 *   content / organization）から、登記・住所・連絡先ボイラープレートを除去する。
 *   「生成後に検出するだけ」では不十分（STEP9-D 指示書 §18）。
 * - 除去対象は「レポート価値に不要な個人・登記・住所ボイラープレート」に限定する。
 *   会社名・業種・事業内容・公開施策情報などレポート生成に必要な情報は消さない（§20）。
 * - 都道府県・市区町村レベルの地名は残す（「千代田区の飲食店」等は事業上の意味を持ちうる）。
 *   番地・丁目・号までの street-level 住所のみを除去する。
 * - 完全な NLP ではなく正規表現ベースの実用的ヒューリスティック。過剰除去を避けるため
 *   「明確なパターン」に絞る。
 */

// 47都道府県（住所パターンの先頭）。
const PREF =
  "(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|" +
  "神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|" +
  "大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|" +
  "福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)";

// 数字（半角・全角・漢数字）。
const N = "[0-9０-９一二三四五六七八九十〇]";

// street-level 住所: 市区町村 + 任意の町名 + （丁目/番地/号 を含む番地表現 または ハイフン3連結以上）。
// マッチする: 「東京都千代田区外神田３丁目６番５号」「千代田区外神田3-6-5」
//            「東京都　千代田区　外神田　３－６－５－８０５」（gBiz 事業所テーブル・全角空白区切り）
// マッチしない: 「東京都内」「千代田区の企業」「港区エリア」（番地なし）
//              「AI品質検査市場が2026〜2036年」「日本のアニメ市場は2025〜2030年」（市場の年レンジ）
//              「2026-2036年」（ハイフン2数のみ＝年レンジ、番地表現ではない）
//
// 【Phase56 STEP9-F】STEP9-E の実 API 検証で、旧実装（separator に `〜`/`~` を含み、
// 番地部を「数字 SEP 数字」の緩いパターンで判定）が「◯◯市場が2026〜2036」を街区住所と
// 誤検知していた（`市` は「市場」の一部、`〜` は年レンジ記号）。以下で是正:
//   1. `〜` `~` を街区住所の区切りとして扱わない
//   2. `[市区町村]` の直後に「場/況/街/民/部/議/政」が続く場合は市区町村名ではない（市場・市況・
//      市街・市民・町民・村民・市部・村議・町政 等）→ 否定先読みで除外
//   3. 番地部は「丁目/番地/番/号 を明示的に含む」か「ハイフン3連結以上（N-N-N…）」のみ許可
//      （"2026-2036" のような2数ハイフンは年レンジとみなし住所にしない）
const WS = "[ \\t　]*";
const HYPHEN = "[-－ー−‐]";
// 明示的な番地表現（丁目 / 番地 / 番 / 号 のいずれかを含む）
const BANCHI =
  `${N}{1,4}${WS}(?:丁目|番地の?|番)` +
  `(?:${WS}${N}{1,4}${WS}(?:丁目|番地の?|番|号))*` +
  `(?:${WS}${N}{1,4}${WS}号?)?`;
// ハイフン連結の番地（3 セグメント以上を要求。"2026-2036" のような年レンジを除外する）
const HYPHEN_ADDR = `${N}{1,4}(?:${WS}${HYPHEN}${WS}${N}{1,4}){2,}${WS}号?`;
const STREET_ADDRESS = new RegExp(
  `(?:${PREF})?${WS}` +
    `[一-龥ぁ-んァ-ヶー]{1,8}?[市区町村](?!場|況|街|民|部|議|政)${WS}` +
    `(?:[一-龥ぁ-んァ-ヶー・]{1,10}?${WS})?` +
    `(?:${BANCHI}|${HYPHEN_ADDR})`,
  "g"
);

// 郵便番号。
const POSTAL_CODE = /〒?\s?\d{3}[-－]\d{4}/g;

// 電話・FAX 番号（ラベル付き / 単独の市外局番形式）。
const PHONE_LABELED = /(?:TEL|Tel|ＴＥＬ|電話番号|電話|FAX|Fax|ＦＡＸ|ファックス|ファクス)\s*[:：]?\s*[\d０-９][\d０-９\-－()（）\s]{6,}/g;
const PHONE_BARE = /(?<![\d-])0\d{1,3}[-(]\d{1,4}[-)]\d{3,4}(?![\d-])/g;

// 法人番号（13桁）。ラベル付き・単独いずれも。
const CORP_NUMBER_LABELED = /法人番号\s*[:：]?\s*\d{13}/g;
const CORP_NUMBER_BARE = /(?<!\d)\d{13}(?!\d)/g;

// 「代表者名 / 代表取締役 ○○」— 肩書きは残し、続く個人名（漢字/カナ 2〜10字、
// 間に空白1つ許容）を除去する。助詞（ひらがな）が続く通常文はマッチしない。
const REPRESENTATIVE_NAME =
  /(代表(?:取締役|者|社員|理事|執行役)(?:社長|会長|CEO|COO|CFO)?(?:\s*名)?)\s*[:：]?\s*[一-龥ァ-ヶー]{1,5}(?:[ 　][一-龥ァ-ヶー]{1,5})?/g;

// gBizINFO / 法人番号公表サイト由来の登記ボイラープレート行。行単位で落とす。
// 「ラベルのみ」または「ラベル + 短い値（句点を含まない50字以内）」の行だけを対象にし、
// 本文（句点を含む通常の文章）は落とさない（例:「法人番号制度が始まって以降…。」は残す）。
const REGISTRY_LINE =
  /^\s*(?:本店所在地|所在地|本社所在地|代表者名|代表者|資本金|従業員数|企業規模詳細|設立年月日|創業年|全省庁統一資格|法人番号|届出・認定)\s*[:：]?\s*[^\n。！？]{0,50}$/;
const GBIZ_BOILERPLATE_MARKERS = /(gBizINFO|Gビズインフォ|法人番号公表サイト|政府保有の法人情報)/;

/**
 * テキスト1件から PII / 登記ボイラープレートを除去する。
 * @param {string} text
 * @returns {string}
 */
function sanitizeText(text) {
  if (typeof text !== "string" || !text) return text;

  let out = text;

  // 1. gBizINFO 等の登記ダンプは行単位で除去（複数行 snippet の場合）。
  //    登記ラベル行に加え、法人情報 DB 特有の Markdown テーブル行
  //    （事業所名｜事業所所在地｜被保険者数… の一覧）も丸ごと落とす。
  if (GBIZ_BOILERPLATE_MARKERS.test(out) || /本店所在地|法人番号|事業所所在地/.test(out)) {
    out = out
      .split(/\r?\n/)
      .filter((line) => !REGISTRY_LINE.test(line) && !/^\s*#{0,6}\s*\|.*\|/.test(line))
      .join("\n");
  }

  // 2. inline パターンの伏せ字化。
  out = out
    .replace(STREET_ADDRESS, "（所在地省略）")
    .replace(POSTAL_CODE, "")
    .replace(PHONE_LABELED, "")
    .replace(PHONE_BARE, "")
    .replace(CORP_NUMBER_LABELED, "")
    .replace(REPRESENTATIVE_NAME, "$1")
    .replace(CORP_NUMBER_BARE, "");

  // 3. 除去痕の整形（連続空白・空カッコ・行頭行末の宙に浮いた区切り）。
  //    文末の句点（。！？）や読点は「本文の一部」なので削らない。
  out = out
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/[ \t　]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s|｜:：]+/g, "")
    .replace(/[ \t　|｜]+$/g, "")
    .trim();

  return out;
}

// sanitize 対象にする source のテキストフィールド。
const SANITIZED_FIELDS = ["title", "summary", "quote", "content", "organization"];

/**
 * company_context.sources[] のテキストフィールドを sanitize した新しい配列を返す。
 * score / source_type / source_role / url / id / evidence_strength 等は変更しない。
 * @param {Array<Object>} sources
 * @returns {Array<Object>}
 */
function sanitizeSources(sources) {
  return (sources || []).map((s) => {
    if (!s || typeof s !== "object") return s;
    const next = { ...s };
    for (const f of SANITIZED_FIELDS) {
      if (typeof next[f] === "string") next[f] = sanitizeText(next[f]);
    }
    return next;
  });
}

/**
 * company_context 全体を sanitize した浅いコピーを返す（sources のみ差し替え）。
 * @param {Object} context
 * @returns {Object}
 */
function sanitizeContext(context) {
  if (!context || typeof context !== "object") return context;
  return { ...context, sources: sanitizeSources(context.sources) };
}

/**
 * 生成後のフィールドに street-level 住所が残っていないかを判定する（validator バックストップ用）。
 * 都道府県・市区町村だけの言及は false（残ってよい）。番地・丁目・号まで含む住所のみ true。
 * @param {string} text
 * @returns {boolean}
 */
function containsStreetAddress(text) {
  if (typeof text !== "string" || !text) return false;
  STREET_ADDRESS.lastIndex = 0;
  return STREET_ADDRESS.test(text);
}

module.exports = {
  sanitizeText,
  sanitizeSources,
  sanitizeContext,
  containsStreetAddress,
  STREET_ADDRESS,
};
