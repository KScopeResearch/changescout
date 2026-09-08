/**
 * preview-ui.test.js — Phase55 STEP3
 * website/aor/assets/js/preview-ui.js の pure な view model 変換を検証する。
 * DOM を触らない・fetch しない・乱数を使わない（deterministic）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const P = require(path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "preview-ui.js"));
const { loadReport: load } = require("./fixtures/aor-reports");

/* ---------- pickHeroVariant ---------- */

test("pickHeroVariant: 市場の数値が乏しければ A（営業提案書型）", () => {
  assert.equal(P.pickHeroVariant(load("kscope.co.jp")), "A");
});

test("pickHeroVariant: 円建ての市場規模・成長が2つ以上あれば B（市場インサイト型）", () => {
  assert.equal(P.pickHeroVariant(load("ab-i.jp")), "B");
});

test("pickHeroVariant: 数値が米ドル建て中心なら B にせず A（日本の会社に信じられる規模でない）", () => {
  assert.equal(P.pickHeroVariant(load("illegame.com")), "A");
});

test("pickHeroVariant: 同じ report は常に同じ variant（deterministic）", () => {
  const r = load("ab-i.jp");
  assert.equal(P.pickHeroVariant(r), P.pickHeroVariant(r));
});

/* ---------- pickVisualTheme ---------- */

test("pickVisualTheme: 既知テーマのいずれか、または generic_insight を返す", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const t = P.pickVisualTheme(load(s));
    assert.ok(P.KNOWN_THEMES.includes(t), `${s} -> ${t}`);
  });
});

test("pickVisualTheme: 「中国市場向けアニメIP…」は overseas", () => {
  assert.equal(P.pickVisualTheme(load("ab-i.jp")), "overseas");
});

test("pickVisualTheme: 「AI活用型…」は ai_dx", () => {
  assert.equal(P.pickVisualTheme(load("kscope.co.jp")), "ai_dx");
});

test("pickVisualTheme: title/industry/market_change いずれにもマッチしなければ generic_insight", () => {
  assert.equal(
    P.pickVisualTheme({ company_profile: { industry_label: "その他" }, free_opportunity: { title: "何かの検討", market_change: "" } }),
    "generic_insight"
  );
});

test("pickVisualTheme: deterministic", () => {
  const r = load("illegame.com");
  assert.equal(P.pickVisualTheme(r), P.pickVisualTheme(r));
});

/* ---------- opportunityHeadline ---------- */

test("opportunityHeadline: 「〜の立ち上げ」を平叙文へ", () => {
  assert.match(P.opportunityHeadline("AI活用型・新規事業開発支援サービスの立ち上げ"), /取り組める余地があります。$/);
});

test("opportunityHeadline: 変換できない title はそのまま返す", () => {
  assert.equal(P.opportunityHeadline("既存事業のさらなる強化"), "既存事業のさらなる強化");
});

test("opportunityHeadline: 空でクラッシュしない", () => {
  assert.equal(P.opportunityHeadline(""), "");
  assert.equal(P.opportunityHeadline(null), "");
});

/* ---------- confidenceLine ---------- */

test("confidenceLine: 「追加調査が必要」を caveat として拾う", () => {
  const c = P.confidenceLine("本分析は複数の情報源に基づいています。市場規模や競合状況については、追加調査が必要です。");
  assert.equal(c.level, "中");
  assert.match(c.caveat, /追加調査が必要/);
});

test("confidenceLine: 空でも level=中 / caveat 空", () => {
  const c = P.confidenceLine("");
  assert.equal(c.level, "中");
  assert.equal(c.caveat, "");
});

/* ---------- expectedImpact ---------- */

test("expectedImpact: priority を最大2文に短縮する", () => {
  const p = "文1です。文2です。文3です。文4です。";
  assert.equal(P.expectedImpact(p), "文1です。文2です。");
});

test("expectedImpact: 空は空", () => {
  assert.equal(P.expectedImpact(""), "");
});

/* ---------- buildFirstActionViewModel ---------- */

test("buildFirstActionViewModel: 「〜し、〜する」を2ステップに分割する", () => {
  const steps = P.buildFirstActionViewModel(
    "IP360補助金の次回公募スケジュールを確認し、自社IPの中国向けローカライズ案件を企画・申請する。"
  );
  assert.equal(steps.length, 2);
  assert.match(steps[0], /公募スケジュールを確認/);
});

test("buildFirstActionViewModel: 分割できない1文はそのまま1件", () => {
  const steps = P.buildFirstActionViewModel("既存顧客にヒアリングする。");
  assert.equal(steps.length, 1);
});

test("buildFirstActionViewModel: 空は空配列", () => {
  assert.deepEqual(P.buildFirstActionViewModel(""), []);
});

test("buildFirstActionViewModel: 3ステップを超えて分割しない", () => {
  const steps = P.buildFirstActionViewModel("Aを確認し、Bを比較し、Cを検討し、Dを試し、Eを決める。");
  assert.ok(steps.length <= 3);
});

/* ---------- humanReviewLine ---------- */

test("humanReviewLine: approved は確認日を含む文", () => {
  const r = P.humanReviewLine({ human_review: { status: "approved", reviewed_at: "2026-09-08T06:32:11.541Z" } });
  assert.equal(r.approved, true);
  assert.match(r.line, /2026年9月8日/);
  assert.match(r.line, /確認しました/);
});

test("humanReviewLine: approved 以外は『レビュー中』", () => {
  const r = P.humanReviewLine({ human_review: { status: "pending_review" } });
  assert.equal(r.approved, false);
  assert.match(r.line, /レビュー中/);
});

test("humanReviewLine: reviewed_at が無くてもクラッシュしない", () => {
  const r = P.humanReviewLine({ human_review: { status: "approved" } });
  assert.equal(r.approved, true);
  assert.match(r.line, /確認しました/);
});

/* ---------- categorizeSources ---------- */

test("categorizeSources: source_type ごとにカテゴリ分けし、既知順で返す", () => {
  const groups = P.categorizeSources([
    { id: "s1", source_type: "company", label: "自社", url: "https://a" },
    { id: "s2", source_type: "government", label: "白書", url: "https://b" },
    { id: "s3", source_type: "statistics", label: "統計", url: "https://c" },
    { id: "s4", source_type: "directory", label: "DB", url: "https://d" },
  ]);
  const labels = groups.map((g) => g.label);
  assert.ok(labels.indexOf("統計・市場データ") < labels.indexOf("企業情報"), JSON.stringify(labels));
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), 4);
});

test("categorizeSources: 3社の実データでクラッシュしない", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = load(s);
    const groups = P.categorizeSources(r.top_sources);
    assert.ok(Array.isArray(groups) && groups.length >= 1, s);
  });
});

/* ---------- buildOpportunityViewModel（統合） ---------- */

test("buildOpportunityViewModel: 3社で必須フィールドが揃う", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const vm = P.buildOpportunityViewModel(load(s));
    assert.ok(vm.title.length > 0, s + " title");
    assert.ok(vm.headline.length > 0, s + " headline");
    assert.ok(vm.whyNow.length > 0, s + " whyNow");
    assert.ok(vm.whyCompany.length > 0, s + " whyCompany");
    assert.ok(Array.isArray(vm.stats), s + " stats");
    assert.equal(typeof vm.evidenceCount, "number");
  });
});
