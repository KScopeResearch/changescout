/**
 * send-initial-report.test.js — scripts/generator/leads/send-initial-report.js の自動テスト。
 *
 * sesClient.sendEmail()（実HTTP通信・実AWS認証を伴う）はテスト時には常にダミー関数へ
 * 差し替える（process-validated.test.jsのfakeGenerator()と同じ依存性注入パターン。
 * ses-client.test.jsが「SigV4署名ロジック自体の正しさ」を別途ネットワーク非依存で検証
 * 済みのため、本ファイルでは重複させない）。
 *
 * website/aor/data/<slug>.json（publish-report.jsの公開先）もテスト用の一時ファイルを
 * 作成・削除する。実データ（company-01-manufacturing等）には一切触れない
 * （TEST_SLUG_PREFIXで名前空間を分離する）。
 *
 * 【PJ2次工程】lead-store.jsのバックエンド抽象化に伴い各関数が非同期になったため、
 * 本ファイルの全テストをasync/awaitへ変更した（既定のfilesystemバックエンドのまま）。
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  sendInitialReportForLead,
  sendInitialReportsForAllReportGenerated,
  buildReportUrl,
  buildEmailContent,
  missingSiteConfig,
} = require("../leads/send-initial-report");
const {
  createLead,
  readLead,
  updateLead,
  appendHistory,
  buildNewLead,
  applyPatch,
  withHistoryEvent,
  LEADS_DIR,
} = require("../leads/lead-store");
const { readJson, writeJson } = require("../shared/json-file");
const { AOR_DATA_DIR } = require("../publish-report");

const TEST_SLUG_PREFIX = "test-send-initial-report-";

// 【Phase92 P6e】一括処理（sendInitialReportsForAllReportGenerated）のテストは、共有の
// scripts/generator/logs/leads/を全件走査すると並行実行中の他テストファイルのLead
// （aor-admin-leads.test.jsのE2E等）へ書き込んでしまい、JSON破損レースの原因になっていた
// （Phase91 STEP3で観測）。一括処理のテストは専用の<tmp>/logs/leads/へfixtureを置き、
// options.leadsDirで渡す。tmpはt.after()と、異常終了時の保険のprocess.on("exit")で削除する。
const tmpRoots = new Set();
function removeTmpRoots() {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
  tmpRoots.clear();
}
after(removeTmpRoots);
process.on("exit", removeTmpRoots);

/**
 * テスト専用の<tmp>/logs/leads/を作り、テスト終了時に削除する。
 * @param {import("node:test").TestContext} t
 * @returns {string} leadsDir
 */
function makeLeadsDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p92-p6e-send-initial-"));
  tmpRoots.add(root);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    tmpRoots.delete(root);
  });
  const leadsDir = path.join(root, "logs", "leads");
  fs.mkdirSync(leadsDir, { recursive: true });
  return leadsDir;
}

/**
 * tmpのleadsDirへ、createReportGeneratedLead()と同じ状態（report_generated・company_slug確定・
 * approved）のLeadを直接置く（共有LEADS_DIRを使うcreateLead()は使わない）。
 * @param {string} leadsDir
 * @param {{overrides?:Object, patch?:Object}} [opts]
 * @returns {Object} lead
 */
function createTmpReportGeneratedLead(leadsDir, opts = {}) {
  let lead = buildNewLead(sampleParams(opts.overrides));
  const slug = `${TEST_SLUG_PREFIX}${lead.lead_id.slice(0, 12)}`;
  lead = applyPatch(lead, { company_slug: slug, status: "report_generated", delivery_approval_status: "approved" });
  lead = withHistoryEvent(lead, "report_generated", { slug });
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
 * fnの実行中に、このプロセスが共有LEADS_DIR配下へ行ったfsアクセスを記録する（P6cの
 * process-validated.test.jsと同じ方式。他テストファイルは別プロセスなので、記録されるのは
 * 本テスト自身のアクセスだけ）。書き込み系は実行せずに記録だけ行う（失敗時も共有側に触れない）。
 * @param {Function} fn
 * @returns {Promise<{result:*, reads:string[], writes:string[]}>}
 */
async function traceSharedLeadsAccess(fn) {
  const sharedDir = path.resolve(LEADS_DIR);
  const underShared = (p) => typeof p === "string" && path.resolve(p).startsWith(sharedDir);
  const reads = [];
  const writes = [];
  const spied = { existsSync: reads, readdirSync: reads, readFileSync: reads, statSync: reads };
  const blocked = ["writeFileSync", "renameSync", "rmSync", "unlinkSync", "mkdirSync", "appendFileSync"];
  const originals = {};
  for (const [name, log] of Object.entries(spied)) {
    originals[name] = fs[name];
    fs[name] = function spy(p, ...rest) {
      if (underShared(p)) log.push(`${name}:${p}`);
      return originals[name].call(this, p, ...rest);
    };
  }
  for (const name of blocked) {
    originals[name] = fs[name];
    fs[name] = function intercepted(p, ...rest) {
      if (underShared(p)) {
        writes.push(`${name}:${p}`);
        return undefined;
      }
      return originals[name].call(this, p, ...rest);
    };
  }
  try {
    return { result: await fn(), reads, writes };
  } finally {
    Object.assign(fs, originals);
  }
}

/** @param {string} leadId */
function cleanupLead(leadId) {
  fs.rmSync(path.join(LEADS_DIR, `${leadId}.json`), { force: true });
}

/** @param {string} slug */
function cleanupPublished(slug) {
  fs.rmSync(path.join(AOR_DATA_DIR, `${slug}.json`), { force: true });
}

/**
 * website/aor/data/<slug>.json相当の最小限の公開済みデータを作成する
 * （isPublished()はファイルの存在のみを見るため、report.jsonの完全な形は不要）。
 * @param {string} slug
 * @param {{companyName?:string}} [opts]
 */
function publishTestCompanyData(slug, opts = {}) {
  fs.mkdirSync(AOR_DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(AOR_DATA_DIR, `${slug}.json`),
    JSON.stringify({ company_profile: { name: opts.companyName || "テスト株式会社" } }),
    "utf-8"
  );
}

function sampleParams(overrides = {}) {
  return {
    email: "send-initial-report-test@example.invalid",
    company_url: "https://send-initial-report-test.example",
    source: "テスト",
    collection_method: "public_website",
    ...overrides,
  };
}

/**
 * status:"report_generated"、company_slug確定済み、delivery_approval_status:"approved"の
 * Leadを作成する（他のゲートを検証するテストが、PJ2 AOR: Candidate/Approved分離仕様で
 * 新設したdelivery_approval_statusゲートに引っかからないよう、既定でapproved済みにする）。
 * @param {{slug?:string, overrides?:Object}} [opts]
 * @returns {Promise<Object>} 作成したLead（更新後の内容）
 */
async function createReportGeneratedLead(opts = {}) {
  const created = await createLead(sampleParams(opts.overrides));
  const slug = opts.slug || `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated", delivery_approval_status: "approved" });
  await appendHistory(created.lead_id, "report_generated", { slug });
  return readLead(created.lead_id);
}

/**
 * ネットワークを一切使わないダミーのsendEmail()代替。
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

// ---------------------------------------------------------------------------
// buildReportUrl() / buildEmailContent()（Pure Function）
// ---------------------------------------------------------------------------

test("buildReportUrl: company/lead/tokenの3パラメータを含み、emailを含まないURLを組み立てる", () => {
  const url = buildReportUrl("https://aor.example.invalid", {
    companySlug: "example.com",
    leadId: "lead-id-abc123",
    reportToken: "report-token-xyz789",
  });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/report-preview.html");
  assert.equal(parsed.searchParams.get("company"), "example.com");
  assert.equal(parsed.searchParams.get("lead"), "lead-id-abc123");
  assert.equal(parsed.searchParams.get("token"), "report-token-xyz789");
  assert.ok(!url.includes("@"), "emailらしき文字列(@)を含まないはず");
});

test("buildReportUrl: baseUrlの末尾スラッシュ有無に関わらず同じ結果になる", () => {
  const withSlash = buildReportUrl("https://aor.example.invalid/", { companySlug: "s", leadId: "l", reportToken: "t" });
  const withoutSlash = buildReportUrl("https://aor.example.invalid", { companySlug: "s", leadId: "l", reportToken: "t" });
  assert.equal(withSlash, withoutSlash);
});

test("buildEmailContent: published JSON から teaser メールを組み立てる（reportUrl 保持・件名に会社名）", () => {
  const { subject, text, html } = buildEmailContent({
    report: {
      company_profile: { name: "サンプル株式会社", industry_label: "情報サービス業" },
      human_review: { status: "approved", reviewed_at: "2026-09-08T00:00:00.000Z" },
      free_opportunity: {
        title: "AI活用型・業務効率化支援サービスの立ち上げ",
        why_now: "人手不足が深刻化しており、AI導入の需要が高まっています。",
        why_company: "サンプル株式会社は、システム開発と運用支援を自社で提供しています。",
        market_change: "サービス市場は前年比10%増で拡大しています。",
        first_action: "既存顧客にヒアリングし、パイロットを1件企画する。",
        extended_analysis: { priority: "既存事業の延長で早期に着手できます。", confidence_note: "" },
      },
    },
    reportUrl: "https://aor.example.invalid/report-preview.html?company=s&lead=l&token=t",
    unsubscribeUrl: "https://aor.example.invalid/unsubscribe.html?lead=l&token=t",
  });
  assert.match(subject, /サンプル株式会社/);
  // teaser の Opportunity title が本文に載る（Preview Hero と一致）
  assert.ok(text.includes("AI活用型・業務効率化支援サービスの立ち上げ"));
  assert.ok(html.includes("AI活用型・業務効率化支援サービスの立ち上げ"));
  // reportUrl は text は生・html はエスケープ後で含まれる
  assert.ok(text.includes("https://aor.example.invalid/report-preview.html?company=s&lead=l&token=t"));
  assert.ok(html.includes("https://aor.example.invalid/report-preview.html?company=s&amp;lead=l&amp;token=t"));
  // 個人情報・壊れた断片が出ない
  assert.doesNotMatch(html + text, /undefined|null|\[object Object\]|## \||\|-{2,}\|/);
  // AI 生成を謳わない・煽らない
  assert.doesNotMatch(subject, /AI が|必ず|今すぐ|限定|保証/);
});

// ---------------------------------------------------------------------------
// sendInitialReportForLead(): 正常系
// ---------------------------------------------------------------------------

test("1,2,3,4,5. report_generatedなLeadが送信対象になり、URLにcompany_slug/lead_idを含みemailを含まない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  // text本文には生のURL（HTMLエスケープなし）が含まれるため、こちらでURLを検証する。
  const sentUrl = calls[0].text.match(/https:\/\/\S+/)[0];
  const parsed = new URL(sentUrl);
  assert.equal(parsed.searchParams.get("company"), lead.company_slug);
  assert.equal(parsed.searchParams.get("lead"), lead.lead_id);
  assert.equal(parsed.searchParams.get("token"), lead.report_token, "3. report_tokenがURLに入る");
  assert.ok(!sentUrl.includes(encodeURIComponent(lead.email)), "5. emailがURLに入らない");
  assert.ok(!calls[0].text.includes(lead.email), "text本文にもemailを含まないはず（URLはemail非依存のため）");
  assert.ok(!calls[0].html.includes(lead.email), "html本文にもemailを含まないはず");
});

test("6. SES message tagにlead_idが入り、7. report_tokenはmessage tagに入らない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn, calls } = fakeSendEmail();
  await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.deepEqual(calls[0].tags, [{ Name: "lead_id", Value: lead.lead_id }]);
  const tagValues = calls[0].tags.map((tg) => tg.Value);
  assert.ok(!tagValues.includes(lead.report_token));
  assert.ok(!tagValues.some((v) => v.includes("@")), "message tagにemailらしき値が入っていないはず");
});

test("PJ2 AOR Phase45 STEP3C: sendEmailFnにunsubscribe({url,mailto})が渡される（blastengineのlist_unsubscribe用、実送信配線はまだ無し）", async (t) => {
  withSiteConfig(t);
  const originalFrom = process.env.BLASTENGINE_FROM;
  process.env.BLASTENGINE_FROM = "aor-report@changescout.jp";
  t.after(() => {
    if (originalFrom === undefined) delete process.env.BLASTENGINE_FROM;
    else process.env.BLASTENGINE_FROM = originalFrom;
  });

  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn, calls } = fakeSendEmail();
  await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  const unsubscribe = calls[0].unsubscribe;
  assert.ok(unsubscribe, "unsubscribeが渡されるはず");
  assert.equal(unsubscribe.mailto, "aor-report@changescout.jp");
  assert.match(unsubscribe.url, /unsubscribe\.html/);
  const parsedUnsubUrl = new URL(unsubscribe.url);
  assert.equal(parsedUnsubUrl.searchParams.get("lead"), lead.lead_id);
  assert.equal(parsedUnsubUrl.searchParams.get("token"), lead.report_token);
});

test("SES送信は宛先(to)にlead.emailを使う（配信そのものには必要な唯一の箇所）", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn, calls } = fakeSendEmail();
  await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(calls[0].to, lead.email);
});

test("8,9. SES成功時はinitial_report_sentになり、historyにmessage_idが残る", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn } = fakeSendEmail({ messageId: "ses-message-id-verify-0001" });
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "ses-message-id-verify-0001");

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_sent");
  assert.deepEqual(
    updated.history.map((h) => h.event),
    ["collected", "report_generated", "initial_report_queued", "initial_report_sent"]
  );
  const sentEntry = updated.history.find((h) => h.event === "initial_report_sent");
  assert.deepEqual(sentEntry.metadata, { message_id: "ses-message-id-verify-0001" });
});

test("キュー投入: 送信前にinitial_report_queuedへ遷移し、historyに記録される", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const queuedSeenByHandler = [];
  const { fn } = {
    fn: async () => {
      queuedSeenByHandler.push((await readLead(lead.lead_id)).status);
      return { messageId: "mid" };
    },
  };
  await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.deepEqual(queuedSeenByHandler, ["initial_report_queued"], "SES呼び出し時点で既にinitial_report_queuedになっているはず");
});

// ---------------------------------------------------------------------------
// sendInitialReportForLead(): 失敗系
// ---------------------------------------------------------------------------

test("10,11. SES失敗時はinitial_report_failedになり、secret/token/emailがhistoryへ漏れない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const fakeError = Object.assign(
    new Error(`SES API エラー: HTTP 400 (MessageRejected) AWS_SECRET_ACCESS_KEY=should-not-leak-1234567890`),
    { code: "MessageRejected", retryable: false }
  );
  const { fn } = fakeSendEmail({ ok: false, error: fakeError });
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.status, "initial_report_failed");
  const failedEntry = updated.history.find((h) => h.event === "initial_report_failed");
  assert.ok(failedEntry, "initial_report_failedイベントが記録されるはず");
  assert.equal(failedEntry.metadata.code, "MessageRejected");
  assert.equal(failedEntry.metadata.retryable, false);
  assert.ok(!failedEntry.metadata.error.includes(lead.email), "historyにemailが含まれてはいけない");
  assert.ok(!failedEntry.metadata.error.includes(lead.report_token), "historyにreport_tokenが含まれてはいけない");
  assert.ok(
    !JSON.stringify(updated.history).includes("should-not-leak-1234567890"),
    "AWS_SECRET_ACCESS_KEY等のsecret値らしき文字列はredactSecrets()により[REDACTED]化されるはず"
  );
});

test("失敗時、company_slug/report_token/emailはLead本体からも変更されない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const { fn } = fakeSendEmail({ ok: false });
  await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.company_slug, lead.company_slug, "14. company_slugを再生成しない");
  assert.equal(updated.report_token, lead.report_token, "15. report_tokenを再発番しない");
  assert.equal(updated.email, lead.email);
});

// ---------------------------------------------------------------------------
// delivery_status送信ゲート（監査で発見された不具合の修正確認）
// ---------------------------------------------------------------------------

test("Case1. delivery_status:active + status:report_generated → 送信対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);
  assert.equal(lead.delivery_status, "active", "createLead()の既定値がactiveであることの前提確認");

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, "SESが呼ばれるはず");
  assert.equal((await readLead(lead.lead_id)).status, "initial_report_sent");
});

["unsubscribed", "bounced", "suppressed"].forEach((deliveryStatus, idx) => {
  test(`Case${idx + 2}. delivery_status:${deliveryStatus} + status:report_generated → 送信対象外（skip、SES未呼び出し、status/history/delivery_status不変）`, async (t) => {
    withSiteConfig(t);
    const lead = await createReportGeneratedLead();
    t.after(() => {
      cleanupLead(lead.lead_id);
      cleanupPublished(lead.company_slug);
    });
    publishTestCompanyData(lead.company_slug);
    await updateLead(lead.lead_id, { delivery_status: deliveryStatus });
    const beforeHistoryLength = (await readLead(lead.lead_id)).history.length;

    const { fn, calls } = fakeSendEmail();
    const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(calls.length, 0, "SESが呼ばれてはいけない");

    const after = await readLead(lead.lead_id);
    assert.equal(after.status, "report_generated", "statusは変わらないはず");
    assert.equal(after.delivery_status, deliveryStatus, "delivery_status自体も変更されないはず");
    assert.equal(after.history.length, beforeHistoryLength, "historyは増えないはず");
    assert.equal(
      after.history.some((h) => h.event === "initial_report_queued" || h.event === "initial_report_failed"),
      false,
      "queued/failedいずれのhistoryも記録しないはず"
    );
  });
});

test('Case5. status:"rejected"から復帰しstatus:report_generated・delivery_status:activeになったLeadは、delivery_statusを理由にブロックされない', async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);
  // 一度rejectedを経由してからreport_generated・activeに戻ったLeadを模す
  // （isDeliveryBlocked()はstatus:"rejected"単独では配信ブロック理由にしないという既存仕様の確認）。
  await updateLead(lead.lead_id, { status: "rejected" });
  await appendHistory(lead.lead_id, "rejected");
  await updateLead(lead.lead_id, { status: "report_generated", delivery_status: "active" });

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true, "delivery_status:activeであれば、rejectedを経由していてもブロックされないはず");
  assert.equal(calls.length, 1);
  assert.equal((await readLead(lead.lead_id)).status, "initial_report_sent");
});

// ---------------------------------------------------------------------------
// delivery_approval_status送信ゲート（PJ2 AOR: Candidate/Approved分離仕様で追加）
// ---------------------------------------------------------------------------

test("delivery_approval_status:approved + status:report_generated → 送信対象になる（前提確認）", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);
  assert.equal(lead.delivery_approval_status, "approved", "createReportGeneratedLead()の既定値がapprovedであることの前提確認");

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, "SESが呼ばれるはず");
});

["pending", "rejected"].forEach((approvalStatus) => {
  test(`delivery_approval_status:${approvalStatus} + status:report_generated → 送信対象外（skip、SES未呼び出し、status/history/delivery_approval_status不変）`, async (t) => {
    withSiteConfig(t);
    const lead = await createReportGeneratedLead();
    t.after(() => {
      cleanupLead(lead.lead_id);
      cleanupPublished(lead.company_slug);
    });
    publishTestCompanyData(lead.company_slug);
    await updateLead(lead.lead_id, { delivery_approval_status: approvalStatus });
    const beforeHistoryLength = (await readLead(lead.lead_id)).history.length;

    const { fn, calls } = fakeSendEmail();
    const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(calls.length, 0, "SESが呼ばれてはいけない");

    const after = await readLead(lead.lead_id);
    assert.equal(after.status, "report_generated", "statusは変わらないはず");
    assert.equal(after.delivery_approval_status, approvalStatus, "delivery_approval_status自体も変更されないはず");
    assert.equal(after.history.length, beforeHistoryLength, "historyは増えないはず");
    assert.equal(
      after.history.some((h) => h.event === "initial_report_queued" || h.event === "initial_report_failed"),
      false,
      "queued/failedいずれのhistoryも記録しないはず"
    );
  });
});

test("新規Lead（createLead()直後、delivery_approval_status更新なし）は、他の条件をすべて満たしても送信対象にならない（Candidateのまま自動承認されないことの確認）", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams({ email: "delivery-approval-default-pending@example.invalid" }));
  const slug = `${TEST_SLUG_PREFIX}${created.lead_id.slice(0, 12)}`;
  await updateLead(created.lead_id, { company_slug: slug, status: "report_generated" }); // delivery_approval_statusは更新しない
  t.after(() => {
    cleanupLead(created.lead_id);
    cleanupPublished(slug);
  });
  publishTestCompanyData(slug);

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(created.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.match(result.error, /delivery_approval_status/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 二重送信・誤送信の防止
// ---------------------------------------------------------------------------

test("12. initial_report_sentのLeadを再度selectしても送信対象にならない（二重送信防止）", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  const first = fakeSendEmail();
  const firstResult = await sendInitialReportForLead(lead.lead_id, { sendEmail: first.fn });
  assert.equal(firstResult.ok, true);
  assert.equal((await readLead(lead.lead_id)).status, "initial_report_sent");

  const second = fakeSendEmail();
  const secondResult = await sendInitialReportForLead(lead.lead_id, { sendEmail: second.fn });

  assert.equal(secondResult.ok, false);
  assert.match(secondResult.error, /report_generated/);
  assert.equal(second.calls.length, 0, "SESは呼ばれないはず");
  assert.equal(
    (await readLead(lead.lead_id)).history.filter((h) => h.event === "initial_report_sent").length,
    1,
    "initial_report_sentイベントは1件のまま増えないはず"
  );
});

["collected", "validated", "rejected", "initial_report_queued", "initial_report_sent", "initial_report_failed"].forEach(
  (status) => {
    test(`13. status:"${status}"のLeadは誤って送信対象にならない`, async (t) => {
      withSiteConfig(t);
      const created = await createLead(sampleParams());
      t.after(() => cleanupLead(created.lead_id));
      await updateLead(created.lead_id, { status, company_slug: status === "collected" ? null : `${TEST_SLUG_PREFIX}dummy` });

      const { fn, calls } = fakeSendEmail();
      const result = await sendInitialReportForLead(created.lead_id, { sendEmail: fn });

      assert.equal(result.ok, false);
      assert.equal(calls.length, 0, "SESは呼ばれないはず");
      assert.equal((await readLead(created.lead_id)).status, status, "statusは変わらないはず");
    });
  }
);

test("company_slugが未確定（null）のLeadは送信対象にならない", async (t) => {
  withSiteConfig(t);
  const created = await createLead(sampleParams());
  t.after(() => cleanupLead(created.lead_id));
  await updateLead(created.lead_id, { status: "report_generated" }); // company_slugはnullのまま

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(created.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await readLead(created.lead_id)).status, "report_generated", "statusは変わらないはず");
});

test("存在しないlead_idはエラーになる", async (t) => {
  withSiteConfig(t);
  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead("0".repeat(64), { sendEmail: fn });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 公開ゲート（今回の調査で判明した、report_generated≠公開済みという設計上のギャップへの対応）
// ---------------------------------------------------------------------------

test("company_slugがまだ公開されていない（website/aor/data/未生成）場合は送信をスキップし、statusを変更しない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => cleanupLead(lead.lead_id));
  // publishTestCompanyData()を呼ばない = 未公開のまま

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0, "SESは呼ばれないはず");

  const updated = await readLead(lead.lead_id);
  assert.equal(updated.status, "report_generated", "未公開のためstatusは変わらないはず（失敗ではない）");
  assert.equal(
    updated.history.some((h) => h.event === "initial_report_queued" || h.event === "initial_report_failed"),
    false,
    "未公開の場合はqueued/failedいずれのhistoryも記録しないはず"
  );
});

// ---------------------------------------------------------------------------
// PJ2 AOR Phase 3-D-1: 公開ゲートがpublished-store.js（canonical state）へ完全に
// 委譲されていること（＝website/aor/data/への直接のfs参照に依存していないこと）の確認。
// published-store.jsのisPublished()自体（filesystem/S3双方）はpublished-store.test.js・
// publish-report.test.jsで検証済みのため、ここではsend-initial-report.js側が
// その戻り値を正しく送信可否判定へ反映していることだけを、published-store.jsを
// 直接差し替えて確認する（実AWSへは一切接続しない）。
// ---------------------------------------------------------------------------

test("published-store.jsのisPublished()がtrueを返せば、website/aor/data/にローカルファイルが無くても送信対象になる", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => cleanupLead(lead.lead_id));
  // publishTestCompanyData()を呼ばない = ローカルには公開データが存在しない状態のまま。

  const publishedStore = require("../published-store");
  const original = publishedStore.isPublished;
  publishedStore.isPublished = async () => true; // S3等、他backendでcanonicalがtrueな状況を模す
  t.after(() => {
    publishedStore.isPublished = original;
  });

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true, "canonical state（published-store.js）がtrueであれば、ローカルファイルの有無に関わらず送信対象になるはず");
  assert.equal(calls.length, 1);
});

test("published-store.jsのisPublished()がfalseを返せば、website/aor/data/にローカルファイルが存在していても送信をスキップする", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug); // ローカルには公開データが存在する状態にしておく

  const publishedStore = require("../published-store");
  const original = publishedStore.isPublished;
  publishedStore.isPublished = async () => false; // S3等、他backendでcanonicalがfalseな状況を模す
  t.after(() => {
    publishedStore.isPublished = original;
  });

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true, "canonical state（published-store.js）がfalseであれば、ローカルファイルが存在してもスキップされるはず");
  assert.equal(calls.length, 0, "SESは呼ばれないはず");
});

// ---------------------------------------------------------------------------
// Phase64 STEP8: メール本文生成がGate判定と同じCanonical Published Store
// （published-store.js の loadPublished()）を使うことの確認。
// isPublished()同様、published-store.js自体をモックしてS3等の別backendを模す
// （実AWSへは一切接続しない）。「sendEmailが呼ばれた」だけでなく、実際に渡された
// subject/text/htmlの中身（Opportunity Theme・会社名）までassertする。
// ---------------------------------------------------------------------------

test("TEST A/B/D: website/aor/data/にローカルファイルが無くても、loadPublished()が返すreportのOpportunity Themeがメール本文（subject/text/html）に反映される", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => cleanupLead(lead.lead_id));
  // publishTestCompanyData()を呼ばない = website/aor/data/にはローカルファイルが存在しない
  // （Lambda実行環境でwebsite/を含まないbundleを想定した状態）。

  const publishedStore = require("../published-store");
  const originalIsPublished = publishedStore.isPublished;
  const originalLoadPublished = publishedStore.loadPublished;
  publishedStore.isPublished = async () => true; // Gate: S3等、他backendでcanonicalがtrueな状況を模す
  publishedStore.loadPublished = async () => ({
    company_profile: { name: "カノニカル株式会社", industry_label: "情報サービス業" },
    human_review: { status: "approved", reviewed_at: "2026-09-08T00:00:00.000Z" },
    free_opportunity: {
      title: "カノニカルストア経由のビジネスチャンス検証サービスの立ち上げ",
      why_now: "テスト用のwhy_nowです。",
      why_company: "テスト用のwhy_companyです。",
      market_change: "テスト用のmarket_changeです。",
      first_action: "テスト用のfirst_actionです。",
      extended_analysis: { priority: "", confidence_note: "" },
    },
  });
  t.after(() => {
    publishedStore.isPublished = originalIsPublished;
    publishedStore.loadPublished = originalLoadPublished;
  });

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, true, "loadPublished()からOpportunityが取得できれば送信は成功するはず");
  assert.equal(calls.length, 1);
  const sent = calls[0];
  assert.match(sent.subject, /カノニカル株式会社/, "件名に会社名（Canonical Published Store由来）が入るはず");
  assert.ok(
    sent.text.includes("カノニカルストア経由のビジネスチャンス検証サービスの立ち上げ"),
    "本文（text）にOpportunity Theme（Canonical Published Store由来）が入るはず"
  );
  assert.ok(
    sent.html.includes("カノニカルストア経由のビジネスチャンス検証サービスの立ち上げ"),
    "本文（html）にOpportunity Theme（Canonical Published Store由来）が入るはず"
  );
  assert.doesNotMatch(sent.text + sent.html, /ご担当者様/, "company_profile.nameが取れているため、宛名フォールバックにならないはず");
});

test("TEST C: loadPublished()が返すreport titleを変えれば、メールsubject/text/htmlの内容も追従して変わる", async (t) => {
  withSiteConfig(t);
  const publishedStore = require("../published-store");
  const originalIsPublished = publishedStore.isPublished;
  const originalLoadPublished = publishedStore.loadPublished;
  publishedStore.isPublished = async () => true;
  t.after(() => {
    publishedStore.isPublished = originalIsPublished;
    publishedStore.loadPublished = originalLoadPublished;
  });

  async function sendWithTitle(title) {
    const lead = await createReportGeneratedLead();
    t.after(() => cleanupLead(lead.lead_id));
    publishedStore.loadPublished = async () => ({
      company_profile: { name: "タイトル差替株式会社" },
      human_review: { status: "approved", reviewed_at: "2026-09-08T00:00:00.000Z" },
      free_opportunity: {
        title,
        why_now: "why_now",
        why_company: "why_company",
        market_change: "market_change",
        first_action: "first_action",
      },
    });
    const { fn, calls } = fakeSendEmail();
    const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });
    assert.equal(result.ok, true);
    return calls[0];
  }

  const sentA = await sendWithTitle("フィクスチャA向けビジネスチャンスの立ち上げ");
  const sentB = await sendWithTitle("フィクスチャB向けビジネスチャンスの立ち上げ");

  assert.ok(sentA.text.includes("フィクスチャA向けビジネスチャンスの立ち上げ"));
  assert.ok(!sentA.text.includes("フィクスチャB向けビジネスチャンスの立ち上げ"));
  assert.ok(sentB.text.includes("フィクスチャB向けビジネスチャンスの立ち上げ"));
  assert.ok(!sentB.text.includes("フィクスチャA向けビジネスチャンスの立ち上げ"));
});

test("TEST E: loadPublished()がnullを返す（Published reportを取得できない）場合でも、既存の安全なfallbackで例外にならない", async (t) => {
  withSiteConfig(t);
  const lead = await createReportGeneratedLead();
  t.after(() => cleanupLead(lead.lead_id));

  const publishedStore = require("../published-store");
  const originalIsPublished = publishedStore.isPublished;
  const originalLoadPublished = publishedStore.loadPublished;
  publishedStore.isPublished = async () => true; // Gateはtrueだが
  publishedStore.loadPublished = async () => null; // 実データが取得できない矛盾したケースを模す
  t.after(() => {
    publishedStore.isPublished = originalIsPublished;
    publishedStore.loadPublished = originalLoadPublished;
  });

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  // 既存のフォールバック仕様（publishedData = (await loadPublished(...)) || {}）どおり、
  // 例外にはならず、空のteaser（宛名フォールバック等）で送信自体は継続する。
  assert.equal(result.ok, true, "既存の空フォールバック仕様により、例外にはならず送信は継続するはず");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text + calls[0].html, /undefined|null|\[object Object\]/);
});

// ---------------------------------------------------------------------------
// AOR_SITE_BASE_URL未設定時の扱い
// ---------------------------------------------------------------------------

test("AOR_SITE_BASE_URL未設定時はエラーになり、statusを変更しない（SESは呼ばれない）", async (t) => {
  const original = process.env.AOR_SITE_BASE_URL;
  delete process.env.AOR_SITE_BASE_URL;
  t.after(() => {
    if (original !== undefined) process.env.AOR_SITE_BASE_URL = original;
  });

  const lead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(lead.lead_id);
    cleanupPublished(lead.company_slug);
  });
  publishTestCompanyData(lead.company_slug);

  assert.deepEqual(missingSiteConfig(), ["AOR_SITE_BASE_URL"]);

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportForLead(lead.lead_id, { sendEmail: fn });

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
  assert.equal((await readLead(lead.lead_id)).status, "report_generated");
});

// ---------------------------------------------------------------------------
// sendInitialReportsForAllReportGenerated(): 一括処理
// 【Phase92 P6e】tmpのleadsDirで隔離したため、以前は並行テスト間競合を避けるために
// 緩めていたassert（includes / >= 1）を、厳密な一致へ戻した。
// ---------------------------------------------------------------------------

test("sendInitialReportsForAllReportGenerated: report_generatedなLeadだけを対象にする", async (t) => {
  withSiteConfig(t);
  const leadsDir = makeLeadsDir(t);

  const targetLead = createTmpReportGeneratedLead(leadsDir);
  t.after(() => cleanupPublished(targetLead.company_slug));
  publishTestCompanyData(targetLead.company_slug);

  // collectedLeadはstatus変更なし（"collected"のまま）
  const collectedLead = buildNewLead(sampleParams({ email: "batch-collected@example.invalid" }));
  writeJson(path.join(leadsDir, `${collectedLead.lead_id}.json`), collectedLead);

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportsForAllReportGenerated({ sendEmail: fn, leadsDir });

  assert.deepEqual(result.results.map((r) => r.leadId), [targetLead.lead_id], "report_generatedの自テストLeadだけが対象のはず");
  assert.deepEqual(result.summary, { total: 1, sent: 1, skipped: 0, failed: 0 });
  assert.equal(calls.length, 1, "targetLeadに対して1回だけSESが呼ばれるはず");
  assert.equal(calls[0].tags[0].Value, targetLead.lead_id);
  assert.equal(readTmpLead(leadsDir, targetLead.lead_id).status, "initial_report_sent");
  assert.equal(readTmpLead(leadsDir, collectedLead.lead_id).status, "collected", "触れられていないはず");
});

test("sendInitialReportsForAllReportGenerated: sent/skipped/failedがLeadごとに正しく判定される", async (t) => {
  withSiteConfig(t);
  const leadsDir = makeLeadsDir(t);

  const sentLead = createTmpReportGeneratedLead(leadsDir, {
    overrides: { email: "send-initial-report-sent-test@example.invalid", company_url: "https://send-initial-report-sent-test.example" },
  });
  t.after(() => cleanupPublished(sentLead.company_slug));
  publishTestCompanyData(sentLead.company_slug);

  // skippedLeadは公開しない → skip対象
  const skippedLead = createTmpReportGeneratedLead(leadsDir, {
    overrides: { email: "send-initial-report-skipped-test@example.invalid", company_url: "https://send-initial-report-skipped-test.example" },
  });

  const failedLead = createTmpReportGeneratedLead(leadsDir, {
    overrides: { email: "send-initial-report-failed-test@example.invalid", company_url: "https://send-initial-report-failed-test.example" },
  });
  t.after(() => cleanupPublished(failedLead.company_slug));
  publishTestCompanyData(failedLead.company_slug);

  const sendEmail = async (params) => {
    if (params.tags[0].Value === failedLead.lead_id) {
      throw Object.assign(new Error("ダミー失敗"), { code: "MessageRejected" });
    }
    return { messageId: "mid" };
  };

  const result = await sendInitialReportsForAllReportGenerated({ sendEmail, leadsDir });

  const byId = Object.fromEntries(result.results.map((r) => [r.leadId, r]));
  assert.equal(result.results.length, 3, "自テストの3件だけが候補のはず");
  assert.equal(byId[sentLead.lead_id].ok, true);
  assert.equal(byId[skippedLead.lead_id].ok, false);
  assert.equal(byId[skippedLead.lead_id].skipped, true);
  assert.equal(byId[failedLead.lead_id].ok, false);
  assert.equal(byId[failedLead.lead_id].skipped, undefined);
  assert.deepEqual(result.summary, { total: 3, sent: 1, skipped: 1, failed: 1 });
  assert.equal(readTmpLead(leadsDir, sentLead.lead_id).status, "initial_report_sent");
  assert.equal(readTmpLead(leadsDir, skippedLead.lead_id).status, "report_generated");
  assert.equal(readTmpLead(leadsDir, failedLead.lead_id).status, "initial_report_failed");
});

// ---------------------------------------------------------------------------
// Phase92 P6e: options.leadsDirによる一括処理の隔離
// ---------------------------------------------------------------------------

test("[P6e-T1] sendInitialReportsForAllReportGenerated({leadsDir}): tmpのLeadだけを読み、共有LEADS_DIRは読まない", async (t) => {
  withSiteConfig(t);
  const leadsDir = makeLeadsDir(t);
  const lead = createTmpReportGeneratedLead(leadsDir, {
    overrides: { email: "p6e-t1@example.invalid", company_url: "https://p6e-t1.example" },
  });
  t.after(() => cleanupPublished(lead.company_slug));
  publishTestCompanyData(lead.company_slug);

  const { fn } = fakeSendEmail();
  const { result, reads, writes } = await traceSharedLeadsAccess(() =>
    sendInitialReportsForAllReportGenerated({ sendEmail: fn, leadsDir })
  );

  assert.deepEqual(result.results.map((r) => r.leadId), [lead.lead_id], "tmp leadsDirのLeadが処理対象になるはず");
  assert.deepEqual(reads, [], "共有LEADS_DIRを一切読まないはず");
  assert.deepEqual(writes, [], "共有LEADS_DIRへ一切書かないはず");
});

test("[P6e-T3] 更新先の隔離: tmpのLeadだけがreport_generated→initial_report_sentになり、別ディレクトリのLeadは1バイトも変わらない", async (t) => {
  withSiteConfig(t);
  const leadsDir = makeLeadsDir(t);
  // 「並行実行中の他テストファイルが作ったreport_generated（approved・published）なLead」の代役
  // （aor-admin-leads.test.jsのE2E Lead相当。共有LEADS_DIRには書かない）
  const otherDir = makeLeadsDir(t);

  const target = createTmpReportGeneratedLead(leadsDir, {
    overrides: { email: "p6e-t3-target@example.invalid", company_url: "https://p6e-t3-target.example" },
  });
  const bystander = createTmpReportGeneratedLead(otherDir, {
    overrides: { email: "p6e-t3-bystander@example.invalid", company_url: "https://p6e-t3-bystander.example" },
  });
  t.after(() => {
    cleanupPublished(target.company_slug);
    cleanupPublished(bystander.company_slug);
  });
  publishTestCompanyData(target.company_slug);
  publishTestCompanyData(bystander.company_slug);
  const bystanderFile = path.join(otherDir, `${bystander.lead_id}.json`);
  const bystanderBefore = fs.readFileSync(bystanderFile, "utf8");

  const { fn, calls } = fakeSendEmail({ messageId: "p6e-t3-mid" });
  const result = await sendInitialReportsForAllReportGenerated({ sendEmail: fn, leadsDir });

  assert.deepEqual(result.results.map((r) => r.leadId), [target.lead_id]);
  assert.deepEqual(calls.map((c) => c.tags[0].Value), [target.lead_id], "対象Leadだけが送信されるはず");
  const updated = readTmpLead(leadsDir, target.lead_id);
  assert.equal(updated.status, "initial_report_sent");
  assert.deepEqual(
    updated.history.map((h) => h.event),
    ["collected", "report_generated", "initial_report_queued", "initial_report_sent"]
  );
  assert.equal(updated.history[3].metadata.message_id, "p6e-t3-mid");
  assert.equal(fs.readFileSync(bystanderFile, "utf8"), bystanderBefore, "別ディレクトリのLeadは1バイトも変わらないはず");
});

test("[P6e-T4] 後方互換: leadsDir未指定の送信（一括・単体・Weekly一括・Weekly単体）は従来どおりlead-store（LEAD_STORE_BACKEND）経由になる", async (t) => {
  // 既定経路を実際の共有LEADS_DIRで走らせると、それ自体がP6eの原因（他テストのLeadへの
  // 書き込み）になる。LEAD_STORE_BACKENDに未知の値を入れ、lead-store.getBackend()の既存エラーが
  // 返ること＝既定経路がlead-storeへ委譲されていることを、ディスクに触れずに確認する
  // （process-validated.test.jsのP6c-T4と同じ方式。envは本テスト内だけで元に戻す）。
  const { sendWeeklyReportsForAllEligibleLeads, sendWeeklyReportForLead } = require("../leads/send-weekly-report");
  const saved = process.env.LEAD_STORE_BACKEND;
  process.env.LEAD_STORE_BACKEND = "p6e-backward-compat-probe";
  t.after(() => {
    if (saved === undefined) delete process.env.LEAD_STORE_BACKEND;
    else process.env.LEAD_STORE_BACKEND = saved;
  });
  const probe = /未知のLEAD_STORE_BACKENDです: "p6e-backward-compat-probe"/;
  const { fn } = fakeSendEmail();

  const { reads, writes } = await traceSharedLeadsAccess(async () => {
    await assert.rejects(sendInitialReportsForAllReportGenerated({ sendEmail: fn }), probe);
    await assert.rejects(sendInitialReportForLead("p6e-backward-compat-lead", { sendEmail: fn }), probe);
    await assert.rejects(sendWeeklyReportsForAllEligibleLeads({ sendEmail: fn }), probe);
    await assert.rejects(sendWeeklyReportForLead("p6e-backward-compat-lead", { sendEmail: fn }), probe);
  });
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});
