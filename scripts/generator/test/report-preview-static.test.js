/**
 * report-preview-static.test.js — Phase54 STEP1/STEP3: website/aor/assets/js/report-preview.js の
 * 静的アサーション。ブラウザ実行・jsdom は使わない（aor preview 用の JS テスト基盤が無いため、
 * 既存の prompt-rules.test.js と同じ「文言が存在すること」を確認する軽量方式に合わせる）。
 *
 * 固定する仕様（Phase54 RC-4）:
 *   - top_sources があればそれを描画し、無ければ従来どおり source_pages を描画する
 *   - hidden_sources_count > 0 のとき「ほか N 件」を表示する
 *   - evidence 結合には引き続き全 source_pages を使う（renderMainOpportunity は data.free_opportunity / sourceMap）
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "report-preview.js"),
  "utf-8"
);

test("report-preview.js: top_sources があれば優先し、無ければ source_pages を描画する", () => {
  assert.match(src, /data\.top_sources[\s\S]{0,120}data\.source_pages/);
  assert.match(src, /renderSourcePages\(/);
});

test("report-preview.js: hidden_sources_count > 0 のとき「ほか N 件」を表示する", () => {
  assert.match(src, /hidden_sources_count/);
  assert.match(src, /ほか .*件の情報源を参照/);
});

test("report-preview.js: evidence 結合には全 source_pages を使う（getSourceMap(data.source_pages)）", () => {
  assert.match(src, /getSourceMap\(data\.source_pages\)/);
});
