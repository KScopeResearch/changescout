/**
 * published-store.js — 「company_slugが公開済みかどうか」のバックエンド抽象化
 * （PJ2 AOR Phase 3-D-1）。company-context-store.js・report-store.js・review/review-store.jsで
 * 確立したfilesystem/S3バックエンド切替パターンを、公開状態（publish-report.js/
 * unpublish-report.jsが従来website/aor/data/<slug>.jsonの存在で表現していたもの）へ横展開する。
 *
 * 【背景 / Phase 3-D設計監査で判明した課題】send-initial-report.jsはisPublished()で
 * 送信可否を判定するが、従来のisPublished()はwebsite/aor/data/<slug>.jsonという
 * ローカルファイルの存在確認（fs.existsSync）そのものであり、Lambda等の一時的な
 * 実行環境からは意味のある判定ができなかった。
 *
 * 【重要: この抽象化の外側にある既存経路は変えない】website/aor/data/配下は、
 * deploy-aor-web.js（PJ2 AOR）がローカルファイルシステムから直接読んで実公開用の
 * S3+CloudFrontへ同期する対象でもある。そのため本モジュール（及びPUBLISHED_STORE_BACKEND
 * 環境変数）はpublishReport()/unpublishReport()の中の「Lambda側公開判定用のcanonical
 * stateをどこに持つか」だけを切り替えるものであり、website/aor/data/へのローカル書き込み・
 * 削除そのものはPUBLISHED_STORE_BACKENDの値に関わらず常に行われる
 * （publish-report.js/unpublish-report.js側の責務。詳細は両ファイルのコメント参照）。
 *
 * 【最小インタフェース】(backends/*.js参照。company-context-store.js等と同型)
 *   existsPublished(slug) => Promise<boolean>
 *   readPublished(slug)   => Promise<Object|null>   -- 存在しなければnull
 *   writePublished(slug, report) => Promise<void>
 *   deletePublished(slug) => Promise<void>           -- 冪等（存在しなくてもエラーにしない）
 *
 * 環境変数PUBLISHED_STORE_BACKEND（既定"filesystem"）でバックエンドを切り替える
 * （LEAD_STORE_BACKEND・REPORT_STORE_BACKEND等と対称の命名。値は独立しており、
 * 他storeの設定には一切影響しない）。
 */

/**
 * 環境変数PUBLISHED_STORE_BACKENDに応じたバックエンドモジュールを返す（既定"filesystem"）。
 * @returns {{existsPublished:Function, readPublished:Function, writePublished:Function, deletePublished:Function}}
 */
function getBackend() {
  const backendId = (process.env.PUBLISHED_STORE_BACKEND || "filesystem").toLowerCase();
  if (backendId === "filesystem") return require("./published-store/backends/filesystem-backend");
  if (backendId === "s3") return require("./published-store/backends/s3-backend");
  throw new Error(
    `未知のPUBLISHED_STORE_BACKENDです: "${backendId}"（"filesystem" または "s3" を指定してください）`
  );
}

/**
 * company_slugが公開済みかどうかを返す（PUBLISHED_STORE_BACKENDで設定されたbackendでの判定。
 * Lambda側の公開判定に使うcanonical state）。
 * @param {string} slug
 * @param {{client?:Object}} [options] - S3使用時、テスト用のモッククライアントを注入するためのフック（省略可）
 * @returns {Promise<boolean>}
 */
async function isPublished(slug, options = {}) {
  return getBackend().existsPublished(slug, options);
}

/**
 * company_slugに対応する公開済みreportの内容を読み込む。存在しない場合はnullを返す。
 * @param {string} slug
 * @param {{client?:Object}} [options]
 * @returns {Promise<Object|null>}
 */
async function loadPublished(slug, options = {}) {
  return getBackend().readPublished(slug, options);
}

/**
 * company_slugに対応する公開済みreportを保存する。
 * @param {string} slug
 * @param {Object} report
 * @param {{client?:Object}} [options]
 * @returns {Promise<void>}
 */
async function savePublished(slug, report, options = {}) {
  await getBackend().writePublished(slug, report, options);
}

/**
 * company_slugに対応する公開済みreportを削除する（冪等）。
 * @param {string} slug
 * @param {{client?:Object}} [options]
 * @returns {Promise<void>}
 */
async function deletePublished(slug, options = {}) {
  await getBackend().deletePublished(slug, options);
}

module.exports = { isPublished, loadPublished, savePublished, deletePublished, getBackend };
