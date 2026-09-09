/**
 * business-chance-ranking.test.js — Phase56 STEP5
 * rankBusinessChanceCandidates（RULE-THEME-9）: 候補5件を「近さ」で並べ替え Rank1 を選ぶ。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rankBusinessChanceCandidates } = require("../shared/business-chance-ranking");

function cand(over) {
  return Object.assign(
    {
      title: "何かのサービス",
      why_now: "変化があります。",
      why_company: "実績があります。",
      first_action: "確認する。",
      expected_benefit: ["業務効率"],
      evidence: [{ source_id: "src-1" }, { source_id: "src-2" }],
    },
    over
  );
}

const CANDS = [
  cand({
    title: "世界のAI市場向け新規事業支援",
    why_now: "世界のAI市場は米ドル建てで拡大し、DXが重要です。新規事業の成功率は10件で1件です。",
    first_action: "AI活用を検討する。",
    why_company: "支援しています。",
  }),
  cand({
    title: "中小製造業向けベテラン退職対策サービス",
    why_now:
      "中小製造業では熟練工の高齢化と退職が進み、現場の技能承継が追いつかず、人手不足で受注を断る事業者も出ています。",
    why_company: "製造業の現場改善を10年支援してきた実績とノウハウがあります。",
    first_action: "既存の製造業クライアント10社に技能承継の課題をヒアリングする。",
    market_change: "製造業界では作業標準化とAI品質管理の導入が進んでいます。報酬改定はありません。",
    evidence: [{ source_id: "src-1" }, { source_id: "src-2" }, { source_id: "src-3" }, { source_id: "src-4" }],
  }),
  cand({
    title: "飲食店向けGoogle口コミ返信支援",
    why_now: "飲食店では Google 口コミが予約数に効くようになり、人件費高騰で返信の手が回っていません。",
    why_company: "飲食店の店舗運営を自社で手掛けた経験があります。",
    first_action: "既存顧客5店の Google 口コミ20件を確認する。",
    market_change: "飲食業界ではモバイルオーダーとキャッシュレスの導入が進んでいます。",
  }),
  cand({ title: "汎用DXコンサル", why_now: "DXが求められています。", first_action: "DXを検討する。" }),
  cand({
    title: "国内SaaS市場向けプラットフォーム",
    why_now: "国内SaaS市場は成長しており、補助金制度も拡充しています。",
    first_action: "補助金対象を確認する。",
    why_company: "システム開発の実績があります。",
  }),
];

test("rankBusinessChanceCandidates: 5件を distanceScore 降順で並べ、rank を付与", () => {
  const ranked = rankBusinessChanceCandidates(CANDS);
  assert.equal(ranked.length, 5);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].distanceScore >= ranked[i].distanceScore, "score 降順");
  }
});

test("rankBusinessChanceCandidates: Rank1 は「顧客の痛み + 業界変化 + 30分アクション」の候補", () => {
  const top = rankBusinessChanceCandidates(CANDS)[0];
  assert.match(top.title, /中小製造業|飲食店/);
  assert.ok(top.acceptable, "Rank1 は 80 以上: " + top.distanceScore);
  assert.equal(top.sizeTier, "near");
});

test("rankBusinessChanceCandidates: 世界市場・汎用DX の候補は下位", () => {
  const ranked = rankBusinessChanceCandidates(CANDS);
  const worldRank = ranked.find((r) => /世界のAI市場/.test(r.title)).rank;
  const vagueRank = ranked.find((r) => /汎用DX/.test(r.title)).rank;
  assert.ok(worldRank >= 4 && vagueRank >= 4, "world=" + worldRank + " vague=" + vagueRank);
});

test("rankBusinessChanceCandidates: 副作用なし（入力配列を変更しない）", () => {
  const input = CANDS.map((c) => Object.assign({}, c));
  const before = JSON.stringify(input);
  rankBusinessChanceCandidates(input);
  assert.equal(JSON.stringify(input), before);
});

test("rankBusinessChanceCandidates: deterministic・空配列でクラッシュしない", () => {
  assert.deepEqual(rankBusinessChanceCandidates(CANDS), rankBusinessChanceCandidates(CANDS));
  assert.deepEqual(rankBusinessChanceCandidates([]), []);
  assert.deepEqual(rankBusinessChanceCandidates(null), []);
});

test("rankBusinessChanceCandidates: 同点は入力順を保つ（安定ソート）", () => {
  const same = [cand({ title: "A" }), cand({ title: "B" }), cand({ title: "C" })];
  const r = rankBusinessChanceCandidates(same);
  const scores = r.map((x) => x.distanceScore);
  if (new Set(scores).size === 1) assert.deepEqual(r.map((x) => x.title), ["A", "B", "C"]);
});
