/**
 * jobs.test.js — Task18: jobs/job-store.js・job-runner.js・job-engine.jsの自動テスト。
 * engine.executeを一時的に差し替えてリトライ・キャンセル・失敗系を検証する
 * （job-engine.js自体は実際のパイプラインを呼ぶため、実行時間の長い経路は
 * generator.test.jsで別途カバーする）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const runner = require("../jobs/job-runner");
const store = require("../jobs/job-store");
const engine = require("../jobs/job-engine");

function waitForStatus(id, statuses, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const job = store.getJob(id);
      if (job && statuses.includes(job.status)) return resolve(job);
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${statuses}`));
      setTimeout(check, 50);
    };
    check();
  });
}

test("job-store: createJob/getJob/listJobsの基本動作", () => {
  const job = store.createJob("quality-check", { slug: "x" });
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 0);
  assert.equal(store.getJob(job.id).id, job.id);
  assert.ok(store.listJobs().some((j) => j.id === job.id));
});

test("job-store: snapshotがstatus別に正しく分類する", () => {
  const job = store.createJob("quality-check", { slug: "snapshot-test" });
  const snap = store.snapshot();
  assert.ok(snap.queued.some((j) => j.id === job.id));
  store.updateJob(job.id, { status: "completed" });
  const snap2 = store.snapshot();
  assert.ok(snap2.completed.some((j) => j.id === job.id));
  assert.ok(!snap2.queued.some((j) => j.id === job.id));
});

test("runner.enqueue: 未知のtypeは同期的に例外を投げる", () => {
  assert.throws(() => runner.enqueue("no-such-type", {}), /未知のjob type/);
});

test("runner: 実際にquality-checkジョブを実行しcompletedになる（example.comの既存report.jsonを使用）", async () => {
  const job = runner.enqueue("quality-check", { slug: "example.com" });
  const done = await waitForStatus(job.id, ["completed", "failed"]);
  assert.equal(done.status, "completed");
  assert.equal(done.attempts, 1);
  assert.ok(done.result.evaluation.score >= 0);
});

test("runner: 必須パラメータ欠如はmaxAttempts回試行してfailedになる", async () => {
  const job = runner.enqueue("quality-check", {}); // slug欠如
  const done = await waitForStatus(job.id, ["completed", "failed"], 15000);
  assert.equal(done.status, "failed");
  assert.equal(done.attempts, done.maxAttempts);
  assert.match(done.error, /params\.slug/);
});

test("runner: retry-then-succeed（指数バックオフの各試行が反映される）", async () => {
  const original = engine.execute;
  let callCount = 0;
  engine.execute = async (type, params) => {
    if (type !== "test-retry-succeed") return original(type, params);
    callCount++;
    if (callCount < 3) throw new Error(`simulated failure #${callCount}`);
    return { ok: true, callCount };
  };
  engine.JOB_TYPES.push("test-retry-succeed");

  try {
    const job = runner.enqueue("test-retry-succeed", {});
    const done = await waitForStatus(job.id, ["completed", "failed"], 15000);
    assert.equal(done.status, "completed");
    assert.equal(done.attempts, 3);
    assert.equal(done.result.callCount, 3);
  } finally {
    engine.execute = original;
  }
});

test("runner: 全試行失敗でfailedになる", async () => {
  const original = engine.execute;
  engine.execute = async (type, params) => {
    if (type !== "test-always-fail") return original(type, params);
    throw new Error("always fails");
  };
  engine.JOB_TYPES.push("test-always-fail");

  try {
    const job = runner.enqueue("test-always-fail", {});
    const done = await waitForStatus(job.id, ["completed", "failed"], 15000);
    assert.equal(done.status, "failed");
    assert.equal(done.attempts, done.maxAttempts);
    assert.equal(done.error, "always fails");
  } finally {
    engine.execute = original;
  }
});

test("runner.cancel: queued中のジョブは即座にcancelledになる", async () => {
  const original = engine.execute;
  engine.execute = async (type) => {
    if (type !== "test-slow-blocker") return original(type, arguments[1]);
    await new Promise((r) => setTimeout(r, 2000));
    return { ok: true };
  };
  engine.JOB_TYPES.push("test-slow-blocker");

  try {
    const blocker = runner.enqueue("test-slow-blocker", {});
    const target = runner.enqueue("test-slow-blocker", {}); // blockerの後ろでqueuedのまま待つ
    await new Promise((r) => setTimeout(r, 100)); // blockerがrunningになるのを待つ
    const cancelled = runner.cancel(target.id);
    assert.equal(cancelled.status, "cancelled");
    await waitForStatus(blocker.id, ["completed", "failed"], 10000);
    assert.equal(store.getJob(target.id).status, "cancelled");
  } finally {
    engine.execute = original;
  }
});

test("runner.retry: failedなジョブを手動でretryできる", async () => {
  const original = engine.execute;
  let shouldFail = true;
  engine.execute = async (type) => {
    if (type !== "test-manual-retry-2") return original(type, arguments[1]);
    if (shouldFail) throw new Error("fails until manual retry");
    return { ok: true };
  };
  engine.JOB_TYPES.push("test-manual-retry-2");

  try {
    const job = runner.enqueue("test-manual-retry-2", {});
    const failed = await waitForStatus(job.id, ["failed"], 15000);
    assert.equal(failed.status, "failed");

    shouldFail = false;
    runner.retry(job.id);
    const retried = await waitForStatus(job.id, ["completed", "failed"], 10000);
    assert.equal(retried.status, "completed");
    assert.equal(retried.attempts, 1, "手動retry後はattemptsが1からやり直しになる");
  } finally {
    engine.execute = original;
  }
});

test("runner.retry: completed/queuedなジョブはretryできない", () => {
  const job = store.createJob("quality-check", { slug: "x" });
  assert.throws(() => runner.retry(job.id), /failedのジョブのみ/);
});

test("readHistory: 実行結果が記録され、直近のものが先頭に来る", async () => {
  const job = runner.enqueue("quality-check", { slug: "example.com" });
  await waitForStatus(job.id, ["completed", "failed"]);
  const history = runner.readHistory(5);
  assert.ok(history.length > 0);
  assert.equal(history[0].job_id, job.id);
});

test("getScheduledCompanyUrls: output/配下の既存company_context.jsonからinput_urlを収集する", () => {
  const urls = runner.getScheduledCompanyUrls();
  assert.ok(Array.isArray(urls));
  assert.ok(urls.includes("https://example.com"), "example.comのcompany_context.jsonが存在するはず");
});
