#!/usr/bin/env node
/**
 * check-docs.js — Task22: READMEに書かれた内容が実装と一致しているかの簡易チェック。
 *
 * 【スコープ】本格的なドキュメントリンターではない（過剰実装を避けるため）。
 * 壊れやすく、かつ機械的に検証しやすい2点のみを確認する:
 *   1. コードフェンス内の `node <path>.js` のpathが実際に存在するファイルか
 *   2. Markdown表（`| \`VAR_NAME\` | ... |`）で言及された環境変数名が、
 *      scripts/generator/・website/aor-admin/配下のどこかで`process.env.VAR_NAME`として
 *      実際に参照されているか
 * API仕様の細部・schema説明文・status値等の意味的な正しさは、Task22完了報告の
 * 「README整合性監査結果」で人間（Claude）が個別に確認した結果を参照すること
 * （このスクリプトはあくまで機械的に検出できる範囲の回帰防止用）。
 *
 * 使い方:
 *   node scripts/generator/check-docs.js
 */

const fs = require("fs");
const path = require("path");

const { runCli } = require("./shared/cli-utils"); // Task23: 他CLIとのエラーハンドリング方針統一

const { REPO_ROOT } = require("./shared/paths");

const DOC_FILES = [
  "scripts/generator/README.md",
  "website/aor-admin/README.md",
  "scripts/generator/jobs/README.md",
  "docs/operations-checklist.md",
];

const SOURCE_ROOTS = ["scripts/generator", "website/aor-admin"];
const EXCLUDE_DIR_NAMES = new Set(["node_modules", ".git", "output", "logs", "backup"]);

let cachedSourceText = null;

/** @returns {string} SOURCE_ROOTS配下の全.jsファイルを連結したテキスト */
function collectSourceText() {
  if (cachedSourceText !== null) return cachedSourceText;
  const chunks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".js")) chunks.push(fs.readFileSync(full, "utf-8"));
    }
  };
  SOURCE_ROOTS.forEach((rel) => {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) walk(abs);
  });
  cachedSourceText = chunks.join("\n");
  return cachedSourceText;
}

/** @param {string} content @returns {string[]} 問題点のリスト */
function checkNodeCommandPaths(content) {
  const problems = [];
  const regex = /node ((?:scripts|website)\/[a-zA-Z0-9_\-./]+\.js)/g;
  const seen = new Set();
  let m;
  while ((m = regex.exec(content))) {
    const relPath = m[1];
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    if (!fs.existsSync(path.join(REPO_ROOT, relPath))) {
      problems.push(`  ファイルが存在しません: ${relPath}`);
    }
  }
  return problems;
}

/** @param {string} content @returns {string[]} 問題点のリスト */
function checkEnvVarNames(content) {
  const problems = [];
  // 表の1列目（行頭の `| \`VAR_NAME\` |`）だけを対象にする。値の列（例: `DENY`のような
  // ヘッダー値）まで環境変数として誤検出しないよう、行頭アンカー(^)で1列目に限定する。
  const regex = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/gm;
  const seen = new Set();
  let m;
  while ((m = regex.exec(content))) seen.add(m[1]);

  if (seen.size === 0) return problems;
  const sourceText = collectSourceText();
  for (const name of seen) {
    if (!sourceText.includes(`process.env.${name}`)) {
      problems.push(`  環境変数がコード中に見つかりません: ${name}`);
    }
  }
  return problems;
}

function main() {
  let hasProblem = false;

  for (const rel of DOC_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.log(`[SKIP] ${rel}（ファイルが存在しません）`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf-8");
    const problems = [...checkNodeCommandPaths(content), ...checkEnvVarNames(content)];
    if (problems.length) {
      hasProblem = true;
      console.log(`[NG] ${rel}`);
      problems.forEach((p) => console.log(p));
    } else {
      console.log(`[OK] ${rel}`);
    }
  }

  if (hasProblem) {
    console.log("\nDocs check failed");
    process.exitCode = 1;
  } else {
    console.log("\nDocs check passed");
  }
}

if (require.main === module) {
  runCli(async () => main()); // Task23
}

module.exports = { main, checkNodeCommandPaths, checkEnvVarNames };
