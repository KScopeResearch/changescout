/**
 * hero-layout.test.js — Phase56 STEP1
 * Hero V3 の DOM 構造・順序（First View に何が載るか）を静的に固定する。
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

test("Hero: renderHero 内で eyebrow → 宛名 → h1 headline → subcopy → pill → badges → inline CTA → illust の順に append", () => {
  const body = js.slice(js.indexOf("function renderHero("), js.indexOf("function renderBenefits("));
  const order = [
    "report-hero__eyebrow",
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

test("Hero: 確認済みバッジは position:absolute で右上（CSS）", () => {
  assert.match(css, /\.hero-review-badge\s*\{[\s\S]*?position:\s*absolute[\s\S]*?right:/);
});

test("Hero: 大型イラストは max-width で伸びすぎない・width:100% で縮む（CSS）", () => {
  assert.match(css, /\.hero-illust\s*\{[\s\S]*?max-width:/);
  assert.match(css, /\.hero-illust__svg\s*\{[\s\S]*?width:\s*100%/);
});

test("Hero: eyebrow に「AI Opportunity Report」「無料レポート」、pill に「無料版」が出る", () => {
  assert.match(js, /AI Opportunity Report/);
  assert.match(js, /無料レポート/);
  assert.match(js, /"AI Opportunity", "Priority", "無料版"/);
});

test("Hero: 宛名は「<会社名> 様へ」（company_profile.name のみ・business_summary は使わない）", () => {
  assert.match(js, /\$\{cp\.name \|\| ""\} 様へ/);
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /business_summary/);
});
