/**
 * deploy-aor-web.test.js — scripts/generator/deploy-aor-web.js の自動テスト。
 *
 * 【変更点（PJ2 AOR Step③-A）】deploy-aor-web.jsはdry-runがデフォルトになった
 * （IAM/OIDCが未整備のため、実書き込みはconfig.execute===trueを明示した場合のみ）。
 * そのため、旧来の「実書き込み相当」のテストは全てconfig.execute:trueを明示する形に
 * 更新した（既存の検証内容自体は変えていない。DIで疑似S3Client/CloudFrontClientに
 * 差し替え、実AWSへは一切接続しない点も従来通り）。加えて、新しいデフォルト経路である
 * dry-run（AWS SDKクライアントを一切生成しない）自体のテストと、ホワイトリスト方式の
 * ファイル選定ロジック（isDeployableFile）のテストを追加した。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const path = require("path");
const os = require("os");

const {
  deployAorWeb,
  isDeployableFile,
  listDeployableFiles,
  buildDeployPlan,
  SOURCE_DIR,
  EXCLUDE_FILENAMES,
  ALLOWED_EXTENSIONS,
  reconcilePublishedReports,
  classifyPublishedArtifact,
  isProductionReportArtifact,
  RECONCILIATION_CLASS,
  RESERVED_TEST_DOMAIN_RE,
  isReservedTestDomain,
} = require("../deploy-aor-web");
const { checkPublicDataSafety } = require("../shared/public-data-safety-check");
const { writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");

// ===========================================================================
// Phase82 STEP2/3 → Phase84 STEP2 — ローカル実データ（本番 Published artifact）非依存化
// ===========================================================================
// website/aor/data/ には Git 管理下の fixture の他に、.gitignore 対象のローカル専用
// 本番 artifact（ab-i.jp / illegame.com / kscope.co.jp 等）が置かれうる。それらの存在・
// 鮮度（stale）・内容にテスト結果が左右されないよう、deployAorWeb() を呼ぶテストは
// 原則として options.sourceDir に makeTmpAorSite(t) の一時ディレクトリを渡す
// （Phase84 STEP1 の sourceDir DI。列挙・reconciliation・Public Data Safety・計画・
//  アップロードの全段階がその一時ディレクトリだけを見る）。
// 実 website/aor/data/ へは書き込まず、data/ の列挙を fs のグローバル差し替えで絞ることもしない
// （Phase82 の useCleanCheckoutView / assertOnlyTrackedData / FIXTURE_DEPLOY_FILES は Phase84 STEP2 で廃止）。

/** Git 管理下（website/aor/data/ に commit 済み）の非本番 fixture slug */
const TRACKED_NON_PRODUCTION_FIXTURES = [
  "company-01-manufacturing",
  "company-02-construction",
  "company-03-service",
  "e2e-task29-test.example.com",
  "e2e-test-company.example.com",
  "example.com",
  "phase15-test.example.com",
];

/** makeTmpAorSite() が作る公開対象ファイル（README.md は除外確認用のため含まない） */
const TMP_SITE_DEPLOYABLE_KEYS = [
  "index.html",
  "report-preview.html",
  "assets/js/report-preview.js",
  "assets/js/illustrations.js",
  ...TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `data/${s}.json`),
];

/**
 * 一時 sourceDir に、公開サイトの最小構成 + Git 管理下 fixture（実 data/ から読み取りのみで copy）を作る。
 * @param {import("node:test").TestContext} t
 * @param {{extraFiles?: Record<string,string>}} [opts] - sourceDir 相対パス → 内容
 * @returns {string} tmp sourceDir
 */
function makeTmpAorSite(t, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aor-site-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const files = {
    "index.html": "<!doctype html><title>tmp-site index</title>",
    "report-preview.html": "<!doctype html><title>tmp-site preview</title>",
    "assets/js/report-preview.js": "// tmp-site report-preview\n",
    "assets/js/illustrations.js": "// tmp-site illustrations\n",
    "README.md": "# tmp-site\n",
    ...(opts.extraFiles || {}),
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmp, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  TRACKED_NON_PRODUCTION_FIXTURES.forEach((s) =>
    fs.copyFileSync(path.join(SOURCE_DIR, "data", `${s}.json`), path.join(tmp, "data", `${s}.json`))
  );
  return tmp;
}

/** @returns {{send:Function, calls:Array<Object>}} */
function createFakeS3Client() {
  const calls = [];
  return {
    calls,
    send: async (command) => {
      calls.push(command);
      return {};
    },
  };
}

/** @returns {{send:Function, calls:Array<Object>}} */
function createFakeCloudFrontClient() {
  const calls = [];
  return {
    calls,
    send: async (command) => {
      calls.push(command);
      return { Invalidation: { Id: "IFAKE123" } };
    },
  };
}

test("deployAorWeb: config.execute未指定（デフォルト）はdry-runとなり、AWSクライアントを一切呼ばない", async (t) => {
  const tmp = makeTmpAorSite(t);
  // s3Client/cloudFrontClientをDIで渡していても、execute:trueでなければ一切使われないはず。
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000" },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.uploads.length > 0, "1件以上が公開対象として計画されるはず");
  assert.equal(s3Client.calls.length, 0, "dry-runではS3へ一切接続しないはず");
  assert.equal(cloudFrontClient.calls.length, 0, "dry-runではCloudFrontへ一切接続しないはず");
});

test("deployAorWeb: execute:trueの厳密booleanでない値（例: 文字列\"yes\"）はdry-run扱いのままとする（安全側のフェイルセーフ）", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: "yes" },
    { s3Client, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(s3Client.calls.length, 0, "execute:trueでない限りS3へは一切接続しないはず");
});

test("deployAorWeb: dry-run結果にはbucket/region/distributionIdと実行予定コマンドが含まれる", async (t) => {
  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000" },
    { sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.bucket, "test-aor-web-bucket");
  assert.equal(result.region, "ap-northeast-1");
  assert.equal(result.distributionId, "EFAKE000");
  assert.deepEqual(result.skipped, []);
  assert.ok(result.plannedCommands.some((c) => c.includes("aws s3 cp")));
  assert.ok(result.plannedCommands.some((c) => c.includes("aws cloudfront create-invalidation")));
});

test("deployAorWeb: distributionId未指定のdry-runではCloudFrontコマンドを計画に含めない", async (t) => {
  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1" }, { sourceDir: tmp });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.distributionId, undefined);
  assert.ok(!result.plannedCommands.some((c) => c.includes("cloudfront")));
});

test("deployAorWeb: execute:true時は既存website/aor/の公開対象ファイル（README.md除く）をアップロードする", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.ok(result.uploaded > 0, "1件以上アップロードされるはず");
  assert.equal(s3Client.calls.length, result.uploaded);

  const keys = s3Client.calls.map((c) => c.input.Key);
  assert.ok(!keys.includes("README.md"), "README.mdは除外されるはず");
  assert.ok(keys.includes("report-preview.html"), "report-preview.htmlは含まれるはず");
  assert.deepEqual(keys.slice().sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
});

test("deployAorWeb: execute:true時、全てのPutObjectCommandがSSE-S3(AES256)を指定する", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.ok(s3Client.calls.length > 0, "検証対象の PutObjectCommand が1件以上あるはず");
  s3Client.calls.forEach((call) => {
    assert.equal(call.input.ServerSideEncryption, "AES256");
  });
});

test("deployAorWeb: execute:true かつ distributionId指定時はCloudFront invalidationを1回だけ作成する", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000", execute: true },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.invalidationId, "IFAKE123");
  assert.equal(cloudFrontClient.calls.length, 1);
  assert.equal(cloudFrontClient.calls[0].input.DistributionId, "EFAKE000");
  assert.deepEqual(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items, ["/*"]);
});

test("deployAorWeb: execute:true かつ distributionId未指定時はCloudFrontを一切呼ばない", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );

  assert.equal(result.ok, true);
  assert.equal(result.invalidationId, undefined);
  assert.equal(cloudFrontClient.calls.length, 0);
});

test("deployAorWeb: セーフティチェックに失敗した場合はdry-run/execute問わず1件も対象にしない（安全側）", async (t) => {
  // 違反ありの側（dry-run/execute とも0件）は Phase84 sourceDir-2 / 2b で検証している。
  // ここでは違反の無い公開データ（Git 管理下 fixture のみの一時 sourceDir）が PASS し、計画が組まれることを確認する。
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1" }, { s3Client, sourceDir: tmp });
  assert.equal(result.ok, true, "既存の公開データは安全なはず（セーフティチェックPASS）");
  assert.ok(result.uploads.length > 0, "セーフティチェックがPASSした場合はdry-run計画に対象が含まれるはず");
});

test("deployAorWeb: execute:true時、listDeployableFiles()後にファイルが消失（ENOENT）してもデプロイ全体を失敗させず、そのファイルだけskippedに計上する", async (t) => {
  // 実運用でも起こりうる「列挙時点と読み込み時点のわずかなタイムラグの間に、別プロセスが
  // website/aor/を書き換えた」状況を、fs.readFileSyncを一時的にモック化して再現する
  // （PJ2 AOR Step③-Aレビューで発覚: 他のテストファイルがwebsite/aor/data/へ実際に
  // 一時ファイルを書き込み・削除するため、node --testの並行実行時にこのレースが
  // 実際に発生し、デプロイ全体がENOENTで失敗することを確認した）。
  // checkPublicDataSafety()が事前に全ファイルを読むため、対象ファイルへの1回目の
  // readFileSyncはそのまま通し、2回目（deployAorWeb本体のアップロードループでの読み込み）
  // だけをENOENTにして「列挙後に消えた」状況を再現する。
  const tmp = makeTmpAorSite(t);
  const targetPath = path.join(tmp, ...listDeployableFiles(tmp)[0].split("/"));
  let targetReadCount = 0;

  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
  fs.readFileSync = (...args) => {
    if (args[0] === targetPath) {
      targetReadCount += 1;
      if (targetReadCount === 2) {
        const err = new Error("ENOENT: no such file or directory");
        err.code = "ENOENT";
        throw err;
      }
    }
    return originalReadFileSync(...args);
  };

  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client, sourceDir: tmp }
  );

  assert.equal(result.ok, true, "1件のENOENTでデプロイ全体が失敗してはならない");
  assert.equal(result.skipped.length, 1);
  assert.ok(result.uploaded > 0, "消失した1件以外は正常にアップロードされるはず");
  assert.equal(s3Client.calls.length, result.uploaded);
  assert.equal(result.uploaded, TMP_SITE_DEPLOYABLE_KEYS.length - 1);
});

test("deployAorWeb: execute:true時、ENOENT以外のファイル読み込みエラーは握りつぶさずそのまま伝播する", async (t) => {
  const tmp = makeTmpAorSite(t); // fs.readFileSync を差し替える前に作る
  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
  fs.readFileSync = () => {
    throw new Error("EACCES: permission denied");
  };

  const s3Client = createFakeS3Client();
  await assert.rejects(
    () => deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true }, { s3Client, sourceDir: tmp }),
    /EACCES/
  );
});

// ===========================================================================
// Phase75 STEP4 — config.files による選択的デプロイ（指定ファイルのみ対象にする）
// ===========================================================================

test("deployAorWeb: config.files 指定時は指定ファイルのみが対象になる（dry-run）", async (t) => {
  const tmp = makeTmpAorSite(t);
  const files = ["report-preview.html", "assets/js/report-preview.js"];
  const result = await deployAorWeb({ bucket: "b", region: "r", files }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  const keys = result.uploads.map((u) => u.key).sort();
  assert.deepEqual(keys, files.slice().sort());
});

test("deployAorWeb: config.files に存在しない/対象外ファイルがあればnotFoundとして報告し、アップロード対象にしない", async (t) => {
  const tmp = makeTmpAorSite(t);
  const files = ["report-preview.html", "no-such-file.html", "README.md"];
  const result = await deployAorWeb({ bucket: "b", region: "r", files }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.deepEqual(result.uploads.map((u) => u.key), ["report-preview.html"]);
  assert.ok(result.notFound.includes("no-such-file.html"), "存在しないファイルはnotFound");
  assert.ok(result.notFound.includes("README.md"), "isDeployableFileがfalseのファイルもnotFound");
});

test("deployAorWeb: config.files 指定時、execute:true でも指定ファイルのみS3へアップロードする", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const files = ["report-preview.html", "assets/js/illustrations.js"];
  const result = await deployAorWeb({ bucket: "b", region: "r", execute: true, files }, { s3Client, sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.equal(result.uploaded, 2);
  const keys = s3Client.calls.map((c) => c.input.Key).sort();
  assert.deepEqual(keys, files.slice().sort());
});

test("deployAorWeb: config.files 指定時、CloudFront invalidationは/*ではなく指定ファイルのパスのみになる", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();
  const files = ["report-preview.html", "assets/js/illustrations.js"];
  const result = await deployAorWeb(
    { bucket: "b", region: "r", distributionId: "EFAKE000", execute: true, files },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );
  assert.equal(result.ok, true);
  assert.equal(cloudFrontClient.calls.length, 1);
  const items = cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items.slice().sort();
  assert.deepEqual(items, ["/assets/js/illustrations.js", "/report-preview.html"]);
  assert.equal(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Quantity, 2);
});

test("deployAorWeb: config.files 未指定時はCloudFront invalidationが従来どおり/*になる（後方互換）", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();
  const result = await deployAorWeb(
    { bucket: "b", region: "r", distributionId: "EFAKE000", execute: true },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );
  assert.deepEqual(result.ok, true);
  assert.deepEqual(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items, ["/*"]);
});

test("deployAorWeb: config.files 未指定時は従来どおり全公開対象ファイルが対象になる（後方互換）", async (t) => {
  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.deepEqual(result.notFound, []);
  assert.ok(result.uploads.length > 1, "filesを指定しなければ複数ファイルが対象のはず");
  // 全公開対象 = listDeployableFiles(sourceDir) の全件
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), listDeployableFiles(tmp).sort());
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
});

test("isDeployableFile: 許可拡張子（html/css/js/json）は対象になる", () => {
  assert.equal(isDeployableFile("report-preview.html"), true);
  assert.equal(isDeployableFile("assets/css/base.css"), true);
  assert.equal(isDeployableFile("assets/js/common.js"), true);
  assert.equal(isDeployableFile("data/example.com.json"), true);
});

test("isDeployableFile: README.mdは除外される", () => {
  assert.equal(isDeployableFile("README.md"), false);
});

test("isDeployableFile: 許可リストにない拡張子は対象外", () => {
  assert.equal(isDeployableFile("notes.txt"), false);
  assert.equal(isDeployableFile("archive.zip"), false);
});

test("isDeployableFile: 開発用・機密情報用のパスセグメントを含む場合は拡張子に関わらず対象外", () => {
  assert.equal(isDeployableFile("test/report-preview.html"), false);
  assert.equal(isDeployableFile("backup/data/example.com.json"), false);
  assert.equal(isDeployableFile("logs/app.js"), false);
  assert.equal(isDeployableFile(".git/config.json"), false);
  assert.equal(isDeployableFile("credentials/keys.json"), false);
});

test("listDeployableFiles: 実際のwebsite/aor/に対して実行してもエラーにならず、少なくとも1件返る", () => {
  const files = listDeployableFiles();
  assert.ok(Array.isArray(files));
  assert.ok(files.length > 0);
  assert.ok(files.every((f) => isDeployableFile(f)));
});

test("buildDeployPlan: sizeBytesとcontentTypeを含むuploads一覧を返す（AWSへは接続しない）", () => {
  const files = listDeployableFiles().slice(0, 1);
  const plan = buildDeployPlan({ bucket: "b", region: "r" }, files);
  assert.equal(plan.uploads.length, 1);
  assert.equal(plan.uploads[0].key, files[0]);
  assert.ok(plan.uploads[0].sizeBytes > 0);
  assert.ok(typeof plan.uploads[0].contentType === "string");
  assert.deepEqual(plan.skipped, []);
});

test("buildDeployPlan: 列挙後にファイルが消失（ENOENT）していても計画作成全体を失敗させず、そのファイルをskippedに計上する", () => {
  const plan = buildDeployPlan({ bucket: "b", region: "r" }, ["report-preview.html", "no-such-file.html"]);
  assert.equal(plan.uploads.length, 1);
  assert.equal(plan.uploads[0].key, "report-preview.html");
  assert.deepEqual(plan.skipped, ["no-such-file.html"]);
});

test("SOURCE_DIR は website/aor を指す", () => {
  assert.ok(SOURCE_DIR.replace(/\\/g, "/").endsWith("website/aor"));
});

test("EXCLUDE_FILENAMES には README.md が含まれる", () => {
  assert.ok(EXCLUDE_FILENAMES.has("README.md"));
});

test("ALLOWED_EXTENSIONS には .html/.css/.js/.json が含まれる", () => {
  [".html", ".css", ".js", ".json"].forEach((ext) => assert.ok(ALLOWED_EXTENSIONS.has(ext)));
});

// ===========================================================================
// Phase58 STEP4 — Deploy前 reconciliation gate
// ===========================================================================

/**
 * output/<slug>/{report.json, review.json} を一時的に用意する。
 * 既存の実データには触れないよう、必ず "test-recon-*" 系の slug を使うこと。
 * @param {string} slug
 * @param {{generatedAt?:string, evaluationStatus?:string, review?:"none"|"approved"|"rejected"|"pending"}} opts
 */
function setupInternal(slug, opts = {}) {
  const dir = path.join(OUTPUT_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const report = {
    id: `generated-${slug}`,
    meta: { schema_version: "2.4", generated_at: opts.generatedAt || "2026-01-01T00:00:00.000Z" },
    evaluation: { score: 85, grade: "B", status: opts.evaluationStatus || "PASS", reasons: [], warnings: [], improvements: [] },
  };
  writeJson(path.join(dir, "report.json"), report);

  const mode = opts.review || "approved";
  if (mode !== "none") {
    let review = engine.createEmptyReview(report.id);
    if (mode === "approved") {
      review = engine.approve(review, { reviewer: "tester" });
      // freshness を明示的に固定したい場合
      if (opts.reviewedAt) review = { ...review, reviewed_at: opts.reviewedAt };
    } else if (mode === "rejected") {
      review = engine.reject(review, { reviewer: "tester", comment: "no" });
    } // "pending" は createEmptyReview のまま（ただし history を1件足して「未着手」と区別する）
    if (mode === "pending") review = { ...review, history: [{ at: "2026-01-01T00:00:00.000Z", actor: "gen", action: "submitted_for_review" }] };
    writeJson(path.join(OUTPUT_DIR, slug, "review.json"), review);
  }
  return report;
}

/** @param {string} slug */
function cleanupInternal(slug) {
  fs.rmSync(path.join(OUTPUT_DIR, slug), { recursive: true, force: true });
}

/**
 * 一時 sourceDir に data/<slug>.json（公開 artifact 相当）を作る。
 * @param {string} slug
 * @param {Object} [publishedOverride]
 * @returns {string} tmp sourceDir
 */
function makeTmpSourceWithPublished(slug, publishedOverride) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aor-recon-"));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  const published = publishedOverride || {
    id: `generated-${slug}`,
    meta: { schema_version: "2.4", generated_at: "2026-01-01T00:00:00.000Z", published_at: "2026-02-01T00:00:00.000Z" },
    company_profile: { name: slug },
    free_opportunity: { title: "x" },
    source_pages: [],
  };
  writeJson(path.join(tmp, "data", `${slug}.json`), published);
  return tmp;
}

test("isProductionReportArtifact: generated- 接頭辞かつ非予約ドメインのみ本番扱い", () => {
  assert.equal(isProductionReportArtifact("ab-i.jp", { id: "generated-ab-i.jp" }), true);
  assert.equal(isProductionReportArtifact("kscope.co.jp", { id: "generated-kscope.co.jp" }), true);
  // 手書きサンプル（id に generated- 接頭辞なし）
  assert.equal(isProductionReportArtifact("company-01-manufacturing", { id: "company-01" }), false);
  // 予約テストドメイン
  assert.equal(isProductionReportArtifact("example.com", { id: "generated-example.com" }), false);
  assert.equal(isProductionReportArtifact("e2e-task29-test.example.com", { id: "generated-e2e-task29-test.example.com" }), false);
  assert.equal(isProductionReportArtifact("phase15-test.example.com", { id: "generated-phase15-test.example.com" }), false);
  assert.equal(isProductionReportArtifact("foo.test", { id: "generated-foo.test" }), false);
  assert.equal(isProductionReportArtifact("foo.invalid", { id: "generated-foo.invalid" }), false);
  // id が無い / 壊れている
  assert.equal(isProductionReportArtifact("whatever.jp", null), false);
  assert.equal(isProductionReportArtifact("whatever.jp", {}), false);
});

test("RESERVED_TEST_DOMAIN_RE: RFC 2606 / IANA 予約ドメインにマッチする", () => {
  ["example.com", "sub.example.com", "example.net", "example.org", "x.example", "y.test", "z.invalid", "localhost"].forEach(
    (d) => assert.match(d, RESERVED_TEST_DOMAIN_RE)
  );
  ["ab-i.jp", "kscope.co.jp", "example.co.jp", "notexample.com"].forEach((d) =>
    assert.doesNotMatch(d, RESERVED_TEST_DOMAIN_RE)
  );
});

// Phase59 STEP4: isReservedTestDomain は RESERVED_TEST_DOMAIN_RE を .test() するだけの
// SSOT wrapper で、dashboard-aggregates.js の isOperationalReportSlug が呼び出す唯一の関数。
// export regression: RESERVED_TEST_DOMAIN_RE.test() と完全一致することを確認する。
test("isReservedTestDomain: RESERVED_TEST_DOMAIN_RE.test() と完全一致する（SSOT export regression）", () => {
  const domains = [
    "example.com",
    "sub.example.com",
    "example.net",
    "example.org",
    "x.example",
    "y.test",
    "z.invalid",
    "localhost",
    "ab-i.jp",
    "kscope.co.jp",
    "example.co.jp",
    "notexample.com",
  ];
  for (const d of domains) {
    assert.equal(isReservedTestDomain(d), RESERVED_TEST_DOMAIN_RE.test(d), `slug=${d}`);
  }
});

test("Test1: 正常（published + current report + approved review + eval PASS + fresh）→ DEPLOY_ELIGIBLE", async (t) => {
  const slug = "test-recon-eligible.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "approved", generatedAt: "2026-01-01T00:00:00.000Z" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, true);
  assert.equal(r.eligible.length, 1);
  assert.equal(r.eligible[0].slug, slug);
  assert.equal(r.stale.length, 0);
});

test("Test2: current report あり / review なし → STALE_UNAPPROVED（deploy blocked）", async (t) => {
  const slug = "test-recon-noreview.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "none" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale.length, 1);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_UNAPPROVED);
});

test("Test2b: current report あり / review rejected → STALE_UNPUBLISHABLE", async (t) => {
  const slug = "test-recon-rejected.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "rejected" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_UNPUBLISHABLE);
});

test("Test2c: eval FAIL の current report → STALE_UNPUBLISHABLE", async (t) => {
  const slug = "test-recon-evalfail.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "approved", evaluationStatus: "FAIL" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_UNPUBLISHABLE);
});

test("Test3: published あり / current report なし → STALE_ORPHAN（deploy blocked）", async (t) => {
  const slug = "test-recon-orphan.corp";
  cleanupInternal(slug); // output/<slug>/ を作らない
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale.length, 1);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_ORPHAN);
});

test("Test4: review approved だが generated_at > reviewed_at → STALE_AFTER_REGENERATION", async (t) => {
  const slug = "test-recon-regen.corp";
  cleanupInternal(slug);
  // review を過去に固定し、report.generated_at をそれより後にする
  setupInternal(slug, { review: "approved", reviewedAt: "2026-01-01T00:00:00.000Z", generatedAt: "2026-06-01T00:00:00.000Z" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_AFTER_REGENERATION);
});

test("Test5: published artifact が無ければ reconciliation の対象にならない", async (t) => {
  const slug = "test-recon-nopublished.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "none" }); // internal は HOLD 状態だが…
  t.after(() => cleanupInternal(slug));

  // sourceDir に data/<slug>.json を置かない
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aor-recon-empty-"));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const r = await reconcilePublishedReports({ sourceDir: tmp });
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 0, "published artifact が無い slug は結果に含まれない");
});

// Phase82 STEP2: Test6 / 実 dry-run テストは、ローカルにしか存在しない本番 artifact（ab-i.jp 等、
// .gitignore 対象）の存在・鮮度に結果が左右されないよう、Git 管理下の fixture と
// テスト内で生成する合成 artifact のみを対象にする（TRACKED_NON_PRODUCTION_FIXTURES はファイル先頭で定義）。

test("Test6: 既存 fixture / sample / 予約テストドメインは reconciliation error にならない（SKIPPED_NON_PRODUCTION）", async (t) => {
  // Git 管理下の fixture（website/aor/data/ に commit 済み）が存在すること
  TRACKED_NON_PRODUCTION_FIXTURES.forEach((s) =>
    assert.ok(fs.existsSync(path.join(SOURCE_DIR, "data", `${s}.json`)), `${s}.json は Git 管理下 fixture として存在するはず`)
  );

  // fixture の実物を一時 sourceDir へ複製し、本番 artifact（合成・approved）を1件混在させる
  const slug = "test-recon-mixed.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "approved", generatedAt: "2026-01-01T00:00:00.000Z" });
  const tmp = makeTmpSourceWithPublished(slug);
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  TRACKED_NON_PRODUCTION_FIXTURES.forEach((s) =>
    fs.copyFileSync(path.join(SOURCE_DIR, "data", `${s}.json`), path.join(tmp, "data", `${s}.json`))
  );

  const r = await reconcilePublishedReports({ sourceDir: tmp });
  assert.equal(r.ok, true, "fixture と approved な本番 artifact のみなら stale ゼロのはず");
  // company-01/02/03・e2e-*・example.com・phase15-test は全て SKIPPED_NON_PRODUCTION
  const skippedSlugs = r.skipped.map((s) => s.slug);
  TRACKED_NON_PRODUCTION_FIXTURES.forEach((s) => assert.ok(skippedSlugs.includes(s), `${s} は SKIPPED_NON_PRODUCTION のはず`));
  // 本番 artifact は DEPLOY_ELIGIBLE
  assert.ok(r.eligible.some((e) => e.slug === slug), `${slug} は DEPLOY_ELIGIBLE のはず`);
});

test("classifyPublishedArtifact: STALE_UNREADABLE は壊れた Published JSON（sourceDir 経由）で発生する", async (t) => {
  const slug = "test-recon-broken.corp";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aor-recon-broken-"));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "data", `${slug}.json`), "{ this is not json", "utf-8");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const r = await reconcilePublishedReports({ relativeKeys: [`data/${slug}.json`], sourceDir: tmp });
  assert.equal(r.ok, false);
  assert.equal(r.stale[0].classification, RECONCILIATION_CLASS.STALE_UNREADABLE);
});

test("deployAorWeb: Git 管理下 fixture に対する dry-run は reconciliation を通過し（ok:true）、uploads を計画する", async (t) => {
  const tmp = makeTmpAorSite(t);
  const files = ["index.html", ...TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `data/${s}.json`)];
  const result = await deployAorWeb({ bucket: "b", region: "r", files }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.ok(result.dryRun);
  // reconciliation が実行されて uploads があること（既存挙動の regression 確認）
  assert.ok(result.uploads.length > 0);
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), [...files].sort());
  assert.deepEqual(result.notFound, []);
});

test("deployAorWeb: stale Published artifact があると dry-run/実行を問わず FAIL CLOSED（1件もアップロードしない）", async (t) => {
  const slug = "test-recon-deployblock.corp";
  cleanupInternal(slug);
  setupInternal(slug, { review: "none" }); // stale（review 無し）
  t.after(() => cleanupInternal(slug));
  // 本番 artifact 相当は一時 sourceDir にだけ置く（実 website/aor/data/ へは書き込まない）
  const tmp = makeTmpAorSite(t, {
    extraFiles: {
      [`data/${slug}.json`]: JSON.stringify({
        id: `generated-${slug}`,
        meta: { schema_version: "2.4", generated_at: "2026-01-01T00:00:00.000Z", published_at: "2026-02-01T00:00:00.000Z" },
        company_profile: { name: slug },
        free_opportunity: { title: "x" },
        source_pages: [],
      }),
    },
  });

  const s3Client = createFakeS3Client();
  // dry-run
  const dry = await deployAorWeb({ bucket: "b", region: "r" }, { s3Client, sourceDir: tmp });
  assert.equal(dry.ok, false, "stale 検出時は ok:false");
  assert.ok(dry.reconciliation && dry.reconciliation.stale.some((x) => x.slug === slug));
  assert.equal(dry.uploads, undefined, "dry-run 計画は組まれない");

  // execute:true でも同じ（FAIL CLOSED）
  const exec = await deployAorWeb({ bucket: "b", region: "r", execute: true }, { s3Client, sourceDir: tmp });
  assert.equal(exec.ok, false);
  assert.equal(s3Client.calls.length, 0, "1件も S3 へアップロードしないはず");
});

// ===========================================================================
// Phase84 STEP1 — options.sourceDir DI（Phase83 STEP3 案B）
// ===========================================================================
// deployAorWeb(config, { sourceDir }) で渡した一時ディレクトリだけを、列挙・reconciliation・
// Public Data Safety・dry-run 計画・アップロードの全段階で一貫して使うことを固定する。
// 実 website/aor/data/ へは書き込まない（実データ側の stale / safety NG artifact は
// injectIntoRealDataView() で fs の見え方だけを差し替えて再現する）。

/**
 * 実 website/aor/data/ に fileName が存在するかのように見せる（実ファイルは作らない）。
 * node --test は他テストファイルを並行実行するため、実 data/ へ safety NG ファイルを
 * 物理的に置くと public-data-safety-check.test.js 等を巻き込む。そのため readdirSync /
 * readFileSync の見え方だけを data/ 直下の当該1件について差し替え、テスト終了時に戻す。
 * @param {import("node:test").TestContext} t
 * @param {string} fileName
 * @param {string} content
 */
function injectIntoRealDataView(t, fileName, content) {
  const dataDir = path.resolve(SOURCE_DIR, "data");
  const fakePath = path.join(dataDir, fileName);
  const originalReaddirSync = fs.readdirSync;
  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readdirSync = originalReaddirSync;
    fs.readFileSync = originalReadFileSync;
  });
  fs.readdirSync = (dir, ...rest) => {
    const entries = originalReaddirSync(dir, ...rest);
    if (path.resolve(String(dir)) !== dataDir) return entries;
    const withTypes = rest[0] && typeof rest[0] === "object" && rest[0].withFileTypes;
    const fake = withTypes
      ? { name: fileName, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }
      : fileName;
    return [...entries, fake];
  };
  fs.readFileSync = (file, ...rest) => {
    if (typeof file === "string" && path.resolve(file) === fakePath) {
      const encoding = typeof rest[0] === "string" ? rest[0] : rest[0] && rest[0].encoding;
      return encoding ? content : Buffer.from(content, "utf-8");
    }
    return originalReadFileSync(file, ...rest);
  };
}

test("Phase84 sourceDir-1: options.sourceDir を渡すと sourceDir 配下の公開対象のみを列挙し、dry-run 計画も sourceDir を指す", async (t) => {
  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb({ bucket: "b", region: "r", distributionId: "EFAKE000" }, { sourceDir: tmp });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
  assert.deepEqual(result.notFound, []);
  assert.ok(result.plannedCommands.some((c) => c.includes(tmp)), "dry-run 表示コマンドは渡した sourceDir を指すはず");
  assert.ok(!result.plannedCommands.some((c) => c.includes(SOURCE_DIR)), "実 SOURCE_DIR を指してはならない");
});

test("Phase84 sourceDir-1b: execute:true でも sourceDir 配下のファイルを読んでアップロードする", async (t) => {
  const tmp = makeTmpAorSite(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb({ bucket: "b", region: "r", execute: true }, { s3Client, sourceDir: tmp });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(s3Client.calls.map((c) => c.input.Key).sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
  const indexCall = s3Client.calls.find((c) => c.input.Key === "index.html");
  assert.equal(indexCall.input.Body.toString("utf-8"), "<!doctype html><title>tmp-site index</title>");
});

test("Phase84 sourceDir-2: Public Data Safety は sourceDir 配下を検査し、違反があれば dry-run/execute 問わず1件も対象にしない", async (t) => {
  const tmp = makeTmpAorSite(t, {
    extraFiles: { "data/leaked.json": JSON.stringify({ lead_id: "abc123", company_profile: {} }) },
  });
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const dry = await deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: tmp });
  assert.equal(dry.ok, false);
  assert.deepEqual(dry.safetyProblems.map((p) => p.file.split(path.sep).join("/")), ["data/leaked.json"]);
  assert.equal(dry.uploads, undefined, "dry-run 計画は組まれない");

  const exec = await deployAorWeb(
    { bucket: "b", region: "r", distributionId: "EFAKE000", execute: true },
    { s3Client, cloudFrontClient, sourceDir: tmp }
  );
  assert.equal(exec.ok, false);
  assert.equal(s3Client.calls.length, 0);
  assert.equal(cloudFrontClient.calls.length, 0);
});

test("Phase84 sourceDir-2b: config.files の対象外ファイルに違反があっても停止する（検査範囲 ⊇ 公開範囲）", async (t) => {
  const tmp = makeTmpAorSite(t, { extraFiles: { ".env": "AWS_SECRET=dummy\n" } });
  const result = await deployAorWeb({ bucket: "b", region: "r", files: ["index.html"] }, { sourceDir: tmp });

  assert.equal(result.ok, false);
  assert.ok(result.safetyProblems.some((p) => p.file === ".env"), ".env は公開対象外でも検査対象のはず");
});

test("Phase84 sourceDir-3: Reconciliation は sourceDir 配下の Published artifact のみを対象にする", async (t) => {
  const slug = "test-recon-sourcedir-orphan.corp";
  cleanupInternal(slug); // output/<slug>/ を作らない → STALE_ORPHAN
  const tmp = makeTmpAorSite(t, {
    extraFiles: {
      [`data/${slug}.json`]: JSON.stringify({
        id: `generated-${slug}`,
        meta: { schema_version: "2.4", generated_at: "2026-01-01T00:00:00.000Z", published_at: "2026-02-01T00:00:00.000Z" },
        company_profile: { name: slug },
        free_opportunity: { title: "x" },
        source_pages: [],
      }),
    },
  });
  const s3Client = createFakeS3Client();

  const dry = await deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: tmp });
  assert.equal(dry.ok, false);
  assert.deepEqual(
    dry.reconciliation.stale.map((s) => [s.slug, s.classification]),
    [[slug, RECONCILIATION_CLASS.STALE_ORPHAN]]
  );
  const tmpDataKeys = new Set(fs.readdirSync(path.join(tmp, "data")).map((f) => `data/${f}`));
  dry.reconciliation.results.forEach((r) => assert.ok(tmpDataKeys.has(r.key), `${r.key} は sourceDir 配下のはず`));

  const exec = await deployAorWeb({ bucket: "b", region: "r", execute: true }, { s3Client, sourceDir: tmp });
  assert.equal(exec.ok, false);
  assert.equal(s3Client.calls.length, 0);
});

test("Phase84 sourceDir-4: 実 website/aor/data に stale artifact があっても、sourceDir 指定時は影響を受けず PASS", async (t) => {
  const slug = "test-recon-real-stale.corp";
  cleanupInternal(slug); // current report 無し → 実 data/ 側では STALE_ORPHAN
  injectIntoRealDataView(
    t,
    `${slug}.json`,
    JSON.stringify({ id: `generated-${slug}`, meta: { schema_version: "2.4" }, company_profile: { name: slug } })
  );
  // 前提: 実 SOURCE_DIR を見る既定経路なら、この stale artifact で reconciliation が失敗する
  const baseline = await reconcilePublishedReports();
  assert.ok(baseline.stale.some((s) => s.slug === slug), "前提: 実 data/ 側で stale として検出されるはず");

  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
});

test("Phase84 sourceDir-5: 実 website/aor/data に safety NG artifact があっても、sourceDir 指定時は影響を受けず PASS", async (t) => {
  injectIntoRealDataView(t, "phase84-real-leak.json", JSON.stringify({ lead_id: "abc123", company_profile: {} }));
  // 前提: 実 SOURCE_DIR を検査すれば safety NG になる
  const baseline = checkPublicDataSafety(SOURCE_DIR);
  assert.ok(
    baseline.problems.some((p) => p.file.split(path.sep).join("/") === "data/phase84-real-leak.json"),
    "前提: 実 data/ 側で safety NG として検出されるはず"
  );

  const tmp = makeTmpAorSite(t);
  const result = await deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: tmp });
  assert.equal(result.ok, true);
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), [...TMP_SITE_DEPLOYABLE_KEYS].sort());
});

test("Phase84 sourceDir-6: sourceDir 未指定なら従来どおり実 SOURCE_DIR を使う（後方互換）", async () => {
  // 実 data/ のローカル専用 artifact の有無・鮮度に依存しないよう、結果の内容（ok 等）ではなく
  // 「sourceDir 未指定」と「sourceDir: SOURCE_DIR 明示」が同一結果になることで既定値を固定する（読み取りのみ）。
  // config.files は Git 管理下の index.html に絞る（他テストファイルが並行実行中に実 data/ へ一時ファイルを
  // 書き込み・削除するため、全体走査のままだと2回の呼び出しの間で uploads/skipped がずれうる）。
  const config = { bucket: "b", region: "r", files: ["index.html"] };
  const byDefault = await deployAorWeb(config);
  const explicit = await deployAorWeb(config, { sourceDir: SOURCE_DIR });
  assert.deepEqual(byDefault, explicit);
  // 同上の理由で、並行書き込みの起こりうる data/ は比較から外す
  const nonData = (keys) => keys.filter((k) => !k.startsWith("data/")).sort();
  assert.deepEqual(nonData(listDeployableFiles(SOURCE_DIR)), nonData(listDeployableFiles()));
  if (byDefault.ok) {
    assert.ok(
      byDefault.plannedCommands.some((c) => c.includes(path.join(SOURCE_DIR, "index.html"))),
      "dry-run 表示コマンドは実 SOURCE_DIR を指すはず"
    );
  }
});

test("Phase84 sourceDir-7: 存在しない sourceDir は throw する（fail-closed、実 SOURCE_DIR へフォールバックしない）", async () => {
  const missing = path.join(os.tmpdir(), `aor-site-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(() => deployAorWeb({ bucket: "b", region: "r" }, { sourceDir: missing }), /ENOENT|存在しません/);
});
