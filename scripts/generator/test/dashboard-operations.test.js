/**
 * dashboard-operations.test.js — Phase58 STEP7。
 *
 * Backend: website/aor-admin/server.js の buildStaleReportItems() / reasonTokensForClassification()
 *   （純粋関数。server 起動なしで require できる — server.js は require.main===module のときだけ listen する）。
 * UI:      website/aor-admin/public/assets/js/operations.js の renderPublishedArtifactHealth()。
 *
 * どちらも「表示・整形」だけを担い、publishable / freshness / review の判定はしない。
 * classification は deploy-aor-web.js の reconciliation helper に委譲する（DI モックで固定）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const ops = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "operations.js"));

const { buildStaleReportItems, reasonTokensForClassification } = server;

/** classify モック: slug → classification を固定で返す。 */
function classifyStub(map) {
  return async (slug) => ({ classification: map[slug] || "STALE_UNPUBLISHABLE", reasons: ["(ignored full jp reason)"] });
}
const noReport = async () => null;
const noPublished = async () => null;

// ===========================================================================
// API — buildStaleReportItems / reasonTokensForClassification
// ===========================================================================

test("reasonTokensForClassification: classification → 短い reason トークン（純粋マップ）", () => {
  assert.deepEqual(reasonTokensForClassification("STALE_AFTER_REGENERATION"), ["freshness"]);
  assert.deepEqual(reasonTokensForClassification("STALE_UNAPPROVED"), ["review_missing"]);
  assert.deepEqual(reasonTokensForClassification("STALE_ORPHAN"), ["orphan"]);
  assert.deepEqual(reasonTokensForClassification("STALE_UNPUBLISHABLE"), ["evaluation_fail"]);
  assert.deepEqual(reasonTokensForClassification("STALE_UNREADABLE"), ["unreadable"]);
  assert.deepEqual(reasonTokensForClassification("DEPLOY_ELIGIBLE"), []);
  assert.deepEqual(reasonTokensForClassification(undefined), []);
});

test("API Case1: stale=0 orphan=0 → items 空", async () => {
  const items = await buildStaleReportItems([{ id: "a.example.com", published: true, publishable: true }], [], [], {
    classify: classifyStub({}),
    loadReport: noReport,
    loadPublished: noPublished,
  });
  assert.deepEqual(items, []);
});

test("API Case2: STALE_AFTER_REGENERATION 1件（current report あり）", async () => {
  const reportsCache = [
    {
      id: "x.example.com",
      company_name: "X",
      review_status: "approved",
      evaluation_status: "PASS",
      published: true,
      publishable: false,
      reviewed_at: "2026-08-01T00:00:00.000Z",
    },
  ];
  const items = await buildStaleReportItems(reportsCache, ["x.example.com"], [], {
    classify: classifyStub({ "x.example.com": "STALE_AFTER_REGENERATION" }),
    loadReport: async () => ({ meta: { generated_at: "2026-09-01T00:00:00.000Z" } }),
    loadPublished: async () => ({ meta: { published_at: "2026-08-15T00:00:00.000Z" } }),
  });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    slug: "x.example.com",
    classification: "STALE_AFTER_REGENERATION",
    published: true,
    publishable: false,
    review_status: "approved",
    evaluation_status: "PASS",
    generated_at: "2026-09-01T00:00:00.000Z",
    reviewed_at: "2026-08-01T00:00:00.000Z",
    published_at: "2026-08-15T00:00:00.000Z",
    reasons: ["freshness"],
  });
});

test("API Case3: STALE_ORPHAN 1件（current report なし → 各フィールド null）", async () => {
  const items = await buildStaleReportItems([], [], ["gone.example.com"], {
    classify: classifyStub({ "gone.example.com": "STALE_ORPHAN" }),
    loadReport: async () => {
      throw new Error("loadReport は orphan では呼ばれないはず");
    },
    loadPublished: async () => ({ meta: { published_at: "2026-07-01T00:00:00.000Z" } }),
  });
  assert.deepEqual(items, [
    {
      slug: "gone.example.com",
      classification: "STALE_ORPHAN",
      published: true,
      publishable: false,
      review_status: null,
      evaluation_status: null,
      generated_at: null,
      reviewed_at: null,
      published_at: "2026-07-01T00:00:00.000Z",
      reasons: ["orphan"],
    },
  ]);
});

test("API Case4: 複数分類混在（stale が先、reportsCache 順、orphan は最後）", async () => {
  const reportsCache = [
    { id: "s1.example.com", review_status: "rejected", evaluation_status: "REVIEW", published: true, publishable: false },
    { id: "s2.example.com", review_status: "pending_review", evaluation_status: "FAIL", published: true, publishable: false },
  ];
  const items = await buildStaleReportItems(reportsCache, ["s1.example.com", "s2.example.com"], ["o1.example.com"], {
    classify: classifyStub({
      "s1.example.com": "STALE_UNPUBLISHABLE",
      "s2.example.com": "STALE_UNAPPROVED",
      "o1.example.com": "STALE_ORPHAN",
    }),
    loadReport: async () => ({ meta: { generated_at: "2026-09-01T00:00:00.000Z" } }),
    loadPublished: noPublished,
  });
  assert.deepEqual(items.map((i) => i.slug), ["s1.example.com", "s2.example.com", "o1.example.com"]);
  assert.deepEqual(items.map((i) => i.classification), ["STALE_UNPUBLISHABLE", "STALE_UNAPPROVED", "STALE_ORPHAN"]);
  assert.deepEqual(items.map((i) => i.reasons), [["evaluation_fail"], ["review_missing"], ["orphan"]]);
  assert.equal(items[1].evaluation_status, "FAIL");
  assert.equal(items[2].review_status, null);
});

test("API Case5: legacy summary（reportsCache に該当 id なし）でも空配列で壊れない / published_at 取得失敗は null", async () => {
  const emptyItems = await buildStaleReportItems([], [], [], { classify: classifyStub({}), loadReport: noReport, loadPublished: noPublished });
  assert.deepEqual(emptyItems, []);

  const items = await buildStaleReportItems([], ["only-published.example.com"], [], {
    classify: classifyStub({ "only-published.example.com": "STALE_AFTER_REGENERATION" }),
    loadReport: async () => ({ meta: {} }),
    loadPublished: async () => {
      throw new Error("S3 outage");
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].published_at, null);
  assert.equal(items[0].generated_at, null);
  assert.equal(items[0].published, true); // reportsCache に無い slug → published=true（stale slug 扱い）
  assert.equal(items[0].publishable, false);
});

// ===========================================================================
// UI — renderPublishedArtifactHealth（operations.js）
// ===========================================================================

test("UI Case A: Healthy（items 空）→ 緑カード・テーブルなし", () => {
  const html = ops.renderPublishedArtifactHealth({ ok: true, generated_at: "2026-09-11T00:00:00Z", published_stale: 0, published_orphan: 0, items: [] });
  assert.match(html, /id="published-artifact-health"/);
  assert.match(html, /No stale published artifacts detected\./);
  assert.match(html, /dash-alert tone-good/);
  assert.ok(!html.includes("<table"), "Healthy でテーブルを出さない");
  assert.match(html, /Published Stale/);
  assert.match(html, /Published Orphan/);
});

test("UI Case B: 件数ありは黄色 warning カード（赤ではない）+ テーブル", () => {
  const html = ops.renderPublishedArtifactHealth({
    ok: true,
    generated_at: "2026-09-11T00:00:00Z",
    published_stale: 1,
    published_orphan: 0,
    items: [{ slug: "example.com", classification: "STALE_AFTER_REGENERATION", review_status: "approved", evaluation_status: "PASS", published: true, reasons: ["freshness"] }],
  });
  assert.match(html, /dash-alert tone-warn/);
  assert.ok(!html.includes("tone-bad"), "赤（tone-bad）は使わない");
  assert.match(html, /<table[^>]*class="dash-table"/);
  assert.match(html, /Review them before the next deployment\./);
  assert.match(html, /value tone-warn">1</); // Published Stale の件数が warn
});

test("UI Case C: View Report リンクが /reports.html?slug=<slug> を指す", () => {
  const html = ops.renderPublishedArtifactHealth({
    ok: true,
    published_stale: 1,
    published_orphan: 0,
    items: [{ slug: "a.b-c.jp", classification: "STALE_UNAPPROVED", published: true, reasons: ["review_missing"] }],
  });
  assert.match(html, /<a href="\/reports\.html\?slug=a\.b-c\.jp">View Report<\/a>/);
});

test("UI Case D: classification は表示名へ変換（文字列自体は変えない）", () => {
  const cases = [
    ["DEPLOY_ELIGIBLE", "Healthy"],
    ["STALE_UNAPPROVED", "Review missing"],
    ["STALE_UNPUBLISHABLE", "Not publishable"],
    ["STALE_AFTER_REGENERATION", "Approved report became stale"],
    ["STALE_ORPHAN", "Missing current report"],
    ["STALE_UNREADABLE", "Published artifact unreadable"],
  ];
  for (const [raw, label] of cases) {
    assert.equal(ops.classificationLabel(raw), label);
    const html = ops.renderPublishedArtifactHealth({ ok: true, published_stale: 1, published_orphan: 0, items: [{ slug: "x", classification: raw, published: true, reasons: [] }] });
    assert.ok(html.includes(label), `${raw} → "${label}" が表示されるべき`);
  }
});

test("UI Case E: slug 一覧の順序を維持し、行を取り違えない", () => {
  const html = ops.renderPublishedArtifactHealth({
    ok: true,
    published_stale: 2,
    published_orphan: 1,
    items: [
      { slug: "alpha.example", classification: "STALE_UNPUBLISHABLE", review_status: "rejected", published: true, reasons: ["evaluation_fail"] },
      { slug: "bravo.example", classification: "STALE_UNAPPROVED", review_status: "pending_review", published: true, reasons: ["review_missing"] },
      { slug: "charlie.example", classification: "STALE_ORPHAN", published: true, reasons: ["orphan"] },
    ],
  });
  const iA = html.indexOf("alpha.example");
  const iB = html.indexOf("bravo.example");
  const iC = html.indexOf("charlie.example");
  assert.ok(iA > -1 && iA < iB && iB < iC, "行順が items 順どおり");
  // alpha の行に bravo の classification が混ざらない
  const rowA = html.slice(html.indexOf("<td>alpha.example"), html.indexOf("<td>bravo.example"));
  assert.ok(rowA.includes("Not publishable") && !rowA.includes("Review missing"));
});

test("UI: {ok:false} / section error は dash-section-error（テーブルなし）", () => {
  assert.match(ops.renderPublishedArtifactHealth({ ok: false, error: "boom" }), /dash-section-error/);
  assert.match(ops.renderPublishedArtifactHealth({ status: "error", message: "x" }), /dash-section-error/);
  assert.ok(!ops.renderPublishedArtifactHealth({ ok: false, error: "boom" }).includes("<table"));
});

test("UI: renderOperations に Published Artifact Health セクションが含まれる（System Status の後）", () => {
  const html = ops.renderOperations({
    health: { status: "ok" },
    dashboard: { report_summary: {}, lead_summary: {} },
    reports: [],
    staleReports: { ok: true, published_stale: 0, published_orphan: 0, items: [] },
  });
  assert.match(html, /Published Artifact Health/);
  assert.ok(html.indexOf("System Status") < html.indexOf("Published Artifact Health"));
});

// Phase59 STEP6: Published Artifact Audit Summary（新セクション）と、Phase58 STEP7 由来の
// Published Artifact Health（個社詳細）セクションが共存し、順序が壊れないことを確認する
// （このファイルは Published Artifact Health の順序を扱う唯一のテストファイルのため、
// STEP6 の新セクションとの同期確認をここに 1 件追加する）。
test("UI: renderOperations — Published Artifact Audit Summary（STEP6）は Published Artifact Health（STEP7）より前に出る", () => {
  const html = ops.renderOperations({
    health: { status: "ok" },
    dashboard: { report_summary: {}, lead_summary: {} },
    reports: [],
    staleReports: { ok: true, published_stale: 0, published_orphan: 0, items: [] },
    remediationPlan: { ok: true, summary: { published_stale: 0, published_orphan: 0, recommended_republish: 0, recommended_unpublish: 0 }, items: [] },
    operationalHealth: {
      ok: true,
      status: "success",
      summary: {
        deploy_ready: true, deploy_blocked: false, published_stale: 0, published_orphan: 0,
        recommended_republish: 0, recommended_unpublish: 0,
        generated_reports: 9, approved_reports: 5, published_reports: 4,
      },
    },
  });
  assert.match(html, /Published Artifact Audit Summary/);
  assert.match(html, /Published Artifact Health/);
  assert.ok(
    html.indexOf("Published Artifact Audit Summary") < html.indexOf("Published Artifact Health"),
    "Audit Summary（STEP6）は既存の Published Artifact Health（STEP7）より前に出る"
  );
});
