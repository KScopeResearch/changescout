/**
 * mock-search-provider.js
 *
 * APIキー不要の擬似検索provider。実際の検索を行わず、クエリ文字列から
 * 決定的（同じクエリなら毎回同じ）な合成結果を返す。SEARCH_PROVIDER未設定時の
 * デフォルトであり、Task9のnormalize/deduplicate/score・Task10の品質評価・
 * Task11のLLM分析を、外部APIキーなしで最後まで検証できるようにするためのもの。
 *
 * 【重複検索結果のテスト】1クエリにつき2件の結果を返す設計にしており、そのうち
 * 2件目は意図的に1件目とほぼ同じタイトル・URLの末尾違いにしている
 * （deduplicate-sources.jsの重複統合が実際に効果を発揮することを確認するため）。
 *
 * 【新しさのテスト】options.sourceTypeに応じてpublished_atの年代を変える
 * （Task9のscore-sources.jsの新しさ加点・古さ減点を確認するため、旧
 * fetch-government.js等の設計を踏襲: government=新しい/industry=古い/news=新しい/statistics=中間）。
 */

const PRICING_NOTE = "ローカルの決定的な合成結果のため課金は発生しない。";

/** @returns {boolean} mockは常に利用可能 */
function isConfigured() {
  return true;
}

/**
 * options.sourceTypeに応じた「それらしい」公開日時を返す。
 * @param {string|undefined} sourceType
 * @returns {string} ISO8601
 */
function pickPublishedAt(sourceType) {
  const d = new Date();
  switch (sourceType) {
    case "government":
      d.setMonth(d.getMonth() - 3); // 新しい情報（+10点の対象）
      break;
    case "industry_association":
    case "technology":
      d.setMonth(d.getMonth() - 30); // 古い情報（-10点の対象）
      break;
    case "news":
      d.setMonth(d.getMonth() - 1); // 新しい情報（+10点の対象）
      break;
    case "statistics":
      d.setMonth(d.getMonth() - 18); // 中間（加点・減点なし）
      break;
    default:
      d.setMonth(d.getMonth() - 6);
  }
  return d.toISOString();
}

/**
 * クエリ文字列から安全なURLスラグを作る（実在ドメインを騙らないよう source.example.com 配下に置く）。
 * @param {string} query
 * @returns {string}
 */
function slugify(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * @param {string} query
 * @param {{sourceType?:string, maxResults?:number}} [options]
 * @returns {Promise<{results:Array<Object>, usage:Object}>}
 */
async function searchRaw(query, options = {}) {
  const sourceType = options.sourceType || "news";
  const slug = slugify(query) || "query";
  const publishedAt = pickPublishedAt(sourceType);

  // タイトルは「クエリ（会社名を含む）+ 十分に長い説明文」の形にする。
  // 会社名だけの短いタイトル（例: 会社ページの<title>がそのまま社名のみの場合）に対して
  // 包含比率が低くなるよう、意図的に長めの説明文を付与している
  // （deduplicate-sources.jsの「同記事」判定が誤って会社名と検索結果を同一視しないようにするため）。
  const results = [
    {
      title: `${query}に関する検索結果（mock providerによる合成データ・1件目）`,
      url: `https://source.example.com/mock-search/${slug}-1`,
      snippet:
        `この結果はmock-search-provider.jsが生成した合成データです。SEARCH_PROVIDER=tavily または ` +
        `bing を設定し対応するAPIキーを与えると、実際の検索結果に置き換わります。`,
      published_at: publishedAt,
      organization: `${sourceType}系情報源（mock）`,
    },
    {
      // 1件目と全く同じタイトル・ほぼ同じURL（末尾スラッシュのみ違う）を意図的に混ぜ、
      // deduplicate-sources.jsの重複統合が実際に効くことを確認できるようにする
      title: `${query}に関する検索結果（mock providerによる合成データ・1件目）`,
      url: `https://source.example.com/mock-search/${slug}-1/`,
      snippet: `検索結果1と同一記事のURL末尾違い（重複統合のテスト用）。`,
      published_at: publishedAt,
      organization: `${sourceType}系情報源（mock）`,
    },
  ];

  return {
    results,
    usage: { queries: 1, results_returned: results.length, note: PRICING_NOTE },
  };
}

module.exports = {
  id: "mock",
  displayName: "Mock（決定的な合成結果・APIキー不要）",
  requiresApiKey: false,
  isConfigured,
  searchRaw,
};
