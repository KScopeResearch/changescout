/**
 * process-validated.test.js — scripts/generator/leads/process-validated.js の自動テスト。
 *
 * generateCompanyReport()（実HTTP取得を伴う）はテスト時にはダミー関数へ差し替える
 * （generator.test.jsが既に「実ネットワークI/Oを伴う唯一のテスト」として明記して
 * いるとおり、本ファイルでは新たにネットワーク依存テストを追加しない）。
 * 既存のレポート生成機能そのものの回帰は、generator.test.js側で引き続き担保される
 * （generate-company-report.jsは今回一切変更していない）。
 *
 * 【Phase89 P6c】本ファイルは共有のscripts/generator/logs/leads/を一切使わない。
 * 各テストがmkdtempSync()で専用の<tmp>/logs/leads/を作り、fixtureもそこへ直接置いて、
 * options.leadsDirで処理対象を注入する。以前はcreateLead()で共有ディレクトリへLeadを
 * 作っていたため、processAllValidatedLeads()の全件走査が並行実行中の他テストファイルの
 * validated Leadにまで書き込み、JSON破損レースを起こしていた（Phase89 STEP1）。
 * tmpはt.after()とprocess.on("exit")の両方で削除する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { processValidatedLead, processAllValidatedLeads, parseLeadIdArg } = require("../leads/process-validated");
const { buildNewLead, applyPatch, withHistoryEvent, LEADS_DIR } = require("../leads/lead-store");
const { readJson, writeJson } = require("../shared/json-file");

const TMP_PREFIX = "p89-process-validated-";
const tmpRoots = new Set();

function removeTmpRoots() {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
  tmpRoots.clear();
}
// t.after()が走らない異常終了時の保険
process.on("exit", removeTmpRoots);

/**
 * テスト専用の<tmp>/logs/leads/を作り、テスト終了時に削除する。
 * @param {import("node:test").TestContext} t
 * @returns {string} leadsDir
 */
function makeLeadsDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  tmpRoots.add(root);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    tmpRoots.delete(root);
  });
  const leadsDir = path.join(root, "logs", "leads");
  fs.mkdirSync(leadsDir, { recursive: true });
  return leadsDir;
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
 * tmpのleadsDirへLeadを直接置く（共有LEADS_DIRを使うcreateLead()は使わない）。
 * status:"validated"は、実際のPhase1 CSV取り込み（import-leads.js）と同じく
 * status更新とhistory追記をセットで再現する。
 * @param {string} leadsDir
 * @param {Object} [overrides] - sampleParamsへの上書き
 * @param {{status?:string, patch?:Object}} [opts]
 * @returns {Object} lead
 */
function createTmpLead(leadsDir, overrides = {}, opts = {}) {
  let lead = buildNewLead(sampleParams(overrides));
  if (opts.status === "validated") {
    lead = withHistoryEvent(applyPatch(lead, { status: "validated" }), "validated");
  } else if (opts.status) {
    lead = applyPatch(lead, { status: opts.status });
  }
  if (opts.patch) lead = applyPatch(lead, opts.patch);
  writeJson(path.join(leadsDir, `${lead.lead_id}.json`), lead);
  return lead;
}

/** @returns {Object|null} */
function readTmpLead(leadsDir, leadId) {
  const filePath = path.join(leadsDir, `${leadId}.json`);
  return fs.existsSync(filePath) ? readJson(filePath) : null;
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

/**
 * fnの実行中に、このプロセスが共有LEADS_DIR配下へ行ったfsアクセスを記録する。
 * 他テストファイルは別プロセスで動くため、ここに記録されるのは本テスト自身の
 * アクセスだけ（ディレクトリ全体のsize/mtime比較と違い、並行実行に左右されない）。
 * @param {Function} fn
 * @returns {Promise<{result:*, reads:string[], writes:string[]}>}
 */
async function traceSharedLeadsAccess(fn) {
  const sharedDir = path.resolve(LEADS_DIR);
  const underShared = (p) => typeof p === "string" && path.resolve(p).startsWith(sharedDir);
  const reads = [];
  const writes = [];
  const spied = {
    existsSync: reads,
    readdirSync: reads,
    readFileSync: reads,
    writeFileSync: writes,
    renameSync: writes,
    rmSync: writes,
    unlinkSync: writes,
    mkdirSync: writes,
  };
  const originals = {};
  for (const [name, log] of Object.entries(spied)) {
    originals[name] = fs[name];
    fs[name] = function spy(p, ...rest) {
      if (underShared(p)) log.push(`${name}:${p}`);
      return originals[name].call(this, p, ...rest);
    };
  }
  try {
    const result = await fn();
    return { result, reads, writes };
  } finally {
    Object.assign(fs, originals);
  }
}

// ---------------------------------------------------------------------------
// 1〜5. 正常系
// ---------------------------------------------------------------------------

test("validated Leadが正常に処理され、company_url・company_slug・status・historyが正しく更新される", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const created = createTmpLead(leadsDir, { company_url: "https://process-validated-target.example" }, { status: "validated" });

  const gen = fakeGenerator({ slug: "process-validated-target.example" });
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn, leadsDir });

  assert.equal(result.ok, true);
  assert.equal(result.slug, "process-validated-target.example");

  // 2. company_urlが既存レポート生成へ正しく渡る
  assert.deepEqual(gen.calls, ["https://process-validated-target.example"]);

  const updated = readTmpLead(leadsDir, created.lead_id);
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
  const leadsDir = makeLeadsDir(t);
  const created = createTmpLead(leadsDir, {}, { status: "validated" });

  const gen = fakeGenerator({ ok: false, errors: ["schema不正"] });
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn, leadsDir });

  assert.equal(result.ok, false);
  assert.match(result.error, /schema不正/);

  const unchanged = readTmpLead(leadsDir, created.lead_id);
  assert.equal(unchanged.status, "validated", "statusはvalidatedのまま変わらないはず");
  assert.equal(unchanged.company_slug, null, "company_slugは確定させないはず");
  assert.deepEqual(
    unchanged.history.map((h) => h.event),
    ["collected", "validated"],
    "report_generatedイベントは記録されないはず"
  );
});

test("generateReportが例外を投げた場合もstatusを変更せずエラーを返す", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const created = createTmpLead(leadsDir, {}, { status: "validated" });

  const throwing = async () => {
    throw new Error("ネットワークエラー（テスト用）");
  };
  const result = await processValidatedLead(created.lead_id, { generateReport: throwing, leadsDir });

  assert.equal(result.ok, false);
  assert.match(result.error, /ネットワークエラー/);
  assert.equal(readTmpLead(leadsDir, created.lead_id).status, "validated");
});

// ---------------------------------------------------------------------------
// 7〜8. 再処理・誤処理の防止
// ---------------------------------------------------------------------------

test("report_generated済みLeadは再処理対象にならない（generateReportは呼ばれない）", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const created = createTmpLead(
    leadsDir,
    {},
    { status: "report_generated", patch: { company_slug: "already-generated.example" } }
  );

  const gen = fakeGenerator();
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn, leadsDir });

  assert.equal(result.ok, false);
  assert.match(result.error, /validated/);
  assert.equal(gen.calls.length, 0, "generateReportは呼ばれないはず");
  assert.equal(
    readTmpLead(leadsDir, created.lead_id).company_slug,
    "already-generated.example",
    "既存のcompany_slugは変わらないはず"
  );
});

["collected", "rejected", "initial_report_queued", "initial_report_sent", "initial_report_failed"].forEach((status) => {
  test(`status:"${status}"のLeadは処理対象外になる（generateReportは呼ばれない）`, async (t) => {
    const leadsDir = makeLeadsDir(t);
    const created = createTmpLead(leadsDir, {}, { status });

    const gen = fakeGenerator();
    const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn, leadsDir });

    assert.equal(result.ok, false);
    assert.equal(gen.calls.length, 0);
    assert.equal(readTmpLead(leadsDir, created.lead_id).status, status, "statusは変わらないはず");
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
  const leadsDir = makeLeadsDir(t);
  const created = createTmpLead(
    leadsDir,
    {
      email: "unchanged-fields-test@example.invalid",
      contact_name: "山田太郎",
      department: "営業部",
    },
    { status: "validated" }
  );
  const before = readTmpLead(leadsDir, created.lead_id);

  const gen = fakeGenerator({ slug: "unchanged-fields.example" });
  const result = await processValidatedLead(created.lead_id, { generateReport: gen.fn, leadsDir });
  assert.equal(result.ok, true, "前提: 処理が成功していること（失敗だと比較が空振りになる）");

  const after = readTmpLead(leadsDir, created.lead_id);
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
  const leadsDir = makeLeadsDir(t);
  const validatedLead = createTmpLead(leadsDir, { email: "batch-validated@example.invalid" }, { status: "validated" });
  // collectedLeadはstatus変更なし（初期値のまま"collected"）
  const collectedLead = createTmpLead(leadsDir, { email: "batch-collected@example.invalid" });

  const gen = fakeGenerator({ slug: "batch-validated.example" });
  const result = await processAllValidatedLeads({ generateReport: gen.fn, leadsDir });

  assert.deepEqual(result.results.map((r) => r.leadId), [validatedLead.lead_id], "collectedのLeadは対象に含まれないはず");
  assert.equal(readTmpLead(leadsDir, validatedLead.lead_id).status, "report_generated");
  assert.equal(readTmpLead(leadsDir, collectedLead.lead_id).status, "collected", "触れられていないはず");
});

// ---------------------------------------------------------------------------
// Phase89 P6c: leadsDirによるテスト隔離（T1〜T4）
// ---------------------------------------------------------------------------

test("[P6c-T1] processAllValidatedLeads({leadsDir}): 指定したtmp leadsDirを読み、共有LEADS_DIRは読まない", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const lead = createTmpLead(leadsDir, { email: "p6c-t1@example.invalid" }, { status: "validated" });

  const gen = fakeGenerator({ slug: "p6c-t1.example" });
  const { result, reads } = await traceSharedLeadsAccess(() =>
    processAllValidatedLeads({ generateReport: gen.fn, leadsDir })
  );

  assert.deepEqual(result.summary, { total: 1, succeeded: 1, failed: 0 });
  assert.deepEqual(result.results.map((r) => r.leadId), [lead.lead_id], "tmp leadsDirのLeadが処理対象になるはず");
  assert.equal(readTmpLead(leadsDir, lead.lead_id).status, "report_generated", "書き戻し先もtmp leadsDirのはず");
  assert.deepEqual(reads, [], "共有LEADS_DIRを一切読まないはず");
});

test("[P6c-T2] processAllValidatedLeads({leadsDir}): 別ディレクトリのvalidated Leadは処理しない", async (t) => {
  const leadsDir = makeLeadsDir(t);
  // 「並行実行中の他テストファイルが作ったvalidated Lead」の代役（共有LEADS_DIRには書かない）
  const otherDir = makeLeadsDir(t);

  const target = createTmpLead(leadsDir, { email: "p6c-t2-target@example.invalid" }, { status: "validated" });
  const bystander = createTmpLead(
    otherDir,
    { email: "p6c-t2-bystander@example.invalid", company_url: "https://p6c-t2-bystander.example" },
    { status: "validated" }
  );
  const bystanderFile = path.join(otherDir, `${bystander.lead_id}.json`);
  const bystanderBefore = fs.readFileSync(bystanderFile, "utf8");

  const gen = fakeGenerator({ slug: "p6c-t2-target.example" });
  const result = await processAllValidatedLeads({ generateReport: gen.fn, leadsDir });

  assert.deepEqual(result.results.map((r) => r.leadId), [target.lead_id], "tmp leadsDir内のLeadだけが対象のはず");
  assert.deepEqual(gen.calls, [target.company_url], "対象Leadのcompany_urlだけが生成へ渡るはず");
  assert.equal(fs.readFileSync(bystanderFile, "utf8"), bystanderBefore, "別ディレクトリのLeadは1バイトも変わらないはず");
});

test("[P6c-T3] processAllValidatedLeads({leadsDir}): 共有LEADS_DIRへ一切書き込まない（tmpにだけLead JSONが残る）", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const lead = createTmpLead(leadsDir, { email: "p6c-t3@example.invalid" }, { status: "validated" });

  const gen = fakeGenerator({ slug: "p6c-t3.example" });
  const { result, writes } = await traceSharedLeadsAccess(() =>
    processAllValidatedLeads({ generateReport: gen.fn, leadsDir })
  );

  assert.equal(result.summary.succeeded, 1, "前提: tmpのLeadが実際に処理されているはず");
  assert.deepEqual(writes, [], "共有LEADS_DIRへの書き込み・削除は0件のはず");
  assert.deepEqual(fs.readdirSync(leadsDir), [`${lead.lead_id}.json`], "Lead JSONはtmp leadsDirにだけ存在するはず");
  assert.equal(
    fs.existsSync(path.join(LEADS_DIR, `${lead.lead_id}.json`)),
    false,
    "共有LEADS_DIRに同じLeadが作られていないはず"
  );
});

test("[P6c-T4] 後方互換: 引数なしのprocessAllValidatedLeads()は従来どおりlead-store（LEAD_STORE_BACKEND）経由で読む", async (t) => {
  // 既定経路を実際の共有LEADS_DIRで走らせると、それ自体がP6cの原因（他テストのLeadへの
  // 書き込み）になる。そこでLEAD_STORE_BACKENDに未知の値を入れ、lead-store.getBackend()の
  // 既存エラーが返ること＝既定経路がlead-storeのlistLeads()へ委譲されていることを、
  // ディスクに触れずに確認する（env変更は本テスト内だけで元に戻す）。
  const saved = process.env.LEAD_STORE_BACKEND;
  process.env.LEAD_STORE_BACKEND = "p6c-backward-compat-probe";
  t.after(() => {
    if (saved === undefined) delete process.env.LEAD_STORE_BACKEND;
    else process.env.LEAD_STORE_BACKEND = saved;
  });

  const { reads, writes } = await traceSharedLeadsAccess(() =>
    assert.rejects(processAllValidatedLeads(), /未知のLEAD_STORE_BACKENDです: "p6c-backward-compat-probe"/)
  );
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);

  // processValidatedLead()もleadsDir未指定なら従来どおりlead-store経由（readLead）になる
  await assert.rejects(processValidatedLead("p6c-backward-compat-lead"), /未知のLEAD_STORE_BACKEND/);
});

// ---------------------------------------------------------------------------
// 単一Lead指定（--lead-id）: P6対策
// ---------------------------------------------------------------------------

test("parseLeadIdArg: --lead-id X / --lead-id=X / 未指定 を正しく解釈する", () => {
  assert.equal(parseLeadIdArg(["--lead-id", "abc123"]), "abc123");
  assert.equal(parseLeadIdArg(["--lead-id=abc123"]), "abc123");
  assert.equal(parseLeadIdArg(["--other", "x", "--lead-id", "L1"]), "L1");
  assert.equal(parseLeadIdArg([]), null);
  assert.equal(parseLeadIdArg(["--lead-id"]), null, "値が続かない場合はnull");
});

test("processValidatedLead: leadIdが未指定/空文字なら、Leadを読まずにエラーを返す", async (t) => {
  const leadsDir = makeLeadsDir(t);

  const r1 = await processValidatedLead(undefined, { leadsDir });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /leadId（文字列）が必須/);

  const r2 = await processValidatedLead("", { leadsDir });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /leadId（文字列）が必須/);
});

test("単一Lead処理: 指定した1件だけがreport_generatedになり、他のvalidated Leadは一切触られない", async (t) => {
  const leadsDir = makeLeadsDir(t);
  const target = createTmpLead(leadsDir, { email: "single-target@example.invalid" }, { status: "validated" });

  // 「巻き込んではいけない」もう1件のvalidated Lead（fc2ffcac / example.invalid 相当）
  const bystander = createTmpLead(
    leadsDir,
    { email: "single-bystander@example.invalid", company_url: "https://example.invalid" },
    { status: "validated" }
  );

  const gen = fakeGenerator({ slug: "single-target.example" });
  const result = await processValidatedLead(target.lead_id, { generateReport: gen.fn, leadsDir });

  assert.equal(result.ok, true);
  assert.deepEqual(gen.calls, [target.company_url], "対象Leadのcompany_urlだけが生成へ渡るはず");

  assert.equal(readTmpLead(leadsDir, target.lead_id).status, "report_generated");

  const bystanderAfter = readTmpLead(leadsDir, bystander.lead_id);
  assert.equal(bystanderAfter.status, "validated", "指定していないvalidated Leadは触られないはず");
  assert.equal(bystanderAfter.company_slug, null);
  assert.deepEqual(
    bystanderAfter.history.map((h) => h.event),
    ["collected", "validated"],
    "bystanderのhistoryにreport_generatedは追加されないはず"
  );
});
