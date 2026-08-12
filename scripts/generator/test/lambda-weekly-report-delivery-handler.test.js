/**
 * lambda-weekly-report-delivery-handler.test.js —
 * scripts/generator/lambda/weekly-report-delivery-handler.js の自動テスト。
 *
 * lambda-initial-report-delivery-handler.test.jsと同じ焦点・同じ手法を踏襲する:
 * weekly-report-delivery-handler.js は既存のsendWeeklyReportForLead()/
 * sendWeeklyReportsForAllEligibleLeads()（leads/send-weekly-report.js、Phase18で実装済み）を
 * そのまま呼ぶ薄いadapterである。Weekly対象判定・SES送信・Lead状態遷移自体の正しさは
 * send-weekly-report.test.jsで既に検証済みのため、ここでは重複させない。本テストは
 * 「adapterとして正しくmode分岐・委譲・入力検証しているか」にのみ焦点を当てる
 * （sendWeeklyReportModule配下の関数を差し替えたテストが中心）。実SES送信・実AWSへは
 * 一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../lambda/weekly-report-delivery-handler");
const sendWeeklyReportModule = require("../leads/send-weekly-report");
const sendInitialReportModule = require("../leads/send-initial-report"); // missingSiteConfig()はここが実体
const sesClient = require("../leads/ses-client");

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubSendForLead(fakeFn) {
  const original = sendWeeklyReportModule.sendWeeklyReportForLead;
  sendWeeklyReportModule.sendWeeklyReportForLead = fakeFn;
  return () => {
    sendWeeklyReportModule.sendWeeklyReportForLead = original;
  };
}

/** @param {Function} fakeFn @returns {Function} 元へ戻す関数 */
function stubSendForAll(fakeFn) {
  const original = sendWeeklyReportModule.sendWeeklyReportsForAllEligibleLeads;
  sendWeeklyReportModule.sendWeeklyReportsForAllEligibleLeads = fakeFn;
  return () => {
    sendWeeklyReportModule.sendWeeklyReportsForAllEligibleLeads = original;
  };
}

/**
 * SES/AOR_SITE_BASE_URLの環境変数チェックを「揃っている」状態に固定する
 * （実環境変数をいじらず、判定関数自体を差し替える。lambda-initial-report-delivery-handler.test.js
 * と同じ手法。実環境変数の変更が他テストファイルとの並行実行に影響しないようにするため）。
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
// 必須環境変数チェック
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: SES関連の環境変数が不足している場合は例外を投げる（送信を試みない）", async (t) => {
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
// Case 4/6: mode省略・event未指定は既定でall
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: modeを省略した場合は既定で全件処理（sendWeeklyReportsForAllEligibleLeads）になる", async (t) => {
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

test("weekly-report-delivery-handler: eventを渡さない（handler()）場合も既定で全件処理になる", async (t) => {
  withEnvChecksSatisfied(t);
  const calls = [];
  const restore = stubSendForAll(async () => {
    calls.push(true);
    return { summary: { total: 0, sent: 0, skipped: 0, failed: 0 }, results: [] };
  });
  t.after(restore);

  const result = await handler();
  assert.equal(calls.length, 1);
  assert.deepEqual(result.summary, { total: 0, sent: 0, skipped: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// Case 4: mode:'all'
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: mode:'all'はsendWeeklyReportsForAllEligibleLeads()を1回呼び、戻り値をそのまま返す", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { summary: { total: 3, sent: 1, skipped: 1, failed: 1 }, results: [{ leadId: "a", ok: true }] };
  const calls = [];
  const restore = stubSendForAll(async () => {
    calls.push(true);
    return fakeResult;
  });
  t.after(restore);

  const result = await handler({ mode: "all" });
  assert.equal(calls.length, 1);
  assert.deepEqual(result, fakeResult);
});

// ---------------------------------------------------------------------------
// Case 2/3: single + lead_id欠落・空文字
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: mode:'single'にはlead_idが必須（無い場合は例外、送信関数は呼ばれない）", async (t) => {
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

test("weekly-report-delivery-handler: mode:'single'でlead_idが空文字の場合も例外（送信関数は呼ばれない）", async (t) => {
  withEnvChecksSatisfied(t);
  const calls = [];
  const restore = stubSendForLead(async (...args) => {
    calls.push(args);
    return { ok: true };
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "single", lead_id: "" }), /event.lead_id.*必須/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Case 1: single + valid lead_id
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: mode:'single'はlead_idをsendWeeklyReportForLead()へそのまま渡し、戻り値をそのまま返す", async (t) => {
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

// ---------------------------------------------------------------------------
// Case 5: invalid mode
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: 未知のmodeは例外を投げる", async (t) => {
  withEnvChecksSatisfied(t);
  await assert.rejects(() => handler({ mode: "bogus" }), /未知のmodeです/);
});

// ---------------------------------------------------------------------------
// Case 7/8: business logicがskip/failureを返す場合、そのまま返す（例外にしない）
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: skipped（未公開・consentなし等）の結果もそのまま返す（例外にしない）", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { ok: false, leadId: "lead-1", skipped: true, error: "weekly_report_consentがtrueではないため送信対象外です" };
  const restore = stubSendForLead(async () => fakeResult);
  t.after(restore);

  const result = await handler({ mode: "single", lead_id: "lead-1" });
  assert.deepEqual(result, fakeResult);
});

test("weekly-report-delivery-handler: SES送信失敗（weekly_report_failed）の結果もそのまま返す（例外にしない）", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = { ok: false, leadId: "lead-1", error: "SES API エラー: HTTP 400 (MessageRejected)" };
  const restore = stubSendForLead(async () => fakeResult);
  t.after(restore);

  const result = await handler({ mode: "single", lead_id: "lead-1" });
  assert.equal(result.ok, false);
  assert.match(result.error, /MessageRejected/);
});

// ---------------------------------------------------------------------------
// Case 9: business logicがthrowした場合はそのまま伝播する
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: sendWeeklyReportForLead()自体が例外を投げた場合はそのまま伝播する", async (t) => {
  withEnvChecksSatisfied(t);
  const restore = stubSendForLead(async () => {
    throw new Error("想定外のエラー（例: lead-store.jsのS3接続失敗）");
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "single", lead_id: "lead-1" }), /想定外のエラー/);
});

test("weekly-report-delivery-handler: sendWeeklyReportsForAllEligibleLeads()自体が例外を投げた場合はそのまま伝播する", async (t) => {
  withEnvChecksSatisfied(t);
  const restore = stubSendForAll(async () => {
    throw new Error("想定外のエラー（例: lead-store.jsのS3接続失敗）");
  });
  t.after(restore);

  await assert.rejects(() => handler({ mode: "all" }), /想定外のエラー/);
});

// ---------------------------------------------------------------------------
// Case 11/12: mode分岐がもう一方の処理経路を一切呼ばないこと
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: mode:'all'ではsendWeeklyReportForLead()（single処理）が呼ばれない", async (t) => {
  withEnvChecksSatisfied(t);
  const singleCalls = [];
  const restoreSingle = stubSendForLead(async (...args) => {
    singleCalls.push(args);
    return { ok: true };
  });
  t.after(restoreSingle);
  const restoreAll = stubSendForAll(async () => ({ summary: { total: 0, sent: 0, skipped: 0, failed: 0 }, results: [] }));
  t.after(restoreAll);

  await handler({ mode: "all" });
  assert.equal(singleCalls.length, 0, "mode:'all'ではsingle処理が呼ばれないはず");
});

test("weekly-report-delivery-handler: mode:'single'ではsendWeeklyReportsForAllEligibleLeads()（全件処理）が呼ばれない", async (t) => {
  withEnvChecksSatisfied(t);
  const allCalls = [];
  const restoreAll = stubSendForAll(async () => {
    allCalls.push(true);
    return { summary: { total: 0, sent: 0, skipped: 0, failed: 0 }, results: [] };
  });
  t.after(restoreAll);
  const restoreSingle = stubSendForLead(async () => ({ ok: true, leadId: "lead-1" }));
  t.after(restoreSingle);

  await handler({ mode: "single", lead_id: "lead-1" });
  assert.equal(allCalls.length, 0, "mode:'single'では全件処理（listLeads全件走査）が呼ばれないはず");
});

// ---------------------------------------------------------------------------
// Case 10: 秘密情報・PIIがログへ漏れない
// ---------------------------------------------------------------------------

test("weekly-report-delivery-handler: handler自身はconsole.log/console.errorを一切呼ばない（emailやエラー詳細をログへ出力しない）", async (t) => {
  withEnvChecksSatisfied(t);
  const fakeResult = {
    ok: false,
    leadId: "lead-1",
    error: "SES API エラー: HTTP 400 (MessageRejected) recipient=super-secret-address@example.invalid",
  };
  const restore = stubSendForLead(async () => fakeResult);
  t.after(restore);

  const logCalls = [];
  const errorCalls = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logCalls.push(args);
  console.error = (...args) => errorCalls.push(args);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await handler({ mode: "single", lead_id: "lead-1" });

  assert.equal(logCalls.length, 0, "handlerはconsole.logを呼ばない設計（ロジックはsend-weekly-report.js側）");
  assert.equal(errorCalls.length, 0, "handlerはconsole.errorを呼ばない設計");
});
