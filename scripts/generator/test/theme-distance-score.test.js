/**
 * theme-distance-score.test.js — Phase56 STEP5
 * business-chance-ranking.js の Near-field Distance Score（RULE-THEME-10・100点）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate } = require("../shared/business-chance-ranking");

const NEAR = {
  title: "飲食店向け「省人化DX導入支援」サービスの立ち上げ",
  why_now:
    "飲食業界では人手不足と人件費高騰が深刻化し、店舗の経営者は「売上はあるのにお金が残らない」「人手不足で営業時間を短縮せざるを得ない」といった課題を抱えています。セルフオーダーや配膳ロボットの導入が業界のトレンドになっています。",
  why_company:
    "美容室・飲食店の店舗運営とシステム開発の両方を自社で手掛けてきた実績があり、現場で培った知見があります。",
  market_change: "セルフオーダー・モバイルオーダー、配膳ロボット、自動精算機など省人化技術の導入が進んでいます。",
  first_action: "既存の飲食店クライアント3社にヒアリングを実施し、省人化DXの課題を洗い出す。",
  evidence: [{ source_id: "src-1" }, { source_id: "src-3" }, { source_id: "src-5" }, { source_id: "src-14" }],
};

const FAR = {
  title: "AI活用型・新規事業開発支援サービスの立ち上げ",
  why_now:
    "生成AIの登場により市場は拡大しており、新規事業の成功率は10件立ち上げても1件程度と低く、多くの企業がDXの重要性を認識しています。世界のAI市場は17兆ドル規模です。",
  why_company: "新規事業支援を行っています。",
  market_change: "世界のAI市場は米ドル建てで大きく成長し、CAGR8%で拡大しています。",
  first_action: "AI活用を検討し、市場調査を継続する。",
  evidence: [{ source_id: "src-1" }],
};

test("scoreCandidate: 近いテーマ（飲食店・顧客の痛み・30分アクション）は 80 以上・acceptable", () => {
  const s = scoreCandidate(NEAR);
  assert.ok(s.total >= 80, "total=" + s.total + " " + JSON.stringify(s.breakdown));
  assert.equal(s.acceptable, true);
  assert.equal(s.tier, "near");
});

test("scoreCandidate: 遠いテーマ（世界市場・一般論・曖昧アクション）は 40 未満・not acceptable", () => {
  const s = scoreCandidate(FAR);
  assert.ok(s.total < 40, "total=" + s.total + " " + JSON.stringify(s.breakdown));
  assert.equal(s.acceptable, false);
  assert.equal(s.tier, "far");
});

test("scoreCandidate: breakdown は 7 項目・満点合計 100", () => {
  const s = scoreCandidate(NEAR);
  const keys = Object.keys(s.breakdown).sort();
  assert.deepEqual(keys, ["customer_pain", "evidence", "first_action", "industry_change", "local_relevance", "novelty", "why_company"]);
  const max = { customer_pain: 20, industry_change: 15, local_relevance: 15, why_company: 15, first_action: 15, novelty: 10, evidence: 10 };
  assert.equal(Object.values(max).reduce((a, b) => a + b, 0), 100);
});

test("scoreCandidate: 既知の一般論（成功率は10件で1件 / DXが重要）は novelty=0", () => {
  assert.equal(scoreCandidate(FAR).breakdown.novelty, 0);
  assert.equal(scoreCandidate(NEAR).breakdown.novelty, 10);
});

test("scoreCandidate: deterministic（同じ入力で同じ点）", () => {
  assert.deepEqual(scoreCandidate(NEAR), scoreCandidate(NEAR));
});

test("scoreCandidate: 空候補でクラッシュしない", () => {
  const s = scoreCandidate({});
  assert.equal(typeof s.total, "number");
  assert.equal(s.acceptable, false);
});
