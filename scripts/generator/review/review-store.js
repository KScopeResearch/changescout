/**
 * review-store.js — review.json バックエンド抽象化のPoC（PJ2次工程）。
 *
 * 【目的】leads/lead-store.jsで確立した filesystem/S3 バックエンド切替パターンが、
 * review.jsonにも安全に横展開できるかを検証するための最小実装。今回のスコープは
 * PoCのみであり、review.jsonの保存先を本番でS3へ切り替えることは目的にしていない。
 *
 * 【既存のreview-engine.js（loadReview/saveReview）とは別モジュールにした理由】
 * review-engine.jsのloadReview(filePath, ...)/saveReview(filePath, ...)は「任意の
 * ファイルパス」を直接受け取る設計であり、review-cli.jsは
 * `<report.jsonと同じディレクトリ>/review.json`というディレクトリ規約こそあるものの、
 * report.json自体はCLI引数として渡される任意のパスであり、OUTPUT_DIR配下である保証は
 * ない（test/publish-report.test.js等は一時ディレクトリでも同じAPIを使う）。
 * 一方S3は「バケット内の有限のキー空間」でしか表現できず、任意の絶対パスをそのまま
 * S3キーにすることはできない。leads/lead-store.jsがlead_idという安定した抽象
 * identifierを使い、生のファイルパスをバックエンドへ渡さない設計にしているのと同じ
 * 理由で、review.jsonをバックエンド抽象化するにはcompany_slugという安定した
 * identifierを使う新しいI/O層が必要になる。
 *
 * 既存API（review-engine.jsのloadReview/saveReview、review-cli.js、publish-report.js、
 * website/aor-admin/server.js）はこのPoCによって一切変更していない。すべて従来どおり
 * ファイルパス直接指定のfilesystem専用I/Oのまま動作する。本モジュールは、それらとは
 * 独立した並行実装として追加した（既存呼び出し元を書き換えるリスクをゼロにするため）。
 *
 * 【状態遷移ロジックとの関係】approve/reject/requestRevision等のPure Functionは
 * review-engine.jsに既に存在し、本モジュールでは一切再実装しない。本モジュールの
 * 責務はcompany_slugを使ったreview状態の保存・取得のみに限定する。
 *
 * 【バックエンドが公開すべき最小インタフェース】(backends/*.js参照。lead-store.jsと同型)
 *   readReview(slug) => Promise<Object|null>   -- 存在しなければnull
 *   writeReview(slug, review) => Promise<void>
 *
 * 環境変数REVIEW_STORE_BACKEND（既定"filesystem"）でバックエンドを切り替える
 * （LEAD_STORE_BACKENDと対称の命名。ただし値は独立しており、Lead側の設定には
 * 一切影響しない）。
 */

const { createEmptyReview } = require("./review-engine");

/**
 * 環境変数REVIEW_STORE_BACKENDに応じたバックエンドモジュールを返す（既定"filesystem"）。
 * lead-store.jsのgetBackend()と同じ、2択の単純な切り替えのみ。
 * @returns {{readReview:Function, writeReview:Function}}
 */
function getBackend() {
  const backendId = (process.env.REVIEW_STORE_BACKEND || "filesystem").toLowerCase();
  if (backendId === "filesystem") return require("./backends/filesystem-backend");
  if (backendId === "s3") return require("./backends/s3-backend");
  throw new Error(`未知のREVIEW_STORE_BACKENDです: "${backendId}"（"filesystem" または "s3" を指定してください）`);
}

/**
 * company_slugに対応するreviewを読み込む（I/O）。存在しない場合はcreateEmptyReview()の
 * 初期状態を返す（review-engine.jsのloadReview()と同じ既存契約を踏襲する）。
 * @param {string} slug
 * @param {string} [reportIdForNew] - review未存在時に使うreport_id
 * @returns {Promise<Object>}
 */
async function loadReview(slug, reportIdForNew) {
  const review = await getBackend().readReview(slug);
  return review || createEmptyReview(reportIdForNew);
}

/**
 * company_slugに対応するreviewを保存する（I/O）。
 * @param {string} slug
 * @param {Object} review
 * @returns {Promise<void>}
 */
async function saveReview(slug, review) {
  await getBackend().writeReview(slug, review);
}

module.exports = { loadReview, saveReview };
