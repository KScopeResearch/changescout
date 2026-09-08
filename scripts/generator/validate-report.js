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
        // Phase54 STEP5: LLM が free-1 のような存在しない id を priority_matrix に書く事例あり。
        // 検出はそのまま（error）。有効な id 一覧をメッセージに含めて是正しやすくする。
        errors.push(
          `paid_analysis.priority_matrix.quadrants.${key}.opportunity_ids の不明なid "${id}"` +
            `（additional_opportunities に存在しません。有効: ${additionalIds.join(", ") || "（なし）"}）`
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
  checkOpportunityEvidenceQuality(report, warnings, errors); // Phase53 STEP10.12 / Phase54 STEP8A.1

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

// Phase53 STEP10.12: 関連性が低いと判断されたsource（関連性ガードで降格されたもの）の目安。
// relevance-guard.js の FLAGGED_SCORE_CAP と揃える（このモジュールは relevance-guard を
// requireしないため、値を直接持つ。片方を変えたらもう片方も見直すこと）。
const LOW_RELEVANCE_SCORE = 30;

/**
 * Opportunity（free_opportunity）のevidenceが、対象企業と関連の薄いsourceに依存して
 * いないかを警告する（Phase53 STEP10.12。P1-3 / P1-4 対応）。
 *
 * すべて警告（error ではない）。スキーマ違反ではなく「営業として送る前に人間が
 * 確認すべき関連性・会社適合の問題」を可視化するのが目的。機械的に reject すると
 * false positive で正当なレポートまで止めてしまうため。
 * @param {Object} report
 * @param {string[]} warnings
 */
// Phase54 STEP1: 外部の市場変化を示す source_type。
const EXTERNAL_MARKET_TYPES = ["government", "statistics", "industry_association", "technology"];

function checkOpportunityEvidenceQuality(report, warnings, errors) {
  const freeOpp = report.free_opportunity || {};
  const evidence = Array.isArray(freeOpp.evidence) ? freeOpp.evidence : [];

  checkGovernmentSubjectConfusion(freeOpp, warnings);
  checkOpportunityIsNotExistingBusiness(report, warnings); // Phase54 STEP1
  checkMarketChangeExternality(report, warnings); // Phase54 STEP1
  checkMarketChangeEvidenceGate(report, Array.isArray(errors) ? errors : []); // Phase54 STEP8A.1 STEP5
  checkOpportunityEvidenceGate(report, Array.isArray(errors) ? errors : []); // Phase54 STEP8A.1 STEP6

  if (evidence.length === 0) return;

  // Phase54 STEP1: evidence 最低2件・うち1件以上は非companyの関連source
  if (evidence.length < 2) {
    warnings.push(
      `free_opportunity.evidence が${evidence.length}件しかありません（quality-rules.md Phase54ルール3: 最低2件）`
    );
  }

  const sourceById = new Map((report.source_pages || []).map((s) => [s.id, s]));
  const evidenceSources = evidence.map((ev) => sourceById.get(ev.source_id)).filter(Boolean);
  if (evidenceSources.length === 0) return; // source_id 不整合は別チェック（errors）が扱う

  const hasCompanySource = evidenceSources.some((s) => s.source_type === "company");
  if (!hasCompanySource) {
    warnings.push(
      "free_opportunity.evidence に source_type:\"company\"（会社自身の一次情報）が含まれていません" +
        "（quality-rules.md 必須条件1。why_company の会社固有の主張が裏付けられているか要確認）"
    );
  }

  const hasRelevantExternal = evidenceSources.some(
    (s) =>
      EXTERNAL_MARKET_TYPES.includes(s.source_type) &&
      s.evidence_strength !== "reference" &&
      !(typeof s.score === "number" && s.score <= LOW_RELEVANCE_SCORE)
  );
  if (!hasRelevantExternal) {
    warnings.push(
      "free_opportunity.evidence に、関連性のある外部市場 source（government/statistics/" +
        "industry_association/technology で reference/低score でないもの）が1件も含まれていません" +
        "（quality-rules.md Phase54ルール3。既存事業の言い換えになっていないか要確認）"
    );
  }

  const lowRelevanceOnly =
    evidenceSources.length > 0 &&
    evidenceSources.every(
      (s) => s.evidence_strength === "reference" || (typeof s.score === "number" && s.score <= LOW_RELEVANCE_SCORE)
    );
  if (lowRelevanceOnly) {
    warnings.push(
      "free_opportunity.evidence が、関連性が低いと判断された source" +
        `（evidence_strength:"reference" もしくは score<=${LOW_RELEVANCE_SCORE}）のみに依存しています` +
        "（対象企業と無関係な情報を根拠にしている可能性。要確認）"
    );
  } else {
    evidenceSources.forEach((s) => {
      if (s.evidence_strength === "reference" || (typeof s.score === "number" && s.score <= LOW_RELEVANCE_SCORE)) {
        warnings.push(
          `free_opportunity.evidence が関連性の低い source（${s.id}、score=${s.score}、` +
            `evidence_strength=${s.evidence_strength}）を根拠に含めています（関連性を要確認）`
        );
      }
    });
  }
}

// Phase53 STEP10.12: 日本の公的施策を「中国政府の施策」と取り違えていないかの最小ヒューリスティック。
// ab-i.jp のレポートで「中国政府系助成金」「中国政府がクールジャパン戦略を公表」という
// 主体の取り違えが発生した。JLOX+・クールジャパン戦略・JETRO は日本の施策・機関。
const JP_PROGRAM_TERMS = ["クールジャパン", "JLOX", "ＪＬＯＸ", "JETRO", "ジェトロ"];

/**
 * @param {Object} freeOpp - report.free_opportunity
 * @param {string[]} warnings
 */
function checkGovernmentSubjectConfusion(freeOpp, warnings) {
  const fields = ["title", "why_now", "why_company", "market_change"];
  const allText = fields.map((f) => (typeof freeOpp[f] === "string" ? freeOpp[f] : "")).join("\n");
  const mentionsJpProgram = JP_PROGRAM_TERMS.some((t) => allText.includes(t));

  fields.forEach((field) => {
    const text = freeOpp[field];
    if (typeof text !== "string" || !text) return;

    JP_PROGRAM_TERMS.forEach((term) => {
      const idx = text.indexOf(term);
      if (idx === -1) return;
      const window = text.slice(Math.max(0, idx - 60), idx + term.length + 60);
      if (/中国政府|中国の公的|中国政府系|中国当局/.test(window)) {
        warnings.push(
          `free_opportunity.${field}: 日本の施策「${term}」を中国政府の施策として記述している疑いがあります` +
            "（quality-rules.md: 施策の主体〈どの国の政府か〉を source と一致させること）"
        );
      }
    });

    // 「中国政府系助成金/補助金/支援」— 同じ free_opportunity 内で日本の施策名（JLOX+/クールジャパン等）に
    // 言及しているのに、助成金の主体を「中国政府系」としている場合は取り違えの疑い。
    if (mentionsJpProgram && /中国政府系(助成金|補助金|支援金|ファンド)/.test(text)) {
      warnings.push(
        `free_opportunity.${field}: 「中国政府系助成金」等と記述されていますが、同じ Opportunity 内で` +
          "日本の施策（JLOX+・クールジャパン等）に言及しています。助成金の主体（日本／中国）を確認してください"
      );
    }
  });
}

// Phase54 STEP1: 2文字以上の連続する漢字/カタカナ列（事業内容の「特徴語」）を取り出す。
function keyPhrases(text) {
  return new Set((text || "").match(/[一-龠々]{2,}|[ァ-ヶ]{3,}/g) || []);
}

/**
 * 【Phase54 STEP1】free_opportunity.title が「既存事業の言い換え」になっていないかを警告する。
 * business_summary の特徴語と title の特徴語の重なりが高く、かつ title が
 * 「〜の強化/拡大/拡販/推進」だけで前向きな新方向（AI・新規事業・新市場・変革）を示していない場合。
 * @param {Object} report
 * @param {string[]} warnings
 */
// 前向きな新方向を示すマーカー。ただし「その語が business_summary にも出てくる」場合は
// その企業が既にやっていることなので新方向とはみなさない（Phase54 STEP1）。
const FORWARD_MARKERS =
  /生成AI|AI活用|AI導入|AI|DX|新規事業|新サービス|新商品|商品化|サービス化|新市場|海外展開|新規顧客|自動化|内製化|プラットフォーム|SaaS|データ活用|新たな|新規参入|参入|立ち上げ|変革|効率化/gi;

function checkOpportunityIsNotExistingBusiness(report, warnings) {
  const title = (report.free_opportunity || {}).title;
  const summary = (report.company_profile || {}).business_summary;
  if (typeof title !== "string" || !title || typeof summary !== "string" || !summary) return;
  if (summary.startsWith("（")) return; // プレースホルダは対象外

  const markers = (title.match(FORWARD_MARKERS) || []).map((m) => m);
  // title の前向きマーカーのうち、business_summary に出てこないもの（＝新しい方向性）が1つでもあれば許容
  if (markers.some((m) => !summary.includes(m))) return;

  const tp = keyPhrases(title);
  const sp = keyPhrases(summary);
  if (tp.size === 0) return;
  const overlap = [...tp].filter((w) => sp.has(w)).length / tp.size;

  if (overlap >= 0.5 && /(強化|拡大|拡販|推進|向上|充実|継続)/.test(title)) {
    warnings.push(
      "free_opportunity.title が business_summary の既存事業内容と大きく重複し、" +
        "「〜の強化/拡大」型になっています（quality-rules.md Phase54ルール1: 既存事業の言い換えを" +
        "Opportunity にしない。AI活用・新規事業・市場拡張・業務変革 のいずれかへ寄せる）"
    );
  }
}

/**
 * 【Phase54 STEP1】free_opportunity.market_change が「外部の変化」ではなく
 * 「会社の説明」になっていないかを警告する。market_change 内で引用している source_id が
 * 全て company の場合、または source_id を1件も引用していない場合。
 * @param {Object} report
 * @param {string[]} warnings
 */
function checkMarketChangeExternality(report, warnings) {
  const mc = (report.free_opportunity || {}).market_change;
  if (typeof mc !== "string" || !mc) return;
  if (/公開情報からは.*(取得できなかった|確認できな|不足)/.test(mc)) return; // 情報不足を正直に書いている場合は許容

  const sourceById = new Map((report.source_pages || []).map((s) => [s.id, s]));
  const cited = [...new Set(mc.match(/src-\d+/g) || [])].map((id) => sourceById.get(id)).filter(Boolean);

  if (cited.length === 0) {
    warnings.push(
      "free_opportunity.market_change が source_id を1件も引用していません" +
        "（quality-rules.md Phase54ルール5: 市場変化はそれを示す source を添えて書く）"
    );
    return;
  }
  const hasExternal = cited.some((s) => EXTERNAL_MARKET_TYPES.includes(s.source_type));
  if (!hasExternal) {
    warnings.push(
      "free_opportunity.market_change が company source のみを引用しています" +
        "（quality-rules.md Phase54ルール6: 市場変化は外部の変化。government/statistics/" +
        "industry_association/technology の source を最低1件引用する。会社の説明にしない）"
    );
  }
}

// Phase54 STEP8A.1 STEP5: Market Change の根拠ゲート（warning ではなく error = HOLD 対象）。
// 市場変化を、directory/review・reference のみ・company のみ・出典なしで書いている場合は FAIL。
// 「公開情報からは十分な外部データを取得できなかった」と正直に書いている場合は許容する。
const MARKET_CHANGE_OK_TYPES = ["government", "statistics", "industry_association", "technology", "news"];

function isReferenceGradeSource(s) {
  return (
    !s ||
    s.source_type === "directory" ||
    s.source_type === "review" ||
    s.evidence_strength === "reference" ||
    (typeof s.score === "number" && s.score <= LOW_RELEVANCE_SCORE)
  );
}

function checkMarketChangeEvidenceGate(report, errors) {
  const mc = (report.free_opportunity || {}).market_change;
  // 実データの market_change は 80〜300字程度。fixture の定型文（十数字）は対象外にする。
  if (typeof mc !== "string" || mc.length < 20) return;
  if (/公開情報からは.*(取得できなかった|確認できな|不足|得られなかった)/.test(mc)) return;

  const sourceById = new Map((report.source_pages || []).map((s) => [s.id, s]));
  const cited = [...new Set(mc.match(/src-\d+/g) || [])].map((id) => sourceById.get(id)).filter(Boolean);

  // 引用が1件も無い場合は checkMarketChangeExternality の warning が扱う（error にはしない）。
  if (cited.length === 0) return;

  const hasStrongExternal = cited.some(
    (s) => MARKET_CHANGE_OK_TYPES.includes(s.source_type) && !isReferenceGradeSource(s) && (s.score || 0) >= 70
  );
  if (!hasStrongExternal) {
    const kinds = cited.map((s) => `${s.id}:${s.source_type}/${s.score}`).join(", ");
    errors.push(
      "free_opportunity.market_change が外部市場 source（government/statistics/industry_association/" +
        `technology・news可、score>=70・非 reference）を引用していません（引用: ${kinds}）` +
        "（Phase54 STEP8A.1 STEP5: directory/review・reference のみ・company のみで市場変化を書かない）"
    );
  }
}

// Phase54 STEP8A.1 STEP6: Opportunity evidence の根拠ゲート。
// directory/review・reference だけを根拠に Opportunity を組み立てている場合は FAIL。
// company 欠落・外部市場欠落・score<=30 過半数 は warning（既存の checkOpportunityEvidenceQuality）。
function checkOpportunityEvidenceGate(report, errors) {
  const freeOpp = report.free_opportunity || {};
  const evidence = Array.isArray(freeOpp.evidence) ? freeOpp.evidence : [];
  if (evidence.length === 0) return;

  const sourceById = new Map((report.source_pages || []).map((s) => [s.id, s]));
  const evidenceSources = evidence.map((ev) => sourceById.get(ev.source_id)).filter(Boolean);
  if (evidenceSources.length === 0) return; // source_id 不整合は errors の別チェックが扱う

  const allReferenceGrade = evidenceSources.every(isReferenceGradeSource);
  if (allReferenceGrade) {
    const kinds = evidenceSources.map((s) => `${s.id}:${s.source_type}/${s.score}`).join(", ");
    errors.push(
      `free_opportunity.evidence が directory/review・reference・低score(<=${LOW_RELEVANCE_SCORE}) の ` +
        `source のみで構成されています（${kinds}）` +
        "（Phase54 STEP8A.1 STEP6: company の一次情報 + 関連性のある外部市場 source を根拠にすること）"
    );
  }
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
