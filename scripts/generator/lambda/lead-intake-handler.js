/**
 * lead-intake-handler.js — Phase 3-D Lambda実装: PJ2 AOR Step①→②（email起点のLead投入）を
 * AWS Lambdaから呼び出すための薄いadapter。
 *
 * 【設計方針】ロジックは一切ここに持たない。既存の
 * `leads/create-lead-from-email.js`（createLeadFromEmail()）をそのまま呼ぶだけ。
 * company inference（company-inference.js）・Lead保存（lead-store.js、
 * LEAD_STORE_BACKEND=s3でS3永続化）は既存実装がそのまま担う。
 *
 * 【前提となるLambda実行環境の設定（今回はコード側のみ。実際のLambda作成はしない）】
 *   - LEAD_STORE_BACKEND=s3, LEAD_STORE_S3_BUCKET, AWS_REGION
 *   - AWS認証情報はLambda Execution Roleから自動解決される
 *     （@aws-sdk/credential-provider-nodeの既定チェーン。環境変数への
 *     Access Key直書きは不要・非推奨）
 *   - SEARCH_PROVIDER等の検索provider設定（company-inference.jsが
 *     fetch-company.js/search-client.js経由で使用）
 *
 * 【想定イベント形式】
 *   {
 *     "email": "taro@example.co.jp",      // 必須
 *     "source": "some-campaign",           // 任意（省略時はcreateLeadFromEmail()の既定値 "email_inference"）
 *     "collection_method": "manual"        // 任意（省略時は既定値 "manual"）
 *   }
 *
 * 【戻り値】createLeadFromEmail()の戻り値をそのまま返す
 *   {ok, lead?, inference?, reason?, error?, resubmitted?}
 * ok:falseは「email起点の企業推定ができなかった」「delivery_statusでブロック済み」等、
 * createLeadFromEmail()が定義する正常な業務結果であり、Lambda呼び出し自体を失敗
 * （例外）として扱わない。event自体の形が不正な場合（emailが無い等）のみ例外を投げる。
 *
 * 【後続処理との連携について】Step1設計の「必要に応じて後続処理を起動できる設計」に
 * ついて: 今回はreport-generation Lambdaを直接invokeする実装は行わない
 * （Lambda間の呼び出し方式—Step Functions/EventBridge/直接invoke—をどれにするかは
 * 今回未決定のアーキテクチャ判断であり、対象のLambda自体もまだ作成していないため）。
 * 戻り値に`ready_for_report_generation`（company_urlが確定し、report_generation
 * Lambdaへ渡せる状態かどうか）を含めることで、将来のオーケストレーション層が
 * この判断をLambda内部ロジックへ依存せず行えるようにしている。
 */

// 【テスト容易性】プロパティアクセス（require時の分割代入をしない）にすることで、
// テスト側からcreateLeadFromEmailModule.createLeadFromEmailを差し替え可能にしている
// （publish-report.jsのreportStore.loadReport()等、既存コードベースと同じ
// モック差し替えパターン）。ハンドラ本体の呼び出し方（1箇所のみ）は変わらない。
const createLeadFromEmailModule = require("../leads/create-lead-from-email");

/**
 * @param {{email?:string, source?:string, collection_method?:string}} event
 * @returns {Promise<{ok:boolean, lead?:Object, inference?:Object, reason?:string, error?:string, resubmitted?:boolean, ready_for_report_generation:boolean}>}
 */
async function handler(event) {
  const email = event && event.email;
  if (!email || typeof email !== "string") {
    throw new Error('lead-intake-handler: event.email（文字列）が必須です');
  }

  const result = await createLeadFromEmailModule.createLeadFromEmail(email, {
    source: event.source,
    collection_method: event.collection_method,
  });

  // ready_for_report_generation: company_urlが確定し、かつ配信ブロック対象でない場合のみtrue。
  // resubmitted（同一Lead再投入）の場合も、company_urlは既に確定しているため
  // 後続のreport-generationを重複起動しないかどうかは呼び出し側（オーケストレーション層）
  // の判断に委ねる（本handlerはあくまでヒントを返すのみで、起動そのものは行わない）。
  const readyForReportGeneration = !!(result.ok && result.lead && result.lead.company_url);

  return { ...result, ready_for_report_generation: readyForReportGeneration };
}

module.exports = { handler };
