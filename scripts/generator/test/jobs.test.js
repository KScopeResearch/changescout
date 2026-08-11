/**
 * jobs.test.js — Task18: jobs/job-store.js・job-runner.js・job-engine.jsの自動テスト。
 * engine.executeを一時的に差し替えてリトライ・キャンセル・失敗系を検証する
 * （job-engine.js自体は実際のパイプラインを呼ぶため、実行時間の長い経路は
 * generator.test.jsで別途カバーする）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const runner = require("../jobs/job-runner");
const store = require("../jobs/job-store");
const engine = require("../jobs/job-engine");
const { OUTPUT_DIR } = require("../shared/paths");
const { saveCompanyContext } = require("../company-context-store");

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

test("getScheduledCompanyUrls: output/配下の既存company_context.jsonからinput_urlを収集する", async () => {
  const urls = await runner.getScheduledCompanyUrls();
  assert.ok(Array.isArray(urls));
  assert.ok(urls.includes("https://example.com"), "example.comのcompany_context.jsonが存在するはず");
});

// ---------------------------------------------------------------------------
// PJ2 AOR: getScheduledCompanyUrls()のcompany_context内容読み込みbackend非依存化
//
// company-context-store.jsのloadCompanyContext(slug)経由で内容を取得するようになった
// ことを、filesystem/S3(mock)双方で検証する。実AWSへは一切接続しない
// （S3側はcompany-index.test.js・company-context-store.test.jsと同じ、
// インメモリの疑似S3クライアントを使用）。filesystem側はOUTPUT_DIR配下にテスト専用の
// slug（"test-jobs-scheduled-urls-poc-*"）でのみ書き込み、各テストの前後で必ず削除する
// （既存のexample.com等、実データには一切触れない）。
// ---------------------------------------------------------------------------

const SCHEDULED_URLS_PREFIX = "test-jobs-scheduled-urls-poc-";

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/** @param {string[]} slugs */
function cleanupAll(slugs) {
  slugs.forEach(cleanupSlugDir);
}

test("getScheduledCompanyUrls(filesystem): loadCompanyContext()経由で複数companyのinput_urlを収集する", async (t) => {
  const slugA = `${SCHEDULED_URLS_PREFIX}multi-a`;
  const slugB = `${SCHEDULED_URLS_PREFIX}multi-b`;
  cleanupAll([slugA, slugB]);
  t.after(() => cleanupAll([slugA, slugB]));

  await saveCompanyContext(slugA, { input_url: `https://${slugA}.example.jp/` });
  await saveCompanyContext(slugB, { input_url: `https://${slugB}.example.jp/` });

  const urls = await runner.getScheduledCompanyUrls();
  assert.ok(urls.includes(`https://${slugA}.example.jp/`));
  assert.ok(urls.includes(`https://${slugB}.example.jp/`));
});

test("getScheduledCompanyUrls(filesystem): company_context.jsonが存在しないslug（空ディレクトリ）は除外される", async (t) => {
  const slug = `${SCHEDULED_URLS_PREFIX}empty-dir`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  fs.mkdirSync(path.join(OUTPUT_DIR, slug), { recursive: true }); // company_context.jsonを置かない

  const urls = await runner.getScheduledCompanyUrls();
  assert.ok(!urls.some((u) => u.includes(slug)));
});

test("getScheduledCompanyUrls(filesystem): input_urlフィールドが無いcompany_contextは除外される", async (t) => {
  const slug = `${SCHEDULED_URLS_PREFIX}no-input-url`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  await saveCompanyContext(slug, { generated_at: "2026-01-01T00:00:00.000Z" }); // input_urlなし

  const urls = await runner.getScheduledCompanyUrls();
  assert.ok(!urls.some((u) => u.includes(slug)));
});

test("getScheduledCompanyUrls(filesystem): 不正JSON（壊れたcompany_context.json）はエラーにせずスキップする", async (t) => {
  const brokenSlug = `${SCHEDULED_URLS_PREFIX}broken-json`;
  const okSlug = `${SCHEDULED_URLS_PREFIX}after-broken`;
  cleanupAll([brokenSlug, okSlug]);
  t.after(() => cleanupAll([brokenSlug, okSlug]));

  fs.mkdirSync(path.join(OUTPUT_DIR, brokenSlug), { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, brokenSlug, "company_context.json"), "{ this is not valid json", "utf-8");
  await saveCompanyContext(okSlug, { input_url: `https://${okSlug}.example.jp/` });

  // 壊れたcompany_context.jsonがあっても例外を投げず、以降のslugの収集を継続できるはず
  // （company-context-store.jsのfilesystem backendはreadJson()を使うため例外を投げるが、
  // job-runner.js側のtry/catchで従来のreadJsonSafe()相当の「スキップ」挙動を再現している）。
  const urls = await runner.getScheduledCompanyUrls();
  assert.ok(!urls.some((u) => u.includes(brokenSlug)), "壊れたJSONのcompany_contextはスキップされるはず");
  assert.ok(urls.includes(`https://${okSlug}.example.jp/`), "壊れたJSONの後続slugは正常に収集されるはず");
});

// --- S3 mock（実AWSへは一切接続しない） ---

const COMPANY_CONTEXT_S3_ENV_VARS = [
  "COMPANY_CONTEXT_STORE_BACKEND",
  "COMPANY_CONTEXT_STORE_S3_BUCKET",
  "COMPANY_CONTEXT_STORE_S3_PREFIX",
  "AWS_REGION",
];

function snapshotCompanyContextS3Env() {
  const snap = {};
  COMPANY_CONTEXT_S3_ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}
function restoreCompanyContextS3Env(snap) {
  COMPANY_CONTEXT_S3_ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}
function withCompanyContextS3Env(t, overrides = {}) {
  const snap = snapshotCompanyContextS3Env();
  t.after(() => restoreCompanyContextS3Env(snap));
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  process.env.COMPANY_CONTEXT_STORE_S3_BUCKET = overrides.bucket || "test-jobs-scheduled-urls-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.COMPANY_CONTEXT_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.COMPANY_CONTEXT_STORE_S3_PREFIX;
}

/**
 * ListObjectsV2Command（一覧取得）とGetObjectCommand（内容取得）の両方に対応する、
 * インメモリの疑似S3クライアント（company-index.test.js・company-context-store.test.jsと
 * 同じ手法。listCompanySlugs()とloadCompanyContext()が同じclientを共有して使う）。
 * @param {{objects?:Object<string,string>}} [opts]
 */
function createFakeCompanyContextS3Client(opts = {}) {
  const objects = opts.objects || {}; // key -> JSON文字列
  const calls = [];

  const send = async (command) => {
    calls.push(command);
    const name = command.constructor.name;
    if (name === "ListObjectsV2Command") {
      const prefix = command.input.Prefix || "";
      const keys = Object.keys(objects).filter((k) => k.startsWith(prefix));
      return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    }
    if (name === "GetObjectCommand") {
      const key = command.input.Key;
      if (!(key in objects)) {
        const err = new Error("The specified key does not exist.");
        err.name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => objects[key] } };
    }
    throw new Error(`未対応のコマンド: ${name}`);
  };
  return { send, calls, objects };
}

test("getScheduledCompanyUrls(s3 mock): listCompanySlugs()とloadCompanyContext()が同じS3 backendを参照し、input_urlを収集できる", async (t) => {
  withCompanyContextS3Env(t);
  const client = createFakeCompanyContextS3Client({
    objects: {
      "company-contexts/s3-company-a.json": JSON.stringify({ input_url: "https://s3-company-a.example.jp/" }),
      "company-contexts/s3-company-b.json": JSON.stringify({ input_url: "https://s3-company-b.example.jp/" }),
    },
  });

  const urls = await runner.getScheduledCompanyUrls({ client });
  assert.deepEqual(
    [...urls].sort(),
    ["https://s3-company-a.example.jp/", "https://s3-company-b.example.jp/"].sort()
  );

  // 一覧取得（ListObjectsV2）・内容取得（GetObject）の両方が同じfake clientを通ったことを確認する
  const listCalls = client.calls.filter((c) => c.constructor.name === "ListObjectsV2Command");
  const getCalls = client.calls.filter((c) => c.constructor.name === "GetObjectCommand");
  assert.equal(listCalls.length, 1);
  assert.equal(getCalls.length, 2);
});

test("getScheduledCompanyUrls(s3 mock): input_urlが無いオブジェクト・不正JSONは除外される", async (t) => {
  withCompanyContextS3Env(t);
  const client = createFakeCompanyContextS3Client({
    objects: {
      "company-contexts/s3-no-url.json": JSON.stringify({ generated_at: "2026-01-01T00:00:00.000Z" }), // input_urlなし
      "company-contexts/s3-ok.json": JSON.stringify({ input_url: "https://s3-ok.example.jp/" }),
    },
  });

  const urls = await runner.getScheduledCompanyUrls({ client });
  assert.deepEqual(urls, ["https://s3-ok.example.jp/"]);
});

test("backend同値性(getScheduledCompanyUrls): 同じslug/input_urlについて、filesystemとS3(mock)で同じ結果になる", async (t) => {
  const slug = `${SCHEDULED_URLS_PREFIX}cross-backend`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  const inputUrl = `https://${slug}.example.jp/`;

  await saveCompanyContext(slug, { input_url: inputUrl });
  const fromFilesystem = await runner.getScheduledCompanyUrls();
  assert.ok(fromFilesystem.includes(inputUrl));

  withCompanyContextS3Env(t);
  const client = createFakeCompanyContextS3Client({
    objects: { [`company-contexts/${slug}.json`]: JSON.stringify({ input_url: inputUrl }) },
  });
  const fromS3 = await runner.getScheduledCompanyUrls({ client });

  assert.deepEqual(fromS3, [inputUrl], "S3(mock)側は今回作成した1件のみを含むはず");
  assert.ok(fromFilesystem.includes(inputUrl) && fromS3.includes(inputUrl), "同じinput_urlがfilesystem/S3双方で得られるはず");
});
