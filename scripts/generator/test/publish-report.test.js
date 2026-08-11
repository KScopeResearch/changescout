/**
 * publish-report.test.js — Task24: publish-report.jsの自動テスト。
 * Task25でパストラバーサル対策（validateSlug()）のテストを追加。
 *
 * scripts/generator/output/配下に一時的なテスト用会社ディレクトリを作り、
 * publishReport()の挙動（未承認は拒否・承認済みは公開・report.json/review.jsonを
 * 一切書き換えない）を確認する。テスト後は必ず一時ディレクトリ・公開先ファイルを
 * 削除する（既存のexample.com等、実データには触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { publishReport, isPublished, publishedPathFor, validateSlug, AOR_DATA_DIR } = require("../publish-report");
const { readJson, writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");
const reportStore = require("../report-store"); // PJ2 AOR: report backend接続（Phase B-4）のテストで使用

const FIXTURE_REPORT = readJson(path.join(__dirname, "..", "fixtures", "good.json"));

/** @param {string} slug @param {Object} [reviewOverride] */
function setupCompany(slug, reviewOverride) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug };
  writeJson(path.join(dir, "report.json"), report);
  if (reviewOverride) {
    writeJson(path.join(dir, "review.json"), reviewOverride);
  }
  return { dir, report };
}

/** @param {string} slug */
function cleanupCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  const published = publishedPathFor(slug);
  fs.rmSync(published, { force: true });
}

test("publishReport: review.jsonが無い（pending_review相当）場合は公開を拒否する", async () => {
  const slug = "test-publish-no-review";
  cleanupCompany(slug);
  setupCompany(slug);
  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, false);
    assert.match(result.error, /公開できません/);
    assert.equal(await isPublished(slug), false);
    assert.equal(fs.existsSync(publishedPathFor(slug)), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: needs_revisionの場合は公開を拒否する", async () => {
  const slug = "test-publish-needs-revision";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  review = engine.requestRevision(review, { reviewer: "tester", comment: "要修正" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);
  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("approved")));
    assert.equal(await isPublished(slug), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: 承認済み（approved）は公開に成功し、内容がそのままコピーされる", async () => {
  const slug = "test-publish-approved";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(await isPublished(slug), true);

    const published = readJson(result.publishedPath);
    assert.deepEqual(published, report, "公開されたJSONはreport.jsonの内容と完全に一致するはず（変換・加工しない）");
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: report.json・review.jsonを一切書き換えない", async () => {
  const slug = "test-publish-no-mutation";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const reportPath = path.join(OUTPUT_DIR, slug, "report.json");
  const reviewPath = path.join(OUTPUT_DIR, slug, "review.json");
  const reportBefore = fs.readFileSync(reportPath, "utf-8");
  const reviewBefore = fs.readFileSync(reviewPath, "utf-8");

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(reportPath, "utf-8"), reportBefore, "report.jsonが変更されてはならない");
    assert.equal(fs.readFileSync(reviewPath, "utf-8"), reviewBefore, "review.jsonが変更されてはならない");
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: evaluation.status===FAILの場合はreview.statusがapprovedでも公開を拒否する", async () => {
  const slug = "test-publish-eval-fail";
  cleanupCompany(slug);
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug, evaluation: { ...FIXTURE_REPORT.evaluation, status: "FAIL" } };
  writeJson(path.join(dir, "report.json"), report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(dir, "review.json"), review);

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("FAIL")));
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: 存在しないslugはエラーメッセージ付きで失敗する", async () => {
  const result = await publishReport("test-publish-does-not-exist-at-all");
  assert.equal(result.ok, false);
  assert.match(result.error, /report\.json/);
});

test("isPublished: 公開前はfalse、publishReport()成功後はtrue", async () => {
  const slug = "test-publish-isPublished-flag";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    assert.equal(await isPublished(slug), false);
    await publishReport(slug);
    assert.equal(await isPublished(slug), true);
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// PJ2 AOR: report backend接続（Phase B-4） — report.jsonの読み込みが
// report-store.js（loadReport）経由になっており、publish-report.jsが直接
// filesystemを読んでいないことを確認する
// ---------------------------------------------------------------------------

test("publishReport: report-store.js経由でreport.jsonを保存したcompanyも正しく公開できる", async () => {
  // setupCompany()は既存の他テストと同じくwriteJson()で直接fixtureを配置しているが、
  // このテストではあえてreportStore.saveReport()（report-store.js自身のAPI）で
  // report.jsonを書き込み、publishReport()が同じ物理ファイルを問題なく読めることを示す
  // （filesystem-backend.jsのパスがOUTPUT_DIR/<slug>/report.jsonと一致している証拠）。
  const slug = "test-publish-via-report-store";
  cleanupCompany(slug);
  const report = { ...FIXTURE_REPORT, id: slug };
  await reportStore.saveReport(slug, report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    const published = readJson(result.publishedPath);
    assert.deepEqual(published, report);
  } finally {
    cleanupCompany(slug);
  }
});

test("publishReport: report.jsonの読み込みはreport-store.jsのloadReport()経由で行われる（直接filesystem読み込みではない）", async () => {
  const slug = "test-publish-uses-report-store";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const originalLoadReport = reportStore.loadReport;
  const calls = [];
  reportStore.loadReport = async (...args) => {
    calls.push(args);
    return originalLoadReport(...args);
  };

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1, "publishReport()の内部でloadReport()が正確に1回呼ばれるはず");
    assert.equal(calls[0][0], slug, "loadReport()にslugがそのまま渡されるはず");
  } finally {
    reportStore.loadReport = originalLoadReport;
    cleanupCompany(slug);
  }
});

test("publishReport: 不正JSON（壊れたreport.json）は既存のreadJsonSafe()相当の挙動（見つからない扱い）を維持する", async () => {
  const slug = "test-publish-broken-report-json";
  cleanupCompany(slug);
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.json"), "{ this is not valid json", "utf-8");

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, false);
    assert.match(result.error, /report\.json/, "不正JSONも従来同様「見つかりません」相当のエラーになるはず");
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// パストラバーサル対策（Task25の本番公開前セキュリティ監査で発見・修正）
// ---------------------------------------------------------------------------

test("validateSlug: 正常なslug（英数字・ドット・ハイフン）はokを返す", () => {
  assert.equal(validateSlug("example.com").ok, true);
  assert.equal(validateSlug("company-01-manufacturing").ok, true);
  assert.equal(validateSlug("sakuraba-seimitsu.example.jp").ok, true);
});

test("validateSlug: 空文字・undefinedはNGを返す", () => {
  assert.equal(validateSlug("").ok, false);
  assert.equal(validateSlug(undefined).ok, false);
});

test("validateSlug: '..'を含むslugは形式・文字種に関わらずNGを返す", () => {
  const payloads = [
    "..",
    "../test",
    "..\\test",
    "..\\..\\Windows\\System32\\drivers\\etc\\hosts",
    "..%2ftest",
    "%2e%2e%2f",
  ];
  payloads.forEach((slug) => {
    assert.equal(validateSlug(slug).ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
  });
});

test("validateSlug: 絶対パス・スラッシュ・バックスラッシュを含むslugはNGを返す", () => {
  const payloads = ["/absolute/path", "C:\\Windows\\System32", "a/b", "a\\b"];
  payloads.forEach((slug) => {
    assert.equal(validateSlug(slug).ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
  });
});

test("publishReport: パストラバーサルを狙ったslugは、report.jsonの有無に関わらず拒否され、OUTPUT_DIR・AOR_DATA_DIR外へは一切アクセスしない", async () => {
  const maliciousSlugs = ["..\\..\\Windows\\System32\\drivers\\etc\\hosts", "../../../../etc/passwd", ".."];
  for (const slug of maliciousSlugs) {
    const result = await publishReport(slug);
    assert.equal(result.ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
    assert.match(result.error, /不正なslug/);
  }
});

test("publishReport: 公開先パスは常にAOR_DATA_DIR直下に収まる（正常系での再確認）", async () => {
  const slug = "test-publish-path-containment";
  cleanupCompany(slug);
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  try {
    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    const resolvedDir = path.dirname(path.resolve(result.publishedPath));
    assert.equal(resolvedDir, path.resolve(AOR_DATA_DIR));
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// PJ2 AOR Phase 3-D-1: published-store.js経由でのS3対応
// PUBLISHED_STORE_BACKEND=s3時、published storeがLambda側の公開判定に使う
// canonical stateとして正しく機能すること、かつ既存のローカルwebsite/aor/data/経路
// （deploy-aor-web.jsの同期元）が引き続き維持されることを確認する。
// 実AWSへは一切接続しない（company-context-store.test.js等と同じインメモリ疑似S3クライアント）。
// ---------------------------------------------------------------------------

const ENV_VARS = ["PUBLISHED_STORE_BACKEND", "PUBLISHED_STORE_S3_BUCKET", "PUBLISHED_STORE_S3_PREFIX", "AWS_REGION"];

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
function withS3PublishedStore(t) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.PUBLISHED_STORE_BACKEND = "s3";
  process.env.PUBLISHED_STORE_S3_BUCKET = "test-publish-report-published-bucket";
  process.env.AWS_REGION = "ap-northeast-1";
  delete process.env.PUBLISHED_STORE_S3_PREFIX;
}

/** published-store.test.jsと同じ、インメモリの疑似S3クライアント（Head/Delete対応込み）。 */
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
      if (!(command.input.Key in objects)) {
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

test("publishReport: PUBLISHED_STORE_BACKEND=s3時、公開に成功するとpublished store（S3）のcanonical stateもtrueになる", async (t) => {
  const slug = "test-publish-s3-canonical-state";
  cleanupCompany(slug);
  t.after(() => cleanupCompany(slug));
  withS3PublishedStore(t);

  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const client = createFakeS3Client();
  const result = await publishReport(slug, { client });
  assert.equal(result.ok, true);

  // canonical state（published-store.js経由、S3）がtrueになっているはず。
  assert.equal(await isPublished(slug, { client }), true);
  assert.ok(
    client.calls.some((c) => c.constructor.name === "PutObjectCommand"),
    "published store（S3）へも書き込まれているはず"
  );

  // 既存のローカルwebsite/aor/data/経路（deploy-aor-web.jsの同期元）もPUBLISHED_STORE_BACKENDの
  // 値に関わらず維持されているはず。
  assert.equal(fs.existsSync(publishedPathFor(slug)), true, "ローカル公開経路も引き続き維持されるはず");
  assert.deepEqual(readJson(publishedPathFor(slug)), report);
});

test("publishReport: PUBLISHED_STORE_BACKEND=s3時、published store（S3）側に書き込まれたキーは<prefix><slug>.jsonである", async (t) => {
  const slug = "test-publish-s3-key-naming";
  cleanupCompany(slug);
  t.after(() => cleanupCompany(slug));
  withS3PublishedStore(t);

  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const client = createFakeS3Client();
  await publishReport(slug, { client });

  assert.ok(Object.keys(client.objects).includes(`published/${slug}.json`));
});

test("publishReport: PUBLISHED_STORE_BACKEND未設定（既定filesystem）時は、published store側への書き込みは発生しない（二重I/O回避）", async () => {
  const slug = "test-publish-filesystem-no-double-write";
  cleanupCompany(slug);
  delete process.env.PUBLISHED_STORE_BACKEND;
  const { report } = setupCompany(slug);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);

  const client = createFakeS3Client();
  try {
    const result = await publishReport(slug, { client });
    assert.equal(result.ok, true);
    assert.equal(client.calls.length, 0, "filesystemバックエンド時はS3クライアントが一切呼ばれないはず");
  } finally {
    cleanupCompany(slug);
  }
});
