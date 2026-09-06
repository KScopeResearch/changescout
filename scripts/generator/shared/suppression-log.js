/**
 * suppression-log.js — AOR Admin v2 Suppression UI 用の read-only 抽出（Phase52 STEP7）。
 *
 * 「送信対象外（isDeliveryBlocked）になっている Lead」を、canonical な理由（unsubscribe /
 * bounce / complaint / harderror / drop / manual）・Provider・発生時刻・発生イベント・
 * suppression 関連のタイムラインとともに 1行=1Lead の配列へ変換する。
 *
 * 【設計方針】
 *   - read-only。Lead を更新しない。
 *   - 理由の分類ロジックは dashboard-aggregates.classifySuppression を「唯一の実装」として
 *     再利用する（Dashboard の Suppression Summary と一致させるため。§25「重複集計禁止」）。
 *   - Provider は理由から Backend 側で決める（Frontend で推測しない。§11 / §22）。
 *   - metadata は delivery-log.sanitizeMetadata で秘密情報キーを落とす（§18 / §29）。
 *   - options.leads が渡されればそれを使う（テスト用 DI）。
 */

const { listLeads, isDeliveryBlocked } = require("../leads/lead-store");
const { classifySuppression } = require("./dashboard-aggregates");
const { sanitizeMetadata } = require("./delivery-log");

// 理由 → Provider（§22 の対応表。Backend が唯一の判定者）。
const REASON_PROVIDER = {
  unsubscribe: "user",
  bounce: "ses",
  complaint: "ses",
  harderror: "blastengine",
  drop: "blastengine",
  manual: "manual",
};

// Suppression タイムラインに含める history イベント（配信〜停止に至る経緯）。
const TIMELINE_EVENTS = new Set([
  "initial_report_queued",
  "initial_report_sent",
  "initial_report_failed",
  "weekly_report_sent",
  "weekly_report_failed",
  "email_delivered",
  "email_opened",
  "email_clicked",
  "email_bounced",
  "email_complaint",
  "unsubscribed",
]);

async function resolveLeads(options = {}) {
  return Array.isArray(options.leads) ? options.leads : listLeads();
}

/** 発生イベント名の表示用ラベル（HARDERROR/DROP を括弧で添える。実イベント名は保持）。 */
function sourceEventLabel(entry) {
  if (!entry || !entry.event) return "manual";
  if (entry.event === "email_bounced") {
    const et = entry.metadata && typeof entry.metadata.event_type === "string" ? entry.metadata.event_type.toUpperCase() : null;
    if (et) return `email_bounced(${et})`;
  }
  return entry.event;
}

/** Lead.history から suppression 関連イベントだけを時系列（古い順）で抜き出す。 */
function suppressionTimeline(lead) {
  const history = Array.isArray(lead.history) ? lead.history : [];
  return history
    .filter((e) => e && TIMELINE_EVENTS.has(e.event))
    .map((e) => ({ at: e.at || null, event: e.event, metadata: sanitizeMetadata(e.metadata) }));
}

/**
 * 配信ブロック中の全 Lead を suppression 行の配列へ変換する（blocked_at 降順）。
 * @param {{leads?: Object[]}} [options]
 * @returns {Promise<Array<{
 *   lead_id:string, email:string, company_slug:(string|null), company_url:(string|null),
 *   delivery_status:string, delivery_approval_status:(string|undefined),
 *   reason:string, provider:string, source_event:string,
 *   blocked_at:(string|null), metadata:Object, timeline:Array
 * }>>}
 */
async function collectSuppressions(options = {}) {
  const leads = await resolveLeads(options);
  const rows = [];

  for (const lead of leads) {
    if (!isDeliveryBlocked(lead)) continue;
    const { reason, entry } = classifySuppression(lead);
    rows.push({
      lead_id: lead.lead_id,
      email: lead.email,
      company_slug: lead.company_slug || null,
      company_url: lead.company_url || null,
      delivery_status: lead.delivery_status,
      delivery_approval_status: lead.delivery_approval_status,
      reason,
      provider: REASON_PROVIDER[reason] || "unknown",
      source_event: sourceEventLabel(entry),
      blocked_at: (entry && entry.at) || null,
      metadata: sanitizeMetadata(entry && entry.metadata),
      timeline: suppressionTimeline(lead),
    });
  }

  rows.sort((a, b) => {
    const ta = a.blocked_at ? Date.parse(a.blocked_at) : 0;
    const tb = b.blocked_at ? Date.parse(b.blocked_at) : 0;
    return tb - ta;
  });
  return rows;
}

module.exports = {
  collectSuppressions,
  // テスト用に公開
  sourceEventLabel,
  suppressionTimeline,
  REASON_PROVIDER,
};
