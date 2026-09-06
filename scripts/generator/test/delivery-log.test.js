/**
 * delivery-log.test.js — scripts/generator/shared/delivery-log.js（Phase52 STEP6）。
 * collectDeliveries は options.leads の DI で合成 Lead を渡してテストする
 * （dashboard-aggregates.test.js と同じ方針。ファイルシステムに触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { collectDeliveries, sanitizeMetadata, resolveTypeProvider, buildSendIndex } = require("../shared/delivery-log");

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

test("sanitizeMetadata: token/secret/credential/api_key/authorization 系キーを落とす", () => {
  const out = sanitizeMetadata({
    message_id: "abc",
    report_token: "SECRET",
    api_key: "SECRET",
    apiKey: "SECRET",
    authorization: "SECRET",
    aws_credential: "SECRET",
    bounce_type: "Permanent",
  });
  assert.deepEqual(Object.keys(out).sort(), ["bounce_type", "message_id"]);
});

test("buildSendIndex: *_report_sent の message_id → {type, provider}", () => {
  const idx = buildSendIndex([
    lead({ history: [{ at: "t1", event: "initial_report_sent", metadata: { message_id: "m-init" } }] }),
    lead({ history: [{ at: "t2", event: "weekly_report_sent", metadata: { message_id: "m-week" } }] }),
  ]);
  assert.deepEqual(idx.get("m-init"), { type: "initial", provider: "blastengine" });
  assert.deepEqual(idx.get("m-week"), { type: "weekly", provider: "ses" });
});

test("resolveTypeProvider: Initial系→blastengine、Weekly系→ses", () => {
  const idx = new Map();
  assert.deepEqual(resolveTypeProvider({ event: "initial_report_queued", metadata: {} }, idx), { type: "initial", provider: "blastengine" });
  assert.deepEqual(resolveTypeProvider({ event: "initial_report_failed", metadata: {} }, idx), { type: "initial", provider: "blastengine" });
  assert.deepEqual(resolveTypeProvider({ event: "weekly_report_sent", metadata: {} }, idx), { type: "weekly", provider: "ses" });
});

test("resolveTypeProvider: email_bounced + metadata.provider=blastengine → initial/blastengine", () => {
  const r = resolveTypeProvider({ event: "email_bounced", metadata: { provider: "blastengine", event_type: "HARDERROR" } }, new Map());
  assert.deepEqual(r, { type: "initial", provider: "blastengine" });
});

test("resolveTypeProvider: email_delivered は既定 ses、message_id が送信に一致すれば type を継承", () => {
  const idx = new Map([["m-week", { type: "weekly", provider: "ses" }]]);
  assert.deepEqual(resolveTypeProvider({ event: "email_delivered", metadata: { message_id: "m-week" } }, idx), { type: "weekly", provider: "ses" });
  // 未知の message_id は type を推測しない（null）
  assert.deepEqual(resolveTypeProvider({ event: "email_delivered", metadata: { message_id: "unknown" } }, idx), { type: null, provider: "ses" });
});

test("collectDeliveries: 配信系イベントのみ抽出、at 降順、identity を付与", async () => {
  const leads = [
    lead({
      lead_id: "L1",
      email: "a@alpha.co.jp",
      history: [
        { at: "2026-09-01T00:00:00Z", event: "collected", metadata: {} }, // 非配信 → 除外
        { at: "2026-09-01T01:00:00Z", event: "initial_report_queued", metadata: {} },
        { at: "2026-09-01T02:00:00Z", event: "initial_report_sent", metadata: { message_id: "m1" } },
        { at: "2026-09-01T03:00:00Z", event: "email_bounced", metadata: { provider: "blastengine", event_type: "HARDERROR", delivery_id: "m1" } },
      ],
    }),
    lead({
      lead_id: "L2",
      email: "b@beta.co.jp",
      delivery_status: "active",
      history: [{ at: "2026-09-02T00:00:00Z", event: "weekly_report_sent", metadata: { message_id: "m2", report_generated_at: "2026-08-01T00:00:00Z" } }],
    }),
  ];
  const rows = await collectDeliveries({ leads });
  assert.equal(rows.length, 4);
  // at 降順 → 先頭は L2 の weekly（2026-09-02）
  assert.equal(rows[0].event, "weekly_report_sent");
  assert.equal(rows[0].type, "weekly");
  assert.equal(rows[0].provider, "ses");
  assert.equal(rows[0].outcome, "sent");
  assert.equal(rows[0].email, "b@beta.co.jp");
  // L1 の bounce
  const bounce = rows.find((r) => r.event === "email_bounced");
  assert.equal(bounce.outcome, "bounced");
  assert.equal(bounce.provider, "blastengine");
  assert.equal(bounce.type, "initial");
  assert.equal(bounce.lead_id, "L1");
  assert.equal(bounce.delivery_status, "active");
});

test("collectDeliveries: history が無い Lead は行を生まない、metadata は sanitize 済み", async () => {
  const rows = await collectDeliveries({
    leads: [
      lead({ history: [] }),
      lead({ lead_id: "L9", history: [{ at: "2026-09-01T00:00:00Z", event: "initial_report_sent", metadata: { message_id: "x", report_token: "SECRET" } }] }),
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metadata.message_id, "x");
  assert.equal("report_token" in rows[0].metadata, false);
});

test("collectDeliveries: outcome マッピング（queued/sent/failed/delivered/opened/clicked/bounced/complaint）", async () => {
  const events = [
    ["initial_report_queued", "queued"],
    ["initial_report_sent", "sent"],
    ["initial_report_failed", "failed"],
    ["weekly_report_sent", "sent"],
    ["weekly_report_failed", "failed"],
    ["email_delivered", "delivered"],
    ["email_opened", "opened"],
    ["email_clicked", "clicked"],
    ["email_bounced", "bounced"],
    ["email_complaint", "complaint"],
  ];
  const rows = await collectDeliveries({
    leads: [lead({ history: events.map(([e], i) => ({ at: `2026-09-01T0${i}:00:00Z`, event: e, metadata: {} })) })],
  });
  for (const [event, outcome] of events) {
    assert.equal(rows.find((r) => r.event === event).outcome, outcome, `${event} → ${outcome}`);
  }
});
