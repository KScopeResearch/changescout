/**
 * company-context-store.js — company_context.json バックエンド抽象化のPoC（PJ2次工程）。
 *
 * 【目的】leads/lead-store.js・review/review-store.jsで確立した filesystem/S3 バックエンド
 * 切替パターンを、company_context.jsonへ横展開する。company_context.jsonは、
 * report.jsonと異なり「生成して書くだけ」でread-modify-write競合が存在しないため
 * （generate-company-report.js・job-engine.jsのsearch-refreshともに、既存の
 * company_context.jsonを読み返してから書き戻す処理を一切持たない。詳細は各backend/
 * 呼び出し元のコメント参照）、review-store.jsよりもさらに単純な
 * loadCompanyContext/saveCompanyContextのみのinterfaceで完結する
 * （updateCompanyContext相当のAPIは不要）。
 *
 * 【既存のcompany-context.js（buildCompanyContext）とは別モジュールにした理由】
 * company-context.jsのbuildCompanyContext()はfetch→merge→normalize→dedupe→score→
 * 関連性ガードという生成ロジックそのものであり、I/Oを一切行わない（戻り値を返すだけの
 * 純粋な非同期関数）。本モジュールはその生成結果の永続化（保存・取得）だけを担当し、
 * 生成ロジックには一切関与しない（責務分離）。
 *
 * 【バックエンドが公開すべき最小インタフェース】(backends/*.js参照。review-store.jsと同型)
 *   readCompanyContext(slug) => Promise<Object|null>   -- 存在しなければnull
 *   writeCompanyContext(slug, context) => Promise<void>
 *
 * 環境変数COMPANY_CONTEXT_STORE_BACKEND（既定"filesystem"）でバックエンドを切り替える
 * （LEAD_STORE_BACKEND・REVIEW_STORE_BACKENDと対称の命名。ただし値は独立しており、
 * Lead/review側の設定には一切影響しない）。
 *
 * 【PJ2 AOR: loadCompanyContext()へのoptions引数追加】job-runner.jsのcompany_context
 * 内容読み込みbackend非依存化PoCの一環で、loadCompanyContext(slug, options)がoptionsを
 * そのままbackendへ渡すようにした（company-index.jsのlistCompanySlugs(params, options)と
 * 同じ、テスト時のS3Client相当モック注入用フック）。既存呼び出し元（generate-company-report.js・
 * job-engine.js）はoptionsを渡さず`loadCompanyContext(slug)`のまま呼んでおり、
 * filesystem-backendのreadCompanyContext(slug)はoptionsを受け取らない（余分な引数は
 * 単に無視される）ため、既存の挙動・呼び出し方に一切影響しない後方互換な追加。
 */

/**
 * 環境変数COMPANY_CONTEXT_STORE_BACKENDに応じたバックエンドモジュールを返す（既定"filesystem"）。
 * lead-store.js/review-store.jsのgetBackend()と同じ、2択の単純な切り替えのみ。
 * @returns {{readCompanyContext:Function, writeCompanyContext:Function}}
 */
function getBackend() {
  const backendId = (process.env.COMPANY_CONTEXT_STORE_BACKEND || "filesystem").toLowerCase();
  if (backendId === "filesystem") return require("./company-context-store/backends/filesystem-backend");
  if (backendId === "s3") return require("./company-context-store/backends/s3-backend");
  throw new Error(
    `未知のCOMPANY_CONTEXT_STORE_BACKENDです: "${backendId}"（"filesystem" または "s3" を指定してください）`
  );
}

/**
 * company_slugに対応するcompany_contextを読み込む（I/O）。存在しない場合はnullを返す。
 * @param {string} slug
 * @param {{client?:Object}} [options] - S3使用時、テスト用のモッククライアントを注入するためのフック（省略可）
 * @returns {Promise<Object|null>}
 */
async function loadCompanyContext(slug, options = {}) {
  return getBackend().readCompanyContext(slug, options);
}

/**
 * company_slugに対応するcompany_contextを保存する（I/O）。
 * @param {string} slug
 * @param {Object} context
 * @returns {Promise<void>}
 */
async function saveCompanyContext(slug, context) {
  await getBackend().writeCompanyContext(slug, context);
}

module.exports = { loadCompanyContext, saveCompanyContext };
