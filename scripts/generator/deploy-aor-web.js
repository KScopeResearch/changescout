#!/usr/bin/env node
/**
 * deploy-aor-web.js — website/aor/（受信者向け静的サイト）を公開用S3+CloudFrontへ
 * デプロイするCLI。
 *
 * 【背景】publish-report.js はレポートを`website/aor/data/<slug>.json`という
 * ローカルfilesystemへ書き込むだけで、実際の公開先（S3+CloudFront）への反映は
 * 別工程になっている。本ファイルはその反映を行う実体であり、`publish-report.js`
 * 自体は変更しない（責務を分離したまま、反映だけを担当する新しいCLIとして追加する）。
 *
 * 【PJ2 AOP Step③-A時点の方針: dry-runがデフォルト】
 * GitHub Actions用のOIDC Provider / IAM Roleがまだ存在せず、既存のPersona A
 * （pj2-aop-dev-sso）にもこの公開用バケット・CloudFrontへの権限が一切ないことを
 * 確認済み（IAM変更は別途の承認が必要、今回は行わない）。そのため本CLIは
 * `config.execute === true` を明示しない限り、AWS SDKクライアントを一切生成せず、
 * 何をアップロードするか・どのコマンド相当の操作になるかを表示するだけの
 * dry-runとして動作する（S3Client/CloudFrontClientのnewすら行わない＝
 * 認証情報が無い環境でもエラーにならず実行できる）。IAM整備後、
 * `AOR_DEPLOY_EXECUTE=yes` を明示的に指定した場合のみ実書き込みを行う。
 *
 * 【安全性】アップロード対象ファイルは、必ず`shared/public-data-safety-check.js`による
 * 検査を経てから初めて対象に含める。検査でLead識別子（lead_id/report_token）・
 * 実受信者email・内部notes・AWS認証情報らしきパターン・ブロックリスト名のファイルが
 * 1件でも見つかった場合、**dry-run/実実行を問わず即座に中止し、1件も対象にしない**
 * （部分的に古いデータが残る方が、個人情報や認証情報を漏らすより安全という判断）。
 *
 * 【デプロイ対象のホワイトリスト化】website/aor/ 配下を無条件にsyncするのではなく、
 * 受信者向けサイトを構成しうる拡張子（ALLOWED_EXTENSIONS）のみを対象とし、
 * 開発用ディレクトリ名らしきパスセグメント（EXCLUDED_PATH_SEGMENTS: .git/node_modules/
 * backup/logs/test/private/credential/secret/dev等）を含むファイルは、たとえ拡張子が
 * 許可リストに合致しても対象外とする（現在のwebsite/aor/には該当ディレクトリは
 * 存在しないが、将来の構成変更に対する多層防御として保持する）。
 *
 * 【既存資産の再利用】新しいS3クライアントは作らない。`@aws-sdk/client-s3`
 * （既存のleads/backends/s3-backend.jsと同じ依存）をそのまま使う。CloudFront
 * invalidationのみ`@aws-sdk/client-cloudfront`を新規に追加する（今回のデプロイ
 * 専用スコープに限定、プロジェクト全体のnpm依存ゼロ方針からの既存の例外運用を踏襲）。
 *
 * 【必要な環境変数】
 *   - AOR_WEB_S3_BUCKET（必須。公開用S3バケット名。Lead保存用バケットとは別物）
 *   - AWS_REGION（必須。既存のs3-backend.js/ses-client.jsと同じ環境変数を再利用）
 *   - AOR_WEB_CLOUDFRONT_DISTRIBUTION_ID（任意。指定時のみアップロード後にinvalidationを実行）
 *   - AOR_DEPLOY_EXECUTE=yes（任意。指定しない限りdry-run。実書き込みにはIAM整備後に明示指定する）
 *
 * 【認証情報】実実行時（execute:true）はAWS SDKの既定クレデンシャルチェーンに委ねる
 * （S3バックエンドと同じ設計。AWS_PROFILE経由でのSSO利用も、CI環境でのOIDC/環境変数
 * 利用もそのまま動く）。dry-run時は認証情報を一切参照しない。
 *
 * 使い方:
 *   # dry-run（デフォルト。AWSへは一切接続しない）
 *   AOR_WEB_S3_BUCKET=... AWS_REGION=ap-northeast-1 node scripts/generator/deploy-aor-web.js
 *
 *   # 実実行（IAM整備後、明示的にopt-inした場合のみ）
 *   AOR_DEPLOY_EXECUTE=yes AOR_WEB_S3_BUCKET=... AWS_REGION=ap-northeast-1 node scripts/generator/deploy-aor-web.js
 */

const fs = require("fs");
const path = require("path");

const { checkPublicDataSafety, listFilesRecursive } = require("./shared/public-data-safety-check");
const { createLogger } = require("./shared/logger");
const { runCli } = require("./shared/cli-utils");

const logger = createLogger("deploy-aor-web");

const SOURCE_DIR = path.join(__dirname, "..", "..", "website", "aor");

// デプロイ対象から除外するファイル（開発者向けドキュメントであり、受信者向けサイトの一部ではない）。
const EXCLUDE_FILENAMES = new Set(["README.md"]);

// 受信者向け静的サイトを構成しうる拡張子のみを公開対象とする（ホワイトリスト方式）。
// website/aor/配下を無条件にsyncする設計は取らない。
const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".gif",
  ".ico",
]);

// パスの各セグメントがこれらに一致した場合、拡張子が許可リストにあっても対象外とする
// （開発用・機密情報用ディレクトリの多層防御。現状のwebsite/aor/には該当なし）。
const EXCLUDED_PATH_SEGMENTS = [
  /^\.git$/i,
  /^node_modules$/i,
  /^backup$/i,
  /^logs?$/i,
  /^tests?$/i,
  /private/i,
  /credential/i,
  /secret/i,
  /^dev$/i,
  /^\.env/i,
];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

/** @param {string} filePath @returns {string} */
function resolveContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * SOURCE_DIRからの相対パスが公開対象として許可されるかどうかを判定する
 * （拡張子ホワイトリスト＋除外パスセグメント＋除外ファイル名の3条件）。
 * @param {string} relativePath - SOURCE_DIRからの相対パス（"/"区切り）
 * @returns {boolean}
 */
function isDeployableFile(relativePath) {
  const basename = path.basename(relativePath);
  if (EXCLUDE_FILENAMES.has(basename)) return false;

  const ext = path.extname(relativePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;

  const segments = relativePath.split("/");
  if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.some((pattern) => pattern.test(segment)))) return false;

  return true;
}

/**
 * SOURCE_DIR配下から公開対象ファイルの一覧を、SOURCE_DIRからの相対パス（"/"区切り）で返す。
 * @returns {string[]}
 */
function listDeployableFiles() {
  return listFilesRecursive(SOURCE_DIR)
    .map((filePath) => path.relative(SOURCE_DIR, filePath).split(path.sep).join("/"))
    .filter(isDeployableFile);
}

/**
 * 実際にAWSへ接続せず、「何をアップロードするか」「どのコマンド相当の操作になるか」を
 * 組み立てるだけの関数。dry-run結果の構築ロジックをdeployAorWeb()から分離し、
 * テストしやすくする。
 * @param {{bucket:string, region:string, distributionId?:string}} config
 * @param {string[]} relativeKeys - listDeployableFiles()の結果
 * @returns {{uploads:Array<{key:string, contentType:string, sizeBytes:number}>, skipped:string[], plannedCommands:string[]}}
 */
function buildDeployPlan(config, relativeKeys) {
  const uploads = [];
  const skipped = [];
  for (const key of relativeKeys) {
    const absolutePath = path.join(SOURCE_DIR, ...key.split("/"));
    let stat;
    try {
      // listDeployableFiles()での列挙後、statする前にファイルが削除された場合
      // （deployAorWeb()のexecute:trueパスと同じ理由によるレース）、その1件だけを
      // 計画から除外する。dry-runの目的は「今アップロードすればどうなるか」を示す
      // ことであり、消えたファイルを含めた計画を提示する意味がないため。
      stat = fs.statSync(absolutePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        skipped.push(key);
        continue;
      }
      throw err;
    }
    uploads.push({ key, contentType: resolveContentType(absolutePath), sizeBytes: stat.size });
  }

  const plannedCommands = [
    `# ${uploads.length}件のファイルを website/aor/ から s3://${config.bucket}/ へ、` +
      `ファイルごとにContentTypeとServerSideEncryption(AES256)を指定したPutObjectで送信（概要コマンド例）:`,
    `aws s3 cp "${SOURCE_DIR}" "s3://${config.bucket}/" --recursive --sse AES256 --region ${config.region}`,
  ];
  if (config.distributionId) {
    plannedCommands.push(
      `aws cloudfront create-invalidation --distribution-id ${config.distributionId} --paths "/*"`
    );
  }

  return { uploads, skipped, plannedCommands };
}

/**
 * @param {{bucket:string, region:string, distributionId?:string, execute?:boolean}} config -
 *   execute:true を明示しない限りdry-run（AWS SDKクライアントを一切生成しない）。
 * @param {{s3Client?:Object, cloudFrontClient?:Object}} [options] -
 *   execute:true 時に、テストでAWSクライアントを差し替えるためのDIフック。
 * @returns {Promise<Object>}
 */
async function deployAorWeb(config, options = {}) {
  const safety = checkPublicDataSafety(SOURCE_DIR);
  if (!safety.ok) {
    logger.error("公開前セーフティチェックに失敗しました。デプロイを中止します（1件も対象にしません）。", {
      problems: safety.problems,
    });
    return { ok: false, safetyProblems: safety.problems };
  }

  const relativeKeys = listDeployableFiles();

  if (config.execute !== true) {
    const plan = buildDeployPlan(config, relativeKeys);
    logger.info(
      `[dry-run] ${plan.uploads.length}件のファイルが公開対象です（AWSへは接続していません）。`,
      { bucket: config.bucket, region: config.region, distributionId: config.distributionId }
    );
    plan.uploads.forEach((u) => logger.info(`[dry-run] 対象: ${u.key} (${u.contentType}, ${u.sizeBytes} bytes)`));
    if (plan.skipped.length > 0) {
      logger.warn(`[dry-run] スキップ: ${plan.skipped.length}件（列挙後に消失）: ${plan.skipped.join(", ")}`);
    }
    plan.plannedCommands.forEach((cmd) => logger.info(`[dry-run] 実行予定コマンド相当: ${cmd}`));
    return {
      ok: true,
      dryRun: true,
      bucket: config.bucket,
      region: config.region,
      distributionId: config.distributionId,
      uploads: plan.uploads,
      skipped: plan.skipped,
      plannedCommands: plan.plannedCommands,
    };
  }

  // ここから先は execute:true が明示された場合のみ到達する（実AWS書き込み）。
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");

  const s3Client = options.s3Client || new S3Client({ region: config.region });

  let uploaded = 0;
  const skipped = [];
  for (const key of relativeKeys) {
    const absolutePath = path.join(SOURCE_DIR, ...key.split("/"));
    let body;
    try {
      // listDeployableFiles()での列挙とここでの読み込みの間に、他プロセス（例:
      // publish-report.jsの再実行）がファイルを削除・置き換えた場合、ENOENTで
      // デプロイ全体を失敗させるのではなく、そのファイルだけをスキップして続行する
      // （他の大多数のファイルは正常にアップロードされる方が、部分的な一時的競合で
      // デプロイ全体を止めるより安全という判断）。ENOENT以外（権限エラー等）は
      // デプロイ全体の異常として、そのまま呼び出し元へ伝播させる。
      body = fs.readFileSync(absolutePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        logger.warn(`スキップ: 列挙後にファイルが見つかりませんでした: ${key}`);
        skipped.push(key);
        continue;
      }
      throw err;
    }
    // eslint-disable-next-line no-await-in-loop
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: resolveContentType(absolutePath),
        ServerSideEncryption: "AES256",
      })
    );
    uploaded += 1;
    logger.info(`アップロード完了: ${key}`);
  }

  let invalidationId;
  if (config.distributionId) {
    const cloudFrontClient = options.cloudFrontClient || new CloudFrontClient({ region: "us-east-1" });
    const result = await cloudFrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: config.distributionId,
        InvalidationBatch: {
          CallerReference: `deploy-aor-web-${Date.now()}`,
          Paths: { Quantity: 1, Items: ["/*"] },
        },
      })
    );
    invalidationId = result.Invalidation && result.Invalidation.Id;
    logger.info(`CloudFront invalidationを作成しました: ${invalidationId}`);
  }

  return { ok: true, dryRun: false, uploaded, skipped, invalidationId };
}

async function main() {
  const bucket = process.env.AOR_WEB_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const distributionId = process.env.AOR_WEB_CLOUDFRONT_DISTRIBUTION_ID || undefined;
  const execute = process.env.AOR_DEPLOY_EXECUTE === "yes";

  if (!bucket || !region) {
    console.error("使い方: AOR_WEB_S3_BUCKET=... AWS_REGION=... node scripts/generator/deploy-aor-web.js");
    console.error("        （実書き込みにはIAM整備後、AOR_DEPLOY_EXECUTE=yes を明示的に指定する）");
    process.exitCode = 2;
    return;
  }

  const result = await deployAorWeb({ bucket, region, distributionId, execute });
  if (!result.ok) {
    console.error("デプロイを中止しました（セーフティチェック失敗）。詳細:");
    (result.safetyProblems || []).forEach((p) => {
      console.error(`  - ${p.file}: ${p.violations.join(", ")}`);
    });
    process.exitCode = 1;
    return;
  }

  if (result.dryRun) {
    console.log(`[dry-run] ${result.uploads.length}件のファイルが公開対象です。AWSへの書き込みは行っていません。`);
    if (result.skipped && result.skipped.length > 0) {
      console.log(`[dry-run] スキップ: ${result.skipped.length}件（列挙後に消失）: ${result.skipped.join(", ")}`);
    }
    console.log("[dry-run] 実実行するには AOR_DEPLOY_EXECUTE=yes を指定してください（IAM整備後）。");
    return;
  }

  console.log(`デプロイ完了: ${result.uploaded}件のファイルをアップロードしました。`);
  if (result.skipped && result.skipped.length > 0) {
    console.log(`スキップ: ${result.skipped.length}件（列挙後に消失）: ${result.skipped.join(", ")}`);
  }
  if (result.invalidationId) {
    console.log(`CloudFront invalidation: ${result.invalidationId}`);
  }
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  deployAorWeb,
  resolveContentType,
  isDeployableFile,
  listDeployableFiles,
  buildDeployPlan,
  SOURCE_DIR,
  EXCLUDE_FILENAMES,
  ALLOWED_EXTENSIONS,
  EXCLUDED_PATH_SEGMENTS,
};
