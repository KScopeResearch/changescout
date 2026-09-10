/**
 * query-builder.js
 *
 * 会社属性から検索クエリを組み立てる。
 *
 * 【Phase54 STEP8A.2 で全面改訂】
 * 旧実装は全カテゴリのクエリを `"<会社名> <suffix>"` にしていた。会社名だけを主語にすると、
 * 同名の別会社・別業種・無関係な店舗ディレクトリが大量に混入し、外部市場ソースが
 * 得られない（kscope / illegame で顕在化）。
 *
 * 新方針:
 *   - 会社固有クエリ … `<会社名> <所在地> 会社概要`（同名衝突を所在地で抑える）
 *   - 市場クエリ     … 会社名を主語にしない。業種・事業キーワードを主語に、
 *                       「市場規模 / 統計 / 政策 / 補助金 / 業界動向 / 海外市場」等を付ける。
 *
 * profile（company-context.js が会社ページから組み立てて渡す）:
 *   {
 *     companyName: string,          // guessCompanyName() の結果
 *     prefecture?: string|null,     // 会社ページ本文から抽出できた都道府県
 *     cityWard?: string|null,       // 同・市区町村
 *     industry?: string|null,       // guessIndustryHint() の結果
 *     keywords?: string[],          // 会社ページから抽出した事業キーワード（推測で足さない）
 *     domain?: string|null,
 *   }
 *
 * 後方互換: 文字列（会社名）を渡された場合は { companyName } として扱う。
 */

// 事業キーワード抽出時に落とす、業種を表さない一般語・Webナビ語・法人格・地名。
const KEYWORD_STOPWORDS = new Set([
  "会社", "当社", "弊社", "自社", "私たち", "我々", "皆様", "みなさま", "お客様", "顧客",
  "事業", "業務", "サービス", "ソリューション", "ビジネス", "カンパニー", "株式会社", "有限会社",
  "合同会社", "一般社団法人", "一般財団法人",
  "実績", "事例", "詳細", "こちら", "情報", "ページ", "サイト", "ホームページ", "ウェブ",
  "本文", "開始", "終了", "採用", "募集", "求人", "問合", "問い合わせ", "電話", "メール",
  "アクセス", "地図", "ニュース", "一覧", "最新", "プライバシー", "ポリシー", "利用規約",
  "会社概要", "会社案内", "企業情報", "採用情報", "最新情報", "事業内容", "業務内容", "事業紹介",
  "運営", "設立", "代表", "所在地", "沿革", "理念", "方針", "使命", "価値観", "最高", "最善",
  "メニュー", "トップ", "スクロール", "予約", "相談", "無料", "登録", "ログイン", "検索",
  "失敗", "成功", "経験", "本当", "一緒", "気持", "自分", "全力", "差別化", "強み", "視点",
  "提供", "対応", "可能", "実現", "推進", "展開", "支援", "活用", "導入", "構築", "改善",
  "国内", "海外", "世界", "地域", "全国", "現在", "以下", "詳しく", "もっと", "取り組み",
  "最初", "第一歩", "アイデア", "今回", "本日", "一つ", "一人", "一番", "みんな", "コントロール",
  "business", "news", "home", "company", "service", "services", "about", "contact", "info",
  "日本", "東京", "大阪", "名古屋", "福岡", "札幌", "米国", "アメリカ", "欧州", "アジア",
  "韓国", "台湾", "香港", "本社", "支社", "本店", "拠点",
]);

// 断片的で意味をなさないキーワード候補（カタカナ語が別のカタカナ語の途中で切れたもの等）。
const KEYWORD_FRAGMENTS = /^(ー|パ|ート|ナー|ション|ング|ティ|ラン|ジェ)/;

// 業種を表す語が近くにあると事業キーワードとしての確度が上がる。
const BUSINESS_CONTEXT_WORDS = /事業|業|サービス|開発|制作|支援|コンサル|運営|管理|販売|製造|設計|マーケ/;

// guessIndustryHint() の既定値。これしか無い場合はキーワードだけで市場主語を作る。
const DEFAULT_INDUSTRY = "中小企業";

/**
 * 会社名の「核」（法人格・記号を除いた表記）を返す。キーワードから会社名由来の語を
 * 除外するために使う。
 * @param {string} companyName
 * @returns {string[]}
 */
function companyNameCores(companyName) {
  const raw = String(companyName || "").trim();
  if (!raw) return [];
  const stripped = raw
    .replace(/(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|\(株\)|（株）|\(有\)|（有）)/g, "")
    .trim();
  const cores = new Set([raw, stripped]);
  for (const seg of stripped.split(/[・･\s]+/)) {
    if (seg.length >= 2) cores.add(seg);
  }
  return [...cores].filter(Boolean);
}

/**
 * 会社ページのテキストから事業キーワード候補を頻度・出現位置で順位付けして返す。
 * 推測で語を作らず、テキストに実在する語だけを対象にする。会社名由来の語は除外する。
 * @param {string} text - 会社ページの <title> + 本文（既にデコード済みを想定）
 * @param {{title?:string, max?:number, companyName?:string}} [options]
 * @returns {string[]}
 */
function extractBusinessKeywords(text, options = {}) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const title = String(options.title || "");
  const max = options.max || 5;
  const nameCores = companyNameCores(options.companyName);

  const isNameDerived = (t) =>
    nameCores.some((core) => core && (core.includes(t) || t.includes(core)));

  const tokens = src.match(/[一-龠々]{2,8}|[ァ-ヶ][ァ-ヶー]{2,19}|[A-Za-z][A-Za-z&.]{2,15}/g) || [];
  const freq = new Map();
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t || KEYWORD_STOPWORDS.has(t)) continue;
    if (/^[0-9]+$/.test(t)) continue;
    if (KEYWORD_FRAGMENTS.test(t)) continue;
    if (isNameDerived(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  const scored = [...freq.entries()].map(([t, count]) => {
    let score = count;
    if (title.includes(t)) score += 4;
    const idx = src.indexOf(t);
    if (idx >= 0) {
      const window = src.slice(Math.max(0, idx - 6), idx + t.length + 6);
      if (BUSINESS_CONTEXT_WORDS.test(window)) score += 3;
    }
    if (t.length >= 3) score += 1;
    if (t.length >= 5) score += 1;
    return { t, score };
  });

  scored.sort((a, b) => b.score - a.score || b.t.length - a.t.length);
  return scored.slice(0, max).map((s) => s.t);
}

// Phase56 STEP9-D（P2）: 採用テーマ文字列から市場検索に使う意味要素を取り出すための
// 定型接尾語・区切り。会社固有テーマを if 文でハードコードしない（一般化した抽出のみ）。
const THEME_BOILERPLATE =
  /(?:サービス)?の?立ち上げ$|導入支援|構築支援|活用支援|運用支援|内製化支援|移行支援|の支援|支援サービス|支援$|向けの?|の新規事業|モデル(?:構築)?|事業化|サービス化|の商品化|プロジェクト$/g;
// テーマ抽出時に単独では意味を持たない語（業種・課題を表さない一般語）。
// KEYWORD_STOPWORDS は会社ページからの抽出用に「予約」「相談」等の nav 語を含むが、
// テーマ文字列ではそれらが意味を持つ（例: LINE予約）ため、テーマ抽出専用のこの集合だけを使う。
const THEME_STOPWORDS = new Set([
  "向け", "支援", "導入", "活用", "構築", "運用", "事業", "サービス", "モデル", "立ち上げ",
  "新規", "推進", "強化", "展開", "会社", "企業", "システム", "ソリューション", "プロジェクト",
  "実現", "対応", "提供", "改善", "最適", "最適化", "促進", "実装", "整備", "刷新", "見直し",
  "株式会社", "有限会社", "合同会社", "カンパニー", "ビジネス", "プラットフォーム",
  "会社概要", "企業情報", "私たち", "こちら", "詳細", "情報", "ページ", "サイト",
]);

/**
 * 採用テーマ（例:「中小製造業向け『AI品質検査』導入支援サービスの立ち上げ」）から、
 * 市場・業界検索の主語に使える意味要素を最大5件抽出する（Phase56 STEP9-D / P2）。
 * 会社固有のテーマ名を条件分岐で扱わず、定型接尾語の除去 + トークン化のみで一般化する。
 * @param {string|null|undefined} theme
 * @returns {string[]}
 */
function extractThemeTerms(theme) {
  const t = String(theme || "").trim();
  if (!t) return [];
  const cleaned = t
    .replace(/[「」『』（）()【】｢｣]/g, " ")
    .replace(THEME_BOILERPLATE, " ");
  const tokens =
    cleaned.match(/[一-龠々]{2,}|[ァ-ヶ][ァ-ヶー]{1,}|[A-Za-z][A-Za-z0-9]{1,}/g) || [];
  const out = [];
  const seen = new Set();
  for (const raw of tokens) {
    const w = raw.trim();
    if (!w || seen.has(w)) continue;
    if (THEME_STOPWORDS.has(w) || KEYWORD_FRAGMENTS.test(w)) continue;
    if (/^[0-9]+$/.test(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 5) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase57 STEP1: Source Discovery Improvement
// ---------------------------------------------------------------------------
// STEP9-H で、テーマ語（「中小製造業 AI 品質検査」等）を市場クエリに入れても、Tavily が
// 返すのは「完全ガイド／徹底解説」型の SEO 記事が大半（kscope 約70% news）だった。
// 対策:
//   1. テーマ語を「関連語辞書」で拡張し、サブ市場（外観検査・画像検査・予知保全 等）に
//      クエリを寄せる。会社固有テーマの if 文ハードコードはしない（辞書は業界横断の一般語）。
//   2. 市場クエリの観点語に「実態調査・出荷額・プレスリリース・業界団体」等、一次情報・
//      調査・報道へ寄せる語を追加（SEO listicle へのヒット率を下げる）。
//   3. 会社固有クエリに ドメイン + 事業内容 を足し、求人/評判/ランキング系を拾いにくくする。
//   4. テーマ別の preferred domains（政府・業界団体）を SearchQuerySpec に候補として付ける
//      （実 API へは Phase57 STEP2 で渡す。このモジュールは候補を返すだけ）。

// テーマ関連語辞書。left が theme 文字列に含まれれば right の語を検索キーワード候補へ追加する。
// 業界横断の一般的な近接語のみ（特定企業名・製品名は入れない）。
const THEME_KEYWORD_EXPANSIONS = [
  { re: /品質検査|外観検査|画像検査|検品|欠陥検出|目視検査/, terms: ["AI外観検査", "画像検査", "品質検査", "検品自動化", "品質管理", "製造業AI"] },
  { re: /予知保全|設備保全|故障予知/, terms: ["予知保全", "設備保全", "IoT保全", "製造業AI"] },
  { re: /製造業|工場|ものづくり|生産管理/, terms: ["製造業DX", "スマートファクトリー", "生産管理"] },
  { re: /LINE予約|ネット予約|予約管理|予約システム|Web予約/, terms: ["ネット予約システム", "予約管理システム", "モバイルオーダー", "飲食店予約"] },
  { re: /顧客管理|CRM|会員管理|リピート|常連/, terms: ["顧客管理システム", "CRM", "会員システム", "リピート施策"] },
  { re: /キャッシュレス|POS|モバイルオーダー|セルフレジ|自動精算/, terms: ["キャッシュレス決済", "POSレジ", "モバイルオーダー"] },
  { re: /飲食店|外食|レストラン|居酒屋|カフェ|店舗/, terms: ["飲食店", "外食産業", "店舗経営", "飲食店DX"] },
  { re: /IP保有|IPビジネス|知的財産|ライセンス|収益分配|製作委員会|二次利用/, terms: ["IPビジネス", "ライセンスビジネス", "知的財産", "収益分配", "製作委員会"] },
  { re: /アニメ制作|アニメ産業|アニメーション|制作会社/, terms: ["アニメ産業", "アニメ制作", "コンテンツ産業", "アニメーター"] },
  { re: /インバウンド|訪日|多言語/, terms: ["インバウンド需要", "訪日客", "多言語対応"] },
  { re: /人手不足|人材不足|採用難|技能継承|技能承継|高齢化/, terms: ["人手不足", "技能継承"] },
  { re: /DX|デジタル化|デジタルトランスフォーメーション/, terms: ["DX", "デジタル化"] },
  { re: /補助金|助成金|支援制度/, terms: ["補助金", "支援制度"] },
];

// テーマ別の preferred domains（政府・業界団体・調査機関）。SearchQuerySpec に候補として
// 付与する。実 API の include_domains へ渡すのは Phase57 STEP2。
const PREFERRED_DOMAINS = [
  { re: /品質検査|外観検査|画像検査|予知保全|製造業|工場|ものづくり|品質管理/, domains: ["meti.go.jp", "chusho.meti.go.jp", "jetro.go.jp", "ipa.go.jp", "jeita.or.jp", "smrj.go.jp", "nedo.go.jp", "monodukuri.com"] },
  { re: /LINE予約|ネット予約|予約|顧客管理|CRM|POS|キャッシュレス|飲食店|外食|店舗/, domains: ["maff.go.jp", "meti.go.jp", "soumu.go.jp", "jfnet.or.jp", "jf-net.or.jp", "gaishoku.or.jp"] },
  { re: /IP|知的財産|ライセンス|アニメ|コンテンツ|製作委員会|収益分配/, domains: ["bunka.go.jp", "meti.go.jp", "vipo.or.jp", "jetro.go.jp", "aja.gr.jp", "unijapan.org"] },
];

/**
 * テーマ文字列を「検索キーワード候補」へ拡張する（extractThemeTerms の結果 + 関連語辞書）。
 * @param {string|null|undefined} theme
 * @returns {string[]}
 */
function expandThemeKeywords(theme) {
  const t = String(theme || "");
  const base = extractThemeTerms(theme);
  const seen = new Set();
  const out = [];
  const add = (w) => {
    const s = String(w || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  base.forEach(add);
  for (const { re, terms } of THEME_KEYWORD_EXPANSIONS) {
    if (re.test(t)) terms.forEach(add);
  }
  return out;
}

/**
 * テーマ文字列に対応する preferred domains（政府・業界団体等）の候補を返す。
 * @param {string|null|undefined} theme
 * @returns {string[]}
 */
function preferredDomainsForTheme(theme) {
  const t = String(theme || "");
  const set = new Set();
  for (const { re, domains } of PREFERRED_DOMAINS) {
    if (re.test(t)) domains.forEach((d) => set.add(d));
  }
  return [...set];
}

// 会社固有クエリで拾いたくない語（求人・評判・比較まとめ等）。Tavily basic search は
// `-語` の除外構文を確実にはサポートしないため、クエリ文字列には入れず、SearchQuerySpec の
// excludeTerms 候補として返す（Phase57 STEP2 で provider 側フィルタに使う）。
const COMPANY_QUERY_EXCLUDE_TERMS = [
  "求人", "採用", "転職", "就活", "新卒", "中途採用", "アルバイト",
  "評判", "口コミ", "ランキング", "おすすめ", "比較", "年収", "面接",
];

/**
 * profile から「市場クエリの主語」を作る（会社名は入れない）。
 * Phase56 STEP9-D（P2）: profile.opportunityTheme があれば、市場クエリの主語をテーマ側へ寄せる。
 * テーマと業種ヒントが噛み合っている場合は業種ヒントを残し、噛み合っていない場合
 * （会社の現業がテーマの対象市場と別＝kscope/illegame 型）は業種ヒントを落とす。
 * @param {{industry?:string|null, keywords?:string[], opportunityTheme?:string|null}} profile
 * @returns {string}
 */
function deriveMarketSubject(profile) {
  const industry = (profile.industry || "").trim();
  const keywords = (profile.keywords || []).filter(Boolean);
  const hasRealIndustry = industry && industry !== DEFAULT_INDUSTRY;

  // --- Phase56 STEP9-D（P2）: テーマ主導の主語 ---
  const themeTerms = extractThemeTerms(profile.opportunityTheme);
  if (themeTerms.length >= 2) {
    const industryCore = industry.replace(/産業|業界|業$|・.*$/g, "");
    const industryOnTheme =
      hasRealIndustry &&
      themeTerms.some(
        (t) => industry.includes(t) || t.includes(industry) || (industryCore && t.includes(industryCore)) || (industryCore && industryCore.includes(t))
      );
    const parts = [];
    if (industryOnTheme) parts.push(industry);
    for (const t of themeTerms) {
      if (parts.length >= 4) break;
      if (!parts.some((p) => p.includes(t) || t.includes(p))) parts.push(t);
    }
    if (parts.length > 0) return parts.join(" ");
  }

  // 業種が取れている場合はキーワードを最大2件、取れていない場合は最大3件添える。
  const maxKeywords = hasRealIndustry ? 2 : 3;
  const parts = [];
  if (hasRealIndustry) parts.push(industry);
  for (const k of keywords) {
    if (parts.length >= (hasRealIndustry ? 1 + maxKeywords : maxKeywords)) break;
    if (!parts.some((p) => p.includes(k) || k.includes(p))) parts.push(k);
  }
  if (parts.length === 0) return hasRealIndustry ? industry : DEFAULT_INDUSTRY + " 向けサービス";
  return parts.join(" ");
}

/** 空要素を除いて半角スペースで連結する。 */
function joinQuery(parts) {
  return parts.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(" ");
}

/**
 * @typedef {Object} SearchQuerySpec
 * @property {string} category
 * @property {string} query
 * @property {string} sourceType
 * @property {string} sourceRole
 */

/**
 * profile（または会社名文字列）から検索クエリ一式を生成する。
 * 1件は会社固有、残りは市場クエリ（会社名を主語にしない）。
 * @param {Object|string} profileOrName
 * @returns {SearchQuerySpec[]}
 */
function buildQueries(profileOrName) {
  const profile =
    typeof profileOrName === "string" ? { companyName: profileOrName } : profileOrName || {};
  const companyName = (profile.companyName || "").trim() || "対象企業";
  const locality = profile.cityWard || profile.prefecture || "";
  const domain = (profile.domain || "").trim();
  const marketSubject = deriveMarketSubject(profile);

  // Phase57 STEP1: テーマ主導モードの判定は deriveMarketSubject と同じ（テーマ語 2 件以上）。
  const themeMode = extractThemeTerms(profile.opportunityTheme).length >= 2;
  const expanded = themeMode ? expandThemeKeywords(profile.opportunityTheme) : [];
  // 統計・業界クエリはサブ市場（外観検査・予知保全 等）に寄せるため拡張語も使う。
  const statSubject = expanded.length >= 2 ? expanded.slice(0, 4).join(" ") : marketSubject;
  const industrySubject = expanded.length >= 3 ? expanded.slice(0, 5).join(" ") : marketSubject;
  const preferredDomains = themeMode ? preferredDomainsForTheme(profile.opportunityTheme) : [];

  // Phase57 STEP1: SEO listicle を避け、一次情報・調査・報道へ寄せる観点語。
  // 既存テストが要求するキーワード族（補助金/支援制度・市場規模/統計・業界動向・
  // トレンド/課題・最新動向）は必ず残す（追加のみ）。
  const govSuffix = themeMode ? "補助金 支援制度 支援事業 経済産業省 2026" : "補助金 支援制度 2026";
  const statSuffix = themeMode ? "市場規模 統計 出荷額 市場調査レポート 予測 2026" : "市場規模 統計 2026";
  const industrySuffix = themeMode ? "業界動向 業界団体 実態調査 2026" : "業界動向 2026";
  const trendSuffix = themeMode ? "市場 トレンド 課題 技術動向 導入状況" : "市場 トレンド 課題";
  const newsSuffix = themeMode ? "最新動向 プレスリリース 発表 2026" : "最新動向 2026";

  // 会社固有クエリ: ドメイン + 事業内容 で公式サイトへ寄せる（求人・評判系を拾いにくくする）。
  const companyQuery = themeMode
    ? joinQuery([companyName, locality, domain, "会社概要 事業内容"])
    : joinQuery([companyName, locality, "会社概要"]);

  // Phase57 STEP2: preferredDomains（include_domains）は「権威ある一次情報を狙う」
  // government / industry_association クエリにのみ付ける。statistics（市場調査会社）・
  // technology（業界メディア）・news は制限すると market データを取り逃すため付けない。
  const withDomains = (spec) => (preferredDomains.length ? { ...spec, preferredDomains } : spec);

  return [
    // 会社固有（同名衝突を所在地で抑える）。category は news（fetch-news.js が拾う）にし、
    // source_type もニュース扱いにしておく。classify-source.js が内容ベースで
    // company/directory/news へ振り分ける。
    {
      category: "news",
      query: companyQuery,
      sourceType: "news",
      sourceRole: "company_fact",
      ...(themeMode ? { excludeTerms: COMPANY_QUERY_EXCLUDE_TERMS } : {}),
    },
    // 市場: 補助金・支援制度（政策）
    withDomains({
      category: "government",
      query: joinQuery([marketSubject, govSuffix]),
      sourceType: "government",
      sourceRole: "market_change",
    }),
    // 市場: 規模・統計（調査会社ドメインを取り逃さないよう include_domains は付けない）
    {
      category: "statistics",
      query: joinQuery([statSubject, statSuffix]),
      sourceType: "statistics",
      sourceRole: "industry_trend",
    },
    // 市場: 業界動向
    withDomains({
      category: "industry",
      query: joinQuery([industrySubject, industrySuffix]),
      sourceType: "industry_association",
      sourceRole: "industry_trend",
    }),
    // 市場: 技術・トレンド・課題（業界メディアを取り逃さないよう include_domains は付けない）
    {
      category: "industry",
      query: joinQuery([statSubject, trendSuffix]),
      sourceType: "technology",
      sourceRole: "industry_trend",
    },
    // 市場: 最新動向（報道）
    {
      category: "news",
      query: joinQuery([marketSubject, newsSuffix]),
      sourceType: "news",
      sourceRole: "evidence",
    },
  ];
}

/**
 * 指定カテゴリ分のクエリのみを取り出す（fetch-*.js が使う）。
 * @param {string} category - "government"|"industry"|"news"|"statistics"
 * @param {Object|string} profileOrName
 * @returns {SearchQuerySpec[]}
 */
function buildQueriesForCategory(category, profileOrName) {
  return buildQueries(profileOrName).filter((q) => q.category === category);
}

module.exports = {
  buildQueries,
  buildQueriesForCategory,
  extractBusinessKeywords,
  companyNameCores,
  deriveMarketSubject,
  extractThemeTerms,
  expandThemeKeywords,
  preferredDomainsForTheme,
  COMPANY_QUERY_EXCLUDE_TERMS,
};
