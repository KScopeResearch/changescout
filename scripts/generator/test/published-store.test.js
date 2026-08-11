/**
 * published-store.test.js — scripts/generator/published-store.jsの自動テスト（PJ2 AOR Phase 3-D-1）。
 *
 * 目的: company-context-store.js・report-store.js・review/review-store.jsで確立した
 * filesystem/S3バックエンド切替パターンを、「company_slugが公開済みかどうか」
 * （従来publish-report.js/unpublish-report.jsがwebsite/aor/data/<slug>.jsonの存在で
 * 表現していたもの）へ横展開した際に、既存挙動を壊さず動作することを検証する。
 *
 * 実AWSへは一切接続しない（S3側はcompany-context-store.test.js等と同じくインメモリの
 * 疑似S3クライアントに差し替える）。filesystem側はwebsite/aor/data/配下にテスト専用の
 * slug（"test-published-store-poc-*"）でのみ書き込み、各テストの前後で必ず削除する
 * （既存のcompany-01-manufacturing等、実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const store = require("../published-store");
const fsBackend = require("../published-store/backends/filesystem-backend");
const s3Backend = require("../published-store/backends/s3-backend");

/** @param {string} slug */
function cleanupPublished(slug) {
  fs.rmSync(path.join(fsBackend.AOR_DATA_DIR, `${slug}.json`), { force: true });
}

function sampleReport(overrides = {}) {
  return {
    id: "report-id-test",
    schema_version: "2.4",
    company_profile: { name: "テスト株式会社" },
    evaluation: { score: 90, grade: "A", status: "PASS" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// published-store.js: getBackend()の切替（デフォルト・不正値）
// ---------------------------------------------------------------------------

test("published-store: PUBLISHED_STORE_BACKEND未設定時は既定でfilesystemバックエンドが使われる", async (t) => {
  const slug = "test-published-store-poc-default-backend";
  cleanupPublished(slug);
  t.after(() => cleanupPublished(slug));

  delete process.env.PUBLISHED_STORE_BACKEND; // 既存環境に設定されていないことを前提にする

  const report = sampleReport();
  await store.savePublished(slug, report);

  // filesystem-backend.jsが実際にwebsite/aor/data/配下へ書いたことを直接確認する
  // （published-store.jsがS3へ誤って書いていないことの証明）。
  const filePath = path.join(fsBackend.AOR_DATA_DIR, `${slug}.json`);
  assert.ok(fs.existsSync(filePath), "既定バックエンドはfilesystemであり、website/aor/data/配下にファイルが作られるはず");

  assert.equal(await store.isPublished(slug), true);
  const loaded = await store.loadPublished(slug);
  assert.deepEqual(loaded, report);
});

test("published-store: 未知のPUBLISHED_STORE_BACKENDは例外を投げる", async (t) => {
  process.env.PUBLISHED_STORE_BACKEND = "dynamodb";
  t.after(() => delete process.env.PUBLISHED_STORE_BACKEND);
  await assert.rejects(
    () => store.isPublished("test-published-store-poc-unknown-backend"),
    /未知のPUBLISHED_STORE_BACKEND/
  );
});

test("published-store: PUBLISHED_STORE_BACKEND=s3だが必須環境変数未設定の場合は例外を投げる（AWSへ接続しない）", async (t) => {
  process.env.PUBLISHED_STORE_BACKEND = "s3";
  const snap = { bucket: process.env.PUBLISHED_STORE_S3_BUCKET, region: process.env.AWS_REGION };
  delete process.env.PUBLISHED_STORE_S3_BUCKET;
  delete process.env.AWS_REGION;
  t.after(() => {
    delete process.env.PUBLISHED_STORE_BACKEND;
    if (snap.bucket !== undefined) process.env.PUBLISHED_STORE_S3_BUCKET = snap.bucket;
    if (snap.region !== undefined) process.env.AWS_REGION = snap.region;
  });

  await assert.rejects(
    () => store.isPublished("test-published-store-poc-s3-misconfigured"),
    /PUBLISHED_STORE_S3_BUCKET/
  );
});

// ---------------------------------------------------------------------------
// filesystem backend（backends/filesystem-backend.js）
// ---------------------------------------------------------------------------

test("filesystem-backend(published): 存在しないslugはexistsPublished=false、readPublished=nullを返す", async () => {
  const slug = "test-published-store-poc-nonexistent";
  cleanupPublished(slug);
  assert.equal(await fsBackend.existsPublished(slug), false);
  assert.equal(await fsBackend.readPublished(slug), null);
});

test("filesystem-backend(published): write → exists/read の往復で内容が一致する", async (t) => {
  const slug = "test-published-store-poc-roundtrip";
  cleanupPublished(slug);
  t.after(() => cleanupPublished(slug));

  const report = sampleReport();
  await fsBackend.writePublished(slug, report);
  assert.equal(await fsBackend.existsPublished(slug), true);
  const result = await fsBackend.readPublished(slug);
  assert.deepEqual(result, report);
});

test("filesystem-backend(published): deletePublished後はexistsPublished=falseになる", async (t) => {
  const slug = "test-published-store-poc-delete";
  cleanupPublished(slug);
  t.after(() => cleanupPublished(slug));

  await fsBackend.writePublished(slug, sampleReport());
  assert.equal(await fsBackend.existsPublished(slug), true);

  await fsBackend.deletePublished(slug);
  assert.equal(await fsBackend.existsPublished(slug), false);
});

test("filesystem-backend(published): 対象が存在しない状態でのdeletePublishedはエラーにならない（冪等）", async () => {
  const slug = "test-published-store-poc-delete-idempotent";
  cleanupPublished(slug);
  await assert.doesNotReject(() => fsBackend.deletePublished(slug));
});

test("filesystem-backend(published): publishedPathFor()は既存のwebsite/aor/data/<slug>.jsonと同じパスを返す", () => {
  const filePath = fsBackend.publishedPathFor("example.com");
  assert.equal(filePath, path.join(fsBackend.AOR_DATA_DIR, "example.com.json"));
});

// ---------------------------------------------------------------------------
// S3 backend（backends/s3-backend.js） — 実AWSへは一切接続しない
// ---------------------------------------------------------------------------

const ENV_VARS = ["PUBLISHED_STORE_S3_BUCKET", "PUBLISHED_STORE_S3_PREFIX", "AWS_REGION"];

function snapshotEnv() {
  const snap = {};
  ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}
function restoreEnv(snap) {
  ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}
function withS3Config(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.PUBLISHED_STORE_S3_BUCKET = overrides.bucket || "test-published-store-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.PUBLISHED_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.PUBLISHED_STORE_S3_PREFIX;
}

/** company-context-store.test.js等と同じ、インメモリの疑似S3クライアント（Head/Delete対応を追加）。 */
function createFakeS3Client(opts = {}) {
  const objects = opts.objects || {};
  const calls = [];
  const send = async (command) => {
    calls.push(command);
    const name = command.constructor.name;
    if (name === "GetObjectCommand") {
      const key = command.input.Key;
      if (!(key in objects)) {
        const err = new Error("The specified key does not exist.");
        err.name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => objects[key] } };
    }
    if (name === "HeadObjectCommand") {
      const key = command.input.Key;
      if (!(key in objects)) {
        const err = new Error("Not Found");
        err.name = "NotFound";
        throw err;
      }
      return {};
    }
    if (name === "PutObjectCommand") {
      objects[command.input.Key] = command.input.Body;
      return {};
    }
    if (name === "DeleteObjectCommand") {
      delete objects[command.input.Key];
      return {};
    }
    throw new Error(`未対応のコマンド: ${name}`);
  };
  return { send, calls, objects };
}

test("s3-backend(published): resolveConfig — PUBLISHED_STORE_S3_BUCKET未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.PUBLISHED_STORE_S3_BUCKET;
  assert.throws(() => s3Backend.resolveConfig(), /PUBLISHED_STORE_S3_BUCKET/);
});

test("s3-backend(published): publishedKey — <prefix><slug>.json というフラットなキーになる（既定prefix）", () => {
  assert.equal(s3Backend.publishedKey("example.com", "published/"), "published/example.com.json");
});

test("s3-backend(published): existsPublished — 存在しないキーはfalseを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const result = await s3Backend.existsPublished("test-published-store-poc-s3-missing", { client });
  assert.equal(result, false);
});

test("s3-backend(published): writePublished → existsPublished/readPublished の往復で内容が一致する（PutObjectはSSE-S3必須）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const report = sampleReport();
  const slug = "test-published-store-poc-s3-roundtrip";

  await s3Backend.writePublished(slug, report, { client });

  const putCall = client.calls.find((c) => c.constructor.name === "PutObjectCommand");
  assert.equal(putCall.input.ServerSideEncryption, "AES256");

  assert.equal(await s3Backend.existsPublished(slug, { client }), true);
  const result = await s3Backend.readPublished(slug, { client });
  assert.deepEqual(result, report);
});

test("s3-backend(published): deletePublished後はexistsPublished=falseになる", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const slug = "test-published-store-poc-s3-delete";

  await s3Backend.writePublished(slug, sampleReport(), { client });
  assert.equal(await s3Backend.existsPublished(slug, { client }), true);

  await s3Backend.deletePublished(slug, { client });
  assert.equal(await s3Backend.existsPublished(slug, { client }), false);
});

test("s3-backend(published): 対象キーが存在しない状態でのdeletePublishedはエラーにならない（冪等。S3のDeleteObjectは対象不在でも成功を返す）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  await assert.doesNotReject(() => s3Backend.deletePublished("test-published-store-poc-s3-delete-idempotent", { client }));
});

test("s3-backend(published): PUBLISHED_STORE_S3_PREFIX未設定時は既定prefix「published/」が使われる", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  await s3Backend.writePublished("test-published-store-poc-s3-default-prefix", sampleReport(), { client });
  assert.ok(Object.keys(client.objects).includes("published/test-published-store-poc-s3-default-prefix.json"));
});

test("published-store: isPublished/loadPublished/savePublished/deletePublished(slug, options)がoptions.clientをS3 backendへそのまま渡す", async (t) => {
  withS3Config(t);
  process.env.PUBLISHED_STORE_BACKEND = "s3";
  t.after(() => delete process.env.PUBLISHED_STORE_BACKEND);
  const client = createFakeS3Client();
  const report = sampleReport();
  const slug = "test-published-store-poc-options-passthrough";

  await store.savePublished(slug, report, { client });
  assert.equal(await store.isPublished(slug, { client }), true);
  assert.deepEqual(await store.loadPublished(slug, { client }), report);

  await store.deletePublished(slug, { client });
  assert.equal(await store.isPublished(slug, { client }), false);
});

// ---------------------------------------------------------------------------
// クロスバックエンド同値性
// ---------------------------------------------------------------------------

test("クロスバックエンド同値性(published): 同じreportをfilesystem/S3(mock)双方に保存しても、公開判定・内容の結果は同一になる", async (t) => {
  const slug = "test-published-store-poc-cross-backend";
  cleanupPublished(slug);
  t.after(() => cleanupPublished(slug));
  withS3Config(t);

  const report = sampleReport({ id: "cross-backend-report" });

  await fsBackend.writePublished(slug, report);
  const fromFs = await fsBackend.readPublished(slug);
  const existsFs = await fsBackend.existsPublished(slug);

  const client = createFakeS3Client();
  await s3Backend.writePublished(slug, report, { client });
  const fromS3 = await s3Backend.readPublished(slug, { client });
  const existsS3 = await s3Backend.existsPublished(slug, { client });

  assert.deepEqual(fromFs, report);
  assert.deepEqual(fromS3, report);
  assert.deepEqual(fromFs, fromS3, "呼び出し側から見た結果はバックエンドに依らず同一であるはず");
  assert.equal(existsFs, true);
  assert.equal(existsS3, true);
});

// ---------------------------------------------------------------------------
// PII/secretがログへ出力されないことの確認（他backend testと同様の観点）
// ---------------------------------------------------------------------------

test("s3-backend(published): read/write/delete中にconsole.log/console.errorが一切呼ばれない", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const report = sampleReport();
  const slug = "test-published-store-poc-no-log";

  const originalLog = console.log;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(["log", args]);
  console.error = (...args) => calls.push(["error", args]);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await s3Backend.writePublished(slug, report, { client });
  await s3Backend.readPublished(slug, { client });
  await s3Backend.existsPublished(slug, { client });
  await s3Backend.deletePublished(slug, { client });

  assert.equal(calls.length, 0);
});
