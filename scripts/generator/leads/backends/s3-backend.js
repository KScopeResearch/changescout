/**
 * s3-backend.js — lead-store.jsのLEAD_STORE_BACKEND=s3時のバックエンド。
 * scripts/generator/logs/leads/<lead_id>.json という「1 Lead = 1 JSONファイル」の
 * 設計思想を、S3の「1 Lead = 1 オブジェクト」（<prefix><lead_id>.json）へそのまま写像する。
 *
 * 【SDK採用の理由（ユーザー確認済み）】SESはNode標準crypto+fetchでSigV4を自前実装した
 * （ses-client.js）が、S3のListObjectsV2はXMLレスポンスを返すため、自前実装する場合は
 * 署名だけでなくXML解析（ページネーションのcontinuation token・XMLエンティティの
 * エスケープ処理を含む）も自作する必要があり、SESのケースより明らかにリスクが高い。
 * 「npm依存ゼロ」という方針だけを理由に無理に自前実装しない、というプロジェクトの
 * 既存の判断基準（ses-client.jsのコメント等）に従い、この1箇所に限定して
 * @aws-sdk/client-s3 を採用する（プロジェクト全体のnpm依存ゼロ方針から初めて外れる
 * 判断であり、package.json自体もこのS3バックエンドのために新設した）。
 * Lambda実行環境にはAWS SDK v3が標準搭載されているため、Lambda上ではこの依存の
 * デプロイパッケージへの追加バンドルが不要になる（本番運用時の利点）。
 *
 * 【必要な環境変数】
 *   - LEAD_STORE_S3_BUCKET（必須。バケット名）
 *   - LEAD_STORE_S3_PREFIX（任意。既定"leads/"。scripts/generator/logs/leads/という
 *     現行のディレクトリ構造に対応するprefix）
 *   - AWS_REGION（必須。ses-client.jsと同じ環境変数をそのまま再利用し、S3専用の
 *     リージョン変数は新設しない）
 *   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN（任意。
 *     未設定時はAWS SDKの既定クレデンシャルチェーンに委ねる。Lambda実行時は
 *     実行ロールから自動的に解決されるため、通常はこれらを明示設定しなくてよい
 *     ——ses-client.jsの自前SigV4実装がこれらの環境変数を必須としていたのとは
 *     異なる点）。
 *
 * 【PIIの扱い】emailやreport_tokenをS3キーには一切使わない（キーはlead_idのみから
 * 組み立てる）。AWS credentialやLead JSON本体をログへ出力する処理はここには書かない。
 *
 * 【エラー処理】オブジェクトが存在しない場合（GetObjectCommandがNoSuchKeyを投げる）は
 * readLead()と同様nullを返す（lead-store.jsの既存契約と一致させる）。それ以外のS3
 * エラー（権限不足・ネットワークエラー等）は呼び出し元へそのまま例外として伝播させる。
 */

const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const { validateSlug } = require("../../shared/path-safety");

const DEFAULT_PREFIX = "leads/";

/** @returns {{bucket:string, prefix:string, region:string}} */
function resolveConfig() {
  const bucket = process.env.LEAD_STORE_S3_BUCKET;
  if (!bucket) {
    throw new Error("LEAD_STORE_S3_BUCKET が設定されていません（LEAD_STORE_BACKEND=s3 使用時は必須です）");
  }
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION が設定されていません（LEAD_STORE_BACKEND=s3 使用時は必須です）");
  }
  const prefix = process.env.LEAD_STORE_S3_PREFIX || DEFAULT_PREFIX;
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
 * lead_idからS3オブジェクトキーを安全に組み立てる。shared/path-safety.jsの
 * validateSlug()を再利用し、独自のキー検証ロジックは実装しない
 * （lead-store.jsのfilesystem版leadFilePath()と同じ考え方）。
 * @param {string} leadId
 * @param {string} prefix
 * @returns {string}
 */
function leadKey(leadId, prefix) {
  const check = validateSlug(leadId);
  if (!check.ok) throw new Error(`不正なlead_idです: ${check.error}`);
  return `${prefix}${leadId}.json`;
}

/**
 * S3のBody（ReadableStream相当）を文字列へ変換する。
 * @param {*} body
 * @returns {Promise<string>}
 */
async function bodyToString(body) {
  // @aws-sdk/client-s3はNode環境ではBodyにtransformToString()ヘルパーを提供する
  // （SDK v3の標準的な読み取り方法。手動でのストリーム収集を避ける）。
  if (body && typeof body.transformToString === "function") {
    return body.transformToString("utf-8");
  }
  // フォールバック（テスト用のダミーBody等、transformToStringを持たない場合）。
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf-8");
}

/**
 * @param {string} leadId
 * @param {{client?:S3Client}} [options] - テスト時にS3Client相当のモックを注入するためのフック。
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readLead(leadId, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = leadKey(leadId, prefix);

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
 * @param {string} leadId
 * @param {Object} lead
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<void>}
 */
async function writeLead(leadId, lead, options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();
  const key = leadKey(leadId, prefix);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(lead, null, 2) + "\n",
      ContentType: "application/json",
      ServerSideEncryption: "AES256", // PII保護: SSE-S3によるサーバーサイド暗号化を必須とする
    })
  );
}

/**
 * prefix配下の全Leadオブジェクトを読み込む（lead-store.jsのfilesystem版listLeads()と
 * 同じ「一覧取得後・読み込み前に対象が消えた場合は安全側にスキップする」方針を踏襲する）。
 * @param {{client?:S3Client}} [options]
 * @returns {Promise<Object[]>}
 */
async function listLeads(options = {}) {
  const { bucket, prefix } = resolveConfig();
  const client = options.client || defaultClient();

  const keys = [];
  let continuationToken;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    (res.Contents || []).forEach((obj) => {
      if (obj.Key && obj.Key.endsWith(".json")) keys.push(obj.Key);
    });
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  const leads = [];
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      // eslint-disable-next-line no-await-in-loop
      const text = await bodyToString(res.Body);
      leads.push(JSON.parse(text));
    } catch (e) {
      // 一覧取得後・読み込み前にオブジェクトが削除された場合等は、filesystem版と同じく
      // そのエントリだけ安全側にスキップする。
    }
  }
  return leads;
}

module.exports = { readLead, writeLead, listLeads, leadKey, resolveConfig };
