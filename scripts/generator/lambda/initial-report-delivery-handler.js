/**
 * initial-report-delivery-handler.js — Phase 3-D Lambda実装: status:"report_generated"の
 * Leadへ初期レポートメールを送信する処理をAWS Lambdaから呼び出すための薄いadapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`leads/send-initial-report.js`の
 * `sendInitialReportsForAllReportGenerated()`（全件処理）・`sendInitialReportForLead()`
 * （単一Lead処理）をそのまま呼ぶだけ。公開状態の判定（isPublished()、
 * published-store.js経由でPUBLISHED_STORE_BACKEND=s3時はS3がcanonical state）・
 * blastengine送信（blastengine-client.js、Phase45 STEP3Bでses-client.jsから切り替え）・
 * Lead status遷移（lead-store.js）は既存実装がそのまま担う。
 *
 * 【job-runnerを使わない理由】send-initial-report.js自身のヘッダコメントに既に
 * 明記されている通り、jobs/job-runner.js・job-store.jsはプロセス内メモリで状態を
 * 保持する設計であり、website/aor-admin/server.js（常駐プロセス）内で動かす前提の
 * 仕組みである。本handlerもそれに倣い、job-runner経由にはしない
 * （send-initial-report.jsは元々job-runnerに依存しない独立したCLI/関数として
 * 実装されており、この点は今回のLambda化にあたって変更不要だった）。
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のLambda作成はしない）】
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION
 *   - PUBLISHED_STORE_BACKEND=s3, PUBLISHED_STORE_S3_BUCKET
 *     （未設定時はfilesystem backendとなり、website/aor/data/への書き込みを前提と
 *     するLambda実行環境では公開判定が常にfalseになる。Lambdaで使う場合は必須）
 *   - BLASTENGINE_USER_ID, BLASTENGINE_API_KEY, BLASTENGINE_FROM, AOR_SITE_BASE_URL
 *     （未設定時はsendInitialReportForLead()が明示的なエラーを返す。既存のCLIと同じ
 *     事前チェックを本handlerでも行う。下記参照。BLASTENGINE_REPLY_TOは任意）
 *   - Weekly側のLambda（weekly-report-delivery-handler.js）は引き続きSES_FROM等の
 *     SES用環境変数・AWS Execution Role経由のAWS認証情報解決を使用する（本ファイルの
 *     変更対象外、Phase45 STEP3Dでも一切変更していない）
 *
 * 【想定イベント形式】
 *   { "mode": "all" }                              // 既定。report_generated全件を処理
 *   { "mode": "single", "lead_id": "..." }          // 指定した1件のみ処理
 * modeを省略した場合は"all"として扱う（既存CLI（node send-initial-report.js、
 * 引数なし実行）の既定動作と一致させるため）。
 *
 * 【戻り値】
 *   mode:"all"    → sendInitialReportsForAllReportGenerated()の戻り値をそのまま返す
 *                   {summary:{total,sent,skipped,failed}, results:Array}
 *   mode:"single" → sendInitialReportForLead()の戻り値をそのまま返す
 *                   {ok, leadId, skipped?, messageId?, error?}
 * blastengine送信の一時的失敗（status:"initial_report_failed"）は業務上の正常な結果として
 * ok:falseで返す（例外にしない。既存のsendInitialReportForLead()の契約をそのまま
 * 維持する）。event自体の形が不正な場合（mode:"single"なのにlead_id無し等）のみ
 * 例外を投げる。
 */

// 【テスト容易性】プロパティアクセスにすることで、テスト側からsendInitialReportModule.
// sendInitialReportForLead/sendInitialReportsForAllReportGeneratedを差し替え可能にしている
// （既存コードベースの他ファイルと同じモック差し替えパターン。blastengine実送信を伴う
// テストを避けるため）。
const sendInitialReportModule = require("../leads/send-initial-report");
// PJ2 AOR Phase45 STEP3D: send-initial-report.jsがPhase45 STEP3Bでses-client.jsから
// blastengine-client.jsへ切り替わったため、このLambda adapterの事前環境変数チェックも
// 合わせて切り替える（不整合の解消。Weekly側のLambda adapterはses-client.jsのまま、
// 一切変更しない）。
const mailClient = require("../leads/blastengine-client");

/**
 * @param {{mode?: "all"|"single", lead_id?:string}} event
 * @returns {Promise<Object>}
 */
async function handler(event) {
  const mode = (event && event.mode) || "all";
  if (mode !== "all" && mode !== "single") {
    throw new Error(`initial-report-delivery-handler: 未知のmodeです: "${mode}"（"all" または "single"）`);
  }

  // 既存CLI（send-initial-report.jsのmain()）と同じ事前チェック。個別Lead処理の
  // たびに同じエラーを繰り返し表示するのを避けるため、送信を試みる前にまとめて確認する
  // （既存の2つのexport済み関数を呼ぶだけで、判定ロジック自体は再実装していない）。
  const missing = [...mailClient.missingEnvVars(), ...sendInitialReportModule.missingSiteConfig()];
  if (missing.length) {
    throw new Error(`initial-report-delivery-handler: 送信に必要な環境変数が設定されていません: ${missing.join(", ")}`);
  }

  if (mode === "single") {
    const leadId = event && event.lead_id;
    if (!leadId || typeof leadId !== "string") {
      throw new Error('initial-report-delivery-handler: mode:"single"にはevent.lead_id（文字列）が必須です');
    }
    return sendInitialReportModule.sendInitialReportForLead(leadId);
  }

  return sendInitialReportModule.sendInitialReportsForAllReportGenerated();
}

module.exports = { handler };
