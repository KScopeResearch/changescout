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
 *
 *   node scripts/generator/leads/process-validated.js --lead-id <LEAD_ID>
 *   （指定した1件のvalidated Leadだけを処理する。Controlled E2E等、対象を隔離して
 *   進めたいケース向け。内部処理はbatchと共通のprocessValidatedLead()を呼ぶだけで、
 *   ロジックは分岐しない。--lead-idモードでは他のvalidated Leadを一切読み込まない
 *   （listLeads()による全件走査を行わず、readLead(leadId)で対象1件のみを取得する）。）
 */

const fs = require("fs");
const path = require("path");

const { generateCompanyReport } = require("../generate-company-report");
const { runCli } = require("../shared/cli-utils");
const { readJson, writeJson } = require("../shared/json-file");
const { validateSlug, isWithinDir } = require("../shared/path-safety");
const { readLead, updateLead, appendHistory, listLeads, applyPatch, withHistoryEvent } = require("./lead-store");

// options.leadsDir未指定時の既定ストア（従来どおりlead-store経由、LEAD_STORE_BACKENDに従う）。
const DEFAULT_STORE = { readLead, updateLead, appendHistory, listLeads };

/**
 * options.leadsDirで指定した1ディレクトリだけを読み書きするLeadストアを返す
 * （Phase89 P6c: テスト隔離用。lead-store.jsのI/O関数は保存先がshared/paths.jsの
 * LEADS_DIR固定のため、ここで同じインタフェースを組み立てる。状態の組み立ては
 * lead-store.jsのPure Function（applyPatch/withHistoryEvent）をそのまま使い、
 * ファイル形式・パス検証はfilesystem-backend.jsと同じjson-file/path-safetyに揃える）。
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

/**
 * 1件のvalidated Leadを処理する。
 * @param {string} leadId
 * @param {{generateReport?: (companyUrl:string) => Promise<Object>, leadsDir?: string}} [options] -
 *   generateReportはテスト時に差し替えるためのフック（省略時は実際の
 *   generateCompanyReport()を使う。実HTTP取得を伴うため、テストでは
 *   ネットワーク非依存のダミー関数に差し替える）。
 *   leadsDirを指定するとそのディレクトリのLeadだけを読み書きする（テスト隔離用、
 *   Phase89 P6c。省略時は従来どおりlead-store経由）。
 * @returns {Promise<{ok:boolean, leadId:string, slug?:string, error?:string}>}
 */
async function processValidatedLead(leadId, options = {}) {
  const generateReport = options.generateReport || generateCompanyReport;
  const store = resolveStore(options);

  if (typeof leadId !== "string" || !leadId) {
    return { ok: false, leadId, error: "leadId（文字列）が必須です" };
  }

  const lead = await store.readLead(leadId);
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
  await store.updateLead(leadId, { company_slug: result.slug, status: "report_generated" });
  await store.appendHistory(leadId, "report_generated", { slug: result.slug });

  return { ok: true, leadId, slug: result.slug };
}

/**
 * status:"validated"の全Leadを1件ずつ処理する。
 * @param {{generateReport?: Function, leadsDir?: string}} [options] -
 *   leadsDirを指定するとそのディレクトリだけを走査・更新する（テスト隔離用、Phase89 P6c:
 *   共有のlogs/leads/を全件走査すると並行実行中の他テストのLeadへ書き込んでしまうため）。
 *   省略時は従来どおりlead-storeのlistLeads()で全件を走査する。
 * @returns {Promise<{summary:{total:number, succeeded:number, failed:number}, results:Array<Object>}>}
 */
async function processAllValidatedLeads(options = {}) {
  const candidates = (await resolveStore(options).listLeads()).filter((lead) => lead.status === "validated");
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

/**
 * CLI引数から --lead-id の値を取り出す（`--lead-id X` と `--lead-id=X` の両形式に対応）。
 * @param {string[]} argv - process.argv.slice(2) 相当
 * @returns {string|null}
 */
function parseLeadIdArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const eq = argv[i].match(/^--lead-id=(.+)$/s);
    if (eq) return eq[1];
    if (argv[i] === "--lead-id") return argv[i + 1] || null;
  }
  return null;
}

async function main() {
  const leadId = parseLeadIdArg(process.argv.slice(2));

  if (leadId !== null) {
    // 単一Leadモード: 対象1件だけを処理する。listLeads()（全件走査）は使わない。
    const single = await processValidatedLead(leadId);
    const result = {
      summary: { total: 1, succeeded: single.ok ? 1 : 0, failed: single.ok ? 0 : 1 },
      results: [single],
    };
    printSummary(result);
    if (!single.ok) process.exitCode = 1;
    return;
  }

  const result = await processAllValidatedLeads();
  printSummary(result);
  if (result.summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  runCli(main);
}

module.exports = { processValidatedLead, processAllValidatedLeads, parseLeadIdArg };
