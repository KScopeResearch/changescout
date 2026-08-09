/**
 * simulate-ai-analysis.js
 *
 * 「AI分析」ステップのTask8時点における実装（Task9でcontext.sources構造に対応）。
 *
 * 【重要】これは実際のLLM呼び出しではない。ルールベースのテンプレートで、
 * prompt-company-analysis.md に定義した契約（入力: company_context、
 * 出力: report.json v2.4のfree_opportunity/paid_analysis）を機械的に満たすだけの
 * シミュレーションである。Task11で実LLM（OpenAI等）に置き換える際は、
 * この関数と同じシグネチャ（company_context を受け取り、同じ形の
 * {source_pages, free_opportunity, locked_opportunities, paid_analysis} を返す）を
 * 維持すること。
 *
 * prompt-company-analysis.md の厳守事項をこのシミュレーションでも形式的に守っている:
 *   1. ニュースだけで判断しない → evidenceは company + government/statistics + industry を必ず含める
 *   2. 企業情報必須 → why_companyに company_facts の内容を必ず引用する
 *   3. 政府または統計必須 → market_changeの根拠に government または statistics を使う
 *   4. 業界情報必須 → evidenceに industry を含める
 *   5. source_id参照 → evidenceは {source_id, quote} のみを保持する
 *   6. 推測禁止 → company_context に存在しない事実は作らない
 */

/**
 * context.sources（Task9のnormalize/dedupe/score済み配列、既にidが確定済み）を、
 * report.jsonのsource_pagesの形（scoreとpublished_atを含む）にそのまま変換する。
 * @param {Array<Object>} sources - company_context.sources
 * @returns {Array<Object>} source_pages
 */
function buildSourcePages(sources) {
  return sources.map((s) => ({
    id: s.id,
    source_type: s.source_type,
    source_role: s.source_role,
    evidence_strength: s.evidence_strength,
    label: s.title,
    url: s.url,
    published_at: s.published_at,
    score: s.score,
  }));
}

/**
 * context.sources から、指定したsource_typeで最もスコアの高いものを1件探す。
 * @param {Array<Object>} sourcePages - buildSourcePages() の戻り値
 * @param {string} sourceType
 * @returns {Object|undefined}
 */
function findBestByType(sourcePages, sourceType) {
  return sourcePages.filter((s) => s.source_type === sourceType).sort((a, b) => b.score - a.score)[0];
}

/**
 * company_context から report.json の中核部分を生成する（シミュレーション）。
 * @param {Object} context - buildCompanyContext() の戻り値（Task9形式、context.sources使用）
 * @returns {Object} { source_pages, free_opportunity, locked_opportunities, paid_analysis }
 */
function simulateAiAnalysis(context) {
  const sourcePages = buildSourcePages(context.sources);

  const companySource = findBestByType(sourcePages, "company");
  const govSource = findBestByType(sourcePages, "government") || findBestByType(sourcePages, "statistics");
  const industrySource =
    findBestByType(sourcePages, "industry_association") || findBestByType(sourcePages, "technology");
  const newsSource = findBestByType(sourcePages, "news");

  const industryHint = context.industry_hint;
  const companyFetchOk = context.company_fetch_ok;

  // sourcesから元のquote（summary相当）を引く
  const rawByUrl = new Map(context.sources.map((s) => [s.url, s]));

  const evidence = [govSource, companySource, industrySource, newsSource]
    .filter(Boolean)
    .map((src) => ({
      source_id: src.id,
      quote: (rawByUrl.get(src.url) || {}).quote || "（内容取得なし）",
    }));

  const title = `${industryHint}における市場変化への対応機会（シミュレーション分析）`;

  const freeOpportunity = {
    title,
    why_now: companyFetchOk
      ? `貴社サイト（${context.input_url}）の公開情報と、${industryHint}分野の政府・統計情報を組み合わせた結果、` +
        "対応を検討する価値があるタイミングにあると考えられます。" +
        "※本文はTask8/Task9時点のシミュレーションであり、Task12（Web検索連携）・Task11（実LLM接続）の実装後に" +
        "実データへ置き換わります。"
      : `貴社URL（${context.input_url}）の取得に失敗したため（${context.company_fetch_error}）、` +
        "企業固有の情報を反映できていません。company_facts が空のままLLM分析へ進むべきではなく、" +
        "本来はここでパイプラインを停止し人間に確認を求めるべき状態です。",
    why_company: companyFetchOk
      ? `貴社サイトから取得したタイトル「${companySource ? companySource.label : "（不明）"}」をもとにした簡易的な言及です。` +
        "実際の分析では、採用状況・事業内容等の具体的な事実と結びつけて記述します（Task11以降）。"
      : "企業固有の情報が取得できていないため、本来この項目は生成すべきではありません（シミュレーション上の暫定文言）。",
    market_change: industrySource
      ? `${industryHint}分野における制度・業界動向の変化（シミュレーションデータに基づく仮の記述）`
      : "業界情報が取得できていません。",
    evidence,
    first_action: "まずは company_context の各情報源を人間が確認し、実データに基づく分析に置き換えてください。",
    extended_analysis: {
      market_size: "Task8/Task9時点はシミュレーションのため、市場規模の記述はプレースホルダーです。",
      competition: "Task8/Task9時点はシミュレーションのため、競合状況の記述はプレースホルダーです。",
      risks: "AI分析が未接続（Task11）の状態でこのレポートを配信することは想定していません。",
      priority: "本Opportunityの優先順位づけはTask11実装後に意味を持ちます。",
      case_examples: "個社名までは特定していません（実在しない事例を創作しないため）。",
      confidence_note:
        `本分析は${evidence.length}件の情報源（` +
        evidence.map((e) => e.source_id).join(", ") +
        `、スコア上位${context.sources.length}件中から選定）を組み合わせて作成していますが、` +
        "Task9時点ではAI分析がシミュレーションであり、実際の内容は含まれていません。" +
        "Task11で実LLMに置き換えた後も、配信前に必ず人間が確認します。",
    },
  };

  const lockedOpportunities = [
    { id: "locked-1", title: `${industryHint}における追加検討テーマ1（シミュレーション）` },
    { id: "locked-2", title: `${industryHint}における追加検討テーマ2（シミュレーション）` },
  ];

  const additionalOpportunities = [
    {
      id: "locked-1",
      title: lockedOpportunities[0].title,
      summary: "Task8/Task9時点のシミュレーションのため詳細分析は未生成です。",
      expected_effect: "（Task11実装後に生成）",
      relevance: "中",
    },
    {
      id: "locked-2",
      title: lockedOpportunities[1].title,
      summary: "Task8/Task9時点のシミュレーションのため詳細分析は未生成です。",
      expected_effect: "（Task11実装後に生成）",
      relevance: "中",
    },
  ];

  const paidAnalysis = {
    decision_summary: {
      recommendation: "本レポートはシミュレーションデータです。実LLM接続（Task11）後に再生成してください。",
      recommended_timing: "—",
      expected_impact: "—",
      investment_level: "—",
      reason: ["Task8/Task9時点ではAI分析が未接続のため、意思決定の根拠として使用しないでください。"],
    },
    additional_opportunities: additionalOpportunities,
    priority_matrix: {
      quadrants: {
        high_impact_low_effort: { label: "高効果・低工数（最優先）", opportunity_ids: ["locked-1"] },
        high_impact_high_effort: { label: "高効果・高工数（計画的に着手）", opportunity_ids: [] },
        low_impact_low_effort: { label: "低効果・低工数（余力があれば）", opportunity_ids: ["locked-2"] },
        low_impact_high_effort: { label: "低効果・高工数（非推奨）", opportunity_ids: [] },
      },
    },
    roadmap: {
      day_30: { actions: ["company_contextの各情報源を人間がレビューする"], expected_outcome: "実データへの置き換え可否判断" },
      day_60: { actions: ["Task11（実LLM接続）を有効化して再生成する"], expected_outcome: "実分析に基づくreport.jsonの生成" },
      day_90: { actions: ["Human Reviewを経て配信可否を判断する"], expected_outcome: "配信可能な状態の確立" },
    },
    execution_support: [
      { label: "追加調査", description: "Task8/Task9のシミュレーションデータを実データに置き換えるための調査" },
    ],
    monitoring: [{ theme: "パイプライン状況", description: "Task10〜Task12の実装状況" }],
  };

  return {
    source_pages: sourcePages,
    free_opportunity: freeOpportunity,
    locked_opportunities: lockedOpportunities,
    paid_analysis: paidAnalysis,
  };
}

module.exports = { simulateAiAnalysis, buildSourcePages };
