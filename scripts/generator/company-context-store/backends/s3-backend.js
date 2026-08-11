/**
 * s3-backend.js — company-context-store.js（PoC）のCOMPANY_CONTEXT_STORE_BACKEND=s3時の
 * バックエンド。leads/backends/s3-backend.js・review/backends/s3-backend.jsの設計を
 * そのままcompany_context.jsonへ横展開したもの。「1 company_context = 1 JSONファイル」
 * という既存のfilesystem設計を、S3の「1 company_context = 1 オブジェクト」
 * （<prefix><company_slug>.json）へ写像する。
 *
 * 【PoCスコープの注記】本番company_context.jsonをこのバックエンド経由でAWSへ書き込む
 * ことは今回のPoCでは一切行っていない。テストはすべてS3Clientをインメモリ疑似実装に
 * 差し替えて検証している（leads/backends/s3-backend.test.js・
 * test/review-store.test.jsと同じ手法）。
 *
 * 【キー設計についての判断】review/backends/s3-backend.jsの`<prefix><company_slug>.json`
 * というフラットな1階層のキー設計をそのまま踏襲した（プロジェクト内に複数のキー設計
 * パターンを持ち込まないため）。
 *
 * 【必須な環境変数】（LEAD_STORE_*・REVIEW_STORE_*と対称の命名だが、値は独立した別変数）
 *   - COMPANY_CONTEXT_STORE_S3_BUCKET（必須。バケット名）
 *   - COMPANY_CONTEXT_STORE_S3_PREFIX（任意。既定"company-contexts/"）
 *   - AWS_REGION（必須。他backendと同じ環境変数をそのまま再利用）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN（任意。
 *     未設定時はAWS SDKの既定クレデンシャルチェーンに委ねる）
 *
 * 【エラー処理】オブジェクトが存在しない場合（GetObjectCommandがNoSuchKeyを投げる）は
 * readCompanyContext()と同様nullを返す。それ以外のS3エラーは呼び出し元へそのまま
 * 例外として伝播させる。
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const { validateSlug } = require("../../shared/path-safety");

const DEFAULT_PREFIX = "company-contexts/";

/** @returns {{bucket:string, prefix:string, region:string}} */
function resolveConfig() {
  const bucket = process.env.COMPANY_CONTEXT_STORE_S3_BUCKET;
  if (!bucket) {
    throw new Error(
      "COMPANY_CONTEXT_STORE_S3_BUCKET が設定されていません（COMPANY_CONTEXT_STORE_BACKEND=s3 使用時は必須です）"
    );
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません（COMPANY_CONTEXT_STORE_BACKEND=s3 使用時は必須です）");
  }
  const prefix = process.env.COMPANY_CONTEXT_STORE_S3_PREFIX || DEFAULT_PREFIX;
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
function companyContextKey(slug, prefix) {
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
async function readCompanyContext(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = companyContextKey(slug, prefix);

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
 * @param {Object} context
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<void>}
 */
async function writeCompanyContext(slug, context, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = companyContextKey(slug, prefix);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(context, null, 2) + "\n",
      ContentType: "application/json",
      ServerSideEncryption: "AES256", // 他backendと同じ方針で既定暗号化する
    })
  );
}

module.exports = { readCompanyContext, writeCompanyContext, companyContextKey, resolveConfig };
