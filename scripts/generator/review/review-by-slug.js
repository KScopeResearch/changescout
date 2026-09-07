#!/usr/bin/env node
/**
 * review-by-slug.js — company_slug を identifier とする Review CLI。
 *
 * 【なぜ review-cli.js とは別に用意したか】
 * 既存の review-cli.js は「ローカルの report.json のパス」を必須引数とし、review.json も
 * その隣（同一ディレクトリ）にローカル書き込みする filesystem 専用ツールである
 * （review-store.js のヘッダコメント参照）。REPORT_STORE_BACKEND=s3 のように
 * report.json がローカルに存在しない構成（Lambda / Controlled E2E 等）では review-cli.js を
 * 実行できない。
 *
 * 本ファイルは、既に publish-report.js・website/aor-admin/server.js が採用している
 * 「company_slug をキーにした backend 抽象化層（report-store.js / review-store.js）＋
 * review-engine.js の Pure Function」という組み合わせをそのまま CLI から呼ぶだけの薄い
 * ラッパーである。状態遷移ロジック（approve/reject）は review-engine.js を一切再実装せず
 * 委譲する。新しい保存先・新しいスキーマは追加しない。
 *
 * 使い方:
 *   node scripts/generator/review/review-by-slug.js status  <slug>
 *   node scripts/generator/review/review-by-slug.js approve <slug> --reviewer=NAME [--comment="..."]
 *   node scripts/generator/review/review-by-slug.js reject  <slug> --reviewer=NAME [--comment="..."]
 *
 * REPORT_STORE_BACKEND / REVIEW_STORE_BACKEND（既定 "filesystem"）で保存先が決まる。
 * 本ファイルはそれらの値を解釈せず、report-store.js / review-store.js にそのまま委ねる。
 */

const reviewEngine = require("./review-engine");
const reviewStore = require("./review-store");
const reportStore = require("../report-store");
const { validateReview } = require("../validate-report");
const { runCli } = require("../shared/cli-utils");

/**
 * `--key=value` 形式のフラグだけを解釈する（review-cli.js の parseFlags と同じ方式）。
 * @param {string[]} argv
 * @returns {Object}
 */
function parseFlags(argv) {
  const flags = {};
  argv.forEach((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/s);
    if (m) flags[m[1]] = m[2];
  });
  return flags;
}

/**
 * 指定 slug の report / review を backend 経由で取得する。
 * @param {string} slug
 * @returns {Promise<{report: (Object|null), review: Object}>}
 */
async function loadForSlug(slug) {
  let report;
  try {
    report = await reportStore.loadReport(slug);
  } catch (err) {
    report = null; // 不正JSON等も「見つからない」扱い（publish-report.js と同じ丸め方）
  }
  const review = await reviewStore.loadReview(slug, report && report.id);
  return { report, review };
}

/** @param {Object} review */
function printReview(review) {
  console.log(`status: ${review.status}`);
  console.log(`reviewer: ${review.reviewer || "（未設定）"}`);
  console.log(`reviewed_at: ${review.reviewed_at || "（未設定）"}`);
  console.log(
    `comments: ${review.comments.length}件 / fixes: ${review.fixes.length}件 / history: ${review.history.length}件`
  );
}

/**
 * slug の review を承認状態へ遷移させて保存する（I/O）。
 * @param {string} slug
 * @param {{reviewer:string, comment?:string}} opts
 * @returns {Promise<{ok:boolean, slug:string, status?:string, error?:string}>}
 */
async function approveBySlug(slug, opts = {}) {
  if (typeof slug !== "string" || !slug) return { ok: false, slug, error: "slug（文字列）が必須です" };
  if (!opts.reviewer) return { ok: false, slug, error: "reviewer が必須です" };

  const { report, review } = await loadForSlug(slug);
  if (!report) {
    return { ok: false, slug, error: `report が見つかりません: ${slug}（先に Report Generation を実行してください）` };
  }

  let next;
  try {
    next = reviewEngine.approve(review, { reviewer: opts.reviewer, comment: opts.comment });
  } catch (err) {
    return { ok: false, slug, error: err.message };
  }
  await reviewStore.saveReview(slug, next);
  return { ok: true, slug, status: next.status };
}

/**
 * slug の review を却下状態へ遷移させて保存する（I/O）。
 * @param {string} slug
 * @param {{reviewer:string, comment?:string}} opts
 * @returns {Promise<{ok:boolean, slug:string, status?:string, error?:string}>}
 */
async function rejectBySlug(slug, opts = {}) {
  if (typeof slug !== "string" || !slug) return { ok: false, slug, error: "slug（文字列）が必須です" };
  if (!opts.reviewer) return { ok: false, slug, error: "reviewer が必須です" };

  const { report, review } = await loadForSlug(slug);
  if (!report) {
    return { ok: false, slug, error: `report が見つかりません: ${slug}` };
  }

  let next;
  try {
    next = reviewEngine.reject(review, { reviewer: opts.reviewer, comment: opts.comment });
  } catch (err) {
    return { ok: false, slug, error: err.message };
  }
  await reviewStore.saveReview(slug, next);
  return { ok: true, slug, status: next.status };
}

async function main() {
  const [, , command, slug, ...rest] = process.argv;
  if (!command || !slug) {
    console.error("使い方: node review-by-slug.js <status|approve|reject> <slug> [--reviewer=NAME] [--comment=\"...\"]");
    process.exitCode = 2;
    return;
  }
  const flags = parseFlags(rest);

  switch (command) {
    case "status": {
      const { report, review } = await loadForSlug(slug);
      printReview(review);
      const { ok, errors, warnings } = validateReview(review);
      console.log(`\nreview 検証: ${ok ? "PASS" : "FAIL"}`);
      errors.forEach((e) => console.log(`  ✗ ${e}`));
      warnings.forEach((w) => console.log(`  ⚠ ${w}`));
      if (report && report.evaluation) {
        const { publishable, reasons } = reviewEngine.isPublishable(review, report.evaluation, report);
        console.log(`\npublishable: ${publishable}`);
        if (!publishable) reasons.forEach((r) => console.log(`  - ${r}`));
      } else {
        console.log("\npublishable: 判定不可（report が無いか evaluation がありません）");
      }
      break;
    }
    case "approve": {
      const result = await approveBySlug(slug, { reviewer: flags.reviewer, comment: flags.comment });
      if (!result.ok) {
        console.error(`承認できませんでした: ${result.error}`);
        process.exitCode = 2;
        return;
      }
      console.log(`承認しました: ${slug}（status: ${result.status}）`);
      break;
    }
    case "reject": {
      const result = await rejectBySlug(slug, { reviewer: flags.reviewer, comment: flags.comment });
      if (!result.ok) {
        console.error(`却下できませんでした: ${result.error}`);
        process.exitCode = 2;
        return;
      }
      console.log(`却下しました: ${slug}（status: ${result.status}）`);
      break;
    }
    default: {
      console.error(`未知のコマンド: ${command}（status|approve|reject）`);
      process.exitCode = 2;
    }
  }
}

if (require.main === module) {
  runCli(async () => main());
}

module.exports = { approveBySlug, rejectBySlug, loadForSlug, parseFlags };
