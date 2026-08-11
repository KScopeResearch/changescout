/**
 * lambda-lead-intake-handler.test.js — scripts/generator/lambda/lead-intake-handler.js の自動テスト。
 *
 * lead-intake-handler.js は既存のcreateLeadFromEmail()（leads/create-lead-from-email.js）を
 * そのまま呼ぶ薄いadapterであり、company inference・Lead保存自体の正しさは
 * create-lead-from-email.test.js・lead-store.test.jsで既に検証済みのため、ここでは
 * 重複させない。本テストは「adapterとして正しく委譲・入力検証・戻り値整形しているか」
 * にのみ焦点を当てる（createLeadFromEmailModule.createLeadFromEmailを差し替えたテストが
 * 中心）。実HTTP取得・実AWSへは一切接続しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { handler } = require("../lambda/lead-intake-handler");
const createLeadFromEmailModule = require("../leads/create-lead-from-email");

/** @param {Function} fakeFn @returns {Function} 元の関数へ戻す関数 */
function stubCreateLeadFromEmail(fakeFn) {
  const original = createLeadFromEmailModule.createLeadFromEmail;
  createLeadFromEmailModule.createLeadFromEmail = fakeFn;
  return () => {
    createLeadFromEmailModule.createLeadFromEmail = original;
  };
}

// ---------------------------------------------------------------------------
// 必須入力不足・不正入力（createLeadFromEmail()を呼ぶ前にhandler自身が検証する）
// ---------------------------------------------------------------------------

test("lead-intake-handler: event.emailが無い場合は例外を投げる（createLeadFromEmail()は呼ばれない）", async (t) => {
  const calls = [];
  const restore = stubCreateLeadFromEmail(async (...args) => {
    calls.push(args);
    throw new Error("呼ばれてはならない");
  });
  t.after(restore);

  await assert.rejects(() => handler({}), /event.email.*必須/);
  assert.equal(calls.length, 0);
});

test("lead-intake-handler: event.emailが文字列でない場合は例外を投げる", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => {
    throw new Error("呼ばれてはならない");
  });
  t.after(restore);

  await assert.rejects(() => handler({ email: 12345 }), /event.email.*必須/);
  await assert.rejects(() => handler(null), /event.email.*必須/);
});

// ---------------------------------------------------------------------------
// 正常系: createLeadFromEmail()への委譲・引数の受け渡し
// ---------------------------------------------------------------------------

test("lead-intake-handler: event.email/source/collection_methodをcreateLeadFromEmail()へそのまま渡す", async (t) => {
  const calls = [];
  const restore = stubCreateLeadFromEmail(async (email, options) => {
    calls.push({ email, options });
    return { ok: true, lead: { lead_id: "x", company_url: "https://example.co.jp", status: "validated" } };
  });
  t.after(restore);

  await handler({ email: "taro@example.co.jp", source: "campaign-a", collection_method: "manual" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "taro@example.co.jp");
  assert.equal(calls[0].options.source, "campaign-a");
  assert.equal(calls[0].options.collection_method, "manual");
});

test("lead-intake-handler: 成功時、createLeadFromEmail()の戻り値をそのまま含み、ready_for_report_generation:trueが付与される", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => ({
    ok: true,
    lead: { lead_id: "lead-1", company_url: "https://example.co.jp", status: "validated" },
    inference: { evidence: "dummy" },
  }));
  t.after(restore);

  const result = await handler({ email: "taro@example.co.jp" });

  assert.equal(result.ok, true);
  assert.equal(result.lead.lead_id, "lead-1");
  assert.equal(result.inference.evidence, "dummy");
  assert.equal(result.ready_for_report_generation, true);
});

test("lead-intake-handler: resubmitted時もready_for_report_generation:trueになる（company_urlは既に確定しているため）", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => ({
    ok: true,
    resubmitted: true,
    lead: { lead_id: "lead-1", company_url: "https://example.co.jp", status: "validated" },
  }));
  t.after(restore);

  const result = await handler({ email: "taro@example.co.jp" });
  assert.equal(result.resubmitted, true);
  assert.equal(result.ready_for_report_generation, true);
});

// ---------------------------------------------------------------------------
// 業務上の失敗（企業推定不可・配信ブロック）は例外にせず、ok:falseのまま返す
// ---------------------------------------------------------------------------

test("lead-intake-handler: 企業推定に失敗した場合（フリーメール等）はok:falseをそのまま返す（例外にしない）", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => ({
    ok: false,
    reason: "free_email_domain",
    error: "emailから企業を推定できませんでした（free_email_domain）: dummy",
  }));
  t.after(restore);

  const result = await handler({ email: "taro@gmail.com" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "free_email_domain");
  assert.equal(result.ready_for_report_generation, false, "company_urlが確定していないためfalseのはず");
});

test("lead-intake-handler: delivery_statusでブロック済みの場合はok:falseをそのまま返す（例外にしない）", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => ({
    ok: false,
    reason: "blocked",
    lead: { lead_id: "lead-1", company_url: "https://example.co.jp", delivery_status: "unsubscribed" },
  }));
  t.after(restore);

  const result = await handler({ email: "taro@example.co.jp" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "blocked");
  assert.equal(
    result.ready_for_report_generation,
    false,
    "ok:falseの場合はcompany_urlが確定していてもready_for_report_generationはfalseのはず"
  );
});

// ---------------------------------------------------------------------------
// createLeadFromEmail()自体が投げた例外はそのまま伝播させる（握りつぶさない）
// ---------------------------------------------------------------------------

test("lead-intake-handler: createLeadFromEmail()が例外を投げた場合はそのまま伝播する", async (t) => {
  const restore = stubCreateLeadFromEmail(async () => {
    throw new Error("想定外のエラー（例: lead-store.jsのS3接続失敗）");
  });
  t.after(restore);

  await assert.rejects(() => handler({ email: "taro@example.co.jp" }), /想定外のエラー/);
});
