/**
 * aor-reports.js — Phase55 テスト用の published レポート fixture ローダー
 *
 * Preview / Email teaser のテストは、以前は website/aor/data/<slug>.json を直接読んでいた。
 * それらの実顧客レポート JSON は git 管理外なので、CI（クリーンチェックアウト）では
 * ファイルが存在せず ENOENT でテストが落ちていた（PR #49 の Quality Check 失敗）。
 *
 * ここでは同じ 3 社の published レポートのスナップショットを fixtures/aor/ に固定し、
 * それを読む。illegame.com の company_profile.business_summary は P0-1 の壊れた生ダンプ
 * （第三者の代表者名・住所・資本金を含む）なので、構造（Markdown テーブル + 会社概要項目の
 * 羅列 = summary-guard が unusable と判定する形）は保ったまま個人情報部分だけダミーに
 * 置換してある。business_summary はどの描画経路でも出力されないので、テストの意味は変わらない。
 */

const fs = require("fs");
const path = require("path");

const FIXTURE_DIR = path.join(__dirname, "aor");
const SLUGS = ["kscope.co.jp", "ab-i.jp", "illegame.com"];

function loadReport(slug) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, slug + ".json"), "utf-8"));
}

module.exports = { loadReport, FIXTURE_DIR, SLUGS };
