/**
 * review-store.test.js — scripts/generator/review/review-store.js（PoC）の自動テスト。
 *
 * 目的: leads/lead-store.js・leads/backends/s3-backend.test.jsで確立したパターンを
 * review.jsonへ横展開した際に、既存挙動・データを壊さず動作することを検証する。
 *
 * 実AWSへは一切接続しない（S3側はs3-backend.test.jsと同じくインメモリの疑似S3
 * クライアントに差し替える）。filesystem側はscripts/generator/output/配下に
 * テスト専用のslug（"test-review-store-poc-*"）でのみ書き込み、各テストの前後で
 * 必ず削除する（既存のexample.com等、実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { OUTPUT_DIR } = require("../shared/paths");
const { createEmptyReview, approve, addComment } = require("../review/review-engine");
const reviewStore = require("../review/review-store");
const fsBackend = require("../review/backends/filesystem-backend");
const s3Backend = require("../review/backends/s3-backend");

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// review-store.js: getBackend()の切替（デフォルト・不正値）
// ---------------------------------------------------------------------------

test("review-store: REVIEW_STORE_BACKEND未設定時は既定でfilesystemバックエンドが使われる", async (t) => {
  const slug = "test-review-store-poc-default-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  delete process.env.REVIEW_STORE_BACKEND; // 既存環境に設定されていないことを前提にする（明示的に未設定へ）

  const review = await reviewStore.loadReview(slug, "report-x");
  assert.equal(review.status, "pending_review");

  await reviewStore.saveReview(slug, approve(review, { reviewer: "poc-tester", now: "2026-01-01T00:00:00Z" }));

  // filesystem-backend.jsが実際にOUTPUT_DIR配下へ書いたことを直接確認する
  // （review-store.jsがS3へ誤って書いていないことの証明）。
  const filePath = path.join(OUTPUT_DIR, slug, "review.json");
  assert.ok(fs.existsSync(filePath), "既定バックエンドはfilesystemであり、OUTPUT_DIR配下にファイルが作られるはず");
  const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.status, "approved");
});

test("review-store: 未知のREVIEW_STORE_BACKENDは例外を投げる", async (t) => {
  process.env.REVIEW_STORE_BACKEND = "dynamodb";
  t.after(() => delete process.env.REVIEW_STORE_BACKEND);
  await assert.rejects(() => reviewStore.loadReview("test-review-store-poc-unknown-backend"), /未知のREVIEW_STORE_BACKEND/);
});

test("review-store: REVIEW_STORE_BACKEND=s3だが必須環境変数未設定の場合は例外を投げる（AWSへ接続しない）", async (t) => {
  process.env.REVIEW_STORE_BACKEND = "s3";
  const snap = { bucket: process.env.REVIEW_STORE_S3_BUCKET, region: process.env.AWS_REGION };
  delete process.env.REVIEW_STORE_S3_BUCKET;
  delete process.env.AWS_REGION;
  t.after(() => {
    delete process.env.REVIEW_STORE_BACKEND;
    if (snap.bucket !== undefined) process.env.REVIEW_STORE_S3_BUCKET = snap.bucket;
    if (snap.region !== undefined) process.env.AWS_REGION = snap.region;
  });

  await assert.rejects(() => reviewStore.loadReview("test-review-store-poc-s3-misconfigured"), /REVIEW_STORE_S3_BUCKET/);
});

// ---------------------------------------------------------------------------
// filesystem backend（backends/filesystem-backend.js）
// ---------------------------------------------------------------------------

test("filesystem-backend: 存在しないslugはnullを返す", async () => {
  const result = await fsBackend.readReview("test-review-store-poc-nonexistent");
  assert.equal(result, null);
});

test("filesystem-backend: write → read の往復で内容が一致する", async (t) => {
  const slug = "test-review-store-poc-roundtrip";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const review = addComment(createEmptyReview("report-roundtrip"), {
    actor: "poc-tester",
    text: "PoC確認用コメント",
    now: "2026-01-01T00:00:00Z",
  });

  await fsBackend.writeReview(slug, review);
  const result = await fsBackend.readReview(slug);
  assert.deepEqual(result, review);
});

test("filesystem-backend: 保存形式は既存writeJson()と同一（2スペースインデント+末尾改行）", async (t) => {
  const slug = "test-review-store-poc-format";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const review = createEmptyReview("report-format");
  await fsBackend.writeReview(slug, review);

  const raw = fs.readFileSync(path.join(OUTPUT_DIR, slug, "review.json"), "utf-8");
  assert.ok(raw.endsWith("\n"), "末尾改行が既存規約と一致するはず");
  assert.equal(raw, JSON.stringify(review, null, 2) + "\n");
});

test("filesystem-backend: status/comments/history/fixesを含む複雑なreviewも壊さず往復できる", async (t) => {
  const slug = "test-review-store-poc-complex";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  let review = createEmptyReview("report-complex");
  review = addComment(review, { actor: "alice", text: "確認中", now: "2026-01-01T00:00:00Z" });
  review = approve(review, { reviewer: "bob", comment: "問題なし", now: "2026-01-02T00:00:00Z" });

  await fsBackend.writeReview(slug, review);
  const result = await fsBackend.readReview(slug);

  assert.equal(result.status, "approved");
  assert.equal(result.reviewer, "bob");
  assert.equal(result.comments.length, 1);
  assert.equal(result.history.length, 2);
  assert.deepEqual(result, review);
});

test("filesystem-backend: 不正なcompany_slug（パストラバーサル試行）は例外を投げる", async () => {
  await assert.rejects(() => fsBackend.readReview("../../etc/passwd"));
  await assert.rejects(() => fsBackend.writeReview("..", { status: "pending_review" }));
});

test("filesystem-backend: 既存のOUTPUT_DIR配下に実在するreview.json（自作フィクスチャ）を正しく読める", async (t) => {
  // 「既存review.jsonが存在する場合に正常に読める」ことの確認。ただし実データ
  // （example.com等）には一切触れず、テスト専用slugの下に自分でreview.jsonを
  // 事前に配置してから読む（既存のwriteJson()を使い、review-store.js経由ではない
  // 手段で書いたファイルも、フォーマットが同一なので同じように読めることを示す）。
  const slug = "test-review-store-poc-preexisting";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const { writeJson } = require("../shared/json-file");
  const preexisting = approve(createEmptyReview("report-preexisting"), {
    reviewer: "carol",
    now: "2026-01-03T00:00:00Z",
  });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), preexisting);

  const result = await fsBackend.readReview(slug);
  assert.deepEqual(result, preexisting, "review-engine.js側のwriteJson()で書いたファイルもそのまま読めるはず");
});

// ---------------------------------------------------------------------------
// S3 backend（backends/s3-backend.js） — 実AWSへは一切接続しない
// ---------------------------------------------------------------------------

const ENV_VARS = ["REVIEW_STORE_S3_BUCKET", "REVIEW_STORE_S3_PREFIX", "AWS_REGION"];

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
  process.env.REVIEW_STORE_S3_BUCKET = overrides.bucket || "test-review-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.REVIEW_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.REVIEW_STORE_S3_PREFIX;
}

/** leads/backends/s3-backend.test.jsと同じ、インメモリの疑似S3クライアント。 */
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
    if (name === "PutObjectCommand") {
      objects[command.input.Key] = command.input.Body;
      return {};
    }
    throw new Error(`未対応のコマンド: ${name}`);
  };
  return { send, calls, objects };
}

test("s3-backend(review): resolveConfig — REVIEW_STORE_S3_BUCKET未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.REVIEW_STORE_S3_BUCKET;
  assert.throws(() => s3Backend.resolveConfig(), /REVIEW_STORE_S3_BUCKET/);
});

test("s3-backend(review): reviewKey — <prefix><slug>.json というフラットなキーになる", () => {
  assert.equal(s3Backend.reviewKey("example.com", "reviews/"), "reviews/example.com.json");
});

test("s3-backend(review): readReview — 存在しないキーはnullを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const result = await s3Backend.readReview("test-review-store-poc-s3-missing", { client });
  assert.equal(result, null);
});

test("s3-backend(review): writeReview → readReview の往復で内容が一致する（PutObjectはSSE-S3必須）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const review = approve(createEmptyReview("report-s3-roundtrip"), { reviewer: "dave", now: "2026-01-01T00:00:00Z" });

  await s3Backend.writeReview("test-review-store-poc-s3-roundtrip", review, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].input.ServerSideEncryption, "AES256");

  const result = await s3Backend.readReview("test-review-store-poc-s3-roundtrip", { client });
  assert.deepEqual(result, review);
});

test("s3-backend(review): 同一slugへの再writeReviewは上書きされる（Lead本体と同じ挙動）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const slug = "test-review-store-poc-s3-overwrite";

  const v1 = createEmptyReview("report-overwrite");
  await s3Backend.writeReview(slug, v1, { client });

  const v2 = approve(v1, { reviewer: "erin", now: "2026-01-02T00:00:00Z" });
  await s3Backend.writeReview(slug, v2, { client });

  const result = await s3Backend.readReview(slug, { client });
  assert.equal(result.status, "approved");
  assert.deepEqual(result, v2);
});

// ---------------------------------------------------------------------------
// クロスバックエンド同値性: filesystem backendとS3(mock) backendで
// 同じreviewオブジェクトを保存・取得した場合、呼び出し側から見た結果が同一であること
// ---------------------------------------------------------------------------

test("クロスバックエンド同値性: 同じreviewをfilesystem/S3(mock)双方に保存・取得しても同一の結果になる", async (t) => {
  const slug = "test-review-store-poc-cross-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  withS3Config(t);

  let review = createEmptyReview("report-cross-backend");
  review = addComment(review, { actor: "frank", text: "cross-backend確認", now: "2026-01-01T00:00:00Z" });
  review = approve(review, { reviewer: "grace", now: "2026-01-02T00:00:00Z" });

  await fsBackend.writeReview(slug, review);
  const fromFs = await fsBackend.readReview(slug);

  const client = createFakeS3Client();
  await s3Backend.writeReview(slug, review, { client });
  const fromS3 = await s3Backend.readReview(slug, { client });

  assert.deepEqual(fromFs, review);
  assert.deepEqual(fromS3, review);
  assert.deepEqual(fromFs, fromS3, "呼び出し側から見た結果はバックエンドに依らず同一であるはず");
});

// ---------------------------------------------------------------------------
// PII/secretがログへ出力されないことの確認（leads/backends/s3-backend.test.jsと同様の観点）
// ---------------------------------------------------------------------------

test("s3-backend(review): read/write中にconsole.log/console.errorが一切呼ばれない", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const review = createEmptyReview("report-no-log");

  const originalLog = console.log;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(["log", args]);
  console.error = (...args) => calls.push(["error", args]);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await s3Backend.writeReview("test-review-store-poc-no-log", review, { client });
  await s3Backend.readReview("test-review-store-poc-no-log", { client });

  assert.equal(calls.length, 0);
});
