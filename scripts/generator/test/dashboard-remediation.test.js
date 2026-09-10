/**
 * dashboard-remediation.test.js — Phase58 STEP8。
 *
 * Backend: website/aor-admin/server.js の buildRemediationItems() / remediationForClassification()
 *   （純粋関数。classification → 推奨アクションの表マッピングのみ。判定ロジックは持たない）。
 * UI:      website/aor-admin/public/assets/js/operations.js の
 *          renderRemediationSummary() / renderPublishedArtifactHealth(data, remediation) /
 *          renderRemediationExplanation() / riskBadge()。
 *
 * classification は deploy-aor-web.js の reconciliation helper（DI モックで固定）に委譲する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const server = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "server.js"));
const ops = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "operations.js"));

const { buildRemediationItems, remediationForClassification } = server;

function classifyStub(map) {
  return async (slug) => ({ classification: map[slug] || "STALE_UNPUBLISHABLE" });
}
const noReport = async () => null;
const noPublished = async () => null;

function itemFor(classification, extra) {
  const reportsCache = [
    { id: "s.example.com", company_name: "S", review_status: "approved", evaluation_status: "PASS", publishable: false, published: true, reviewed_at: "2026-08-01T00:00:00.000Z" },
  ];
  return buildRemediationItems(reportsCache, ["s.example.com"], [], {
    classify: classifyStub({ "s.example.com": classification }),
    loadReport: async () => ({ meta: { generated_at: "2026-09-01T00:00:00.000Z" } }),
    loadPublished: async () => ({ meta: { published_at: "2026-08-15T00:00:00.000Z" } }),
    ...(extra || {}),
  });
}

// ===========================================================================
// API — remediationForClassification / buildRemediationItems
// ===========================================================================

test("remediationForClassification: 表マッピングのみ（§3）", () => {
  assert.deepEqual(remediationForClassification("STALE_AFTER_REGENERATION"), {
    recommended_action: "REPUBLISH_AFTER_APPROVAL",
    action_label: "Approve current report then publish",
    risk: "warning",
    reason: "Current report is newer than the approved published artifact.",
  });
  assert.equal(remediationForClassification("STALE_UNAPPROVED").recommended_action, "COMPLETE_REVIEW_FIRST");
  assert.equal(remediationForClassification("STALE_UNPUBLISHABLE").recommended_action, "FIX_REPORT_AND_REGENERATE");
  assert.equal(remediationForClassification("STALE_ORPHAN").recommended_action, "UNPUBLISH_ARTIFACT");
  assert.equal(remediationForClassification("STALE_ORPHAN").risk, "danger");
  assert.equal(remediationForClassification("STALE_UNREADABLE").recommended_action, "REBUILD_PUBLISHED_ARTIFACT");
  assert.equal(remediationForClassification("STALE_UNREADABLE").risk, "danger");
  assert.equal(remediationForClassification("DEPLOY_ELIGIBLE").recommended_action, "NONE");
  assert.equal(remediationForClassification("DEPLOY_ELIGIBLE").risk, "success");
  // 未知 classification は安全側（NONE）
  assert.equal(remediationForClassification("???").recommended_action, "NONE");
});

test("API Case1: Healthy（stale/orphan なし）→ items 空", async () => {
  const items = await buildRemediationItems([{ id: "a.example.com", published: true, publishable: true }], [], [], {
    classify: classifyStub({}),
    loadReport: noReport,
    loadPublished: noPublished,
  });
  assert.deepEqual(items, []);
});

test("API Case2: Freshness stale → REPUBLISH_AFTER_APPROVAL / warning、item 形状固定（§2）", async () => {
  const items = await itemFor("STALE_AFTER_REGENERATION");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    slug: "s.example.com",
    classification: "STALE_AFTER_REGENERATION",
    recommended_action: "REPUBLISH_AFTER_APPROVAL",
    action_label: "Approve current report then publish",
    risk: "warning",
    reason: "Current report is newer than the approved published artifact.",
    current_publishable: false,
    published: true,
    published_at: "2026-08-15T00:00:00.000Z",
    generated_at: "2026-09-01T00:00:00.000Z",
    reviewed_at: "2026-08-01T00:00:00.000Z",
  });
});

test("API Case3: Missing review → COMPLETE_REVIEW_FIRST / warning", async () => {
  const items = await itemFor("STALE_UNAPPROVED");
  assert.equal(items[0].recommended_action, "COMPLETE_REVIEW_FIRST");
  assert.equal(items[0].risk, "warning");
});

test("API Case4: Evaluation fail → FIX_REPORT_AND_REGENERATE / warning", async () => {
  const items = await itemFor("STALE_UNPUBLISHABLE");
  assert.equal(items[0].recommended_action, "FIX_REPORT_AND_REGENERATE");
  assert.equal(items[0].risk, "warning");
});

test("API Case5: Orphan → UNPUBLISH_ARTIFACT / danger（current report なし）", async () => {
  const items = await buildRemediationItems([], [], ["gone.example.com"], {
    classify: classifyStub({ "gone.example.com": "STALE_ORPHAN" }),
    loadReport: async () => {
      throw new Error("orphan では呼ばれないはず");
    },
    loadPublished: async () => ({ meta: { published_at: "2026-07-01T00:00:00.000Z" } }),
  });
  assert.equal(items[0].recommended_action, "UNPUBLISH_ARTIFACT");
  assert.equal(items[0].risk, "danger");
  assert.equal(items[0].current_publishable, false);
  assert.equal(items[0].generated_at, null);
  assert.equal(items[0].reviewed_at, null);
});

test("API Case6: Unreadable → REBUILD_PUBLISHED_ARTIFACT / danger", async () => {
  const items = await itemFor("STALE_UNREADABLE");
  assert.equal(items[0].recommended_action, "REBUILD_PUBLISHED_ARTIFACT");
  assert.equal(items[0].risk, "danger");
});

test("API: summary の recommended_republish / recommended_unpublish は該当 action の件数", async () => {
  const items = await buildRemediationItems(
    [
      { id: "r1.example.com", published: true, publishable: false },
      { id: "r2.example.com", published: true, publishable: false },
    ],
    ["r1.example.com", "r2.example.com"],
    ["o1.example.com"],
    {
      classify: classifyStub({
        "r1.example.com": "STALE_AFTER_REGENERATION",
        "r2.example.com": "STALE_AFTER_REGENERATION",
        "o1.example.com": "STALE_ORPHAN",
      }),
      loadReport: async () => ({ meta: {} }),
      loadPublished: noPublished,
    }
  );
  const republish = items.filter((i) => i.recommended_action === "REPUBLISH_AFTER_APPROVAL").length;
  const unpublish = items.filter((i) => i.recommended_action === "UNPUBLISH_ARTIFACT").length;
  assert.equal(republish, 2);
  assert.equal(unpublish, 1);
});

// ===========================================================================
// UI — operations.js
// ===========================================================================

const REM = {
  ok: true,
  generated_at: "2026-09-11T00:00:00Z",
  summary: { published_stale: 2, published_orphan: 1, recommended_republish: 1, recommended_unpublish: 1 },
  items: [
    { slug: "a.example", classification: "STALE_AFTER_REGENERATION", recommended_action: "REPUBLISH_AFTER_APPROVAL", action_label: "Approve current report then publish", risk: "warning", published: true },
    { slug: "b.example", classification: "STALE_UNPUBLISHABLE", recommended_action: "FIX_REPORT_AND_REGENERATE", action_label: "Fix report quality then regenerate", risk: "warning", published: true },
    { slug: "c.example", classification: "STALE_ORPHAN", recommended_action: "UNPUBLISH_ARTIFACT", action_label: "Unpublish stale artifact", risk: "danger", published: true },
  ],
};
const STALE = {
  ok: true,
  generated_at: "2026-09-11T00:00:00Z",
  published_stale: 2,
  published_orphan: 1,
  items: [
    { slug: "a.example", classification: "STALE_AFTER_REGENERATION", review_status: "approved", evaluation_status: "PASS", published: true, reasons: ["freshness"] },
    { slug: "b.example", classification: "STALE_UNPUBLISHABLE", review_status: "rejected", evaluation_status: "REVIEW", published: true, reasons: ["evaluation_fail"] },
    { slug: "c.example", classification: "STALE_ORPHAN", review_status: null, evaluation_status: null, published: true, reasons: ["orphan"] },
  ],
};

test("UI: Remediation Summary カード — 4 カウントを表示（tone 色付き）", () => {
  const html = ops.renderRemediationSummary(REM);
  assert.match(html, /Published Artifact Remediation Summary/);
  assert.match(html, /Published Stale/);
  assert.match(html, /Published Orphan/);
  assert.match(html, /Recommended Re-publish/);
  assert.match(html, /Recommended Unpublish/);
  assert.match(html, /value tone-warn">2</); // published_stale
  assert.match(html, /value tone-bad">1</); // published_orphan or recommended_unpublish
});

test("UI: Remediation Summary — legacy / error は非表示（空文字）", () => {
  assert.equal(ops.renderRemediationSummary(undefined), "");
  assert.equal(ops.renderRemediationSummary({ ok: false, error: "x" }), "");
  assert.equal(ops.renderRemediationSummary({ status: "error", message: "x" }), "");
});

test("UI: riskBadge — success/warning/danger を既存 status-pill クラスへ（新CSSなし）", () => {
  assert.match(ops.riskBadge("success"), /status-pill status-approved">success</);
  assert.match(ops.riskBadge("warning"), /status-pill status-needs_revision">warning</);
  assert.match(ops.riskBadge("danger"), /status-pill status-rejected">danger</);
});

test("UI: Health テーブルに remediation があると Recommended Action / Risk 列が増える", () => {
  const html = ops.renderPublishedArtifactHealth(STALE, REM);
  assert.match(html, /<th>Recommended Action<\/th><th>Risk<\/th>/);
  assert.match(html, /Approve current report then publish/);
  assert.match(html, /Fix report quality then regenerate/);
  assert.match(html, /Unpublish stale artifact/);
  assert.match(html, /status-pill status-needs_revision">warning</); // a/b の risk
  assert.match(html, /status-pill status-rejected">danger</); // c の risk
  // 行の取り違えなし: a の行に「Unpublish stale artifact」が来ない
  const rowA = html.slice(html.indexOf("<td>a.example"), html.indexOf("<td>b.example"));
  assert.ok(!rowA.includes("Unpublish stale artifact"));
});

test("UI: remediation なし（legacy）は従来 7 列のまま（Recommended Action / Risk 列なし）", () => {
  const html = ops.renderPublishedArtifactHealth(STALE);
  assert.ok(!html.includes("Recommended Action"));
  assert.ok(!html.includes("<th>Risk</th>"));
  // 既存列は残る
  assert.match(html, /<th>Slug<\/th>/);
  assert.match(html, /<th>Classification<\/th>/);
});

test("UI: Explanation Panel — 5 つの推奨アクション説明を表示、実行ボタンなし", () => {
  const html = ops.renderRemediationExplanation();
  assert.match(html, /Recommended actions/);
  for (const label of [
    "Approve current report then publish",
    "Complete review before publish",
    "Fix report quality then regenerate",
    "Unpublish stale artifact",
    "Rebuild unreadable artifact",
  ]) {
    assert.ok(html.includes(label), `${label} が説明にない`);
  }
  assert.ok(!/<button/.test(html), "説明パネルにボタンを置かない");
});

test("UI: renderOperations — Summary カードが最上部、Explanation が最下部", () => {
  const html = ops.renderOperations({
    health: { status: "ok" },
    dashboard: { report_summary: {}, lead_summary: {} },
    reports: [],
    staleReports: STALE,
    remediationPlan: REM,
  });
  assert.ok(html.indexOf("Published Artifact Remediation Summary") < html.indexOf("System Status"), "Summary は最上部");
  assert.ok(html.indexOf("Recommended actions") > html.indexOf("Published Artifact Health"), "Explanation は下部");
  assert.match(html, /<th>Recommended Action<\/th>/);
  // 実行ボタン（Publish/Unpublish/Approve/Deploy）は Remediation セクションに無い
  const summarySection = html.slice(html.indexOf("Published Artifact Remediation Summary"), html.indexOf("System Status"));
  assert.ok(!/<button/.test(summarySection));
});

test("UI: renderOperations — remediationPlan なしでも壊れない（Summary/追加列なし、既存表示は正常）", () => {
  const html = ops.renderOperations({
    health: { status: "ok" },
    dashboard: { report_summary: {}, lead_summary: {} },
    reports: [],
    staleReports: STALE,
  });
  assert.ok(!html.includes("Published Artifact Remediation Summary"));
  assert.ok(!html.includes("Recommended Action"));
  assert.match(html, /Published Artifact Health/);
  assert.match(html, /Recommended actions/); // Explanation は静的なので常に出る
  assert.ok(!html.includes("undefined") && !html.includes("NaN"));
});
