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

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  sendInitialReportForLead,
  sendInitialReportsForAllReportGenerated,
  buildReportUrl,
  buildEmailContent,
  missingSiteConfig,
} = require("../leads/send-initial-report");
const { createLead, readLead, updateLead, appendHistory, LEADS_DIR } = require("../leads/lead-store");
const { AOR_DATA_DIR } = require("../publish-report");

const TEST_SLUG_PREFIX = "test-send-initial-report-";

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

test("buildEmailContent: text/htmlのいずれにもreportUrlが含まれ、companyNameで件名が組み立てられる", () => {
  const { subject, text, html } = buildEmailContent({
    companyName: "サンプル株式会社",
    reportUrl: "https://aor.example.invalid/report-preview.html?company=s&lead=l&token=t",
  });
  assert.match(subject, /サンプル株式会社/);
  assert.ok(text.includes("https://aor.example.invalid/report-preview.html?company=s&lead=l&token=t"));
  // html側はhref属性値としてHTMLエスケープされる（"&" → "&amp;"）ため、生のURL文字列
  // ではなくエスケープ後の形で含まれる（有効なHTMLとして正しい。text側は生のURLで検証する）。
  assert.ok(html.includes("https://aor.example.invalid/report-preview.html?company=s&amp;lead=l&amp;token=t"));
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
// ---------------------------------------------------------------------------

test("sendInitialReportsForAllReportGenerated: report_generatedなLeadだけを対象にする", async (t) => {
  withSiteConfig(t);

  const targetLead = await createReportGeneratedLead();
  t.after(() => {
    cleanupLead(targetLead.lead_id);
    cleanupPublished(targetLead.company_slug);
  });
  publishTestCompanyData(targetLead.company_slug);

  const collectedLead = await createLead(sampleParams({ email: "batch-collected@example.invalid" }));
  t.after(() => cleanupLead(collectedLead.lead_id));
  // collectedLeadはstatus変更なし（"collected"のまま）

  const { fn, calls } = fakeSendEmail();
  const result = await sendInitialReportsForAllReportGenerated({ sendEmail: fn });

  const processedIds = result.results.map((r) => r.leadId);
  assert.ok(processedIds.includes(targetLead.lead_id));
  assert.ok(!processedIds.includes(collectedLead.lead_id), "collectedのLeadは対象に含まれないはず");
  // 既知の並行テスト間競合（scripts/generator/logs/leads/を複数テストファイルが並行して
  // 読み書きする際、他ファイルが同時に作成したreport_generatedなLeadを一時的に拾って
  // しまうことがある）を悪化させないよう、calls.length等の厳密な総数ではなく、
  // 自分が作成したtargetLeadに対して実際にSESが呼ばれたかどうかだけを確認する。
  const callsForTarget = calls.filter((c) => c.tags[0].Value === targetLead.lead_id);
  assert.equal(callsForTarget.length, 1, "targetLeadに対して1回だけSESが呼ばれるはず");
  assert.equal((await readLead(targetLead.lead_id)).status, "initial_report_sent");
  assert.equal((await readLead(collectedLead.lead_id)).status, "collected", "触れられていないはず");
});

test("sendInitialReportsForAllReportGenerated: sent/skipped/failedがLeadごとに正しく判定される", async (t) => {
  withSiteConfig(t);

  // sampleParams()はemail/company_urlを固定値で返すため、overridesを指定せずに
  // createReportGeneratedLead()を複数回呼ぶと、P0-1で確定したemail×company_url同一性判定
  // により3件とも同一Leadに収束してしまう（resubmittedが記録されるだけで新規Leadにならない）。
  // sent/skipped/failedを独立した3件のLeadとして検証するため、それぞれ異なる
  // email・company_urlを明示的に渡す。
  const sentLead = await createReportGeneratedLead({
    overrides: { email: "send-initial-report-sent-test@example.invalid", company_url: "https://send-initial-report-sent-test.example" },
  });
  t.after(() => {
    cleanupLead(sentLead.lead_id);
    cleanupPublished(sentLead.company_slug);
  });
  publishTestCompanyData(sentLead.company_slug);

  const skippedLead = await createReportGeneratedLead({
    overrides: { email: "send-initial-report-skipped-test@example.invalid", company_url: "https://send-initial-report-skipped-test.example" },
  });
  t.after(() => cleanupLead(skippedLead.lead_id));
  // skippedLeadは公開しない → skip対象

  const failedLead = await createReportGeneratedLead({
    overrides: { email: "send-initial-report-failed-test@example.invalid", company_url: "https://send-initial-report-failed-test.example" },
  });
  t.after(() => {
    cleanupLead(failedLead.lead_id);
    cleanupPublished(failedLead.company_slug);
  });
  publishTestCompanyData(failedLead.company_slug);

  const sendEmail = async (params) => {
    if (params.tags[0].Value === failedLead.lead_id) {
      throw Object.assign(new Error("ダミー失敗"), { code: "MessageRejected" });
    }
    return { messageId: "mid" };
  };

  const result = await sendInitialReportsForAllReportGenerated({ sendEmail });

  // 既知の並行テスト間競合（他テストファイルが同時に作成したLeadを一時的に拾ってしまい
  // うる）があるため、result.summaryの厳密な総数ではなく、自分が作成した3件それぞれの
  // 個別の判定結果で検証する。summary集計自体（sent/skipped/failedへの振り分けロジック）は
  // これで十分に検証できる。
  const byId = Object.fromEntries(result.results.map((r) => [r.leadId, r]));
  assert.equal(byId[sentLead.lead_id].ok, true);
  assert.equal(byId[skippedLead.lead_id].ok, false);
  assert.equal(byId[skippedLead.lead_id].skipped, true);
  assert.equal(byId[failedLead.lead_id].ok, false);
  assert.equal(byId[failedLead.lead_id].skipped, undefined);
  assert.ok(result.summary.sent >= 1);
  assert.ok(result.summary.skipped >= 1);
  assert.ok(result.summary.failed >= 1);
});
