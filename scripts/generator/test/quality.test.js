/**
 * quality.test.js — Task18: quality-evaluator.js（evaluateReportQuality）の自動テスト。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { evaluateReportQuality, gradeFromScore, statusFromScore } = require("../quality-evaluator");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR } = require("../shared/paths");

test("good.jsonはPASS/grade A相当のスコアになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "PASS");
  assert.equal(evaluation.grade, "A");
  assert.ok(evaluation.score >= 90);
});

test("average.jsonはREVIEWになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "average.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "REVIEW");
});

test("bad.jsonはFAILになる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "bad.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "FAIL");
  assert.ok(evaluation.score <= 49);
});

test("breakdownの各項目points合計がscoreと一致する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  const sum = Object.values(evaluation.breakdown).reduce((acc, item) => acc + item.points, 0);
  assert.equal(sum, evaluation.score);
});

test("gradeFromScore: 境界値が仕様どおりマッピングされる", () => {
  assert.equal(gradeFromScore(100), "A");
  assert.equal(gradeFromScore(90), "A");
  assert.equal(gradeFromScore(89), "B");
  assert.equal(gradeFromScore(80), "B");
  assert.equal(gradeFromScore(79), "C");
  assert.equal(gradeFromScore(70), "C");
  assert.equal(gradeFromScore(69), "D");
  assert.equal(gradeFromScore(0), "D");
});

test("statusFromScore: 境界値が仕様どおりマッピングされる", () => {
  assert.equal(statusFromScore(100), "PASS");
  assert.equal(statusFromScore(80), "PASS");
  assert.equal(statusFromScore(79), "REVIEW");
  assert.equal(statusFromScore(50), "REVIEW");
  assert.equal(statusFromScore(49), "FAIL");
  assert.equal(statusFromScore(0), "FAIL");
});

test("human_review.statusがapprovedなら該当breakdown項目が満点になる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.breakdown.human_review_status.points, evaluation.breakdown.human_review_status.max);
});

test("情報源が0件の場合でも例外を投げずに低スコアを返す", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "bad.json"));
  report.source_pages = [];
  const evaluation = evaluateReportQuality(report);
  assert.equal(evaluation.status, "FAIL");
  assert.ok(evaluation.score >= 0);
});
