/**
 * dashboard-aggregates.test.js — scripts/generator/shared/dashboard-aggregates.js の自動テスト
 * （Phase52 STEP3）。
 *
 * 集計ロジックは options.leads（依存性注入。他モジュールの options.client /
 * options.sendEmail と同じパターン）へ合成 Lead を渡して決定論的に検証する。
 * AWS へは一切接続しない。filesystem Lead ストアにも書き込まない
 * （＝並列テスト実行時の共有状態レースを持ち込まない）。
 * 末尾に「注入なし＝実ストア読み取り」の疎通確認を1件だけ置く。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  collectLeadSummary,
  collectDeliverySummary,
  collectSuppressionSummary,
  collectReportSummary,
  findLatestHistory,
} = require("../shared/dashboard-aggregates");

/** @param {Partial<Object>} o */
function lead(o = {}) {
  return {
    lead_id: `L-${Math.random().toString(36).slice(2)}`,
    delivery_status: "active",
    delivery_approval_status: "pending",
    history: [],
    ...o,
  };
}

// ---------------------------------------------------------------------------
// collectLeadSummary
// ---------------------------------------------------------------------------

test("collectLeadSummary: delivery_status / delivery_approval_status 別に数える", async () => {
  const leads = [
    lead({ delivery_status: "active", delivery_approval_status: "approved" }),
    lead({ delivery_status: "active", delivery_approval_status: "pending" }),
    lead({ delivery_status: "unsubscribed", delivery_approval_status: "approved" }),
    lead({ delivery_status: "bounced", delivery_approval_status: "pending" }),
    lead({ delivery_status: "suppressed", delivery_approval_status: "rejected" }),
  ];
  const s = await collectLeadSummary({ leads });
  assert.deepEqual(s, {
    total: 5,
    active: 2,
    unsubscribed: 1,
    bounced: 1,
    suppressed: 1,
    pending_approval: 2,
  });
});

test("collectLeadSummary: 空でも 0 埋めで返す", async () => {
  const s = await collectLeadSummary({ leads: [] });
  assert.deepEqual(s, { total: 0, active: 0, unsubscribed: 0, bounced: 0, suppressed: 0, pending_approval: 0 });
});

// ---------------------------------------------------------------------------
// collectDeliverySummary
// ---------------------------------------------------------------------------

test("collectDeliverySummary: history の配信系イベントを累計・24h で数える", async () => {
  const now = Date.parse("2026-09-06T00:00:00Z");
  const recent = "2026-09-05T12:00:00Z"; // now-12h → 24h ウィンドウ内
  const old = "2026-09-03T00:00:00Z"; //  now-72h → 24h ウィンドウ外
  const leads = [
    lead({
      history: [
        { at: old, event: "initial_report_sent", metadata: { message_id: "a" } },
        { at: recent, event: "weekly_report_sent", metadata: { message_id: "b" } },
        { at: recent, event: "email_delivered", metadata: { message_id: "b" } },
        { at: old, event: "email_delivered", metadata: { message_id: "a" } },
        { at: recent, event: "email_bounced", metadata: { bounce_type: "Permanent" } },
        { at: recent, event: "paid_report_requested", metadata: null },
      ],
    }),
    lead({
      history: [
        { at: recent, event: "email_complaint", metadata: { complaint_feedback_type: "abuse" } },
        { at: old, event: "weekly_report_failed", metadata: { error: "x" } },
        { at: recent, event: "initial_report_failed", metadata: { error: "y" } },
      ],
    }),
  ];

  const s = await collectDeliverySummary({ leads, now });
  assert.equal(s.initial_sent, 1);
  assert.equal(s.initial_failed, 1);
  assert.equal(s.weekly_sent, 1);
  assert.equal(s.weekly_failed, 1);
  assert.equal(s.delivered, 2);
  assert.equal(s.bounced, 1);
  assert.equal(s.complaints, 1);
  assert.equal(s.paid_requested, 1);
  assert.deepEqual(s.last_24h, { delivered: 1, bounced: 1, complaints: 1 });
});

test("collectDeliverySummary: 未知イベント・at 欠落は無視。空 history で 0", async () => {
  const s = await collectDeliverySummary({
    leads: [lead({ history: [{ event: "collected" }, { event: "email_delivered" /* at なし */ }] }), lead()],
    now: Date.now(),
  });
  assert.equal(s.delivered, 1); // 累計はカウント
  assert.equal(s.last_24h.delivered, 0); // at が無いので 24h には入らない
});

// ---------------------------------------------------------------------------
// collectSuppressionSummary
// ---------------------------------------------------------------------------

test("collectSuppressionSummary: ブロック中 Lead を理由別に分類する", async () => {
  const leads = [
    lead({ delivery_status: "unsubscribed", history: [{ at: "2026-01-02T00:00:00Z", event: "unsubscribed", metadata: { trigger: "url" } }] }),
    lead({ delivery_status: "bounced", history: [{ at: "2026-01-02T00:00:00Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } }] }), // SES
    lead({ delivery_status: "bounced", history: [{ at: "2026-01-02T00:00:00Z", event: "email_bounced", metadata: { provider: "blastengine", event_type: "HARDERROR" } }] }),
    lead({ delivery_status: "bounced", history: [{ at: "2026-01-02T00:00:00Z", event: "email_bounced", metadata: { provider: "blastengine", event_type: "DROP" } }] }),
    lead({ delivery_status: "suppressed", history: [{ at: "2026-01-02T00:00:00Z", event: "email_complaint", metadata: {} }] }),
    lead({ delivery_status: "suppressed", history: [] }), // 根拠イベントなし → manual
  ];
  const s = await collectSuppressionSummary({ leads });
  assert.deepEqual(s, { unsubscribe: 1, bounce: 1, complaint: 1, harderror: 1, drop: 1, manual: 1 });
});

test("collectSuppressionSummary: active な Lead は history に bounce があっても数えない", async () => {
  const s = await collectSuppressionSummary({
    leads: [lead({ delivery_status: "active", history: [{ at: "2026-01-01T00:00:00Z", event: "email_bounced", metadata: { bounce_type: "Transient" } }] })],
  });
  assert.deepEqual(s, { unsubscribe: 0, bounce: 0, complaint: 0, harderror: 0, drop: 0, manual: 0 });
});

test("collectSuppressionSummary: 現在の delivery_status を作った最後のイベントで判定（bounce→complaint 上書き）", async () => {
  const s = await collectSuppressionSummary({
    leads: [
      lead({
        delivery_status: "suppressed",
        history: [
          { at: "2026-01-01T00:00:00Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } },
          { at: "2026-01-02T00:00:00Z", event: "email_complaint", metadata: {} },
        ],
      }),
    ],
  });
  assert.equal(s.complaint, 1);
  assert.equal(s.bounce, 0);
});

// ---------------------------------------------------------------------------
// collectReportSummary
// ---------------------------------------------------------------------------

test("collectReportSummary: reportsCache と slug 差集合から deploy_pending を計算する", () => {
  const s = collectReportSummary({
    reportsCache: [
      { id: "a.example.com", review_status: "approved", published: true },
      { id: "b.example.com", review_status: "approved", published: true },
      { id: "c.example.com", review_status: "pending_review", published: false },
    ],
    publishedBackendSlugs: ["a.example.com", "b.example.com"],
    webDeployedSlugs: ["a.example.com", "company-01-manufacturing"],
  });
  assert.equal(s.generated, 3);
  assert.equal(s.approved, 2);
  assert.equal(s.published_backend, 2);
  assert.equal(s.web_deployed, 2);
  assert.equal(s.deploy_pending, 1);
  assert.deepEqual(s.pending_slugs, ["b.example.com"]);
});

test("collectReportSummary: web slug 一覧が取れないと web_deployed / deploy_pending は null", () => {
  const s = collectReportSummary({
    reportsCache: [{ id: "a.example.com", review_status: "approved", published: true }],
    publishedBackendSlugs: ["a.example.com"],
    webDeployedSlugs: null,
  });
  assert.equal(s.published_backend, 1);
  assert.equal(s.web_deployed, null);
  assert.equal(s.deploy_pending, null);
  assert.deepEqual(s.pending_slugs, []);
});

test("collectReportSummary: publishedBackendSlugs 未取得時は reportsCache.published で代用", () => {
  const s = collectReportSummary({
    reportsCache: [
      { id: "a.example.com", review_status: "approved", published: true },
      { id: "b.example.com", review_status: "approved", published: false },
    ],
    publishedBackendSlugs: null,
    webDeployedSlugs: ["a.example.com"],
  });
  assert.equal(s.published_backend, 1);
  assert.equal(s.deploy_pending, 0);
});

// ---------------------------------------------------------------------------
// findLatestHistory
// ---------------------------------------------------------------------------

test("findLatestHistory: 新しい順に最初の一致を返す", () => {
  const l = {
    history: [
      { at: "2026-01-01T00:00:00Z", event: "collected" },
      { at: "2026-01-02T00:00:00Z", event: "email_bounced", metadata: { bounce_type: "Transient" } },
      { at: "2026-01-03T00:00:00Z", event: "email_bounced", metadata: { bounce_type: "Permanent" } },
    ],
  };
  assert.equal(findLatestHistory(l, (e) => e === "email_bounced").metadata.bounce_type, "Permanent");
  assert.equal(findLatestHistory(l, (e) => e === "unsubscribed"), null);
  assert.equal(findLatestHistory({}, () => true), null);
});

// ---------------------------------------------------------------------------
// 実ストア疎通（注入なし）— 例外を投げずに集計結果の形を返すことだけ確認する
// ---------------------------------------------------------------------------

test("注入なしで実 Lead ストアから集計できる（形の確認のみ、件数は環境依存）", async () => {
  const [ls, ds, ss] = await Promise.all([
    collectLeadSummary(),
    collectDeliverySummary(),
    collectSuppressionSummary(),
  ]);
  for (const k of ["total", "active", "unsubscribed", "bounced", "suppressed", "pending_approval"]) {
    assert.equal(typeof ls[k], "number");
  }
  assert.equal(typeof ds.delivered, "number");
  assert.ok(ds.last_24h && typeof ds.last_24h.delivered === "number");
  for (const k of ["unsubscribe", "bounce", "complaint", "harderror", "drop", "manual"]) {
    assert.equal(typeof ss[k], "number");
  }
});
