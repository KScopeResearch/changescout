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
const { writeJson } = require("../shared/json-file");
const { OUTPUT_DIR } = require("../shared/paths");
const engine = require("../review/review-engine");

// ===========================================================================
// Phase82 STEP2/3 — ローカル実データ（本番 Published artifact）非依存化
// ===========================================================================
// website/aor/data/ には Git 管理下の fixture の他に、.gitignore 対象のローカル専用
// 本番 artifact（ab-i.jp / illegame.com / kscope.co.jp 等）が置かれうる。deployAorWeb() は
// 常に実 SOURCE_DIR を走査・reconciliation するため、それらの存在・鮮度（stale）に
// テスト結果が左右されないよう、実 SOURCE_DIR に対して deployAorWeb() を呼ぶテストでは
// useCleanCheckoutView(t) で data/ の列挙を Git 管理下 fixture のみに見せる
// （checkPublicDataSafety(SOURCE_DIR) は config.files に関係なく data/ 全体を走査するため、
//  config.files の指定だけでは実データ内容への依存が残る）。
//  - 選択方式に依存しない検証 → 加えて config.files に FIXTURE_DEPLOY_FILES を渡す
//  - config.files 未指定（全体走査・"/*" invalidation）経路そのものの検証 → config.files は渡さない

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

/** config.files 用: Git 管理下の公開対象ファイル（HTML/JS + 非本番 fixture JSON） */
const FIXTURE_DEPLOY_FILES = [
  "index.html",
  "report-preview.html",
  "assets/js/report-preview.js",
  ...TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `data/${s}.json`),
];

/**
 * website/aor/data/ の列挙結果を Git 管理下 fixture のみに絞って見せる（クリーンな
 * checkout 相当）。config.files 未指定経路（listDeployableFiles() による全体走査）を
 * ローカル専用の本番 artifact に依存せず検証するためのテスト専用ビュー。
 * 本体コード・checkPublicDataSafety の仕様には手を入れない（fs.readdirSync の戻り値を
 * data/ 直下についてのみフィルタし、テスト終了時に必ず元へ戻す）。
 * @param {import("node:test").TestContext} t
 */
function useCleanCheckoutView(t) {
  const dataDir = path.resolve(SOURCE_DIR, "data");
  const allowed = new Set(TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `${s}.json`));
  const originalReaddirSync = fs.readdirSync;
  t.after(() => {
    fs.readdirSync = originalReaddirSync;
  });
  fs.readdirSync = (dir, ...rest) => {
    const entries = originalReaddirSync(dir, ...rest);
    if (path.resolve(String(dir)) !== dataDir) return entries;
    return entries.filter((e) => allowed.has(typeof e === "string" ? e : e.name));
  };
}

/** @param {string[]} keys - 全 data/ キーが Git 管理下 fixture であること（本番 artifact を含まない） */
function assertOnlyTrackedData(keys) {
  const allowed = new Set(TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `data/${s}.json`));
  keys
    .filter((k) => k.startsWith("data/"))
    .forEach((k) => assert.ok(allowed.has(k), `${k} は Git 管理下 fixture ではない（ローカル実データに依存している）`));
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
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  // s3Client/cloudFrontClientをDIで渡していても、execute:trueでなければ一切使われないはず。
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000", files: FIXTURE_DEPLOY_FILES },
    { s3Client, cloudFrontClient }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.uploads.length > 0, "1件以上が公開対象として計画されるはず");
  assertOnlyTrackedData(result.uploads.map((u) => u.key));
  assert.equal(s3Client.calls.length, 0, "dry-runではS3へ一切接続しないはず");
  assert.equal(cloudFrontClient.calls.length, 0, "dry-runではCloudFrontへ一切接続しないはず");
});

test("deployAorWeb: execute:trueの厳密booleanでない値（例: 文字列\"yes\"）はdry-run扱いのままとする（安全側のフェイルセーフ）", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: "yes", files: FIXTURE_DEPLOY_FILES },
    { s3Client }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(s3Client.calls.length, 0, "execute:trueでない限りS3へは一切接続しないはず");
});

test("deployAorWeb: dry-run結果にはbucket/region/distributionIdと実行予定コマンドが含まれる", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const result = await deployAorWeb({
    bucket: "test-aor-web-bucket",
    region: "ap-northeast-1",
    distributionId: "EFAKE000",
    files: FIXTURE_DEPLOY_FILES,
  });

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
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1", files: FIXTURE_DEPLOY_FILES });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.distributionId, undefined);
  assert.ok(!result.plannedCommands.some((c) => c.includes("cloudfront")));
});

test("deployAorWeb: execute:true時は既存website/aor/の公開対象ファイル（README.md除く）をアップロードする", async (t) => {
  // config.files 未指定（全体走査）経路の検証。data/ は Git 管理下 fixture のみに見せる
  useCleanCheckoutView(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.ok(result.uploaded > 0, "1件以上アップロードされるはず");
  assert.equal(s3Client.calls.length, result.uploaded);

  const keys = s3Client.calls.map((c) => c.input.Key);
  assert.ok(!keys.includes("README.md"), "README.mdは除外されるはず");
  assert.ok(keys.includes("report-preview.html"), "report-preview.htmlは含まれるはず");
  assertOnlyTrackedData(keys);
});

test("deployAorWeb: execute:true時、全てのPutObjectCommandがSSE-S3(AES256)を指定する", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true, files: FIXTURE_DEPLOY_FILES },
    { s3Client }
  );

  assert.equal(result.ok, true);
  assert.ok(s3Client.calls.length > 0, "検証対象の PutObjectCommand が1件以上あるはず");
  s3Client.calls.forEach((call) => {
    assert.equal(call.input.ServerSideEncryption, "AES256");
  });
});

test("deployAorWeb: execute:true かつ distributionId指定時はCloudFront invalidationを1回だけ作成する", async (t) => {
  // config.files 未指定経路（"/*" invalidation）の検証。data/ は Git 管理下 fixture のみに見せる
  useCleanCheckoutView(t);
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000", execute: true },
    { s3Client, cloudFrontClient }
  );

  assert.equal(result.ok, true);
  assert.equal(result.invalidationId, "IFAKE123");
  assert.equal(cloudFrontClient.calls.length, 1);
  assert.equal(cloudFrontClient.calls[0].input.DistributionId, "EFAKE000");
  assert.deepEqual(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items, ["/*"]);
});

test("deployAorWeb: execute:true かつ distributionId未指定時はCloudFrontを一切呼ばない", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true, files: FIXTURE_DEPLOY_FILES },
    { s3Client, cloudFrontClient }
  );

  assert.equal(result.ok, true);
  assert.equal(result.invalidationId, undefined);
  assert.equal(cloudFrontClient.calls.length, 0);
});

test("deployAorWeb: セーフティチェックに失敗した場合はdry-run/execute問わず1件も対象にしない（安全側）", async (t) => {
  // checkPublicDataSafety(SOURCE_DIR) は config.files に関係なく全体を検査するため、
  // data/ を Git 管理下 fixture のみに見せて「既存の公開データ」をクリーンな checkout 相当に固定する
  useCleanCheckoutView(t);
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1" }, { s3Client });
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
  // config.files 未指定（listDeployableFiles() 全体走査）経路の検証。data/ は Git 管理下 fixture のみに見せる。
  useCleanCheckoutView(t);
  const targetPath = require("path").join(SOURCE_DIR, ...listDeployableFiles()[0].split("/"));
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
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true }, { s3Client });

  assert.equal(result.ok, true, "1件のENOENTでデプロイ全体が失敗してはならない");
  assert.equal(result.skipped.length, 1);
  assert.ok(result.uploaded > 0, "消失した1件以外は正常にアップロードされるはず");
  assert.equal(s3Client.calls.length, result.uploaded);
  assertOnlyTrackedData(s3Client.calls.map((c) => c.input.Key));
});

test("deployAorWeb: execute:true時、ENOENT以外のファイル読み込みエラーは握りつぶさずそのまま伝播する", async (t) => {
  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
  fs.readFileSync = () => {
    throw new Error("EACCES: permission denied");
  };

  const s3Client = createFakeS3Client();
  await assert.rejects(
    () =>
      deployAorWeb(
        { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true, files: FIXTURE_DEPLOY_FILES },
        { s3Client }
      ),
    /EACCES/
  );
});

// ===========================================================================
// Phase75 STEP4 — config.files による選択的デプロイ（指定ファイルのみ対象にする）
// ===========================================================================

test("deployAorWeb: config.files 指定時は指定ファイルのみが対象になる（dry-run）", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const files = ["report-preview.html", "assets/js/report-preview.js"];
  const result = await deployAorWeb({ bucket: "b", region: "r", files });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  const keys = result.uploads.map((u) => u.key).sort();
  assert.deepEqual(keys, files.slice().sort());
});

test("deployAorWeb: config.files に存在しない/対象外ファイルがあればnotFoundとして報告し、アップロード対象にしない", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const files = ["report-preview.html", "no-such-file.html", "README.md"];
  const result = await deployAorWeb({ bucket: "b", region: "r", files });
  assert.equal(result.ok, true);
  assert.deepEqual(result.uploads.map((u) => u.key), ["report-preview.html"]);
  assert.ok(result.notFound.includes("no-such-file.html"), "存在しないファイルはnotFound");
  assert.ok(result.notFound.includes("README.md"), "isDeployableFileがfalseのファイルもnotFound");
});

test("deployAorWeb: config.files 指定時、execute:true でも指定ファイルのみS3へアップロードする", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const s3Client = createFakeS3Client();
  const files = ["report-preview.html", "assets/js/illustrations.js"];
  const result = await deployAorWeb({ bucket: "b", region: "r", execute: true, files }, { s3Client });
  assert.equal(result.ok, true);
  assert.equal(result.uploaded, 2);
  const keys = s3Client.calls.map((c) => c.input.Key).sort();
  assert.deepEqual(keys, files.slice().sort());
});

test("deployAorWeb: config.files 指定時、CloudFront invalidationは/*ではなく指定ファイルのパスのみになる", async (t) => {
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();
  const files = ["report-preview.html", "assets/js/illustrations.js"];
  const result = await deployAorWeb(
    { bucket: "b", region: "r", distributionId: "EFAKE000", execute: true, files },
    { s3Client, cloudFrontClient }
  );
  assert.equal(result.ok, true);
  assert.equal(cloudFrontClient.calls.length, 1);
  const items = cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items.slice().sort();
  assert.deepEqual(items, ["/assets/js/illustrations.js", "/report-preview.html"]);
  assert.equal(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Quantity, 2);
});

test("deployAorWeb: config.files 未指定時はCloudFront invalidationが従来どおり/*になる（後方互換）", async (t) => {
  useCleanCheckoutView(t); // config.files 未指定経路の検証。data/ は Git 管理下 fixture のみに見せる
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();
  const result = await deployAorWeb(
    { bucket: "b", region: "r", distributionId: "EFAKE000", execute: true },
    { s3Client, cloudFrontClient }
  );
  assert.deepEqual(result.ok, true);
  assert.deepEqual(cloudFrontClient.calls[0].input.InvalidationBatch.Paths.Items, ["/*"]);
});

test("deployAorWeb: config.files 未指定時は従来どおり全公開対象ファイルが対象になる（後方互換）", async (t) => {
  useCleanCheckoutView(t); // config.files 未指定経路の検証。data/ は Git 管理下 fixture のみに見せる
  const result = await deployAorWeb({ bucket: "b", region: "r" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.notFound, []);
  assert.ok(result.uploads.length > 1, "filesを指定しなければ複数ファイルが対象のはず");
  // 全公開対象 = listDeployableFiles() の全件（クリーンな checkout 相当）
  assert.deepEqual(result.uploads.map((u) => u.key).sort(), listDeployableFiles().sort());
  assertOnlyTrackedData(result.uploads.map((u) => u.key));
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
  useCleanCheckoutView(t); // checkPublicDataSafety は config.files に関係なく data/ 全体を走査するため
  // 対象を config.files で Git 管理下のファイルに限定（ローカル専用の本番 artifact に依存しない）
  const files = ["index.html", ...TRACKED_NON_PRODUCTION_FIXTURES.map((s) => `data/${s}.json`)];
  const result = await deployAorWeb({ bucket: "b", region: "r", files });
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
  // 実 website/aor/data/ に一時的に本番 artifact 相当を置く（この test 内で必ず消す）
  const publishedPath = path.join(SOURCE_DIR, "data", `${slug}.json`);
  writeJson(publishedPath, {
    id: `generated-${slug}`,
    meta: { schema_version: "2.4", generated_at: "2026-01-01T00:00:00.000Z", published_at: "2026-02-01T00:00:00.000Z" },
    company_profile: { name: slug },
    free_opportunity: { title: "x" },
    source_pages: [],
  });
  t.after(() => {
    cleanupInternal(slug);
    fs.rmSync(publishedPath, { force: true });
  });

  const s3Client = createFakeS3Client();
  // dry-run
  const dry = await deployAorWeb({ bucket: "b", region: "r" }, { s3Client });
  assert.equal(dry.ok, false, "stale 検出時は ok:false");
  assert.ok(dry.reconciliation && dry.reconciliation.stale.some((x) => x.slug === slug));
  assert.equal(dry.uploads, undefined, "dry-run 計画は組まれない");

  // execute:true でも同じ（FAIL CLOSED）
  const exec = await deployAorWeb({ bucket: "b", region: "r", execute: true }, { s3Client });
  assert.equal(exec.ok, false);
  assert.equal(s3Client.calls.length, 0, "1件も S3 へアップロードしないはず");
});
