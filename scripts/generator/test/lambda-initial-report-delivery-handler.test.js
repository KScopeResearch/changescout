/**
 * lambda-initial-report-delivery-handler.test.js —
 * scripts/generator/lambda/initial-report-delivery-handler.js の自動テスト。
 *
 * initial-report-delivery-handler.js は既存のsendInitialReportForLead()/
 * sendInitialReportsForAllReportGenerated()（leads/send-initial-report.js）をそのまま
 * 呼ぶ薄いadapterである。SES送信・公開判定（published-store.js経由）・Lead status遷移
 * 自体の正しさはsend-initial-report.test.js・published-store.test.jsで既に検証済みの
 * ため、ここでは重複させない。本テストは「adapterとして正しくmode分岐・委譲・入力検証
 * しているか」にのみ焦点を当てる（sendInitialReportModule配下の関数を差し替えたテストが
 * 中心）。実SES送信・実AWSへは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../lambda/initial-report-delivery-handler");
const sendInitialReportModule = require("../leads/send-initial-report");
const sesClient = require("../leads/ses-client");

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubSendForLead(fakeFn) {
  const original = sendInitialReportModule.sendInitialReportForLead;
  sendInitialReportModule.sendInitialReportForLead = fakeFn;
  return () => {
    sendInitialReportModule.sendInitialReportForLead = original;
  };
}

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubSendForAll(fakeFn) {
  const original = sendInitialReportModule.sendInitialReportsForAllReportGenerated;
  sendInitialReportModule.sendInitialReportsForAllReportGenerated = fakeFn;
  return () => {
    sendInitialReportModule.sendInitialReportsForAllReportGenerated = original;
  };
}

/**
 * SES/AOR_SITE_BASE_URLの環境変数チェックを「揃っている」状態に固定する
 * （実環境変数をいじらず、判定関数自体を差し替える。他テストファイルとの並行実行時に
 * 実環境変数の変更が影響しないようにするため）。
 * @param {import('node:test').TestContext} t
 */
function withEnvChecksSatisfied(t) {
  const originalMissingEnvVars = sesClient.missingEnvVars;
  const originalMissingSiteConfig = sendInitialReportModule.missingSiteConfig;
  sesClient.missingEnvVars = () => [];
  sendInitialReportModule.missingSiteConfig = () => [];
  t.after(() => {
    sesClient.missingEnvVars = originalMissingEnvVars;
    sendInitialReportModule.missingSiteConfig = originalMissingSiteConfig;
  });
}

// ---------------------------------------------------------------------------
// 必須環境変数チェック（既存CLIと同じ事前チェックを再利用しているだけであることの確認）
// ---------------------------------------------------------------------------

test("initial-report-delivery-handler: SES関連の環境変数が不足している場合は例外を投げる（送信を試みない）", async (t) => {
  const originalMissingEnvVars = sesClient.missingEnvVars;
  const originalMissingSiteConfig = sendInitialReportModule.missingSiteConfig;
  sesClient.missingEnvVars = () => ["SES_FROM"];
  sendInitialReportModule.missingSiteConfig = () => ["AOR_SITE_BASE_URL"];
  t.after(() => {
    sesClient.missingEnvVars = originalMissingEnvVars;
    sendInitialReportModule.missingSiteConfig = originalMissingSiteConfig;
  });

  const calls = [];
  const restore = stubSendForAll(async () => {
    calls.push(true);
    return { summary: {}, results: [] };
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "all" }), /SES_FROM.*AOR_SITE_BASE_URL|AOR_SITE_BASE_URL.*SES_FROM/);
  assert.equal(calls.length, 0, "環境変数不足時は送信関数を一切呼ばないはず");
});

// ---------------------------------------------------------------------------
// mode分岐・入力検証
// ---------------------------------------------------------------------------

test("initial-report-delivery-handler: modeを省略した場合は既定で全件処理（sendInitialReportsForAllReportGenerated）になる", async (t) => {
  withEnvChecksSatisfied(t);
  const calls = [];
  const restore = stubSendForAll(async () => {
    calls.push(true);
    return { summary: { total: 0, sent: 0, skipped: 0, failed: 0 }, results: [] };
  });
  t.after(restore);

  const result = await handler({});
  assert.equal(calls.length, 1);
  assert.deepEqual(result.summary, { total: 0, sent: 0, skipped: 0, failed: 0 });
});

test("initial-report-delivery-handler: mode:'all'はsendInitialReportsForAllReportGenerated()の戻り値をそのまま返す", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { summary: { total: 3, sent: 1, skipped: 1, failed: 1 }, results: [{ leadId: "a", ok: true }] };
  const restore = stubSendForAll(async () => fakeResult);
  t.after(restore);

  const result = await handler({ mode: "all" });
  assert.deepEqual(result, fakeResult);
});

test("initial-report-delivery-handler: mode:'single'にはlead_idが必須（無い場合は例外、送信関数は呼ばれない）", async (t) => {
  withEnvChecksSatisfied(t);
  const calls = [];
  const restore = stubSendForLead(async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "single" }), /event.lead_id.*必須/);
  assert.equal(calls.length, 0);
});

test("initial-report-delivery-handler: mode:'single'はlead_idをsendInitialReportForLead()へそのまま渡し、戻り値をそのまま返す", async (t) => {
  withEnvChecksSatisfied(t);
  const calls = [];
  const fakeResult = { ok: true, leadId: "lead-1", messageId: "ses-message-id-1" };
  const restore = stubSendForLead(async (leadId) => {
    calls.push(leadId);
    return fakeResult;
  });
  t.after(restore);

  const result = await handler({ mode: "single", lead_id: "lead-1" });
  assert.deepEqual(calls, ["lead-1"]);
  assert.deepEqual(result, fakeResult);
});

test("initial-report-delivery-handler: 未知のmodeは例外を投げる", async (t) => {
  withEnvChecksSatisfied(t);
  await assert.rejects(() => handler({ mode: "bogus" }), /未知のmodeです/);
});

// ---------------------------------------------------------------------------
// 業務上の失敗（未公開スキップ・SES送信失敗）は例外にせず、戻り値としてそのまま返す
// ---------------------------------------------------------------------------

test("initial-report-delivery-handler: skipped（未公開等）の結果もそのまま返す（例外にしない）", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { ok: false, leadId: "lead-1", skipped: true, error: "company_slugはまだ公開されていません" };
  const restore = stubSendForLead(async () => fakeResult);
  t.after(restore);

  const result = await handler({ mode: "single", lead_id: "lead-1" });
  assert.deepEqual(result, fakeResult);
});

test("initial-report-delivery-handler: SES送信失敗（initial_report_failed）の結果もそのまま返す（例外にしない）", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { ok: false, leadId: "lead-1", error: "SES API エラー: HTTP 400 (MessageRejected)" };
  const restore = stubSendForLead(async () => fakeResult);
  t.after(restore);

  const result = await handler({ mode: "single", lead_id: "lead-1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /MessageRejected/);
});

test("initial-report-delivery-handler: sendInitialReportForLead()自体が例外を投げた場合はそのまま伝播する", async (t) => {
  withEnvChecksSatisfied(t);
  const restore = stubSendForLead(async () => {
    throw new Error("想定外のエラー（例: lead-store.jsのS3接続失敗）");
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "single", lead_id: "lead-1" }), /想定外のエラー/);
});
