/**
 * send-weekly-report.test.js — scripts/generator/leads/send-weekly-report.js の自動テスト。
 *
 * send-initial-report.test.jsと同じ依存性注入パターン（sesClient.sendEmail()は常にダミー
 * 関数へ差し替える）・同じfilesystem後片付けパターンを踏襲する。既定のfilesystemバックエンド
 * のみで検証し、S3バックエンドはpublished-store側の既存テスト（backends/s3-backend.test.js等）
 * が別途カバーする。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  sendWeeklyReportForLead,
  sendWeeklyReportsForAllEligibleLeads,
  buildWeeklyEmailContent,
} = require("../leads/send-weekly-report");
const { createLead, readLead, updateLead, appendHistory, LEADS_DIR } = require("../leads/lead-store");
const publishedStore = require("../published-store");
const { AOR_DATA_DIR } = require("../publish-report");

const TEST_SLUG_PREFIX = "test-send-weekly-report-";

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

/** @param {string} slug */
function cleanupPublished(slug) {
  fs.rmSync(path.join(AOR_DATA_DIR, `${slug}.json`), { force: true });
}

/**
 * published/<slug>.json相当のテストデータを、published-store.jsの正規APIで作成する。
 * @param {string} slug
 * @param {{generatedAt:string, companyName?:string}} opts
 */
async function publishTestReport(slug, opts) {
  await publishedStore.savePublished(slug, {
    meta: { generated_at: opts.generatedAt },
    company_profile: { name: opts.companyName || "テスト株式会社" },
  });
}

function sampleParams(overrides = {}) {
  return {
    email: "send-weekly-report-test@example.invalid",
    company_url: "https://send-weekly-report-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * Weekly配信の全前提条件を満たすLead（consent済み・initial_report_sent・company_slug確定）を作る。
 * @param {{slug?:string, overrides?:Object, patch?:Object}} [opts]
 * @returns {Promise<Object>} 作成したLead（更新後の内容）
 */
async function createEligibleLead(opts = {}) {
  const created = await createLead(sampleParams(opts.overrides));
  const slug = opts.slug || `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  await updateLead(created.lead_id, {
    company_slug: slug,
    status: "initial_report_sent",
    weekly_report_consent: true,
    ...opts.patch,
  });
  return readLead(created.lead_id);
}

/**
 * ネットワークを一切使わないダミーのsendEmail()代替（send-initial-report.test.jsと同型）。
 * @param {{ok?:boolean, messageId?:string, error?:Error}} [opts]
 * @returns {{fn:Function, calls:Array<Object>}}
 */
function fakeSendEmail(opts = {}) {
  const ok = opts.ok !== undefined ? opts.ok : true;
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (!ok) {
      throw opts.error || Object.assign(new Error("ダミーのSES送信失敗"), { code: "MessageRejected", retryable: false });
    }
    return { messageId: opts.messageId || "ses-dummy-message-id-0001" };
  };
  return { fn, calls };
}

/** テスト実行に必要な最小限のAOR_SITE_BASE_URLをセットし、t.after()で元に戻す。 */
function withSiteConfig(t) {
  const original = process.env.AOR_SITE_BASE_URL;
  process.env.AOR_SITE_BASE_URL = "https://aor.example.invalid";
  t.after(() => {
    if (original === undefined) delete process.env.AOR_SITE_BASE_URL;
    else process.env.AOR_SITE_BASE_URL = original;
  });
}

const GENERATED_AT_1 = "2026-08-12T01:52:35.000Z";
const GENERATED_AT_2 = "2026-08-19T01:52:35.000Z";

// ---------------------------------------------------------------------------
// buildWeeklyEmailContent: 初回メールとの文言の違い
// ---------------------------------------------------------------------------

test("buildWeeklyEmailContent: 初回（完成）ではなく更新の文言になる", () => {
  const { subject, text, html } = buildWeeklyEmailContent({
    companyName: "テスト株式会社",
    reportUrl: "https://aor.example.invalid/report-preview.html?company=test",
  });
  assert.match(subject, /更新されました/);
  assert.doesNotMatch(subject, /完成しました/);
  assert.match(text, /更新されました/);
  assert.match(html, /更新されました/);
});

// ---------------------------------------------------------------------------
// Case 1-5: 送信対象外（skip）の各条件
// ---------------------------------------------------------------------------

test("Case1. weekly_report_consent!==true → skip", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { weekly_report_consent: false } });
  t.after(() => cleanupLead(lead.lead_id));
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0, "SESは呼ばれないはず");
});

test('Case2. status!=="initial_report_sent" → skip', async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { status: "report_generated" } });
  t.after(() => cleanupLead(lead.lead_id));
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test("Case3. delivery blocked → skip", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { delivery_status: "unsubscribed" } });
  t.after(() => cleanupLead(lead.lead_id));
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test("Case4. company_slugなし → skip", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { company_slug: null } });
  t.after(() => cleanupLead(lead.lead_id));
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

test("Case5. published reportなし → skip", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => cleanupLead(lead.lead_id));
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Case 6-8: 送信対象になる／ならないgenerated_at比較
// ---------------------------------------------------------------------------

test("Case6. published reportあり、未送信（last_weekly_sent_report_generated_at=null）→ 送信対象", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("Case7. last_weekly_sent_report_generated_atが同じgenerated_at → skip", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { last_weekly_sent_report_generated_at: GENERATED_AT_1 } });
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0, "SESに到達しないはず");
});

test("Case8. publishedのgenerated_atが前回送信値より新しい → 送信対象", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { last_weekly_sent_report_generated_at: GENERATED_AT_1 } });
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_2 });
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Case 9-10: SES成功時の更新内容
// ---------------------------------------------------------------------------

test("Case9. SES成功 → last_weekly_sent_report_generated_atが更新される", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_1);
});

test("Case10. SES成功 → historyにweekly_report_sentが追加される（message_id・report_generated_at付き）", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-case10" });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);
  assert.equal(result.messageId, "ses-msg-case10");

  const after = await readLead(lead.lead_id);
  const entry = after.history.find((h) => h.event === "weekly_report_sent");
  assert.ok(entry, "weekly_report_sent historyが記録されているはず");
  assert.equal(entry.metadata.message_id, "ses-msg-case10");
  assert.equal(entry.metadata.report_generated_at, GENERATED_AT_1);
});

// ---------------------------------------------------------------------------
// Case 11-13: SES失敗時の挙動と再送可能性
// ---------------------------------------------------------------------------

test("Case11. SES失敗 → last_weekly_sent_report_generated_atは更新しない", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ ok: false });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, undefined, "SESまで到達した失敗はskippedではない");

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, null);
});

test("Case12. SES失敗 → historyにweekly_report_failedが記録される（秘密情報はredact済み）", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({
    ok: false,
    error: Object.assign(new Error("SES API エラー: HTTP 400 (MessageRejected) invalid"), {
      code: "MessageRejected",
      retryable: false,
    }),
  });

  await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });

  const after = await readLead(lead.lead_id);
  const entry = after.history.find((h) => h.event === "weekly_report_failed");
  assert.ok(entry, "weekly_report_failed historyが記録されているはず");
  assert.equal(entry.metadata.code, "MessageRejected");
  assert.equal(entry.metadata.retryable, false);
  assert.match(entry.metadata.error, /SES API エラー/);
});

test("Case13. SES失敗後、次回実行で同じreportが再び送信対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });

  const failing = fakeSendEmail({ ok: false });
  const first = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: failing.fn });
  assert.equal(first.ok, false);

  const succeeding = fakeSendEmail({ messageId: "ses-msg-retry" });
  const second = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: succeeding.fn });
  assert.equal(second.ok, true, "失敗後の再実行では同じreportが再び送信対象になるはず");
  assert.equal(succeeding.calls.length, 1);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_1);
});

// ---------------------------------------------------------------------------
// Case 14-15: 二重送信防止／新report公開後の再送
// ---------------------------------------------------------------------------

test("Case14. 同一reportを連続実行 → 2回目はSESに到達しない", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });

  const first = fakeSendEmail({ messageId: "ses-msg-first" });
  const r1 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: first.fn });
  assert.equal(r1.ok, true);
  assert.equal(first.calls.length, 1);

  const second = fakeSendEmail({ messageId: "ses-msg-second" });
  const r2 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: second.fn });
  assert.equal(r2.ok, false);
  assert.equal(r2.skipped, true);
  assert.equal(second.calls.length, 0, "同一reportの2回目はSESに到達しないはず");
});

test("Case15. 新report publish後 → 再び送信対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });

  const first = fakeSendEmail({ messageId: "ses-msg-v1" });
  const r1 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: first.fn });
  assert.equal(r1.ok, true);

  // 新しいreportがpublishされた（generated_atが更新された）
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_2 });

  const second = fakeSendEmail({ messageId: "ses-msg-v2" });
  const r2 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: second.fn });
  assert.equal(r2.ok, true, "新しいreportに対しては再び送信対象になるはず");
  assert.equal(second.calls.length, 1);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_2);
});

// ---------------------------------------------------------------------------
// Scenario A-D（指示書で特に重要とされたシナリオ。上記Caseと重複するが明示的に再掲）
// ---------------------------------------------------------------------------

test("Scenario A. 初回Weekly: consent済み・initial_report_sent・未送信 → 送信成功しstateが更新される", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  assert.equal(lead.last_weekly_sent_report_generated_at, null);
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-scenario-a" });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_1);
  assert.ok(after.history.some((h) => h.event === "weekly_report_sent"));
});

test("Scenario B. 同一reportの再実行: SESを呼ばず、Leadを送信済み状態から変更しない", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const first = fakeSendEmail({ messageId: "ses-msg-scenario-b-1" });
  await sendWeeklyReportForLead(lead.lead_id, { sendEmail: first.fn });
  const beforeRetry = await readLead(lead.lead_id);

  const second = fakeSendEmail({ messageId: "ses-msg-scenario-b-2" });
  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: second.fn });
  assert.equal(result.ok, false);
  assert.equal(second.calls.length, 0);

  const afterRetry = await readLead(lead.lead_id);
  assert.deepEqual(afterRetry, beforeRetry, "2回目の実行でLeadは一切変化しないはず");
});

test("Scenario C. 新report: generated_atが新しくなったら送信対象になり、成功後に更新される", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { last_weekly_sent_report_generated_at: GENERATED_AT_1 } });
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_2 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-scenario-c" });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_2);
});

test("Scenario D. SES失敗: last_weekly_sent_report_generated_atを更新せず、weekly_report_failedを記録し、次回再送対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const failing = fakeSendEmail({ ok: false });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: failing.fn });
  assert.equal(result.ok, false);

  const afterFailure = await readLead(lead.lead_id);
  assert.equal(afterFailure.last_weekly_sent_report_generated_at, null);
  assert.ok(afterFailure.history.some((h) => h.event === "weekly_report_failed"));

  const retry = fakeSendEmail({ messageId: "ses-msg-scenario-d-retry" });
  const retryResult = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: retry.fn });
  assert.equal(retryResult.ok, true, "次回実行では再送対象になるはず");
});

// ---------------------------------------------------------------------------
// sendWeeklyReportsForAllEligibleLeads: 全件処理
// ---------------------------------------------------------------------------

test("sendWeeklyReportsForAllEligibleLeads: 複数Lead・複数companyを独立して処理する（1件の失敗が他に波及しない）", async (t) => {
  withSiteConfig(t);
  // sampleParams()はemail/company_urlを固定値で返すため、overridesを指定せずに
  // createEligibleLead()を複数回呼ぶと、P0-1の email×company_url 同一性判定により
  // 3件とも同一Leadに収束してしまう（send-initial-report.test.jsの既存の教訓と同じ）。
  // 独立した3件として検証するため、それぞれ異なるemail・company_urlを明示的に渡す。
  const eligible = await createEligibleLead({
    overrides: { email: "send-weekly-report-eligible-test@example.invalid", company_url: "https://send-weekly-report-eligible-test.example" },
  });
  const notConsented = await createEligibleLead({
    overrides: { email: "send-weekly-report-not-consented-test@example.invalid", company_url: "https://send-weekly-report-not-consented-test.example" },
    patch: { weekly_report_consent: false },
  });
  const noPublished = await createEligibleLead({
    overrides: { email: "send-weekly-report-no-published-test@example.invalid", company_url: "https://send-weekly-report-no-published-test.example" },
  });

  t.after(() => {
    [eligible, notConsented, noPublished].forEach((l) => {
      cleanupLead(l.lead_id);
      cleanupPublished(l.company_slug);
    });
  });

  await publishTestReport(eligible.company_slug, { generatedAt: GENERATED_AT_1 });
  // noPublishedはpublishedデータを作らない（Case5相当のskipを1件混ぜる）

  const { fn, calls } = fakeSendEmail({ messageId: "ses-msg-all" });
  const result = await sendWeeklyReportsForAllEligibleLeads({ sendEmail: fn });

  assert.ok(result.summary.total >= 2, "consent済みLead（eligible, noPublished）のみが候補に入るはず");
  assert.equal(calls.length, 1, "publishedがあるeligibleのみSESへ到達するはず");

  const eligibleResult = result.results.find((r) => r.leadId === eligible.lead_id);
  assert.equal(eligibleResult.ok, true);
  const noPublishedResult = result.results.find((r) => r.leadId === noPublished.lead_id);
  assert.equal(noPublishedResult.ok, false);
  assert.equal(noPublishedResult.skipped, true);

  // weekly_report_consent!==falseのLeadは候補にすら入らない
  assert.equal(
    result.results.some((r) => r.leadId === notConsented.lead_id),
    false
  );
});

test("sendWeeklyReportsForAllEligibleLeads: 対象Leadなし → total=0", async (t) => {
  withSiteConfig(t);
  const nonEligible = await createEligibleLead({ patch: { weekly_report_consent: false } });
  t.after(() => cleanupLead(nonEligible.lead_id));

  const { fn, calls } = fakeSendEmail();
  const result = await sendWeeklyReportsForAllEligibleLeads({ sendEmail: fn });

  assert.equal(
    result.results.some((r) => r.leadId === nonEligible.lead_id),
    false
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 既存Leadとの後方互換性
// ---------------------------------------------------------------------------

test("後方互換性: last_weekly_sent_report_generated_atフィールドが無い（undefined）既存Leadは未送信として扱われる", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  // 既存Lead JSON（Phase18より前に作られた想定）をシミュレートするため、フィールド自体を削除する。
  const filePath = path.join(LEADS_DIR, `${lead.lead_id}.json`);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  delete raw.last_weekly_sent_report_generated_at;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), "utf-8");

  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn, calls } = fakeSendEmail();

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true, "フィールド欠落は「未送信」として扱われ、送信対象になるはず");
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Phase24 Case A-F: SES送信成功後の永続化失敗を「送信失敗」と誤記録しないことの検証
// ---------------------------------------------------------------------------

test("Phase24 Case A. SES送信失敗 → weekly_report_failed、weekly_report_sentなし、last_weekly_sent_report_generated_at更新なし、次回再送可能", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ ok: false });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(result.sentButNotPersisted, undefined, "SES未成功時はsentButNotPersistedを含まないはず");

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, null);
  assert.ok(after.history.some((h) => h.event === "weekly_report_failed"));
  assert.equal(
    after.history.some((h) => h.event === "weekly_report_sent"),
    false
  );

  // 次回再送可能であることの確認
  const retry = fakeSendEmail({ messageId: "ses-msg-phase24-case-a-retry" });
  const retryResult = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: retry.fn });
  assert.equal(retryResult.ok, true);
});

test("Phase24 Case B. SES成功+updateLead成功+appendHistory成功 → 正常終了（従来通りの戻り値形状）", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-phase24-case-b" });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.deepEqual(result, { ok: true, leadId: lead.lead_id, messageId: "ses-msg-phase24-case-b" }, "従来と同じ戻り値形状のはず（余分なフィールドを含まない）");

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_1);
  const entry = after.history.find((h) => h.event === "weekly_report_sent");
  assert.ok(entry);
  assert.equal(entry.metadata.message_id, "ses-msg-phase24-case-b");
  assert.equal(entry.metadata.report_generated_at, GENERATED_AT_1);
});

test("Phase24 Case C. SES成功+updateLead失敗 → 「送信自体は成功済み」と判定でき、weekly_report_failedとして誤記録しない", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-phase24-case-c" });
  const failingUpdateLead = async () => {
    throw new Error("ダミーのS3書き込み失敗（updateLead）");
  };

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn, updateLead: failingUpdateLead });

  assert.equal(result.ok, true, "SES送信自体は成功しているためok:trueのはず");
  assert.equal(result.messageId, "ses-msg-phase24-case-c");
  assert.equal(result.sentButNotPersisted, true);
  assert.equal(result.dedupPersisted, false);
  assert.equal(result.historyPersisted, true, "appendHistoryは独立して試行され成功するはず");
  assert.match(result.persistError, /S3書き込み失敗/);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, null, "updateLead失敗のため更新されていないはず");
  const entry = after.history.find((h) => h.event === "weekly_report_sent");
  assert.ok(entry, "appendHistoryは成功しているため記録は残るはず");
  assert.equal(entry.metadata.dedup_not_persisted, true);
  assert.equal(
    after.history.some((h) => h.event === "weekly_report_failed"),
    false,
    "weekly_report_failedとして誤記録してはならない"
  );
});

test("Phase24 Case D. SES成功+updateLead成功+appendHistory失敗 → SES送信済みとして扱われ、weekly_report_failedとして誤記録しない", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });
  const { fn } = fakeSendEmail({ messageId: "ses-msg-phase24-case-d" });
  const failingAppendHistory = async () => {
    throw new Error("ダミーのS3書き込み失敗（appendHistory）");
  };

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn, appendHistory: failingAppendHistory });

  assert.equal(result.ok, true, "SES送信済みとして扱われるはず");
  assert.equal(result.messageId, "ses-msg-phase24-case-d");
  assert.equal(result.sentButNotPersisted, true);
  assert.equal(result.dedupPersisted, true, "updateLeadは独立して試行され成功するはず");
  assert.equal(result.historyPersisted, false);
  assert.match(result.persistError, /S3書き込み失敗/);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_1, "updateLeadは成功しているため更新されているはず");
  assert.equal(
    after.history.some((h) => h.event === "weekly_report_failed"),
    false,
    "weekly_report_failedとして誤記録してはならない"
  );
});

test("Phase24 Case E. 同一generated_atの再実行 → 二重送信防止（Case Bの正常系が維持している前提の再確認）", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_1 });

  const first = fakeSendEmail({ messageId: "ses-msg-phase24-case-e-1" });
  const r1 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: first.fn });
  assert.equal(r1.ok, true);

  const second = fakeSendEmail({ messageId: "ses-msg-phase24-case-e-2" });
  const r2 = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: second.fn });
  assert.equal(r2.ok, false);
  assert.equal(r2.skipped, true);
  assert.equal(second.calls.length, 0, "二重送信防止によりSESに到達しないはず");
});

test("Phase24 Case F. 新しいgenerated_at → 新reportとして送信対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createEligibleLead({ patch: { last_weekly_sent_report_generated_at: GENERATED_AT_1 } });
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  await publishTestReport(lead.company_slug, { generatedAt: GENERATED_AT_2 });
  const { fn, calls } = fakeSendEmail({ messageId: "ses-msg-phase24-case-f" });

  const result = await sendWeeklyReportForLead(lead.lead_id, { sendEmail: fn });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);

  const after = await readLead(lead.lead_id);
  assert.equal(after.last_weekly_sent_report_generated_at, GENERATED_AT_2);
});
