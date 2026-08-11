/**
 * filesystem-backend.js — published-store.js（PJ2 AOR Phase 3-D-1）の既定バックエンド。
 * website/aor/data/<company_slug>.json への読み書き・削除を行う。
 *
 * 【重要】このバックエンドが読み書きするパスは、publish-report.js/unpublish-report.jsが
 * Task24/Task38以来使ってきたAOR_DATA_DIR/publishedPathFor()と**全く同じ物理パス**である
 * （このファイルが唯一のパス計算の実体になり、publish-report.js/unpublish-report.jsは
 * これを再エクスポートする形に変わったが、値・挙動は一切変わらない）。
 *
 * 【PUBLISHED_STORE_BACKENDに関わらず常に使われる理由】website/aor/data/配下は
 * deploy-aor-web.js（PJ2 AOR）がローカルファイルシステムから直接読んで実公開用S3+CloudFrontへ
 * 同期する対象でもある。PUBLISHED_STORE_BACKEND=s3を指定してLambda側の公開判定をS3経由に
 * しても、このローカル公開経路（管理画面のプレビュー・deploy-aor-web.jsの同期元）は
 * publish-report.js/unpublish-report.js側で無条件に維持される（詳細は両ファイルのコメント参照）。
 */

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../../shared/json-file");
const { REPO_ROOT } = require("../../shared/paths");

const AOR_DATA_DIR = path.join(REPO_ROOT, "website", "aor", "data");

/**
 * company_slugからwebsite/aor/data/<slug>.jsonの絶対パスを組み立てる。
 * 【重要】ここではvalidateSlug()/isWithinDir()によるパストラバーサル検証を行わない
 * （Task24/Task38時点のpublishedPathFor()と完全に同じ、単純なpath.join()のみ）。
 * 検証は従来通り呼び出し側（publish-report.js/unpublish-report.jsのpublishReport()/
 * unpublishReport()）が担う。isPublished()（読み取り専用）は従来から検証なしで
 * fs.existsSync()するだけの既存契約であり、ここで検証を追加すると読み取り専用の
 * isPublished()呼び出し元（website/aor-admin/server.jsのGET系エンドポイント等）に
 * 例外を投げるようになってしまい、今回のスコープ外の挙動変化になるため踏襲する。
 * @param {string} slug
 * @returns {string}
 */
function publishedPathFor(slug) {
  return path.join(AOR_DATA_DIR, `${slug}.json`);
}

/**
 * @param {string} slug
 * @returns {Promise<boolean>}
 */
async function existsPublished(slug) {
  return fs.existsSync(publishedPathFor(slug));
}

/**
 * @param {string} slug
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readPublished(slug) {
  const filePath = publishedPathFor(slug);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * @param {string} slug
 * @param {Object} report
 * @returns {Promise<void>}
 */
async function writePublished(slug, report) {
  fs.mkdirSync(AOR_DATA_DIR, { recursive: true });
  writeJson(publishedPathFor(slug), report);
}

/**
 * 冪等（対象が存在しなくてもエラーにしない。unpublish-report.jsのTask38からの既存方針を踏襲）。
 * @param {string} slug
 * @returns {Promise<void>}
 */
async function deletePublished(slug) {
  fs.rmSync(publishedPathFor(slug), { force: true });
}

module.exports = {
  AOR_DATA_DIR,
  publishedPathFor,
  existsPublished,
  readPublished,
  writePublished,
  deletePublished,
};
