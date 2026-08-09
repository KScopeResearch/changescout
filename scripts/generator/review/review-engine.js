/**
 * review-engine.js
 *
 * Task13: 人間レビューworkflowのコアロジック。詳細な設計・スキーマは
 * review-schema.md を参照。
 *
 * 【設計方針】状態遷移を扱う関数（approve/reject/requestRevision/addComment/addFix）は
 * すべてPure Function（同じ入力に対して常に同じ出力を返し、副作用を持たない）として実装する。
 * ファイルI/O（loadReview/saveReview）はこれらとは明確に分離し、CLI（review-cli.js）や
 * 呼び出し元がI/Oのタイミングを制御できるようにする。`now`（現在時刻）は各pure関数が
 * 内部で`new Date()`を呼ぶのではなく引数として受け取れるようにし、テスト時に固定できるように
 * している（省略時は呼び出し時点の時刻を使う）。
 */

const fs = require("fs");
const { readJson, writeJson } = require("../shared/json-file"); // Task18: JSON読み書きの共通化
const { nowIso, isValidIso8601 } = require("../shared/date-utils");

const VALID_STATUSES = ["pending_review", "approved", "needs_revision", "rejected"];
const SCHEMA_VERSION = "review-1.0";

/**
 * 新規のreview.jsonの初期状態を作る（Pure Function）。
 * @param {string} reportId - 対応するreport.jsonのid
 * @returns {Object} review
 */
function createEmptyReview(reportId) {
  return {
    schema_version: SCHEMA_VERSION,
    report_id: reportId || null,
    reviewer: null,
    reviewed_at: null,
    status: "pending_review",
    comments: [],
    fixes: [],
    history: [],
  };
}

/**
 * @param {number} n
 * @param {Array<Object>} existing - id採番の重複を避けるための既存配列
 * @param {string} prefix
 * @returns {string}
 */
function nextId(existing, prefix) {
  return `${prefix}-${(existing || []).length + 1}`;
}

/**
 * historyへ1件追加した「新しい」history配列を返す（Pure Function、既存配列は変更しない）。
 * @param {Array<Object>} history
 * @param {{at:string, actor:string, action:string, from_status:?string, to_status:?string, comment:?string}} entry
 * @returns {Array<Object>}
 */
function appendHistory(history, entry) {
  return [...(history || []), entry];
}

/**
 * レビューを承認する（Pure Function）。
 * @param {Object} review - 現在のreview
 * @param {{reviewer:string, comment?:string, now?:string}} params
 * @returns {Object} 新しいreviewオブジェクト（reviewは変更しない）
 */
function approve(review, { reviewer, comment, now } = {}) {
  if (!reviewer) throw new Error("approve()にはreviewerが必須です");
  const timestamp = now || nowIso();
  const fromStatus = review.status;

  return {
    ...review,
    reviewer,
    reviewed_at: timestamp,
    status: "approved",
    history: appendHistory(review.history, {
      at: timestamp,
      actor: reviewer,
      action: "approved",
      from_status: fromStatus,
      to_status: "approved",
      comment: comment || null,
    }),
  };
}

/**
 * レビューを却下する（Pure Function）。
 * @param {Object} review
 * @param {{reviewer:string, comment?:string, now?:string}} params
 * @returns {Object}
 */
function reject(review, { reviewer, comment, now } = {}) {
  if (!reviewer) throw new Error("reject()にはreviewerが必須です");
  const timestamp = now || nowIso();
  const fromStatus = review.status;

  return {
    ...review,
    reviewer,
    reviewed_at: timestamp,
    status: "rejected",
    history: appendHistory(review.history, {
      at: timestamp,
      actor: reviewer,
      action: "rejected",
      from_status: fromStatus,
      to_status: "rejected",
      comment: comment || null,
    }),
  };
}

/**
 * 修正を要求する（差し戻し、Pure Function）。任意で修正指示（fixes）をまとめて追加できる。
 * @param {Object} review
 * @param {{reviewer:string, comment?:string, fixes?:string[], now?:string}} params
 * @returns {Object}
 */
function requestRevision(review, { reviewer, comment, fixes, now } = {}) {
  if (!reviewer) throw new Error("requestRevision()にはreviewerが必須です");
  const timestamp = now || nowIso();
  const fromStatus = review.status;

  let nextFixes = review.fixes || [];
  (fixes || []).forEach((description) => {
    nextFixes = [
      ...nextFixes,
      { id: nextId(nextFixes, "f"), at: timestamp, actor: reviewer, description, resolved: false },
    ];
  });

  return {
    ...review,
    reviewer,
    reviewed_at: timestamp,
    status: "needs_revision",
    fixes: nextFixes,
    history: appendHistory(review.history, {
      at: timestamp,
      actor: reviewer,
      action: "revision_requested",
      from_status: fromStatus,
      to_status: "needs_revision",
      comment: comment || null,
    }),
  };
}

/**
 * statusを変更せずコメントのみ追加する（Pure Function）。
 * @param {Object} review
 * @param {{actor:string, text:string, now?:string}} params
 * @returns {Object}
 */
function addComment(review, { actor, text, now } = {}) {
  if (!actor) throw new Error("addComment()にはactorが必須です");
  if (!text) throw new Error("addComment()にはtextが必須です");
  const timestamp = now || nowIso();

  const nextComments = [...(review.comments || []), { id: nextId(review.comments, "c"), at: timestamp, actor, text }];

  return {
    ...review,
    comments: nextComments,
    history: appendHistory(review.history, {
      at: timestamp,
      actor,
      action: "comment_added",
      from_status: null,
      to_status: null,
      comment: text,
    }),
  };
}

/**
 * statusを変更せず修正指示のみ追加する（Pure Function）。
 * @param {Object} review
 * @param {{actor:string, description:string, now?:string}} params
 * @returns {Object}
 */
function addFix(review, { actor, description, now } = {}) {
  if (!actor) throw new Error("addFix()にはactorが必須です");
  if (!description) throw new Error("addFix()にはdescriptionが必須です");
  const timestamp = now || nowIso();

  const nextFixes = [
    ...(review.fixes || []),
    { id: nextId(review.fixes, "f"), at: timestamp, actor, description, resolved: false },
  ];

  return {
    ...review,
    fixes: nextFixes,
    history: appendHistory(review.history, {
      at: timestamp,
      actor,
      action: "fix_added",
      from_status: null,
      to_status: null,
      comment: description,
    }),
  };
}

/**
 * レビューの操作履歴を取得する（Pure Function、単純なgetterだがCLIのhistoryコマンド用に用意）。
 * @param {Object} review
 * @returns {Array<Object>}
 */
function getHistory(review) {
  return review && review.history ? review.history : [];
}

/**
 * report（report.json）がreview（review.json）の承認時点より後に再生成されていないかを
 * 検証する（Task36の内部ヘルパー）。文字列比較ではなくDate.parse()による数値（エポック
 * ミリ秒）比較を行う（ISO8601はタイムゾーン表記が混在しうるため文字列の辞書順比較では
 * 正しく時系列を判定できない）。不正な日時・比較不能な状態はいずれも安全側（NG）に倒す。
 * @param {Object} report - report.json（meta.generated_atを使用）
 * @param {Object} review - review.json（reviewed_atを使用）
 * @returns {{ok:boolean, reason:?string}}
 */
function checkReportFreshness(report, review) {
  const generatedAt = report && report.meta ? report.meta.generated_at : null;
  if (!generatedAt) {
    // reportが渡されていない/generated_atを持たない呼び出し元との後方互換性のため、
    // この場合は検証をスキップする（Task36以前の挙動を維持する）。
    return { ok: true, reason: null };
  }

  const reviewedAt = review ? review.reviewed_at : null;
  if (!reviewedAt) {
    return {
      ok: false,
      reason: "review.reviewed_atが記録されていないため、report.jsonとの整合性を検証できません",
    };
  }

  if (!isValidIso8601(generatedAt) || !isValidIso8601(reviewedAt)) {
    return {
      ok: false,
      reason:
        `report.meta.generated_at（${generatedAt}）またはreview.reviewed_at（${reviewedAt}）の日時形式が` +
        `不正なため、レビュー後に再生成されていないかを検証できません（安全側のため公開不可とします）`,
    };
  }

  const generatedTime = Date.parse(generatedAt);
  const reviewedTime = Date.parse(reviewedAt);
  if (Number.isNaN(generatedTime) || Number.isNaN(reviewedTime)) {
    return {
      ok: false,
      reason:
        `report.meta.generated_at（${generatedAt}）またはreview.reviewed_at（${reviewedAt}）を日時として` +
        `解釈できないため、レビュー後に再生成されていないかを検証できません（安全側のため公開不可とします）`,
    };
  }

  // 同時刻（===）は「後に再生成された」とは言えないため許可する（>のみをNG扱いにする）。
  if (generatedTime > reviewedTime) {
    return {
      ok: false,
      reason:
        `report.meta.generated_at（${generatedAt}）がreview.reviewed_at（${reviewedAt}）より後です` +
        `（承認後にreport.jsonが再生成された可能性があります。差し戻し→再レビューが必要です）`,
    };
  }

  return { ok: true, reason: null };
}

/**
 * report.jsonを配信してよいかを判定する（Task5、Pure Function）。
 * review.status が approved であり、かつ quality-evaluator.js の evaluation.status が
 * FAIL でない場合にのみ publishable = true とする。
 * （Task36で追加）さらに`report`が渡された場合、review承認後にreport.jsonが再生成されて
 * いないか（`report.meta.generated_at` > `review.reviewed_at`）も検証する。`report`省略時は
 * この追加検証を行わない（Task36以前の挙動を維持、既存呼び出し元との後方互換性のため）。
 * @param {Object} review - review.json
 * @param {Object} evaluation - report.evaluation（quality-evaluator.jsの出力）
 * @param {Object} [report] - report.json（Task36で追加。省略可）
 * @returns {{publishable:boolean, reasons:string[]}}
 */
function isPublishable(review, evaluation, report) {
  const reasons = [];
  const reviewApproved = !!review && review.status === "approved";
  const evaluationOk = !!evaluation && evaluation.status !== "FAIL";

  if (!reviewApproved) {
    reasons.push(`review.statusが"approved"ではありません（実際: ${review ? review.status : "review未取得"}）`);
  }
  if (!evaluationOk) {
    reasons.push(`evaluation.statusが"FAIL"です（品質評価エンジンの基準を満たしていません）`);
  }

  const freshness = checkReportFreshness(report, review);
  if (!freshness.ok) {
    reasons.push(freshness.reason);
  }

  return { publishable: reviewApproved && evaluationOk && freshness.ok, reasons };
}

/**
 * review.jsonを読み込む（I/O）。存在しない場合はcreateEmptyReview()の初期状態を返す
 * （まだ誰もレビューしていない report.json に対して review コマンドを初めて実行するケースに対応）。
 * @param {string} filePath - review.jsonのパス
 * @param {string} [reportIdForNew] - ファイルが存在しない場合に使うreport_id
 * @returns {Object} review
 */
function loadReview(filePath, reportIdForNew) {
  if (!fs.existsSync(filePath)) {
    return createEmptyReview(reportIdForNew);
  }
  return readJson(filePath);
}

/**
 * review.jsonを保存する（I/O）。
 * @param {string} filePath
 * @param {Object} review
 */
function saveReview(filePath, review) {
  writeJson(filePath, review);
}

module.exports = {
  VALID_STATUSES,
  SCHEMA_VERSION,
  createEmptyReview,
  approve,
  reject,
  requestRevision,
  addComment,
  addFix,
  getHistory,
  isPublishable,
  loadReview,
  saveReview,
};
