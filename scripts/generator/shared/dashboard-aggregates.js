/**
 * dashboard-aggregates.js — AOR Admin v2 Dashboard 用の read-only 集計ユーティリティ
 * （Phase52 STEP3）。
 *
 * 【設計方針】
 *   - ロジックは既存モジュール（leads/lead-store.js・company-index.js・
 *     published-store/backends/s3-backend.js 等）へ委譲し、独自の Lead 保存・
 *     公開判定ロジックは一切持たない。
 *   - すべて read-only。Lead / suppression / 公開状態を「数える」だけで、更新はしない。
 *   - 各 collector は失敗しても例外を投げず、呼び出し側（server.js の Dashboard API）が
 *     セクション単位で `{ status: "error", message }` を返せるよう、
 *     ここでは素直に throw する（server.js 側で Promise.allSettled で受ける）。
 *
 * 【対象規模】現状の Lead 数（〜数百件）では listLeads() の全件走査で十分
 *   （lead-store.js の findLeadByEmail 等と同じ MVP 方針）。1000 件を超えたら
 *   インデックス化を検討する。
 */

const { listLeads, isDeliveryBlocked } = require("../leads/lead-store");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 対象 Lead 配列を得る。options.leads が渡されればそれを使い（テスト用の依存性注入。
 * 他モジュールの options.client / options.sendEmail と同じパターン）、無ければ
 * lead-store.listLeads() を呼ぶ。
 * @param {{leads?: Object[]}} [options]
 * @returns {Promise<Object[]>}
 */
async function resolveLeads(options = {}) {
  return Array.isArray(options.leads) ? options.leads : listLeads();
}

/** @param {*} v @returns {boolean} */
function isIsoDateString(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

/**
 * Lead の history を新しい順に走査し、最初に見つかった「該当イベント名」のエントリを返す。
 * @param {Object} lead
 * @param {(event:string) => boolean} predicate
 * @returns {{at?:string, event?:string, metadata?:Object}|null}
 */
function findLatestHistory(lead, predicate) {
  const history = (lead && Array.isArray(lead.history) && lead.history) || [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i] && predicate(history[i].event)) return history[i];
  }
  return null;
}

/**
 * Lead Summary — delivery_status / delivery_approval_status 別の件数。
 *
 * 【指示書の "pending_review" について】VALID_DELIVERY_STATUSES に "pending_review" は
 * 存在しない（active/unsubscribed/bounced/suppressed のみ）。送信前ゲートである
 * delivery_approval_status:"pending"（＝Approved List 未昇格の Candidate）が実体上の
 * 対応概念のため、`pending_approval` として返す。
 *
 * @returns {Promise<{total:number, active:number, unsubscribed:number, bounced:number,
 *   suppressed:number, pending_approval:number}>}
 */
async function collectLeadSummary(options = {}) {
  const leads = await resolveLeads(options);
  const summary = { total: 0, active: 0, unsubscribed: 0, bounced: 0, suppressed: 0, pending_approval: 0 };
  for (const lead of leads) {
    summary.total += 1;
    switch (lead.delivery_status) {
      case "active":
        summary.active += 1;
        break;
      case "unsubscribed":
        summary.unsubscribed += 1;
        break;
      case "bounced":
        summary.bounced += 1;
        break;
      case "suppressed":
        summary.suppressed += 1;
        break;
      default:
        break;
    }
    if (lead.delivery_approval_status === "pending") summary.pending_approval += 1;
  }
  return summary;
}

/**
 * Delivery Summary — Lead.history の配信系イベントを集計する。
 * 累計と、直近 24 時間（配信結果系のみ）の両方を返す。
 *
 * @param {{now?:number}} [options] - now はテスト用（既定は Date.now()）
 * @returns {Promise<{
 *   initial_sent:number, initial_failed:number,
 *   weekly_sent:number, weekly_failed:number,
 *   delivered:number, bounced:number, complaints:number,
 *   paid_requested:number,
 *   last_24h:{delivered:number, bounced:number, complaints:number}
 * }>}
 */
async function collectDeliverySummary(options = {}) {
  const now = typeof options.now === "number" ? options.now : Date.now();
  const cutoff = now - DAY_MS;

  const leads = await resolveLeads(options);
  const out = {
    initial_sent: 0,
    initial_failed: 0,
    weekly_sent: 0,
    weekly_failed: 0,
    delivered: 0,
    bounced: 0,
    complaints: 0,
    paid_requested: 0,
    last_24h: { delivered: 0, bounced: 0, complaints: 0 },
  };

  const EVENT_KEY = {
    initial_report_sent: "initial_sent",
    initial_report_failed: "initial_failed",
    weekly_report_sent: "weekly_sent",
    weekly_report_failed: "weekly_failed",
    email_delivered: "delivered",
    email_bounced: "bounced",
    email_complaint: "complaints",
    paid_report_requested: "paid_requested",
  };
  const WINDOWED = { email_delivered: "delivered", email_bounced: "bounced", email_complaint: "complaints" };

  for (const lead of leads) {
    const history = Array.isArray(lead.history) ? lead.history : [];
    for (const entry of history) {
      const key = EVENT_KEY[entry.event];
      if (!key) continue;
      out[key] += 1;
      const wkey = WINDOWED[entry.event];
      if (wkey && isIsoDateString(entry.at) && Date.parse(entry.at) >= cutoff) {
        out.last_24h[wkey] += 1;
      }
    }
  }
  return out;
}

/** delivery_status をブロック状態にした可能性のある history イベントか。 */
function isSuppressionEvent(event) {
  return event === "unsubscribed" || event === "email_bounced" || event === "email_complaint";
}

/**
 * 配信ブロック中の Lead を canonical な suppression 理由へ分類する（history を読むだけ）。
 * 「現在の delivery_status を作った最後の history イベント」で判定する。Dashboard の
 * Suppression Summary と Suppression UI（suppression-log.js）で共通の唯一の分類ロジック。
 *
 * @param {Object} lead
 * @returns {{reason: ("unsubscribe"|"bounce"|"complaint"|"harderror"|"drop"|"manual"),
 *   entry: ({at?:string, event?:string, metadata?:Object}|null)}}
 */
function classifySuppression(lead) {
  const entry = findLatestHistory(lead, isSuppressionEvent);
  if (!entry) return { reason: "manual", entry: null };
  if (entry.event === "unsubscribed") return { reason: "unsubscribe", entry };
  if (entry.event === "email_complaint") return { reason: "complaint", entry };
  // email_bounced: blastengine の HARDERROR/DROP は metadata.event_type で区別（process-blastengine-event.js）。
  // SES の bounce は metadata.event_type が付かない。
  const et = entry.metadata && typeof entry.metadata.event_type === "string" ? entry.metadata.event_type.toUpperCase() : null;
  if (et === "HARDERROR") return { reason: "harderror", entry };
  if (et === "DROP") return { reason: "drop", entry };
  return { reason: "bounce", entry };
}

/**
 * Suppression Summary — 配信ブロック中の Lead を「理由別」に分類して数える。
 *
 * @returns {Promise<{unsubscribe:number, bounce:number, complaint:number,
 *   harderror:number, drop:number, manual:number}>}
 */
async function collectSuppressionSummary(options = {}) {
  const leads = await resolveLeads(options);
  const out = { unsubscribe: 0, bounce: 0, complaint: 0, harderror: 0, drop: 0, manual: 0 };

  for (const lead of leads) {
    if (!isDeliveryBlocked(lead)) continue;
    out[classifySuppression(lead).reason] += 1;
  }
  return out;
}

/**
 * Report Summary — レポート公開状態の集計。特に「backend 公開済みだが Web 未反映」
 * （Phase51 STEP28 の障害クラス）を deploy_pending として検出する。
 *
 * @param {{
 *   reportsCache?: Array<{id:string, review_status?:string, published?:boolean}>,
 *   publishedBackendSlugs?: string[],
 *   webDeployedSlugs?: string[],
 * }} input
 *   - reportsCache: server.js の reportsCache（listCompanySummaries() の結果）。
 *     generated / approved の集計に使う（追加 I/O を避けるため）。
 *   - publishedBackendSlugs / webDeployedSlugs: 呼び出し側が S3 ListObjectsV2 で
 *     取得した slug 配列（aws-status.js 経由）。差集合で deploy_pending を出す。
 * @returns {{generated:number, approved:number, published_backend:number,
 *   web_deployed:number, deploy_pending:number, pending_slugs:string[]}}
 */
function collectReportSummary(input = {}) {
  const reportsCache = Array.isArray(input.reportsCache) ? input.reportsCache : [];
  const publishedBackendSlugs = Array.isArray(input.publishedBackendSlugs) ? input.publishedBackendSlugs : null;
  const webDeployedSlugs = Array.isArray(input.webDeployedSlugs) ? input.webDeployedSlugs : null;

  const generated = reportsCache.length;
  const approved = reportsCache.filter((r) => r && r.review_status === "approved").length;

  // published_backend: S3 の published/ prefix を数えられればそれを使い、
  // 取れなければ reportsCache.published（published-store.isPublished() の結果）で代用する。
  let published_backend;
  let backendSet;
  if (publishedBackendSlugs) {
    backendSet = new Set(publishedBackendSlugs);
    published_backend = backendSet.size;
  } else {
    const fromCache = reportsCache.filter((r) => r && r.published).map((r) => r.id);
    backendSet = new Set(fromCache);
    published_backend = backendSet.size;
  }

  let web_deployed = null;
  let pending_slugs = [];
  if (webDeployedSlugs) {
    const webSet = new Set(webDeployedSlugs);
    web_deployed = webSet.size;
    pending_slugs = [...backendSet].filter((slug) => !webSet.has(slug)).sort();
  }

  return {
    generated,
    approved,
    published_backend,
    web_deployed,
    deploy_pending: web_deployed === null ? null : pending_slugs.length,
    pending_slugs,
  };
}

module.exports = {
  collectLeadSummary,
  collectDeliverySummary,
  collectSuppressionSummary,
  collectReportSummary,
  classifySuppression,
  // テスト用に公開
  findLatestHistory,
};
