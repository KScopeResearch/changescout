/**
 * deploy-aor-web.test.js — scripts/generator/deploy-aor-web.js の自動テスト。
 *
 * 【変更点（PJ2 AOP Step③-A）】deploy-aor-web.jsはdry-runがデフォルトになった
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

const {
  deployAorWeb,
  isDeployableFile,
  listDeployableFiles,
  buildDeployPlan,
  SOURCE_DIR,
  EXCLUDE_FILENAMES,
  ALLOWED_EXTENSIONS,
} = require("../deploy-aor-web");

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

test("deployAorWeb: config.execute未指定（デフォルト）はdry-runとなり、AWSクライアントを一切呼ばない", async () => {
  // s3Client/cloudFrontClientをDIで渡していても、execute:trueでなければ一切使われないはず。
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", distributionId: "EFAKE000" },
    { s3Client, cloudFrontClient }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.uploads.length > 0, "1件以上が公開対象として計画されるはず");
  assert.equal(s3Client.calls.length, 0, "dry-runではS3へ一切接続しないはず");
  assert.equal(cloudFrontClient.calls.length, 0, "dry-runではCloudFrontへ一切接続しないはず");
});

test("deployAorWeb: execute:trueの厳密booleanでない値（例: 文字列\"yes\"）はdry-run扱いのままとする（安全側のフェイルセーフ）", async () => {
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: "yes" },
    { s3Client }
  );

  assert.equal(result.dryRun, true);
  assert.equal(s3Client.calls.length, 0, "execute:trueでない限りS3へは一切接続しないはず");
});

test("deployAorWeb: dry-run結果にはbucket/region/distributionIdと実行予定コマンドが含まれる", async () => {
  const result = await deployAorWeb({
    bucket: "test-aor-web-bucket",
    region: "ap-northeast-1",
    distributionId: "EFAKE000",
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.bucket, "test-aor-web-bucket");
  assert.equal(result.region, "ap-northeast-1");
  assert.equal(result.distributionId, "EFAKE000");
  assert.deepEqual(result.skipped, []);
  assert.ok(result.plannedCommands.some((c) => c.includes("aws s3 cp")));
  assert.ok(result.plannedCommands.some((c) => c.includes("aws cloudfront create-invalidation")));
});

test("deployAorWeb: distributionId未指定のdry-runではCloudFrontコマンドを計画に含めない", async () => {
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1" });

  assert.equal(result.dryRun, true);
  assert.equal(result.distributionId, undefined);
  assert.ok(!result.plannedCommands.some((c) => c.includes("cloudfront")));
});

test("deployAorWeb: execute:true時は既存website/aor/の公開対象ファイル（README.md除く）をアップロードする", async () => {
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
});

test("deployAorWeb: execute:true時、全てのPutObjectCommandがSSE-S3(AES256)を指定する", async () => {
  const s3Client = createFakeS3Client();
  await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true }, { s3Client });

  s3Client.calls.forEach((call) => {
    assert.equal(call.input.ServerSideEncryption, "AES256");
  });
});

test("deployAorWeb: execute:true かつ distributionId指定時はCloudFront invalidationを1回だけ作成する", async () => {
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

test("deployAorWeb: execute:true かつ distributionId未指定時はCloudFrontを一切呼ばない", async () => {
  const s3Client = createFakeS3Client();
  const cloudFrontClient = createFakeCloudFrontClient();

  const result = await deployAorWeb(
    { bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true },
    { s3Client, cloudFrontClient }
  );

  assert.equal(result.ok, true);
  assert.equal(result.invalidationId, undefined);
  assert.equal(cloudFrontClient.calls.length, 0);
});

test("deployAorWeb: セーフティチェックに失敗した場合はdry-run/execute問わず1件も対象にしない（安全側）", async () => {
  const s3Client = createFakeS3Client();
  const result = await deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1" }, { s3Client });
  assert.equal(result.ok, true, "既存の公開データは安全なはず（セーフティチェックPASS）");
  assert.ok(result.uploads.length > 0, "セーフティチェックがPASSした場合はdry-run計画に対象が含まれるはず");
});

test("deployAorWeb: execute:true時、listDeployableFiles()後にファイルが消失（ENOENT）してもデプロイ全体を失敗させず、そのファイルだけskippedに計上する", async (t) => {
  // 実運用でも起こりうる「列挙時点と読み込み時点のわずかなタイムラグの間に、別プロセスが
  // website/aor/を書き換えた」状況を、fs.readFileSyncを一時的にモック化して再現する
  // （PJ2 AOP Step③-Aレビューで発覚: 他のテストファイルがwebsite/aor/data/へ実際に
  // 一時ファイルを書き込み・削除するため、node --testの並行実行時にこのレースが
  // 実際に発生し、デプロイ全体がENOENTで失敗することを確認した）。
  // checkPublicDataSafety()が事前に全ファイルを読むため、対象ファイルへの1回目の
  // readFileSyncはそのまま通し、2回目（deployAorWeb本体のアップロードループでの読み込み）
  // だけをENOENTにして「列挙後に消えた」状況を再現する。
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
    () => deployAorWeb({ bucket: "test-aor-web-bucket", region: "ap-northeast-1", execute: true }, { s3Client }),
    /EACCES/
  );
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
