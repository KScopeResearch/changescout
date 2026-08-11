/**
 * report-store.test.js — scripts/generator/report-store.js（PJ2 AOR Phase B-1〜B-3で
 * filesystem、Phase B-7でS3）の自動テスト。
 *
 * 目的: company-context-store.js・review/review-store.jsで確立したfilesystem/S3
 * バックエンドパターンを、report.jsonへ横展開した際に、既存挙動・データを壊さず
 * 動作することを検証する。
 *
 * S3側は実AWSへは一切接続しない（company-context-store.test.js・test/review-store.test.js
 * と同じく、インメモリの疑似S3クライアントに差し替えて検証する）。filesystem側は
 * scripts/generator/output/配下にテスト専用のslug（"test-report-store-poc-*"）でのみ
 * 書き込み、各テストの前後で必ず削除する（既存のexample.com等、実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { OUTPUT_DIR } = require("../shared/paths");
const store = require("../report-store");
const fsBackend = require("../report-store/backends/filesystem-backend");
const s3Backend = require("../report-store/backends/s3-backend");

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/** @param {string[]} slugs */
function cleanupAll(slugs) {
  slugs.forEach(cleanupSlugDir);
}

function sampleReport(overrides = {}) {
  return {
    id: "generated-test-report-store-poc",
    meta: {
      schema_version: "2.4",
      generated_at: "2026-01-01T00:00:00.000Z",
      pipeline_version: "phase1-generator-v0.3-llm",
    },
    company_profile: { name: "テスト株式会社" },
    source_pages: [],
    free_opportunity: { summary: "test" },
    locked_opportunities: [],
    paid_analysis: {},
    human_review: { status: "pending_review", reviewer: null, reviewed_at: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// report-store.js: getBackend()の切替（デフォルト・不正値・s3未実装）
// ---------------------------------------------------------------------------

test("report-store: REPORT_STORE_BACKEND未設定時は既定でfilesystemバックエンドが使われる", async (t) => {
  const slug = "test-report-store-poc-default-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  delete process.env.REPORT_STORE_BACKEND; // 既存環境に設定されていないことを前提にする

  const report = sampleReport();
  await store.saveReport(slug, report);

  // filesystem-backend.jsが実際にOUTPUT_DIR配下へ書いたことを直接確認する
  // （report-store.jsがS3等へ誤って書いていないことの証明）。
  const filePath = path.join(OUTPUT_DIR, slug, "report.json");
  assert.ok(fs.existsSync(filePath), "既定バックエンドはfilesystemであり、OUTPUT_DIR配下にファイルが作られるはず");
  const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.id, report.id);

  const loaded = await store.loadReport(slug);
  assert.deepEqual(loaded, report);
});

test("report-store: 未知のREPORT_STORE_BACKENDは例外を投げる", async (t) => {
  process.env.REPORT_STORE_BACKEND = "dynamodb";
  t.after(() => delete process.env.REPORT_STORE_BACKEND);
  await assert.rejects(
    () => store.loadReport("test-report-store-poc-unknown-backend"),
    /未知のREPORT_STORE_BACKEND/
  );
});

test("report-store: REPORT_STORE_BACKEND=s3だが必須環境変数未設定の場合は例外を投げる（AWSへ接続しない）", async (t) => {
  process.env.REPORT_STORE_BACKEND = "s3";
  const snap = { bucket: process.env.REPORT_STORE_S3_BUCKET, region: process.env.AWS_REGION };
  delete process.env.REPORT_STORE_S3_BUCKET;
  delete process.env.AWS_REGION;
  t.after(() => {
    delete process.env.REPORT_STORE_BACKEND;
    if (snap.bucket !== undefined) process.env.REPORT_STORE_S3_BUCKET = snap.bucket;
    if (snap.region !== undefined) process.env.AWS_REGION = snap.region;
  });

  await assert.rejects(
    () => store.loadReport("test-report-store-poc-s3-misconfigured"),
    /REPORT_STORE_S3_BUCKET/
  );
});

// ---------------------------------------------------------------------------
// filesystem backend（backends/filesystem-backend.js） — load
// ---------------------------------------------------------------------------

test("filesystem-backend(report): 存在しないslugはnullを返す", async () => {
  const result = await fsBackend.readReport("test-report-store-poc-nonexistent");
  assert.equal(result, null);
});

test("filesystem-backend(report): write → read の往復で内容が一致する", async (t) => {
  const slug = "test-report-store-poc-roundtrip";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const report = sampleReport();
  await fsBackend.writeReport(slug, report);
  const result = await fsBackend.readReport(slug);
  assert.deepEqual(result, report);
});

test("filesystem-backend(report): 複数slugを独立して読み書きできる", async (t) => {
  const slugA = "test-report-store-poc-multi-a";
  const slugB = "test-report-store-poc-multi-b";
  cleanupAll([slugA, slugB]);
  t.after(() => cleanupAll([slugA, slugB]));

  const reportA = sampleReport({ id: "generated-a" });
  const reportB = sampleReport({ id: "generated-b" });
  await fsBackend.writeReport(slugA, reportA);
  await fsBackend.writeReport(slugB, reportB);

  assert.deepEqual(await fsBackend.readReport(slugA), reportA);
  assert.deepEqual(await fsBackend.readReport(slugB), reportB);
});

test("filesystem-backend(report): 不正JSON（壊れたreport.json）は例外を投げる", async (t) => {
  const slug = "test-report-store-poc-broken-json";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  fs.mkdirSync(path.join(OUTPUT_DIR, slug), { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, slug, "report.json"), "{ this is not valid json", "utf-8");

  // job-engine.jsのrunQualityCheck()の既存挙動（report.jsonが読めなければ例外を握りつぶさない）
  // と一致させるため、不正JSONはnullではなく例外にする（存在しない場合とは意図的に区別する）。
  await assert.rejects(() => fsBackend.readReport(slug));
});

test("filesystem-backend(report): 不正なcompany_slug（パストラバーサル試行）は例外を投げる", async () => {
  await assert.rejects(() => fsBackend.readReport("../../etc/passwd"));
  await assert.rejects(() => fsBackend.writeReport("..", sampleReport()));
});

test("filesystem-backend(report): OUTPUT_DIR配下に実在するreport.json（自作フィクスチャ）を正しく読める", async (t) => {
  // 既存データ（example.com等）には一切触れず、テスト専用slugの下に自分でreport.jsonを
  // 事前に配置してから読む（既存のwriteJson()を使い、report-store.js経由ではない手段で
  // 書いたファイルも、フォーマットが同一なので同じように読めることを示す）。
  const slug = "test-report-store-poc-preexisting";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const { writeJson } = require("../shared/json-file");
  const preexisting = sampleReport({ id: "generated-preexisting" });
  writeJson(path.join(OUTPUT_DIR, slug, "report.json"), preexisting);

  const result = await fsBackend.readReport(slug);
  assert.deepEqual(result, preexisting, "generate-company-report.js等が書いたファイルもそのまま読めるはず");
});

// ---------------------------------------------------------------------------
// filesystem backend — save
// ---------------------------------------------------------------------------

test("filesystem-backend(report): 新規保存でディレクトリが自動作成される", async (t) => {
  const slug = "test-report-store-poc-new-dir";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  assert.ok(!fs.existsSync(path.join(OUTPUT_DIR, slug)));
  await fsBackend.writeReport(slug, sampleReport());
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, slug, "report.json")));
});

test("filesystem-backend(report): 既存reportを上書きできる", async (t) => {
  const slug = "test-report-store-poc-overwrite";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  await fsBackend.writeReport(slug, sampleReport({ id: "generated-v1" }));
  await fsBackend.writeReport(slug, sampleReport({ id: "generated-v2" }));

  const result = await fsBackend.readReport(slug);
  assert.equal(result.id, "generated-v2");
});

test("filesystem-backend(report): 保存形式は既存writeJson()と同一（2スペースインデント+末尾改行）", async (t) => {
  const slug = "test-report-store-poc-format";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const report = sampleReport();
  await fsBackend.writeReport(slug, report);

  const raw = fs.readFileSync(path.join(OUTPUT_DIR, slug, "report.json"), "utf-8");
  assert.ok(raw.endsWith("\n"), "末尾改行が既存規約と一致するはず");
  assert.equal(raw, JSON.stringify(report, null, 2) + "\n");
});

// ---------------------------------------------------------------------------
// S3 backend（backends/s3-backend.js） — 実AWSへは一切接続しない
// company-context-store.test.js・test/review-store.test.jsと同じ、インメモリの
// 疑似S3クライアントに差し替えて検証する。
// ---------------------------------------------------------------------------

const S3_ENV_VARS = ["REPORT_STORE_S3_BUCKET", "REPORT_STORE_S3_PREFIX", "AWS_REGION"];

function snapshotEnv() {
  const snap = {};
  S3_ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}
function restoreEnv(snap) {
  S3_ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}
function withS3Config(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.REPORT_STORE_S3_BUCKET = overrides.bucket || "test-report-store-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.REPORT_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.REPORT_STORE_S3_PREFIX;
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

test("s3-backend(report): resolveConfig — REPORT_STORE_S3_BUCKET未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.REPORT_STORE_S3_BUCKET;
  assert.throws(() => s3Backend.resolveConfig(), /REPORT_STORE_S3_BUCKET/);
});

test("s3-backend(report): reportKey — <prefix><slug>.json というフラットなキーになる", () => {
  assert.equal(s3Backend.reportKey("example-com", "reports/"), "reports/example-com.json");
});

test("s3-backend(report): reportKeyのprefixデフォルトは\"reports/\"", async (t) => {
  withS3Config(t); // prefix未指定
  const client = createFakeS3Client();
  await s3Backend.writeReport("test-report-store-poc-s3-default-prefix", sampleReport(), { client });
  assert.deepEqual(Object.keys(client.objects), ["reports/test-report-store-poc-s3-default-prefix.json"]);
});

test("s3-backend(report): REPORT_STORE_S3_PREFIXを明示指定できる", async (t) => {
  withS3Config(t, { prefix: "test-reports/" });
  const client = createFakeS3Client();
  await s3Backend.writeReport("example-com", sampleReport(), { client });
  assert.deepEqual(Object.keys(client.objects), ["test-reports/example-com.json"]);
});

test("s3-backend(report): readReport — 存在しないキーはnullを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const result = await s3Backend.readReport("test-report-store-poc-s3-missing", { client });
  assert.equal(result, null);
});

test("s3-backend(report): writeReport → readReport の往復で内容が一致する（PutObjectはSSE-S3必須）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const report = sampleReport();

  await s3Backend.writeReport("test-report-store-poc-s3-roundtrip", report, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].input.ServerSideEncryption, "AES256");
  assert.equal(client.calls[0].input.ContentType, "application/json");

  const result = await s3Backend.readReport("test-report-store-poc-s3-roundtrip", { client });
  assert.deepEqual(result, report);
});

test("s3-backend(report): 保存形式はfilesystem backendと同一（2スペースインデント+末尾改行）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const report = sampleReport();
  await s3Backend.writeReport("test-report-store-poc-s3-format", report, { client });

  const raw = client.objects["reports/test-report-store-poc-s3-format.json"];
  assert.ok(raw.endsWith("\n"), "末尾改行がfilesystem backendと一致するはず");
  assert.equal(raw, JSON.stringify(report, null, 2) + "\n");
});

test("s3-backend(report): 同一slugへの再writeReportは上書きされる（company_context/review本体と同じ挙動）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const slug = "test-report-store-poc-s3-overwrite";

  const v1 = sampleReport({ id: "generated-v1" });
  await s3Backend.writeReport(slug, v1, { client });

  const v2 = sampleReport({ id: "generated-v2" });
  await s3Backend.writeReport(slug, v2, { client });

  const result = await s3Backend.readReport(slug, { client });
  assert.equal(result.id, "generated-v2");
  assert.deepEqual(result, v2);
});

test("s3-backend(report): 不正JSON（壊れたオブジェクト内容）はfilesystem backendと同じく例外を投げる", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client({
    objects: { "reports/test-report-store-poc-s3-broken-json.json": "{ this is not valid json" },
  });

  // filesystem backend（readJson()相当）と同じく、S3側もJSON.parse失敗時は例外を投げる
  // （存在しない場合＝null とは意図的に区別する。Phase B-3で確定した既存契約をS3でも維持）。
  await assert.rejects(() => s3Backend.readReport("test-report-store-poc-s3-broken-json", { client }));
});

test("s3-backend(report): storeはreportの内容を一切変更・加工しない（human_review/meta/evaluation等がそのまま往復する）", async (t) => {
  const slug = "test-report-store-poc-s3-no-mutation";
  withS3Config(t);
  // 【重要】withS3Config()はbucket/prefix/regionのみを設定する。store.saveReport()/
  // store.loadReport()という公開interface経由でS3 backendを使わせるには、
  // REPORT_STORE_BACKEND=s3自体も明示的に設定する必要がある（設定を忘れると、
  // getBackend()が既定のfilesystemへ静かにフォールバックし、{client}オプションが
  // 無視されたまま実OUTPUT_DIR配下に書き込まれてしまう。実際にこの取り違えで
  // filesystemへ書き込まれてしまう回帰が本テスト作成時に発生したため、
  // 明示的にbackendを設定した上で、念のためfilesystem側にも書き込みが漏れていないことを
  // 確認する）。
  process.env.REPORT_STORE_BACKEND = "s3";
  t.after(() => {
    delete process.env.REPORT_STORE_BACKEND;
    cleanupSlugDir(slug); // 万一filesystemへ漏れて書き込まれた場合の後始末（多層防御）
  });

  const client = createFakeS3Client();
  const report = sampleReport({
    human_review: { status: "approved", reviewer: "tester", reviewed_at: "2026-01-02T00:00:00.000Z" },
    evaluation: { score: 88, grade: "B", status: "PASS" },
    generated_at: "2026-01-01T00:00:00.000Z",
  });
  await store.saveReport(slug, report, { client });
  const loaded = await store.loadReport(slug, { client });

  assert.deepEqual(loaded.human_review, report.human_review);
  assert.deepEqual(loaded.evaluation, report.evaluation);
  assert.deepEqual(loaded.meta, report.meta);
  assert.equal(loaded.generated_at, report.generated_at);
  assert.ok(
    !fs.existsSync(path.join(OUTPUT_DIR, slug)),
    "REPORT_STORE_BACKEND=s3が正しく効いていれば、実OUTPUT_DIR配下には一切書き込まれないはず"
  );
});

test("s3-backend(report): read/write中にconsole.log/console.errorが一切呼ばれない", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const report = sampleReport();

  const originalLog = console.log;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(["log", args]);
  console.error = (...args) => calls.push(["error", args]);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await s3Backend.writeReport("test-report-store-poc-s3-no-log", report, { client });
  await s3Backend.readReport("test-report-store-poc-s3-no-log", { client });

  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// backend同値性: filesystem/store経由の同値性、およびfilesystem/S3(mock)間の同値性
// ---------------------------------------------------------------------------

test("backend同値性(report-store): store.saveReport()→store.loadReport()往復で元のreportと一致する", async (t) => {
  const slug = "test-report-store-poc-store-roundtrip";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const report = sampleReport({ id: "generated-store-roundtrip" });
  await store.saveReport(slug, report);
  const loaded = await store.loadReport(slug);

  assert.deepEqual(loaded, report);
  // store経由とbackend直接経由（fsBackend）でも同じ結果になることを確認する
  const viaBackend = await fsBackend.readReport(slug);
  assert.deepEqual(loaded, viaBackend);
});

test("backend同値性(report-store): 同じreportをfilesystem/S3(mock)双方に保存・取得しても同一の結果になる", async (t) => {
  const slug = "test-report-store-poc-cross-backend";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const report = sampleReport({ id: "generated-cross-backend" });

  await fsBackend.writeReport(slug, report);
  const fromFs = await fsBackend.readReport(slug);

  withS3Config(t);
  const client = createFakeS3Client();
  await s3Backend.writeReport(slug, report, { client });
  const fromS3 = await s3Backend.readReport(slug, { client });

  assert.deepEqual(fromFs, report);
  assert.deepEqual(fromS3, report);
  assert.deepEqual(fromFs, fromS3, "呼び出し側から見た結果はバックエンドに依らず同一であるはず");
});

test("report-store: storeはreportの内容を一切変更・加工しない（human_review/meta等がそのまま往復する）", async (t) => {
  const slug = "test-report-store-poc-no-mutation";
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  const report = sampleReport({
    human_review: { status: "approved", reviewer: "tester", reviewed_at: "2026-01-02T00:00:00.000Z" },
    evaluation: { score: 88, grade: "B", status: "PASS" },
  });
  await store.saveReport(slug, report);
  const loaded = await store.loadReport(slug);

  assert.deepEqual(loaded.human_review, report.human_review);
  assert.deepEqual(loaded.evaluation, report.evaluation);
  assert.deepEqual(loaded.meta, report.meta);
});
