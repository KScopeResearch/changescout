/**
 * import-leads.test.js — scripts/generator/leads/import-leads.js の自動テスト。
 *
 * 実際のLeadファイル（scripts/generator/logs/leads/）を作成するため、各テストで
 * importLeadsFromCsv()の戻り値からlead_idを収集し、t.after()で個別に削除する
 * （lead-store.test.jsと同じクリーンアップ方式）。CSV自体はos.tmpdir()配下の
 * 一時ディレクトリに書き出し、テスト後に削除する（リポジトリにCSVフィクスチャを
 * 追加しない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { importLeadsFromCsv } = require("../leads/import-leads");
const { readLead, createLead, updateLead, LEADS_DIR } = require("../leads/lead-store");

/** @param {string} csvContent @returns {{dir:string, file:string}} */
function writeTempCsv(csvContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-import-leads-test-"));
  const file = path.join(dir, "leads.csv");
  fs.writeFileSync(file, csvContent, "utf-8");
  return { dir, file };
}

/** @param {string} dir */
function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** @param {{summary:Object, rows:Array<Object>}} result */
function cleanupLeadsFromResult(result) {
  result.rows.forEach((r) => {
    if (r.lead_id) fs.rmSync(path.join(LEADS_DIR, `${r.lead_id}.json`), { force: true });
  });
}

const HEADER = "email,source,collection_method,collected_at,company_url,contact_name,department,notes,source_url";

// ---------------------------------------------------------------------------
// 1. 正常な新規Lead作成
// ---------------------------------------------------------------------------

test("正常な新規Lead作成: created・validatedがともに1件、statusはvalidated", (t) => {
  const email = "import-test-normal@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.validated, 1);
  assert.equal(result.summary.rejected, 0);
  assert.equal(result.summary.errors, 0);

  const leadId = result.rows[0].lead_id;
  const lead = readLead(leadId);
  assert.equal(lead.status, "validated");
  assert.equal(lead.email, email);
});

// ---------------------------------------------------------------------------
// 2. 必須項目不足
// ---------------------------------------------------------------------------

test("必須項目不足: company_urlが空の行はerrorsになり、Leadは作成されない", (t) => {
  const email = "import-test-missing@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.created, 0);
  assert.equal(result.rows[0].lead_id, undefined, "Leadは作成されないはず");
});

// ---------------------------------------------------------------------------
// 3〜5. 不正email / company_url / collected_at
// ---------------------------------------------------------------------------

test("不正email: created+rejectedになる（Leadは作成されるがrejected）", (t) => {
  const csv = `${HEADER}\nnot-an-email,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

test("不正company_url: created+rejectedになる", (t) => {
  const email = "import-test-badurl@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,not-a-url,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

test("不正collected_at: created+rejectedになる", (t) => {
  const email = "import-test-baddate@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,not-a-date,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

// ---------------------------------------------------------------------------
// 6. 同一emailの重複
// ---------------------------------------------------------------------------

test("同一emailの重複: 2回目はduplicateになり、新規lead_idを発番しない", (t) => {
  const email = "import-test-dup@example.invalid";
  const row = `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const csv = `${HEADER}\n${row}\n${row}`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.validated, 1);
  assert.equal(result.summary.duplicate, 1);
  assert.equal(result.rows[0].lead_id, result.rows[1].lead_id, "同一lead_idのはず");
});

// ---------------------------------------------------------------------------
// 7. rejected Leadの再取り込み成功
// ---------------------------------------------------------------------------

test("rejected Leadの再取り込み: 修正後の再取り込みでvalidatedになり、同一lead_idを維持する", (t) => {
  const email = "import-test-reimport@example.invalid";
  const badCsv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,not-a-url,,,,`;
  const { dir: dir1, file: file1 } = writeTempCsv(badCsv);
  t.after(() => cleanupTempDir(dir1));

  const firstResult = importLeadsFromCsv(file1);
  t.after(() => cleanupLeadsFromResult(firstResult));
  assert.equal(firstResult.summary.rejected, 1);
  const originalLeadId = firstResult.rows[0].lead_id;
  assert.equal(readLead(originalLeadId).status, "rejected");

  const goodCsv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir: dir2, file: file2 } = writeTempCsv(goodCsv);
  t.after(() => cleanupTempDir(dir2));

  const secondResult = importLeadsFromCsv(file2);
  assert.equal(secondResult.summary.validated, 1);
  assert.equal(secondResult.summary.created, 0, "新規lead_idは発番しないはず");
  assert.equal(secondResult.rows[0].lead_id, originalLeadId, "同一lead_idを維持するはず");
  assert.equal(readLead(originalLeadId).status, "validated");
});

// ---------------------------------------------------------------------------
// 8〜10. unsubscribed / bounced / suppressed のブロック
// ---------------------------------------------------------------------------

["unsubscribed", "bounced", "suppressed"].forEach((deliveryStatus) => {
  test(`${deliveryStatus} Leadのブロック: 新規行はblockedになり、既存Leadは変更されない`, (t) => {
    const email = `import-test-${deliveryStatus}@example.invalid`;
    const existing = createLead({
      email,
      company_url: "https://example.com",
      source: "手動登録（テスト前提データ）",
      collection_method: "public_website",
    });
    updateLead(existing.lead_id, { delivery_status: deliveryStatus });
    t.after(() => fs.rmSync(path.join(LEADS_DIR, `${existing.lead_id}.json`), { force: true }));

    const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
    const { dir, file } = writeTempCsv(csv);
    t.after(() => cleanupTempDir(dir));

    const result = importLeadsFromCsv(file);
    assert.equal(result.summary.blocked, 1);
    assert.equal(result.summary.created, 0);
    assert.equal(readLead(existing.lead_id).delivery_status, deliveryStatus, "既存Leadは変更されないはず");
  });
});

// ---------------------------------------------------------------------------
// 11. 任意項目の保存
// ---------------------------------------------------------------------------

test("任意項目の保存: contact_name/department/notes/source_urlが値がある場合に保存される", (t) => {
  const email = "import-test-optional@example.invalid";
  const csv =
    `${HEADER}\n` +
    `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,山田太郎,営業部,メモ,https://example.com/contact`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = readLead(result.rows[0].lead_id);
  assert.equal(lead.contact_name, "山田太郎");
  assert.equal(lead.department, "営業部");
  assert.equal(lead.notes, "メモ");
  assert.equal(lead.source_url, "https://example.com/contact");
});

// ---------------------------------------------------------------------------
// 12〜13. lead_id / report_token
// ---------------------------------------------------------------------------

test("lead_idが重複しない・report_tokenが生成される", (t) => {
  const csv =
    `${HEADER}\n` +
    `import-test-id1@example.invalid,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,\n` +
    `import-test-id2@example.invalid,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.notEqual(result.rows[0].lead_id, result.rows[1].lead_id);
  const lead1 = readLead(result.rows[0].lead_id);
  const lead2 = readLead(result.rows[1].lead_id);
  assert.ok(lead1.report_token);
  assert.ok(lead2.report_token);
  assert.notEqual(lead1.report_token, lead2.report_token);
});

// ---------------------------------------------------------------------------
// 14. company_slugがnullのまま
// ---------------------------------------------------------------------------

test("company_slugがnullのまま作成される（Phase2で確定するため今回は設定しない）", (t) => {
  const email = "import-test-slugnull@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = readLead(result.rows[0].lead_id);
  assert.equal(lead.company_slug, null);
});

// ---------------------------------------------------------------------------
// 15. historyの記録
// ---------------------------------------------------------------------------

test("history: 新規validatedの場合はcollected→validatedの順で記録される", (t) => {
  const email = "import-test-history-ok@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = readLead(result.rows[0].lead_id);
  assert.deepEqual(
    lead.history.map((h) => h.event),
    ["collected", "validated"]
  );
});

test("history: 新規rejectedの場合はcollected→rejectedの順で記録される", (t) => {
  const csv = `${HEADER}\nnot-an-email,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = readLead(result.rows[0].lead_id);
  assert.deepEqual(
    lead.history.map((h) => h.event),
    ["collected", "rejected"]
  );
});
