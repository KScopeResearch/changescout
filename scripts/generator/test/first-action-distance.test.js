/**
 * first-action-distance.test.js — Phase56 STEP5
 * RULE-THEME-12（Tomorrow Morning Test — first_action は 30 分以内で着手できるか）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { passesTomorrowMorningTest } = require("../shared/business-chance-ranking");

const PASS = [
  "Google の口コミ20件を確認する。",
  "既存顧客10社にヒアリングする。",
  "LINE予約の導線を1本追加する。",
  "Instagram のプロフィールを変更する。",
  "補助金対象設備を1社に問い合わせる。",
  "POSデータを確認する。",
  "既存の飲食店クライアント3社にヒアリングを実施し、課題を洗い出す。",
];

const FAIL = [
  "DXを検討する。",
  "AI導入を検討する。",
  "市場調査を継続する。",
  "体制を強化する。",
  "新規事業の立ち上げを推進する。",
  "全社的なデジタル化に取り組む。",
];

test("passesTomorrowMorningTest: 具体的な30分アクションは PASS", () => {
  PASS.forEach((a) => assert.equal(passesTomorrowMorningTest(a), true, a));
});

test("passesTomorrowMorningTest: 「検討する / 継続する / 強化する」等の曖昧アクションは FAIL", () => {
  FAIL.forEach((a) => assert.equal(passesTomorrowMorningTest(a), false, a));
});

test("passesTomorrowMorningTest: 動詞はあるが目的語が無い（確認する）は FAIL", () => {
  assert.equal(passesTomorrowMorningTest("確認する。"), false);
  assert.equal(passesTomorrowMorningTest("見直す。"), false);
});

test("passesTomorrowMorningTest: src-N を落として判定・空 / null で false", () => {
  assert.equal(passesTomorrowMorningTest("Google の口コミ20件を確認する（src-1）。"), true);
  assert.equal(passesTomorrowMorningTest(""), false);
  assert.equal(passesTomorrowMorningTest(null), false);
});

test("passesTomorrowMorningTest: deterministic", () => {
  assert.equal(passesTomorrowMorningTest(PASS[0]), passesTomorrowMorningTest(PASS[0]));
});
