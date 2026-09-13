/**
 * hero-layout.test.js — Phase56 STEP1 / Phase66 STEP2
 * Hero の DOM 構造・順序（First View に何が載るか）を静的に固定する。
 * jsdom は使わず、report-preview.js / html / css の文字列アサーション。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const js = fs.readFileSync(path.join(WEB, "assets", "js", "report-preview.js"), "utf-8");
const html = fs.readFileSync(path.join(WEB, "report-preview.html"), "utf-8");
const css = fs.readFileSync(path.join(WEB, "assets", "css", "preview-conversion.css"), "utf-8");

test("Hero: header#report-hero がページ最上部（<main> より前）", () => {
  const iHero = html.indexOf('id="report-hero"');
  const iMain = html.indexOf("<main>");
  assert.ok(iHero !== -1 && iMain !== -1 && iHero < iMain);
});

test("Hero: renderHero 内で ブランド行 → 宛名 → h1 headline → subcopy → pill → badges → inline CTA → illust の順に append", () => {
  const body = js.slice(js.indexOf("function renderHero("), js.indexOf("function renderMetrics("));
  const order = [
    "report-hero__brand",
    "report-hero__company",
    'createElement("h1")',
    "report-hero__sub",
    "report-hero__pill",
    "report-hero__badges",
    "hero-cta-inline",
    "Illustrations.hero(theme)",
  ];
  let last = -1;
  for (const token of order) {
    const idx = body.indexOf(token);
    assert.ok(idx !== -1, `renderHero に ${token} が無い`);
    assert.ok(idx > last, `renderHero の ${token} の順が正しくない`);
    last = idx;
  }
});

test("Hero: メインキャッチは h1（ページで最大の見出し。Opportunity/Market の見出しは h2）", () => {
  assert.match(js, /createElement\("h1"\)/);
  // secHead は h2
  assert.match(js, /function secHead[\s\S]*?createElement\("h2"\)/);
  // h1 は1つだけ（Hero）
  assert.equal((js.match(/createElement\("h1"\)/g) || []).length, 1);
});

test("Hero: 専門家監修バッジは position:absolute で右上（CSS）", () => {
  assert.match(css, /\.hero-review-badge\s*\{[\s\S]*?position:\s*absolute[\s\S]*?right:/);
});

test("Hero: 大型イラストは max-width で伸びすぎない・width:100% で縮む（CSS）", () => {
  assert.match(css, /\.hero-illust\s*\{[\s\S]*?max-width:/);
  assert.match(css, /\.hero-illust__svg\s*\{[\s\S]*?width:\s*100%/);
});

test("Hero: AOR ブランド行に『BUSINESS OPPORTUNITY REPORT』、pill に「無料」が出る", () => {
  assert.match(js, /report-hero__brand-mark/);
  assert.match(js, /BUSINESS OPPORTUNITY REPORT/);
  assert.match(js, /"無料", "御社専用分析"/);
  // 表示コピーに旧「AI Opportunity Report」語（英語ブランド名の旧表記）が出ない
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /"AI Opportunity Report"/);
  assert.doesNotMatch(codeOnly, /"AI Opportunity"/);
});

test("Hero: 宛名は company_profile.name ベース（PreviewUI.salutation）・business_summary は使わない", () => {
  assert.match(js, /PreviewUI\.salutation\(cp\.name\)/);
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /business_summary/);
});

test("Hero: 専門家監修の文言は Hero・Trust・下部CTAで統一され、旧『人間による確認済み/運営確認済み』は残らない", () => {
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /人間による確認済み/);
  assert.doesNotMatch(codeOnly, /運営確認済み/);
  assert.doesNotMatch(codeOnly, /運営が内容を確認済み/);
});
