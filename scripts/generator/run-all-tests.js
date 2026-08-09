#!/usr/bin/env node
/**
 * run-all-tests.js
 *
 * Task18 要件5・6: このスクリプト1つで
 *   Validator / Review / Jobs / Generator / Search / LLM(Mock) / Dashboard確認
 * まで実行し、quality-report.md を自動生成する。Node.js標準モジュールのみを使用する
 * （node:test・node:http・node:child_process。npm依存なし）。
 *
 * 使い方:
 *   node scripts/generator/run-all-tests.js
 *
 * 終了コード: 全テストPASS かつ Dashboard確認OK の場合のみ 0。ただしTask19で、
 * ネットワーク依存テスト（test/generator.test.js の実HTTPテスト）のみは失敗しても
 * 非ブロッキング（警告扱い）とする（「generator.test.jsのネットワーク問題対応」参照。
 * CI環境でのDNS障害・一時的な外部サイト停止・egress制限等でCI全体が赤くなることを防ぐため）。
 * README「新しい機能追加前にはrun-all-tests.jsを実行する」という開発ルールに対応する。
 */

const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const { GENERATOR_DIR } = require("./shared/paths");
const { createLogger } = require("./shared/logger");
const { NETWORK_TEST_NAME } = require("./test/network-test-names");
const { checkAll: checkAllConfig } = require("./shared/config-validator"); // Task22
const { runCli } = require("./shared/cli-utils"); // Task23

const logger = createLogger("run-all-tests");

const TEST_GLOB = path.join(GENERATOR_DIR, "test", "*.test.js");
const REPORT_PATH = path.join(GENERATOR_DIR, "quality-report.md");
const SOURCE_ROOT = GENERATOR_DIR;

/**
 * 失敗しても全体の終了コードをFAILにしない「非ブロッキング」テストの一覧（Task19）。
 * 【方式C】現状の実HTTPテストは維持しつつ、失敗時のみ警告扱いにする
 * （scripts/generator/README.md「generator.test.jsのネットワーク問題対応（Task19）」参照）。
 * 対象は generator.test.js の NETWORK_TEST_NAME 1件のみ（他のテストはネットワーク非依存であり
 * 通常どおりブロッキング）。
 */
const NETWORK_DEPENDENT_TEST_NAMES = [NETWORK_TEST_NAME];

// ---------------------------------------------------------------------------
// [1] Validator / Review / Jobs / Generator / Search / LLM(Mock) を node --test で実行
// ---------------------------------------------------------------------------

/**
 * @returns {{stdout:string, stderr:string, durationMs:number, exitCode:number|null}}
 */
function runNodeTest() {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", TEST_GLOB], {
    encoding: "utf-8",
    cwd: SOURCE_ROOT,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
  };
}

/**
 * node --test --test-reporter=tap の末尾サマリー行（# tests N 等）をパースする。
 * @param {string} tapOutput
 * @returns {{tests:number, pass:number, fail:number, cancelled:number, skipped:number, todo:number, duration_ms:number}}
 */
function parseTapSummary(tapOutput) {
  const get = (key) => {
    const m = tapOutput.match(new RegExp(`# ${key} (\\d+(?:\\.\\d+)?)`));
    return m ? Number(m[1]) : 0;
  };
  return {
    tests: get("tests"),
    pass: get("pass"),
    fail: get("fail"),
    cancelled: get("cancelled"),
    skipped: get("skipped"),
    todo: get("todo"),
    duration_ms: get("duration_ms"),
  };
}

/**
 * TAPの "not ok" ブロックからテスト名一覧を抽出する（quality-report.mdの注意事項用）。
 * @param {string} tapOutput
 * @returns {string[]}
 */
function extractFailedTestNames(tapOutput) {
  const lines = tapOutput.split("\n");
  return lines
    .filter((line) => /^not ok \d+/.test(line.trim()))
    .map((line) => line.replace(/^not ok \d+\s*-?\s*/, "").trim());
}

// ---------------------------------------------------------------------------
// [2] Dashboard確認（website/aor-admin/server.jsを一時起動してAPI疎通を確認）
// ---------------------------------------------------------------------------

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} host
 * @param {number} port
 * @param {string} pathName
 * @param {{auth?:string}} [options]
 * @returns {Promise<{status:number, body:string}>}
 */
function httpGet(host, port, pathName, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (options.auth) headers.Authorization = `Basic ${Buffer.from(options.auth).toString("base64")}`;
    const req = http.request({ host, port, path: pathName, method: "GET", headers, timeout: 3000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

/**
 * website/aor-admin/server.jsを一時的なポートで起動し、認証の有無で正しく応答するかを確認して停止する。
 * Task14〜16で追加したDashboard/Jobs/Auth/SSEの基盤が最低限起動・応答することを保証する
 * （実ブラウザでのUI確認は別途手動/Claude Browserで実施する。詳細は完了報告参照）。
 * @returns {Promise<{ok:boolean, detail:string}>}
 */
async function checkDashboardSmoke() {
  const port = 4601; // 通常運用の既定ポート(4600)と衝突しないよう別ポートを使う
  const adminUser = "run-all-tests";
  const adminPassword = "run-all-tests-password";
  const serverPath = path.join(GENERATOR_DIR, "..", "..", "website", "aor-admin", "server.js");

  if (!fs.existsSync(serverPath)) {
    return { ok: false, detail: `server.jsが見つかりません: ${serverPath}` };
  }

  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ADMIN_USER: adminUser, ADMIN_PASSWORD: adminPassword, ADMIN_PORT: String(port) },
    stdio: "pipe",
  });

  let serverError = "";
  child.stderr.on("data", (chunk) => (serverError += chunk.toString()));

  try {
    // サーバー起動を待つ（最大5秒、200msごとにポーリング）
    let ready = false;
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      try {
        await httpGet("localhost", port, "/api/session");
        ready = true;
        break;
      } catch (e) {
        // まだ起動していない
      }
    }
    if (!ready) {
      return { ok: false, detail: `サーバーが起動しませんでした: ${serverError || "(詳細なし)"}` };
    }

    const unauth = await httpGet("localhost", port, "/api/reports");
    if (unauth.status !== 401) {
      return { ok: false, detail: `未認証アクセスが401にならなかった（実際: ${unauth.status}）` };
    }

    const authed = await httpGet("localhost", port, "/api/reports", { auth: `${adminUser}:${adminPassword}` });
    if (authed.status !== 200) {
      return { ok: false, detail: `認証済みアクセスが200にならなかった（実際: ${authed.status}）` };
    }

    const jobsResp = await httpGet("localhost", port, "/api/jobs", { auth: `${adminUser}:${adminPassword}` });
    if (jobsResp.status !== 200) {
      return { ok: false, detail: `/api/jobsが200にならなかった（実際: ${jobsResp.status}）` };
    }

    return { ok: true, detail: "未認証401・認証済み200・/api/reports・/api/jobsの応答を確認しました" };
  } catch (err) {
    return { ok: false, detail: `Dashboard確認中にエラー: ${err.message}` };
  } finally {
    child.kill();
  }
}

// ---------------------------------------------------------------------------
// [3] カバレッジ概算（npm系カバレッジツールを使わないための構造的な近似値）
// ---------------------------------------------------------------------------

/**
 * scripts/generator/配下の主要ソースファイルと、それをテストしているtestファイルの
 * 対応表。厳密な行/分岐カバレッジではなく「モジュール単位でテストが存在するか」の
 * 構造的な近似値であることに注意（npm系カバレッジツールは要件で使用できないため）。
 */
const COVERAGE_MAP = [
  { module: "validate-report.js", testFile: "validator.test.js" },
  { module: "quality-evaluator.js", testFile: "quality.test.js" },
  { module: "review/review-engine.js", testFile: "review.test.js" },
  { module: "jobs/job-store.js", testFile: "jobs.test.js" },
  { module: "jobs/job-runner.js", testFile: "jobs.test.js" },
  { module: "jobs/job-engine.js", testFile: "jobs.test.js" },
  { module: "search/search-client.js", testFile: "search.test.js" },
  { module: "search/query-builder.js", testFile: "search.test.js" },
  { module: "deduplicate-sources.js", testFile: "search.test.js" },
  { module: "llm/llm-client.js", testFile: "llm.test.js" },
  { module: "generate-company-report.js", testFile: "generator.test.js" },
  { module: "publish-report.js", testFile: "publish-report.test.js" },
  { module: "shared/json-file.js", testFile: "shared.test.js" },
  { module: "shared/retry.js", testFile: "shared.test.js" },
  { module: "shared/date-utils.js", testFile: "shared.test.js" },
  { module: "shared/logger.js", testFile: "shared.test.js" },
  { module: "shared/paths.js", testFile: "shared.test.js" },
  { module: "shared/cli-utils.js", testFile: "error-handling.test.js" },
  { module: "shared/config-validator.js", testFile: "error-handling.test.js" },
  { module: "shared/redact.js", testFile: "error-handling.test.js, security.test.js" },
  { module: "company-context.js", testFile: "generator.test.js（間接的にbuildCompanyContext経由）" },
  { module: "normalize-sources.js", testFile: null },
  { module: "merge-sources.js", testFile: null },
  { module: "score-sources.js", testFile: null },
  { module: "simulate-ai-analysis.js", testFile: "llm.test.js（mock-provider.js経由で間接的に）" },
  { module: "review/review-cli.js", testFile: null },
  { module: "jobs/job-cli.js", testFile: null },
  { module: "website/aor-admin/server.js", testFile: "security.test.js（未認証401/認証済み200/CSRF拒否）" },
];

function estimateCoverage() {
  const covered = COVERAGE_MAP.filter((m) => m.testFile).length;
  const total = COVERAGE_MAP.length;
  return {
    covered,
    total,
    percentApprox: Math.round((covered / total) * 100),
    map: COVERAGE_MAP,
  };
}

// ---------------------------------------------------------------------------
// [4] quality-report.md 生成
// ---------------------------------------------------------------------------

function renderQualityReportMarkdown({
  tapSummary,
  testDurationMs,
  blockingFailedNames,
  networkFailedNames,
  dashboard,
  coverage,
  notes,
  configCheck,
}) {
  const lines = [];
  lines.push("# quality-report.md — Task18/19/22 自動品質レポート");
  lines.push("");
  lines.push(`生成日時: ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Configuration Check");
  lines.push("");
  lines.push(
    "> ⚠️ **参考情報のみ**。CI環境ではADMIN_USER/ADMIN_PASSWORD・LLM/SEARCH APIキーを設定していない" +
      "ことが正常なため（mock providerのみでテストが完結する設計）、ここでの`[ERROR]`は" +
      "上記「総合結果」のPASS/FAIL判定には一切影響しない（Task22で意図的に非ブロッキングとした）。"
  );
  lines.push("");
  configCheck.results.forEach((r) => lines.push(`- [${r.level.toUpperCase()}] ${r.message}`));
  lines.push("");
  lines.push("## テスト結果サマリー");
  lines.push("");
  lines.push(`- テスト数: ${tapSummary.tests}`);
  lines.push(`- PASS: ${tapSummary.pass}`);
  lines.push(`- FAIL: ${tapSummary.fail}（うちブロッキング: ${blockingFailedNames.length}、非ブロッキング/ネットワーク依存: ${networkFailedNames.length}）`);
  lines.push(`- SKIPPED: ${tapSummary.skipped}`);
  lines.push(`- 実行時間（node --test内部計測）: ${tapSummary.duration_ms.toFixed(1)}ms`);
  lines.push(`- 実行時間（run-all-tests.js全体計測、プロセス起動込み）: ${testDurationMs}ms`);
  lines.push("");

  if (blockingFailedNames.length) {
    lines.push("### 失敗したテスト（ブロッキング、要対応）");
    lines.push("");
    blockingFailedNames.forEach((name) => lines.push(`- ${name}`));
    lines.push("");
  }

  if (networkFailedNames.length) {
    lines.push(
      "### 失敗したテスト（非ブロッキング・ネットワーク依存、Task19「方式C」により全体結果には含めない）"
    );
    lines.push("");
    networkFailedNames.forEach((name) => lines.push(`- ${name}`));
    lines.push("");
  }

  lines.push("## カバレッジ概算");
  lines.push("");
  lines.push(
    `> ⚠️ npm系のカバレッジ計測ツール（istanbul/nyc等）は「npmパッケージ追加禁止」の要件により使用していない。` +
      `以下はモジュール単位で対応するテストファイルが存在するかの**構造的な近似値**であり、行/分岐カバレッジではない。`
  );
  lines.push("");
  lines.push(`- 対応テストが存在するモジュール: ${coverage.covered} / ${coverage.total}（約${coverage.percentApprox}%）`);
  lines.push("");
  lines.push("| モジュール | テストファイル |");
  lines.push("|---|---|");
  coverage.map.forEach((m) => {
    lines.push(`| ${m.module} | ${m.testFile || "（未対応・下記「注意事項」参照）"} |`);
  });
  lines.push("");

  lines.push("## Dashboard確認");
  lines.push("");
  lines.push(`- 結果: ${dashboard.ok ? "OK" : "NG"}`);
  lines.push(`- 詳細: ${dashboard.detail}`);
  lines.push(
    "- 【範囲】ここではAPI疎通（未認証401・認証済み200・/api/reports・/api/jobs）のみを自動確認している。" +
      "実ブラウザでのUI描画・SSE自動更新・console.errorの確認は別途Claude Browser等で目視確認する" +
      "（run-all-tests.jsはNode標準モジュールのみで完結させる要件のため、ブラウザ自動操作は含まない）。"
  );
  lines.push("");

  lines.push("## 注意事項");
  lines.push("");
  notes.forEach((note) => lines.push(`- ${note}`));
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  logger.info("=== run-all-tests.js: Validator/Review/Jobs/Generator/Search/LLM(Mock)/Dashboard を実行します ===");

  console.log("\n[1/2] node --test 実行中（Validator/Review/Jobs/Generator/Search/LLM(Mock)）...");
  const testRun = runNodeTest();
  console.log(testRun.stdout);
  if (testRun.stderr) console.error(testRun.stderr);

  const tapSummary = parseTapSummary(testRun.stdout);
  const failedNames = extractFailedTestNames(testRun.stdout);

  // Task19方式C: ネットワーク依存テストの失敗は非ブロッキング（警告）扱いにする。
  // それ以外の失敗（blockingFailedNames）が1件でもあれば全体をFAILとする。
  const blockingFailedNames = failedNames.filter((name) => !NETWORK_DEPENDENT_TEST_NAMES.includes(name));
  const networkFailedNames = failedNames.filter((name) => NETWORK_DEPENDENT_TEST_NAMES.includes(name));
  if (networkFailedNames.length) {
    logger.warn(
      `ネットワーク依存テストが失敗しましたが、方式C（非ブロッキング）のため全体の結果には影響しません: ${networkFailedNames.join(", ")}`
    );
  }

  console.log("[2/2] Dashboard確認中（website/aor-admin/server.jsを一時起動）...");
  const dashboard = await checkDashboardSmoke();
  console.log(`      Dashboard確認: ${dashboard.ok ? "OK" : "NG"} — ${dashboard.detail}`);

  const coverage = estimateCoverage();

  // Task22: 設定チェック結果はquality-report.mdへ参考情報として記録するのみで、
  // 総合結果（allOk）には一切関与させない（CIではADMIN_USER等を設定しない前提のため）。
  const configCheck = checkAllConfig();

  const notes = [
    "generator.test.jsはhttps://example.com（IANA予約の安全な公開テストドメイン）への実HTTP取得を行うため、" +
      "ネットワーク環境によっては失敗しうる（唯一のネットワークI/Oを伴うテスト）。Task19で「方式C」を採用し、" +
      "このテストのみ失敗しても全体の終了コードをFAILにしない（CI環境のDNS障害・一時的な外部サイト停止・" +
      "egress制限でCI全体が赤くなることを防ぐため）。ただし失敗時は必ずログ・quality-report.mdに記録される。",
    "jobs.test.jsは指数バックオフ（1秒/2秒/4秒）の実時間待ちを含むため、テストスイート全体の実行時間の" +
      "大半（数十秒）を占める。高速化のためにリトライ間隔を短縮する設定は、本番のリトライ仕様と" +
      "テストを乖離させないため、あえて行っていない。",
    "search/tavily-provider.js・search/bing-provider.js・llm/openai-provider.js・deepseek-provider.js・" +
      "qwen-provider.jsは、実APIキーを設定していないため実際の外部API呼び出しを伴うテストは実施していない" +
      "（isConfigured()がfalseになることのみ確認）。",
    "website/aor-admin/public/配下のフロントエンドJS（list.js/detail.js/jobs.js等）は、ブラウザDOM APIに" +
      "依存するためnode:testでは直接テストしていない。動作確認はClaude Browserでの実ブラウザ確認に依っている。",
  ];

  const reportMarkdown = renderQualityReportMarkdown({
    tapSummary,
    testDurationMs: testRun.durationMs,
    blockingFailedNames,
    networkFailedNames,
    dashboard,
    coverage,
    notes,
    configCheck,
  });
  fs.writeFileSync(REPORT_PATH, reportMarkdown, "utf-8");
  console.log(`\nquality-report.md を生成しました: ${REPORT_PATH}`);

  const allOk = blockingFailedNames.length === 0 && tapSummary.tests > 0 && dashboard.ok;
  console.log(`\n=== 総合結果: ${allOk ? "PASS" : "FAIL"} ===`);
  if (networkFailedNames.length) {
    console.log(`    （ネットワーク依存テスト${networkFailedNames.length}件は非ブロッキングのため結果に含めていません）`);
  }
  process.exitCode = allOk ? 0 : 1;
}

// Task23: 独自に組んでいたmain().catch(...)（Dashboard確認でfetch/httpを使うためprocess.exit()を
// 避ける、という同じ理由をコメントで個別に説明していた）を、shared/cli-utils.jsのrunCli()に統一した。
// stack traceの表示はAOR_DEBUG=true時のみ（他CLIと同じ方針。必要ならCI実行時にAOR_DEBUG=trueを
// 設定すること）。
runCli(main);
