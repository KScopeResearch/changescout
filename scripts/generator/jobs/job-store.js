/**
 * job-store.js
 *
 * Task16: ジョブのインメモリレジストリ。DBは使わない（要件どおり）。
 * このモジュールは「状態を保持し、CRUDする」ことだけに責務を絞る。ジョブの実行方法
 * （job-engine.js）・実行順序やリトライ（job-runner.js）はここに書かない。
 *
 * 【重要】プロセスを再起動するとジョブは全て失われる（メモリのみ）。これは要件
 * 「メモリキューで十分です」に従った意図的な設計であり、Task16のジョブ実行基盤は
 * website/aor-admin/server.js（常駐プロセス）内で動かす想定（詳細はjobs/README.md参照）。
 */

/** @type {Map<string, Object>} */
const jobs = new Map();
let counter = 0;

const STATUSES = ["queued", "running", "completed", "failed", "cancelled"];

/**
 * 新規ジョブを作成しレジストリへ登録する。
 * @param {string} type - "generate-report"|"quality-check"|"review-sync"|"search-refresh"
 * @param {Object} params
 * @param {{maxAttempts?:number}} [options]
 * @returns {Object} 作成したジョブ
 */
function createJob(type, params, options = {}) {
  counter += 1;
  const id = `job-${counter}`;
  const now = new Date().toISOString();
  const job = {
    id,
    type,
    params: params || {},
    status: "queued",
    attempts: 0,
    maxAttempts: options.maxAttempts || 4, // 初回1回 + リトライ最大3回（既定）
    cancelRequested: false,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    events: [{ at: now, status: "queued", detail: null }],
  };
  jobs.set(id, job);
  return job;
}

/**
 * ジョブの一部フィールドを更新する（オブジェクトを直接書き換える。job-storeの外へは
 * 参照を渡さず、必ずgetJob()/listJobs()経由で読むこと）。statusが変わった場合はevents
 * にも1件追記する。
 * @param {string} id
 * @param {Object} patch
 * @returns {Object|null} 更新後のジョブ（存在しなければnull）
 */
function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  const statusChanged = patch.status && patch.status !== job.status;
  Object.assign(job, patch);
  if (statusChanged) {
    job.events.push({ at: new Date().toISOString(), status: job.status, detail: patch.error || null });
  }
  return job;
}

/** @param {string} id @returns {Object|null} */
function getJob(id) {
  return jobs.get(id) || null;
}

/** @returns {Object[]} 作成日時の新しい順 */
function listJobs() {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** @returns {Object|null} 最も古い"queued"のジョブ（FIFO） */
function nextQueued() {
  let oldest = null;
  jobs.forEach((job) => {
    if (job.status === "queued" && (!oldest || job.createdAt < oldest.createdAt)) oldest = job;
  });
  return oldest;
}

/**
 * ダッシュボード・CLI向けのステータス別スナップショットを返す。
 * @returns {{queued:Object[], running:Object[], completed:Object[], failed:Object[], cancelled:Object[]}}
 */
function snapshot() {
  const all = listJobs();
  const grouped = { queued: [], running: [], completed: [], failed: [], cancelled: [] };
  all.forEach((job) => {
    if (grouped[job.status]) grouped[job.status].push(job);
  });
  return grouped;
}

module.exports = { STATUSES, createJob, updateJob, getJob, listJobs, nextQueued, snapshot };
