/**
 * delivery-log.js — AOR Admin v2 Delivery UI 用の read-only 配信イベント抽出
 * （Phase52 STEP6）。
 *
 * 【背景】現行の AOR には「配信レコード」を独立して持つストアは存在しない。配信の事実は
 * すべて Lead.history[] のイベントとして記録される（送信は send-initial-report.js /
 * send-weekly-report.js、結果は process-ses-event.js / process-blastengine-event.js）。
 * この関数は複数 Lead の history を横断し、配信系イベントだけを平坦な1行=1イベントの
 * 配列へ変換する。集計（件数）は dashboard-aggregates.collectDeliverySummary を使う。
 *
 * 【設計方針】
 *   - read-only。Lead を更新しない。
 *   - type / provider は「Frontend で推測しない」ための Backend 側の対応付け。現行の
 *     確定アーキテクチャ（Initial=blastengine / Weekly=SES）と、bounce イベントの
 *     metadata.provider（process-blastengine-event.js が付与）に基づく。これは
 *     collectSuppressionSummary が metadata.event_type で分類しているのと同じ考え方で、
 *     新しい配信スキーマの発明ではない。
 *   - metadata から token / secret / credential 等を必ず落とす（sanitizeMetadata）。
 *   - options.leads が渡されればそれを使う（テスト用 DI。dashboard-aggregates と同じ）。
 */

const { listLeads } = require("../leads/lead-store");

async function resolveLeads(options = {}) {
  return Array.isArray(options.leads) ? options.leads : listLeads();
}

// 配信系 history イベント → 人間可読な結果（outcome）
const OUTCOME = {
  initial_report_queued: "queued",
  initial_report_sent: "sent",
  initial_report_failed: "failed",
  weekly_report_sent: "sent",
  weekly_report_failed: "failed",
  email_delivered: "delivered",
  email_opened: "opened",
  email_clicked: "clicked",
  email_bounced: "bounced",
  email_complaint: "complaint",
};

const INITIAL_EVENTS = new Set(["initial_report_queued", "initial_report_sent", "initial_report_failed"]);
const WEEKLY_EVENTS = new Set(["weekly_report_sent", "weekly_report_failed"]);
const RESULT_EVENTS = new Set(["email_delivered", "email_opened", "email_clicked", "email_bounced", "email_complaint"]);

// metadata から除外するキー（部分一致・大文字小文字無視）。秘密情報を UI へ出さないため。
const SECRET_KEY_RE = /token|secret|credential|password|api[_-]?key|authorization|auth_token/i;

/** metadata の浅いコピーを作り、秘密情報らしきキーを落とす（Pure Function）。 */
function sanitizeMetadata(md) {
  if (!md || typeof md !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(md)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 送信イベント（*_report_sent）の message_id → {type, provider} 索引を作る。
 * email_delivered 等の結果イベントを Initial/Weekly のどちらに紐づくか判定するために使う。
 */
function buildSendIndex(leads) {
  const index = new Map();
  for (const lead of leads) {
    const history = Array.isArray(lead.history) ? lead.history : [];
    for (const e of history) {
      const mid = e && e.metadata && e.metadata.message_id;
      if (!mid) continue;
      if (e.event === "initial_report_sent") index.set(mid, { type: "initial", provider: "blastengine" });
      else if (e.event === "weekly_report_sent") index.set(mid, { type: "weekly", provider: "ses" });
    }
  }
  return index;
}

/**
 * 1件の配信イベント行の type / provider を決める（Pure Function）。
 * - Initial 系イベント → initial / blastengine
 * - Weekly 系イベント  → weekly / ses
 * - email_bounced で metadata.provider === "blastengine" → initial / blastengine
 * - その他の結果イベント → provider は metadata.provider があればそれ、無ければ "ses"
 *   （process-ses-event.js のみが生成するため）。type は message_id で送信イベントに
 *   一致すればそれ、無ければ null（推測しない）。
 */
function resolveTypeProvider(entry, sendIndex) {
  const event = entry.event;
  if (INITIAL_EVENTS.has(event)) return { type: "initial", provider: "blastengine" };
  if (WEEKLY_EVENTS.has(event)) return { type: "weekly", provider: "ses" };

  const md = entry.metadata || {};
  if (event === "email_bounced" && md.provider === "blastengine") {
    return { type: "initial", provider: "blastengine" };
  }
  const provider = typeof md.provider === "string" && md.provider ? md.provider : "ses";
  const matched = md.message_id ? sendIndex.get(md.message_id) : null;
  return { type: matched ? matched.type : null, provider: matched ? matched.provider : provider };
}

/**
 * すべての Lead の history から配信系イベントを抽出し、1行=1イベントの配列を返す（at 降順）。
 * @param {{leads?: Object[]}} [options]
 * @returns {Promise<Array<{
 *   lead_id:string, email:string, company_slug:(string|null), company_url:(string|null),
 *   delivery_status:string, delivery_approval_status:(string|undefined),
 *   at:(string|null), event:string, type:(string|null), provider:(string|null),
 *   outcome:string, metadata:Object
 * }>>}
 */
async function collectDeliveries(options = {}) {
  const leads = await resolveLeads(options);
  const sendIndex = buildSendIndex(leads);
  const rows = [];

  for (const lead of leads) {
    const history = Array.isArray(lead.history) ? lead.history : [];
    for (const entry of history) {
      if (!entry || !OUTCOME[entry.event]) continue;
      const { type, provider } = resolveTypeProvider(entry, sendIndex);
      rows.push({
        lead_id: lead.lead_id,
        email: lead.email,
        company_slug: lead.company_slug || null,
        company_url: lead.company_url || null,
        delivery_status: lead.delivery_status,
        delivery_approval_status: lead.delivery_approval_status,
        at: entry.at || null,
        event: entry.event,
        type,
        provider,
        outcome: OUTCOME[entry.event],
        metadata: sanitizeMetadata(entry.metadata),
      });
    }
  }

  rows.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0;
    const tb = b.at ? Date.parse(b.at) : 0;
    return tb - ta;
  });
  return rows;
}

module.exports = {
  collectDeliveries,
  // テスト用に公開
  sanitizeMetadata,
  resolveTypeProvider,
  buildSendIndex,
  RESULT_EVENTS,
};
