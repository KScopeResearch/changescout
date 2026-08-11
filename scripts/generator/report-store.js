/**
 * report-store.js — report.json バックエンド抽象化（PJ2 AOR Phase B-1〜B-3でfilesystem、
 * Phase B-7でS3を実装）。
 *
 * 【目的】company-context-store.js・review/review-store.jsで確立したfilesystem/S3
 * バックエンド切替パターンを、report.jsonへ横展開する。Phase B-7で、company-context-store.js・
 * review-store.jsと同じ2択（filesystem/s3）のbackend切替が完成した
 * （詳細は下記【スコープ】参照）。
 *
 * 【最小インタフェース】(backends/*.js参照。company-context-store.js・review-store.jsと同型)
 *   readReport(slug) => Promise<Object|null>   -- 存在しなければnull
 *   writeReport(slug, report) => Promise<void>
 *
 * 【updateReport()を作らない理由】report.jsonの唯一のread-modify-write箇所
 * （jobs/job-engine.jsのrunQualityCheck()）は、呼び出し側で
 * `report = await loadReport(slug); report.evaluation = evaluation; await saveReport(slug, report);`
 * という手動load→mutate→saveで正確に表現できる。company-context-store.js・review-store.jsの
 * いずれも同じ理由でupdate*()相当のAPIを持たない（review-engine.jsのPure Functionで
 * 新しいreview objectを組み立ててからsaveReview()を1回呼ぶのと同じパターン）。
 * report backendだけ特別な仕組みを導入すると3つのstoreの設計が不揃いになるため、
 * ここでもloadReport/saveReportのみに限定する。
 *
 * 【listReports()等を作らない理由】company_slugの一覧取得は既にcompany-index.jsの
 * listCompanySlugs({source:"report"})が担っている（責務分離。詳細はcompany-index.jsの
 * ヘッダコメント参照）。本モジュールは「指定されたcompany_slugのreport.jsonの内容を
 * 読み書きする」ことだけに責務を限定する。publishReport()/unpublishReport()は
 * 既存のpublish-report.js/unpublish-report.jsという別レイヤーの責務であり、
 * 本モジュールのI/O抽象化とは混ぜない（今回はこれらのファイルにも一切手を入れない）。
 * deleteReport()は、現在report.jsonを削除する処理がコードベースのどこにも存在しないため、
 * 需要の裏付けがなく見送る。
 *
 * 【スコープ】環境変数REPORT_STORE_BACKEND（既定"filesystem"）でバックエンドを切り替える。
 * Phase B-7時点で"filesystem"・"s3"のいずれも利用可能（company-context-store.js・
 * review-store.jsと同じ2択）。未知の値は明示的エラーにする。S3 backend
 * （report-store/backends/s3-backend.js）はcompany-context-store/review-storeのS3
 * backendと完全に同じ設計パターン（<prefix><slug>.jsonというフラットなキー、
 * options.client経由のテスト用クライアント注入、SSE-S3既定暗号化）を踏襲している
 * （新しい独自方式は導入していない）。
 */

/**
 * 環境変数REPORT_STORE_BACKENDに応じたバックエンドモジュールを返す（既定"filesystem"）。
 * company-context-store.js/review-store.jsのgetBackend()と同じ切り替え方式。
 * @returns {{readReport:Function, writeReport:Function}}
 */
function getBackend() {
  const backendId = (process.env.REPORT_STORE_BACKEND || "filesystem").toLowerCase();
  if (backendId === "filesystem") return require("./report-store/backends/filesystem-backend");
  if (backendId === "s3") return require("./report-store/backends/s3-backend");
  throw new Error(
    `未知のREPORT_STORE_BACKENDです: "${backendId}"（"filesystem" または "s3" を指定してください）`
  );
}

/**
 * company_slugに対応するreportを読み込む（I/O）。存在しない場合はnullを返す。
 * @param {string} slug
 * @param {{client?:Object}} [options] - S3使用時、テスト用のモッククライアントを注入するためのフック（省略可）
 * @returns {Promise<Object|null>}
 */
async function loadReport(slug, options = {}) {
  return getBackend().readReport(slug, options);
}

/**
 * company_slugに対応するreportを保存する（I/O）。
 * @param {string} slug
 * @param {Object} report
 * @param {{client?:Object}} [options] - S3使用時、テスト用のモッククライアントを注入するためのフック（省略可）
 * @returns {Promise<void>}
 */
async function saveReport(slug, report, options = {}) {
  await getBackend().writeReport(slug, report, options);
}

module.exports = { loadReport, saveReport };
