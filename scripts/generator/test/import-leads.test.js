/**
 * import-leads.test.js — scripts/generator/leads/import-leads.js の自動テスト。
 *
 * 実際のLeadファイル（scripts/generator/logs/leads/）を作成するため、各テストで
 * importLeadsFromCsv()の戻り値からlead_idを収集し、t.after()で個別に削除する
 * （lead-store.test.jsと同じクリーンアップ方式）。CSV自体はos.tmpdir()配下の
 * 一時ディレクトリに書き出し、テスト後に削除する（リポジトリにCSVフィクスチャを
 * 追加しない）。
 *
 * 【PJ2次工程】lead-store.jsのバックエンド抽象化に伴いimportLeadsFromCsv()および
 * lead-store.jsの各関数が非同期になったため、本ファイルの全テストをasync/awaitへ
 * 変更した（既定のfilesystemバックエンドのまま、AWSへは接続しない）。
 *
 * 【P1-2で変更】重複判定をemail×company_url（company_slug相当）へ一本化したことに伴い、
 * `summary.duplicate`は`summary.resubmitted`へ改称した。また、旧仕様（email単独判定）を
 * 固定していた「同一emailの重複」テストをresubmitted仕様へ更新し、company違い（ケース3・5）・
 * CSV内複数company（ケース7）のテストを追加した。「rejected Leadの再取り込み」テストの
 * フィクスチャは、company_url自体を訂正する内容（"not-a-url"→"https://example.com"）から、
 * company_urlを一貫させたままcollected_atのみを訂正する内容に変更した
 * （company_urlの訂正でcompany_slugが変わる場合、P0-1の同一性判定上「別company」となり
 * 新規Leadが作られるのが確定仕様どおりの正しい挙動のため。詳細はimport-leads.js冒頭コメント参照）。
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

test("正常な新規Lead作成: created・validatedがともに1件、statusはvalidated", async (t) => {
  const email = "import-test-normal@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.validated, 1);
  assert.equal(result.summary.rejected, 0);
  assert.equal(result.summary.errors, 0);

  const leadId = result.rows[0].lead_id;
  const lead = await readLead(leadId);
  assert.equal(lead.status, "validated");
  assert.equal(lead.email, email);
});

// ---------------------------------------------------------------------------
// 2. 必須項目不足
// ---------------------------------------------------------------------------

test("必須項目不足: company_urlが空の行はerrorsになり、Leadは作成されない", async (t) => {
  const email = "import-test-missing@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.created, 0);
  assert.equal(result.rows[0].lead_id, undefined, "Leadは作成されないはず");
});

// ---------------------------------------------------------------------------
// 3〜5. 不正email / company_url / collected_at
// ---------------------------------------------------------------------------

test("不正email: created+rejectedになる（Leadは作成されるがrejected）", async (t) => {
  const csv = `${HEADER}\nnot-an-email,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

test("不正company_url: created+rejectedになる", async (t) => {
  const email = "import-test-badurl@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,not-a-url,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

test("不正collected_at: created+rejectedになる", async (t) => {
  const email = "import-test-baddate@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,not-a-date,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.rejected, 1);
  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "rejected");
});

// ---------------------------------------------------------------------------
// 6. 同一email×同一company（P1-2確定仕様: resubmitted）
// ---------------------------------------------------------------------------

test("同一email×同一company: 2回目はresubmittedになり、新規lead_idを発番せず既存Leadを変更しない", async (t) => {
  const email = "import-test-resubmit@example.invalid";
  const row = `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const csv = `${HEADER}\n${row}\n${row}`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.validated, 1);
  assert.equal(result.summary.resubmitted, 1);
  assert.equal(result.summary.duplicate, undefined, "duplicateという概念は残らないはず");
  assert.equal(result.rows[0].lead_id, result.rows[1].lead_id, "同一lead_idのはず");
  assert.equal(result.rows[1].category, "resubmitted");

  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.status, "validated", "resubmitted時にstatusが上書きされないはず");
  assert.deepEqual(
    lead.history.map((h) => h.event),
    ["collected", "validated", "resubmitted"],
    "resubmittedが1件追記されるのみで、validated/rejectedが再度追記されないはず"
  );
});

// ---------------------------------------------------------------------------
// 6b. 同一email×別company（P1-2確定仕様: 新規Lead）
// ---------------------------------------------------------------------------

test("同一email×別company: 既存Leadとは別の新規Leadとして作成される", async (t) => {
  const email = "import-test-diffcompany@example.invalid";
  const existing = await createLead({
    email,
    company_url: "https://existing-company.invalid",
    source: "手動登録（テスト前提データ）",
    collection_method: "public_website",
  });
  t.after(() => fs.rmSync(path.join(LEADS_DIR, `${existing.lead_id}.json`), { force: true }));

  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://different-company.invalid,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.resubmitted, 0, "company_urlが異なるためresubmittedではないはず");
  assert.notEqual(result.rows[0].lead_id, existing.lead_id, "company_urlが異なるため別Leadとして新規作成されるはず");

  const newLead = await readLead(result.rows[0].lead_id);
  assert.equal(newLead.company_url, "https://different-company.invalid");

  const unchangedExisting = await readLead(existing.lead_id);
  assert.deepEqual(
    unchangedExisting.history.map((h) => h.event),
    ["collected"],
    "別companyのため既存Leadは一切変更されないはず"
  );
});

// ---------------------------------------------------------------------------
// 6c. 同一CSV内で同一email×複数company
// ---------------------------------------------------------------------------

test("CSV内で同一email×複数companyの行がある場合、それぞれ別の新規Leadとして作成される", async (t) => {
  const email = "import-test-csv-multicompany@example.invalid";
  const rowX = `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://company-x.invalid,,,,`;
  const rowY = `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://company-y.invalid,,,,`;
  const csv = `${HEADER}\n${rowX}\n${rowY}`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.equal(result.summary.created, 2, "company_urlが異なるため2件とも新規作成されるはず");
  assert.equal(result.summary.resubmitted, 0);
  assert.notEqual(result.rows[0].lead_id, result.rows[1].lead_id, "片方をもう片方のduplicate/resubmittedとして扱わないはず");

  const leadX = await readLead(result.rows[0].lead_id);
  const leadY = await readLead(result.rows[1].lead_id);
  assert.equal(leadX.company_url, "https://company-x.invalid");
  assert.equal(leadY.company_url, "https://company-y.invalid");
});

// ---------------------------------------------------------------------------
// 7. rejected Leadの再取り込み成功（同一company内での再検証のみ）
// ---------------------------------------------------------------------------

test("rejected Leadの再取り込み: 同一company_urlのまま修正した再取り込みでvalidatedになり、同一lead_idを維持する", async (t) => {
  const email = "import-test-reimport@example.invalid";
  const companyUrl = "https://example.com";
  // company_url自体は最初から一貫させ、collected_at（ISO8601形式チェック対象）だけを
  // 不正→正常に訂正する。company_urlを訂正するとcompany_slugが変わり「別company」に
  // なってしまう（P0-1の確定仕様どおり）ため、rejected再検証の対象外になる。
  const badCsv = `${HEADER}\n${email},公式サイト,public_website,not-a-date,${companyUrl},,,,`;
  const { dir: dir1, file: file1 } = writeTempCsv(badCsv);
  t.after(() => cleanupTempDir(dir1));

  const firstResult = await importLeadsFromCsv(file1);
  t.after(() => cleanupLeadsFromResult(firstResult));
  assert.equal(firstResult.summary.rejected, 1);
  const originalLeadId = firstResult.rows[0].lead_id;
  assert.equal((await readLead(originalLeadId)).status, "rejected");

  const goodCsv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,${companyUrl},,,,`;
  const { dir: dir2, file: file2 } = writeTempCsv(goodCsv);
  t.after(() => cleanupTempDir(dir2));

  const secondResult = await importLeadsFromCsv(file2);
  assert.equal(secondResult.summary.validated, 1);
  assert.equal(secondResult.summary.created, 0, "新規lead_idは発番しないはず");
  assert.equal(secondResult.summary.resubmitted, 0, "rejected再検証はresubmittedとは別処理のはず");
  assert.equal(secondResult.rows[0].category, "validated");
  assert.equal(secondResult.rows[0].lead_id, originalLeadId, "同一lead_idを維持するはず");

  const reloaded = await readLead(originalLeadId);
  assert.equal(reloaded.status, "validated");
  assert.deepEqual(
    reloaded.history.map((h) => h.event),
    ["collected", "rejected", "validated"],
    "resubmittedイベントは追加されないはず"
  );
});

test("rejected Leadの再取り込み: 依然としてvalidation errorの場合はrejectedのまま維持される", async (t) => {
  const email = "import-test-reimport-stillbad@example.invalid";
  const companyUrl = "https://example.com";
  const badCsv = `${HEADER}\n${email},公式サイト,public_website,not-a-date,${companyUrl},,,,`;
  const { dir: dir1, file: file1 } = writeTempCsv(badCsv);
  t.after(() => cleanupTempDir(dir1));

  const firstResult = await importLeadsFromCsv(file1);
  t.after(() => cleanupLeadsFromResult(firstResult));
  const originalLeadId = firstResult.rows[0].lead_id;

  const stillBadCsv = `${HEADER}\n${email},公式サイト,public_website,also-not-a-date,${companyUrl},,,,`;
  const { dir: dir2, file: file2 } = writeTempCsv(stillBadCsv);
  t.after(() => cleanupTempDir(dir2));

  const secondResult = await importLeadsFromCsv(file2);
  assert.equal(secondResult.summary.rejected, 1);
  assert.equal(secondResult.summary.created, 0);
  assert.equal(secondResult.rows[0].lead_id, originalLeadId);

  const reloaded = await readLead(originalLeadId);
  assert.equal(reloaded.status, "rejected");
  assert.deepEqual(
    reloaded.history.map((h) => h.event),
    ["collected", "rejected", "rejected"],
    "依然invalidの場合はrejectedが再度追記されるのみで、resubmittedは追加されないはず"
  );
});

// ---------------------------------------------------------------------------
// 7b. rejected × 別company（新規Leadになる。既存rejected Leadは変更されない）
// ---------------------------------------------------------------------------

test("rejected × 別company: 既存rejected Leadは変更されず、新しいcompanyで新規Leadが作られる", async (t) => {
  const email = "import-test-reimport-diffcompany@example.invalid";
  const badCsv = `${HEADER}\n${email},公式サイト,public_website,not-a-date,https://original-company.invalid,,,,`;
  const { dir: dir1, file: file1 } = writeTempCsv(badCsv);
  t.after(() => cleanupTempDir(dir1));

  const firstResult = await importLeadsFromCsv(file1);
  t.after(() => cleanupLeadsFromResult(firstResult));
  const originalLeadId = firstResult.rows[0].lead_id;
  assert.equal((await readLead(originalLeadId)).status, "rejected");

  const otherCompanyCsv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://another-company.invalid,,,,`;
  const { dir: dir2, file: file2 } = writeTempCsv(otherCompanyCsv);
  t.after(() => cleanupTempDir(dir2));

  const secondResult = await importLeadsFromCsv(file2);
  t.after(() => cleanupLeadsFromResult(secondResult));

  assert.equal(secondResult.summary.created, 1, "company_urlが異なるため新規Leadが作られるはず");
  assert.notEqual(secondResult.rows[0].lead_id, originalLeadId);

  const unchangedOriginal = await readLead(originalLeadId);
  assert.equal(unchangedOriginal.status, "rejected", "別companyのため元のrejected Leadはvalidatedへ昇格しないはず");
  assert.deepEqual(
    unchangedOriginal.history.map((h) => h.event),
    ["collected", "rejected"],
    "別companyのため元のrejected Leadは一切変更されないはず"
  );
});

// ---------------------------------------------------------------------------
// 8〜10. unsubscribed / bounced / suppressed のブロック
// ---------------------------------------------------------------------------

["unsubscribed", "bounced", "suppressed"].forEach((deliveryStatus) => {
  test(`${deliveryStatus} Leadのブロック: 新規行はblockedになり、既存Leadのdelivery_status/statusは変更されないが、resubmittedはcreateLead()により記録される`, async (t) => {
    const email = `import-test-${deliveryStatus}@example.invalid`;
    const existing = await createLead({
      email,
      company_url: "https://example.com",
      source: "手動登録（テスト前提データ）",
      collection_method: "public_website",
    });
    await updateLead(existing.lead_id, { delivery_status: deliveryStatus });
    t.after(() => fs.rmSync(path.join(LEADS_DIR, `${existing.lead_id}.json`), { force: true }));

    const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
    const { dir, file } = writeTempCsv(csv);
    t.after(() => cleanupTempDir(dir));

    const result = await importLeadsFromCsv(file);
    assert.equal(result.summary.blocked, 1);
    assert.equal(result.summary.created, 0);
    assert.equal(result.summary.resubmitted, 0, "blockedはresubmittedとは別カウンタのはず");

    const reloaded = await readLead(existing.lead_id);
    assert.equal(reloaded.delivery_status, deliveryStatus, "既存Leadのdelivery_statusは変更されないはず");
    assert.equal(reloaded.status, "collected", "既存Leadのstatusも変更されないはず");
    assert.deepEqual(
      reloaded.history.map((h) => h.event),
      ["collected", "resubmitted"],
      "blocked既存Leadへの再投入でも、lead-store.jsの既存仕様どおりresubmittedは記録されるはず"
    );
  });
});

// ---------------------------------------------------------------------------
// 11. 任意項目の保存
// ---------------------------------------------------------------------------

test("任意項目の保存: contact_name/department/notes/source_urlが値がある場合に保存される", async (t) => {
  const email = "import-test-optional@example.invalid";
  const csv =
    `${HEADER}\n` +
    `${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,山田太郎,営業部,メモ,https://example.com/contact`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.contact_name, "山田太郎");
  assert.equal(lead.department, "営業部");
  assert.equal(lead.notes, "メモ");
  assert.equal(lead.source_url, "https://example.com/contact");
});

// ---------------------------------------------------------------------------
// 12〜13. lead_id / report_token
// ---------------------------------------------------------------------------

test("lead_idが重複しない・report_tokenが生成される", async (t) => {
  const csv =
    `${HEADER}\n` +
    `import-test-id1@example.invalid,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,\n` +
    `import-test-id2@example.invalid,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  assert.notEqual(result.rows[0].lead_id, result.rows[1].lead_id);
  const lead1 = await readLead(result.rows[0].lead_id);
  const lead2 = await readLead(result.rows[1].lead_id);
  assert.ok(lead1.report_token);
  assert.ok(lead2.report_token);
  assert.notEqual(lead1.report_token, lead2.report_token);
});

// ---------------------------------------------------------------------------
// 14. company_slugがnullのまま
// ---------------------------------------------------------------------------

test("company_slugがnullのまま作成される（Phase2で確定するため今回は設定しない）", async (t) => {
  const email = "import-test-slugnull@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = await readLead(result.rows[0].lead_id);
  assert.equal(lead.company_slug, null);
});

// ---------------------------------------------------------------------------
// 15. historyの記録
// ---------------------------------------------------------------------------

test("history: 新規validatedの場合はcollected→validatedの順で記録される", async (t) => {
  const email = "import-test-history-ok@example.invalid";
  const csv = `${HEADER}\n${email},公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = await readLead(result.rows[0].lead_id);
  assert.deepEqual(
    lead.history.map((h) => h.event),
    ["collected", "validated"]
  );
});

test("history: 新規rejectedの場合はcollected→rejectedの順で記録される", async (t) => {
  const csv = `${HEADER}\nnot-an-email,公式サイト,public_website,2026-08-01T00:00:00Z,https://example.com,,,,`;
  const { dir, file } = writeTempCsv(csv);
  t.after(() => cleanupTempDir(dir));

  const result = await importLeadsFromCsv(file);
  t.after(() => cleanupLeadsFromResult(result));

  const lead = await readLead(result.rows[0].lead_id);
  assert.deepEqual(
    lead.history.map((h) => h.event),
    ["collected", "rejected"]
  );
});
