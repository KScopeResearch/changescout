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

/**
 * profile から「市場クエリの主語」を作る（会社名は入れない）。
 * @param {{industry?:string|null, keywords?:string[]}} profile
 * @returns {string}
 */
function deriveMarketSubject(profile) {
  const industry = (profile.industry || "").trim();
  const keywords = (profile.keywords || []).filter(Boolean);
  const hasRealIndustry = industry && industry !== DEFAULT_INDUSTRY;

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
  const marketSubject = deriveMarketSubject(profile);

  return [
    // 会社固有（同名衝突を所在地で抑える）。category は news（fetch-news.js が拾う）にし、
    // source_type もニュース扱いにしておく。classify-source.js が内容ベースで
    // company/directory/news へ振り分ける。
    {
      category: "news",
      query: joinQuery([companyName, locality, "会社概要"]),
      sourceType: "news",
      sourceRole: "company_fact",
    },
    // 市場: 補助金・支援制度（政策）
    {
      category: "government",
      query: joinQuery([marketSubject, "補助金 支援制度 2026"]),
      sourceType: "government",
      sourceRole: "market_change",
    },
    // 市場: 規模・統計
    {
      category: "statistics",
      query: joinQuery([marketSubject, "市場規模 統計 2026"]),
      sourceType: "statistics",
      sourceRole: "industry_trend",
    },
    // 市場: 業界動向
    {
      category: "industry",
      query: joinQuery([marketSubject, "業界動向 2026"]),
      sourceType: "industry_association",
      sourceRole: "industry_trend",
    },
    // 市場: 技術・トレンド・課題
    {
      category: "industry",
      query: joinQuery([marketSubject, "市場 トレンド 課題"]),
      sourceType: "technology",
      sourceRole: "industry_trend",
    },
    // 市場: 最新動向（報道）
    {
      category: "news",
      query: joinQuery([marketSubject, "最新動向 2026"]),
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
};
