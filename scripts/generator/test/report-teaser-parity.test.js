/**
 * report-teaser-parity.test.js — Phase55 STEP4
 *
 * メール送信側（Lambda bundle は website/ を含まない）は
 * scripts/generator/shared/{market-numbers,report-teaser}.js を使い、
 * Preview 側は website/aor/assets/js/{market-stats,preview-ui}.js を使う。
 * 両者の共通ロジックが一致していることを保証する（片方だけ変更したら失敗する）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js");
const SH = path.join(__dirname, "..", "shared");

const webStats = require(path.join(WEB, "market-stats.js"));
const shStats = require(path.join(SH, "market-numbers.js"));
const webUI = require(path.join(WEB, "preview-ui.js"));
const shTeaser = require(path.join(SH, "report-teaser.js"));

const { loadReport, SLUGS } = require("./fixtures/aor-reports");
const loadIf = (s) => loadReport(s);

const CASES = [
  "アニメ市場全体は2024年に3兆8,407億円と過去最高を記録し、海外売上は前年比26%増と2桁成長が続いています（src-20）。",
  "サービス市場は2025年の17兆3,777億9,000万米ドルから2026年には18兆7,758億5,000万米ドルへとCAGR8.0%で成長。",
  "成功企業は全体の2割程度で、8割の企業が成功に至っていません。約3倍を目指します。",
  "補助金は2026年度に創設されました。具体的な統計は確認できませんでした。",
  "",
];

test("extractMarketNumbers: shared/market-numbers.js == website/market-stats.js（固定ケース）", () => {
  CASES.forEach((c, i) => {
    assert.deepEqual(
      shStats.extractMarketNumbers(c, { max: 10, maxPerKind: 10 }),
      webStats.extractMarketNumbers(c, { max: 10, maxPerKind: 10 }),
      "case " + i
    );
  });
});

test("extractMarketNumbers: 実データ3社（+example.com）で完全一致", () => {
  SLUGS.forEach((s) => {
    const r = loadIf(s);
    if (!r || !r.free_opportunity) return;
    const fo = r.free_opportunity;
    const ea = fo.extended_analysis || {};
    const input = [fo.why_now, fo.market_change, ea.market_size];
    assert.deepEqual(shStats.extractMarketNumbers(input), webStats.extractMarketNumbers(input), s);
  });
});

test("pickVisualTheme: report-teaser.js == preview-ui.js（実データ3社）", () => {
  SLUGS.forEach((s) => {
    const r = loadIf(s);
    if (!r) return;
    assert.equal(shTeaser.pickVisualTheme(r), webUI.pickVisualTheme(r), s);
  });
});

test("pickHeroVariant: report-teaser.js == preview-ui.js（実データ3社）", () => {
  SLUGS.forEach((s) => {
    const r = loadIf(s);
    if (!r || !r.free_opportunity) return;
    assert.equal(shTeaser.pickHeroVariant(r), webUI.pickHeroVariant(r), s);
  });
});

test("humanReviewLine: report-teaser.js == preview-ui.js", () => {
  [
    { human_review: { status: "approved", reviewed_at: "2026-09-08T06:32:11.541Z" } },
    { human_review: { status: "pending_review" } },
    { human_review: { status: "approved" } },
    {},
  ].forEach((r, i) => {
    assert.deepEqual(shTeaser.humanReviewLine(r), webUI.humanReviewLine(r), "case " + i);
  });
});

test("KNOWN_THEMES が一致（テーマ集合のずれを検知）", () => {
  assert.deepEqual(shTeaser.KNOWN_THEMES.slice().sort(), webUI.KNOWN_THEMES.slice().sort());
});
