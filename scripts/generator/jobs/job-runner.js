/**
 * job-runner.js
 *
 * Task16: ジョブキューの処理・リトライ（指数バックオフ）・スケジューラ・履歴記録を担う
 * オーケストレーション層。状態そのものはjob-store.jsに、実行方法はjob-engine.jsに
 * 委譲し、ここでは「いつ・何回・どの順で実行するか」だけを扱う。
 *
 * 【重要】このモジュールはNode標準機能のみで書かれており、cron等のライブラリは使わない。
 * 一定間隔実行は setInterval() で実装する（要件どおり）。
 *
 * 【アーキテクチャ上の判断】ジョブキューはメモリのみで永続化しない（要件「メモリキューで
 * 十分です」）。そのため、キューを複数のCLI呼び出しにまたがって使う・ダッシュボードで
 * リアルタイム表示する・スケジューラを動かし続ける、という要件を同時に満たすには、
 * 本モジュールを**常駐プロセス内**でシングルトンとして使う必要がある。本プロジェクトでは
 * website/aor-admin/server.js（Task14/15で既に常駐プロセスとして存在する）がこの役割を担う
 * （詳細はjobs/README.md「アーキテクチャ上の判断」参照）。
 */

const fs = require("fs");
const path = require("path");

const store = require("./job-store");
const engine = require("./job-engine");
const { appendJsonLine, readJsonLines, readJsonSafe, writeJson } = require("../shared/json-file"); // Task18: JSON読み書きの共通化
const { LOGS_DIR, OUTPUT_DIR: SHARED_OUTPUT_DIR } = require("../shared/paths"); // Task18: パス計算の共通化
const { nowIso } = require("../shared/date-utils");
const { createLogger } = require("../shared/logger");
const { redactSecrets } = require("../shared/redact"); // Task23: 永続ログへの秘密情報混入対策
const { pruneOlderThan } = require("../shared/log-rotation"); // Task43

const logger = createLogger("job-runner");
const HISTORY_PATH = path.join(LOGS_DIR, "job-history.jsonl");
// Task43: job-history.jsonlはJobs Dashboard（readHistory()）が直接読む運用ログのため、
// admin-audit.jsonl等とは異なり期間ベースで古い行を整理する（世代ファイルは作らない。
// Task42のハイブリッド方式で決定した方針）。
const JOB_HISTORY_RETENTION_DAYS = 90;
// Task23: 起動時復旧用。「現在実行中のジョブ」だけを保持する小さな状態ファイル
// （job-history.jsonlとは別物。履歴を汚さず、かつjobオブジェクトの構造は変更しないための設計）。
const RUNTIME_STATE_PATH = path.join(LOGS_DIR, "job-runtime-state.json");

// 指数バックオフ: 1秒→2秒→4秒（要件どおり）。既定の最大試行回数は初回+リトライ3回=4回。
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

let processingLoop = false;
const changeListeners = new Set();
let schedulerTimer = null;

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ジョブ状態の変化を購読する（SSE配信用）。
 * @param {(snapshot:Object)=>void} callback
 * @returns {() => void} 購読解除関数
 */
function onChange(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

function notifyChange() {
  const snap = store.snapshot();
  changeListeners.forEach((cb) => {
    try {
      cb(snap);
    } catch (e) {
      // リスナー側のエラーでジョブ処理自体は止めない
    }
  });
}

/**
 * scripts/generator/logs/job-history.jsonl へ1件追記する。
 *
 * 【Task23】`error`はredactSecrets()を通してから書き込む。現状はmock providerのみの
 * 運用のため実際に秘密情報が混入した例はないが、将来実LLM/検索providerのエラー
 * メッセージ（外部APIのレスポンス本文をそのまま含みうる。llm/openai-provider.js等参照）が
 * ここに記録される経路があるため、永続ファイルへ書き込む前の構造的な保険として適用する。
 * ジョブの`error`フィールド自体（メモリ内・API応答）はredactしない
 * （認証済み管理者向けのデバッグ情報として、絶対パス等はそのまま見せた方が有用なため）。
 * @param {Object} entry
 */
function writeHistory(entry) {
  const record = {
    job_id: entry.job_id,
    type: entry.type,
    params: entry.params,
    status: entry.status,
    started_at: entry.started_at,
    finished_at: entry.finished_at,
    duration_ms: entry.duration_ms,
    attempts: entry.attempts,
    error: entry.error ? redactSecrets(entry.error) : null,
    created_at: nowIso(),
  };
  try {
    appendJsonLine(HISTORY_PATH, record);
    pruneOlderThan(HISTORY_PATH, JOB_HISTORY_RETENTION_DAYS, "created_at"); // Task43
  } catch (e) {
    logger.error(`job-history.jsonlの書き込みに失敗しました: ${e.message}`);
  }
}

/**
 * 直近N件の履歴を読む（CLIの`history`コマンド・Dashboard用）。
 * @param {number} [limit]
 * @returns {Object[]}
 */
function readHistory(limit = 50) {
  return readJsonLines(HISTORY_PATH).slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// 起動時復旧（Task23）
// ---------------------------------------------------------------------------
//
// ジョブキューはメモリのみで永続化しない設計（jobs/README.md「アーキテクチャ上の判断」参照）
// のため、website/aor-admin/server.jsが再起動すると、実行中だったジョブの情報はプロセスの
// メモリから跡形もなく失われる。job-store.jsのjob構造自体は変更せず、「今どのジョブが
// 実行中か」だけを別の小さなJSONファイル（RUNTIME_STATE_PATH）に記録しておき、
// 次回起動時にそのファイルが残っていれば「前回は正常終了しなかった」と判断して、
// job-history.jsonlへ`status: "interrupted"`の記録を残す。

/**
 * @returns {Object<string,{type:string, params:Object, started_at:string}>}
 */
function readRuntimeState() {
  return readJsonSafe(RUNTIME_STATE_PATH) || {};
}

/** @param {Object} state */
function writeRuntimeState(state) {
  try {
    writeJson(RUNTIME_STATE_PATH, state);
  } catch (e) {
    logger.error(`job-runtime-state.jsonの書き込みに失敗しました: ${e.message}`);
  }
}

/**
 * ジョブが実行を開始したことを記録する（runOne()から呼ぶ）。
 * @param {string} id
 * @param {{type:string, params:Object}} job
 * @param {string} startedAt
 */
function markRunning(id, job, startedAt) {
  const state = readRuntimeState();
  state[id] = { type: job.type, params: job.params, started_at: startedAt };
  writeRuntimeState(state);
}

/**
 * ジョブが終了した（成功・失敗・キャンセルいずれか）ことを記録し、実行中マークを消す。
 * @param {string} id
 */
function clearRunning(id) {
  const state = readRuntimeState();
  if (!(id in state)) return;
  delete state[id];
  writeRuntimeState(state);
}

/**
 * 起動時に1回呼ぶ。前回プロセスが実行中のまま終了した（＝異常終了・再起動）ジョブが
 * あれば、job-history.jsonlへ`status: "interrupted"`のレコードを残し、実行中マークを消す。
 * job-store.js側にはそのジョブの実体（メモリ上のジョブオブジェクト）は存在しない
 * （queued/failed等への復帰は行わない。要件どおりjob構造・キューの状態遷移は変更しない）。
 * @returns {number} 復旧処理を行った件数
 */
function recoverInterruptedJobs() {
  const state = readRuntimeState();
  const ids = Object.keys(state);
  if (!ids.length) return 0;

  ids.forEach((id) => {
    const entry = state[id];
    logger.warn(`前回終了時に実行中だったジョブを検出しました（interrupted扱いにします）: ${id} (${entry.type})`);
    writeHistory({
      job_id: id,
      type: entry.type,
      params: entry.params,
      status: "interrupted",
      started_at: entry.started_at,
      finished_at: nowIso(),
      duration_ms: null,
      attempts: null,
      error: "サーバー再起動または異常終了により、実行中だった処理が中断されました",
    });
  });

  writeRuntimeState({});
  return ids.length;
}

/**
 * ジョブをキューへ追加する。
 * @param {string} type
 * @param {Object} params
 * @param {{maxAttempts?:number}} [options]
 * @returns {Object} 作成したジョブ
 */
function enqueue(type, params, options = {}) {
  if (!engine.JOB_TYPES.includes(type)) {
    throw new Error(`未知のjob type: "${type}"。利用可能: ${engine.JOB_TYPES.join(", ")}`);
  }
  const job = store.createJob(type, params, options);
  notifyChange();
  processQueue(); // fire-and-forget。既に処理ループが走っていれば何もしない
  return job;
}

/**
 * キューを空になるまで処理する（1件ずつ、直列実行）。
 * 【設計】同一の出力ディレクトリへ複数ジョブが同時書き込みする競合を避けるため、
 * Phase1では並列実行はせず、常に1件ずつ処理する（シンプルさを優先）。
 */
async function processQueue() {
  if (processingLoop) return;
  processingLoop = true;
  try {
    let next;
    // eslint-disable-next-line no-cond-assign
    while ((next = store.nextQueued())) {
      await runOne(next.id);
    }
  } finally {
    processingLoop = false;
  }
}

/**
 * 1件のジョブを実行する。失敗時は指数バックオフでリトライし、maxAttempts回失敗したら
 * "failed"にする。試行の合間に cancelRequested を確認し、キャンセルされていれば
 * それ以上リトライせず"cancelled"にする（協調的キャンセル。実行中の処理を強制中断は
 * しない。詳細はjobs/README.md「キャンセルの仕様」参照）。
 * @param {string} id
 */
async function runOne(id) {
  const job = store.getJob(id);
  if (!job || job.status === "cancelled") return;

  const startedAt = nowIso();
  store.updateJob(id, { status: "running", startedAt });
  markRunning(id, job, startedAt); // Task23: 起動時復旧のため実行中マークを付ける
  notifyChange();
  const t0 = Date.now();

  let lastError = null;

  for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
    const current = store.getJob(id);
    if (current.cancelRequested) {
      const finishedAt = nowIso();
      store.updateJob(id, { status: "cancelled", finishedAt, attempts: attempt - 1 });
      clearRunning(id); // Task23
      writeHistory({
        job_id: id,
        type: job.type,
        params: job.params,
        status: "cancelled",
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Date.now() - t0,
        attempts: attempt - 1,
        error: null,
      });
      notifyChange();
      return;
    }

    store.updateJob(id, { attempts: attempt });
    notifyChange();

    try {
      const result = await engine.execute(job.type, job.params);
      const finishedAt = nowIso();
      store.updateJob(id, { status: "completed", result, finishedAt, error: null });
      clearRunning(id); // Task23
      writeHistory({
        job_id: id,
        type: job.type,
        params: job.params,
        status: "completed",
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Date.now() - t0,
        attempts: attempt,
        error: null,
      });
      notifyChange();
      return;
    } catch (err) {
      lastError = err;
      store.updateJob(id, { error: err.message });
      notifyChange();

      if (attempt < job.maxAttempts) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        await sleep(delay);
      }
    }
  }

  const finishedAt = nowIso();
  store.updateJob(id, { status: "failed", finishedAt });
  clearRunning(id); // Task23
  writeHistory({
    job_id: id,
    type: job.type,
    params: job.params,
    status: "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Date.now() - t0,
    attempts: job.maxAttempts,
    error: lastError ? lastError.message : "unknown error",
  });
  notifyChange();
}

/**
 * 失敗したジョブを再度キューへ戻す（手動リトライ、Task16要件⑧）。
 * @param {string} id
 * @returns {Object} 更新後のジョブ
 */
function retry(id) {
  const job = store.getJob(id);
  if (!job) throw new Error(`job not found: ${id}`);
  if (job.status !== "failed") throw new Error(`failedのジョブのみretryできます（現在: ${job.status}）`);

  store.updateJob(id, { status: "queued", attempts: 0, error: null, finishedAt: null, cancelRequested: false });
  notifyChange();
  processQueue();
  return store.getJob(id);
}

/**
 * ジョブをキャンセルする。queued中なら即座にcancelled、running中なら次のリトライの
 * 合間で協調的にcancelledへ移行する（「キャンセルの仕様」参照）。
 * @param {string} id
 * @returns {Object} 更新後のジョブ
 */
function cancel(id) {
  const job = store.getJob(id);
  if (!job) throw new Error(`job not found: ${id}`);

  if (job.status === "queued") {
    const finishedAt = nowIso();
    store.updateJob(id, { status: "cancelled", finishedAt });
    writeHistory({
      job_id: id,
      type: job.type,
      params: job.params,
      status: "cancelled",
      started_at: job.startedAt,
      finished_at: finishedAt,
      duration_ms: 0,
      attempts: job.attempts,
      error: null,
    });
    notifyChange();
  } else if (job.status === "running") {
    store.updateJob(id, { cancelRequested: true });
    notifyChange();
  } else {
    throw new Error(`既に${job.status}のジョブはcancelできません`);
  }
  return store.getJob(id);
}

// ---------------------------------------------------------------------------
// スケジューラ（Task16要件④: setInterval()のみ使用、cronライブラリ禁止）
// ---------------------------------------------------------------------------

const OUTPUT_DIR = SHARED_OUTPUT_DIR; // Task18: shared/paths.jsへ一本化

/**
 * scripts/generator/output/配下の既存company_context.jsonから、定期再生成の対象となる
 * 会社URL一覧を集める。新しい登録リストの仕組みは作らず、既存データを再利用する。
 * @returns {string[]}
 */
function getScheduledCompanyUrls() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const slugs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const urls = [];
  slugs.forEach((slug) => {
    const contextPath = path.join(OUTPUT_DIR, slug, "company_context.json");
    if (!fs.existsSync(contextPath)) return;
    const context = readJsonSafe(contextPath); // 壊れたcompany_context.jsonはnullでスキップされる
    if (context && context.input_url) urls.push(context.input_url);
  });
  return urls;
}

/**
 * 一定間隔で、既知の全会社に対して"generate-report"ジョブを自動投入するスケジューラを開始する。
 * 「AI Opportunity Reportを毎日自動生成できる状態にする」という目的に対応する
 * （既定間隔は呼び出し側が指定。本番では24時間、テストでは短い間隔を指定する想定）。
 * @param {number} intervalMs
 * @returns {() => void} 停止関数
 */
function startScheduler(intervalMs) {
  if (schedulerTimer) stopScheduler();
  schedulerTimer = setInterval(() => {
    const urls = getScheduledCompanyUrls();
    urls.forEach((url) => enqueue("generate-report", { url }));
  }, intervalMs);
  return stopScheduler;
}

function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function isSchedulerRunning() {
  return schedulerTimer !== null;
}

module.exports = {
  enqueue,
  retry,
  cancel,
  processQueue,
  onChange,
  readHistory,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  getScheduledCompanyUrls,
  recoverInterruptedJobs, // Task23
  HISTORY_PATH,
  RUNTIME_STATE_PATH, // Task23
  DEFAULT_MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
};
