/**
 * merge-sources.js
 *
 * fetch-company / fetch-government / fetch-industry / fetch-news / fetch-statistics の
 * 生の取得結果を、1つのフラットな配列へ統合する（正規化は行わない。次段のnormalize-sources.jsが担う）。
 */

/**
 * 5系統の生fetch結果を1つの配列にまとめる。
 * @param {Object} raw
 * @param {Object} raw.company - fetchCompany() の戻り値（単一オブジェクト）
 * @param {Array<Object>} raw.government - fetchGovernment() の戻り値
 * @param {Array<Object>} raw.industry - fetchIndustry() の戻り値
 * @param {Array<Object>} raw.news - fetchNews() の戻り値
 * @param {Array<Object>} raw.statistics - fetchStatistics() の戻り値
 * @returns {Array<Object>} 未正規化の生アイテムを統合した配列
 */
function mergeSources(raw) {
  const company = raw.company ? [raw.company] : [];
  const government = raw.government || [];
  const industry = raw.industry || [];
  const news = raw.news || [];
  const statistics = raw.statistics || [];

  return [...company, ...government, ...industry, ...news, ...statistics];
}

module.exports = { mergeSources };
