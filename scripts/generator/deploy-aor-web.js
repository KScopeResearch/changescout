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
 * 【PJ2 AOR Step③-A時点の方針: dry-runがデフォルト】
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
 * 【Phase58 STEP4: Deploy前 reconciliation gate（Public Data Safety より前段）】
 * `website/aor/data/<slug>.json` が物理的に存在するだけで deploy 対象になっていたため、
 * 「current report が HOLD になった後も stale な Published artifact が公開されうる」
 * 構造的リスクがあった（Phase58 STEP3 監査）。`reconcilePublishedReports()` が deploy 前に、
 * 本番 Published Report artifact ごとに current な内部 report/review を突き合わせ、
 * `review-engine.js` の `isPublishable()`（Single Source of Truth）で公開可能状態かを
 * 検査する。1件でも stale/orphan（STALE_ORPHAN / STALE_UNAPPROVED / STALE_UNPUBLISHABLE /
 * STALE_AFTER_REGENERATION）を検出したら **FAIL CLOSED**（dry-run/実行を問わず deploy 全体を中止。
 * その1件だけ除外するのではなく全体を止める＝「deploy は成功した」と運用者に誤認させないため）。
 * 本番 artifact と fixture/sample の区別は既存の命名規約を利用する（`id` が `generated-` で
 * 始まる ＋ RFC 2606 / IANA 予約テストドメインでない）。`isPublished()` / `isPublishable()` の
 * semantic は変更しない。
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
const reportStore = require("./report-store"); // Phase58 STEP4: current 内部 report の取得（REPORT_STORE_BACKEND 尊重）
const reviewStore = require("./review/review-store"); // Phase58 STEP4: current 内部 review の取得（REVIEW_STORE_BACKEND 尊重）
const reviewEngine = require("./review/review-engine"); // Phase58 STEP4: isPublishable() を SSOT として再利用

const logger = createLogger("deploy-aor-web");

const SOURCE_DIR = path.join(__dirname, "..", "..", "website", "aor");

// Phase58 STEP4: Published Report artifact が置かれる SOURCE_DIR 相対のディレクトリ。
const PUBLISHED_DATA_DIR = "data";

// Phase58 STEP4: RFC 2606 / IANA が文書・テスト用に予約しているドメイン。
// これらを slug に持つ Published JSON は「本番 Published Report」ではなく e2e/サンプル用
// フィクスチャなので reconciliation の対象外とする（run-all-tests.js / classify-source.js の
// 既存コメントでも example.com 系を「予約テストドメイン」として明示的に扱っている）。
const RESERVED_TEST_DOMAIN_RE = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

// Phase59 STEP4: 「slug が RFC 2606 / IANA 予約テストドメインか」を判定する唯一の関数（SSOT）。
// isProductionReportArtifact() と dashboard-aggregates.js の isOperationalReportSlug() は、
// どちらも RESERVED_TEST_DOMAIN_RE を直接 .test() せず、この関数を経由する（重複実装しない）。
function isReservedTestDomain(slug) {
  return RESERVED_TEST_DOMAIN_RE.test(slug);
}

// Phase58 STEP4: reconciliation の分類ラベル。
const RECONCILIATION_CLASS = Object.freeze({
  DEPLOY_ELIGIBLE: "DEPLOY_ELIGIBLE",
  STALE_ORPHAN: "STALE_ORPHAN", // published あり / current report 無し
  STALE_UNAPPROVED: "STALE_UNAPPROVED", // published あり / current report あり / review 無し
  STALE_UNPUBLISHABLE: "STALE_UNPUBLISHABLE", // published あり / review あり / isPublishable false（承認/評価）
  STALE_AFTER_REGENERATION: "STALE_AFTER_REGENERATION", // published あり / review approved / freshness NG（承認後に再生成）
  STALE_UNREADABLE: "STALE_UNREADABLE", // published JSON をパースできない
  SKIPPED_NON_PRODUCTION: "SKIPPED_NON_PRODUCTION", // fixture / sample / 予約テストドメイン
});

// Phase58 STEP4: STALE_* は全て deploy を止める（FAIL CLOSED）。
const STALE_CLASSES = new Set([
  RECONCILIATION_CLASS.STALE_ORPHAN,
  RECONCILIATION_CLASS.STALE_UNAPPROVED,
  RECONCILIATION_CLASS.STALE_UNPUBLISHABLE,
  RECONCILIATION_CLASS.STALE_AFTER_REGENERATION,
  RECONCILIATION_CLASS.STALE_UNREADABLE,
]);

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
 * sourceDir配下から公開対象ファイルの一覧を、sourceDirからの相対パス（"/"区切り）で返す。
 * @param {string} [sourceDir] - Phase84 STEP1: 省略時 SOURCE_DIR
 * @returns {string[]}
 */
function listDeployableFiles(sourceDir = SOURCE_DIR) {
  return listFilesRecursive(sourceDir)
    .map((filePath) => path.relative(sourceDir, filePath).split(path.sep).join("/"))
    .filter(isDeployableFile);
}

/**
 * 実際にAWSへ接続せず、「何をアップロードするか」「どのコマンド相当の操作になるか」を
 * 組み立てるだけの関数。dry-run結果の構築ロジックをdeployAorWeb()から分離し、
 * テストしやすくする。
 * @param {{bucket:string, region:string, distributionId?:string}} config
 * @param {string[]} relativeKeys - listDeployableFiles()の結果
 * @param {string} [sourceDir] - Phase84 STEP1: 省略時 SOURCE_DIR（stat と dry-run 表示コマンドの両方に使う）
 * @returns {{uploads:Array<{key:string, contentType:string, sizeBytes:number}>, skipped:string[], plannedCommands:string[]}}
 */
function buildDeployPlan(config, relativeKeys, sourceDir = SOURCE_DIR) {
  const uploads = [];
  const skipped = [];
  for (const key of relativeKeys) {
    const absolutePath = path.join(sourceDir, ...key.split("/"));
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

  // Phase75 STEP4: config.files で絞り込んだ場合、dry-run表示のコマンド例も
  // 実際の挙動（ファイルごとのPutObject・指定パスのみinvalidate）に合わせる
  // （"/* を全体sync"のような誤解を招く表示を避ける）。
  const isSelective = Array.isArray(config.files);
  const plannedCommands = isSelective
    ? [
        `# ${uploads.length}件の指定ファイルのみを、ファイルごとにContentTypeとServerSideEncryption(AES256)を` +
          `指定したPutObjectで s3://${config.bucket}/ へ送信（概要コマンド例）:`,
        ...uploads.map(
          (u) => `aws s3 cp "${path.join(sourceDir, ...u.key.split("/"))}" "s3://${config.bucket}/${u.key}" --sse AES256 --region ${config.region}`
        ),
      ]
    : [
        `# ${uploads.length}件のファイルを website/aor/ から s3://${config.bucket}/ へ、` +
          `ファイルごとにContentTypeとServerSideEncryption(AES256)を指定したPutObjectで送信（概要コマンド例）:`,
        `aws s3 cp "${sourceDir}" "s3://${config.bucket}/" --recursive --sse AES256 --region ${config.region}`,
      ];
  if (config.distributionId) {
    const invalidationPaths = isSelective ? uploads.map((u) => `/${u.key}`) : ["/*"];
    plannedCommands.push(
      `aws cloudfront create-invalidation --distribution-id ${config.distributionId} --paths ${invalidationPaths.map((p) => `"${p}"`).join(" ")}`
    );
  }

  return { uploads, skipped, plannedCommands };
}

/**
 * Phase58 STEP4: `website/aor/data/<slug>.json` が「本番 Published Report artifact」か
 * （＝ reconciliation の対象にすべきか）を判定する。
 *
 * 既存の命名規約のみを使う（新しい metadata / schema は導入しない）:
 *   1. `id` が `generated-` で始まる … generate-company-report.js が付与する接頭辞。
 *      手書きサンプル（company-01 等、`id: "company-01"`）はこれを持たない。
 *   2. slug が RFC 2606 / IANA 予約テストドメインでない … e2e-*.example.com /
 *      example.com / phase15-test.example.com 等の e2e・サンプルを除外する。
 *
 * @param {string} slug
 * @param {Object|null} publishedJson - パース済みの website/aor/data/<slug>.json
 * @returns {boolean}
 */
function isProductionReportArtifact(slug, publishedJson) {
  const id = publishedJson && typeof publishedJson.id === "string" ? publishedJson.id : "";
  if (!id.startsWith("generated-")) return false;
  if (isReservedTestDomain(slug)) return false;
  return true;
}

/**
 * Phase58 STEP4: 1つの本番 Published Report artifact について、current な内部
 * report/review と突き合わせて分類する。判定は必ず `reviewEngine.isPublishable()` に委譲し、
 * reviewApproved / evaluationOk / freshness を再実装しない（Single Source of Truth）。
 *
 * **Published JSON 自身の human_review / evaluation / published_at は判定に使わない。**
 * 「old published = approved / current report = HOLD」を正しく検出するため、必ず
 * current の output/<slug>/{report,review}.json を SSOT とする。
 *
 * @param {string} slug
 * @param {{client?:Object}} [storeOptions] - report-store / review-store のテスト用 DI（省略可）
 * @returns {Promise<{slug:string, classification:string, publishable:boolean, reasons:string[], detail:?string}>}
 */
async function classifyPublishedArtifact(slug, storeOptions = {}) {
  const report = await reportStore.loadReport(slug, storeOptions);
  if (!report) {
    return {
      slug,
      classification: RECONCILIATION_CLASS.STALE_ORPHAN,
      publishable: false,
      reasons: [],
      detail: `current report が存在しません: output/${slug}/report.json`,
    };
  }

  // review-store は「未存在」でも createEmptyReview() を返す（既存契約）。
  // 未存在かどうかは createEmptyReview() と厳密一致するかで判定する（loadReview の実装契約そのもの）。
  const emptyReview = reviewEngine.createEmptyReview(report.id);
  const review = await reviewStore.loadReview(slug, report.id, storeOptions);
  const reviewAbsent = JSON.stringify(review) === JSON.stringify(emptyReview);
  if (reviewAbsent) {
    return {
      slug,
      classification: RECONCILIATION_CLASS.STALE_UNAPPROVED,
      publishable: false,
      reasons: [`current review が存在しません: output/${slug}/review.json`],
      detail: "レビュー未着手（review.json が無い）",
    };
  }

  const { publishable, reasons } = reviewEngine.isPublishable(review, report.evaluation || null, report);
  if (publishable) {
    return { slug, classification: RECONCILIATION_CLASS.DEPLOY_ELIGIBLE, publishable: true, reasons: [], detail: null };
  }

  // freshness 起因（承認後に report が再生成された等）は STALE_AFTER_REGENERATION として区別する
  // （review 自体は approved の場合のみ。未承認なら下の STALE_UNPUBLISHABLE 扱い）。
  const freshnessFailure = reasons.some((r) =>
    /より後です|再生成された可能性|日時形式が不正|日時として解釈できない|reviewed_atが記録されていない/.test(r)
  );
  if (freshnessFailure && review.status === "approved") {
    return {
      slug,
      classification: RECONCILIATION_CLASS.STALE_AFTER_REGENERATION,
      publishable: false,
      reasons,
      detail: reasons.join(" / "),
    };
  }

  return {
    slug,
    classification: RECONCILIATION_CLASS.STALE_UNPUBLISHABLE,
    publishable: false,
    reasons,
    detail: reasons.join(" / "),
  };
}

/**
 * Phase58 STEP4: deploy 対象に含まれる全 Published Report artifact
 * （`<sourceDir>/data/<slug>.json`）について reconciliation を実行する。
 *
 * @param {{relativeKeys?:string[], sourceDir?:string, storeOptions?:Object}} [input]
 *   - relativeKeys: listDeployableFiles() 相当（省略時は sourceDir を走査）
 *   - sourceDir: 省略時 SOURCE_DIR（テストで一時ディレクトリを渡す）
 *   - storeOptions: report-store / review-store の DI（省略可）
 * @returns {Promise<{ok:boolean, results:Array<Object>, stale:Array<Object>, eligible:Array<Object>, skipped:Array<Object>}>}
 */
async function reconcilePublishedReports(input = {}) {
  const sourceDir = input.sourceDir || SOURCE_DIR;
  const storeOptions = input.storeOptions || {};
  const dataDirPrefix = `${PUBLISHED_DATA_DIR}/`;

  let dataKeys;
  if (Array.isArray(input.relativeKeys)) {
    dataKeys = input.relativeKeys.filter(
      (k) => k.startsWith(dataDirPrefix) && k.toLowerCase().endsWith(".json")
    );
  } else {
    const dataDir = path.join(sourceDir, PUBLISHED_DATA_DIR);
    dataKeys = fs.existsSync(dataDir)
      ? listFilesRecursive(dataDir)
          .map((p) => `${PUBLISHED_DATA_DIR}/${path.relative(dataDir, p).split(path.sep).join("/")}`)
          .filter((k) => k.toLowerCase().endsWith(".json"))
      : [];
  }

  const results = [];
  for (const key of dataKeys) {
    const slug = key.slice(dataDirPrefix.length).replace(/\.json$/i, "");
    const absPath = path.join(sourceDir, ...key.split("/"));

    let raw;
    try {
      raw = fs.readFileSync(absPath, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") continue; // 列挙後に消えた（レース）→ deploy 側の ENOENT 処理に任せる
      throw err; // ENOENT 以外（権限エラー等）はデプロイ全体の異常としてそのまま伝播（deploy の既存方針と一致）
    }
    let publishedJson;
    try {
      publishedJson = JSON.parse(raw);
    } catch (err) {
      // JSON として壊れている Published artifact は、それ自体 deploy すべきでない → stale 扱い。
      results.push({
        slug,
        key,
        classification: RECONCILIATION_CLASS.STALE_UNREADABLE,
        publishable: false,
        reasons: [],
        detail: `Published JSON をパースできません: ${err.message}`,
      });
      continue;
    }

    if (!isProductionReportArtifact(slug, publishedJson)) {
      results.push({
        slug,
        key,
        classification: RECONCILIATION_CLASS.SKIPPED_NON_PRODUCTION,
        publishable: null,
        reasons: [],
        detail: "fixture / sample / 予約テストドメイン（reconciliation 対象外）",
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const classified = await classifyPublishedArtifact(slug, storeOptions);
    results.push({ ...classified, key });
  }

  const stale = results.filter((r) => STALE_CLASSES.has(r.classification));
  const eligible = results.filter((r) => r.classification === RECONCILIATION_CLASS.DEPLOY_ELIGIBLE);
  const skipped = results.filter((r) => r.classification === RECONCILIATION_CLASS.SKIPPED_NON_PRODUCTION);

  return { ok: stale.length === 0, results, stale, eligible, skipped };
}

/**
 * @param {{bucket:string, region:string, distributionId?:string, execute?:boolean}} config -
 *   execute:true を明示しない限りdry-run（AWS SDKクライアントを一切生成しない）。
 * @param {{s3Client?:Object, cloudFrontClient?:Object, storeOptions?:Object, sourceDir?:string}} [options] -
 *   execute:true 時に、テストでAWSクライアントを差し替えるためのDIフック。
 *   storeOptions は Phase58 STEP4 の reconciliation で report-store / review-store へ渡す DI。
 *   sourceDir は Phase84 STEP1: 省略時 SOURCE_DIR。テストで一時ディレクトリを渡すための DI フック。
 *   列挙・reconciliation・Public Data Safety・dry-run 計画・アップロードの全段階で同一の
 *   sourceDir を使う（safety は config.files に関係なく sourceDir 全体を検査する）。
 * @returns {Promise<Object>}
 */
/**
 * Phase75 STEP4: config.files（相対パスの配列）が指定された場合、公開対象を
 * その中で実際に deployable なファイルだけに絞り込む（isDeployableFile の
 * ホワイトリスト/除外セグメントは常に適用される＝ config.files 経由で
 * 拡張子制限や除外パスセグメントを迂回することはできない）。
 * @param {string[]} allKeys - listDeployableFiles() の結果
 * @param {string[]|undefined} files - config.files
 * @returns {{relativeKeys:string[], notFound:string[]}}
 */
function filterToRequestedFiles(allKeys, files) {
  if (!Array.isArray(files)) return { relativeKeys: allKeys, notFound: [] };
  const allowed = new Set(allKeys);
  const requested = new Set(files);
  return {
    relativeKeys: allKeys.filter((k) => requested.has(k)),
    notFound: files.filter((f) => !allowed.has(f)),
  };
}

async function deployAorWeb(config, options = {}) {
  const sourceDir = options.sourceDir || SOURCE_DIR;
  const { relativeKeys, notFound } = filterToRequestedFiles(listDeployableFiles(sourceDir), config.files);

  // Phase58 STEP4: Deploy前 reconciliation（Public Data Safety より前段。FAIL CLOSED）。
  // stale/orphan Published artifact を1件でも検出したら、dry-run / 実行を問わず deploy 全体を中止する
  // （その1件だけを除外するのではなく全体を止める＝「deploy は成功した」と運用者に誤認させないため）。
  const reconciliation = await reconcilePublishedReports({
    relativeKeys,
    sourceDir,
    storeOptions: options.storeOptions,
  });
  if (!reconciliation.ok) {
    logger.error(
      "Deploy前 reconciliation に失敗しました（stale/orphan な Published artifact を検出）。デプロイを中止します（1件も対象にしません）。",
      { stale: reconciliation.stale.map((s) => ({ slug: s.slug, classification: s.classification, detail: s.detail })) }
    );
    return { ok: false, reconciliation };
  }

  const safety = checkPublicDataSafety(sourceDir);
  if (!safety.ok) {
    logger.error("公開前セーフティチェックに失敗しました。デプロイを中止します（1件も対象にしません）。", {
      problems: safety.problems,
    });
    return { ok: false, safetyProblems: safety.problems };
  }

  if (config.execute !== true) {
    const plan = buildDeployPlan(config, relativeKeys, sourceDir);
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
      notFound,
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
    const absolutePath = path.join(sourceDir, ...key.split("/"));
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
    // Phase75 STEP4: config.files で対象を絞った場合は、そのデプロイ対象のパスのみを
    // invalidateする（"/*" は使わない）。config.files未指定時は従来どおり全体invalidate。
    const invalidationPaths = Array.isArray(config.files) ? relativeKeys.map((k) => "/" + k) : ["/*"];
    const cloudFrontClient = options.cloudFrontClient || new CloudFrontClient({ region: "us-east-1" });
    const result = await cloudFrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: config.distributionId,
        InvalidationBatch: {
          CallerReference: `deploy-aor-web-${Date.now()}`,
          Paths: { Quantity: invalidationPaths.length, Items: invalidationPaths },
        },
      })
    );
    invalidationId = result.Invalidation && result.Invalidation.Id;
    logger.info(`CloudFront invalidationを作成しました: ${invalidationId}`);
  }

  return { ok: true, dryRun: false, uploaded, skipped, notFound, invalidationId };
}

async function main() {
  const bucket = process.env.AOR_WEB_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const distributionId = process.env.AOR_WEB_CLOUDFRONT_DISTRIBUTION_ID || undefined;
  const execute = process.env.AOR_DEPLOY_EXECUTE === "yes";
  // Phase75 STEP4: AOR_DEPLOY_FILES（カンマ区切り、SOURCE_DIRからの相対パス）を指定した場合、
  // website/aor/ 全体ではなく指定ファイルのみをデプロイ対象にする（選択的デプロイ）。
  const files = process.env.AOR_DEPLOY_FILES
    ? process.env.AOR_DEPLOY_FILES.split(",").map((f) => f.trim()).filter(Boolean)
    : undefined;

  if (!bucket || !region) {
    console.error("使い方: AOR_WEB_S3_BUCKET=... AWS_REGION=... node scripts/generator/deploy-aor-web.js");
    console.error("        （実書き込みにはIAM整備後、AOR_DEPLOY_EXECUTE=yes を明示的に指定する）");
    console.error("        （特定ファイルのみ対象にするには AOR_DEPLOY_FILES=a.html,assets/js/b.js を指定する）");
    process.exitCode = 2;
    return;
  }

  const result = await deployAorWeb({ bucket, region, distributionId, execute, files });
  if (!result.ok) {
    if (result.reconciliation) {
      console.error("STALE PUBLISHED ARTIFACT DETECTED");
      console.error("");
      result.reconciliation.stale.forEach((s) => {
        console.error(`  slug: ${s.slug}`);
        console.error(`  published: website/aor/data/${s.slug}.json`);
        console.error(`  current report: scripts/generator/output/${s.slug}/report.json`);
        console.error(`  current publishable: false`);
        console.error(`  classification: ${s.classification}`);
        console.error(`  reason: ${s.detail || (s.reasons || []).join(" / ") || "-"}`);
        console.error("");
      });
      console.error("Deployment aborted.");
      console.error(
        "Unpublish the stale artifact (node scripts/generator/unpublish-report.js <slug>) " +
          "or publish an approved current report before deploying."
      );
      process.exitCode = 1;
      return;
    }
    console.error("デプロイを中止しました（セーフティチェック失敗）。詳細:");
    (result.safetyProblems || []).forEach((p) => {
      console.error(`  - ${p.file}: ${p.violations.join(", ")}`);
    });
    process.exitCode = 1;
    return;
  }

  if (result.notFound && result.notFound.length > 0) {
    console.warn(
      `AOR_DEPLOY_FILES に含まれるが公開対象にならなかったファイル: ${result.notFound.length}件: ${result.notFound.join(", ")}`
    );
  }

  if (result.dryRun) {
    console.log(`[dry-run] ${result.uploads.length}件のファイルが公開対象です。AWSへの書き込みは行っていません。`);
    result.uploads.forEach((u) => console.log(`[dry-run]   - ${u.key} (${u.contentType}, ${u.sizeBytes} bytes)`));
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
  // Phase58 STEP4: Deploy前 reconciliation gate
  reconcilePublishedReports,
  classifyPublishedArtifact,
  isProductionReportArtifact,
  RECONCILIATION_CLASS,
  RESERVED_TEST_DOMAIN_RE,
  // Phase59 STEP4: 予約テストドメイン判定の SSOT（dashboard-aggregates.js から共通利用）
  isReservedTestDomain,
};
