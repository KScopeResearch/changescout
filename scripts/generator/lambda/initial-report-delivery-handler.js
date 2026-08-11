/**
 * initial-report-delivery-handler.js — Phase 3-D Lambda実装: status:"report_generated"の
 * Leadへ初期レポートメールを送信する処理をAWS Lambdaから呼び出すための薄いadapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`leads/send-initial-report.js`の
 * `sendInitialReportsForAllReportGenerated()`（全件処理）・`sendInitialReportForLead()`
 * （単一Lead処理）をそのまま呼ぶだけ。公開状態の判定（isPublished()、
 * published-store.js経由でPUBLISHED_STORE_BACKEND=s3時はS3がcanonical state）・
 * SES送信（ses-client.js）・Lead status遷移（lead-store.js）は既存実装がそのまま担う。
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
 *   - SES_FROM, AOR_SITE_BASE_URL（未設定時はsendInitialReportForLead()が
 *     明示的なエラーを返す。既存のCLIと同じ事前チェックを本handlerでも行う。下記参照）
 *   - AWS認証情報はLambda Execution Roleから自動解決される
 *     （ses-client.jsは既に@aws-sdk/credential-provider-nodeの既定チェーンを使用済み、
 *     Access Key環境変数は不要。SES SendEmail権限をExecution Roleへ付与する必要が
 *     あるが、これはIAM変更を伴うため今回は行わない）
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
 * SES送信の一時的失敗（status:"initial_report_failed"）は業務上の正常な結果として
 * ok:falseで返す（例外にしない。既存のsendInitialReportForLead()の契約をそのまま
 * 維持する）。event自体の形が不正な場合（mode:"single"なのにlead_id無し等）のみ
 * 例外を投げる。
 */

// 【テスト容易性】プロパティアクセスにすることで、テスト側からsendInitialReportModule.
// sendInitialReportForLead/sendInitialReportsForAllReportGeneratedを差し替え可能にしている
// （既存コードベースの他ファイルと同じモック差し替えパターン。SES実送信を伴う
// テストを避けるため）。
const sendInitialReportModule = require("../leads/send-initial-report");
const sesClient = require("../leads/ses-client");

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
  const missing = [...sesClient.missingEnvVars(), ...sendInitialReportModule.missingSiteConfig()];
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
