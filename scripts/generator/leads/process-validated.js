#!/usr/bin/env node
/**
 * process-validated.js — PJ2 Phase1→Phase2接続層。
 *
 * status:"validated"のLeadについて、Leadのcompany_urlを既存のレポート生成パイプライン
 * （generate-company-report.js）へそのまま渡し、成功したらLeadのcompany_slugを確定させ、
 * status:"report_generated"へ更新する。
 *
 * 【既存コードの再利用について】generate-company-report.jsは、自身のdocstringに
 * 「CLI（main()）とJob Runner（Task16のjob-engine.js）の両方から呼ばれる、副作用込みの
 * 中核処理」と明記されており、`generateCompanyReport()`は直接requireして呼べる設計に
 * 既になっている。job-engine.jsの"generate-report"ジョブタイプも同じ関数をそのまま
 * 呼んでいるだけで、独自の生成ロジックは持たない。今回もこれを踏襲し、
 * generateCompanyReport()を直接requireして呼び出す（generate-company-report.js自体は
 * 一切変更しない）。
 *
 * 【Job Runner経由にしなかった理由】jobs/job-store.jsは「プロセス内メモリのMap」で
 * ジョブを保持する設計であり（job-store.jsの既存コメント: 「プロセスを再起動すると
 * ジョブは全て失われる」）、website/aor-admin/server.js（常駐プロセス）内で動かす前提の
 * 仕組みである。本CLIのような独立した一回実行のスクリプトからjob-runner.jsへ
 * enqueue()しても、そのジョブを実際にポーリング・実行するプロセス（aor-admin/server.js）
 * とはメモリ空間が別であるため、ジョブが処理される保証がない。したがって、Job Runnerを
 * 経由せずgenerateCompanyReport()を直接呼ぶ方式のみが技術的に成立する。
 *
 * 【再実行時の安全性】status:"validated"以外のLead（collected/rejected/report_generated
 * 以降）は処理対象外とし、processValidatedLead()自身がstatusを確認して弾く（呼び出し元の
 * フィルタ漏れがあっても二重処理しない多層防御）。既にreport.jsonが存在する場合の上書き
 * 可否は、generate-company-report.js自体の既存の挙動（常に上書きする、Task18以来の仕様）を
 * そのまま踏襲し、本ファイルでは新たな上書き制御を追加しない。
 *
 * 使い方:
 *   node scripts/generator/leads/process-validated.js
 *   （status:"validated"の全Leadを対象に一括処理する）
 */

const { generateCompanyReport } = require("../generate-company-report");
const { runCli } = require("../shared/cli-utils");
const { readLead, updateLead, appendHistory, listLeads } = require("./lead-store");

/**
 * 1件のvalidated Leadを処理する。
 * @param {string} leadId
 * @param {{generateReport?: (companyUrl:string) => Promise<Object>}} [options] -
 *   generateReportはテスト時に差し替えるためのフック（省略時は実際の
 *   generateCompanyReport()を使う。実HTTP取得を伴うため、テストでは
 *   ネットワーク非依存のダミー関数に差し替える）。
 * @returns {Promise<{ok:boolean, leadId:string, slug?:string, error?:string}>}
 */
async function processValidatedLead(leadId, options = {}) {
  const generateReport = options.generateReport || generateCompanyReport;

  const lead = await readLead(leadId);
  if (!lead) {
    return { ok: false, leadId, error: `存在しないlead_idです: ${leadId}` };
  }
  if (lead.status !== "validated") {
    return {
      ok: false,
      leadId,
      error: `statusが"validated"ではないため処理対象外です（実際: "${lead.status}"）`,
    };
  }

  let result;
  try {
    result = await generateReport(lead.company_url);
  } catch (err) {
    return { ok: false, leadId, error: `レポート生成中にエラーが発生しました: ${err.message}` };
  }

  if (!result || !result.validation || !result.validation.ok) {
    const errors = result && result.validation ? result.validation.errors : ["不明なエラー"];
    return {
      ok: false,
      leadId,
      slug: result ? result.slug : undefined,
      error: `生成されたレポートの検証に失敗しました: ${errors.join("; ")}`,
    };
  }

  // company_slugは既存パイプラインの正式なslug生成結果（generateCompanyReport()の
  // 戻り値のslug、内部ではslugFromUrl()由来）をそのまま使う。独自に推測・生成しない。
  await updateLead(leadId, { company_slug: result.slug, status: "report_generated" });
  await appendHistory(leadId, "report_generated", { slug: result.slug });

  return { ok: true, leadId, slug: result.slug };
}

/**
 * status:"validated"の全Leadを1件ずつ処理する。
 * @param {{generateReport?: Function}} [options]
 * @returns {Promise<{summary:{total:number, succeeded:number, failed:number}, results:Array<Object>}>}
 */
async function processAllValidatedLeads(options = {}) {
  const candidates = (await listLeads()).filter((lead) => lead.status === "validated");
  const results = [];

  // 直列実行にする（同時にJob Runnerや他のプロセスがLeadファイルを触ることを
  // 想定した多重実行対策は今回のスコープ外。MVP規模のシンプルさを優先する）。
  for (const lead of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processValidatedLead(lead.lead_id, options);
    results.push(result);
  }

  return {
    summary: {
      total: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** @param {{summary:Object, results:Array<Object>}} result */
function printSummary(result) {
  console.log("\n=== Phase1→Phase2 レポート生成結果 ===");
  console.log(`total: ${result.summary.total}`);
  console.log(`succeeded: ${result.summary.succeeded}`);
  console.log(`failed: ${result.summary.failed}`);

  const succeeded = result.results.filter((r) => r.ok);
  if (succeeded.length > 0) {
    console.log("\n--- 成功 ---");
    succeeded.forEach((r) => console.log(`lead_id: ${r.leadId} → company_slug: ${r.slug}`));
  }

  const failed = result.results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log("\n--- 失敗 ---");
    failed.forEach((r) => console.log(`lead_id: ${r.leadId} - ${r.error}`));
  }
}

async function main() {
  const result = await processAllValidatedLeads();
  printSummary(result);
  if (result.summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  runCli(main);
}

module.exports = { processValidatedLead, processAllValidatedLeads };
