/**
 * market-snapshot.test.js — Phase56 STEP1
 * Market Snapshot（数字カード / 比較バー / タイムライン用の年）の view model。
 * 数字は抽出のみ（捏造・丸め禁止）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const P = require(path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "preview-ui.js"));
const { loadReport } = require("./fixtures/aor-reports");

test("marketSnapshot: 3社で必須フィールドが揃う", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const snap = P.marketSnapshot(loadReport(s));
    assert.ok(Array.isArray(snap.stats), s + " stats");
    assert.equal(typeof snap.hasComparison, "boolean");
    assert.ok(Array.isArray(snap.years), s + " years");
    snap.stats.forEach((n) => {
      assert.ok(typeof n.value === "string" && n.value.length > 0);
    });
  });
});

test("marketSnapshot: ab-i は比較バー（約N倍）あり・years は昇順ユニーク最大4件", () => {
  const snap = P.marketSnapshot(loadReport("ab-i.jp"));
  assert.equal(snap.hasComparison, true);
  assert.ok(snap.multiple && /倍/.test(snap.multiple.value));
  const sorted = snap.years.slice().sort();
  assert.deepEqual(snap.years, sorted);
  assert.ok(snap.years.length <= 4);
  assert.equal(new Set(snap.years).size, snap.years.length);
});

test("marketSnapshot: 数字ゼロの report は stats 空・years 空（何も作らない）", () => {
  const snap = P.marketSnapshot({
    free_opportunity: { why_now: "変化が起きています。", market_change: "動きがあります。" },
  });
  assert.deepEqual(snap.stats, []);
  assert.deepEqual(snap.years, []);
  assert.equal(snap.hasComparison, false);
});

test("marketSnapshot: illegame は米ドル巨大値も value として拾う（Preview は表示する。Email teaser 側で除外）", () => {
  const snap = P.marketSnapshot(loadReport("illegame.com"));
  assert.ok(snap.stats.length > 0);
});

test("marketSnapshot: deterministic", () => {
  const r = loadReport("kscope.co.jp");
  assert.deepEqual(P.marketSnapshot(r), P.marketSnapshot(r));
});

test("marketSnapshot: years は「2024年」「2033年まで」等から数字4桁のみを取り出す", () => {
  const snap = P.marketSnapshot({
    free_opportunity: {
      why_now: "2024年に過去最高を記録し、2033年までに拡大する見込み（src-1）。",
      market_change: "2026年度に制度が創設された。",
    },
  });
  snap.years.forEach((y) => assert.match(y, /^(19|20)\d{2}$/));
  assert.ok(snap.years.includes("2024"));
});
