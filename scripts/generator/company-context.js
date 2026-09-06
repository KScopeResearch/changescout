/**
 * company-context.js
 *
 * Task9: 情報収集パイプラインを以下の順で実行し、company_context.json を組み立てる。
 *
 *   fetch → merge → normalize → deduplicate → score → 関連性ガード → company_context生成
 *
 * AIへ渡す情報は、スコア上位20件までに絞り込む（score-sources.jsでスコアリング済み）。
 *
 * Task12更新: fetch-government/industry/news/statistics.js が search-client.js
 * （scripts/generator/search/）経由の検索に対応した。検索クエリの組み立てには
 * 会社名が必要なため、company側の取得結果から簡易的に会社名を推測する
 * guessCompanyName() をここに追加している。
 *
 * PJ2 AOR更新（企業同一性バグ修正）: guessCompanyName()の優先順位を見直し、加えて
 * search/relevance-guard.jsによる関連性ガードをscoreの直後に追加した。対象企業とは
 * 無関係な別企業の情報がcompany_contextへ混入し、AIがそれを対象企業自身の事実として
 * 扱ってしまう事故（弘和印刷株式会社→興和株式会社の誤混入）への対応。詳細は
 * guessCompanyName()・search/relevance-guard.jsのコメント参照。
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
const { applyRelevanceGuard } = require("./search/relevance-guard");

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

// PJ2 AOR（企業同一性バグ修正）: 日本の会社名によく使われる法人格。
// セグメント選定の優先判定・関連性ガードの双方で使うためモジュールレベルで定義する。
const LEGAL_ENTITY_KEYWORDS = ["株式会社", "有限会社", "合同会社", "(株)", "(有)", "（株）", "（有）"];
const BRACKET_PATTERN = /[「『]([^」』]+)[」』]/g;
const MIN_CONFIDENT_NAME_LENGTH = 5;

/** @param {string} text @returns {boolean} */
function containsLegalEntityKeyword(text) {
  return LEGAL_ENTITY_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * 候補文字列が検索語として使うには曖昧すぎるか判定する（短すぎる、または英数字のみ）。
 * 日本語の会社名は法人格を除いても通常もっと長く、"KOWA"のような短い英字断片は
 * 同名の無関係な別企業と衝突するリスクが高いため採用しない。
 * @param {string} candidate
 * @returns {boolean}
 */
function isTooAmbiguousAsCompanyName(candidate) {
  if (!candidate) return true;
  if (candidate.length < MIN_CONFIDENT_NAME_LENGTH) return true;
  if (/^[A-Za-z0-9\s]+$/.test(candidate)) return true;
  return false;
}

/**
 * 会社ページの取得結果から、検索クエリ組み立て用の会社名を推測する（Task12で追加、
 * PJ2 AORで企業同一性バグ修正のため優先順位ロジックを見直した）。
 *
 * 【背景】旧実装は<title>タグを区切り文字で分割し、常に先頭セグメントを採用していた。
 * 弘和印刷株式会社（title: "KOWA-１色・2色印刷専門の「弘和印刷株式会社」"）では
 * 先頭セグメント"KOWA"が採用され、この曖昧な英字略称が検索語となった結果、
 * 無関係な別の実在企業（興和株式会社）の情報がTavily検索でヒットし、company_contextへ
 * 混入する事故が発生した（詳細は調査ログ参照）。titleのどちらの側に実際の社名が
 * 来るかはサイトごとに異なるため、「先頭を機械的に採用する」という位置だけに依存した
 * 単純な仮定には根拠がなかった。
 *
 * 新しい優先順位:
 *   1. タイトル中の「」『』内に法人格キーワードを含む場合、その中身を最優先で採用する
 *      （最も具体的でクリーンな候補。例:「弘和印刷株式会社」）
 *   2. 区切り文字で分割したセグメントのうち、法人格キーワードを含むものがあれば採用する
 *      （例: "ABC｜株式会社サンプル" → "株式会社サンプル"）
 *   3. 該当がなければ、分割セグメントのうち最も長いものを採用する
 *      （「常に最長を選べば正しい」という単純化ではなく、1・2に該当する明確な手がかりが
 *      ない場合の最終手段としてのみ使う）
 *   4. 3で得られた候補が短すぎる・英数字のみ等で曖昧な場合は採用せず、ホスト名へ
 *      フォールバックする（ホスト名は検索語としては弱いが、別の実在企業と誤って
 *      一致するリスクは低い）
 *
 * @param {Object} companyResult - fetchCompany() の戻り値
 * @param {string} companyUrl
 * @returns {string}
 */
function guessCompanyName(companyResult, companyUrl) {
  if (companyResult && companyResult.ok && companyResult.label) {
    const label = companyResult.label;

    // 1. 「」『』内に法人格キーワードを含む場合は最優先
    const bracketMatches = [...label.matchAll(BRACKET_PATTERN)];
    const bracketed = bracketMatches.map((m) => m[1].trim()).find(containsLegalEntityKeyword);
    if (bracketed) return bracketed;

    const segments = label
      .split(/[|\-―｜]/)
      .map((s) => s.trim())
      .filter(Boolean);

    // 2. セグメントの中に法人格キーワードを含むものがあれば採用
    const withLegalEntity = segments.find(containsLegalEntityKeyword);
    if (withLegalEntity) return withLegalEntity;

    // 3. 該当なしの場合、最も長いセグメントを採用
    const longest = segments.reduce((best, cur) => (cur.length > best.length ? cur : best), "");

    // 4. 曖昧すぎる候補は採用しない
    if (longest && !isTooAmbiguousAsCompanyName(longest)) return longest;
  }

  // 5. 会社名らしい候補が得られない場合はホスト名へフォールバックする
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

  // --- 関連性ガード（PJ2 AOR企業同一性バグ修正）---
  // 対象企業とは無関係な別企業を主体的に説明しているsourceのscoreを引き下げてから再ソートする。
  // 【重要】ここで渡す識別トークンは、guessCompanyName()で整理済みのcompanyNameのみを使う。
  // companyResult.label/organizationは<title>タグの生文字列であり、guessCompanyName()の
  // 修正前に問題を引き起こした"KOWA-..."のような曖昧な断片をそのまま含んでいるため、
  // これを識別トークンに使うと関連性ガード自身が同じ曖昧な文字列に引きずられて
  // 無関係企業を誤って「一致」と判定してしまう（ガードが自分自身の防御対象と同じ
  // ノイズで骨抜きになる）。companyNameは既に法人格優先ロジックでクリーンな候補に
  // 絞り込まれているため、これを唯一のground truthとして使う。
  const companyIdentityTokens = [companyName];
  // PJ2 AOR追加: 完全同名の別企業（例: 東京の「株式会社タカハシ」と大阪の「株式会社タカハシ」）を
  // 会社名だけでは区別できないため、対象企業自身のページ本文（fetchCompany()の結果）を
  // 住所・業種抽出の元データとして渡す。渡さない場合は従来どおり会社名のみでの判定に留まる
  // （applyRelevanceGuard側で後方互換に設計済み）。
  const targetProfileText = `${companyResult.label || ""} ${companyResult.content || ""}`;
  const guarded = applyRelevanceGuard(scored, companyIdentityTokens, targetProfileText).sort(
    (a, b) => b.score - a.score
  );

  // --- 上位20件に絞り込み、最終idを確定させる ---
  const topSources = guarded.slice(0, MAX_SOURCES_FOR_AI).map((item, index) => ({
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

module.exports = {
  buildCompanyContext,
  guessIndustryHint,
  guessCompanyName,
  containsLegalEntityKeyword,
  isTooAmbiguousAsCompanyName,
};
