/**
 * visual-theme.test.js — Phase55 STEP3
 * pickVisualTheme（preview-ui.js）と illustrations.js の対応・deterministic 性を検証する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const JS = path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js");
const P = require(path.join(JS, "preview-ui.js"));
const I = require(path.join(JS, "illustrations.js"));
const { loadReport: load } = require("./fixtures/aor-reports");

test("pickVisualTheme が返す全テーマに illustrations のグリフが存在する", () => {
  P.KNOWN_THEMES.forEach((theme) => {
    const g = I.glyph(theme);
    assert.match(g, /^<svg[\s\S]*<\/svg>$/, `theme=${theme} のグリフが SVG でない`);
  });
});

test("hero illustration は全テーマで整形式の SVG を返す", () => {
  P.KNOWN_THEMES.forEach((theme) => {
    const h = I.hero(theme);
    assert.ok(h.startsWith("<svg"), theme);
    assert.ok(h.trim().endsWith("</svg>"), theme);
    assert.match(h, /aria-hidden="true"/);
  });
});

test("未知テーマは generic_insight にフォールバックする（例外を投げない）", () => {
  assert.doesNotThrow(() => I.glyph("no-such-theme"));
  assert.doesNotThrow(() => I.hero("no-such-theme"));
  assert.ok(I.glyph("no-such-theme").length > 40);
});

test("3社の実データ: theme は KNOWN_THEMES 内・毎回同じ", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = load(s);
    const a = P.pickVisualTheme(r);
    const b = P.pickVisualTheme(r);
    assert.equal(a, b, s + " deterministic");
    assert.ok(P.KNOWN_THEMES.includes(a), s + " -> " + a);
  });
});

test("theme 判定は title を industry より優先する", () => {
  const r = {
    company_profile: { industry_label: "飲食業" },
    free_opportunity: { title: "海外市場向けブランド展開の立ち上げ", market_change: "" },
  };
  assert.equal(P.pickVisualTheme(r), "overseas");
});

test("illustrations.steps: 1〜3 に丸め、整形式の SVG を返す", () => {
  [0, 1, 2, 3, 5].forEach((n) => {
    const s = I.steps(n);
    assert.ok(s.startsWith("<svg") && s.trim().endsWith("</svg>"), "n=" + n);
  });
});
