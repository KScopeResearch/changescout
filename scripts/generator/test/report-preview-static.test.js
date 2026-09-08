/**
 * report-preview-static.test.js — website/aor/report-preview.{html,js} の静的アサーション。
 * ブラウザ実行・jsdom は使わない（aor preview 用の JS テスト基盤が無いため、文言・構造が
 * 存在することを確認する軽量方式）。動的な view model は preview-ui / market-stats のテストで担保。
 *
 * Phase55 STEP3: Conversion 版レイアウト（Hero → Opportunity → Market → Why You →
 * First Action → Evidence → Sources → Review → CTA）の固定。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const js = fs.readFileSync(path.join(WEB, "assets", "js", "report-preview.js"), "utf-8");
const html = fs.readFileSync(path.join(WEB, "report-preview.html"), "utf-8");
const css = fs.readFileSync(path.join(WEB, "assets", "css", "preview-conversion.css"), "utf-8");

/* ---------- HTML: スクリプト・セクション構成 ---------- */

test("report-preview.html: 必要な JS を正しい順で読み込む（guard → stats → ui → illust → common → preview）", () => {
  const order = [
    "assets/js/summary-guard.js",
    "assets/js/market-stats.js",
    "assets/js/preview-ui.js",
    "assets/js/illustrations.js",
    "assets/js/common.js",
    "assets/js/report-preview.js",
  ];
  let last = -1;
  for (const src of order) {
    const idx = html.indexOf(src);
    assert.ok(idx !== -1, `${src} の <script> が無い`);
    assert.ok(idx > last, `${src} の読み込み順が正しくない`);
    last = idx;
  }
});

test("report-preview.html: セクションが「結論 → 根拠」の順に並ぶ（source が opportunity より前に無い）", () => {
  const iHero = html.indexOf('id="report-hero"');
  const iOpp = html.indexOf('id="sec-opportunity"');
  const iMarket = html.indexOf('id="sec-market"');
  const iWhy = html.indexOf('id="sec-whyyou"');
  const iAction = html.indexOf('id="sec-firstaction"');
  const iEvidence = html.indexOf('id="sec-evidence"');
  const iSources = html.indexOf('id="sec-sources"');
  const iCta = html.indexOf('id="sec-cta"');
  [iHero, iOpp, iMarket, iWhy, iAction, iEvidence, iSources, iCta].forEach((v, k) =>
    assert.ok(v !== -1, `セクション ${k} が無い`)
  );
  assert.ok(iHero < iOpp, "Hero は Opportunity より前");
  assert.ok(iOpp < iMarket && iMarket < iWhy && iWhy < iAction, "Opportunity→Market→WhyYou→FirstAction の順");
  assert.ok(iAction < iEvidence && iEvidence < iSources, "First Action → Evidence → Sources の順");
  assert.ok(iOpp < iSources, "Sources は Opportunity より後（結論→根拠）");
  assert.ok(iSources < iCta, "Sources → CTA の順");
});

/* ---------- JS: 描画順・データソース ---------- */

test("report-preview.js: render() が Hero → Opportunity → Market → WhyYou → FirstAction → Evidence → Sources の順で呼ぶ", () => {
  const seq = [
    "renderHero(",
    "renderOpportunity(",
    "renderMarketSection(",
    "renderWhyYou(",
    "renderFirstAction(",
    "renderEvidence(",
    "renderSourcesV2(",
  ];
  let last = -1;
  for (const fn of seq) {
    const idx = js.indexOf(fn);
    assert.ok(idx !== -1, `${fn} の呼び出しが無い`);
    assert.ok(idx > last, `${fn} の順が正しくない`);
    last = idx;
  }
});

test("report-preview.js: business_summary をこのページでは一切描画しない（P0-1 の露出面をなくす）", () => {
  // コメント以外で company_profile.business_summary を参照・描画する箇所が無いこと。
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /business_summary/);
});

test("report-preview.js: summary-guard.js は引き続き読み込む（他ページ・将来のため）", () => {
  assert.match(html, /assets\/js\/summary-guard\.js/);
});

test("report-preview.js: top_sources を優先し、無ければ source_pages を使う", () => {
  assert.match(js, /data\.top_sources[\s\S]{0,80}data\.source_pages/);
});

test("report-preview.js: 隠れた情報源件数を「ほか N 件」として表示する", () => {
  assert.match(js, /hidden_sources_count/);
  assert.match(js, /ほか .*件/);
});

test("report-preview.js: evidence 結合には source_pages 全体を使う（getSourceMap(data.source_pages)）", () => {
  assert.match(js, /getSourceMap\(data\.source_pages\)/);
});

/* ---------- CTA: destination 維持 ---------- */

test("report-preview.js: CTA の href は email-capture.html + 既存クエリ（company/lead/token）を保持する", () => {
  assert.match(js, /email-capture\.html\?/);
  assert.match(js, /params\.set\("company", slug\)/);
  assert.match(js, /getLeadParam\(\)/);
  assert.match(js, /getReportTokenParam\(\)/);
  // 全 CTA は [data-cta] 経由で配線
  assert.match(js, /querySelectorAll\("\[data-cta\]"\)/);
});

test("report-preview.js: CTA 文言はページ内で一貫（ctaText() を共有）", () => {
  assert.match(js, /function ctaText\(\)/);
  const calls = (js.match(/ctaText\(\)/g) || []).length;
  assert.ok(calls >= 3, "ctaText() が複数箇所（Hero 相当・中間・下部）で使われること");
});

/* ---------- 数字の捏造禁止 ---------- */

test("report-preview.js: 市場数値は MarketStats（抽出）に委譲し、preview.js 内でリテラル数値を組み立てない", () => {
  assert.match(js, /PreviewUI\.buildOpportunityViewModel/);
  // preview.js 内に「兆円 / 億円 / %」等のリテラルなダミー数値表現が無い
  assert.doesNotMatch(js, /\d+\s*兆円|\d+\s*億円|\d+(\.\d+)?\s*%[^）】]/);
});

/* ---------- Responsive / a11y ---------- */

test("preview-conversion.css: モバイル breakpoint と reduced-motion 対応がある", () => {
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion/);
});

test("preview-conversion.css: stat-card はモバイルで縦積み（flex-basis 100%）", () => {
  assert.match(css, /@media[\s\S]*?\.stat-card\s*\{[\s\S]*?flex-basis:\s*100%/);
});

test("report-preview.js: illustration は aria-hidden（意味は本文が担う）", () => {
  assert.match(js, /setAttribute\("aria-hidden", "true"\)/);
});
