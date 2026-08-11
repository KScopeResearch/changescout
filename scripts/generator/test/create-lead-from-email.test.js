/**
 * create-lead-from-email.test.js — scripts/generator/leads/create-lead-from-email.js の自動テスト。
 *
 * PJ2 AOR本来のStep①→②（収集済みemailを起点にLeadを作成する）の接続点を検証する。
 * 実HTTP取得は行わない（fetchCompanyをDIでダミー関数に差し替える）。既定の
 * filesystemバックエンドを使用し、作成したLeadは各テストのt.after()で確実に削除する。
 *
 * 【P1-1で追加】重複判定をlead-store.jsのcreateLead()へ一本化したことに伴い、
 * email×company_url（company_slug相当）の確定仕様（同一組み合わせはresubmitted、
 * company_urlが異なれば別Lead、emailが異なれば別Lead）を検証するテストを追加した。
 * このCLIのcompany_url推定（company-inference.js）はemailドメインから決定的に
 * company_urlを導出するため、「同一email・別company_url」ケースは
 * createLeadFromEmail()だけでは自然に再現できない。本番コードへテスト専用の
 * 新しいinterfaceを追加する代わりに、既存のlead-store.js `createLead()`（既に
 * 正規に公開されているAPI）で異なるcompany_urlのLeadを事前に作成しておく方式で
 * 再現する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { createLeadFromEmail } = require("../leads/create-lead-from-email");
const { LEADS_DIR, readLead, createLead, updateLead } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  if (!leadId) return;
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

const fakeFetchOk = async (url) => ({
  ok: true,
  url,
  label: "Example Test Corporation",
  content: "テスト用の会社概要です。",
  error: null,
});

test("createLeadFromEmail: company_urlを事前入力せず、emailだけからLeadを作成できる", async (t) => {
  const email = "create-lead-from-email-test@example-test-corp.invalid";
  const result = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(result.lead && result.lead.lead_id));

  assert.equal(result.ok, true);
  assert.equal(result.lead.email, email);
  assert.equal(result.lead.company_url, "https://example-test-corp.invalid");
  assert.equal(result.lead.company_url_source, "email_domain_verified");
  assert.equal(result.lead.company_url_confidence, "medium");
  assert.equal(result.lead.status, "validated");
});

test("createLeadFromEmail: 保存されたLeadを読み直しても同じcompany_url由来情報が残っている", async (t) => {
  const email = "create-lead-from-email-persist-test@example-test-corp2.invalid";
  const result = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(result.lead && result.lead.lead_id));

  const reloaded = await readLead(result.lead.lead_id);
  assert.equal(reloaded.company_url, "https://example-test-corp2.invalid");
  assert.equal(reloaded.company_url_source, "email_domain_verified");
  assert.equal(reloaded.notes, result.inference.evidence, "推定の根拠(evidence)がnotesとして保持されているはず");
});

test("createLeadFromEmail: フリーメールドメインの場合はLeadを作成せずエラーを返す", async () => {
  const result = await createLeadFromEmail("taro@gmail.com", {
    fetchCompany: async () => {
      throw new Error("フリーメールドメインの場合、fetchCompanyは呼ばれてはならない");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "free_email_domain");
});

// ---------------------------------------------------------------------------
// P1-1: Lead重複（email×company_url≒company_slug）の確定仕様
// ---------------------------------------------------------------------------

test("createLeadFromEmail: 同一email×同一companyの再投入は新規Leadを作らず、resubmitted historyのみ記録される（重複エラーにしない）", async (t) => {
  const email = "create-lead-from-email-resubmit-test@example-test-corp3.invalid";
  const first = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(first.lead && first.lead.lead_id));

  assert.equal(first.ok, true);
  assert.equal(first.lead.status, "validated");
  assert.deepEqual(first.lead.history.map((h) => h.event), ["collected", "validated"]);

  const second = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });

  assert.equal(second.ok, true, "重複時もok:falseにしない");
  assert.equal(second.reason, undefined);
  assert.equal(second.resubmitted, true);
  assert.equal(second.lead.lead_id, first.lead.lead_id, "新規Leadを作らず同一Leadを再利用するはず");

  assert.deepEqual(
    second.lead.history.map((h) => h.event),
    ["collected", "validated", "resubmitted"],
    "resubmittedが1件追記されるのみで、validated/rejectedが再度追記されないはず"
  );
  assert.equal(second.lead.status, "validated", "resubmitted時にvalidation処理でstatusが上書きされないはず");

  // ディスク上のLeadも同じ内容であることを確認する（updateLead/appendHistoryの
  // 二重呼び出しが実際に起きていないことの裏付け）。
  const reloaded = await readLead(first.lead.lead_id);
  assert.equal(reloaded.status, "validated");
  assert.deepEqual(reloaded.history.map((h) => h.event), ["collected", "validated", "resubmitted"]);
});

test("createLeadFromEmail: 同一emailでもcompany_urlが異なる既存Leadがある場合は別Leadとして新規作成される", async (t) => {
  const email = "create-lead-from-email-diffcompany-test@example-test-corp5.invalid";
  // company-inference.jsはemailドメインからcompany_urlを決定的に導出するため、
  // createLeadFromEmail()だけでは同一emailに対して異なるcompany_urlを再現できない。
  // 既存のlead-store.js createLead()で「同じemailだが別company_url」のLeadを
  // 先に作っておくことでこのケースを再現する。
  const seeded = await createLead({
    email,
    company_url: "https://unrelated-other-company.invalid",
    source: "テスト（別company事前seed）",
    collection_method: "manual",
  });
  t.after(() => cleanupLead(seeded.lead_id));

  const result = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(result.lead && result.lead.lead_id));

  assert.equal(result.ok, true);
  assert.equal(result.resubmitted, undefined, "company_urlが異なるためresubmittedではなく新規作成のはず");
  assert.notEqual(result.lead.lead_id, seeded.lead_id, "company_urlが異なるため別Leadとして新規作成されるはず");
  assert.equal(result.lead.company_url, "https://example-test-corp5.invalid");
});

test("createLeadFromEmail: 別email・同一company（同一ドメイン）は別々の新規Leadとして作成される", async (t) => {
  const emailA = "create-lead-from-email-diffemail-a@example-test-corp6.invalid";
  const emailB = "create-lead-from-email-diffemail-b@example-test-corp6.invalid";

  const resultA = await createLeadFromEmail(emailA, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(resultA.lead && resultA.lead.lead_id));
  const resultB = await createLeadFromEmail(emailB, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(resultB.lead && resultB.lead.lead_id));

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.notEqual(resultA.lead.lead_id, resultB.lead.lead_id, "emailが異なるため別Leadのはず");
  assert.equal(resultA.lead.company_url, resultB.lead.company_url, "同一ドメインのためcompany_urlは一致する");
});

// ---------------------------------------------------------------------------
// P1-1: delivery_statusによるblock判定（重複判定とは別概念）
// ---------------------------------------------------------------------------

test("createLeadFromEmail: 既存Leadのdelivery_statusがブロック済み（unsubscribed等）の場合は対象外として扱われ、既存Leadは変更されない", async (t) => {
  const email = "create-lead-from-email-blocked-test@example-test-corp7.invalid";
  const first = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });
  t.after(() => cleanupLead(first.lead && first.lead.lead_id));
  await updateLead(first.lead.lead_id, { delivery_status: "unsubscribed" });

  const second = await createLeadFromEmail(email, { fetchCompany: fakeFetchOk });

  assert.equal(second.ok, false);
  assert.equal(second.reason, "blocked");
  assert.equal(second.lead.lead_id, first.lead.lead_id);

  const reloaded = await readLead(first.lead.lead_id);
  assert.equal(reloaded.delivery_status, "unsubscribed", "blocked判定時にdelivery_statusは変更されないはず");
  assert.equal(reloaded.status, "validated", "blocked判定時にstatusも変更されないはず");
  assert.deepEqual(
    reloaded.history.map((h) => h.event),
    ["collected", "validated", "resubmitted"],
    "重複判定（resubmitted記録）とblock判定は別処理のため、blockedと判定された場合もresubmitted自体はlead-store.js側で記録されるはず"
  );
});
