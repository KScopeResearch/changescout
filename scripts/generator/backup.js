#!/usr/bin/env node
/**
 * backup.js — Task22: AOR運用データのバックアップ取得CLI。
 *
 * Node.js標準の`fs`のみでディレクトリコピーを行う（npm依存・外部コマンド呼び出しなし。
 * zip圧縮等は行わず、単純なディレクトリコピー＋タイムスタンプ付きディレクトリ名とする）。
 *
 * バックアップ対象:
 *   必須（欠けているとエラーで停止）: scripts/generator/output/, scripts/generator/logs/
 *   推奨（存在しなければ警告のみでスキップ）: website/aor-admin/, website/aor/data/,
 *     docs/, .github/workflows/
 *   対象外: node_modules/, .git/（コピー中に見つかっても再帰しない）
 *
 * 【Task25で追加】website/aor/data/には、公開機能（publish-report.js、Task24）が
 * 書き込む先であるにも関わらず、それまでバックアップ対象に含まれていなかった
 * （手動サンプルデータcompany-01〜03を含め、他に一切バックアップ手段がない）。
 * 本番公開前の最終監査で発見し、対象に追加した。
 *
 * 出力先: <repo root>/backup/<YYYY-MM-DD_HHMMSS>/<label>/
 *   （backup/自体は既存データを一切上書きしない。実行のたび新しいタイムスタンプ
 *   ディレクトリを作るため、過去のバックアップは常に残る）
 *
 * secret値（APIキー等）を含みうるファイルの中身自体はログへ出力しない。
 * コピー処理のログには対象ラベル・ファイル数のみを記録する。
 *
 * 使い方:
 *   node scripts/generator/backup.js
 *
 * リストア手順はscripts/generator/README.md「バックアップ・リストア」参照。
 */

const fs = require("fs");
const path = require("path");

const { REPO_ROOT } = require("./shared/paths");
const { createLogger } = require("./shared/logger");
const { runCli } = require("./shared/cli-utils");

const logger = createLogger("backup");

const BACKUP_ROOT = path.join(REPO_ROOT, "backup");

// コピー時に再帰しないディレクトリ名（対象ディレクトリ配下に紛れ込んでいた場合の保険。
// 現状のバックアップ対象にはいずれも存在しないが、将来の事故防止のため明示的に除外する）。
const EXCLUDE_DIR_NAMES = new Set(["node_modules", ".git"]);

const TARGETS = [
  { label: "output", src: path.join(REPO_ROOT, "scripts", "generator", "output"), required: true },
  { label: "logs", src: path.join(REPO_ROOT, "scripts", "generator", "logs"), required: true },
  { label: "aor-admin", src: path.join(REPO_ROOT, "website", "aor-admin"), required: false },
  { label: "aor-data", src: path.join(REPO_ROOT, "website", "aor", "data"), required: false }, // Task25
  { label: "docs", src: path.join(REPO_ROOT, "docs"), required: false },
  { label: "github-workflows", src: path.join(REPO_ROOT, ".github", "workflows"), required: false },
];

/** @param {Date} [date] @returns {string} 例: 2026-08-07_010000 */
function timestampDirName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * srcディレクトリの内容をdestへ再帰的にコピーする（コピー元は一切変更しない）。
 * @param {string} src
 * @param {string} dest
 * @returns {number} コピーしたファイル数
 */
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  let fileCount = 0;
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fileCount += copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      fileCount += 1;
    }
  }
  return fileCount;
}

/**
 * バックアップを1回実行する。
 * @returns {{backupDir:string, results:Array<{label:string, ok:boolean, fileCount:number, skipped:boolean}>}}
 */
function runBackup() {
  const backupDir = path.join(BACKUP_ROOT, timestampDirName());
  logger.info(`バックアップを開始します: ${backupDir}`);

  const results = [];
  for (const target of TARGETS) {
    if (!fs.existsSync(target.src)) {
      if (target.required) {
        throw new Error(`必須バックアップ対象が見つかりません（${target.label}）: ${target.src}`);
      }
      logger.warn(`対象ディレクトリが存在しないためスキップします（${target.label}）: ${target.src}`);
      results.push({ label: target.label, ok: false, fileCount: 0, skipped: true });
      continue;
    }

    try {
      const fileCount = copyDirRecursive(target.src, path.join(backupDir, target.label));
      results.push({ label: target.label, ok: true, fileCount, skipped: false });
      logger.info(`  ${target.label}: ${fileCount}ファイルをコピーしました`);
    } catch (err) {
      // コピー失敗時は途中状態のbackupDirを残したまま明確なエラーで停止する
      // （何が失敗したか分かるよう、原因ディレクトリ名をエラーメッセージに含める）。
      throw new Error(`バックアップに失敗しました（${target.label}）: ${err.message}`);
    }
  }

  return { backupDir, results };
}

function main() {
  const { backupDir, results } = runBackup();
  console.log(`\nバックアップ完了: ${backupDir}`);
  results.forEach((r) => {
    console.log(`  - ${r.label}: ${r.skipped ? "スキップ（対象ディレクトリなし）" : `${r.fileCount}ファイル`}`);
  });
}

if (require.main === module) {
  runCli(async () => main());
}

module.exports = { runBackup, copyDirRecursive, timestampDirName, TARGETS, BACKUP_ROOT };
