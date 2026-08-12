/**
 * weekly-report-delivery-handler.js — PJ2 AOR Phase 19: Weekly Report Delivery用の薄いLambda
 * adapter。initial-report-delivery-handler.js（Phase 3-D）と全く同じ設計方針を踏襲する。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`leads/send-weekly-report.js`（Phase 18）の
 * `sendWeeklyReportsForAllEligibleLeads()`（全件処理）・`sendWeeklyReportForLead()`
 * （単一Lead処理）をそのまま呼ぶだけ。Weekly対象判定（weekly_report_consent・status・
 * delivery_status・isPublished・published reportのgenerated_at比較）・SES送信
 * （ses-client.js）・Lead状態遷移（lead-store.js）は既存実装がそのまま担う。
 * initial-report-delivery-handler.jsと同様、business logicが返すskip/failure結果は
 * 例外に変換せずそのまま返す（例外にするのは「adapter自身の入力検証エラー」
 * 「環境変数不足」「business logic自体が投げた想定外の例外」のみ）。
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のLambda作成はしない）】
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION
 *   - PUBLISHED_STORE_BACKEND=s3, PUBLISHED_STORE_S3_BUCKET
 *     （未設定時はfilesystem backendとなり、Lambda実行環境では公開判定が意味を持たない。
 *     initial-report-delivery-handler.jsと同じ制約）
 *   - SES_FROM, AOR_SITE_BASE_URL（未設定時は下記の事前チェックで明示的なエラーを投げる）
 *   - AWS認証情報はLambda Execution Roleから自動解決される（initial側と同じ）
 *
 * 【想定イベント形式】
 *   { "mode": "all" }                              // 既定。Weekly対象の全Leadを処理
 *   { "mode": "single", "lead_id": "..." }          // 指定した1件のみ処理
 * modeを省略した場合は"all"として扱う（initial-report-delivery-handler.jsと同じ既定動作）。
 *
 * 【戻り値】
 *   mode:"all"    → sendWeeklyReportsForAllEligibleLeads()の戻り値をそのまま返す
 *                   {summary:{total,sent,skipped,failed}, results:Array}
 *   mode:"single" → sendWeeklyReportForLead()の戻り値をそのまま返す
 *                   {ok, leadId, skipped?, messageId?, error?}
 * SES送信の一時的失敗（weekly_report_failed）は業務上の正常な結果としてok:falseで返す
 * （例外にしない。initial-report-delivery-handler.jsと同じ契約）。event自体の形が不正な場合
 * （mode:"single"なのにlead_id無し等）のみ例外を投げる。
 */

// 【テスト容易性】プロパティアクセスにすることで、テスト側からsendWeeklyReportModule.
// sendWeeklyReportForLead/sendWeeklyReportsForAllEligibleLeadsを差し替え可能にしている
// （initial-report-delivery-handler.jsと同じモック差し替えパターン。SES実送信を伴う
// テストを避けるため）。
const sendWeeklyReportModule = require("../leads/send-weekly-report");
// AOR_SITE_BASE_URLの事前チェックはinitial/weeklyで共有する既存のsite config（send-initial-report.js
// が唯一の実体）をそのまま再利用する。send-weekly-report.js自体もこの関数を内部で再利用している
// （Phase18のヘッダコメント参照）ため、ここでも重複実装しない。プロパティアクセスのまま保持する
// のは、initial-report-delivery-handler.jsと同じ理由（テスト側でmissingSiteConfig自体を
// 差し替え可能にするため。requireと同時に分割代入すると、テストによる後からの差し替えが
// この関数内から見えなくなってしまう）。
const sendInitialReportModule = require("../leads/send-initial-report");
const sesClient = require("../leads/ses-client");

/**
 * @param {{mode?: "all"|"single", lead_id?:string}} event
 * @returns {Promise<Object>}
 */
async function handler(event) {
  const mode = (event && event.mode) || "all";
  if (mode !== "all" && mode !== "single") {
    throw new Error(`weekly-report-delivery-handler: 未知のmodeです: "${mode}"（"all" または "single"）`);
  }

  // 既存CLI（send-weekly-report.jsのmain()）と同じ事前チェック。個別Lead処理の
  // たびに同じエラーを繰り返し表示するのを避けるため、送信を試みる前にまとめて確認する
  // （initial-report-delivery-handler.jsと同じ設計）。
  const missing = [...sesClient.missingEnvVars(), ...sendInitialReportModule.missingSiteConfig()];
  if (missing.length) {
    throw new Error(`weekly-report-delivery-handler: 送信に必要な環境変数が設定されていません: ${missing.join(", ")}`);
  }

  if (mode === "single") {
    const leadId = event && event.lead_id;
    if (!leadId || typeof leadId !== "string") {
      throw new Error('weekly-report-delivery-handler: mode:"single"にはevent.lead_id（文字列）が必須です');
    }
    return sendWeeklyReportModule.sendWeeklyReportForLead(leadId);
  }

  return sendWeeklyReportModule.sendWeeklyReportsForAllEligibleLeads();
}

module.exports = { handler };
