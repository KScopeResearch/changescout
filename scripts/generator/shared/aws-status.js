/**
 * aws-status.js — AOR Admin v2 Dashboard 用の AWS / Provider 状態取得（read-only）
 * （Phase52 STEP3）。
 *
 * 【設計方針】
 *   - 完全 read-only。SES / Lambda / CloudFront への書き込み系 API は一切呼ばない
 *     （Get / List / Describe のみ）。
 *   - SES・Lambda は `aws` CLI（child_process.execFile）で取得する。Phase52 STEP3 の
 *     指示書で「SES CLI または既存ライブラリ」「read-only AWS CLI」が明示的に許可されている。
 *     aor-admin は現状ローカル運用であり `aws` CLI が利用可能（稼働場所の確定は別 STEP）。
 *   - CloudFront・S3 prefix 列挙は既存 npm 依存（@aws-sdk/client-cloudfront /
 *     @aws-sdk/client-s3）を使う。
 *   - どの関数も失敗時に例外を投げず `{ status: "error", message }` を返す
 *     （Dashboard API がセクション単位で劣化表示できるようにするため）。
 *   - secret（API キー・パスワード・認証情報）の「値」は絶対に返さない。真偽値・
 *     マスク済みメタデータのみ。
 *
 * 【TTL キャッシュ】同一プロセス内で 60 秒キャッシュする（Dashboard の頻繁な再取得で
 *   AWS API レート・レイテンシを無駄にしないため）。
 */

const { execFile } = require("child_process");
const { createLogger } = require("./logger");

const logger = createLogger("aws-status");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const CLI_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 60 * 1000;

const SES_FROM = process.env.SES_FROM || "aor-report@changescout.jp";
const SES_DOMAIN = SES_FROM.includes("@") ? SES_FROM.split("@")[1] : SES_FROM;
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "pj2-aor-delivery";
const CLOUDFRONT_DISTRIBUTION_ID = process.env.AOR_WEB_CLOUDFRONT_DISTRIBUTION_ID || "E1TGUCT9CYALRK";

// Dashboard で状態を出す Lambda（Phase52 STEP3 指示書の 4 関数）。
const LAMBDA_NAMES = [
  "pj2-aor-weekly-report-delivery",
  "pj2-aor-initial-report-delivery",
  "pj2-aor-ses-event-processing",
  "pj2-aor-blastengine-webhook",
];

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

/** @type {Map<string, {at:number, value:*}>} */
const cache = new Map();

/**
 * TTL キャッシュ付きで非同期関数を実行する。fn は必ず解決する（内部で try/catch 済み）前提。
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function cached(key, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: now, value });
  return value;
}

/** キャッシュを空にする（テスト用）。 */
function clearCache() {
  cache.clear();
}

/**
 * `aws` CLI を実行して JSON を返す。失敗時は例外を投げる（呼び出し側が握る）。
 * @param {string[]} args - `aws` 以降の引数（`--region` `--output json` は自動付与）
 * @returns {Promise<*>}
 */
function awsCli(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "aws",
      [...args, "--region", REGION, "--output", "json"],
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // stderr にはリソース名・ARN 等が含まれうるが secret 値は含まれない（AWS CLI のエラー本文）。
          reject(new Error((stderr && stderr.toString().trim()) || err.message));
          return;
        }
        try {
          resolve(stdout && stdout.toString().trim() ? JSON.parse(stdout.toString()) : {});
        } catch (parseErr) {
          reject(new Error(`aws CLI 応答を JSON として解釈できません: ${parseErr.message}`));
        }
      }
    );
  });
}

/** @param {unknown} err @returns {{status:"error", message:string}} */
function toError(err) {
  const message = err && err.message ? String(err.message) : String(err);
  return { status: "error", message };
}

// ---------------------------------------------------------------------------
// SES
// ---------------------------------------------------------------------------

/**
 * SES アカウント状態 + DKIM + Configuration Set（すべて read-only）。
 * @returns {Promise<Object>}
 */
async function getSesStatus() {
  return cached("ses", async () => {
    const result = {};
    try {
      const account = await awsCli(["sesv2", "get-account"]);
      result.production_access_enabled = !!account.ProductionAccessEnabled;
      result.review_status = (account.Details && account.Details.ReviewDetails && account.Details.ReviewDetails.Status) || null;
      result.sending_enabled = !!account.SendingEnabled;
      result.enforcement_status = account.EnforcementStatus || null;
      result.max_24_hour_send = account.SendQuota ? account.SendQuota.Max24HourSend : null;
      result.sent_last_24_hours = account.SendQuota ? account.SendQuota.SentLast24Hours : null;
      result.max_send_rate = account.SendQuota ? account.SendQuota.MaxSendRate : null;
      result.suppressed_reasons =
        (account.SuppressionAttributes && account.SuppressionAttributes.SuppressedReasons) || [];
      result.mail_type = (account.Details && account.Details.MailType) || null;
    } catch (err) {
      logger.warn("SES get-account 取得に失敗", { message: err.message });
      result.account = toError(err);
    }

    try {
      const identity = await awsCli(["sesv2", "get-email-identity", "--email-identity", SES_DOMAIN]);
      result.identity_domain = SES_DOMAIN;
      result.verified = !!identity.VerifiedForSendingStatus;
      result.dkim_status = identity.DkimAttributes ? identity.DkimAttributes.Status : null;
      result.dkim_signing_enabled = identity.DkimAttributes ? !!identity.DkimAttributes.SigningEnabled : null;
    } catch (err) {
      logger.warn("SES get-email-identity 取得に失敗", { message: err.message });
      result.identity = toError(err);
    }

    try {
      const dest = await awsCli([
        "sesv2",
        "get-configuration-set-event-destinations",
        "--configuration-set-name",
        SES_CONFIGURATION_SET,
      ]);
      result.configuration_set = SES_CONFIGURATION_SET;
      result.configuration_set_destinations = (dest.EventDestinations || []).map((d) => ({
        name: d.Name,
        enabled: !!d.Enabled,
        matching_event_types: d.MatchingEventTypes || [],
        sns_topic_arn: d.SnsDestination ? d.SnsDestination.TopicArn : null,
      }));
    } catch (err) {
      logger.warn("SES get-configuration-set-event-destinations 取得に失敗", { message: err.message });
      result.configuration_set_status = toError(err);
    }

    result.region = REGION;
    return result;
  });
}

// ---------------------------------------------------------------------------
// Lambda
// ---------------------------------------------------------------------------

/**
 * 主要 Lambda（4 関数）の設定状態。CloudWatch メトリクスは Phase52 STEP3 では不要。
 * @returns {Promise<{functions:Array<Object>}>}
 */
async function getLambdaStatus() {
  return cached("lambda", async () => {
    const functions = await Promise.all(
      LAMBDA_NAMES.map(async (name) => {
        try {
          const cfg = await awsCli(["lambda", "get-function-configuration", "--function-name", name]);
          return {
            name,
            last_modified: cfg.LastModified || null,
            runtime: cfg.Runtime || null,
            state: cfg.State || null,
            last_update_status: cfg.LastUpdateStatus || null,
          };
        } catch (err) {
          return { name, ...toError(err) };
        }
      })
    );
    return { region: REGION, functions };
  });
}

// ---------------------------------------------------------------------------
// CloudFront（@aws-sdk/client-cloudfront）
// ---------------------------------------------------------------------------

/**
 * CloudFront Distribution 状態 + 最新 Invalidation。origin から Web バケット名も導出する。
 * @returns {Promise<Object>}
 */
async function getCloudFrontStatus() {
  return cached("cloudfront", async () => {
    try {
      // CloudFront はグローバルサービスだが SDK は region 指定必須。us-east-1 を使う。
      const { CloudFrontClient, GetDistributionCommand, ListInvalidationsCommand } = require("@aws-sdk/client-cloudfront");
      const client = new CloudFrontClient({ region: "us-east-1" });

      const dist = await client.send(new GetDistributionCommand({ Id: CLOUDFRONT_DISTRIBUTION_ID }));
      const d = dist.Distribution || {};
      const cfg = d.DistributionConfig || {};
      const originItems = (cfg.Origins && cfg.Origins.Items) || [];
      const s3Origin = originItems.find((o) => /\.s3[.-]/.test(o.DomainName || ""));
      const webBucket = s3Origin ? (s3Origin.DomainName || "").replace(/\.s3[.-].*$/, "") : null;

      let lastInvalidation = null;
      try {
        const inv = await client.send(
          new ListInvalidationsCommand({ DistributionId: CLOUDFRONT_DISTRIBUTION_ID, MaxItems: "1" })
        );
        const item = inv.InvalidationList && inv.InvalidationList.Items && inv.InvalidationList.Items[0];
        if (item) {
          lastInvalidation = { id: item.Id, status: item.Status, create_time: item.CreateTime };
        }
      } catch (invErr) {
        lastInvalidation = toError(invErr);
      }

      return {
        distribution_id: CLOUDFRONT_DISTRIBUTION_ID,
        domain_name: d.DomainName || null,
        status: d.Status || null,
        enabled: cfg.Enabled === undefined ? null : !!cfg.Enabled,
        aliases: (cfg.Aliases && cfg.Aliases.Items) || [],
        web_bucket: webBucket,
        last_invalidation: lastInvalidation,
      };
    } catch (err) {
      logger.warn("CloudFront 状態取得に失敗", { message: err.message });
      return toError(err);
    }
  });
}

// ---------------------------------------------------------------------------
// blastengine（設定状態のみ。値は返さない）
// ---------------------------------------------------------------------------

/**
 * blastengine の「設定が入っているか」を真偽値で返す。secret 値は一切返さない。
 * Initial 送信 Lambda / Webhook 受信 Lambda の環境変数キーの有無と Function URL の存在で判定する。
 * @returns {Promise<Object>}
 */
async function getBlastengineConfigStatus() {
  return cached("blastengine", async () => {
    const result = {
      credentials_configured: false,
      webhook_credentials_configured: false,
      webhook_endpoint_exists: false,
    };

    try {
      const initCfg = await awsCli([
        "lambda",
        "get-function-configuration",
        "--function-name",
        "pj2-aor-initial-report-delivery",
      ]);
      const keys = new Set(Object.keys((initCfg.Environment && initCfg.Environment.Variables) || {}));
      result.credentials_configured =
        keys.has("BLASTENGINE_USER_ID") && keys.has("BLASTENGINE_API_KEY") && keys.has("BLASTENGINE_FROM");
    } catch (err) {
      result.initial_lambda = toError(err);
    }

    try {
      const hookCfg = await awsCli([
        "lambda",
        "get-function-configuration",
        "--function-name",
        "pj2-aor-blastengine-webhook",
      ]);
      const keys = new Set(Object.keys((hookCfg.Environment && hookCfg.Environment.Variables) || {}));
      result.webhook_credentials_configured =
        keys.has("BLASTENGINE_WEBHOOK_USER") && keys.has("BLASTENGINE_WEBHOOK_PASSWORD");
    } catch (err) {
      result.webhook_lambda = toError(err);
    }

    try {
      const urlCfg = await awsCli([
        "lambda",
        "get-function-url-config",
        "--function-name",
        "pj2-aor-blastengine-webhook",
      ]);
      result.webhook_endpoint_exists = !!urlCfg.FunctionUrl;
    } catch (err) {
      // Function URL 未設定でも CLI はエラーを返す。存在しない＝false として扱う。
      result.webhook_endpoint_exists = false;
    }

    result.enabled = result.credentials_configured && result.webhook_endpoint_exists;
    // 外部仕様の正本
    result.spec_document = "docs/external-provider-confirmations.md";
    return result;
  });
}

// ---------------------------------------------------------------------------
// S3 prefix 列挙（published/ と Web の data/。@aws-sdk/client-s3）
// ---------------------------------------------------------------------------

/**
 * S3 の prefix 配下の `<slug>.json` を列挙して slug 配列を返す。
 * @param {string} bucket
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
async function listJsonSlugs(bucket, prefix) {
  const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const client = new S3Client({ region: REGION });
  const slugs = [];
  let ContinuationToken;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken })
    );
    for (const obj of res.Contents || []) {
      const key = obj.Key || "";
      if (!key.startsWith(prefix) || !key.endsWith(".json")) continue;
      const slug = key.slice(prefix.length, -".json".length);
      if (slug && !slug.includes("/")) slugs.push(slug);
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return slugs;
}

/**
 * published-store（backend）に公開済みのレポート slug 一覧。
 * @returns {Promise<string[]|{status:"error", message:string}>}
 */
async function listPublishedBackendSlugs() {
  return cached("published-slugs", async () => {
    try {
      const bucket = process.env.PUBLISHED_STORE_S3_BUCKET;
      if (!bucket) return { status: "error", message: "PUBLISHED_STORE_S3_BUCKET 未設定" };
      const prefix = process.env.PUBLISHED_STORE_S3_PREFIX || "published/";
      return await listJsonSlugs(bucket, prefix);
    } catch (err) {
      return toError(err);
    }
  });
}

/**
 * Web 配信バケット（CloudFront origin）の data/ 配下に配置済みのレポート slug 一覧。
 * @param {string|null} webBucket - getCloudFrontStatus() で導出したバケット名。null なら
 *   AOR_WEB_S3_BUCKET 環境変数を使う。
 * @returns {Promise<string[]|{status:"error", message:string}>}
 */
async function listWebDeployedSlugs(webBucket) {
  const bucket = webBucket || process.env.AOR_WEB_S3_BUCKET || null;
  return cached(`web-slugs:${bucket || "none"}`, async () => {
    try {
      if (!bucket) {
        return { status: "error", message: "Web バケット名を特定できません（CloudFront origin 未取得かつ AOR_WEB_S3_BUCKET 未設定）" };
      }
      return await listJsonSlugs(bucket, "data/");
    } catch (err) {
      return toError(err);
    }
  });
}

module.exports = {
  getSesStatus,
  getLambdaStatus,
  getCloudFrontStatus,
  getBlastengineConfigStatus,
  listPublishedBackendSlugs,
  listWebDeployedSlugs,
  clearCache,
  // テスト用
  toError,
  CACHE_TTL_MS,
};
