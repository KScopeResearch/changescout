/**
 * paths.js
 *
 * Task18: scripts/generator/配下の主要ディレクトリを一箇所で定義する。
 *
 * 【発見した問題】リファクタリング前は、OUTPUT_DIR/LOGS_DIR/PROMPTS_DIRが
 * generate-company-report.js・job-engine.js・job-runner.js・llm-client.js・
 * search-client.js等、複数ファイルでそれぞれ独立に`path.join(__dirname, "..")`等で
 * 再計算されていた（`__dirname`からの相対階層数がファイルごとに異なるため、
 * 同じ絶対パスに解決されているかはコードを読まないと分からず、将来ファイルを移動した際に
 * 静かに壊れるリスクがあった）。本モジュールに一本化する。
 */

const path = require("path");

const GENERATOR_DIR = path.join(__dirname, ".."); // scripts/generator/
const REPO_ROOT = path.join(GENERATOR_DIR, "..", ".."); // Task22: backup.js等、scripts/generator外も扱うスクリプト向け
const OUTPUT_DIR = path.join(GENERATOR_DIR, "output");
const LOGS_DIR = path.join(GENERATOR_DIR, "logs");
const PROMPTS_DIR = path.join(GENERATOR_DIR, "prompts");
const REVIEW_FIXTURES_DIR = path.join(GENERATOR_DIR, "review", "fixtures");
const REPORT_FIXTURES_DIR = path.join(GENERATOR_DIR, "fixtures");

module.exports = {
  GENERATOR_DIR,
  REPO_ROOT,
  OUTPUT_DIR,
  LOGS_DIR,
  PROMPTS_DIR,
  REVIEW_FIXTURES_DIR,
  REPORT_FIXTURES_DIR,
};
