#!/usr/bin/env node
/**
 * review-cli.js
 *
 * Task13: review-engine.js（Pure Functionのコアロジック）に対するCLIフロントエンド。
 * review.jsonのI/O（読み込み・保存）とコマンドライン引数の解釈のみをここで行い、
 * 状態遷移そのもののロジックはすべてreview-engine.jsのPure Functionに委譲する。
 *
 * 使い方:
 *   node scripts/generator/review/review-cli.js approve  <report.jsonのパス> --reviewer=NAME [--comment="..."]
 *   node scripts/generator/review/review-cli.js reject   <report.jsonのパス> --reviewer=NAME [--comment="..."]
 *   node scripts/generator/review/review-cli.js revise   <report.jsonのパス> --reviewer=NAME [--comment="..."] [--fix="..." ...]
 *   node scripts/generator/review/review-cli.js comment  <report.jsonのパス> --actor=NAME --text="..."
 *   node scripts/generator/review/review-cli.js fix      <report.jsonのパス> --actor=NAME --description="..."
 *   node scripts/generator/review/review-cli.js history  <report.jsonのパス>
 *   node scripts/generator/review/review-cli.js status   <report.jsonのパス>
 *
 * review.jsonは <report.jsonと同じディレクトリ>/review.json に保存する
 * （scripts/generator/output/<slug>/report.json → scripts/generator/output/<slug>/review.json）。
 */

const fs = require("fs");
const path = require("path");

const engine = require("./review-engine");
const { validateReview } = require("../validate-report");
const { runCli } = require("../shared/cli-utils"); // Task23: 他CLIとのエラーハンドリング方針統一

/**
 * `--key=value`形式の引数を解釈する。
 * @param {string[]} argv
 * @returns {Object}
 */
function parseFlags(argv) {
  const flags = {};
  argv.forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (match) {
      const [, key, value] = match;
      // --fix は複数回指定できるようにする（配列化）
      if (key === "fix") {
        flags.fix = flags.fix || [];
        flags.fix.push(value);
      } else {
        flags[key] = value;
      }
    }
  });
  return flags;
}

/**
 * report.jsonのパスから、対応するreview.jsonのパスを導出する。
 * @param {string} reportPath
 * @returns {string}
 */
function reviewPathFor(reportPath) {
  return path.join(path.dirname(reportPath), "review.json");
}

/**
 * @param {string} reportPath
 * @returns {Object|null} report.jsonの内容。読めない場合はnull
 */
function tryReadReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
  } catch (e) {
    return null;
  }
}

function printReview(review) {
  console.log(`status: ${review.status}`);
  console.log(`reviewer: ${review.reviewer || "（未設定）"}`);
  console.log(`reviewed_at: ${review.reviewed_at || "（未設定）"}`);
  console.log(`comments: ${review.comments.length}件 / fixes: ${review.fixes.length}件 / history: ${review.history.length}件`);
}

function main() {
  const [, , command, reportPath, ...rest] = process.argv;

  if (!command || !reportPath) {
    console.error(
      "使い方: node review-cli.js <approve|reject|revise|comment|fix|history|status> <report.jsonのパス> [オプション]"
    );
    process.exitCode = 2;
    return;
  }

  if (!fs.existsSync(reportPath)) {
    console.error(`report.jsonが見つかりません: ${reportPath}`);
    process.exitCode = 2;
    return;
  }

  const flags = parseFlags(rest);
  const report = tryReadReport(reportPath);
  const reviewPath = reviewPathFor(reportPath);
  const review = engine.loadReview(reviewPath, report && report.id);

  switch (command) {
    case "approve": {
      if (!flags.reviewer) {
        console.error("approveには --reviewer=NAME が必須です");
        process.exitCode = 2;
        return;
      }
      const next = engine.approve(review, { reviewer: flags.reviewer, comment: flags.comment });
      engine.saveReview(reviewPath, next);
      console.log(`承認しました: ${reviewPath}`);
      printReview(next);
      break;
    }
    case "reject": {
      if (!flags.reviewer) {
        console.error("rejectには --reviewer=NAME が必須です");
        process.exitCode = 2;
        return;
      }
      const next = engine.reject(review, { reviewer: flags.reviewer, comment: flags.comment });
      engine.saveReview(reviewPath, next);
      console.log(`却下しました: ${reviewPath}`);
      printReview(next);
      break;
    }
    case "revise": {
      if (!flags.reviewer) {
        console.error("reviseには --reviewer=NAME が必須です");
        process.exitCode = 2;
        return;
      }
      const next = engine.requestRevision(review, {
        reviewer: flags.reviewer,
        comment: flags.comment,
        fixes: flags.fix,
      });
      engine.saveReview(reviewPath, next);
      console.log(`差し戻しました: ${reviewPath}`);
      printReview(next);
      break;
    }
    case "comment": {
      if (!flags.actor || !flags.text) {
        console.error("commentには --actor=NAME --text=\"...\" が必須です");
        process.exitCode = 2;
        return;
      }
      const next = engine.addComment(review, { actor: flags.actor, text: flags.text });
      engine.saveReview(reviewPath, next);
      console.log(`コメントを追加しました: ${reviewPath}`);
      printReview(next);
      break;
    }
    case "fix": {
      if (!flags.actor || !flags.description) {
        console.error("fixには --actor=NAME --description=\"...\" が必須です");
        process.exitCode = 2;
        return;
      }
      const next = engine.addFix(review, { actor: flags.actor, description: flags.description });
      engine.saveReview(reviewPath, next);
      console.log(`修正指示を追加しました: ${reviewPath}`);
      printReview(next);
      break;
    }
    case "history": {
      const history = engine.getHistory(review);
      console.log(`history: ${history.length}件`);
      history.forEach((h, i) => {
        console.log(`  [${i}] ${h.at} ${h.actor} ${h.action}${h.from_status ? ` (${h.from_status} → ${h.to_status})` : ""}${h.comment ? ` — ${h.comment}` : ""}`);
      });
      break;
    }
    case "status": {
      printReview(review);
      const { ok, errors, warnings } = validateReview(review);
      console.log(`\nreview.json検証: ${ok ? "PASS" : "FAIL"}`);
      errors.forEach((e) => console.log(`  ✗ ${e}`));
      warnings.forEach((w) => console.log(`  ⚠ ${w}`));

      if (report && report.evaluation) {
        const { publishable, reasons } = engine.isPublishable(review, report.evaluation, report);
        console.log(`\npublishable: ${publishable}`);
        if (!publishable) reasons.forEach((r) => console.log(`  - ${r}`));
      } else {
        console.log("\npublishable: 判定不可（report.jsonにevaluationがありません）");
      }
      break;
    }
    default: {
      console.error(`未知のコマンド: ${command}`);
      console.error("使い方: approve|reject|revise|comment|fix|history|status");
      process.exitCode = 2;
      return;
    }
  }
}

// Task23: 従来はtry/catchなしで直接main()を呼んでいたため、予期しない例外がフォーマットされない
// 生のスタックトレースとしてstderrに出ていた（review-engine.jsの検証エラー等、想定内のものは
// main()内のswitchで個別にexitCode=2を返しているため影響なし）。runCli()を通すことで、
// 想定外の例外も「致命的エラー: ...」という統一フォーマット・exitCode=1で扱われるようにした。
runCli(async () => main());
