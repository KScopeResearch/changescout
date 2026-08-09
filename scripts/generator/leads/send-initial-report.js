#!/usr/bin/env node
/**
 * send-initial-report.js — PJ2 Phase3本体: report_generated済みLeadへの初期レポートメール送信CLI。
 *
 * 処理フロー:
 *   status: report_generated
 *           ↓（プリフライト検証。副作用なし）
 *           ↓ 公開済みチェック・環境変数チェック・メール本文組み立て
 *           ↓
 *   status: initial_report_queued（history追加）
 *           ↓
 *   SES送信（scripts/generator/leads/ses-client.js）
 *      ├─ 成功 → status: initial_report_sent（history: message_id）
 *      └─ 失敗 → status: initial_report_failed（history: 失敗理由・コード）
 *
 * 【調査結果: 公開ゲートについて】status:"report_generated"は、Phase2
 * （generate-company-report.jsによるreport.json生成）の完了のみを意味し、
 * website/aor/data/<slug>.json への公開（scripts/generator/publish-report.js、
 * review.status:"approved"の人間レビューが必須）とは独立している。両者を混同すると、
 * まだ公開されていないcompany_slugへのリンクをメールで送ってしまい、受信者が
 * report-preview.htmlを開いた際に「データが見つかりません」エラーになる。そのため、
 * publishReport()と同じ判定関数（isPublished()）を再利用し、未公開のLeadは
 * status/historyを一切変更せず送信対象から除外する（失敗ではなく「まだ準備できていない」
 * ため、initial_report_failedにはしない）。
 *
 * 【Job Runnerを使わない理由（既存調査の再確認）】jobs/job-store.jsはプロセス内メモリの
 * Mapで状態を保持する設計であり、website/aor-admin/server.js（常駐プロセス）内で動かす
 * 前提の仕組みである。本CLIのような独立した一回実行のスクリプトから無理にenqueue()しても、
 * 実際にポーリング・実行するプロセスとはメモリ空間が別であるため処理される保証がない
 * （process-validated.jsで既に確認済みの制約と同じ）。したがって独立CLIとして実装する。
 *
 * 【二重送信防止】対象はstatus==="report_generated"のLeadのみ（collected/validated/
 * rejected/initial_report_queued/initial_report_sent/initial_report_failedは対象外）。
 * initial_report_sentのLeadを再度selectすることはなく、initial_report_failedを
 * このCLIが勝手にinitial_report_queuedへ戻すこともしない（再送は別タスク）。
 *
 * 使い方:
 *   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... SES_FROM=... \
 *   AOR_SITE_BASE_URL=https://aor.example.jp \
 *   node scripts/generator/leads/send-initial-report.js
 *   （status:"report_generated"の全Leadを対象に一括処理する）
 */

const { readLead, updateLead, appendHistory, listLeads } = require("./lead-store");
const { isPublished, publishedPathFor } = require("../publish-report");
const { readJsonSafe } = require("../shared/json-file");
const { redactSecrets } = require("../shared/redact");
const { runCli } = require("../shared/cli-utils");
const sesClient = require("./ses-client");

// AOR_SITE_BASE_URL: website/aor（受信者向け静的LP）の配置先ベースURL。
// common.js の LEAD_API_BASE_URL / OPERATOR_EMAIL と同じ「配置ごとに設定する」方針を踏襲する
// （本番のAOR公開URLは本実装時点で未確定のため、決め打ちにしない）。
const SITE_CONFIG_VARS = ["AOR_SITE_BASE_URL"];

/** @returns {string[]} */
function missingSiteConfig() {
  return SITE_CONFIG_VARS.filter((name) => !process.env[name]);
}

/**
 * report-preview.htmlへのURLを組み立てる。company_slugはLeadに確定済みの値をそのまま使い、
 * company_urlから再生成しない。emailはいかなる形でもURLへ含めない。
 * @param {string} baseUrl - AOR_SITE_BASE_URL
 * @param {{companySlug:string, leadId:string, reportToken:string}} params
 * @returns {string}
 */
function buildReportUrl(baseUrl, { companySlug, leadId, reportToken }) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("report-preview.html", normalizedBase);
  url.searchParams.set("company", companySlug);
  url.searchParams.set("lead", leadId);
  url.searchParams.set("token", reportToken);
  return url.toString();
}

/**
 * メール本文（件名・text・html）を組み立てる（Pure Function）。デザイン刷新が目的ではなく、
 * report-previewへの正しい導線確立が目的のため、既存UIの文言・トーン（「AI Opportunity
 * Report」「様向けレポート」等、report-preview.js/email-capture.htmlの既存コピーに準拠）を
 * 大きく外れない範囲の最小構成にとどめる。
 * @param {{companyName:string, reportUrl:string}} params
 * @returns {{subject:string, text:string, html:string}}
 */
function buildEmailContent({ companyName, reportUrl }) {
  const subject = `${companyName} 様向け AI Opportunity Report が完成しました`;

  const text = [
    `${companyName} 様`,
    "",
    "貴社向けの AI Opportunity Report（無料版）が完成しました。",
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
    `<p>貴社向けの <strong>AI Opportunity Report</strong>（無料版）が完成しました。</p>` +
    `<p><a href="${escapedUrl}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;` +
    `color:#ffffff;text-decoration:none;border-radius:6px;">レポートを見る</a></p>` +
    `<p style="font-size:0.85em;color:#555555;">本メールに心当たりがない場合は、内容を破棄していただいて問題ございません。<br>` +
    `配信停止をご希望の場合は、本メールに直接ご返信ください。</p>` +
    `<p style="font-size:0.85em;color:#555555;">AI Opportunity Report 運営事務局</p>` +
    `</body></html>`;

  return { subject, text, html };
}

/**
 * 1件のLeadへ初期レポートメールを送信する。
 * @param {string} leadId
 * @param {{sendEmail?: (params:Object) => Promise<{messageId:string}>}} [options] -
 *   sendEmailはテスト時にses-client.jsを差し替えるためのフック（省略時は実際の
 *   sesClient.sendEmail()を使う。実HTTP通信・実AWS認証を伴うため、テストでは
 *   ネットワーク非依存のダミー関数に差し替える。process-validated.jsの
 *   options.generateReportと同じ依存性注入パターン）。
 * @returns {Promise<{ok:boolean, leadId:string, skipped?:boolean, messageId?:string, error?:string}>}
 */
async function sendInitialReportForLead(leadId, options = {}) {
  const sendEmailFn = options.sendEmail || sesClient.sendEmail;

  const lead = readLead(leadId);
  if (!lead) {
    return { ok: false, leadId, error: `存在しないlead_idです: ${leadId}` };
  }
  if (lead.status !== "report_generated") {
    return {
      ok: false,
      leadId,
      error: `statusが"report_generated"ではないため送信対象外です（実際: "${lead.status}"）`,
    };
  }
  if (!lead.company_slug) {
    return { ok: false, leadId, error: "company_slugが未確定のため送信対象外です" };
  }
  if (!isPublished(lead.company_slug)) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `company_slug "${lead.company_slug}" はまだ公開されていません（website/aor/data/未生成）。先にレビュー承認・公開を行ってください。`,
    };
  }

  // プリフライト（メール本文の組み立てまで）はLeadのstatus/historyを一切変更しない。
  // ここで失敗した場合はinitial_report_failedにはしない（SES送信を試みてすらいないため）。
  let subject, text, html;
  try {
    const missingSite = missingSiteConfig();
    if (missingSite.length) {
      throw new Error(`送信に必要な環境変数が設定されていません: ${missingSite.join(", ")}`);
    }
    const publishedData = readJsonSafe(publishedPathFor(lead.company_slug));
    const companyName =
      (publishedData && publishedData.company_profile && publishedData.company_profile.name) || lead.company_slug;
    const reportUrl = buildReportUrl(process.env.AOR_SITE_BASE_URL, {
      companySlug: lead.company_slug,
      leadId: lead.lead_id,
      reportToken: lead.report_token,
    });
    ({ subject, text, html } = buildEmailContent({ companyName, reportUrl }));
  } catch (err) {
    return { ok: false, leadId, error: err.message };
  }

  // ここからキュー投入。以降の失敗はinitial_report_failedとして必ずhistoryに残す。
  updateLead(leadId, { status: "initial_report_queued" });
  appendHistory(leadId, "initial_report_queued");

  try {
    // SES message tag（lead_idのみ）を付与する。emailやreport_tokenはtagに含めない。
    const result = await sendEmailFn({
      to: lead.email,
      subject,
      text,
      html,
      tags: [{ Name: "lead_id", Value: lead.lead_id }],
    });

    updateLead(leadId, { status: "initial_report_sent" });
    appendHistory(leadId, "initial_report_sent", { message_id: result.messageId });
    return { ok: true, leadId, messageId: result.messageId };
  } catch (err) {
    updateLead(leadId, { status: "initial_report_failed" });
    // AWS credential・report_token・emailはerrに含まれない構造（ses-client.jsのコメント参照）。
    // 念のためjob-runner.js（Task23）と同じくredactSecrets()を通してからhistoryへ保存する。
    appendHistory(leadId, "initial_report_failed", {
      error: redactSecrets(err.message),
      code: err.code || null,
      retryable: !!err.retryable,
    });
    return { ok: false, leadId, error: err.message };
  }
}

/**
 * status:"report_generated"の全Leadへ、1件ずつ初期レポートメールを送信する。
 * @param {Object} [options] - sendInitialReportForLead()と同じ
 * @returns {Promise<{summary:{total:number, sent:number, skipped:number, failed:number}, results:Array<Object>}>}
 */
async function sendInitialReportsForAllReportGenerated(options = {}) {
  const candidates = listLeads().filter((lead) => lead.status === "report_generated");
  const results = [];

  for (const lead of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await sendInitialReportForLead(lead.lead_id, options);
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
  console.log("\n=== Phase3 初期レポート送信結果 ===");
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
  // 一括送信の前に、送信そのものに必要な環境変数が揃っているかをまとめて確認する
  // （揃っていない場合、Lead 1件ごとに同じエラーを繰り返し表示するのを避けるため）。
  const missing = [...sesClient.missingEnvVars(), ...missingSiteConfig()];
  if (missing.length) {
    console.error(`SES送信に必要な環境変数が設定されていません: ${missing.join(", ")}`);
    console.error("AWS認証情報・SES_FROM・AOR_SITE_BASE_URLを設定してから再実行してください。");
    process.exitCode = 1;
    return;
  }

  const result = await sendInitialReportsForAllReportGenerated();
  printSummary(result);
  if (result.summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  sendInitialReportForLead,
  sendInitialReportsForAllReportGenerated,
  buildReportUrl,
  buildEmailContent,
  missingSiteConfig,
};
