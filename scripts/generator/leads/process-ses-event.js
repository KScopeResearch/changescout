/**
 * process-ses-event.js — PJ2 Phase3次工程: SESイベント（配信・開封・クリック・バウンス・
 * 苦情）をLeadへ反映するコアロジック。
 *
 * 【今回のスコープ】AWSへの実接続（SNS/Lambda/API Gateway/EventBridge等）は含まない。
 * 将来、それらの経路（webhookハンドラ等）から呼ばれる想定の「SESイベントJSON（1件）→
 * Lead更新」というコア処理のみを実装する。トランスポート層（SNS通知のエンベロープ解析、
 * HTTPリクエストのパース、署名検証等）は本モジュールの責務外とし、呼び出し側が
 * 既にSESイベント本体（後述の形状）まで解決済みの状態でprocessSesEvent()を呼ぶ前提とする。
 *
 * 【入力形状（要検証事項）】Amazon SESのイベント発行（event publishing）が生成する
 * JSON（SNS経由で配信される場合はSNS通知のMessageフィールドの中身）を想定して設計した:
 *   {
 *     "eventType": "Delivery"|"Open"|"Click"|"Bounce"|"Complaint",
 *     "mail": { "messageId": "...", "tags": { "lead_id": ["<lead_id>"] }, ... },
 *     "delivery": {...} | "open": {...} | "click": {...} | "bounce": {...} | "complaint": {...}
 *   }
 * この形状はAWS公式ドキュメントの一般的な記述に基づく設計であり、実際のAWS接続を
 * 行う次タスクで、実イベントのJSONと照合して細部（フィールド名等）を検証すること
 * （llm/deepseek-provider.js等の外部API連携が「要最新確認」の注記を残しているのと同じ
 * 姿勢。ネットワーク接続を伴わない今回のタスクではこれ以上の検証ができない）。
 *
 * 【Lead特定方法】emailやreport_tokenは一切使わず、SES message tag（send-initial-report.js
 * が付与する {Name:"lead_id", Value:lead.lead_id}）のみでLeadを特定する
 * （mail.tags.lead_id[0]）。findLeadByEmail()等、他の特定手段は使わない。
 *
 * 【設計方針】lead-store.js/process-validated.jsと同じ方針を踏襲する。イベントの
 * parse/正規化（Pure Function、副作用なし）と、readLead/updateLead/appendHistoryを使う
 * I/O（processSesEvent()）を明確に分離する。独自のLead保存ロジック・独自の
 * historyイベント名は作らない（VALID_EVENTSに既存のemail_delivered/email_opened/
 * email_clicked/email_bounced/email_complaintをそのまま使う。lead-store.js自体は
 * 今回変更していない）。
 *
 * 【delivery_statusの扱い（確定仕様）】
 *   email_bounced   → delivery_status = "bounced"
 *   email_complaint → delivery_status = "suppressed"
 *   email_delivered / email_opened / email_clicked → delivery_statusは変更しない
 * ただし、既存のdelivery_statusが"unsubscribed"の場合は、いかなるメールイベントでも
 * 変更しない（「unsubscribedもメールイベントによって変更しない」という確定仕様どおり）。
 *
 * 【bounced⇔suppressed間の優先順位について（未確定・要判断）】"bouncedを勝手にactiveへ
 * 戻さない""suppressedを勝手にactiveへ戻さない"という確定仕様は明示されているが、
 * 「既にsuppressedのLeadに後からemail_bouncedイベントが届いた場合にbouncedへ書き換えて
 * 良いか（またはその逆）」については既存仕様に明記がない。今回は仕様を勝手に追加せず、
 * 各イベントの個別ルール（bounced→bounced、complaint→suppressed）をそのまま適用する
 * 最小実装とした（bounced⇔suppressed間の優先順位付けは行わない）。将来的に
 * 「complaintの方がbounceより深刻」といった優先順位が必要になった場合は、別途仕様として
 * 明示的に決定すべき（完了報告で提起する）。
 *
 * 【重複イベントへの対応（未確定・最小実装）】SESイベント通知（SNS経由の場合は特に）は
 * 再送・重複が起こりうる。email_bounced/email_complaintによるdelivery_status書き込みは
 * updateLead()のpatch方式により自然にべき等（同じ値を複数回書いても状態は壊れない）。
 * 一方、email_delivered/email_opened/email_clickedは「同じ内容の通知が重複配信された」
 * のか「受信者が実際に複数回開封・クリックした」のかを区別する手段が無く（重複排除用の
 * 一意なイベントIDを永続化する仕組みは今回のスコープ外）、既存仕様にも重複排除の明示が
 * ないため、historyへの重複排除は行わない最小実装とした（受信したイベントをそのまま
 * 記録する。開封・クリックは複数回発生しうる正当なイベントであるため、これ自体は
 * 不合理ではない）。将来的に重複排除が必要と判断された場合は、処理済みイベントID等の
 * 追加設計が必要になる（完了報告で提起する）。
 */

const { readLead, updateLead, appendHistory } = require("./lead-store");

// ---------------------------------------------------------------------------
// SESイベントタイプ ⇔ Leadライフサイクルのhistoryイベント名の対応
// ---------------------------------------------------------------------------

const EVENT_TYPE_MAP = {
  Delivery: "email_delivered",
  Open: "email_opened",
  Click: "email_clicked",
  Bounce: "email_bounced",
  Complaint: "email_complaint",
};

// delivery_statusを変更するイベントのみ記載（それ以外はnull=変更しない）。
const DELIVERY_STATUS_FOR_EVENT = {
  email_bounced: "bounced",
  email_complaint: "suppressed",
};

// ---------------------------------------------------------------------------
// Pure Functions（parse・正規化。I/Oを行わない）
// ---------------------------------------------------------------------------

/**
 * SESイベントのeventTypeをLeadライフサイクルのhistoryイベント名へ変換する。
 * @param {*} eventType
 * @returns {string|null} 未知の場合はnull
 */
function mapEventTypeToLeadEvent(eventType) {
  return (typeof eventType === "string" && EVENT_TYPE_MAP[eventType]) || null;
}

/**
 * leadEventに対応するSESイベントJSON側の詳細フィールド名を返す
 * （"Bounce"→"bounce"のような、AWS側の命名慣例＝eventTypeの先頭小文字化）。
 * @param {string} eventType - 元のeventType（"Bounce"等）
 * @returns {string}
 */
function detailKeyFor(eventType) {
  return eventType.charAt(0).toLowerCase() + eventType.slice(1);
}

/**
 * mail.tagsからlead_idを取り出す。SESのmessage tagは
 * `{"lead_id": ["<value>"]}`という「タグ名→値の配列」形状で渡される想定。
 * @param {*} tags
 * @returns {string|null}
 */
function extractLeadIdTag(tags) {
  if (!tags || typeof tags !== "object") return null;
  const values = tags.lead_id;
  if (!Array.isArray(values) || values.length === 0) return null;
  const value = values[0];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 生のSESイベントJSONを検証・正規化する（Pure Function、I/Oなし）。
 * 不正な入力に対して例外を投げず、常に{ok:false, error}を返す
 * （呼び出し元がクラッシュしない設計にするため）。
 * @param {*} rawEvent
 * @returns {{ok:true, leadEvent:string, leadId:string, messageId:?string, detail:Object}
 *   | {ok:false, error:string}}
 */
function parseSesEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    return { ok: false, error: "SESイベントがオブジェクトではありません" };
  }

  const leadEvent = mapEventTypeToLeadEvent(rawEvent.eventType);
  if (!leadEvent) {
    return { ok: false, error: `未知のeventTypeです: ${JSON.stringify(rawEvent.eventType)}` };
  }

  const mail = rawEvent.mail;
  if (!mail || typeof mail !== "object") {
    return { ok: false, error: "SESイベントにmailフィールドがありません" };
  }

  const leadId = extractLeadIdTag(mail.tags);
  if (!leadId) {
    return { ok: false, error: "SESイベントのmessage tagにlead_idが含まれていません" };
  }

  const messageId = typeof mail.messageId === "string" && mail.messageId ? mail.messageId : null;
  const detail = rawEvent[detailKeyFor(rawEvent.eventType)];

  return {
    ok: true,
    leadEvent,
    leadId,
    messageId,
    detail: detail && typeof detail === "object" ? detail : {},
  };
}

/**
 * leadEventに応じてdelivery_statusの遷移先を返す（Pure Function）。
 * @param {string} leadEvent
 * @returns {string|null} 変更しない場合はnull
 */
function deliveryStatusForEvent(leadEvent) {
  return DELIVERY_STATUS_FOR_EVENT[leadEvent] || null;
}

/**
 * historyへ保存するmetadataを組み立てる（Pure Function）。イベント種別ごとに
 * 必要最小限の情報のみを含める。report_token・AWS credential・emailは一切含めない
 * （そもそも入力にも含まれない設計のため、構造的に混入しない）。
 * @param {string} leadEvent
 * @param {{messageId:?string, detail:Object}} params
 * @returns {Object}
 */
function buildEventMetadata(leadEvent, { messageId, detail }) {
  const base = messageId ? { message_id: messageId } : {};

  switch (leadEvent) {
    case "email_bounced":
      return {
        ...base,
        bounce_type: typeof detail.bounceType === "string" ? detail.bounceType : null,
        bounce_sub_type: typeof detail.bounceSubType === "string" ? detail.bounceSubType : null,
      };
    case "email_complaint":
      return {
        ...base,
        // complaintFeedbackTypeはSES側が任意で付与するフィールド（受信者のメールプロバイダが
        // フィードバックタイプを提供した場合のみ存在）。無い場合も苦情イベント自体は有効。
        complaint_feedback_type: typeof detail.complaintFeedbackType === "string" ? detail.complaintFeedbackType : null,
      };
    case "email_opened":
      // UA/IPはSESイベントにそのまま含まれる情報をそのまま保存するのみで、追加の
      // 収集・加工（逆引き・フィンガープリンティング等）は一切行わない。
      return {
        ...base,
        user_agent: typeof detail.userAgent === "string" ? detail.userAgent : null,
        ip_address: typeof detail.ipAddress === "string" ? detail.ipAddress : null,
      };
    case "email_clicked":
      return {
        ...base,
        url: typeof detail.link === "string" ? detail.link : null,
      };
    case "email_delivered":
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// I/O（Leadの読み書き）
// ---------------------------------------------------------------------------

/**
 * 1件のSESイベントを処理し、Leadのdelivery_status・historyへ反映する。
 * ネットワーク接続は行わない（呼び出し元が既にJSONへ解決済みのイベントを渡す前提）。
 * 【PJ2次工程】lead-store.jsのバックエンド抽象化（filesystem/S3）に伴い、
 * readLead/updateLead/appendHistoryが非同期になったため、本関数もasyncにした。
 * @param {Object} rawEvent - SESイベントJSON（parseSesEvent()参照）
 * @returns {Promise<{ok:boolean, leadId?:string, event?:string, error?:string}>}
 */
async function processSesEvent(rawEvent) {
  const parsed = parseSesEvent(rawEvent);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const { leadEvent, leadId, messageId, detail } = parsed;

  let lead;
  try {
    lead = await readLead(leadId);
  } catch (e) {
    // lead_idが不正な形式（lead-store.jsのvalidateSlug()検証に失敗）の場合もreadLead()は
    // 例外を投げるが、実在しないlead_idと区別せず「見つからない」として扱う
    // （Phase4-A/B APIのhandlePhase4Action()と同じ既存パターン）。
    lead = null;
  }
  if (!lead) {
    return { ok: false, leadId, error: `存在しないlead_idです: ${leadId}` };
  }

  // delivery_statusは「unsubscribedはメールイベントによって変更しない」という確定仕様に
  // 従い、既にunsubscribedの場合は一切書き換えない。email_delivered/opened/clickedは
  // そもそもDELIVERY_STATUS_FOR_EVENTに定義がないため対象外（常にnull）。
  const targetDeliveryStatus = deliveryStatusForEvent(leadEvent);
  if (targetDeliveryStatus && lead.delivery_status !== "unsubscribed") {
    await updateLead(leadId, { delivery_status: targetDeliveryStatus });
  }

  const metadata = buildEventMetadata(leadEvent, { messageId, detail });
  await appendHistory(leadId, leadEvent, metadata);

  return { ok: true, leadId, event: leadEvent };
}

module.exports = {
  processSesEvent,
  // Pure Functions（テスト・呼び出し元での再利用のために公開）
  parseSesEvent,
  mapEventTypeToLeadEvent,
  deliveryStatusForEvent,
  buildEventMetadata,
  extractLeadIdTag,
};
