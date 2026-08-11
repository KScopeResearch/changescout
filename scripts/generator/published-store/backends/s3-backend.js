/**
 * s3-backend.js — published-store.js（PJ2 AOR Phase 3-D-1）のPUBLISHED_STORE_BACKEND=s3時の
 * バックエンド。company-context-store/backends/s3-backend.js・report-store/backends/s3-backend.js・
 * review/backends/s3-backend.jsと同じ設計をそのまま踏襲する（<prefix><company_slug>.jsonという
 * フラットな1階層のキー設計、options.client経由のテスト用クライアント注入、SSE-S3既定暗号化）。
 *
 * 【このbackendの役割】Lambda等、website/aor/data/へのローカルファイル書き込みが成立しない
 * 実行環境から「公開済みかどうか」を判定できるようにするためのcanonical state。
 * publish-report.js/unpublish-report.jsのコメント参照: PUBLISHED_STORE_BACKEND=s3の場合、
 * このS3オブジェクトの有無がLambda側の公開判定に使う正本になる一方、既存の
 * website/aor/data/<slug>.json（deploy-aor-web.jsの同期元）は別途、常に維持される
 * （publish-report.js/unpublish-report.js側の責務。このbackend自身はローカルファイルには
 * 一切関与しない）。
 *
 * 【PoCスコープの注記】本番データをこのバックエンド経由でAWSへ書き込むことは今回のPhase
 * 3-D-1では一切行っていない。テストはすべてS3Clientをインメモリ疑似実装に差し替えて
 * 検証している（report-store/backends/s3-backend.test.js等と同じ手法）。
 *
 * 【必須な環境変数】
 *   - PUBLISHED_STORE_S3_BUCKET（必須。バケット名）
 *   - PUBLISHED_STORE_S3_PREFIX（任意。既定"published/"）
 *   - AWS_REGION（必須。他backendと同じ環境変数をそのまま再利用）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN（任意。
 *     未設定時はAWS SDKの既定クレデンシャルチェーンに委ねる）
 */

const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const { validateSlug } = require("../../shared/path-safety");

const DEFAULT_PREFIX = "published/";

/** @returns {{bucket:string, prefix:string, region:string}} */
function resolveConfig() {
  const bucket = process.env.PUBLISHED_STORE_S3_BUCKET;
  if (!bucket) {
    throw new Error("PUBLISHED_STORE_S3_BUCKET が設定されていません（PUBLISHED_STORE_BACKEND=s3 使用時は必須です）");
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません（PUBLISHED_STORE_BACKEND=s3 使用時は必須です）");
  }
  const prefix = process.env.PUBLISHED_STORE_S3_PREFIX || DEFAULT_PREFIX;
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
function publishedKey(slug, prefix) {
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

/** @param {*} err @returns {boolean} */
function isNotFoundError(err) {
  return !!err && (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404);
}

/**
 * @param {string} slug
 * @param {{client?:S3Client}} [options] - テスト時にS3Client相当のモックを注入するためのフック。
 * @returns {Promise<boolean>}
 */
async function existsPublished(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = publishedKey(slug, prefix);

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * @param {string} slug
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readPublished(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = publishedKey(slug, prefix);

  let res;
  try {
    res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    if (isNotFoundError(err)) return null;
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
async function writePublished(slug, report, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = publishedKey(slug, prefix);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(report, null, 2) + "\n",
      ContentType: "application/json",
      ServerSideEncryption: "AES256",
    })
  );
}

/**
 * 冪等（対象オブジェクトが存在しなくてもS3のDeleteObjectは成功として扱う。
 * filesystem-backend.jsのdeletePublished()・従来のunpublish-report.jsと同じ方針）。
 * @param {string} slug
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<void>}
 */
async function deletePublished(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = publishedKey(slug, prefix);

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

module.exports = {
  existsPublished,
  readPublished,
  writePublished,
  deletePublished,
  publishedKey,
  resolveConfig,
};
