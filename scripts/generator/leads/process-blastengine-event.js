/**
 * process-blastengine-event.js — PJ2 AOR Phase47 STEP1: blastengine Webhookイベント
 * （HARDERROR/DROP/SOFTERROR）をLeadへ反映するコアロジック。
 *
 * 【設計方針】process-ses-event.jsと責務を揃える。イベントの parse/正規化
 * （Pure Function、副作用なし）と、readLead/updateLead/appendHistoryを使うI/O
 * （processBlastengineEvent()）を明確に分離する。独自のLead保存ロジック・独自の
 * historyイベント名は作らない（lead-store.jsのVALID_EVENTSに既存のemail_bounced
 * をそのまま流用する。lead-store.js自体は今回変更していない）。
 *
 * 【今回のスコープ】AWSへの実接続（Lambda Function URL/API Gateway/署名検証等）は
 * 含まない。将来、lambda-blastengine-webhook-handler.jsから呼ばれる想定の
 * 「blastengine Webhookペイロード（1リクエスト）→Lead更新（複数件）」というコア処理
 * のみを実装する。トランスポート層（HTTPリクエストのパース、Basic認証検証等）は
 * 本モジュールの責務外とし、呼び出し側が既にJSONへ解決済みのpayloadを渡す前提とする。
 *
 * 【入力形状（PJ2 AOR Phase48 STEP12で公式マニュアル構造へ修正）】
 * blastengine公式Webhookマニュアル（https://blastengine.jp/webhook/ 、Phase48 STEP11で確認）
 * に掲載されている実payload構造は以下のとおり。各イベントは`events[].event`でラップされ、
 * 受信者情報・delivery_id等は`events[].event.detail`配下にネストしている:
 *   {
 *     "events": [
 *       {
 *         "event": {
 *           "type": "HARDERROR"|"SOFTERROR"|"DROP",
 *           "datetime": "2026-08-28T10:00:00+09:00",   // ISO8601、JSTオフセット付き
 *           "detail": {
 *             "mailaddress": "user@example.com",
 *             "subject": "...",
 *             "error_code": "554(errors)",             // 任意
 *             "error_message": "...",                   // 任意
 *             "delivery_id": 123,                       // 数値でも文字列でも受ける。String()で正規化
 *             "insert_codes": []                        // 任意（差し込みコード。用途未確定）
 *           }
 *         }
 *       },
 *       ...
 *     ]
 *   }
 * Phase47 STEP1では`events[]`要素にフィールドが直接並ぶflat構造を仮定していたが、これは
 * 公式マニュアル未確認の推測であり、Phase48 STEP11で誤りが判明したため本STEPで修正した。
 *
 * `parseBlastengineEvent()`の外部返却形式（正規化イベント）は、既存の呼び出し側
 * （applyOneEvent/buildEventMetadata/hasAlreadyRecordedEvent）との互換のため
 * Phase47から変更していない: {type, datetime, mailaddress, subject, error_code,
 * error_message, delivery_id, insert_codes}（flatなまま）。ネスト解除はこの関数内で行う。
 *
 * 1リクエストに複数イベントが含まれうる前提（配列）はPhase47から維持する。実Webhook受信で
 * 単一/複数いずれかが確定した時点で見直すこと。
 *
 * 【Lead特定方法（PJ2 AOR Phase47 STEP2で確定・変更）】SESのようなmessage tag
 * （lead_id直接埋め込み）はblastengineには存在しない（正式回答にもlead_id相当の
 * フィールドの言及なし）。Phase47 STEP1ではmailaddressを基点にfindLeadByEmail()で
 * 検索していたが、PJ2は「同一email×別company_urlの複数Leadを許容する」確定仕様（P0-1、
 * lead-store.js参照）を持つため、mailaddressだけでは対象Leadを一意に特定できない
 * （findLeadByEmail()は「先頭1件」を返すだけで、それが実際にこのWebhookイベントの
 * 送信元Leadである保証はない）。
 *
 * Phase47 STEP2では、send-initial-report.js（sendInitialReportForLead()）が送信成功時に
 * 必ず記録している`appendHistory(leadId, "initial_report_sent", {message_id: result.messageId})`
 * のmessage_id（blastengineの場合はblastengine-client.jsが返すdelivery_id文字列）に着目し、
 * lead-store.jsの新規関数`findLeadByInitialSendMessageId(messageId)`で、Webhookイベントの
 * delivery_idと一致するLeadを検索する方式へ変更した。delivery_idは1送信ごとにblastengineが
 * 新規発行する値であり、同一emailの別Lead・別送信と衝突しない一意な識別子であるため、
 * mailaddressに基づく推測を一切行わずに対象Leadを一意に特定できる（「先頭1件だけ更新する」
 * という以前の挙動をそのまま仕様として確定させることはしなかった）。
 *
 * 対応するLeadがdelivery_idで見つからない場合（該当する"initial_report_sent"記録が無い等）は、
 * mailaddressベースの推測にフォールバックせず、素直に「見つからない」として扱う
 * （ok:false。誤ったLeadへ反映するリスクを避けるため）。
 *
 * 【同一emailの複数Lead間でのdelivery_status伝播について（PJ2 AOR Phase47 STEP2で確定）】
 * 上記のとおりdelivery_idにより対象Leadを一意に特定できるため、HARDERROR/DROPで
 * delivery_statusを変更する対象は「そのdelivery_idの送信を受けた、その1件のLeadのみ」
 * とし、同一emailを持つ他のLead（例: 同一メールアドレスで別company_urlのLead）へは
 * 伝播させない。この判断は、既存のunsubscribe-lead.js（reply-based unsubscribeLead()）が
 * 「同一emailで複数Leadが見つかった場合、一意に特定できないためいずれも変更しない」
 * （ambiguous、複数Leadへの一括適用を避ける）という既存precedentを踏襲したものであり、
 * PJ2の既存Suppression設計はLead単位（company_urlごとに独立した送信関係を1件として扱う）
 * であって、email単位のSuppressionテーブルはこれまで一度も存在しない。なお、実際のメール
 * サーバーの観点では「同一メールアドレスが恒久的にbounceする」場合、同一emailを持つ別Lead
 * への将来送信も同様にbounceする可能性が高いが、これに対する自動的な伝播は今回実装しない
 * （5節「Suppressionとの関係」で残課題として明記する）。
 *
 * 【delivery_statusの扱い（確定仕様、docs/strategy_v2/13_architecture.md v1.1の
 * 「7. blastengine Event Mapping」参照）】
 *   HARDERROR → delivery_status = "bounced"
 *   DROP      → delivery_status = "bounced"
 *   SOFTERROR → delivery_statusは変更しない
 *   unknown（未知のtype） → delivery_statusは変更しない
 * ただし、既存のdelivery_statusが"unsubscribed"の場合は、いかなるイベントでも変更しない
 * （process-ses-event.jsと同じ確定仕様）。unsubscribed自体も既存のunsubscribe-lead.jsの
 * 設計どおりLead単位（lead_id・report_tokenの組、またはreply-based CLIでの一意特定）で
 * 扱われており、今回の変更でこの既存仕様には一切手を加えていない。
 *
 * 【重複Webhookへの対応（PJ2 AOR Phase47 STEP2で実装）】blastengineの正式回答により、
 * 同一Webhookが複数回届く可能性があり、Event IDが存在しないため、docs/strategy_v2/
 * 13_architecture.md v1.1「9. 重複Webhook仕様」で確定した delivery_id・mailaddress・
 * error_code・event.datetime の組み合わせを冪等キーとする。実装では、対象Leadが
 * findLeadByInitialSendMessageId()で一意に特定済みであるため、mailaddressの比較は不要
 * （そのLeadのhistoryを見ている時点で対象emailは既に一致している）。新しいstorageは
 * 追加せず、既存のLead.history自体を冪等性チェックに使う: delivery_id・error_code・
 * event.datetimeがすべて一致する"email_bounced"イベントが既にhistoryに記録されている
 * 場合は、updateLead()・appendHistory()のいずれも呼ばず、処理済みとして扱う
 * （hasAlreadyRecordedEvent()参照）。
 *
 * 【race conditionについて（既知の限界、今回未解決）】lead-store.jsのupdateLead()/
 * appendHistory()はread→write（await境界を挟む2回の別呼び出し）であり、同一lead_idに対する
 * 呼び出しが真に同時に発生した場合、後着の書き込みが先着の書き込みを消してしまう理論上の
 * race conditionが存在する。これはblastengine対応固有の問題ではなく、lead-store.js全体
 * （Phase4-A/B API・SESイベント処理等）が元々持つ、DBレスのファイルベース設計に起因する
 * 構造的な既知の限界である。本冪等性チェック（read-check-then-write）も、真に同時（同一
 * ミリ秒オーダー）の重複Webhook到達までは防げない。ただし、blastengineの実際の再試行は
 * 24時間以内に時間差を置いて行われる設計（正式回答で確定）であり、真の同時到達は実運用上
 * 起こりにくいと考えられる。恒久対応には条件付き書き込み（例: DynamoDBの
 * ConditionExpression）等のトランザクショナルなstorageが必要だが、今回は新規DB導入が
 * 禁止されているためスコープ外とし、既知の限界として明記するに留める。
 */

const { findLeadByInitialSendMessageId, updateLead, appendHistory } = require("./lead-store");

// ---------------------------------------------------------------------------
// blastengineイベントtype ⇔ Leadライフサイクルのhistoryイベント名の対応
// ---------------------------------------------------------------------------

// lead-store.jsのVALID_EVENTSに既存の"email_bounced"をそのまま流用する
// （新規historyイベント名は追加しない）。SOFTERROR・未知のtypeも記録自体は行うため、
// 便宜上同じ"email_bounced"名で記録する（provider:"blastengine"・event_type metadataで
// 実際の種別を区別できるようにする。下記buildEventMetadata()参照）。
const LEAD_EVENT_NAME = "email_bounced";

// delivery_statusを変更するtypeのみ記載（それ以外はnull=変更しない）。
const DELIVERY_STATUS_FOR_TYPE = {
  HARDERROR: "bounced",
  DROP: "bounced",
};

// ---------------------------------------------------------------------------
// Pure Functions（parse・正規化。I/Oを行わない）
// ---------------------------------------------------------------------------

/**
 * blastengine Webhookペイロードを検証・正規化する（Pure Function、I/Oなし）。
 * 公式マニュアル構造（`events[].event.{type,datetime,detail}`、詳細はモジュールヘッダ参照）を
 * unwrapし、flatな正規化イベントへ変換する。不正な入力に対しては例外を投げる
 * （呼び出し側のHTTPハンドラが400として扱う想定。lambda-blastengine-webhook-handler.js参照）。
 * 例外メッセージは events[index] とフィールドパスのみを含み、mailaddress等のPIIは含めない。
 * @param {*} payload
 * @returns {Array<{type:string, datetime:string, mailaddress:string, subject:?string,
 *   error_code:?string, error_message:?string, delivery_id:string, insert_codes:?Object}>}
 */
function parseBlastengineEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("blastengine Webhookペイロードがオブジェクトではありません");
  }

  if (!Array.isArray(payload.events)) {
    throw new Error("blastengine Webhookペイロードにevents配列がありません");
  }

  return payload.events.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      throw new Error(`events[${index}]がオブジェクトではありません`);
    }

    const event = rawEntry.event;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`events[${index}].eventがオブジェクトではありません`);
    }

    const { type, datetime } = event;
    if (typeof type !== "string" || !type) {
      throw new Error(`events[${index}].event.typeが必須です`);
    }
    if (typeof datetime !== "string" || !datetime) {
      throw new Error(`events[${index}].event.datetimeが必須です`);
    }

    const detail = event.detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
      throw new Error(`events[${index}].event.detailがオブジェクトではありません`);
    }

    const { mailaddress, delivery_id } = detail;
    if (typeof mailaddress !== "string" || !mailaddress) {
      throw new Error(`events[${index}].event.detail.mailaddressが必須です`);
    }
    if (typeof delivery_id !== "string" && typeof delivery_id !== "number") {
      throw new Error(`events[${index}].event.detail.delivery_idが必須です`);
    }

    return {
      type,
      datetime,
      mailaddress,
      subject: typeof detail.subject === "string" ? detail.subject : null,
      error_code: typeof detail.error_code === "string" ? detail.error_code : null,
      error_message: typeof detail.error_message === "string" ? detail.error_message : null,
      delivery_id: String(delivery_id),
      insert_codes: detail.insert_codes && typeof detail.insert_codes === "object" ? detail.insert_codes : null,
    };
  });
}

/**
 * typeに応じたdelivery_statusの遷移先を返す（Pure Function）。
 * @param {string} type
 * @returns {string|null} 変更しない場合はnull
 */
function deliveryStatusForType(type) {
  return DELIVERY_STATUS_FOR_TYPE[type] || null;
}

/**
 * historyへ保存するmetadataを組み立てる（Pure Function）。mailaddressは含めない
 * （指示書の確定仕様どおり。PIIをhistoryへ残さない既存方針との整合）。
 * @param {{type:string, datetime:?string, error_code:?string, error_message:?string, delivery_id:string}} normalizedEvent
 * @returns {Object}
 */
function buildEventMetadata({ type, datetime, error_code, error_message, delivery_id }) {
  return {
    provider: "blastengine",
    event_type: type,
    datetime,
    error_code,
    error_message,
    delivery_id,
  };
}

/**
 * 対象Leadのhistoryに、同一イベント（delivery_id・error_code・event.datetimeが全て一致する
 * "email_bounced"）が既に記録済みかどうかを判定する（Pure Function）。冪等性チェックの本体。
 * mailaddressを比較に含めない理由: 呼び出し元がfindLeadByInitialSendMessageId()で既に
 * 対象Leadを一意に特定済みであり、そのLeadのhistoryを検査している時点で対象emailは
 * 自明に一致しているため（上記モジュールヘッダの「重複Webhookへの対応」参照）。
 * @param {Object} lead
 * @param {{delivery_id:string, error_code:?string, datetime:?string}} normalizedEvent
 * @returns {boolean}
 */
function hasAlreadyRecordedEvent(lead, normalizedEvent) {
  if (!lead || !Array.isArray(lead.history)) return false;
  return lead.history.some(
    (h) =>
      h.event === LEAD_EVENT_NAME &&
      h.metadata &&
      h.metadata.delivery_id === normalizedEvent.delivery_id &&
      h.metadata.error_code === normalizedEvent.error_code &&
      h.metadata.datetime === normalizedEvent.datetime
  );
}

// ---------------------------------------------------------------------------
// I/O（Leadの読み書き）
// ---------------------------------------------------------------------------

/**
 * 正規化済みイベント1件をLeadへ反映する（I/O）。delivery_idによりLeadを一意に特定し、
 * 既に同一イベントが記録済みであれば何もせず（冪等）、そうでなければdelivery_status・
 * historyへ反映する。
 * @param {Object} normalizedEvent - parseBlastengineEvent()が返す配列の1要素
 * @returns {Promise<{ok:boolean, leadId?:string, event?:string, duplicate?:boolean, error?:string}>}
 */
async function applyOneEvent(normalizedEvent) {
  const lead = await findLeadByInitialSendMessageId(normalizedEvent.delivery_id);
  if (!lead) {
    return { ok: false, error: `該当するLeadが見つかりません（delivery_id: ${normalizedEvent.delivery_id}）` };
  }

  if (hasAlreadyRecordedEvent(lead, normalizedEvent)) {
    return { ok: true, leadId: lead.lead_id, event: LEAD_EVENT_NAME, duplicate: true };
  }

  // delivery_statusは「unsubscribedはメールイベントによって変更しない」という確定仕様に
  // 従い、既にunsubscribedの場合は一切書き換えない（process-ses-event.jsと同じ方針）。
  const targetDeliveryStatus = deliveryStatusForType(normalizedEvent.type);
  if (targetDeliveryStatus && lead.delivery_status !== "unsubscribed") {
    await updateLead(lead.lead_id, { delivery_status: targetDeliveryStatus });
  }

  const metadata = buildEventMetadata(normalizedEvent);
  await appendHistory(lead.lead_id, LEAD_EVENT_NAME, metadata);

  return { ok: true, leadId: lead.lead_id, event: LEAD_EVENT_NAME };
}

/**
 * blastengine Webhookペイロード（1リクエスト、複数イベントを含みうる）を処理し、
 * 各イベントに対応するLeadのdelivery_status・historyへ反映する。ネットワーク接続は
 * 行わない（呼び出し元が既にJSONへ解決済みのpayloadを渡す前提）。
 * @param {*} payload - blastengine Webhookペイロード（parseBlastengineEvent()参照）
 * @returns {Promise<Array<{ok:boolean, leadId?:string, event?:string, error?:string}>>}
 */
async function processBlastengineEvent(payload) {
  const normalizedEvents = parseBlastengineEvent(payload);
  const results = [];
  for (const normalizedEvent of normalizedEvents) {
    results.push(await applyOneEvent(normalizedEvent));
  }
  return results;
}

module.exports = {
  processBlastengineEvent,
  // Pure Functions（テスト・呼び出し元での再利用のために公開）
  parseBlastengineEvent,
  deliveryStatusForType,
  buildEventMetadata,
  hasAlreadyRecordedEvent,
};
