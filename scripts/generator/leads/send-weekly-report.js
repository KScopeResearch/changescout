#!/usr/bin/env node
/**
 * send-weekly-report.js — PJ2 AOR Phase 18: Weekly Report Delivery（ローカル実装、AWS未接続）。
 *
 * 【背景】send-initial-report.jsが実現するのは「report_generated済みLeadへの初回送信」のみで、
 * その後の「毎週最新レポートを送る」機能（Leadスキーマ上のweekly_report_consent/
 * weekly_report_sentはPhase17監査で存在確認済み）は未実装だった。本ファイルはPhase17の
 * 設計監査結果に基づき、その配信ロジック本体を実装する（Lambda adapterはPhase19の別ファイル）。
 *
 * 【対象Leadの条件（Phase17監査で確定した仕様）】
 *   - weekly_report_consent === true（Phase4-Bの同意APIで明示的に同意したLeadのみ）
 *   - status === "initial_report_sent"（初回配信が完了していること。"report_generated"のみ
 *     ではWeekly対象外。"initial_report_failed"も今回は対象外——初回未達のLeadへ「更新」を
 *     送るのは意味的に矛盾するため）
 *   - company_slugが確定済み
 *   - isDeliveryBlocked(lead) === false（既存のsend-initial-report.jsと同じ判定をそのまま再利用）
 *
 * 【「最新レポート」の定義】published/<company_slug>.json（published-store.js経由、
 * PUBLISHED_STORE_BACKENDのcanonical state）をそのまま使う。reports/・company-contexts/は
 * 参照しない（Phase12/13で確定した「published/がLambda側canonical state」の方針をそのまま
 * 踏襲。未承認のreports/を混ぜない）。
 *
 * 【二重送信防止】Leadに新設したlast_weekly_sent_report_generated_atと、published report
 * のmeta.generated_atを比較する。既存Leadにこのフィールドが無い（undefined）場合は
 * 「未送信」として扱う（後方互換。isValidIso8601()がfalseを返すため自然にそう扱われる）。
 * 送信対象と判定するのは「未送信」または「publishedのgenerated_atが前回送信時より新しい」
 * 場合のみ。送信成功後にのみこのフィールドを更新するため、SES失敗時は次回実行で
 * 同じreportが再び送信対象になる（Scheduler二重実行時の二重送信もこの比較で防止される）。
 *
 * 【initial-report-deliveryとの共通化方針】ses-client.js・redactSecrets()・
 * withRetryAndTimeout()（ses-client.js内部で使用済み）・isDeliveryBlocked()・readLead()・
 * updateLead()・appendHistory()・buildReportUrl()・missingSiteConfig()はそのまま再利用する
 * （新しい汎用delivery engineは作らない。Phase17の判断を踏襲）。一方、メール文言
 * （「完成しました」→「更新されました」）とcompanyName取得（Lambda環境でも正しく動くよう
 * publishedStore.loadPublished()のS3対応版を使う。send-initial-report.js側の
 * readJsonSafe(publishedPathFor())というローカルfs前提の実装は今回変更しない）はWeekly側で
 * 独自に実装する。
 *
 * 使い方:
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... SES_FROM=... \
 *   AOR_SITE_BASE_URL=https://aor.example.jp \
 *   node scripts/generator/leads/send-weekly-report.js
 *   （weekly_report_consent===true かつ status:"initial_report_sent" の全Leadを対象に処理する）
 */

const { readLead, updateLead, appendHistory, listLeads, isDeliveryBlocked } = require("./lead-store");
const publishedStore = require("../published-store");
const { buildReportUrl, missingSiteConfig } = require("./send-initial-report"); // report URL生成・サイト設定チェックを再利用
const { redactSecrets } = require("../shared/redact");
const { isValidIso8601 } = require("../shared/date-utils");
const { runCli } = require("../shared/cli-utils");
const sesClient = require("./ses-client");

/**
 * Weeklyメール本文（件名・text・html）を組み立てる（Pure Function）。send-initial-report.jsの
 * buildEmailContent()と構造は同じだが、「完成しました（初回）」ではなく「更新されました
 * （Weekly）」という意味になるよう文言のみを変える。
 * @param {{companyName:string, reportUrl:string}} params
 * @returns {{subject:string, text:string, html:string}}
 */
function buildWeeklyEmailContent({ companyName, reportUrl }) {
  const subject = `${companyName} 様向け AI Opportunity Report が更新されました`;

  const text = [
    `${companyName} 様`,
    "",
    "貴社向けの AI Opportunity Report（無料版）が最新の内容に更新されました。",
    "以下のURLからご覧いただけます。",
    "",
    reportUrl,
    "",
    "本メールに心当たりがない場合は、内容を破棄していただいて問題ございません。",
    "配信停止をご希望の場合は、本メールに直接ご返信ください。",
    "",
    "AI Opportunity Report 運営事務局",
  ].join("\n");

  const escapedName = sesClient.escapeHtml(companyName);
  const escapedUrl = sesClient.escapeHtml(reportUrl);
  const html =
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"></head>` +
    `<body style="font-family:sans-serif;line-height:1.7;color:#1a1a1a;">` +
    `<p>${escapedName} 様</p>` +
    `<p>貴社向けの <strong>AI Opportunity Report</strong>（無料版）が最新の内容に更新されました。</p>` +
    `<p><a href="${escapedUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;` +
    `color:#ffffff;text-decoration:none;border-radius:6px;">レポートを見る</a></p>` +
    `<p style="font-size:0.85em;color:#555555;">本メールに心当たりがない場合は、内容を破棄していただいて問題ございません。<br>` +
    `配信停止をご希望の場合は、本メールに直接ご返信ください。</p>` +
    `<p style="font-size:0.85em;color:#555555;">AI Opportunity Report 運営事務局</p>` +
    `</body></html>`;

  return { subject, text, html };
}

/**
 * 1件のLeadへWeekly（最新レポート更新）メールを送信する。
 * @param {string} leadId
 * @param {{sendEmail?: (params:Object) => Promise<{messageId:string}>, client?:Object}} [options] -
 *   sendEmailはテスト時にses-client.jsを差し替えるためのフック（send-initial-report.jsと同じ
 *   依存性注入パターン）。clientはpublishedStore.loadPublished()へ渡すテスト用S3クライアント
 *   （省略可、published-store.jsの既存DIパターンに合わせる）。
 * @returns {Promise<{ok:boolean, leadId:string, skipped?:boolean, messageId?:string, error?:string}>}
 */
async function sendWeeklyReportForLead(leadId, options = {}) {
  const sendEmailFn = options.sendEmail || sesClient.sendEmail;

  const lead = await readLead(leadId);
  if (!lead) {
    return { ok: false, leadId, error: `存在しないlead_idです: ${leadId}` };
  }
  if (lead.weekly_report_consent !== true) {
    return { ok: false, leadId, skipped: true, error: "weekly_report_consentがtrueではないため送信対象外です" };
  }
  if (lead.status !== "initial_report_sent") {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `statusが"initial_report_sent"ではないため送信対象外です（実際: "${lead.status}"）`,
    };
  }
  if (!lead.company_slug) {
    return { ok: false, leadId, skipped: true, error: "company_slugが未確定のため送信対象外です" };
  }
  if (isDeliveryBlocked(lead)) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `delivery_statusが"${lead.delivery_status}"のため送信対象外です`,
    };
  }

  const published = await publishedStore.loadPublished(lead.company_slug, options);
  if (!published) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `company_slug "${lead.company_slug}" はまだ公開されていません（published/未生成）。`,
    };
  }
  const generatedAt = published.meta && published.meta.generated_at;
  if (!isValidIso8601(generatedAt)) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `published reportのmeta.generated_atが不正です: ${lead.company_slug}`,
    };
  }
  if (
    isValidIso8601(lead.last_weekly_sent_report_generated_at) &&
    Date.parse(generatedAt) <= Date.parse(lead.last_weekly_sent_report_generated_at)
  ) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: "このreportは既に前回のWeekly配信で送信済みです（新しいreportがpublishされるまで再送しません）",
    };
  }

  // プリフライト（メール本文の組み立てまで）はLeadを一切変更しない。
  let subject, text, html;
  try {
    const missingSite = missingSiteConfig();
    if (missingSite.length) {
      throw new Error(`送信に必要な環境変数が設定されていません: ${missingSite.join(", ")}`);
    }
    const companyName = (published.company_profile && published.company_profile.name) || lead.company_slug;
    const reportUrl = buildReportUrl(process.env.AOR_SITE_BASE_URL, {
      companySlug: lead.company_slug,
      leadId: lead.lead_id,
      reportToken: lead.report_token,
    });
    ({ subject, text, html } = buildWeeklyEmailContent({ companyName, reportUrl }));
  } catch (err) {
    return { ok: false, leadId, error: err.message };
  }

  try {
    const result = await sendEmailFn({
      to: lead.email,
      subject,
      text,
      html,
      tags: [{ Name: "lead_id", Value: lead.lead_id }],
    });

    // 送信成功時にのみ、送信済み判定に使うgenerated_atを更新する（この順序が
    // 二重送信防止の要。SES失敗時はここへ到達しないため、次回実行で同じreportが
    // 再び送信対象になる）。
    await updateLead(leadId, { last_weekly_sent_report_generated_at: generatedAt });
    await appendHistory(leadId, "weekly_report_sent", {
      message_id: result.messageId,
      report_generated_at: generatedAt,
    });
    return { ok: true, leadId, messageId: result.messageId };
  } catch (err) {
    // send-initial-report.jsのinitial_report_failedと同じ扱い: statusは触らず
    // （Weeklyはstatusを一切変更しない設計）、historyにのみ失敗を記録する。
    // AWS credential・report_token・emailはerrに含まれない構造（ses-client.jsのコメント参照）。
    await appendHistory(leadId, "weekly_report_failed", {
      error: redactSecrets(err.message),
      code: err.code || null,
      retryable: !!err.retryable,
    });
    return { ok: false, leadId, error: err.message };
  }
}

/**
 * weekly_report_consent===true かつ status:"initial_report_sent" の全Leadへ、1件ずつ
 * Weeklyメールを送信する。
 * @param {Object} [options] - sendWeeklyReportForLead()と同じ
 * @returns {Promise<{summary:{total:number, sent:number, skipped:number, failed:number}, results:Array<Object>}>}
 */
async function sendWeeklyReportsForAllEligibleLeads(options = {}) {
  // ここでの絞り込みは軽量なフィールド比較のみ（consent・status）。published/generated_atの
  // 比較を含む正式な判定はsendWeeklyReportForLead()内部で行う（判定ロジックの二重実装を避ける）。
  const candidates = (await listLeads()).filter(
    (lead) => lead.weekly_report_consent === true && lead.status === "initial_report_sent"
  );
  const results = [];

  for (const lead of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sendWeeklyReportForLead(lead.lead_id, options);
    results.push(result);
  }

  return {
    summary: {
      total: results.length,
      sent: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok && r.skipped).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
    },
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** @param {{summary:Object, results:Array<Object>}} result */
function printSummary(result) {
  console.log("\n=== Weekly Report送信結果 ===");
  console.log(`total: ${result.summary.total}`);
  console.log(`sent: ${result.summary.sent}`);
  console.log(`skipped: ${result.summary.skipped}`);
  console.log(`failed: ${result.summary.failed}`);

  const sent = result.results.filter((r) => r.ok);
  if (sent.length) {
    console.log("\n--- 送信成功 ---");
    sent.forEach((r) => console.log(`lead_id: ${r.leadId} → message_id: ${r.messageId}`));
  }

  const skipped = result.results.filter((r) => !r.ok && r.skipped);
  if (skipped.length) {
    console.log("\n--- スキップ ---");
    skipped.forEach((r) => console.log(`lead_id: ${r.leadId} - ${r.error}`));
  }

  const failed = result.results.filter((r) => !r.ok && !r.skipped);
  if (failed.length) {
    console.log("\n--- 送信失敗 ---");
    failed.forEach((r) => console.log(`lead_id: ${r.leadId} - ${r.error}`));
  }
}

async function main() {
  const missing = [...sesClient.missingEnvVars(), ...missingSiteConfig()];
  if (missing.length) {
    console.error(`SES送信に必要な環境変数が設定されていません: ${missing.join(", ")}`);
    console.error("AWS認証情報・SES_FROM・AOR_SITE_BASE_URLを設定してから再実行してください。");
    process.exitCode = 1;
    return;
  }

  const result = await sendWeeklyReportsForAllEligibleLeads();
  printSummary(result);
  if (result.summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  sendWeeklyReportForLead,
  sendWeeklyReportsForAllEligibleLeads,
  buildWeeklyEmailContent,
};
