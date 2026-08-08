/**
 * quality-evaluator.js
 *
 * Task10: 品質評価エンジン。AI分析（simulate-ai-analysis.js、将来はTask11の実LLM）が
 * 生成した report.json の中身を100点満点で採点し、{score, grade, status, reasons,
 * warnings, improvements, breakdown} を返す。
 *
 * パイプライン上の位置づけ:
 *   fetch → merge → normalize → deduplicate → score → company_context生成 →
 *   AI分析 → [Quality Evaluation（本モジュール）] → 検証（validate-report.js）
 *
 * validate-report.js との役割分担:
 *   - validate-report.js: 機械的な形式チェック（必須項目の有無・ID整合性等）。
 *     壊れたデータを弾く「合否」の門番。
 *   - quality-evaluator.js（本モジュール）: 形式は正しい前提で、情報源の量・多様性・
 *     新しさや根拠の充実度など「内容の質」を採点する。壊れていなくても質が低い
 *     レポートを人間レビューに回すための優先度付けに使う。
 *
 * 採点対象は主に report.source_pages（情報源の質・多様性）と
 * report.free_opportunity.evidence（実際に引用された根拠の質）、
 * report.human_review.status（人間レビューの進捗）の3系統。
 *
 * 12項目の配点（合計100点。根拠のない数値を避けるため、内訳はbreakdownとして
 * evaluation生成時に常に残す）:
 *   1. 情報源数              8点
 *   2. 情報源バランス（種類数） 8点
 *   3. 政府情報有無           6点
 *   4. 企業情報有無           6点
 *   5. 業界情報有無           6点
 *   6. ニュース非偏重         8点
 *   7. 引用の質（quote充実度） 8点
 *   8. 情報源スコア平均       15点
 *   9. source_type偏り       8点
 *  10. source_role偏り       8点
 *  11. evidence数            8点
 *  12. human_review状態      11点
 *   合計                    100点
 *
 * grade（A〜D）と status（PASS/REVIEW/FAIL）は同じscoreから別々の基準で導出する
 * （ユーザー指定はstatusの5段階しきい値のみのため、gradeは一般的な10点刻みの
 * 4段階を独自に採用し、両者の対応関係をここに明記する）:
 *   grade:  A=90-100 / B=80-89 / C=70-79 / D=0-69
 *   status: PASS=80-100 / REVIEW=50-79 / FAIL=0-49
 */

const GOV_OR_STATS_TYPES = ["government", "statistics"];
const INDUSTRY_TYPES = ["industry_association", "technology"];

/**
 * 0〜maxの範囲でスコアをクランプする。
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function clamp(value, max) {
  return Math.max(0, Math.min(max, value));
}

/**
 * 情報源数（source_pages.length）を採点する。
 * @param {Array<Object>} sourcePages
 * @returns {{points:number,max:number,detail:string}}
 */
function scoreSourceCount(sourcePages) {
  const count = sourcePages.length;
  const max = 8;
  let points;
  if (count === 0) points = 0;
  else if (count <= 2) points = 3;
  else if (count <= 4) points = 6;
  else points = 8;
  return { points, max, detail: `情報源数: ${count}件` };
}

/**
 * source_typeの種類数（多様性）を採点する。
 * @param {Array<Object>} sourcePages
 * @returns {{points:number,max:number,detail:string,distinctTypes:number}}
 */
function scoreTypeBalance(sourcePages) {
  const max = 8;
  const distinctTypes = new Set(sourcePages.map((s) => s.source_type)).size;
  let points;
  if (distinctTypes <= 1) points = 2;
  else if (distinctTypes === 2) points = 5;
  else if (distinctTypes === 3) points = 7;
  else points = 8;
  return { points, max, detail: `情報源の種類数: ${distinctTypes}種類`, distinctTypes };
}

/**
 * 指定したsource_type群のいずれかが存在するかで加点する共通ロジック。
 * @param {Array<Object>} sourcePages
 * @param {string[]} types
 * @param {number} max
 * @param {string} label
 * @returns {{points:number,max:number,detail:string,present:boolean}}
 */
function scorePresence(sourcePages, types, max, label) {
  const present = sourcePages.some((s) => types.includes(s.source_type));
  return {
    points: present ? max : 0,
    max,
    detail: present ? `${label}: あり` : `${label}: なし`,
    present,
  };
}

/**
 * ニュース情報源への偏りを採点する（偏りが小さいほど高得点）。
 * @param {Array<Object>} sourcePages
 * @returns {{points:number,max:number,detail:string,newsRatio:number}}
 */
function scoreNewsOverreliance(sourcePages) {
  const max = 8;
  const total = sourcePages.length;
  if (total === 0) return { points: 0, max, detail: "情報源が0件のため判定不可", newsRatio: 0 };
  const newsCount = sourcePages.filter((s) => s.source_type === "news").length;
  const newsRatio = Math.round((newsCount / total) * 100) / 100;
  let points;
  if (newsRatio > 0.5) points = 0;
  else if (newsRatio > 0.3) points = 4;
  else points = 8;
  return { points, max, detail: `ニュース比率: ${Math.round(newsRatio * 100)}%`, newsRatio };
}

/**
 * free_opportunity.evidence内の引用（quote）の充実度を採点する。
 * @param {Array<Object>} evidence
 * @returns {{points:number,max:number,detail:string,quotedCount:number}}
 */
function scoreCitationQuality(evidence) {
  const max = 8;
  const quotedCount = evidence.filter(
    (e) => e && typeof e.quote === "string" && e.quote.trim().length > 0 && e.quote !== "（内容取得なし）"
  ).length;
  let points;
  if (quotedCount === 0) points = 0;
  else if (quotedCount === 1) points = 4;
  else if (quotedCount === 2) points = 6;
  else points = 8;
  return { points, max, detail: `有効な引用文: ${quotedCount}件`, quotedCount };
}

/**
 * source_pagesのscore平均を採点する。
 * @param {Array<Object>} sourcePages
 * @returns {{points:number,max:number,detail:string,average:number}}
 */
function scoreAverageSourceScore(sourcePages) {
  const max = 15;
  const valid = sourcePages.filter((s) => typeof s.score === "number");
  if (valid.length === 0) return { points: 0, max, detail: "score平均: 算出不可（0件）", average: 0 };
  const average = Math.round((valid.reduce((sum, s) => sum + s.score, 0) / valid.length) * 10) / 10;
  const points = Math.round(clamp((average / 100) * max, max));
  return { points, max, detail: `情報源scoreの平均: ${average.toFixed(1)}点`, average };
}

/**
 * 指定したキー（source_type / source_role）の分布の偏り（最大シェア）を採点する。
 * @param {Array<Object>} sourcePages
 * @param {string} key
 * @param {number} max
 * @param {string} label
 * @returns {{points:number,max:number,detail:string,maxShare:number}}
 */
function scoreDistributionSkew(sourcePages, key, max, label) {
  const total = sourcePages.length;
  if (total === 0) return { points: 0, max, detail: `${label}: 算出不可（0件）`, maxShare: 0 };
  const counts = new Map();
  sourcePages.forEach((s) => {
    const k = s[key] || "unknown";
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const maxCount = Math.max(...counts.values());
  const maxShare = Math.round((maxCount / total) * 100) / 100;
  let points;
  if (maxShare >= 0.7) points = Math.round(max * 0.25);
  else if (maxShare >= 0.5) points = Math.round(max * 0.6);
  else points = max;
  return { points, max, detail: `${label}: 最大偏り${Math.round(maxShare * 100)}%`, maxShare };
}

/**
 * free_opportunity.evidenceの件数（引用の幅）を採点する。
 * @param {Array<Object>} evidence
 * @returns {{points:number,max:number,detail:string}}
 */
function scoreEvidenceCount(evidence) {
  const max = 8;
  const count = evidence.length;
  let points;
  if (count === 0) points = 0;
  else if (count === 1) points = 4;
  else if (count <= 3) points = 6;
  else points = 8;
  return { points, max, detail: `evidence件数: ${count}件` };
}

/**
 * human_review.statusを採点する。
 * @param {string} status
 * @returns {{points:number,max:number,detail:string}}
 */
function scoreHumanReview(status) {
  const max = 11;
  const table = { approved: 11, pending_review: 6, needs_revision: 0 };
  const points = Object.prototype.hasOwnProperty.call(table, status) ? table[status] : 3;
  return { points, max, detail: `human_review.status: ${status || "不明"}` };
}

/**
 * scoreからgrade（A〜D）を導出する。ユーザー指定のstatusしきい値（5段階）とは
 * 独立した、一般的な10点刻みの4段階基準を用いる。
 * @param {number} score
 * @returns {"A"|"B"|"C"|"D"}
 */
function gradeFromScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "D";
}

/**
 * scoreからstatus（PASS/REVIEW/FAIL）を導出する。
 * @param {number} score
 * @returns {"PASS"|"REVIEW"|"FAIL"}
 */
function statusFromScore(score) {
  if (score >= 80) return "PASS";
  if (score >= 50) return "REVIEW";
  return "FAIL";
}

/**
 * report.jsonを採点し、evaluationオブジェクトを返す。
 * @param {Object} report - report.json（source_pages / free_opportunity / human_review を含む）
 * @returns {{score:number, grade:string, status:string, reasons:string[], warnings:string[], improvements:string[], breakdown:Object}}
 */
function evaluateReportQuality(report) {
  const sourcePages = (report && report.source_pages) || [];
  const evidence = (report && report.free_opportunity && report.free_opportunity.evidence) || [];
  const humanReviewStatus = report && report.human_review && report.human_review.status;

  const breakdown = {
    source_count: scoreSourceCount(sourcePages),
    type_balance: scoreTypeBalance(sourcePages),
    government_presence: scorePresence(sourcePages, GOV_OR_STATS_TYPES, 6, "政府/統計情報"),
    company_presence: scorePresence(sourcePages, ["company"], 6, "企業情報"),
    industry_presence: scorePresence(sourcePages, INDUSTRY_TYPES, 6, "業界情報"),
    news_overreliance: scoreNewsOverreliance(sourcePages),
    citation_quality: scoreCitationQuality(evidence),
    average_source_score: scoreAverageSourceScore(sourcePages),
    type_skew: scoreDistributionSkew(sourcePages, "source_type", 8, "source_type偏り"),
    role_skew: scoreDistributionSkew(sourcePages, "source_role", 8, "source_role偏り"),
    evidence_count: scoreEvidenceCount(evidence),
    human_review_status: scoreHumanReview(humanReviewStatus),
  };

  const score = clamp(
    Object.values(breakdown).reduce((sum, item) => sum + item.points, 0),
    100
  );

  const reasons = [];
  const warnings = [];
  const improvements = [];

  Object.entries(breakdown).forEach(([key, item]) => {
    const ratio = item.max === 0 ? 1 : item.points / item.max;
    if (ratio >= 0.99) {
      reasons.push(`${item.detail}（${item.points}/${item.max}点）`);
    } else if (ratio <= 0.4) {
      warnings.push(`${item.detail}（${item.points}/${item.max}点、要改善）`);
    }
  });

  if (!breakdown.government_presence.present) {
    improvements.push("政府・統計情報源を追加してください（信頼性の高い一次情報の裏付けが不足しています）");
  }
  if (!breakdown.company_presence.present) {
    improvements.push("企業自身の情報源（公式サイト・IR等）を追加してください");
  }
  if (!breakdown.industry_presence.present) {
    improvements.push("業界団体・技術団体の情報源を追加してください");
  }
  if (breakdown.news_overreliance.newsRatio > 0.5) {
    improvements.push("ニュース情報源への依存度が高すぎます。一次情報・統計等の比率を高めてください");
  }
  if (breakdown.citation_quality.quotedCount < 2) {
    improvements.push("evidenceに具体的な引用文（quote）を追加し、根拠の質を高めてください");
  }
  if (breakdown.average_source_score.average < 70 && sourcePages.length > 0) {
    improvements.push("情報源全体のscore平均が低めです。より信頼度の高い情報源への差し替えを検討してください");
  }
  if (humanReviewStatus === "needs_revision") {
    improvements.push("human_reviewが要修正（needs_revision）のままです。指摘内容を反映してください");
  } else if (humanReviewStatus === "pending_review") {
    improvements.push("human_reviewが未着手（pending_review）です。配信前に人間レビューを完了してください");
  }
  if (breakdown.evidence_count.points <= 4) {
    improvements.push("free_opportunity.evidenceの件数が少なく、根拠の幅が狭い状態です");
  }

  return {
    score,
    grade: gradeFromScore(score),
    status: statusFromScore(score),
    reasons,
    warnings,
    improvements,
    breakdown,
  };
}

/**
 * evaluation結果をMarkdownレポートとして整形する。
 * @param {Object} report - report.json（company_profile.nameの表示用）
 * @param {Object} evaluation - evaluateReportQuality() の戻り値
 * @returns {string} Markdown文字列
 */
function renderEvaluationMarkdown(report, evaluation) {
  const companyName = (report && report.company_profile && report.company_profile.name) || "（不明）";
  const lines = [];

  lines.push(`# 品質評価レポート — ${companyName}`);
  lines.push("");
  lines.push(`- スコア: **${evaluation.score} / 100**`);
  lines.push(`- 判定（grade）: **${evaluation.grade}**`);
  lines.push(`- ステータス（status）: **${evaluation.status}**`);
  lines.push("");
  lines.push(
    "> grade（A〜D）とstatus（PASS/REVIEW/FAIL）は同じscoreから別基準で算出しています。" +
      "grade: A=90-100/B=80-89/C=70-79/D=0-69、status: PASS=80-100/REVIEW=50-79/FAIL=0-49。"
  );
  lines.push("");

  lines.push("## 内訳（breakdown）");
  lines.push("");
  lines.push("| 項目 | 点数 | 配点 | 詳細 |");
  lines.push("|---|---|---|---|");
  Object.entries(evaluation.breakdown).forEach(([key, item]) => {
    lines.push(`| ${key} | ${item.points} | ${item.max} | ${item.detail} |`);
  });
  lines.push("");

  lines.push("## 良かった点（reasons）");
  lines.push("");
  if (evaluation.reasons.length) {
    evaluation.reasons.forEach((r) => lines.push(`- ${r}`));
  } else {
    lines.push("- （該当なし）");
  }
  lines.push("");

  lines.push("## 注意点（warnings）");
  lines.push("");
  if (evaluation.warnings.length) {
    evaluation.warnings.forEach((w) => lines.push(`- ${w}`));
  } else {
    lines.push("- （該当なし）");
  }
  lines.push("");

  lines.push("## 改善提案（improvements）");
  lines.push("");
  if (evaluation.improvements.length) {
    evaluation.improvements.forEach((i) => lines.push(`- ${i}`));
  } else {
    lines.push("- （該当なし）");
  }
  lines.push("");

  return lines.join("\n");
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("使い方: node quality-evaluator.js <report.jsonのパス>");
    process.exitCode = 2;
    return;
  }

  const { readJson } = require("./shared/json-file");
  let report;
  try {
    report = readJson(filePath);
  } catch (err) {
    console.error(`JSONの読み込み・パースに失敗しました: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const evaluation = evaluateReportQuality(report);
  console.log(`評価対象: ${filePath}`);
  console.log(`スコア: ${evaluation.score} / 100`);
  console.log(`grade: ${evaluation.grade} / status: ${evaluation.status}`);
  console.log("\n内訳:");
  Object.entries(evaluation.breakdown).forEach(([key, item]) => {
    console.log(`  ${key}: ${item.points}/${item.max}点 — ${item.detail}`);
  });
  if (evaluation.reasons.length) {
    console.log("\n良かった点:");
    evaluation.reasons.forEach((r) => console.log(`  + ${r}`));
  }
  if (evaluation.warnings.length) {
    console.log("\n注意点:");
    evaluation.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (evaluation.improvements.length) {
    console.log("\n改善提案:");
    evaluation.improvements.forEach((i) => console.log(`  - ${i}`));
  }

  process.exitCode = evaluation.status === "FAIL" ? 1 : 0;
}

if (require.main === module) {
  // Task23: 他CLIとのエラーハンドリング方針統一（shared/cli-utils.jsのrunCli()参照）
  const { runCli } = require("./shared/cli-utils");
  runCli(async () => main());
}

module.exports = { evaluateReportQuality, renderEvaluationMarkdown, gradeFromScore, statusFromScore };
