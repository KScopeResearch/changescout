/**
 * s3-backend.js — report-store.js（PJ2 AOR Phase B-7）のREPORT_STORE_BACKEND=s3時の
 * バックエンド。company-context-store/backends/s3-backend.js・review/backends/s3-backend.js
 * の設計をそのままreport.jsonへ横展開したもの。「1 report = 1 JSONファイル」という既存の
 * filesystem設計を、S3の「1 report = 1 オブジェクト」（<prefix><company_slug>.json）へ
 * 写像する。
 *
 * 【PoCスコープの注記】本番report.jsonをこのバックエンド経由でAWSへ書き込むことは
 * 今回のPhase B-7では一切行っていない。テストはすべてS3Clientをインメモリ疑似実装に
 * 差し替えて検証している（company-context-store/backends/s3-backend.test.js・
 * test/review-store.test.jsと同じ手法）。
 *
 * 【キー設計についての判断】company-context-store/backends/s3-backend.js・
 * review/backends/s3-backend.jsの`<prefix><company_slug>.json`というフラットな1階層の
 * キー設計をそのまま踏襲した（プロジェクト内に複数のキー設計パターンを持ち込まないため）。
 *
 * 【必須な環境変数】（COMPANY_CONTEXT_STORE_*・REVIEW_STORE_*と対称の命名だが、
 * 値は独立した別変数。company-index.jsのresolveS3ConfigForSource("report")が
 * 既にPhase B-6で参照している環境変数名と完全に一致させている）
 *   - REPORT_STORE_S3_BUCKET（必須。バケット名）
 *   - REPORT_STORE_S3_PREFIX（任意。既定"reports/"）
 *   - AWS_REGION（必須。他backendと同じ環境変数をそのまま再利用）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN（任意。
 *     未設定時はAWS SDKの既定クレデンシャルチェーンに委ねる）
 *
 * 【エラー処理】オブジェクトが存在しない場合（GetObjectCommandがNoSuchKeyを投げる）は
 * readReport()と同様nullを返す（report-store.jsのfilesystem backendと同じ既存契約と
 * 一致させる）。不正JSON（JSON.parseの失敗）は例外として呼び出し元へそのまま伝播させる
 * （filesystem backendがreadJson()で不正JSON時に例外を投げるのと同じ契約。S3 backend
 * だけ異なる挙動にしない）。それ以外のS3エラーも呼び出し元へそのまま例外として伝播させる。
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const { validateSlug } = require("../../shared/path-safety");

const DEFAULT_PREFIX = "reports/";

/** @returns {{bucket:string, prefix:string, region:string}} */
function resolveConfig() {
  const bucket = process.env.REPORT_STORE_S3_BUCKET;
  if (!bucket) {
    throw new Error("REPORT_STORE_S3_BUCKET が設定されていません（REPORT_STORE_BACKEND=s3 使用時は必須です）");
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません（REPORT_STORE_BACKEND=s3 使用時は必須です）");
  }
  const prefix = process.env.REPORT_STORE_S3_PREFIX || DEFAULT_PREFIX;
  return { bucket, prefix, region };
}

let cachedClient = null;

/** @returns {S3Client} */
function defaultClient() {
  if (!cachedClient) {
    const { region } = resolveConfig();
    cachedClient = new S3Client({ region });
  }
  return cachedClient;
}

/**
 * company_slugからS3オブジェクトキーを安全に組み立てる。
 * @param {string} slug
 * @param {string} prefix
 * @returns {string}
 */
function reportKey(slug, prefix) {
  const check = validateSlug(slug);
  if (!check.ok) throw new Error(`不正なcompany_slugです: ${check.error}`);
  return `${prefix}${slug}.json`;
}

/**
 * S3のBody（ReadableStream相当）を文字列へ変換する（既存の他backendと同じ実装）。
 * @param {*} body
 * @returns {Promise<string>}
 */
async function bodyToString(body) {
  if (body && typeof body.transformToString === "function") {
    return body.transformToString("utf-8");
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf-8");
}

/**
 * @param {string} slug
 * @param {{client?:S3Client}} [options] - テスト時にS3Client相当のモックを注入するためのフック。
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readReport(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = reportKey(slug, prefix);

  let res;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (err && (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)) {
      return null;
    }
    throw err;
  }

  const text = await bodyToString(res.Body);
  return JSON.parse(text);
}

/**
 * @param {string} slug
 * @param {Object} report
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<void>}
 */
async function writeReport(slug, report, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = reportKey(slug, prefix);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(report, null, 2) + "\n",
      ContentType: "application/json",
      ServerSideEncryption: "AES256", // 他backendと同じ方針で既定暗号化する
    })
  );
}

module.exports = { readReport, writeReport, reportKey, resolveConfig };
