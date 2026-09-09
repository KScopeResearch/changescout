/**
 * responsive-css.test.js — Phase56 STEP1
 * preview-conversion.css の Responsive / a11y ルールが揃っていることを固定する
 * （実ブラウザ測定は STEP13 の Playwright QA が担う。ここは回帰防止用の静的チェック）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "css", "preview-conversion.css"),
  "utf-8"
);

test("横スクロール防止: body { overflow-x: hidden }", () => {
  assert.match(css, /body\s*\{\s*overflow-x:\s*hidden/);
});

test("長い stat 値の折返し: .stat-card__value に overflow-wrap: anywhere", () => {
  assert.match(css, /\.stat-card__value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
});

test("Benefit カード: デスクトップは 3 カラム、狭い幅で 1 カラム", () => {
  assert.match(css, /\.benefit-cards\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*1fr\)/);
  assert.match(css, /@media[\s\S]*?\.benefit-cards\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("CTA V3: モバイルで全幅（width: 100%）", () => {
  assert.match(css, /@media\s*\(max-width:\s*480px\)[\s\S]*?\.cta-v3__btn\s*\{[\s\S]*?width:\s*100%/);
});

test("480px breakpoint: hero headline / stat-card の縮小がある", () => {
  const mq = css.slice(css.indexOf("@media (max-width: 480px)"));
  assert.match(mq, /\.report-hero__headline\s*\{[\s\S]*?font-size:/);
  assert.match(mq, /\.stat-card\s*\{[\s\S]*?flex-basis:\s*100%/);
});

test("a11y: focus-visible のアウトラインがある", () => {
  assert.match(css, /:focus-visible\s*\{[\s\S]*?outline:/);
});

test("a11y: prefers-reduced-motion で CTA / disclosure のトランジションを切る", () => {
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion"));
  assert.match(rm, /transition:\s*none/);
  assert.match(rm, /\.cta-v3__btn:hover\s*\{\s*transform:\s*none/);
});

test("タイムラインは CSS のみ（SVG を使わない）", () => {
  assert.match(css, /\.market-timeline\s*\{/);
  assert.match(css, /\.market-timeline::before\s*\{/);
});

test("CTA V3 は gradient 背景・arrow を持つ", () => {
  assert.match(css, /\.cta-v3__btn\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.cta-v3__btn-arrow/);
});
