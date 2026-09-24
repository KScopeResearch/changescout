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
 *   blastengine送信（scripts/generator/leads/blastengine-client.js、Phase45 STEP3Bで
 *   ses-client.jsから切り替え。Weekly AOR送信は引き続きses-client.jsのまま）
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
 * 【PJ2 AOR Phase 3-D-1】isPublished()はpublished-store.js経由（Lambda側の公開判定にも
 * 使えるcanonical state）になり、Promiseを返すようになったためawaitして使う。
 *
 * 【Phase64 STEP8】メール本文生成用のpublished report取得も、isPublished()と同じ
 * published-store.js（loadPublished()、PUBLISHED_STORE_BACKEND経由のcanonical state）を
 * 使うよう統一した。以前はpublish-report.jsのpublishedPathFor()（常にfilesystem固定パス
 * website/aor/data/<slug>.jsonを返す）+ readJsonSafe()を直接使っており、Gate判定
 * （isPublished()）とメール本文生成のデータソースが食い違っていた。PUBLISHED_STORE_BACKEND=s3
 * のLambda実行環境（website/を含まないbundle）ではこのfilesystemパスが物理的に存在せず、
 * メール本文が常にreport-teaser.jsの空フォールバックになっていた（Phase64 STEP7 RCA参照）。
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
 * 【delivery_status送信ゲート（監査で発見・修正）】status:"report_generated"であっても、
 * delivery_status（配信可否を表す別概念。lead-store.jsのisDeliveryBlocked()参照）が
 * "unsubscribed"/"bounced"/"suppressed"のLeadは送信しない。判定はlead-store.jsの
 * isDeliveryBlocked()をそのまま再利用し、独自の判定ロジックはここに新設しない。
 * status:"rejected"は単独では配信ブロック理由にならない（isDeliveryBlocked()の既存仕様）
 * ため、rejectedかどうかとdelivery_statusは完全に独立して扱う。ブロック時は公開ゲートと
 * 同様「skip」として扱い、status/historyを一切変更しない。
 *
 * 【delivery_approval_status送信ゲート（PJ2 AOR: Candidate/Approved分離仕様で追加）】
 * status:"report_generated"かつ未公開ゲート・delivery_statusゲートを通過しても、
 * delivery_approval_status（lead-store.jsのisDeliveryApproved()参照）が"approved"で
 * ないLeadは送信しない。CandidateとしてLeadが作られただけでは自動的にApprovedには
 * ならない（buildNewLead()の既定値は"pending"）ため、Approvedへの昇格は
 * import-leads.js・create-lead-from-email.js等の収集経路とは別の、明示的な操作
 * （updateLead()によるdelivery_approval_status更新）を経る必要がある。他のゲートと
 * 同様「skip」として扱い、status/historyを一切変更しない。
 *
 * 使い方:
 *   BLASTENGINE_USER_ID=... BLASTENGINE_API_KEY=... BLASTENGINE_FROM=... \
 *   AOR_SITE_BASE_URL=https://aor.example.jp \
 *   node scripts/generator/leads/send-initial-report.js
 *   （status:"report_generated"の全Leadを対象に一括処理する）
 */

const fs = require("fs");
const path = require("path");

const {
  readLead,
  updateLead,
  appendHistory,
  listLeads,
  applyPatch,
  withHistoryEvent,
  isDeliveryBlocked,
  isDeliveryApproved,
} = require("./lead-store");
const { readJson, writeJson } = require("../shared/json-file");
const { validateSlug, isWithinDir } = require("../shared/path-safety");
// publishedStoreはモジュールオブジェクトごとrequireし、呼び出し時にプロパティ経由で参照する
// （分割代入で関数を先に取り出すと、テストがpublishedStore.isPublished/loadPublishedを
// 差し替えても反映されない。publish-report.jsのisPublished()と同じ呼び出しパターン）。
const publishedStore = require("../published-store");
const { redactSecrets } = require("../shared/redact");
const { runCli } = require("../shared/cli-utils");
const { buildUnsubscribeUrl } = require("./unsubscribe-url");
const { buildTeaser } = require("../shared/report-teaser");
const { renderInitialReportEmail } = require("./email-render");
// PJ2 AOR Phase45 STEP3B: Initial AORの送信基盤をSESからblastengineへ切り替えた
// （docs/strategy_v2/13_architecture.md「メール送信アーキテクチャ v1.0」）。
// Weekly AOR（send-weekly-report.js）は引き続きses-client.jsを使用し、本ファイルの変更対象外。
const mailClient = require("./blastengine-client");

// AOR_SITE_BASE_URL: website/aor（受信者向け静的LP）の配置先ベースURL。
// common.js の LEAD_API_BASE_URL / OPERATOR_EMAIL と同じ「配置ごとに設定する」方針を踏襲する
// （本番のAOR公開URLは本実装時点で未確定のため、決め打ちにしない）。
const SITE_CONFIG_VARS = ["AOR_SITE_BASE_URL"];

// options.leadsDir未指定時の既定ストア（従来どおりlead-store経由、LEAD_STORE_BACKENDに従う）。
const DEFAULT_STORE = { readLead, updateLead, appendHistory, listLeads };

/**
 * options.leadsDirで指定した1ディレクトリだけを読み書きするLeadストアを返す
 * （Phase92 P6e: テスト隔離用。process-validated.jsのdirStore()（Phase89 P6c）と同じ実装の
 * 局所コピー。lead-store.jsのI/O関数は保存先がshared/paths.jsのLEADS_DIR固定のため、ここで
 * 同じインタフェースを組み立てる。状態の組み立てはlead-store.jsのPure Function
 * （applyPatch/withHistoryEvent）をそのまま使い、ファイル形式・パス検証は
 * filesystem-backend.jsと同じjson-file/path-safetyに揃える）。
 * @param {string} leadsDir
 */
function dirStore(leadsDir) {
  const leadFilePath = (leadId) => {
    const check = validateSlug(leadId);
    if (!check.ok) throw new Error(`不正なlead_idです: ${check.error}`);
    const filePath = path.join(leadsDir, `${leadId}.json`);
    if (!isWithinDir(filePath, leadsDir)) throw new Error("不正なlead_idです（パス検証に失敗しました）");
    return filePath;
  };
  const read = async (leadId) => {
    const filePath = leadFilePath(leadId);
    return fs.existsSync(filePath) ? readJson(filePath) : null;
  };
  const modify = async (leadId, fn) => {
    const lead = await read(leadId);
    if (!lead) throw new Error(`存在しないlead_idです: ${leadId}`);
    const updated = fn(lead);
    writeJson(leadFilePath(leadId), updated);
    return updated;
  };
  return {
    readLead: read,
    updateLead: (leadId, patch) => modify(leadId, (lead) => applyPatch(lead, patch)),
    appendHistory: (leadId, event, metadata) => modify(leadId, (lead) => withHistoryEvent(lead, event, metadata)),
    listLeads: async () => {
      if (!fs.existsSync(leadsDir)) return [];
      return fs
        .readdirSync(leadsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readJson(path.join(leadsDir, entry.name)));
    },
  };
}

/** @param {{leadsDir?: string}} options */
function resolveStore(options) {
  return options.leadsDir ? dirStore(options.leadsDir) : DEFAULT_STORE;
}

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
 * メール本文（件名・text・html）を組み立てる（Pure Function・Phase55 STEP4）。
 * 「レポートが完成しました」という通知ではなく、published JSON から派生した個社別の
 * Opportunity teaser（title / なぜ今 / なぜ御社か / 市場の動き）を載せ、詳細は
 * reportUrl（既存の Preview URL）へ誘導する。LLM・API は呼ばない・数字を作らない。
 * teaser の値は Preview Hero と「同じ published JSON から」派生する（report-teaser.js）。
 * @param {{report:Object, reportUrl:string, unsubscribeUrl?:string}} params
 * @returns {{subject:string, text:string, html:string}}
 */
function buildEmailContent({ report, reportUrl, unsubscribeUrl }) {
  const teaser = buildTeaser(report || {}, reportUrl);
  const { subject, text, html } = renderInitialReportEmail(teaser, { unsubscribeUrl });
  return { subject, text, html };
}

/**
 * 1件のLeadへ初期レポートメールを送信する。
 * @param {string} leadId
 * @param {{sendEmail?: (params:Object) => Promise<{messageId:string}>, leadsDir?: string}} [options] -
 *   sendEmailはテスト時にblastengine-client.jsを差し替えるためのフック（省略時は実際の
 *   mailClient.sendEmail()を使う。実HTTP通信・実API認証を伴うため、テストでは
 *   ネットワーク非依存のダミー関数に差し替える。process-validated.jsの
 *   options.generateReportと同じ依存性注入パターン）。
 * @returns {Promise<{ok:boolean, leadId:string, skipped?:boolean, messageId?:string, error?:string}>}
 */
async function sendInitialReportForLead(leadId, options = {}) {
  const sendEmailFn = options.sendEmail || mailClient.sendEmail;
  // Phase92 P6e: leadsDir指定時はそのディレクトリだけを読み書きする（テスト隔離用）。
  // 未指定時は従来どおりlead-store経由。
  const store = resolveStore(options);

  const lead = await store.readLead(leadId);
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
  // 送信前ゲート（監査で発見された不具合の修正）: 配信可否はdelivery_statusのみで判断する。
  // status:"rejected"は単独では配信ブロック理由にならない（isDeliveryBlocked()の既存仕様、
  // lead-store.js参照）ため、独自の判定ロジックはここに新設せず、既存のisDeliveryBlocked()を
  // そのまま再利用する。ブロック時は公開ゲートと同様「skip」として扱い、status/historyは
  // 一切変更しない（SES送信を試みてすらいないため、initial_report_failedにはしない）。
  if (isDeliveryBlocked(lead)) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `delivery_statusが"${lead.delivery_status}"のため送信対象外です`,
    };
  }
  if (!(await publishedStore.isPublished(lead.company_slug))) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `company_slug "${lead.company_slug}" はまだ公開されていません（website/aor/data/未生成）。先にレビュー承認・公開を行ってください。`,
    };
  }
  // PJ2 AOR: Candidate/Approved分離仕様（送信前ゲートの5番目）。ここまでの4条件
  // （status/company_slug/isDeliveryBlocked/isPublished）を満たしても、
  // delivery_approval_statusが"approved"でなければ送信しない。Candidate（収集された
  // だけのLead）が承認手続きを経ずにそのままSES送信対象になることを防ぐための必須ゲート
  // （lead-store.jsのisDeliveryApproved()をそのまま再利用し、独自の判定ロジックは
  // ここに新設しない）。ブロック時は他のゲートと同様「skip」として扱い、status/historyは
  // 一切変更しない。
  if (!isDeliveryApproved(lead)) {
    return {
      ok: false,
      leadId,
      skipped: true,
      error: `delivery_approval_statusが"approved"ではないため送信対象外です（実際: "${lead.delivery_approval_status}"）`,
    };
  }

  // プリフライト（メール本文の組み立てまで）はLeadのstatus/historyを一切変更しない。
  // ここで失敗した場合はinitial_report_failedにはしない（送信を試みてすらいないため）。
  let subject, text, html, unsubscribe;
  try {
    const missingSite = missingSiteConfig();
    if (missingSite.length) {
      throw new Error(`送信に必要な環境変数が設定されていません: ${missingSite.join(", ")}`);
    }
    // Phase64 STEP8: isPublished()と同じCanonical Published Store（PUBLISHED_STORE_BACKEND
    // 経由）からpublished reportを取得する。以前はwebsite/aor/data/<slug>.jsonという
    // filesystem固定パスを直接読んでいたため、PUBLISHED_STORE_BACKEND=s3のLambda実行環境
    // （website/を含まないbundle）ではこのファイルが物理的に存在せず、メール本文が常に
    // report-teaser.jsの空フォールバック（Opportunity非表示・宛名「ご担当者様」）に
    // なっていた（Gate判定のisPublished()はS3を正しく見るが、本文生成側だけfilesystemの
    // ままだった不整合。Phase64 STEP7 RCA参照）。
    const publishedData = (await publishedStore.loadPublished(lead.company_slug)) || {};
    // company_profile.name が取れない場合は company_slug をフォールバック名にする
    if (!publishedData.company_profile || !publishedData.company_profile.name) {
      publishedData.company_profile = Object.assign({}, publishedData.company_profile, {
        name: (publishedData.company_profile && publishedData.company_profile.name) || lead.company_slug,
      });
    }
    const reportUrl = buildReportUrl(process.env.AOR_SITE_BASE_URL, {
      companySlug: lead.company_slug,
      leadId: lead.lead_id,
      reportToken: lead.report_token,
    });

    // PJ2 AOR Phase45 STEP3A/3B/3C: 配信停止URLの組み立て（Provider非依存の共通ヘルパー
    // unsubscribe-url.jsを使用）。blastengineの公式API仕様（STEP3Cで確認）に合わせ、
    // list_unsubscribeフィールド用の{url, mailto}という形でmailClient.sendEmail()へ渡す
    // （RFC 8058ヘッダー文字列ではなく、blastengine-client.js側が構造化データから
    // list_unsubscribeを組み立てる）。まだ実送信は行っていない。
    const unsubscribeUrl = buildUnsubscribeUrl(process.env.AOR_SITE_BASE_URL, {
      leadId: lead.lead_id,
      reportToken: lead.report_token,
    });
    unsubscribe = { url: unsubscribeUrl, mailto: process.env.BLASTENGINE_FROM || undefined };

    // Phase55 STEP4: published JSON から個社別 Opportunity teaser メールを組み立てる
    // （teaser の値は Preview Hero と同じ published JSON から派生する）。
    ({ subject, text, html } = buildEmailContent({ report: publishedData, reportUrl, unsubscribeUrl }));
  } catch (err) {
    return { ok: false, leadId, error: err.message };
  }

  // ここからキュー投入。以降の失敗はinitial_report_failedとして必ずhistoryに残す。
  await store.updateLead(leadId, { status: "initial_report_queued" });
  await store.appendHistory(leadId, "initial_report_queued");

  try {
    // message tag（lead_idのみ）を付与する。emailやreport_tokenはtagに含めない。
    const result = await sendEmailFn({
      to: lead.email,
      subject,
      text,
      html,
      tags: [{ Name: "lead_id", Value: lead.lead_id }],
      unsubscribe,
    });

    await store.updateLead(leadId, { status: "initial_report_sent" });
    await store.appendHistory(leadId, "initial_report_sent", { message_id: result.messageId });
    return { ok: true, leadId, messageId: result.messageId };
  } catch (err) {
    await store.updateLead(leadId, { status: "initial_report_failed" });
    // API認証情報・report_token・emailはerrに含まれない構造（blastengine-client.jsのコメント参照）。
    // 念のためjob-runner.js（Task23）と同じくredactSecrets()を通してからhistoryへ保存する。
    await store.appendHistory(leadId, "initial_report_failed", {
      error: redactSecrets(err.message),
      code: err.code || null,
      retryable: !!err.retryable,
    });
    return { ok: false, leadId, error: err.message };
  }
}

/**
 * status:"report_generated"の全Leadへ、1件ずつ初期レポートメールを送信する。
 * @param {Object} [options] - sendInitialReportForLead()と同じ。options.leadsDirを指定すると
 *   そのディレクトリだけを走査・更新する（テスト隔離用、Phase92 P6e: 共有のlogs/leads/を
 *   全件走査すると並行実行中の他テストのLeadへ書き込んでしまうため）。省略時は従来どおり
 *   lead-storeのlistLeads()で全件を走査する。
 * @returns {Promise<{summary:{total:number, sent:number, skipped:number, failed:number}, results:Array<Object>}>}
 */
async function sendInitialReportsForAllReportGenerated(options = {}) {
  const candidates = (await resolveStore(options).listLeads()).filter((lead) => lead.status === "report_generated");
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
  const missing = [...mailClient.missingEnvVars(), ...missingSiteConfig()];
  if (missing.length) {
    console.error(`blastengine送信に必要な環境変数が設定されていません: ${missing.join(", ")}`);
    console.error("BLASTENGINE_USER_ID・BLASTENGINE_API_KEY・BLASTENGINE_FROM・AOR_SITE_BASE_URLを設定してから再実行してください。");
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
