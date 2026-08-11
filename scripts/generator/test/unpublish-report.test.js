/**
 * unpublish-report.test.js — Task38: unpublish-report.jsの自動テスト。
 * publish-report.test.jsと同じ構成（scripts/generator/output/配下に一時ディレクトリを
 * 作り、テスト後は必ず削除する。既存のexample.com等、実データには触れない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { publishReport } = require("../publish-report");
const { unpublishReport, isPublished, publishedPathFor, AOR_DATA_DIR } = require("../unpublish-report");
const { readJson, writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");

const FIXTURE_REPORT = readJson(path.join(__dirname, "..", "fixtures", "good.json"));

/** @param {string} slug */
function setupApprovedCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = { ...FIXTURE_REPORT, id: slug };
  writeJson(path.join(dir, "report.json"), report);
  let review = engine.createEmptyReview(report.id);
  review = engine.approve(review, { reviewer: "tester" });
  writeJson(path.join(dir, "review.json"), review);
  return { dir, report };
}

/** @param {string} slug */
function cleanupCompany(slug) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(publishedPathFor(slug), { force: true });
}

test("unpublishReport: 公開済みのslugは取り消しに成功し、ファイルが削除される", async () => {
  const slug = "test-unpublish-published";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    await publishReport(slug);
    assert.equal(await isPublished(slug), true, "前提: 公開済みであること");

    const result = await unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyUnpublished, false);
    assert.equal(await isPublished(slug), false);
    assert.equal(fs.existsSync(publishedPathFor(slug)), false);
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: 未公開のslugに対しては冪等にok:true・alreadyUnpublished:trueを返す（エラーにしない）", async () => {
  const slug = "test-unpublish-not-published";
  cleanupCompany(slug);
  try {
    assert.equal(await isPublished(slug), false, "前提: 未公開であること");
    const result = await unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(result.alreadyUnpublished, true);
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: report.json・review.jsonを一切変更しない", async () => {
  const slug = "test-unpublish-no-mutation";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    await publishReport(slug);

    const reportPath = path.join(OUTPUT_DIR, slug, "report.json");
    const reviewPath = path.join(OUTPUT_DIR, slug, "review.json");
    const reportBefore = fs.readFileSync(reportPath, "utf-8");
    const reviewBefore = fs.readFileSync(reviewPath, "utf-8");

    const result = await unpublishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(reportPath, "utf-8"), reportBefore, "report.jsonが変更されてはならない");
    assert.equal(fs.readFileSync(reviewPath, "utf-8"), reviewBefore, "review.jsonが変更されてはならない");
  } finally {
    cleanupCompany(slug);
  }
});

test("unpublishReport: 取り消し後に再度publishReport()で公開できる", async () => {
  const slug = "test-unpublish-then-republish";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    await publishReport(slug);
    assert.equal(await isPublished(slug), true);

    await unpublishReport(slug);
    assert.equal(await isPublished(slug), false);

    const result = await publishReport(slug);
    assert.equal(result.ok, true);
    assert.equal(await isPublished(slug), true);
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// パストラバーサル対策（publish-report.jsのTask25対策をそのまま再利用していることの確認）
// ---------------------------------------------------------------------------

test("unpublishReport: パストラバーサルを狙ったslugは拒否され、AOR_DATA_DIR外へは一切アクセスしない", async () => {
  const maliciousSlugs = ["..\\..\\Windows\\System32\\drivers\\etc\\hosts", "../../../../etc/passwd", ".."];
  for (const slug of maliciousSlugs) {
    const result = await unpublishReport(slug);
    assert.equal(result.ok, false, `拒否されるべき: ${JSON.stringify(slug)}`);
    assert.match(result.error, /不正なslug/);
  }
});

test("unpublishReport: 取り消し対象パスは常にAOR_DATA_DIR直下に収まる（正常系での再確認）", async () => {
  const slug = "test-unpublish-path-containment";
  cleanupCompany(slug);
  setupApprovedCompany(slug);
  try {
    await publishReport(slug);
    const result = await unpublishReport(slug);
    assert.equal(result.ok, true);
    const resolvedDir = path.dirname(path.resolve(result.unpublishedPath));
    assert.equal(resolvedDir, path.resolve(AOR_DATA_DIR));
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// PJ2 AOR Phase 3-D-1: published-store.js経由でのS3対応
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
  process.env.PUBLISHED_STORE_S3_BUCKET = "test-unpublish-report-published-bucket";
  process.env.AWS_REGION = "ap-northeast-1";
  delete process.env.PUBLISHED_STORE_S3_PREFIX;
}

/** publish-report.test.jsと同じ、インメモリの疑似S3クライアント（Head/Delete対応込み）。 */
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

test("unpublishReport: PUBLISHED_STORE_BACKEND=s3時、取り消しに成功するとpublished store（S3）のcanonical stateもfalseになる", async (t) => {
  const slug = "test-unpublish-s3-canonical-state";
  cleanupCompany(slug);
  t.after(() => cleanupCompany(slug));
  withS3PublishedStore(t);
  setupApprovedCompany(slug);

  const client = createFakeS3Client();
  await publishReport(slug, { client });
  assert.equal(await isPublished(slug, { client }), true, "前提: published store（S3）でも公開済みであること");

  const result = await unpublishReport(slug, { client });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyUnpublished, false);
  assert.equal(await isPublished(slug, { client }), false, "published store（S3）のcanonical stateもfalseになるはず");

  // 既存のローカルwebsite/aor/data/経路（deploy-aor-web.jsの同期元）もPUBLISHED_STORE_BACKENDの
  // 値に関わらず削除されているはず。
  assert.equal(fs.existsSync(publishedPathFor(slug)), false, "ローカル公開経路も削除されるはず");
});

test("unpublishReport: PUBLISHED_STORE_BACKEND未設定（既定filesystem）時は、published store側への削除アクセスは発生しない（二重I/O回避）", async () => {
  const slug = "test-unpublish-filesystem-no-double-io";
  cleanupCompany(slug);
  delete process.env.PUBLISHED_STORE_BACKEND;
  setupApprovedCompany(slug);
  const client = createFakeS3Client();
  try {
    await publishReport(slug);
    const result = await unpublishReport(slug, { client });
    assert.equal(result.ok, true);
    assert.equal(client.calls.length, 0, "filesystemバックエンド時はS3クライアントが一切呼ばれないはず");
  } finally {
    cleanupCompany(slug);
  }
});

// ---------------------------------------------------------------------------
// Phase 11: local/published store（S3）間の不整合検出
// ---------------------------------------------------------------------------

/** HeadObjectCommandは成功する（対象が存在する）が、DeleteObjectCommandは常に失敗する疑似S3クライアント。 */
function createFailingDeleteS3Client() {
  const calls = [];
  const send = async (command) => {
    calls.push(command);
    if (command.constructor.name === "HeadObjectCommand") return {};
    if (command.constructor.name === "DeleteObjectCommand") {
      const err = new Error("Simulated S3 outage: DeleteObject failed");
      err.name = "InternalError";
      throw err;
    }
    return {};
  };
  return { send, calls };
}

test("unpublishReport: PUBLISHED_STORE_BACKEND=s3時、S3側の削除が失敗してもok:trueのまま返し、ローカル削除は成立させる", async (t) => {
  const slug = "test-unpublish-s3-sync-failure";
  cleanupCompany(slug);
  t.after(() => cleanupCompany(slug));
  withS3PublishedStore(t);
  setupApprovedCompany(slug);

  // 【重要】実AWSへは一切接続しない。publishReport()の下準備呼び出しにも必ず疑似
  // クライアントを渡す（withS3PublishedStore()がPUBLISHED_STORE_BACKEND=s3を設定する
  // ため、clientを渡し忘れると既定のS3Client経由で実AWSへ接続を試みてしまう）。
  const setupClient = createFakeS3Client();
  await publishReport(slug, { client: setupClient });

  const client = createFailingDeleteS3Client();
  const result = await unpublishReport(slug, { client });

  assert.equal(result.ok, true, "ローカル削除は成立しているため、S3同期失敗だけでok:falseにはしないはず");
  assert.ok(result.published_store_sync_error, "不整合を検出できるよう、published_store_sync_errorが含まれるはず");
  assert.match(result.published_store_sync_error, /Simulated S3 outage/);
  assert.equal(fs.existsSync(publishedPathFor(slug)), false, "ローカル公開経路は削除されているはず");
});
