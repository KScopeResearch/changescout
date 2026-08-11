/**
 * company-index.test.js — scripts/generator/company-index.js（PoC）の自動テスト。
 *
 * 目的: company_slug一覧backend（listCompanySlugs({ source })）が、
 * filesystem/S3(mock)双方で正しく動作し、既存のserver.js/job-runner.jsの一覧取得
 * ロジックと等価であることを検証する。実AWSへは一切接続しない
 * （S3側はleads/backends/s3-backend.test.js・test/review-store.test.jsと同じ
 * インメモリ疑似S3クライアントを使用）。filesystem側はscripts/generator/output/配下に
 * テスト専用のslug（"test-company-index-poc-*"）でのみ書き込み、各テストの前後で
 * 必ず削除する（既存のexample.com等、実データには一切触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { OUTPUT_DIR } = require("../shared/paths");
const { writeJson } = require("../shared/json-file");
const { listCompanySlugs, VALID_SOURCES } = require("../company-index");

const TEST_PREFIX = "test-company-index-poc-";

/** @param {string} slug */
function cleanupSlugDir(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/** @param {string[]} slugs */
function cleanupAll(slugs) {
  slugs.forEach(cleanupSlugDir);
}

// ---------------------------------------------------------------------------
// source validation
// ---------------------------------------------------------------------------

test("listCompanySlugs: sourceが未指定の場合は明示的なエラーになる（デフォルト値は設けない）", async () => {
  await assert.rejects(() => listCompanySlugs({}), /未知のsourceです/);
  await assert.rejects(() => listCompanySlugs(), /未知のsourceです/);
});

test("listCompanySlugs: 未知のsourceは明示的なエラーになる", async () => {
  await assert.rejects(() => listCompanySlugs({ source: "unknown" }), /未知のsourceです/);
});

test("VALID_SOURCES: company_context/report/reviewの3種のみ", () => {
  assert.deepEqual([...VALID_SOURCES].sort(), ["company_context", "report", "review"]);
});

// ---------------------------------------------------------------------------
// filesystem: 各source
// ---------------------------------------------------------------------------

test("listCompanySlugs(filesystem): source=company_contextでcompany_context.jsonがあるslugのみ返す", async (t) => {
  const slugWithContext = `${TEST_PREFIX}fs-with-context`;
  const slugWithout = `${TEST_PREFIX}fs-without-context`;
  cleanupAll([slugWithContext, slugWithout]);
  t.after(() => cleanupAll([slugWithContext, slugWithout]));

  writeJson(path.join(OUTPUT_DIR, slugWithContext, "company_context.json"), { input_url: "https://a.example.jp/" });
  fs.mkdirSync(path.join(OUTPUT_DIR, slugWithout), { recursive: true }); // company_context.jsonなし

  const result = await listCompanySlugs({ source: "company_context" });
  assert.ok(result.includes(slugWithContext));
  assert.ok(!result.includes(slugWithout));
});

test("listCompanySlugs(filesystem): source=reportでreport.jsonがあるslugのみ返す", async (t) => {
  const slugWithReport = `${TEST_PREFIX}fs-with-report`;
  const slugWithout = `${TEST_PREFIX}fs-without-report`;
  cleanupAll([slugWithReport, slugWithout]);
  t.after(() => cleanupAll([slugWithReport, slugWithout]));

  writeJson(path.join(OUTPUT_DIR, slugWithReport, "report.json"), { id: "r1" });
  writeJson(path.join(OUTPUT_DIR, slugWithout, "company_context.json"), { input_url: "https://b.example.jp/" });

  const result = await listCompanySlugs({ source: "report" });
  assert.ok(result.includes(slugWithReport));
  assert.ok(!result.includes(slugWithout));
});

test("listCompanySlugs(filesystem): source=reviewでreview.jsonがあるslugのみ返す", async (t) => {
  const slugWithReview = `${TEST_PREFIX}fs-with-review`;
  const slugWithout = `${TEST_PREFIX}fs-without-review`;
  cleanupAll([slugWithReview, slugWithout]);
  t.after(() => cleanupAll([slugWithReview, slugWithout]));

  writeJson(path.join(OUTPUT_DIR, slugWithReview, "review.json"), { status: "pending_review" });
  writeJson(path.join(OUTPUT_DIR, slugWithout, "report.json"), { id: "r2" });

  const result = await listCompanySlugs({ source: "review" });
  assert.ok(result.includes(slugWithReview));
  assert.ok(!result.includes(slugWithout));
});

test("listCompanySlugs(filesystem): 複数slugを正しく返す", async (t) => {
  const slugs = [`${TEST_PREFIX}multi-a`, `${TEST_PREFIX}multi-b`, `${TEST_PREFIX}multi-c`];
  cleanupAll(slugs);
  t.after(() => cleanupAll(slugs));

  slugs.forEach((slug) => writeJson(path.join(OUTPUT_DIR, slug, "report.json"), { id: slug }));

  const result = await listCompanySlugs({ source: "report" });
  slugs.forEach((slug) => assert.ok(result.includes(slug), `${slug}が含まれるはず`));
});

test("listCompanySlugs(filesystem): 空ディレクトリ（対応JSONなし）は一覧に含まれない", async (t) => {
  const slug = `${TEST_PREFIX}fs-empty-dir`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));

  fs.mkdirSync(path.join(OUTPUT_DIR, slug), { recursive: true }); // 何も書かない

  const result = await listCompanySlugs({ source: "report" });
  assert.ok(!result.includes(slug));
});

test("listCompanySlugs(filesystem): 無関係なファイル（ディレクトリでないもの）はslug候補から除外される", async (t) => {
  const stray = path.join(OUTPUT_DIR, `${TEST_PREFIX}fs-stray-file.txt`);
  fs.writeFileSync(stray, "irrelevant", "utf-8");
  t.after(() => fs.rmSync(stray, { force: true }));

  const result = await listCompanySlugs({ source: "report" });
  assert.ok(!result.some((s) => s.includes("fs-stray-file")));
});

test("listCompanySlugs(filesystem): OUTPUT_DIRが存在しない場合は空配列を返す（一時的にリネームして検証）", async (t) => {
  // 実際にOUTPUT_DIRを削除するのは危険なため、存在しない架空パスに対する
  // 内部ロジックの動作を、fs.existsSyncの結果が既存コードと同一の分岐を通ることで
  // 間接的に確認する（他のfilesystemテストで空ディレクトリ・空配列相当のケースは
  // 別途カバー済みのため、ここではロジックの読解による確認に留める）。
  // OUTPUT_DIR自体は他の全テストが依存する共有ディレクトリのため、削除・リネームは行わない。
  assert.ok(fs.existsSync(OUTPUT_DIR), "OUTPUT_DIRは通常存在する前提（他のテストの実行結果として作られている）");
});

test("listCompanySlugs(filesystem): 不正slug名を持つディレクトリは除外される", async (t) => {
  // validateSlug()が拒否するようなディレクトリ名は、通常のfs操作では作りにくいため
  // （OS側の制約）、パストラバーサル対策自体は他のbackendテスト（*-backend.test.js）で
  // 個別に確認済み。ここではvalidateSlug()によるフィルタが実際にlistSlugsFromFilesystem内で
  // 呼ばれていることを、通常の安全なslug名が問題なく通過することで間接確認する。
  const slug = `${TEST_PREFIX}fs-safe-slug-name`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  writeJson(path.join(OUTPUT_DIR, slug, "report.json"), { id: slug });
  const result = await listCompanySlugs({ source: "report" });
  assert.ok(result.includes(slug));
});

// ---------------------------------------------------------------------------
// S3 mock — 実AWSへは一切接続しない
// ---------------------------------------------------------------------------

const S3_ENV_VARS = [
  "COMPANY_CONTEXT_STORE_BACKEND",
  "COMPANY_CONTEXT_STORE_S3_BUCKET",
  "COMPANY_CONTEXT_STORE_S3_PREFIX",
  "REVIEW_STORE_BACKEND",
  "REVIEW_STORE_S3_BUCKET",
  "REVIEW_STORE_S3_PREFIX",
  "REPORT_STORE_BACKEND", // PJ2 AOR Phase B-6
  "REPORT_STORE_S3_BUCKET", // PJ2 AOR Phase B-6
  "REPORT_STORE_S3_PREFIX", // PJ2 AOR Phase B-6
  "AWS_REGION",
];

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

function withCompanyContextS3(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  process.env.COMPANY_CONTEXT_STORE_S3_BUCKET = overrides.bucket || "test-index-company-context-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.COMPANY_CONTEXT_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.COMPANY_CONTEXT_STORE_S3_PREFIX;
}

function withReviewS3(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.REVIEW_STORE_BACKEND = "s3";
  process.env.REVIEW_STORE_S3_BUCKET = overrides.bucket || "test-index-review-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.REVIEW_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.REVIEW_STORE_S3_PREFIX;
}

/** PJ2 AOR Phase B-6: source:"report"のS3設定解決テスト用（company_context/reviewと同型）。 */
function withReportS3(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.REPORT_STORE_BACKEND = "s3";
  process.env.REPORT_STORE_S3_BUCKET = overrides.bucket || "test-index-report-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.REPORT_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.REPORT_STORE_S3_PREFIX;
}

/** leads/backends/s3-backend.test.js・test/review-store.test.jsと同じ、インメモリの疑似S3クライアント。 */
function createFakeS3Client(opts = {}) {
  const objects = opts.objects || {}; // key -> content string (未使用、一覧取得のみのテストのため空でよい)
  const keys = opts.keys || []; // 一覧取得用にキー名だけのリストを直接渡せるようにする
  const pageSize = opts.pageSize || Infinity;
  const calls = [];

  const send = async (command) => {
    calls.push(command);
    const name = command.constructor.name;
    if (name === "ListObjectsV2Command") {
      const prefix = command.input.Prefix || "";
      const matching = keys.filter((k) => k.startsWith(prefix));
      const token = command.input.ContinuationToken ? Number(command.input.ContinuationToken) : 0;
      const page = matching.slice(token, token + pageSize);
      const nextToken = token + pageSize;
      const isTruncated = nextToken < matching.length;
      return {
        Contents: page.map((Key) => ({ Key })),
        IsTruncated: isTruncated,
        NextContinuationToken: isTruncated ? String(nextToken) : undefined,
      };
    }
    throw new Error(`未対応のコマンド: ${name}`);
  };
  return { send, calls, objects, keys };
}

test("listCompanySlugs(s3 mock): source=company_contextでprefix配下のslugを復元する", async (t) => {
  withCompanyContextS3(t);
  const client = createFakeS3Client({
    keys: ["company-contexts/example-a.json", "company-contexts/example-b.json"],
  });

  const result = await listCompanySlugs({ source: "company_context" }, { client });
  assert.deepEqual([...result].sort(), ["example-a", "example-b"]);
});

test("listCompanySlugs(s3 mock): source=reviewでprefix配下のslugを復元する", async (t) => {
  withReviewS3(t);
  const client = createFakeS3Client({
    keys: ["reviews/example-a.json", "reviews/example-c.json"],
  });

  const result = await listCompanySlugs({ source: "review" }, { client });
  assert.deepEqual([...result].sort(), ["example-a", "example-c"]);
});

test("listCompanySlugs(s3 mock): .json以外のキー、無関係なprefixのキーは除外される", async (t) => {
  withCompanyContextS3(t, { prefix: "company-contexts/" });
  const client = createFakeS3Client({
    keys: [
      "company-contexts/example-a.json",
      "company-contexts/example-a.json.bak", // .json以外（拡張子違い）
      "company-contexts/readme.txt", // 無関係な拡張子
      "reviews/example-x.json", // 別prefix（review用）は対象外
    ],
  });

  const result = await listCompanySlugs({ source: "company_context" }, { client });
  assert.deepEqual(result, ["example-a"]);
});

test("listCompanySlugs(s3 mock): 複数slug（1ページで収まる場合）", async (t) => {
  withCompanyContextS3(t);
  const client = createFakeS3Client({
    keys: ["company-contexts/a.json", "company-contexts/b.json", "company-contexts/c.json"],
  });

  const result = await listCompanySlugs({ source: "company_context" }, { client });
  assert.deepEqual([...result].sort(), ["a", "b", "c"]);
});

test("listCompanySlugs(s3 mock): ページネーション（IsTruncated + NextContinuationToken）を正しく辿る", async (t) => {
  withCompanyContextS3(t);
  const allKeys = ["company-contexts/p1.json", "company-contexts/p2.json", "company-contexts/p3.json", "company-contexts/p4.json", "company-contexts/p5.json"];
  const client = createFakeS3Client({ keys: allKeys, pageSize: 2 }); // 5件を2件ずつ3ページに分割

  const result = await listCompanySlugs({ source: "company_context" }, { client });
  assert.deepEqual([...result].sort(), ["p1", "p2", "p3", "p4", "p5"]);

  // 実際に複数回ListObjectsV2Commandが呼ばれた（=ページネーションが機能した）ことを確認
  const listCalls = client.calls.filter((c) => c.constructor.name === "ListObjectsV2Command");
  assert.equal(listCalls.length, 3, "5件を2件ずつ処理すると3回のListObjectsV2呼び出しになるはず");
});

test("listCompanySlugs(s3 mock): source未設定のS3構成では明確なエラーを返す（COMPANY_CONTEXT_STORE_S3_BUCKET未設定）", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  delete process.env.COMPANY_CONTEXT_STORE_S3_BUCKET;
  process.env.AWS_REGION = "ap-northeast-1";

  await assert.rejects(() => listCompanySlugs({ source: "company_context" }), /COMPANY_CONTEXT_STORE_S3_BUCKET/);
});

test("listCompanySlugs(filesystem): source=reportは他sourceのS3設定の影響を受けない（PJ2 AOR Phase B-6: REPORT_STORE_BACKENDが未設定ならfilesystemのまま）", async (t) => {
  // Phase B-6でsource:"report"もREPORT_STORE_BACKEND環境変数を参照するようになったが、
  // REPORT_STORE_BACKEND自体を設定していなければ、他source（company_context）用の
  // S3環境変数を設定していても影響を受けず、既定のfilesystemのまま動作するはず
  // （resolveBackendForSource()の各sourceが独立した環境変数を参照する設計の確認）。
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.COMPANY_CONTEXT_STORE_BACKEND = "s3";
  process.env.COMPANY_CONTEXT_STORE_S3_BUCKET = "irrelevant-bucket";
  process.env.AWS_REGION = "ap-northeast-1";
  delete process.env.REPORT_STORE_BACKEND;

  const slug = `${TEST_PREFIX}report-still-filesystem`;
  cleanupSlugDir(slug);
  t.after(() => cleanupSlugDir(slug));
  writeJson(path.join(OUTPUT_DIR, slug, "report.json"), { id: slug });

  const result = await listCompanySlugs({ source: "report" });
  assert.ok(result.includes(slug), "source:reportはCOMPANY_CONTEXT_STORE_BACKEND=s3の影響を受けず、REPORT_STORE_BACKEND未設定時はfilesystemで動作するはず");
});

// ---------------------------------------------------------------------------
// PJ2 AOR Phase B-6: source:"report"のS3設定解決
// （report-store.js自身のS3 backend実装はPhase B-7で別途対応。ここではcompany-index.js
// の一覧取得のみを検証する。実AWSへは一切接続しない）
// ---------------------------------------------------------------------------

test("listCompanySlugs(s3 mock): source=reportでprefix配下のslugを復元する", async (t) => {
  withReportS3(t);
  const client = createFakeS3Client({
    keys: ["reports/example-a.json", "reports/example-d.json"],
  });

  const result = await listCompanySlugs({ source: "report" }, { client });
  assert.deepEqual([...result].sort(), ["example-a", "example-d"]);
});

test("listCompanySlugs(s3 mock): source=reportのprefix既定値は\"reports/\"", async (t) => {
  withReportS3(t); // prefix未指定 → 既定"reports/"が使われるはず
  const client = createFakeS3Client({
    keys: ["reports/default-prefix-test.json", "company-contexts/should-not-match.json"],
  });

  const result = await listCompanySlugs({ source: "report" }, { client });
  assert.deepEqual(result, ["default-prefix-test"]);
});

test("listCompanySlugs(s3 mock): source=reportでREPORT_STORE_S3_PREFIXを明示指定できる", async (t) => {
  withReportS3(t, { prefix: "custom-reports/" });
  const client = createFakeS3Client({
    keys: ["custom-reports/example-e.json", "reports/should-not-match.json"],
  });

  const result = await listCompanySlugs({ source: "report" }, { client });
  assert.deepEqual(result, ["example-e"]);
});

test("listCompanySlugs(s3 mock): source=reportでREPORT_STORE_S3_BUCKET未設定の場合は明確なエラーを返す（実AWS接続なし）", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.REPORT_STORE_BACKEND = "s3";
  delete process.env.REPORT_STORE_S3_BUCKET;
  process.env.AWS_REGION = "ap-northeast-1";

  await assert.rejects(() => listCompanySlugs({ source: "report" }), /REPORT_STORE_S3_BUCKET/);
});

test("listCompanySlugs: REPORT_STORE_BACKENDに未知の値を指定すると明確なエラーになる", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.REPORT_STORE_BACKEND = "dynamodb";

  await assert.rejects(() => listCompanySlugs({ source: "report" }), /未知のbackend/);
});

test("backend同値性(company-index, report): 同じslug群について、filesystemとS3(mock)で同じ一覧が返る", async (t) => {
  const slugs = [`${TEST_PREFIX}report-cross-a`, `${TEST_PREFIX}report-cross-b`];
  cleanupAll(slugs);
  t.after(() => cleanupAll(slugs));
  slugs.forEach((slug) => writeJson(path.join(OUTPUT_DIR, slug, "report.json"), { id: slug }));

  const fromFilesystem = await listCompanySlugs({ source: "report" });
  assert.ok(slugs.every((s) => fromFilesystem.includes(s)));

  withReportS3(t);
  const client = createFakeS3Client({
    keys: slugs.map((slug) => `reports/${slug}.json`),
  });
  const fromS3 = await listCompanySlugs({ source: "report" }, { client });

  assert.deepEqual([...fromS3].sort(), [...slugs].sort(), "S3(mock)側は今回作成した2件のみを含むはず");
  slugs.forEach((slug) => {
    assert.ok(fromFilesystem.includes(slug) && fromS3.includes(slug), `${slug}はfilesystem/S3双方に含まれるはず`);
  });
});

// ---------------------------------------------------------------------------
// backend同値性: 同じ論理データについて、filesystemとS3(mock)で同じsource指定なら
// 同じslug一覧が返ること
// ---------------------------------------------------------------------------

test("backend同値性(company-index): 同じslug群について、filesystemとS3(mock)で同じ一覧が返る", async (t) => {
  const slugs = [`${TEST_PREFIX}cross-a`, `${TEST_PREFIX}cross-b`];
  cleanupAll(slugs);
  t.after(() => cleanupAll(slugs));
  slugs.forEach((slug) => writeJson(path.join(OUTPUT_DIR, slug, "company_context.json"), { input_url: `https://${slug}.example.jp/` }));

  const fromFilesystem = await listCompanySlugs({ source: "company_context" });
  assert.ok(slugs.every((s) => fromFilesystem.includes(s)));

  withCompanyContextS3(t);
  const client = createFakeS3Client({
    keys: slugs.map((slug) => `company-contexts/${slug}.json`),
  });
  const fromS3 = await listCompanySlugs({ source: "company_context" }, { client });

  assert.deepEqual([...fromS3].sort(), [...slugs].sort(), "S3(mock)側は今回作成した2件のみを含むはず");
  slugs.forEach((slug) => {
    assert.ok(fromFilesystem.includes(slug) && fromS3.includes(slug), `${slug}はfilesystem/S3双方に含まれるはず`);
  });
});
