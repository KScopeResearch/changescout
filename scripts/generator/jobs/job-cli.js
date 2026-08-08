#!/usr/bin/env node
/**
 * job-cli.js
 *
 * Task16 要件⑧: enqueue/run/retry/cancel/status/historyのCLI。
 *
 * 【アーキテクチャ上の判断】ジョブキューはメモリのみで永続化しない（要件どおり）。
 * `node job-cli.js enqueue ...` のようにCLIを都度別プロセスとして起動する使い方と、
 * 「キューに積む→後で状態を確認する」という複数コマンドにまたがるワークフロー、
 * さらにDashboard（Task16要件⑦）からのリアルタイム表示を両立させるには、キューの
 * 実体をどこかの**常駐プロセス**が持つ必要がある。本プロジェクトでは
 * website/aor-admin/server.js（Task14/15で既に常駐プロセスとして存在する）がジョブ
 * ランタイム（job-runner.js）を内部で保持しているため、job-cli.jsはそのサーバーの
 * Jobs API（/api/jobs/*）を呼び出すHTTPクライアントとして実装している
 * （scripts/generator/review/review-cli.jsがファイルシステムを介して状態を共有するのと
 * 対照的に、jobsはメモリのみのため「常駐プロセスのAPIを介して共有する」設計とした。
 * 詳細はjobs/README.md「アーキテクチャ上の判断」参照）。
 *
 * 使い方（事前に website/aor-admin/server.js を起動しておくこと）:
 *   node job-cli.js enqueue generate-report --url=https://company.jp
 *   node job-cli.js enqueue quality-check --slug=company.jp
 *   node job-cli.js enqueue review-sync --slug=company.jp
 *   node job-cli.js enqueue search-refresh --url=https://company.jp
 *   node job-cli.js run                      … キューを処理させる（enqueue時に自動実行されるため、
 *                                                通常は明示的に呼ぶ必要はない。処理中のジョブがあれば
 *                                                完了まで待つ確認用コマンド）
 *   node job-cli.js retry <job-id>
 *   node job-cli.js cancel <job-id>
 *   node job-cli.js status [<job-id>]         … job-id省略時はキュー全体のサマリー
 *   node job-cli.js history [--limit=N]
 *
 * 環境変数（website/aor-admin/server.jsと同じ認証情報を使う）:
 *   ADMIN_HOST（既定 localhost）, ADMIN_PORT（既定 4600）, ADMIN_USER, ADMIN_PASSWORD
 */

const http = require("http");

const { runCli } = require("../shared/cli-utils"); // Task23: 他CLIとのエラーハンドリング方針統一

const HOST = process.env.ADMIN_HOST || "localhost";
const PORT = process.env.ADMIN_PORT || 4600;
const USER = process.env.ADMIN_USER;
const PASSWORD = process.env.ADMIN_PASSWORD;

// 【重要】1回のCLI実行内では同一セッションを使い回す必要がある。Basic認証はリクエストの
// たびに新規セッション（＝新規CSRFトークン）を発行するため、Cookieを保持せずに
// 「GET /api/session でトークン取得 → POST」を行うと、取得したトークンと実際に
// POST時に検証されるセッションのトークンが一致せず、CSRF検証に失敗する。
// そのため、最初のレスポンスのSet-CookieをCLIプロセス内で保持し、以降のリクエストに使う。
let sessionCookie = null;

/**
 * @param {string} method
 * @param {string} path
 * @param {Object} [body]
 * @param {string} [csrfToken]
 * @returns {Promise<{status:number, data:Object}>}
 */
function request(method, path, body, csrfToken) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (sessionCookie) {
      headers.Cookie = sessionCookie;
    } else if (USER && PASSWORD) {
      headers.Authorization = "Basic " + Buffer.from(`${USER}:${PASSWORD}`).toString("base64");
    }
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

    const req = http.request({ host: HOST, port: PORT, path, method, headers }, (res) => {
      const setCookie = res.headers["set-cookie"];
      if (setCookie && setCookie.length) {
        // "sid=...; HttpOnly; ..." からCookie送信用の "sid=..." 部分だけを取り出す
        sessionCookie = setCookie[0].split(";")[0];
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = {};
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch (e) {
          // JSONでないレスポンス（想定外）はそのまま文字列で返す
          parsed = { raw: data };
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on("error", (err) =>
      reject(new Error(`${HOST}:${PORT} への接続に失敗しました（website/aor-admin/server.jsは起動していますか？）: ${err.message}`))
    );
    if (payload) req.write(payload);
    req.end();
  });
}

/** POST時はCSRFトークンが必要なため、まず/api/sessionから取得する（同一セッションを使う）。 */
async function getCsrfToken() {
  const { status, data } = await request("GET", "/api/session");
  if (status !== 200) throw new Error(`認証に失敗しました（HTTP ${status}）: ${JSON.stringify(data)}`);
  return data.csrf_token;
}

async function postWithCsrf(path, body) {
  const csrfToken = await getCsrfToken();
  return request("POST", path, body || {}, csrfToken);
}

/** @param {string[]} argv @returns {Object} */
function parseFlags(argv) {
  const flags = {};
  argv.forEach((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/s);
    if (m) flags[m[1]] = m[2];
  });
  return flags;
}

function printJob(job) {
  console.log(`id: ${job.id}`);
  console.log(`type: ${job.type}`);
  console.log(`status: ${job.status}`);
  console.log(`attempts: ${job.attempts}/${job.maxAttempts}`);
  if (job.error) console.log(`error: ${job.error}`);
  if (job.result) console.log(`result: ${JSON.stringify(job.result)}`);
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!USER || !PASSWORD) {
    console.error("ADMIN_USER・ADMIN_PASSWORD環境変数を設定してください（website/aor-admin/server.jsと同じ値）。");
    process.exitCode = 2;
    return;
  }

  if (!command) {
    console.error("使い方: node job-cli.js <enqueue|run|retry|cancel|status|history> ...");
    process.exitCode = 2;
    return;
  }

  switch (command) {
    case "enqueue": {
      const [type] = rest;
      const flags = parseFlags(rest);
      if (!type) {
        console.error("使い方: node job-cli.js enqueue <type> [--url=...] [--slug=...]");
        process.exitCode = 2;
        return;
      }
      const params = {};
      if (flags.url) params.url = flags.url;
      if (flags.slug) params.slug = flags.slug;

      const { status, data } = await postWithCsrf("/api/jobs/enqueue", { type, params });
      if (status !== 200) {
        console.error(`enqueue失敗: ${JSON.stringify(data)}`);
        process.exitCode = 1;
        return;
      }
      console.log(`ジョブを追加しました（サーバー側で自動的に実行が始まります）:`);
      printJob(data);
      break;
    }

    case "run": {
      // enqueue時にサーバー側が自動でキュー処理を開始するため、runは
      // 現在のキュー状況を確認するための補助コマンドとして実装する。
      const { status, data } = await request("GET", "/api/jobs");
      if (status !== 200) {
        console.error(`確認失敗: ${JSON.stringify(data)}`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `queued: ${data.snapshot.queued.length} / running: ${data.snapshot.running.length} / ` +
          `completed: ${data.snapshot.completed.length} / failed: ${data.snapshot.failed.length} / ` +
          `cancelled: ${data.snapshot.cancelled.length}`
      );
      console.log("（ジョブはenqueue時にサーバー側で自動実行されます。runは状況確認のみです）");
      break;
    }

    case "retry": {
      const [id] = rest;
      if (!id) {
        console.error("使い方: node job-cli.js retry <job-id>");
        process.exitCode = 2;
        return;
      }
      const { status, data } = await postWithCsrf(`/api/jobs/${encodeURIComponent(id)}/retry`, {});
      if (status !== 200) {
        console.error(`retry失敗: ${JSON.stringify(data)}`);
        process.exitCode = 1;
        return;
      }
      printJob(data);
      break;
    }

    case "cancel": {
      const [id] = rest;
      if (!id) {
        console.error("使い方: node job-cli.js cancel <job-id>");
        process.exitCode = 2;
        return;
      }
      const { status, data } = await postWithCsrf(`/api/jobs/${encodeURIComponent(id)}/cancel`, {});
      if (status !== 200) {
        console.error(`cancel失敗: ${JSON.stringify(data)}`);
        process.exitCode = 1;
        return;
      }
      printJob(data);
      break;
    }

    case "status": {
      const [id] = rest;
      if (id) {
        const { status, data } = await request("GET", `/api/jobs/${encodeURIComponent(id)}`);
        if (status !== 200) {
          console.error(`status失敗: ${JSON.stringify(data)}`);
          process.exitCode = 1;
          return;
        }
        printJob(data);
      } else {
        const { status, data } = await request("GET", "/api/jobs");
        if (status !== 200) {
          console.error(`status失敗: ${JSON.stringify(data)}`);
          process.exitCode = 1;
          return;
        }
        Object.entries(data.snapshot).forEach(([key, jobs]) => {
          console.log(`${key}: ${jobs.length}件`);
          jobs.forEach((j) => console.log(`  - ${j.id} (${j.type}) attempts=${j.attempts}/${j.maxAttempts}`));
        });
      }
      break;
    }

    case "history": {
      const flags = parseFlags(rest);
      const limit = flags.limit || "50";
      const { status, data } = await request("GET", `/api/jobs/history?limit=${encodeURIComponent(limit)}`);
      if (status !== 200) {
        console.error(`history失敗: ${JSON.stringify(data)}`);
        process.exitCode = 1;
        return;
      }
      console.log(`history: ${data.length}件`);
      data.forEach((h) => {
        console.log(
          `  [${h.created_at}] ${h.job_id} (${h.type}) → ${h.status}（${h.attempts}回試行, ${h.duration_ms}ms）` +
            (h.error ? ` エラー: ${h.error}` : "")
        );
      });
      break;
    }

    default:
      console.error(`未知のコマンド: ${command}`);
      console.error("使い方: enqueue|run|retry|cancel|status|history");
      process.exitCode = 2;
  }
}

// Task23: 独自の`main().catch(...)`（メッセージ書式が他CLIの「致命的エラー:」と異なっていた）を
// shared/cli-utils.jsのrunCli()に統一した。
runCli(main);
