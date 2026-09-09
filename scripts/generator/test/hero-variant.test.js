/**
 * hero-variant.test.js — Phase56 STEP1
 * pickHeroVariant（A=営業提案書 / B=市場インサイト）の自動切替と Hero サブコピー生成。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const P = require(path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "preview-ui.js"));
const { loadReport } = require("./fixtures/aor-reports");

test("pickHeroVariant: 円建ての市場規模・成長が2件以上 → B", () => {
  assert.equal(P.pickHeroVariant(loadReport("ab-i.jp")), "B");
});

test("pickHeroVariant: 数値が乏しい / 米ドル中心 → A", () => {
  assert.equal(P.pickHeroVariant(loadReport("kscope.co.jp")), "A");
  assert.equal(P.pickHeroVariant(loadReport("illegame.com")), "A");
});

test("pickHeroVariant: deterministic（同じ report は同じ variant）", () => {
  const r = loadReport("ab-i.jp");
  assert.equal(P.pickHeroVariant(r), P.pickHeroVariant(r));
});

test("pickHeroVariant: C は返さない（A か B のみ）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    assert.ok(["A", "B"].includes(P.pickHeroVariant(loadReport(s))));
  });
});

test("heroSubcopy: why_company を 1〜2 文へ短縮し src-N を落とす", () => {
  const s = P.heroSubcopy("株式会社Xは、AとBを事業とする（src-3）。独自のCを持つ（src-4）。さらにDもE（src-5）。");
  assert.doesNotMatch(s, /src-\d+/);
  assert.ok(s.length > 0);
  assert.ok(s.split("。").filter(Boolean).length <= 2);
});

test("heroSubcopy: 空・null で空文字（[object Object] 等を出さない）", () => {
  assert.equal(P.heroSubcopy(""), "");
  assert.equal(P.heroSubcopy(null), "");
  assert.equal(P.heroSubcopy(undefined), "");
});

test("heroSubcopy: 3社の実データで空にならない", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = loadReport(s);
    const sub = P.heroSubcopy((r.free_opportunity || {}).why_company);
    assert.ok(sub.length > 10, s);
    assert.doesNotMatch(sub, /undefined|null|\[object Object\]/);
  });
});
