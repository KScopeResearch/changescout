/**
 * search-interface.js
 *
 * Task12: 検索providerが共通で満たすべき契約（インタフェース）の定義と、
 * 検索結果を既存パイプライン（normalize-sources.js）が期待する生fetchアイテム形式へ
 * 変換するヘルパーを提供する。search-client.js・各provider（mock/tavily/bing）が
 * この契約に従うことで、fetch-government.js等はproviderの実装を意識せずに使える。
 *
 * provider（search/*-provider.js）が実装すべき形:
 *   {
 *     id, displayName, requiresApiKey,
 *     isConfigured(): boolean,
 *     searchRaw(query, options): Promise<{
 *       results: Array<{ title, url, snippet, published_at, organization }>,
 *       usage: Object
 *     }>
 *   }
 *
 * providerは検索エンジン固有の生の結果を返すだけでよく、AOR独自の分類（source_type/
 * source_role）を知る必要はない。それらはsearch-client.jsが呼び出し元（fetch-*.js）から
 * 渡されたoptionsを使って結果に付与する（責務分離）。
 */

const REQUIRED_RESULT_FIELDS = ["title", "url"];

/**
 * provider.searchRaw()の戻り値が最低限の形状を満たしているかを検証する。
 * @param {Object} raw
 * @throws {Error} 形状が不正な場合
 */
function validateSearchRawShape(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("検索providerの戻り値がオブジェクトではありません");
  }
  if (!Array.isArray(raw.results)) {
    throw new Error("検索providerの戻り値にresults配列がありません");
  }
  raw.results.forEach((item, i) => {
    REQUIRED_RESULT_FIELDS.forEach((field) => {
      if (!item || !item[field]) {
        throw new Error(`検索結果results[${i}]に${field}がありません`);
      }
    });
  });
}

/**
 * 検索結果1件を、normalize-sources.jsが期待する生fetchアイテムの形へ変換する。
 * @param {{title:string, url:string, snippet:string|null, published_at:string|null, organization:string|null}} hit
 * @param {{sourceType:string, sourceRole:string, simulated:boolean}} meta
 * @returns {{source_type:string, source_role:string, label:string, url:string, content:string|null, organization:string|null, published_at:string|null, ok:boolean, simulated:boolean}}
 */
function toRawSourceItem(hit, meta) {
  return {
    source_type: meta.sourceType,
    source_role: meta.sourceRole,
    label: hit.title,
    url: hit.url,
    content: hit.snippet || null,
    organization: hit.organization || null,
    published_at: hit.published_at || null,
    ok: true,
    simulated: !!meta.simulated,
  };
}

module.exports = { validateSearchRawShape, toRawSourceItem, REQUIRED_RESULT_FIELDS };
