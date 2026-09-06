/**
 * ses-event-handler.js — PJ2 AOR: Candidate/Approved分離仕様のAWS再申請対応で追加。
 * SNS経由で届くSESイベント通知（Delivery/Open/Click/Bounce/Complaint）を、
 * scripts/generator/leads/process-ses-event.js のコアロジックへ渡す薄いLambda adapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`leads/process-ses-event.js`の
 * `processSesEvent()`をそのまま呼ぶだけ（他3つのLambda adapter、
 * lead-intake-handler.js・initial-report-delivery-handler.js・
 * weekly-report-delivery-handler.jsと同じ方針）。
 *
 * 【想定イベント形式】SESのConfiguration Set Event Destination → SNS Topic → この
 * Lambdaという配線を想定する（SNSがLambdaを直接invokeする、SNS→Lambdaサブスクリプション
 * 形式）。
 *   {
 *     "Records": [
 *       {
 *         "EventSource": "aws:sns",
 *         "Sns": { "Message": "<SESイベントJSON文字列>", ... }
 *       }
 *     ]
 *   }
 * `Sns.Message`の中身は、process-ses-event.jsのparseSesEvent()が期待する形状
 * （{eventType, mail, bounce|complaint|delivery|open|click}）そのもの。1回のLambda
 * 呼び出しで複数Recordsが届きうるため、全件を順に処理する。
 *
 * 【エラー処理】1レコードの処理失敗（不正なJSON、存在しないlead_id等）が他のレコードの
 * 処理を止めないよう、レコード単位でtry/catchする。event自体の形が不正な場合
 * （Records配列が無い等）のみ例外を投げる（lead-intake-handler.js等、既存adapterと
 * 同じ「入力形状の異常」と「業務上の正常な失敗」を区別する方針）。
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のIAM Role・SNS Topic・
 * SES Configuration Set・Subscriptionの作成はデプロイ時に別途行う）】
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION
 *   - AWS認証情報はLambda Execution Roleから自動解決される（他3つのLambdaと同じ）
 */

// 【テスト容易性】プロパティアクセス（require時の分割代入をしない）にすることで、
// テスト側からprocessSesEventModule.processSesEventを差し替え可能にしている
// （lambda-initial-report-delivery-handler.test.js等、既存adapterのテストと同じパターン）。
const processSesEventModule = require("../leads/process-ses-event");

/**
 * SNSレコード1件からSESイベントJSONを取り出し、processSesEvent()へ渡す。
 * @param {{Sns?: {Message?: string}}} record
 * @returns {Promise<{ok:boolean, leadId?:string, event?:string, error?:string}>}
 */
async function processOneRecord(record) {
  const rawMessage = record && record.Sns && record.Sns.Message;
  if (typeof rawMessage !== "string") {
    return { ok: false, error: "SNSレコードにSns.Message（文字列）が含まれていません" };
  }

  let sesEvent;
  try {
    sesEvent = JSON.parse(rawMessage);
  } catch (e) {
    return { ok: false, error: "Sns.Messageが不正なJSONです" };
  }

  try {
    return await processSesEventModule.processSesEvent(sesEvent);
  } catch (err) {
    // processSesEvent()自体は業務上の失敗をok:falseで返す契約だが（存在しないlead_id等）、
    // S3の一時的な障害等でこの契約を超えて例外を投げるケースもありうる。1レコードの
    // 予期しない失敗で他のレコードの処理を止めないよう、ここで吸収してok:falseへ変換する。
    return { ok: false, error: err.message };
  }
}

/**
 * @param {{Records?: Array<{Sns?: {Message?: string}}>}} event
 * @returns {Promise<{results: Array<{ok:boolean, leadId?:string, event?:string, error?:string}>}>}
 */
async function handler(event) {
  const records = event && event.Records;
  if (!Array.isArray(records)) {
    throw new Error("ses-event-handler: event.Records（配列）が必須です");
  }

  const results = [];
  for (const record of records) {
    // eslint-disable-next-line no-await-in-loop
    const result = await processOneRecord(record);
    results.push(result);
  }

  return { results };
}

module.exports = { handler, processOneRecord };
