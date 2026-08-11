/**
 * report-generation-handler.js — Phase 3-D Lambda実装: company_urlを起点とした
 * AI Opportunity Report生成をAWS Lambdaから呼び出すための薄いadapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の`generate-company-report.js`の
 * `generateCompanyReport(companyUrl)`をそのまま呼ぶだけ。company_context.json/
 * report.jsonの保存先（company-context-store.js/report-store.js、S3対応済み）・
 * evaluation.mdの扱い（PJ2 AOR Phase 3-D-1でREPORT_STORE_BACKEND=s3時は生成しない
 * よう既に対応済み）は既存実装がそのまま担う。本handlerはこれらの内部実装を
 * 一切知る必要がない。
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のLambda作成はしない）】
 *   - COMPANY_CONTEXT_STORE_BACKEND=s3, COMPANY_CONTEXT_STORE_S3_BUCKET
 *   - REPORT_STORE_BACKEND=s3, REPORT_STORE_S3_BUCKET
 *   - AWS_REGION（上記2backend共通）
 *   - AWS認証情報はLambda Execution Roleから自動解決される（新規実装不要。
 *     report-store.js/company-context-store.jsのS3 backendは既に
 *     @aws-sdk/credential-provider-node相当の既定チェームを使うS3Client({region})を
 *     使用しており、Access Key環境変数を要求しない）
 *   - LLM_PROVIDER、検索provider設定（SEARCH_PROVIDER等）、各providerのAPIキー
 *     （DEEPSEEK_API_KEY・TAVILY_API_KEY等）— 【Step5: Secrets】今回はSecrets Manager
 *     を作成しない。既存のllm-client.js/search-client.jsは環境変数からAPIキーを
 *     読む設計のまま変更していない。Lambda環境変数への直書きは低セキュリティ
 *     （Lambda設定画面・CloudTrail等から平文で見える）だが、Secrets Manager導入は
 *     別途のAWSリソース作成を伴うため今回は対象外。将来Secrets Manager化する場合、
 *     Lambda起動時（ハンドラ呼び出し前）に該当環境変数へ値をセットするだけで
 *     llm-client.js/search-client.js側の変更は不要（環境変数経由という既存の
 *     読み込み契約を変えないため）。
 *
 * 【timeout設計】generateCompanyReport()は
 *   fetchCompany（最大8秒)
 *   → 並列: government/industry/news/statistics（各内部で検索クエリ×最大3回リトライ、
 *     search timeoutは既定15秒 × 最大3試行 ≈ 最大45秒、4カテゴリは並列実行）
 *   → LLM分析（既定timeout 30秒 × 最大3試行 ≈ 最大90秒）
 *  を直列に実行するため、最悪ケースで合計2〜3分程度かかりうる（Phase 3-D設計監査で
 *  確認済みの既存の見積もり）。そのため本Lambdaのtimeoutは180〜300秒を推奨する
 *  （デフォルトの3秒は論外、API Gatewayの同期呼び出し限界である29秒も不足）。
 *  今回はLambda自体を作成しないため、実際のtimeout設定値はコード上のコメントとして
 *  残すのみで、AWSリソースへの反映は行わない。
 *
 * 【retryの二重化について】LLM_MAX_RETRIES/SEARCH_MAX_RETRIES（既定いずれも2、
 * つまり最大3試行）はllm-client.js/search-client.js内部の既存retry機構
 * （指数バックオフ）であり、本handler・呼び出し元のLambda設定側では追加のretryを
 * 行わない前提とする。Lambda呼び出し元（EventBridge Scheduler等、今回は未作成）側で
 * さらにretryを設定すると、内部retryと二重に効いてしまい、1回のトリガーに対して
 * 「内部retry×外側retry」回のLLM/検索APIコールが発生しうる（コスト・レート制限の
 * 観点で危険）。将来Lambda側のretry/DLQ設定を行う場合は、内部retryが既に
 * "リトライ可能な一時的失敗"をカバー済みであることを踏まえ、外側のretry回数は
 * 0〜1回程度に抑えることを推奨する（設計コメントのみ。今回はAWS側の設定は行わない）。
 *
 * 【想定イベント形式】
 *   { "company_url": "https://example.co.jp" }   // 必須
 *
 * 【戻り値】generateCompanyReport()の戻り値をそのまま返す
 *   {context, report, evaluation, validation, slug, outDir, paths}
 * generateCompanyReport()自体が投げる例外（company_urlが空、fetch失敗等）は
 * ここで握りつぶさずそのままLambdaの呼び出し元へ伝播させる（Lambdaの失敗として
 * 記録され、EventBridge等の呼び出し元がretry/DLQ判断に使えるようにするため）。
 */

// 【テスト容易性】プロパティアクセスにすることで、テスト側からgenerateCompanyReportModule.
// generateCompanyReportを差し替え可能にしている（generateCompanyReport()自体は
// buildCompanyContext()経由で実HTTP取得を行うため、DIフックを持たない。既存コードは
// 変更せず、本ファイル側の参照方法だけをテスト容易な形にしている）。
const generateCompanyReportModule = require("../generate-company-report");

/**
 * @param {{company_url?:string}} event
 * @returns {Promise<{ok:boolean, context:Object, report:Object, evaluation:Object, validation:Object, slug:string, outDir:string, paths:Object}>}
 */
async function handler(event) {
  const companyUrl = event && event.company_url;
  if (!companyUrl || typeof companyUrl !== "string") {
    throw new Error('report-generation-handler: event.company_url（文字列）が必須です');
  }

  const result = await generateCompanyReportModule.generateCompanyReport(companyUrl);
  return { ok: true, ...result };
}

module.exports = { handler };
