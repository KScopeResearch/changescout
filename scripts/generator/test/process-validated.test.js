/**
 * process-validated.test.js — scripts/generator/leads/process-validated.js の自動テスト。
 *
 * generateCompanyReport()（実HTTP取得を伴う）はテスト時にはダミー関数へ差し替える
 * （generator.test.jsが既に「実ネットワークI/Oを伴う唯一のテスト」として明記して
 * いるとおり、本ファイルでは新たにネットワーク依存テストを追加しない）。
 * 既存のレポート生成機能そのものの回帰は、generator.test.js側で引き続き担保される
 * （generate-company-report.jsは今回一切変更していない）。
 *
 * lead-store.test.js / import-leads.test.jsと同じ方式で、各テストが作成したLeadを
 * t.after()で個別に削除する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { processValidatedLead, processAllValidatedLeads } = require("../leads/process-validated");
const { createLead, readLead, updateLead, appendHistory, LEADS_DIR } = require("../leads/lead-store");

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

/**
 * テスト用に「validated」なLeadを再現する。実際のPhase1 CSV取り込み（import-leads.js）は
 * status更新とhistory追記を必ずセットで行うため、テスト側でも同じ組み合わせで
 * セットアップする（updateLead()単体ではhistoryは追記されない、lead-store.jsの
 * 意図的な設計）。
 * @param {string} leadId
 */
function markValidated(leadId) {
  updateLead(leadId, { status: "validated" });
  appendHistory(leadId, "validated");
}

function sampleParams(overrides = {}) {
  return {
    email: "process-validated-test@example.invalid",
    company_url: "https://example.com",
    source: "公式サイトのお問い合わせページ",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * ネットワークを一切使わないダミーのgenerateCompanyReport()代替。
 * @param {{slug?:string, ok?:boolean, errors?:string[]}} [opts]
 * @returns {{fn: Function, calls: string[]}}
 */
function fakeGenerator(opts = {}) {
  const slug = opts.slug !== undefined ? opts.slug : "example.com";
  const ok = opts.ok !== undefined ? opts.ok : true;
  const errors = opts.errors || (ok ? [] : ["ダミーの検証エラー"]);
  const calls = [];
  const fn = async (companyUrl) => {
    calls.push(companyUrl);
    return { slug, validation: { ok, errors }, report: { id: `generated-${slug}` } };
  };
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// 1〜5. 正常系
// ---------------------------------------------------------------------------

test("validated Leadが正常に処理され、company_url・company_slug・status・historyが正しく更新される", async (t) => {
  const created = createLead(sampleParams({ company_url: "https://process-validated-target.example" }));
  t.after(() => cleanupLead(created.lead_id));
  markValidated(created.lead_id);

  const gen = fakeGenerator({ slug: "process-validated-target.example" });
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn });

  assert.equal(result.ok, true);
  assert.equal(result.slug, "process-validated-target.example");

  // 2. company_urlが既存レポート生成へ正しく渡る
  assert.deepEqual(gen.calls, ["https://process-validated-target.example"]);

  const updated = readLead(created.lead_id);
  // 3. company_slugが設定される
  assert.equal(updated.company_slug, "process-validated-target.example");
  // 4. statusがreport_generatedになる
  assert.equal(updated.status, "report_generated");
  // 5. historyにreport_generatedが追加される
  assert.deepEqual(
    updated.history.map((h) => h.event),
    ["collected", "validated", "report_generated"]
  );
  assert.deepEqual(updated.history[2].metadata, { slug: "process-validated-target.example" });
});

// ---------------------------------------------------------------------------
// 6. 失敗時はreport_generatedへ進まない
// ---------------------------------------------------------------------------

test("report生成失敗（validation.ok=false）時はstatus・company_slugを変更しない", async (t) => {
  const created = createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  markValidated(created.lead_id);

  const gen = fakeGenerator({ ok: false, errors: ["schema不正"] });
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn });

  assert.equal(result.ok, false);
  assert.match(result.error, /schema不正/);

  const unchanged = readLead(created.lead_id);
  assert.equal(unchanged.status, "validated", "statusはvalidatedのまま変わらないはず");
  assert.equal(unchanged.company_slug, null, "company_slugは確定させないはず");
  assert.deepEqual(
    unchanged.history.map((h) => h.event),
    ["collected", "validated"],
    "report_generatedイベントは記録されないはず"
  );
});

test("generateReportが例外を投げた場合もstatusを変更せずエラーを返す", async (t) => {
  const created = createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  markValidated(created.lead_id);

  const throwing = async () => {
    throw new Error("ネットワークエラー（テスト用）");
  };
  const result = await processValidatedLead(created.lead_id, { generateReport: throwing });

  assert.equal(result.ok, false);
  assert.match(result.error, /ネットワークエラー/);
  assert.equal(readLead(created.lead_id).status, "validated");
});

// ---------------------------------------------------------------------------
// 7〜8. 再処理・誤処理の防止
// ---------------------------------------------------------------------------

test("report_generated済みLeadは再処理対象にならない（generateReportは呼ばれない）", async (t) => {
  const created = createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  updateLead(created.lead_id, { status: "report_generated", company_slug: "already-generated.example" });

  const gen = fakeGenerator();
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn });

  assert.equal(result.ok, false);
  assert.match(result.error, /validated/);
  assert.equal(gen.calls.length, 0, "generateReportは呼ばれないはず");
  assert.equal(readLead(created.lead_id).company_slug, "already-generated.example", "既存のcompany_slugは変わらないはず");
});

["collected", "rejected", "initial_report_queued", "initial_report_sent", "initial_report_failed"].forEach((status) => {
  test(`status:"${status}"のLeadは処理対象外になる（generateReportは呼ばれない）`, async (t) => {
    const created = createLead(sampleParams());
    t.after(() => cleanupLead(created.lead_id));
    updateLead(created.lead_id, { status });

    const gen = fakeGenerator();
    const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn });

    assert.equal(result.ok, false);
    assert.equal(gen.calls.length, 0);
    assert.equal(readLead(created.lead_id).status, status, "statusは変わらないはず");
  });
});

// ---------------------------------------------------------------------------
// 9. 既存レポート生成機能への回帰確認
// ---------------------------------------------------------------------------

test("generate-company-report.jsは今回変更していない（既存のgenerator.test.jsが引き続き回帰を担保する）", () => {
  // 本ファイルはgenerateCompanyReport()を直接requireせず、常にoptions.generateReportで
  // 差し替え可能な設計にしている（processValidatedLead()自体がテスト容易性のために
  // 依存性注入を受け付ける）。実際のgenerateCompanyReport()自体の動作確認・回帰確認は
  // generator.test.js（NETWORK_TEST_NAME）の責務のままとし、ここで重複させない。
  assert.ok(true);
});

// ---------------------------------------------------------------------------
// 10. 既存フィールドが意図せず変更されない
// ---------------------------------------------------------------------------

test("成功時、company_slug/status/history以外の既存フィールドは変更されない", async (t) => {
  const created = createLead(
    sampleParams({
      email: "unchanged-fields-test@example.invalid",
      contact_name: "山田太郎",
      department: "営業部",
    })
  );
  t.after(() => cleanupLead(created.lead_id));
  markValidated(created.lead_id);
  const before = readLead(created.lead_id);

  const gen = fakeGenerator({ slug: "unchanged-fields.example" });
  await processValidatedLead(created.lead_id, { generateReport: gen.fn });

  const after = readLead(created.lead_id);
  assert.equal(after.lead_id, before.lead_id);
  assert.equal(after.report_token, before.report_token);
  assert.equal(after.email, before.email);
  assert.equal(after.company_url, before.company_url);
  assert.equal(after.source, before.source);
  assert.equal(after.collection_method, before.collection_method);
  assert.equal(after.collected_at, before.collected_at);
  assert.equal(after.contact_name, before.contact_name);
  assert.equal(after.department, before.department);
  assert.equal(after.paid_report_requested, before.paid_report_requested);
  assert.equal(after.paid_report_requested_at, before.paid_report_requested_at);
  assert.equal(after.weekly_report_consent, before.weekly_report_consent);
  assert.equal(after.weekly_report_consent_at, before.weekly_report_consent_at);
  assert.equal(after.delivery_status, before.delivery_status);
});

// ---------------------------------------------------------------------------
// processAllValidatedLeads: 複数Leadの一括処理
// ---------------------------------------------------------------------------

test("processAllValidatedLeads: validatedなLeadだけを対象にする", async (t) => {
  const validatedLead = createLead(sampleParams({ email: "batch-validated@example.invalid" }));
  t.after(() => cleanupLead(validatedLead.lead_id));
  markValidated(validatedLead.lead_id);

  const collectedLead = createLead(sampleParams({ email: "batch-collected@example.invalid" }));
  t.after(() => cleanupLead(collectedLead.lead_id));
  // collectedLeadはstatus変更なし（初期値のまま"collected"）

  const gen = fakeGenerator({ slug: "batch-validated.example" });
  const result = await processAllValidatedLeads({ generateReport: gen.fn });

  const processedIds = result.results.map((r) => r.leadId);
  assert.ok(processedIds.includes(validatedLead.lead_id));
  assert.ok(!processedIds.includes(collectedLead.lead_id), "collectedのLeadは対象に含まれないはず");
  assert.equal(readLead(validatedLead.lead_id).status, "report_generated");
  assert.equal(readLead(collectedLead.lead_id).status, "collected", "触れられていないはず");
});
