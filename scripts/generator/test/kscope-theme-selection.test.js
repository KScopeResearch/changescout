/**
 * kscope-theme-selection.test.js — Phase56 STEP5
 * kscope（全国 B2B コンサル型）の距離3問題に対する V3.1 ルールの検証。
 * 再生成はしない。旧テーマ相当 vs 顧客業界を選んだ相当 を scorer で比較する。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate, rankBusinessChanceCandidates } = require("../shared/business-chance-ranking");
const fs = require("fs");
const path = require("path");

/* Phase56 STEP4 で再生成された kscope の旧型テーマ（why_now が全国・一般論のまま）。 */
const OLD_STYLE = {
  title: "AI活用型・新規事業開発支援サービスの立ち上げ",
  why_now:
    "新規事業開発は多くの企業にとって経営の重要課題であり、経済産業省もイノベーションの推進を求めています。新規事業の成功率は10件立ち上げても軌道に乗るのは1件程度と低く、多くの企業がアイデアの進め方に迷っています。",
  why_company: "企業戦略の立案・実行支援、新規事業立ち上げ支援を事業内容としています。",
  market_change: "国や自治体による新規事業向け補助金・助成金制度が拡充されています。",
  first_action: "AIを活用した事業アイデア評価メニューを追加し、既存顧客向けに無料トライアルを実施する。",
  evidence: [{ source_id: "src-6" }, { source_id: "src-11" }, { source_id: "src-14" }],
};

/* V3.1 の kscope 型ルール（顧客業界を1つ選ぶ・顧客の課題を先に）に沿った候補。 */
const NEW_STYLE = {
  title: "中小製造業向け「補助金伴走 × 業務棚卸し」支援サービス",
  why_now:
    "中小製造業ではベテラン技術者の退職と若手採用難が同時に進み、現場の作業標準化が追いつかず、人件費高騰で受注を選ばざるを得ない事業者が増えています。2026年に統合された新事業進出・ものづくり補助金は、こうした省力化投資に使えるようになりました。",
  why_company:
    "企業戦略の立案から新規事業立ち上げまで伴走支援してきた実績があり、製造業の業務棚卸しと補助金活用の両方を自社で支援できます。",
  market_change: "製造業界では作業標準化とAI品質管理の導入が進み、省人化投資への補助金活用が広がっています。",
  first_action: "支援対象になりそうな中小製造業のクライアント10社に、補助金活用と業務棚卸しの課題をヒアリングする。",
  evidence: [{ source_id: "src-1" }, { source_id: "src-2" }, { source_id: "src-3" }, { source_id: "src-4" }],
};

test("kscope: V3.1 型候補（顧客業界を選定・顧客課題先出し）は distance が旧型より高い", () => {
  const oldS = scoreCandidate(OLD_STYLE).total;
  const newS = scoreCandidate(NEW_STYLE).total;
  assert.ok(newS > oldS, `new=${newS} old=${oldS}`);
});

test("kscope: 旧型は novelty=0（既知の一般論「成功率は10件で1件」）", () => {
  assert.equal(scoreCandidate(OLD_STYLE).breakdown.novelty, 0);
});

test("kscope: V3.1 型は novelty>0・customer_pain>0・acceptable（>= 80）", () => {
  const s = scoreCandidate(NEW_STYLE);
  assert.ok(s.breakdown.novelty > 0, "novelty");
  assert.ok(s.breakdown.customer_pain > 0, "customer_pain");
  assert.ok(s.total >= 80, "total=" + s.total + " " + JSON.stringify(s.breakdown));
});

test("kscope: ranking で V3.1 型が Rank1、旧型が下位", () => {
  const r = rankBusinessChanceCandidates([OLD_STYLE, NEW_STYLE]);
  assert.equal(r[0].title, NEW_STYLE.title);
  assert.equal(r[0].rank, 1);
});

test("kscope: prompts に「顧客業界を1つ具体的に選ぶ」「顧客の課題を先に書き」ルールがある", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "prompts", "quality-rules.md"), "utf-8");
  assert.match(qr, /全国 B2B（コンサル等）向けの追加ルール/);
  assert.match(qr, /顧客業界を1つ具体的に選ぶ/);
  assert.match(qr, /顧客の課題を先に書き/);
  assert.match(qr, /新規事業の成功率は低い \/ 10件で1件/);
});
