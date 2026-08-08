#!/usr/bin/env node
/**
 * validate-report.js
 *
 * report.json（docs/mock_data schema_version 2.4準拠）を機械的に検証する。
 * Task10（品質評価エンジン）からも再利用できるよう、モジュールとしてもCLIとしても使える。
 *
 * チェック項目:
 *   - schema_version が "2.4" であること
 *   - 必須項目（company_profile / source_pages / free_opportunity / paid_analysis 等）の存在
 *   - ID重複（source_pages[].id, additional_opportunities[].id, locked_opportunities[].id）
 *   - source_id存在（free_opportunity.evidence[].source_id が source_pages に実在するか）
 *   - priority_matrix整合（opportunity_ids が additional_opportunities に実在するか、
 *     4象限すべてが存在するか、同一Opportunityが複数象限に重複していないか）
 *   - source_pages各項目（Task9で追加）:
 *     - score が必須・0〜100の数値であること
 *     - published_at は任意（未設定/nullはPASS）。値が存在する場合のみISO8601形式であることを検証する
 *       （Task32で変更。Tavily実検索では公開日が取得できないページが大半であることが判明したため、
 *       「取得できないこと」と「取得した日付が不正であること」を区別するようにした。詳細は
 *       README.md「実provider検証で判明したpublished_at検証の是正（Task32）」参照）
 *     - source_type / source_role が列挙型の値であること
 *     - source_pages内でのURL重複がないこと
 *   - evaluation（Task10で追加、quality-evaluator.jsの出力）:
 *     - report.evaluation が存在すること
 *     - score が0〜100の数値であること
 *     - grade が "A"|"B"|"C"|"D" のいずれかであること
 *     - status が "PASS"|"REVIEW"|"FAIL" のいずれかであること
 *     - reasons / warnings / improvements が配列であること
 *   - AI出力の内容品質（Task11で追加。scripts/generator/prompts/quality-rules.mdの
 *     fact/analysis/action区分に対応する**警告**。スキーマ自体は変更していないため
 *     ヒューリスティックな文字列パターンチェックであり、errorではなくwarningとする）:
 *     - fact区分のフィールド（why_now/why_company/market_change/first_action/evidence[].quote）に
 *       根拠なし推測を示す表現（「〜と思われる」「〜かもしれません」等）が含まれていないか
 *       （extended_analysis等のanalysis区分フィールドは対象外。quality-rules.mdの方針どおり
 *       根拠付き推論としてそこでは許容する）
 *     - 空の分析内容（free_opportunity.extended_analysis.*、
 *       paid_analysis.decision_summary.recommendation 等）がないか
 *
 * Task13で validateReview(review) を追加した。これはreport.jsonではなく、
 * scripts/generator/review/review-engine.js が読み書きする別ファイル
 * review.json（scripts/generator/review/review-schema.md参照）の形状を検証する、
 * 独立した検証関数（validateReport()とは対象が異なるため、別関数として提供する）。
 *   - review が存在すること
 *   - status が pending_review|approved|needs_revision|rejected のいずれかであること
 *   - status が pending_review 以外の場合、reviewer が必須であること
 *   - reviewed_at（存在する場合）がISO8601形式であること
 *   - comments / fixes / history が配列であること
 *   - history[]各要素の at（ISO8601）・action が必須であること
 *
 * 【注意】Task9でsource_pagesにscoreを必須化したため、scoreを持たない
 * 旧データ（docs/mock_data/*.json 等、Task9より前に作成されたもの）はエラーになる。
 * これは仕様変更に伴う正しい挙動であり、バグではない（README.mdの既知の制約を参照）。
 * published_atは元々Task9でscoreと同時に必須化していたが、Task32で任意（値がある場合のみ
 * 形式検証）に変更した（schema_version 2.4の原設計・score-sources.js/quality-evaluator.js等の
 * 既存実装はいずれもpublished_atのnullを許容しており、validate-report.jsのみが必須化していた
 * という設計上の矛盾を是正したもの。schema_versionは2.4のまま変更していない）。
 */

const { VALID_SOURCE_TYPES, VALID_SOURCE_ROLES } = require("./normalize-sources");
const { ISO_8601_PATTERN } = require("./shared/date-utils"); // Task18: 正規表現の二重管理を避けshared/へ集約

const REQUIRED_TOP_LEVEL_FIELDS = [
  "meta",
  "company_profile",
  "source_pages",
  "free_opportunity",
  "locked_opportunities",
  "paid_analysis",
  "evaluation",
];

const VALID_EVALUATION_GRADES = ["A", "B", "C", "D"];
const VALID_EVALUATION_STATUSES = ["PASS", "REVIEW", "FAIL"];

const REQUIRED_QUADRANTS = [
  "high_impact_low_effort",
  "high_impact_high_effort",
  "low_impact_low_effort",
  "low_impact_high_effort",
];

// fact区分のフィールドに登場すべきでない、根拠なし推測を示す典型表現（Task11で追加）。
// analysis区分（extended_analysis等）では quality-rules.md の方針どおり許容するため対象外。
const SPECULATION_PHRASES = [
  "と思われる",
  "と思います",
  "かもしれない",
  "かもしれません",
  "可能性があります",
  "の可能性がある",
  "でしょう",
  "推測されます",
  "推測される",
];

// fact/action区分（事実・具体的行動が期待される）フィールド。analysis区分は対象外。
const FACT_OR_ACTION_FIELDS = ["why_now", "why_company", "market_change", "first_action"];

// review.json（Task13）のstatus列挙型。report.json側のhuman_review.statusとは独立
// （review.jsonは"rejected"を持つが、human_review.statusは持たない。review-schema.md参照）。
const VALID_REVIEW_STATUSES = ["pending_review", "approved", "needs_revision", "rejected"];

/**
 * report.json を検証し、エラー・警告の一覧を返す。
 * @param {Object} report - 検証対象のreportオブジェクト
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateReport(report) {
  const errors = [];
  const warnings = [];

  if (!report || typeof report !== "object") {
    return { ok: false, errors: ["report がオブジェクトではありません"], warnings };
  }

  // --- schema_version ---
  const schemaVersion = report.meta && report.meta.schema_version;
  if (schemaVersion !== "2.4") {
    errors.push(`meta.schema_version は "2.4" である必要があります（実際: ${JSON.stringify(schemaVersion)}）`);
  }

  // --- 必須項目 ---
  REQUIRED_TOP_LEVEL_FIELDS.forEach((field) => {
    if (!(field in report)) errors.push(`必須フィールド "${field}" がありません`);
  });
  if (errors.length) return { ok: false, errors, warnings };

  if (!report.company_profile.name) errors.push("company_profile.name が空です");
  if (!report.free_opportunity.title) errors.push("free_opportunity.title が空です");
  ["why_now", "why_company", "market_change", "first_action"].forEach((f) => {
    if (!report.free_opportunity[f]) warnings.push(`free_opportunity.${f} が空です`);
  });
  if (!report.free_opportunity.extended_analysis) {
    errors.push("free_opportunity.extended_analysis がありません");
  }
  if (!report.paid_analysis.decision_summary) errors.push("paid_analysis.decision_summary がありません");

  // --- ID重複チェック ---
  const sourceIds = (report.source_pages || []).map((s) => s.id);
  checkDuplicates(sourceIds, "source_pages[].id", errors);

  // --- source_pages各項目の詳細検証（Task9で追加） ---
  const sourceUrls = [];
  (report.source_pages || []).forEach((s, i) => {
    const label = `source_pages[${i}]（id: ${s.id || "不明"}）`;

    // Task12で追加: 検索由来のsourceを想定し、label（タイトル相当）・urlの必須チェックを追加
    if (!s.label || !String(s.label).trim()) {
      errors.push(`${label}.label が必須です`);
    }
    if (!s.url || !String(s.url).trim()) {
      errors.push(`${label}.url が必須です`);
    }

    if (typeof s.score !== "number") {
      errors.push(`${label}.score が必須です（数値である必要があります）`);
    } else if (s.score < 0 || s.score > 100) {
      errors.push(`${label}.score は0〜100の範囲である必要があります（実際: ${s.score}）`);
    }

    // Task32: published_atは任意。値が存在する場合のみISO8601形式を検証する
    // （「取得できないこと」＝null/未設定はエラーにせず、「取得した日付が不正であること」のみエラーにする）
    if (s.published_at && !ISO_8601_PATTERN.test(s.published_at)) {
      errors.push(`${label}.published_at はISO8601形式である必要があります（実際: ${s.published_at}）`);
    }

    if (!VALID_SOURCE_TYPES.includes(s.source_type)) {
      errors.push(`${label}.source_type が不正な値です（実際: ${JSON.stringify(s.source_type)}）`);
    }
    if (!VALID_SOURCE_ROLES.includes(s.source_role)) {
      errors.push(`${label}.source_role が不正な値です（実際: ${JSON.stringify(s.source_role)}）`);
    }

    if (s.url) sourceUrls.push(s.url);
  });
  checkDuplicates(sourceUrls, "source_pages[].url", errors);

  const lockedIds = (report.locked_opportunities || []).map((o) => o.id);
  checkDuplicates(lockedIds, "locked_opportunities[].id", errors);

  const additionalIds = (report.paid_analysis.additional_opportunities || []).map((o) => o.id);
  checkDuplicates(additionalIds, "paid_analysis.additional_opportunities[].id", errors);

  // --- evaluation検証（Task10で追加） ---
  const evaluation = report.evaluation || {};
  if (typeof evaluation.score !== "number" || evaluation.score < 0 || evaluation.score > 100) {
    errors.push(`evaluation.score は0〜100の数値である必要があります（実際: ${JSON.stringify(evaluation.score)}）`);
  }
  if (!VALID_EVALUATION_GRADES.includes(evaluation.grade)) {
    errors.push(`evaluation.grade が不正な値です（実際: ${JSON.stringify(evaluation.grade)}）`);
  }
  if (!VALID_EVALUATION_STATUSES.includes(evaluation.status)) {
    errors.push(`evaluation.status が不正な値です（実際: ${JSON.stringify(evaluation.status)}）`);
  }
  ["reasons", "warnings", "improvements"].forEach((field) => {
    if (!Array.isArray(evaluation[field])) {
      errors.push(`evaluation.${field} は配列である必要があります`);
    }
  });

  // --- source_id存在チェック（evidence → source_pages） ---
  const sourceIdSet = new Set(sourceIds);
  (report.free_opportunity.evidence || []).forEach((ev, i) => {
    if (!ev.source_id) {
      errors.push(`free_opportunity.evidence[${i}] に source_id がありません`);
    } else if (!sourceIdSet.has(ev.source_id)) {
      errors.push(`free_opportunity.evidence[${i}].source_id "${ev.source_id}" が source_pages に存在しません`);
    }
    if (!ev.quote) warnings.push(`free_opportunity.evidence[${i}] に quote がありません`);
  });

  // --- priority_matrix整合チェック ---
  const additionalIdSet = new Set(additionalIds);
  const quadrants = (report.paid_analysis.priority_matrix || {}).quadrants || {};
  const idToQuadrants = new Map(); // 象限をまたぐ重複割り当てを検出するため

  REQUIRED_QUADRANTS.forEach((key) => {
    if (!quadrants[key]) {
      errors.push(`paid_analysis.priority_matrix.quadrants.${key} がありません`);
      return;
    }
    const ids = quadrants[key].opportunity_ids || [];
    if (quadrants[key].items) {
      errors.push(
        `paid_analysis.priority_matrix.quadrants.${key} に旧構造の items[] が残っています（opportunity_ids のみを使用してください）`
      );
    }
    ids.forEach((id) => {
      if (!additionalIdSet.has(id)) {
        errors.push(
          `paid_analysis.priority_matrix.quadrants.${key}.opportunity_ids の "${id}" が additional_opportunities に存在しません`
        );
      }
      if (!idToQuadrants.has(id)) idToQuadrants.set(id, []);
      idToQuadrants.get(id).push(key);
    });
  });

  idToQuadrants.forEach((quadrantKeys, id) => {
    if (quadrantKeys.length > 1) {
      errors.push(
        `priority_matrix: Opportunity "${id}" が複数の象限（${quadrantKeys.join(", ")}）に重複して割り当てられています`
      );
    }
  });

  // --- AI出力の内容品質チェック（Task11で追加、いずれも警告） ---
  checkSpeculationPhrases(report, warnings);
  checkEmptyAnalysisContent(report, warnings);

  // --- 旧スキーマ残存チェック ---
  if ("opportunities_open" in report) errors.push("旧フィールド opportunities_open が残っています");
  if (Array.isArray(report.locked_opportunities) && report.locked_opportunities.some((o) => "relevance" in o || "evidence" in o)) {
    errors.push("locked_opportunities に旧構造（relevance/evidence等）のデータが混入しています");
  }
  if (report.free_opportunity && "registration_bonus" in report.free_opportunity) {
    errors.push("旧フィールド free_opportunity.registration_bonus が残っています（extended_analysisを使用してください）");
  }
  (report.free_opportunity && report.free_opportunity.evidence || []).forEach((ev, i) => {
    if ("source_url" in ev || "source_name" in ev || "citation_excerpt" in ev) {
      errors.push(`free_opportunity.evidence[${i}] に旧構造のフィールド（source_url/source_name/citation_excerpt）が残っています`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * fact/action区分のフィールドに根拠なし推測を示す表現がないかを警告する。
 * analysis区分（extended_analysis等）はquality-rules.mdの方針により対象外。
 * @param {Object} report
 * @param {string[]} warnings
 */
function checkSpeculationPhrases(report, warnings) {
  const scan = (text, fieldLabel) => {
    if (typeof text !== "string") return;
    SPECULATION_PHRASES.forEach((phrase) => {
      if (text.includes(phrase)) {
        warnings.push(
          `${fieldLabel} に推測表現「${phrase}」が含まれています` +
            `（fact/action区分のため事実ベースの記述が期待されます。analysis区分では許容）`
        );
      }
    });
  };

  const freeOpportunity = report.free_opportunity || {};
  FACT_OR_ACTION_FIELDS.forEach((field) => scan(freeOpportunity[field], `free_opportunity.${field}`));
  (freeOpportunity.evidence || []).forEach((ev, i) => scan(ev.quote, `free_opportunity.evidence[${i}].quote`));
}

/**
 * analysis区分の主要フィールドが空になっていないかを警告する。
 * @param {Object} report
 * @param {string[]} warnings
 */
function checkEmptyAnalysisContent(report, warnings) {
  const extended = (report.free_opportunity || {}).extended_analysis || {};
  ["market_size", "competition", "risks", "priority", "case_examples", "confidence_note"].forEach((field) => {
    if (!extended[field] || !String(extended[field]).trim()) {
      warnings.push(`free_opportunity.extended_analysis.${field} が空です`);
    }
  });

  const decisionSummary = (report.paid_analysis || {}).decision_summary || {};
  if (!decisionSummary.recommendation || !String(decisionSummary.recommendation).trim()) {
    warnings.push("paid_analysis.decision_summary.recommendation が空です");
  }

  (((report.paid_analysis || {}).additional_opportunities) || []).forEach((opp, i) => {
    if (!opp.summary || !String(opp.summary).trim()) {
      warnings.push(`paid_analysis.additional_opportunities[${i}]（id: ${opp.id || "不明"}）.summary が空です`);
    }
  });
}

/**
 * review.json（scripts/generator/review/review-schema.md参照）の形状を検証する。
 * report.jsonとは別ファイル・別スキーマのため、validateReport()とは独立した関数として提供する。
 * @param {Object} review - 検証対象のreviewオブジェクト
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateReview(review) {
  const errors = [];
  const warnings = [];

  if (!review || typeof review !== "object") {
    return { ok: false, errors: ["review がオブジェクトではありません"], warnings };
  }

  if (!VALID_REVIEW_STATUSES.includes(review.status)) {
    errors.push(`review.status が不正な値です（実際: ${JSON.stringify(review.status)}）`);
  }
  if (review.status && review.status !== "pending_review" && !review.reviewer) {
    errors.push(`review.reviewer が必須です（status="${review.status}"のため）`);
  }
  if (review.reviewed_at && !ISO_8601_PATTERN.test(review.reviewed_at)) {
    errors.push(`review.reviewed_at はISO8601形式である必要があります（実際: ${review.reviewed_at}）`);
  }

  ["comments", "fixes", "history"].forEach((field) => {
    if (!Array.isArray(review[field])) {
      errors.push(`review.${field} は配列である必要があります`);
    }
  });

  (review.history || []).forEach((h, i) => {
    if (!h.at || !ISO_8601_PATTERN.test(h.at)) {
      errors.push(`review.history[${i}].at が必須・ISO8601形式である必要があります（実際: ${h.at}）`);
    }
    if (!h.action) {
      errors.push(`review.history[${i}].action が必須です`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

/** @param {string[]} ids @param {string} label @param {string[]} errors */
function checkDuplicates(ids, label, errors) {
  const seen = new Set();
  ids.forEach((id) => {
    if (seen.has(id)) errors.push(`${label} に重複したid "${id}" があります`);
    seen.add(id);
  });
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("使い方: node validate-report.js <report.jsonのパス>");
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

  const { ok, errors, warnings } = validateReport(report);

  console.log(`検証対象: ${filePath}`);
  console.log(`結果: ${ok ? "PASS" : "FAIL"}`);
  if (errors.length) {
    console.log("\nエラー:");
    errors.forEach((e) => console.log(`  ✗ ${e}`));
  }
  if (warnings.length) {
    console.log("\n警告:");
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (ok && !warnings.length) console.log("\n問題は見つかりませんでした。");

  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  // Task23: CLI全体でエラーハンドリング方針（exitCode統一・DEBUG時のみstack表示）を
  // shared/cli-utils.jsのrunCli()に揃えた（validate-report.js自体はfetch()を使わないため
  // Task11のlibuvクラッシュ問題は該当しないが、他CLIとの一貫性のため統一する）。
  const { runCli } = require("./shared/cli-utils");
  runCli(async () => main());
}

module.exports = { validateReport, validateReview, VALID_REVIEW_STATUSES };
