/**
 * company-context.js
 *
 * Task9: 情報収集パイプラインを以下の順で実行し、company_context.json を組み立てる。
 *
 *   fetch → merge → normalize → deduplicate → score → company_context生成
 *
 * AIへ渡す情報は、スコア上位20件までに絞り込む（score-sources.jsでスコアリング済み）。
 *
 * Task12更新: fetch-government/industry/news/statistics.js が search-client.js
 * （scripts/generator/search/）経由の検索に対応した。検索クエリの組み立てには
 * 会社名が必要なため、company側の取得結果から簡易的に会社名を推測する
 * guessCompanyName() をここに追加している。
 */

const { fetchCompany } = require("./fetch-company");
const { fetchGovernment } = require("./fetch-government");
const { fetchIndustry } = require("./fetch-industry");
const { fetchNews } = require("./fetch-news");
const { fetchStatistics } = require("./fetch-statistics");
const { mergeSources } = require("./merge-sources");
const { normalizeSources } = require("./normalize-sources");
const { deduplicateSources } = require("./deduplicate-sources");
const { scoreSources } = require("./score-sources");

const MAX_SOURCES_FOR_AI = 20;

/**
 * 会社ページの取得結果テキストから、簡易的に業種の手がかりを推測する。
 * 本格的な業種推定はAI分析（Task11で実LLM化）の役割であり、ここでは
 * 後続fetcherへ渡すための「ヒント文字列」を作るだけの軽量処理に留める。
 * @param {Object} companyResult - fetchCompany() の戻り値
 * @returns {string}
 */
function guessIndustryHint(companyResult) {
  if (!companyResult || !companyResult.ok || !companyResult.content) return "中小企業";
  const text = `${companyResult.label || ""} ${companyResult.content || ""}`;
  const dictionary = [
    ["製造", "製造業"],
    ["工業", "製造業"],
    ["建設", "建設業"],
    ["工事", "建設業"],
    ["会計", "バックオフィス支援サービス業"],
    ["記帳", "バックオフィス支援サービス業"],
    ["労務", "バックオフィス支援サービス業"],
  ];
  for (const [keyword, label] of dictionary) {
    if (text.includes(keyword)) return label;
  }
  return "中小企業";
}

/**
 * 会社ページの取得結果から、検索クエリ組み立て用の会社名を簡易的に推測する（Task12で追加）。
 * <title>タグはしばしば「XXX株式会社 | 会社概要」のようにサイト名+ページ名を含むため、
 * 区切り文字より前の部分を会社名の手がかりとして使う。本格的な会社名抽出はAI分析の役割であり、
 * ここではsearch-client.jsへ渡すクエリ文字列を作るための軽量処理に留める。
 * @param {Object} companyResult - fetchCompany() の戻り値
 * @param {string} companyUrl
 * @returns {string}
 */
function guessCompanyName(companyResult, companyUrl) {
  if (companyResult && companyResult.ok && companyResult.label) {
    const head = companyResult.label.split(/[|\-―｜]/)[0].trim();
    if (head) return head;
  }
  try {
    return new URL(companyUrl).hostname;
  } catch (e) {
    return companyUrl;
  }
}

/**
 * 会社URLを起点に company_context を構築する。
 * 内部で fetch → merge → normalize → deduplicate → score の順に処理する。
 * @param {string} companyUrl - 対象企業のURL
 * @returns {Promise<Object>} company_context データ（sources配列はスコア降順・上位20件）
 */
async function buildCompanyContext(companyUrl) {
  // --- fetch ---
  const companyResult = await fetchCompany(companyUrl);
  const industryHint = guessIndustryHint(companyResult);
  const companyName = guessCompanyName(companyResult, companyUrl);

  const [governmentResults, industryResults, newsResults, statisticsResults] = await Promise.all([
    fetchGovernment({ industryHint, companyName }),
    fetchIndustry({ industryHint, companyName }),
    fetchNews({ industryHint, companyName }),
    fetchStatistics({ industryHint, companyName }),
  ]);

  // --- merge ---
  const merged = mergeSources({
    company: companyResult,
    government: governmentResults,
    industry: industryResults,
    news: newsResults,
    statistics: statisticsResults,
  });

  // --- normalize ---
  const normalized = normalizeSources(merged);

  // --- deduplicate ---
  const { deduplicated, removedCount } = deduplicateSources(normalized);

  // --- score ---
  const scored = scoreSources(deduplicated);

  // --- 上位20件に絞り込み、最終idを確定させる ---
  const topSources = scored.slice(0, MAX_SOURCES_FOR_AI).map((item, index) => ({
    ...item,
    id: `src-${index + 1}`,
  }));

  return {
    input_url: companyUrl,
    generated_at: new Date().toISOString(),
    industry_hint: industryHint,
    company_fetch_ok: companyResult.ok,
    company_fetch_error: companyResult.error,
    pipeline_stats: {
      fetched_total: merged.length,
      normalized_total: normalized.length,
      duplicates_removed: removedCount,
      after_dedupe: deduplicated.length,
      selected_for_ai: topSources.length,
      max_sources_for_ai: MAX_SOURCES_FOR_AI,
    },
    sources: topSources,
  };
}

module.exports = { buildCompanyContext, guessIndustryHint, guessCompanyName };
