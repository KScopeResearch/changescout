/**
 * customer-change-rule.test.js — Phase56 STEP5
 * RULE-THEME-11（why_now に「顧客側の変化」を最低1件）+ RULE-THEME-13（Business Size Filter）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hasCustomerSideChange } = require("../shared/business-chance-ranking");
const { businessSizeTier, CUSTOMER_SIDE_CHANGE } = require("../shared/theme-library");

test("hasCustomerSideChange: 採用難 / インバウンド / LINE予約 / Google口コミ / 人件費高騰 を検出", () => {
  ["飲食店では採用難が深刻です。", "訪日客（インバウンド）が急増しています。", "顧客がLINE予約を使うようになりました。", "Google口コミの返信率が予約に効きます。", "人件費高騰で利益が出ません。"].forEach(
    (s) => assert.equal(hasCustomerSideChange(s), true, s)
  );
});

test("hasCustomerSideChange: 会社自身の話だけ（当社はAIを活用）は false", () => {
  assert.equal(hasCustomerSideChange("当社はAIを活用したサービスを提供しています。"), false);
  assert.equal(hasCustomerSideChange("生成AIの登場により業界が変わりつつあります。"), false);
});

test("hasCustomerSideChange: src-N を落として判定・空でクラッシュしない", () => {
  assert.equal(hasCustomerSideChange("顧客の現場で人手不足（src-1）が続いています。"), true);
  assert.equal(hasCustomerSideChange(""), false);
  assert.equal(hasCustomerSideChange(null), false);
});

test("CUSTOMER_SIDE_CHANGE: 近接な顧客変化語を十分に持つ（>= 15 種）", () => {
  assert.ok(CUSTOMER_SIDE_CHANGE.length >= 15);
  ["採用難", "インバウンド", "Google口コミ", "キャッシュレス", "人件費", "高齢化", "2024年問題"].forEach((w) =>
    assert.ok(CUSTOMER_SIDE_CHANGE.some((x) => x.indexOf(w) !== -1 || w.indexOf(x) !== -1), w)
  );
});

test("businessSizeTier: near / mid / far を分類（RULE-THEME-13）", () => {
  assert.equal(businessSizeTier("商店街の店舗で常連客が減っています"), "near");
  assert.equal(businessSizeTier("顧客の来店数が落ちています"), "near");
  assert.equal(businessSizeTier("国内の介護業界で報酬改定があり補助金も拡充"), "mid");
  assert.equal(businessSizeTier("補助金制度が統合されました"), "mid");
  assert.equal(businessSizeTier("世界のAI市場は17兆米ドル規模でCAGR8%"), "far");
  assert.equal(businessSizeTier("グローバル市場の成長が続いています"), "far");
});

test("businessSizeTier: 判定不能は mid（Hero 使用可・Far ではない）", () => {
  assert.equal(businessSizeTier("新しいサービスを始めます"), "mid");
});

test("businessSizeTier: 国内・業界文脈が主なら『世界』語があっても mid", () => {
  assert.equal(businessSizeTier("国内のアニメ業界では海外展開の動きが広がっています"), "mid");
});
