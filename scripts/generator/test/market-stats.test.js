/**
 * market-stats.test.js — Phase55 STEP3
 * website/aor/assets/js/market-stats.js の extractMarketNumbers() を検証する。
 * 【最重要】テキストに無い数字を作らない・丸めない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { extractMarketNumbers, countMarketMomentum } = require(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "market-stats.js")
);
const vals = (arr) => arr.map((n) => n.value);

test("金額（兆・億の複合、円・米ドル）を抽出する", () => {
  const r = extractMarketNumbers(
    "アニメ市場全体は2024年に3兆8,407億円と過去最高を記録し、海外売上は2兆1,702億円で全体の56%を占める。",
    { max: 10, maxPerKind: 10 }
  );
  assert.ok(vals(r).includes("3兆8,407億円"), JSON.stringify(vals(r)));
  assert.ok(vals(r).includes("2兆1,702億円"));
});

test("小数入りの金額（2.17兆円）を抽出する", () => {
  const r = extractMarketNumbers("2024年の海外市場規模2.17兆円の約3倍を目指しています", { max: 10, maxPerKind: 10 });
  assert.ok(vals(r).includes("2.17兆円"), JSON.stringify(vals(r)));
  assert.ok(vals(r).includes("約3倍"));
});

test("パーセントと『割』を抽出する", () => {
  const r = extractMarketNumbers("成功企業は全体の2割程度で、海外売上は前年比26%増と2桁成長。", { max: 10, maxPerKind: 10 });
  assert.ok(vals(r).includes("2割"), JSON.stringify(vals(r)));
  assert.ok(vals(r).includes("26%"));
});

test("CAGR を抽出する", () => {
  const r = extractMarketNumbers("サービス市場は CAGR8.0% で成長しています。", { max: 10, maxPerKind: 10 });
  assert.ok(vals(r).some((v) => /CAGR\s*8\.0\s*%/.test(v)), JSON.stringify(vals(r)));
});

test("数字が無いテキストからは何も返さない（捏造しない）", () => {
  assert.deepEqual(extractMarketNumbers("市場では新しい動きが広がっています。具体的な統計は確認できませんでした。"), []);
  assert.deepEqual(extractMarketNumbers(""), []);
  assert.deepEqual(extractMarketNumbers(null), []);
});

test("素の『年』は既定で stat に含めない（milestone は含める）", () => {
  const bare = extractMarketNumbers("2024年に発表されました。", { max: 10, maxPerKind: 10 });
  assert.deepEqual(bare, []);
  const milestone = extractMarketNumbers("補助金は2026年度に創設されました。", { max: 10, maxPerKind: 10 });
  assert.ok(milestone.some((n) => n.kind === "milestone"), JSON.stringify(milestone));
});

test("同じ数字は重複させない", () => {
  const r = extractMarketNumbers("6兆円へ拡大する目標。海外アニメ市場を6兆円へ。", { max: 10, maxPerKind: 10 });
  assert.equal(vals(r).filter((v) => v === "6兆円").length, 1);
});

test("同一 kind は maxPerKind 件まで（数字が並んで見飽きるのを防ぐ）", () => {
  const r = extractMarketNumbers(
    "1兆円市場、2兆円市場、3兆円市場、4兆円市場、5兆円市場が並ぶ。",
    { max: 10, maxPerKind: 2 }
  );
  assert.ok(r.filter((n) => n.kind === "size" || n.kind === "money").length <= 2, JSON.stringify(vals(r)));
});

test("上限 max を超えて返さない", () => {
  const r = extractMarketNumbers("6兆円、26%、CAGR8%、約3倍、2割、8割が登場する。", { max: 3 });
  assert.ok(r.length <= 3);
});

test("src-N が近くにあれば sourceId に拾う", () => {
  const r = extractMarketNumbers("海外アニメ市場を約6兆円へ拡大する目標（src-20）。", { max: 5, maxPerKind: 5 });
  const six = r.find((n) => n.value === "約6兆円");
  assert.ok(six);
  assert.equal(six.sourceId, "src-20");
});

test("size / growth / multiple / cagr を momentum としてカウントする", () => {
  const r = extractMarketNumbers("海外市場規模は6兆円、前年比26%増、約3倍、CAGR8%。", { max: 10, maxPerKind: 10 });
  assert.ok(countMarketMomentum(r) >= 3, JSON.stringify(r));
});

test("配列入力を結合して抽出する", () => {
  const r = extractMarketNumbers(["市場は6兆円。", null, "成長率は26%。"], { max: 10, maxPerKind: 10 });
  assert.ok(vals(r).includes("6兆円"));
  assert.ok(vals(r).includes("26%"));
});

test("ラベルに数値断片（9,000億 等）を採用しない", () => {
  const r = extractMarketNumbers("17兆3,777億9,000万米ドルから18兆7,758億5,000万米ドルへ成長。", { max: 10, maxPerKind: 10 });
  r.forEach((n) => assert.doesNotMatch(n.label, /\d{3,}|億|万|米ドル/));
});
