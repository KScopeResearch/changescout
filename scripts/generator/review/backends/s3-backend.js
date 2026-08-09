/**
 * s3-backend.js — review-store.js（PoC）のREVIEW_STORE_BACKEND=s3時のバックエンド。
 * leads/backends/s3-backend.jsの設計をそのままreview.jsonへ横展開したもの。
 * 「1 review = 1 JSONファイル」という既存のfilesystem設計を、S3の
 * 「1 review = 1 オブジェクト」（<prefix><company_slug>.json）へ写像する。
 *
 * 【PoCスコープの注記】本番review.jsonをこのバックエンド経由でAWSへ書き込むことは
 * 今回のPoCでは一切行っていない。テストはすべてS3Clientをインメモリ疑似実装に
 * 差し替えて検証している（leads/backends/s3-backend.test.jsと同じ手法）。
 *
 * 【キー設計についての判断】「reviews/<company_slug>/review.json」という
 * ネストしたキー案も検討したが、leads/backends/s3-backend.jsのleadKey()
 * （<prefix><lead_id>.json というフラットな1階層）と一貫性を保つため、こちらも
 * <prefix><company_slug>.json というフラットなキーを採用した（プロジェクト内に
 * 複数のキー設計パターンを持ち込まないため）。
 *
 * 【必須な環境変数】（LEAD_STORE_*と対称の命名だが、値は独立した別変数）
 *   - REVIEW_STORE_S3_BUCKET（必須。バケット名）
 *   - REVIEW_STORE_S3_PREFIX（任意。既定"reviews/"）
 *   - AWS_REGION（必須。s3-backend.js/ses-client.jsと同じ環境変数をそのまま再利用）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN（任意。
 *     未設定時はAWS SDKの既定クレデンシャルチェーンに委ねる。leads/backends/s3-backend.js
 *     と同じ方針）
 *
 * 【エラー処理】オブジェクトが存在しない場合（GetObjectCommandがNoSuchKeyを投げる）は
 * readReview()と同様nullを返す（review-store.jsの既存契約と一致させる）。それ以外の
 * S3エラーは呼び出し元へそのまま例外として伝播させる。
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

const { validateSlug } = require("../../shared/path-safety");

const DEFAULT_PREFIX = "reviews/";

/** @returns {{bucket:string, prefix:string, region:string}} */
function resolveConfig() {
  const bucket = process.env.REVIEW_STORE_S3_BUCKET;
  if (!bucket) {
    throw new Error("REVIEW_STORE_S3_BUCKET が設定されていません（REVIEW_STORE_BACKEND=s3 使用時は必須です）");
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません（REVIEW_STORE_BACKEND=s3 使用時は必須です）");
  }
  const prefix = process.env.REVIEW_STORE_S3_PREFIX || DEFAULT_PREFIX;
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
function reviewKey(slug, prefix) {
  const check = validateSlug(slug);
  if (!check.ok) throw new Error(`不正なcompany_slugです: ${check.error}`);
  return `${prefix}${slug}.json`;
}

/**
 * S3のBody（ReadableStream相当）を文字列へ変換する（leads/backends/s3-backend.jsと同じ実装）。
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
async function readReview(slug, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = reviewKey(slug, prefix);

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
 * @param {Object} review
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<void>}
 */
async function writeReview(slug, review, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = reviewKey(slug, prefix);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(review, null, 2) + "\n",
      ContentType: "application/json",
      ServerSideEncryption: "AES256", // PII等は含まないが、Lead側の方針と一貫させるため既定で暗号化する
    })
  );
}

module.exports = { readReview, writeReview, reviewKey, resolveConfig };
