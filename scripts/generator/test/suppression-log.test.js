/**
 * suppression-log.test.js — scripts/generator/shared/suppression-log.js（Phase52 STEP7）。
 * options.leads の DI で合成 Lead を渡す（dashboard-aggregates / delivery-log と同じ方針）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { collectSuppressions, sourceEventLabel, suppressionTimeline, REASON_PROVIDER } = require("../shared/suppression-log");
const { classifySuppression } = require("../shared/dashboard-aggregates");

function lead(o = {}) {
  return Object.assign(
    {
      lead_id: "L1",
      email: "info@example.co.jp",
      company_url: "https://example.co.jp",
      company_slug: "example.co.jp",
      delivery_status: "active",
      delivery_approval_status: "approved",
      history: [],
    },
    o
  );
}

test("REASON_PROVIDER: §22 の対応表どおり（bounce/complaint=ses, harderror/drop=blastengine, unsubscribe=user, manual=manual）", () => {
  assert.deepEqual(REASON_PROVIDER, {
    unsubscribe: "user",
    bounce: "ses",
    complaint: "ses",
    harderror: "blastengine",
    drop: "blastengine",
    manual: "manual",
  });
});

test("classifySuppression（共有ロジック）: 最後の suppression イベントで理由が決まる", () => {
  assert.equal(classifySuppression(lead({ history: [{ at: "t1", event: "unsubscribed", metadata: {} }] })).reason, "unsubscribe");
  assert.equal(classifySuppression(lead({ history: [{ at: "t1", event: "email_complaint", metadata: {} }] })).reason, "complaint");
  assert.equal(classifySuppression(lead({ history: [{ at: "t1", event: "email_bounced", metadata: {} }] })).reason, "bounce");
  assert.equal(classifySuppression(lead({ history: [{ at: "t1", event: "email_bounced", metadata: { event_type: "HARDERROR" } }] })).reason, "harderror");
  assert.equal(classifySuppression(lead({ history: [{ at: "t1", event: "email_bounced", metadata: { event_type: "DROP" } }] })).reason, "drop");
  assert.equal(classifySuppression(lead({ history: [] })).reason, "manual");
});

test("sourceEventLabel: HARDERROR/DROP は括弧付き、実イベント名は保持", () => {
  assert.equal(sourceEventLabel({ event: "unsubscribed" }), "unsubscribed");
  assert.equal(sourceEventLabel({ event: "email_bounced", metadata: { event_type: "HARDERROR" } }), "email_bounced(HARDERROR)");
  assert.equal(sourceEventLabel({ event: "email_bounced", metadata: {} }), "email_bounced");
  assert.equal(sourceEventLabel(null), "manual");
});

test("suppressionTimeline: 配信〜停止関連イベントのみ、metadata は sanitize、順序は保持", () => {
  const l = lead({
    history: [
      { at: "t1", event: "collected", metadata: {} }, // 除外
      { at: "t2", event: "initial_report_sent", metadata: { message_id: "m", report_token: "SECRET" } },
      { at: "t3", event: "email_bounced", metadata: { bounce_type: "Permanent" } },
    ],
  });
  const tl = suppressionTimeline(l);
  assert.deepEqual(tl.map((e) => e.event), ["initial_report_sent", "email_bounced"]);
  assert.equal("report_token" in tl[0].metadata, false);
  assert.equal(tl[0].metadata.message_id, "m");
});

test("collectSuppressions: isDeliveryBlocked な Lead のみ、blocked_at 降順、provider は理由から", async () => {
  const leads = [
    lead({ lead_id: "A", email: "a@a.jp", delivery_status: "active", history: [{ at: "2026-09-01T00:00:00Z", event: "email_delivered", metadata: {} }] }), // ブロックされていない → 除外
    lead({
      lead_id: "B",
      email: "b@b.jp",
      delivery_status: "unsubscribed",
      history: [
        { at: "2026-09-02T00:00:00Z", event: "initial_report_sent", metadata: { message_id: "m1" } },
        { at: "2026-09-03T00:00:00Z", event: "unsubscribed", metadata: { trigger: "url_opt_out", applied_by: "unsubscribe-url" } },
      ],
    }),
    lead({
      lead_id: "C",
      email: "c@c.jp",
      delivery_status: "bounced",
      history: [{ at: "2026-09-05T00:00:00Z", event: "email_bounced", metadata: { provider: "blastengine", event_type: "HARDERROR", delivery_id: "d1" } }],
    }),
  ];
  const rows = await collectSuppressions({ leads });
  assert.equal(rows.length, 2);
  // blocked_at 降順 → C（09-05）が先頭
  assert.equal(rows[0].lead_id, "C");
  assert.equal(rows[0].reason, "harderror");
  assert.equal(rows[0].provider, "blastengine");
  assert.equal(rows[0].source_event, "email_bounced(HARDERROR)");
  assert.equal(rows[0].blocked_at, "2026-09-05T00:00:00Z");

  assert.equal(rows[1].lead_id, "B");
  assert.equal(rows[1].reason, "unsubscribe");
  assert.equal(rows[1].provider, "user");
  assert.equal(rows[1].source_event, "unsubscribed");
  // timeline は初回送信〜停止まで
  assert.deepEqual(rows[1].timeline.map((e) => e.event), ["initial_report_sent", "unsubscribed"]);
});

test("collectSuppressions: suppressed だが該当イベント無し → manual / provider manual / blocked_at null", async () => {
  const rows = await collectSuppressions({
    leads: [lead({ lead_id: "M", delivery_status: "suppressed", history: [{ at: "2026-09-01T00:00:00Z", event: "collected", metadata: {} }] })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "manual");
  assert.equal(rows[0].provider, "manual");
  assert.equal(rows[0].source_event, "manual");
  assert.equal(rows[0].blocked_at, null);
});

test("collectSuppressions と collectSuppressionSummary は同じ分類（件数一致）", async () => {
  const { collectSuppressionSummary } = require("../shared/dashboard-aggregates");
  const leads = [
    lead({ delivery_status: "unsubscribed", history: [{ at: "t", event: "unsubscribed", metadata: {} }] }),
    lead({ delivery_status: "bounced", history: [{ at: "t", event: "email_bounced", metadata: {} }] }),
    lead({ delivery_status: "bounced", history: [{ at: "t", event: "email_bounced", metadata: { event_type: "DROP" } }] }),
    lead({ delivery_status: "active", history: [] }),
  ];
  const rows = await collectSuppressions({ leads });
  const summary = await collectSuppressionSummary({ leads });
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.reason === "unsubscribe").length, summary.unsubscribe);
  assert.equal(rows.filter((r) => r.reason === "bounce").length, summary.bounce);
  assert.equal(rows.filter((r) => r.reason === "drop").length, summary.drop);
});
