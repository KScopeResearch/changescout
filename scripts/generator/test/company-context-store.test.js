/**
 * company-context-store.test.js — scripts/generator/company-context-store.js（PoC）の自動テスト。
 *
 * 目的: leads/lead-store.js・review/review-store.jsで確立したfilesystem/S3バックエンド
 * 切替パターンを、company_context.jsonへ横展開した際に、既存挙動・データを壊さず
 * 動作することを検証する。
 *
 * 実AWSへは一切接続しない（S3側はleads/backends/s3-backend.test.js・
 * test/review-store.test.jsと同じくインメモリの疑似S3クライアントに差し替える）。
 * filesystem側はscripts/generator/output/配下にテスト専用のslug
 * （"test-company-context-store-poc-*"）でのみ書き込み、各テストの前後で必ず削除する
 * （既存のexample.com等、実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { OUTPUT_DIR } = require("../shared/paths");
const store = require("../company-context-store");
const fsBackend = require("../company-context-store/backends/filesystem-backend");
const s3Backend = require("../company-context-store/backends/s3-backend");

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

function sampleContext(overrides = {}) {
  return {
    input_url: "https://example-test.co.jp/",
    generated_at: "2026-01-01T00:00:00.000Z",
    industry_hint: "中小企業",
    company_fetch_ok: true,
    company_fetch_error: null,
    pipeline_stats: {
      fetched_total: 5,
      normalized_total: 5,
      duplicates_removed: 0,
      after_dedupe: 5,
      selected_for_ai: 5,
      max_sources_for_ai: 20,
    },
    sources: [{ id: "src-1", title: "Test Source", url: "https://example-test.co.jp/", source_type: "company" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// company-context-store.js: getBackend()の切替（デフォルト・不正値）
// ---------------------------------------------------------------------------

test("company-context-store: COMPANY_CONTEXT_STORE_BACKEND未設定時は既定でfilesystemバックエンドが使われる", async (t) => {
  const slug = "test-company-context-store-poc-default-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  delete process.env.COMPANY_CONTEXT_STORE_BACKEND; // 既存環境に設定されていないことを前提にする

  const context = sampleContext();
  await store.saveCompanyContext(slug, context);

  // filesystem-backend.jsが実際にOUTPUT_DIR配下へ書いたことを直接確認する
  // （company-context-store.jsがS3へ誤って書いていないことの証明）。
  const filePath = path.join(OUTPUT_DIR, slug, "company_context.json");
  assert.ok(fs.existsSync(filePath), "既定バックエンドはfilesystemであり、OUTPUT_DIR配下にファイルが作られるはず");
  const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.input_url, context.input_url);

  const loaded = await store.loadCompanyContext(slug);
  assert.deepEqual(loaded, context);
});

test("company-context-store: 未知のCOMPANY_CONTEXT_STORE_BACKENDは例外を投げる", async (t) => {
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "dynamodb";
  t.after(() => delete process.env.COMPANY_CONTEXT_STORE_BACKEND);
  await assert.rejects(
    () => store.loadCompanyContext("test-company-context-store-poc-unknown-backend"),
    /未知のCOMPANY_CONTEXT_STORE_BACKEND/
  );
});

test("company-context-store: COMPANY_CONTEXT_STORE_BACKEND=s3だが必須環境変数未設定の場合は例外を投げる（AWSへ接続しない）", async (t) => {
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  const snap = { bucket: process.env.COMPANY_CONTEXT_STORE_S3_BUCKET, region: process.env.AWS_REGION };
  delete process.env.COMPANY_CONTEXT_STORE_S3_BUCKET;
  delete process.env.AWS_REGION;
  t.after(() => {
    delete process.env.COMPANY_CONTEXT_STORE_BACKEND;
    if (snap.bucket !== undefined) process.env.COMPANY_CONTEXT_STORE_S3_BUCKET = snap.bucket;
    if (snap.region !== undefined) process.env.AWS_REGION = snap.region;
  });

  await assert.rejects(
    () => store.loadCompanyContext("test-company-context-store-poc-s3-misconfigured"),
    /COMPANY_CONTEXT_STORE_S3_BUCKET/
  );
});

// ---------------------------------------------------------------------------
// filesystem backend（backends/filesystem-backend.js）
// ---------------------------------------------------------------------------

test("filesystem-backend(company-context): 存在しないslugはnullを返す", async () => {
  const result = await fsBackend.readCompanyContext("test-company-context-store-poc-nonexistent");
  assert.equal(result, null);
});

test("filesystem-backend(company-context): write → read の往復で内容が一致する", async (t) => {
  const slug = "test-company-context-store-poc-roundtrip";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const context = sampleContext();
  await fsBackend.writeCompanyContext(slug, context);
  const result = await fsBackend.readCompanyContext(slug);
  assert.deepEqual(result, context);
});

test("filesystem-backend(company-context): 保存形式は既存writeJson()と同一（2スペースインデント+末尾改行）", async (t) => {
  const slug = "test-company-context-store-poc-format";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const context = sampleContext();
  await fsBackend.writeCompanyContext(slug, context);

  const raw = fs.readFileSync(path.join(OUTPUT_DIR, slug, "company_context.json"), "utf-8");
  assert.ok(raw.endsWith("\n"), "末尾改行が既存規約と一致するはず");
  assert.equal(raw, JSON.stringify(context, null, 2) + "\n");
});

test("filesystem-backend(company-context): 不正なcompany_slug（パストラバーサル試行）は例外を投げる", async () => {
  await assert.rejects(() => fsBackend.readCompanyContext("../../etc/passwd"));
  await assert.rejects(() => fsBackend.writeCompanyContext("..", sampleContext()));
});

test("filesystem-backend(company-context): 既存のOUTPUT_DIR配下に実在するcompany_context.json（自作フィクスチャ）を正しく読める", async (t) => {
  // 既存データ（example.com等）には一切触れず、テスト専用slugの下に自分で
  // company_context.jsonを事前に配置してから読む（既存のwriteJson()を使い、
  // company-context-store.js経由ではない手段で書いたファイルも、フォーマットが
  // 同一なので同じように読めることを示す）。
  const slug = "test-company-context-store-poc-preexisting";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const { writeJson } = require("../shared/json-file");
  const preexisting = sampleContext({ input_url: "https://preexisting-test.co.jp/" });
  writeJson(path.join(OUTPUT_DIR, slug, "company_context.json"), preexisting);

  const result = await fsBackend.readCompanyContext(slug);
  assert.deepEqual(result, preexisting, "generate-company-report.js等が書いたファイルもそのまま読めるはず");
});

// ---------------------------------------------------------------------------
// S3 backend（backends/s3-backend.js） — 実AWSへは一切接続しない
// ---------------------------------------------------------------------------

const ENV_VARS = ["COMPANY_CONTEXT_STORE_S3_BUCKET", "COMPANY_CONTEXT_STORE_S3_PREFIX", "AWS_REGION"];

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
  process.env.COMPANY_CONTEXT_STORE_S3_BUCKET = overrides.bucket || "test-company-context-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.COMPANY_CONTEXT_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.COMPANY_CONTEXT_STORE_S3_PREFIX;
}

/** leads/backends/s3-backend.test.js・test/review-store.test.jsと同じ、インメモリの疑似S3クライアント。 */
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

test("s3-backend(company-context): resolveConfig — COMPANY_CONTEXT_STORE_S3_BUCKET未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.COMPANY_CONTEXT_STORE_S3_BUCKET;
  assert.throws(() => s3Backend.resolveConfig(), /COMPANY_CONTEXT_STORE_S3_BUCKET/);
});

test("s3-backend(company-context): companyContextKey — <prefix><slug>.json というフラットなキーになる", () => {
  assert.equal(s3Backend.companyContextKey("example.com", "company-contexts/"), "company-contexts/example.com.json");
});

test("s3-backend(company-context): readCompanyContext — 存在しないキーはnullを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const result = await s3Backend.readCompanyContext("test-company-context-store-poc-s3-missing", { client });
  assert.equal(result, null);
});

test("company-context-store: loadCompanyContext(slug, options)がoptions.clientをS3 backendへそのまま渡す（PJ2 AOR: job-runner.js接続PoCで追加）", async (t) => {
  withS3Config(t);
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  t.after(() => delete process.env.COMPANY_CONTEXT_STORE_BACKEND);
  const context = sampleContext();
  const client = createFakeS3Client({
    objects: { "company-contexts/test-company-context-store-poc-options-passthrough.json": JSON.stringify(context) },
  });

  // store.loadCompanyContext()という公開interface経由で、実AWSに接続せずS3 backendを検証できることを確認する
  // （options未指定時は従来通りdefaultClient()相当が使われ、挙動は変わらない）。
  const result = await store.loadCompanyContext("test-company-context-store-poc-options-passthrough", { client });
  assert.deepEqual(result, context);
  assert.ok(client.calls.some((c) => c.constructor.name === "GetObjectCommand"), "注入したモッククライアントが実際に使われたはず");
});

test("s3-backend(company-context): writeCompanyContext → readCompanyContext の往復で内容が一致する（PutObjectはSSE-S3必須）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const context = sampleContext();

  await s3Backend.writeCompanyContext("test-company-context-store-poc-s3-roundtrip", context, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].input.ServerSideEncryption, "AES256");

  const result = await s3Backend.readCompanyContext("test-company-context-store-poc-s3-roundtrip", { client });
  assert.deepEqual(result, context);
});

test("s3-backend(company-context): 同一slugへの再writeCompanyContextは上書きされる（Lead/review本体と同じ挙動）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const slug = "test-company-context-store-poc-s3-overwrite";

  const v1 = sampleContext({ generated_at: "2026-01-01T00:00:00.000Z" });
  await s3Backend.writeCompanyContext(slug, v1, { client });

  const v2 = sampleContext({ generated_at: "2026-01-02T00:00:00.000Z" });
  await s3Backend.writeCompanyContext(slug, v2, { client });

  const result = await s3Backend.readCompanyContext(slug, { client });
  assert.equal(result.generated_at, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(result, v2);
});

// ---------------------------------------------------------------------------
// クロスバックエンド同値性: filesystem backendとS3(mock) backendで
// 同じcompany_contextオブジェクトを保存・取得した場合、呼び出し側から見た結果が同一であること
// ---------------------------------------------------------------------------

test("クロスバックエンド同値性(company-context): 同じcompany_contextをfilesystem/S3(mock)双方に保存・取得しても同一の結果になる", async (t) => {
  const slug = "test-company-context-store-poc-cross-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  withS3Config(t);

  const context = sampleContext({ input_url: "https://cross-backend-test.co.jp/" });

  await fsBackend.writeCompanyContext(slug, context);
  const fromFs = await fsBackend.readCompanyContext(slug);

  const client = createFakeS3Client();
  await s3Backend.writeCompanyContext(slug, context, { client });
  const fromS3 = await s3Backend.readCompanyContext(slug, { client });

  assert.deepEqual(fromFs, context);
  assert.deepEqual(fromS3, context);
  assert.deepEqual(fromFs, fromS3, "呼び出し側から見た結果はバックエンドに依らず同一であるはず");
});

// ---------------------------------------------------------------------------
// PII/secretがログへ出力されないことの確認（他backend testと同様の観点）
// ---------------------------------------------------------------------------

test("s3-backend(company-context): read/write中にconsole.log/console.errorが一切呼ばれない", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const context = sampleContext();

  const originalLog = console.log;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(["log", args]);
  console.error = (...args) => calls.push(["error", args]);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await s3Backend.writeCompanyContext("test-company-context-store-poc-no-log", context, { client });
  await s3Backend.readCompanyContext("test-company-context-store-poc-no-log", { client });

  assert.equal(calls.length, 0);
});
