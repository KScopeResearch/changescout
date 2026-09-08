/**
 * validator.test.js — Task18: validate-report.js（validateReport/validateReview）の自動テスト。
 * Node標準の node:test / node:assert のみを使用（npm依存なし）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const { validateReport, validateReview } = require("../validate-report");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR, REVIEW_FIXTURES_DIR } = require("../shared/paths");

test("validateReport: good.jsonはPASSする", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("validateReport: average.json は構造としてはPASSする（品質はquality-evaluator.jsが別途判定）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "average.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true, "average.json は構造的にはPASSするはず");
});

// Phase54 STEP8A.1 STEP6: Opportunity の根拠が directory/review・reference・低score のみの
// レポートは、品質ではなく「送ってはいけない構造」として validateReport が error（HOLD）にする。
// bad.json は evidence が news/score35/reference の1件のみ = この条件に該当する。
test("validateReport: bad.json は Opportunity 根拠ゲート（STEP8A.1 STEP6）で error になる", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "bad.json"));
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.includes("directory/review・reference")),
    `期待した error がない: ${JSON.stringify(result.errors)}`
  );
});

test("validateReport: 必須フィールド欠如を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  delete report.paid_analysis;
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("paid_analysis")));
});

test("validateReport: source_pages[].idの重複を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[1].id = report.source_pages[0].id;
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("重複")));
});

test("validateReport: source_pages[].published_atが正常なISO8601形式ならPASSする", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = "2026-01-01T00:00:00+09:00";
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atがnullでもPASSする（Task32: Tavily実検索で公開日が取得できないケースへの対応）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = null;
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atが存在しなくてもPASSする（Task32）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  delete report.source_pages[0].published_at;
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

test("validateReport: source_pages[].published_atが不正な文字列の場合は検出する（Task32: 取得できないこととは区別する）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages[0].published_at = "not-a-date";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("published_at")));
});

test("validateReport: evidence[].source_idがsource_pagesに実在しない場合を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.evidence.push({ source_id: "src-does-not-exist", quote: "test" });
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("src-does-not-exist")));
});

test("validateReport: priority_matrixで同一idが複数象限に重複割り当てされている場合を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const quadrants = report.paid_analysis.priority_matrix.quadrants;
  quadrants.high_impact_high_effort.opportunity_ids.push(quadrants.high_impact_low_effort.opportunity_ids[0]);
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("重複して割り当てられています")));
});

// ---------------------------------------------------------------------------
// Phase54 STEP5 — paid_analysis priority_matrix の内部参照整合性
// STEP4 の ab-i.jp 再生成で、LLM が priority_matrix に "free-1"（additional_opportunities に
// 存在しない id）を出力し validateReport が FAIL したケースの回帰固定。
// ---------------------------------------------------------------------------

/** good.json をベースに paid_analysis を 3 opportunity（locked-1/locked-2/add-3）構成へ整える。 */
function paidReport(quadrants) {
  const r = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  r.locked_opportunities = [
    { id: "locked-1", title: "テーマ1" },
    { id: "locked-2", title: "テーマ2" },
  ];
  r.paid_analysis.additional_opportunities = [
    { id: "locked-1", title: "テーマ1", summary: "s", expected_effect: "e", relevance: "中" },
    { id: "locked-2", title: "テーマ2", summary: "s", expected_effect: "e", relevance: "中" },
    { id: "add-3", title: "新規テーマ", summary: "s", expected_effect: "e", relevance: "高" },
  ];
  r.paid_analysis.priority_matrix.quadrants = {
    high_impact_low_effort: { label: "L", opportunity_ids: quadrants.hl || [] },
    high_impact_high_effort: { label: "H", opportunity_ids: quadrants.hh || [] },
    low_impact_low_effort: { label: "LL", opportunity_ids: quadrants.ll || [] },
    low_impact_high_effort: { label: "LH", opportunity_ids: quadrants.lh || [] },
  };
  return r;
}

test("STEP5 Test 1（正常系）: priority_matrix が既存 opportunity id のみを参照 → PASS", () => {
  const r = paidReport({ hl: ["locked-1"], hh: ["add-3"], ll: ["locked-2"], lh: [] });
  const v = validateReport(r);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("STEP5 Test 2（異常系・free-1 再現）: 存在しない id を参照 → FAIL", () => {
  const r = paidReport({ hl: ["locked-1"], hh: ["free-1", "add-3"], ll: ["locked-2"], lh: [] });
  const v = validateReport(r);
  assert.equal(v.ok, false);
  assert.ok(
    v.errors.some((e) => e.includes('"free-1"') && e.includes("additional_opportunities")),
    JSON.stringify(v.errors)
  );
  // 有効な id 一覧が是正のヒントとしてメッセージに含まれる
  assert.ok(v.errors.some((e) => e.includes("有効: ") && e.includes("add-3")));
});

test("STEP5 Test 3（複数参照）: locked-1/locked-2/add-3 を全て正しく参照 → PASS", () => {
  const r = paidReport({ hl: ["locked-1"], hh: ["locked-2"], ll: ["add-3"], lh: [] });
  assert.equal(validateReport(r).ok, true);
});

test("STEP5 Test 4（重複参照）: 同一 id を同一象限内で2回参照 → FAIL（既存仕様の確認）", () => {
  const r = paidReport({ hl: ["locked-1", "locked-1"], hh: [], ll: [], lh: [] });
  const v = validateReport(r);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("重複して割り当てられています")));
});

test("STEP5 Test 5（空配列）: additional_opportunities が空でも priority_matrix が全て空なら PASS", () => {
  const r = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  r.locked_opportunities = [];
  r.paid_analysis.additional_opportunities = [];
  r.paid_analysis.priority_matrix.quadrants = {
    high_impact_low_effort: { label: "L", opportunity_ids: [] },
    high_impact_high_effort: { label: "H", opportunity_ids: [] },
    low_impact_low_effort: { label: "LL", opportunity_ids: [] },
    low_impact_high_effort: { label: "LH", opportunity_ids: [] },
  };
  // free_opportunity.evidence の source_id は good.json の既存 source_pages を参照しているため触らない
  const v = validateReport(r);
  assert.equal(
    v.errors.some((e) => e.includes("priority_matrix")),
    false,
    JSON.stringify(v.errors.filter((e) => e.includes("priority_matrix")))
  );
});

test("STEP5: ローカル ab-i.jp 生成物の priority_matrix — free-* 参照があれば検出、なければ整合", () => {
  const p = path.join(__dirname, "..", "output", "www.ab-i.jp", "report.json");
  if (!fs.existsSync(p)) return; // 生成物が無くてもテストは落とさない
  const r = readJson(p);
  const refIds = [];
  const quad = (((r.paid_analysis || {}).priority_matrix || {}).quadrants) || {};
  Object.values(quad).forEach((q) => (q.opportunity_ids || []).forEach((id) => refIds.push(id)));
  const v = validateReport(r);
  if (refIds.some((id) => /^free-\d+$/.test(id))) {
    // 旧バグ版が残っている場合 → validator が検出すること
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /priority_matrix.*不明なid.*free-/.test(e)), JSON.stringify(v.errors));
  } else {
    // STEP6 で修正済みの版 → priority_matrix 系エラーは無いこと
    assert.equal(
      v.errors.some((e) => e.includes("priority_matrix")),
      false,
      JSON.stringify(v.errors.filter((e) => e.includes("priority_matrix")))
    );
  }
});

test("validateReport: evaluationフィールドの不正値を検出する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.evaluation.status = "INVALID_STATUS";
  const result = validateReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("evaluation.status")));
});

test("validateReport: fact区分に推測表現があれば警告する（エラーにはしない）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now = "対応した方がよいかもしれません。";
  const result = validateReport(report);
  assert.equal(result.ok, true, "推測表現は警告のみでokはtrueのまま");
  assert.ok(result.warnings.some((w) => w.includes("推測表現")));
});

// ---------------------------------------------------------------------------
// Phase53 STEP10.12 — Opportunity Evidence Gate（すべて警告、okはtrueのまま）
// ---------------------------------------------------------------------------

test("STEP10.12 Test E → STEP8A.1 STEP6: evidence が全て低スコア/reference の source のみなら error（HOLD）にする", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.source_pages.forEach((s) => {
    s.score = 20;
    s.evidence_strength = "reference";
  });
  const result = validateReport(report);
  // Phase53 STEP10.12 時点では warning だったが、Phase54 STEP8A.1 STEP6 で
  // 「directory/review・reference のみを根拠にした Opportunity」は構造的な HOLD（error）に格上げした。
  assert.equal(result.ok, false, "全て低関連 source を根拠にした Opportunity は error");
  assert.ok(
    result.errors.some((e) => e.includes("directory/review・reference")),
    `期待した error がない: ${JSON.stringify(result.errors)}`
  );
  assert.ok(
    result.warnings.some((w) => w.includes("関連性が低いと判断された source")),
    `関連性 warning も併せて出る: ${JSON.stringify(result.warnings)}`
  );
});

test("STEP10.12 Test F: evidence に source_type:\"company\" が無ければ警告する（未確認の会社主張への注意）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  // company source(src-1) を evidence から外す
  report.free_opportunity.evidence = report.free_opportunity.evidence.filter((e) => e.source_id !== "src-1");
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes('source_type:"company"')));
});

test("STEP10.12 Test G: 会社source + 通常スコアの健全な evidence では関連性の警告を出さない（false positive 防止）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.ok(!result.warnings.some((w) => w.includes("関連性")), `不要な関連性警告: ${JSON.stringify(result.warnings)}`);
  assert.ok(!result.warnings.some((w) => w.includes('source_type:"company"')));
});

test("STEP10.12 Test H → STEP8A.2 Gate-1: 日本の施策（クールジャパン）を中国政府の施策として記述したら error（HOLD）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now =
    "中国政府は2024年に「新たなクールジャパン戦略」を公表し、コンテンツ輸出を後押ししています。";
  const bad = validateReport(report);
  // Phase53 STEP10.12 では warning だったが、Phase54 STEP8A.2 Gate-1 で主体取り違えは
  // 構造的な HOLD（error）に格上げした。
  assert.equal(bad.ok, false);
  assert.ok(
    bad.errors.some((e) => e.includes("主体取り違え")),
    `期待した error がない: ${JSON.stringify(bad.errors)}`
  );
  assert.ok(bad.warnings.some((w) => w.includes("中国政府の施策として記述")), JSON.stringify(bad.warnings));

  // 正しい主体（日本政府）なら error も warning も出ない
  const report2 = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report2.free_opportunity.why_now =
    "日本政府は2024年に「新たなクールジャパン戦略」を公表し、コンテンツ輸出を後押ししています。";
  const good = validateReport(report2);
  assert.equal(good.ok, true);
  assert.ok(!good.warnings.some((w) => w.includes("中国政府の施策として記述")));
});

test("STEP10.12 Test H2: 「中国政府系助成金」と日本の施策名が同一 Opportunity に併存したら警告する", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.title = "中国政府系助成金を活用したアニメ配信支援";
  report.free_opportunity.why_now = "JLOX+の海外展開支援（最大4,000万円）を活用できます。";
  const result = validateReport(report);
  assert.ok(result.warnings.some((w) => w.includes("助成金の主体（日本／中国）を確認")), JSON.stringify(result.warnings));
});

test("validateReport: STEP10.12 の追加チェックは good.json の ok/errors を変えない", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

// ---------------------------------------------------------------------------
// Phase54 STEP1 — Opportunity / Market Change の品質警告（すべて警告、ok は true のまま）
// ---------------------------------------------------------------------------

/** good.json をベースに free_opportunity / company_profile を差し替えた report を作る。 */
function reportWith(overrides) {
  const r = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  if (overrides.company_profile) Object.assign(r.company_profile, overrides.company_profile);
  if (overrides.free_opportunity) Object.assign(r.free_opportunity, overrides.free_opportunity);
  if (overrides.source_pages) r.source_pages = overrides.source_pages;
  return r;
}

test("STEP1 RC-2: 既存事業の言い換え（〜の強化 + business_summary と高重複）は警告する", () => {
  const r = reportWith({
    company_profile: { business_summary: "当社は新規事業立ち上げ支援と企業再生支援を行うコンサルティング会社です。" },
    free_opportunity: { title: "新規事業立ち上げ支援サービスの強化" },
  });
  const v = validateReport(r);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => w.includes("既存事業の言い換え")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: 前向きな新方向（AI活用 等）が title にあれば既存事業警告を出さない", () => {
  const r = reportWith({
    company_profile: { business_summary: "当社は新規事業立ち上げ支援と企業再生支援を行うコンサルティング会社です。" },
    free_opportunity: { title: "生成AIを活用した中小企業向け新規事業診断サービスの立ち上げ" },
  });
  const v = validateReport(r);
  assert.ok(!v.warnings.some((w) => w.includes("既存事業の言い換え")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: evidence が1件なら警告 / 2件以上なら evidence-count 警告なし", () => {
  const one = reportWith({ free_opportunity: { evidence: [{ source_id: "src-1", quote: "q" }] } });
  assert.ok(validateReport(one).warnings.some((w) => w.includes("evidence が1件")));

  const two = reportWith({
    free_opportunity: {
      evidence: [
        { source_id: "src-1", quote: "q" },
        { source_id: "src-2", quote: "q" },
      ],
    },
  });
  assert.ok(!validateReport(two).warnings.some((w) => w.includes("evidence が") && w.includes("件しか")));
});

test("STEP1 RC-2: evidence に関連性のある外部市場 source が無いと警告する", () => {
  const sp = [
    { id: "src-1", source_type: "company", source_role: "company_fact", label: "自社", url: "https://a", score: 90, evidence_strength: "primary" },
    { id: "src-2", source_type: "government", source_role: "market_change", label: "無関係補助金", url: "https://b", score: 30, evidence_strength: "reference" },
  ];
  const r = reportWith({
    source_pages: sp,
    free_opportunity: {
      evidence: [
        { source_id: "src-1", quote: "q" },
        { source_id: "src-2", quote: "q" },
      ],
    },
  });
  const v = validateReport(r);
  assert.ok(v.warnings.some((w) => w.includes("関連性のある外部市場 source")), JSON.stringify(v.warnings));
});

test("STEP1 RC-2: 関連性のある government/statistics 等が evidence にあれば外部市場警告は出ない", () => {
  const v = validateReport(readJson(path.join(REPORT_FIXTURES_DIR, "good.json")));
  assert.ok(!v.warnings.some((w) => w.includes("関連性のある外部市場 source")), JSON.stringify(v.warnings));
});

test("STEP1 RC-3 Case A/B: market_change が company source のみ → 警告 / external あり → 警告なし", () => {
  const sp = [
    { id: "src-1", source_type: "company", source_role: "company_fact", label: "自社", url: "https://a", score: 90, evidence_strength: "primary" },
    { id: "src-2", source_type: "government", source_role: "market_change", label: "統計", url: "https://b", score: 95, evidence_strength: "primary" },
  ];
  const companyOnly = reportWith({ source_pages: sp, free_opportunity: { market_change: "当社は昔からこの事業をやっています（src-1）。" } });
  assert.ok(validateReport(companyOnly).warnings.some((w) => w.includes("market_change が company source のみ")));

  const withExternal = reportWith({ source_pages: sp, free_opportunity: { market_change: "市場は年10%成長しています（src-2）。当社の事業（src-1）に追い風です。" } });
  assert.ok(!validateReport(withExternal).warnings.some((w) => w.includes("market_change が company source のみ")));
});

test("STEP1 RC-3 Case C: market_change が source_id を1件も引用していない → 警告", () => {
  const r = reportWith({ free_opportunity: { market_change: "なんとなく市場が伸びている気がします。" } });
  assert.ok(validateReport(r).warnings.some((w) => w.includes("source_id を1件も引用していません")));
});

test("STEP1 RC-3: market_change が情報不足を正直に書いている場合は警告しない", () => {
  const r = reportWith({
    free_opportunity: { market_change: "公開情報からは対象企業の市場に関する外部データを十分に取得できなかった。" },
  });
  assert.ok(!validateReport(r).warnings.some((w) => w.includes("market_change")));
});

test("STEP1: 追加チェックは good.json の ok/errors を変えない", () => {
  const v = validateReport(readJson(path.join(REPORT_FIXTURES_DIR, "good.json")));
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test("validateReview: 4種類のfixtureすべてがPASSする", () => {
  ["pending.json", "approved.json", "needs_revision.json", "rejected.json"].forEach((name) => {
    const review = readJson(path.join(REVIEW_FIXTURES_DIR, name));
    const result = validateReview(review);
    assert.equal(result.ok, true, `${name} はvalidateReviewでPASSするはず`);
  });
});

test("validateReview: 不正なstatusを検出する", () => {
  const result = validateReview({ status: "unknown", comments: [], fixes: [], history: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("review.status")));
});

test("validateReview: pending_review以外でreviewerが欠けている場合を検出する", () => {
  const result = validateReview({ status: "approved", reviewer: null, comments: [], fixes: [], history: [] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("reviewer")));
});

test("validateReview: history[].atが不正な日付形式の場合を検出する", () => {
  const result = validateReview({
    status: "pending_review",
    comments: [],
    fixes: [],
    history: [{ at: "not-a-date", action: "comment_added" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("history[0].at")));
});

// ---------------------------------------------------------------------------
// Phase54 STEP8A.2 — LLM 出力 Hard Guards（Gate-1 主体帰属 / Gate-2 他社製品名 / Gate-5 top source）
// ---------------------------------------------------------------------------

test("STEP8A.2 Gate-1: 「クールジャパン戦略を中国政府が公表」は error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now =
    "中国政府は2024年6月に「新たなクールジャパン戦略」を公表し、日本発コンテンツの海外市場規模の目標を掲げた。";
  const v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("主体取り違え")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-1: 「中国政府系プラットフォーム」は error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.title = "中国政府系プラットフォーム向けのアニメIP提供サービス";
  const v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("主体取り違え")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-1: 中国の配信PFを「国営」と書くと error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.market_change =
    "国営のbilibiliが日本アニメを配信しており、視聴需要が伸びている（src-2）。";
  const v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("主体取り違え")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-1: 正しい主体（日本政府がクールジャパン）は error にしない", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.why_now =
    "日本政府は2024年6月に新たなクールジャパン戦略を公表し、海外展開を後押ししている（src-2）。";
  const v = validateReport(report);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-2: 他社製品名「AI導入の立て直し」を title に使うと error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.title = "AI導入の立て直し支援サービスの提供";
  const v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("他社の製品・サービス名")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-3: 実質的な market_change で source_id 引用ゼロは error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.market_change =
    "AI活用が中小企業に広がる一方で、導入後に定着しない企業が増えているという市場変化がある。";
  const v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("source_id を1件も引用していません")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-3: 情報不足を正直に書いた market_change は error にしない", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.market_change =
    "公開情報では、貴社の市場に関する十分な外部データを確認できませんでした。";
  const v = validateReport(report);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-5: top_sources に directory / review / Wikipedia が入ると error", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.top_sources = [
    { id: "src-1", source_type: "company", label: "自社", url: "https://a" },
    { id: "src-9", source_type: "directory", label: "全国法人リスト", url: "https://houjin.jp/c/x" },
  ];
  let v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("Gate-5")), JSON.stringify(v.errors));

  report.top_sources = [
    { id: "src-1", source_type: "company", label: "自社", url: "https://a" },
    { id: "src-5", source_type: "news", label: "ABCアニメーション - Wikipedia", url: "https://ja.wikipedia.org/wiki/x" },
  ];
  v = validateReport(report);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("Wikipedia")), JSON.stringify(v.errors));
});

test("STEP8A.2 Gate-5: top_sources が company/government のみなら error にしない", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  report.top_sources = [
    { id: "src-1", source_type: "company", label: "自社", url: "https://a" },
    { id: "src-2", source_type: "government", label: "市場統計", url: "https://x.go.jp" },
  ];
  const v = validateReport(report);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});
