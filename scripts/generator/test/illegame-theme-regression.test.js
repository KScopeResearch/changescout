/**
 * illegame-theme-regression.test.js — Phase56 STEP5
 * illegame の距離4品質を V3.1 でも維持する（保護ルール）。再生成はしない。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate } = require("../shared/business-chance-ranking");
const { businessSizeTier } = require("../shared/theme-library");
const fs = require("fs");
const path = require("path");

const ILLEGAME_GOOD = {
  title: "飲食店向け「省人化DX導入支援」サービスの立ち上げ",
  why_now:
    "飲食業界では人手不足と人件費高騰が深刻化し、店舗の経営者は「売上はあるのにお金が残らない」「人手不足で営業時間を短縮せざるを得ない」といった課題を抱えています。セルフオーダーやキャッシュレスの導入が業界のトレンドになり、訪日客も増えています。",
  why_company:
    "美容室・飲食店の店舗運営と、システム開発から運営人材の手配までを自社で一貫して手掛けてきた実績があります。",
  market_change:
    "飲食業界ではセルフオーダー・モバイルオーダー、配膳ロボット、自動精算機の導入が進み、予約・顧客管理のデジタル化がトレンドです。2026年に統合された補助金は飲食店の新業態転換やDXに使えます。",
  first_action: "既存の飲食店クライアント3社にヒアリングを実施し、省人化DXの課題を洗い出す。",
  evidence: [{ source_id: "src-1" }, { source_id: "src-3" }, { source_id: "src-5" }, { source_id: "src-14" }],
};

const ILLEGAME_BAD = {
  title: "中小企業向けAI活用型・業務効率化コンサルティング",
  why_now:
    "サービス市場は2025年の17兆3,777億9,000万米ドルから2026年には18兆7,758億5,000万米ドルへとCAGR8.0%で成長しています。中小企業のAI活用が求められています。",
  why_company: "経営コンサルティングを行っています。",
  market_change: "世界のサービス市場は米ドル建てで拡大しています。",
  first_action: "AI活用による業務効率化を検討する。",
  evidence: [{ source_id: "src-3" }],
};

test("illegame: 良テーマ（飲食店・人手不足・セルフオーダー）は distance>=80・near", () => {
  const s = scoreCandidate(ILLEGAME_GOOD);
  assert.ok(s.total >= 80, "total=" + s.total + " " + JSON.stringify(s.breakdown));
  assert.equal(s.tier, "near");
});

test("illegame: 退行テーマ（17兆米ドル世界サービス市場）は Far・低スコア", () => {
  const bad = scoreCandidate(ILLEGAME_BAD).total;
  const good = scoreCandidate(ILLEGAME_GOOD).total;
  assert.equal(businessSizeTier(ILLEGAME_BAD.title + ILLEGAME_BAD.why_now), "far");
  assert.ok(bad < good - 20, "bad=" + bad + " good=" + good);
  assert.equal(scoreCandidate(ILLEGAME_BAD).acceptable, false);
});

test("illegame: prompts に保護ルール（世界のサービス市場を主語にしない）がある", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "prompts", "quality-rules.md"), "utf-8");
  assert.match(qr, /illegame 保護/);
  assert.match(qr, /世界のサービス市場（米ドル）/);
  assert.match(qr, /飲食店 \/ 商店街 \/ 個店/);
});
