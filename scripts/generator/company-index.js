/**
 * company-index.js — company_slug一覧backendのPoC（PJ2次工程）。
 *
 * 【目的】leads/lead-store.js・review/review-store.js・company-context-store.jsで
 * 確立したfilesystem/S3切替パターンとは別軸の、**横断的な一覧取得**を提供する。
 * 単一slugの保存・取得（loadCompanyContext/saveCompanyContext・loadReview/saveReview等）
 * とは異なる操作範囲（全slugを走査する）を持つため、既存のどのstoreモジュールにも
 * 追加せず、独立した最小限の一覧統合層として実装した（company-context-store.jsへ
 * listCompanySlugs()を追加する形にはしていない）。
 *
 * 【インタフェース】
 *   listCompanySlugs({ source: "company_context" | "report" | "review" })
 *     => Promise<string[]>
 * sourceは必須。デフォルト値は設けない（「何を基準にした一覧なのか」を呼び出し側の
 * コードから常に明示させるため。既存の`server.js`のlistSlugs()がreport.json基準、
 * `job-runner.js`のgetScheduledCompanyUrls()がcompany_context.json基準という、
 * 異なる2つの一覧概念が併存している実態への対応）。
 *
 * 【責務の範囲】本モジュールが行うのは「指定sourceを基準として、存在するcompany_slug
 * 一覧を返す」ことだけである。report/company_context/reviewの内容解析・summary生成・
 * job enqueue等は一切行わない（それらは呼び出し元・各storeモジュールの責務）。
 *
 * 【backend選択の設計判断】一覧取得専用の新しい環境変数（例:
 * COMPANY_SLUG_INDEX_BACKEND）は導入していない。理由: 一覧は「実際にそのsourceの
 * データがどこに保存されているか」と常に一致していなければ意味がない
 * （例: COMPANY_CONTEXT_STORE_BACKEND=s3で運用中に、一覧だけfilesystemを見に行くと、
 * 実データと一覧が食い違う）。そのため、各sourceの一覧取得は、そのsourceが実際に
 * 使っている既存の環境変数（COMPANY_CONTEXT_STORE_BACKEND・REVIEW_STORE_BACKEND）を
 * そのまま参照する。
 *
 * 【report sourceについて】report.jsonのbackend抽象化（report-store.js、Phase B-1〜
 * B-3でfilesystem、Phase B-7でS3を実装済み）は、REPORT_STORE_BACKEND環境変数
 * （既定"filesystem"）でbackendを切り替える設計になっている。一覧取得側（本ファイル）
 * も、company_context/reviewと同じ理由（「一覧は実際にそのsourceのデータがどこに
 * 保存されているかと常に一致していなければ意味がない」）により、REPORT_STORE_BACKEND
 * をそのまま参照するようにした。source:"report"のS3設定解決（bucket/prefix/region）
 * も、company_context/reviewと同じ命名パターン（REPORT_STORE_S3_BUCKET・
 * REPORT_STORE_S3_PREFIX、既定"reports/"）で実装済み。report-store.js自身のS3
 * backend（report-store/backends/s3-backend.js）もPhase B-7で実装済みのため、
 * REPORT_STORE_BACKEND=s3設定時は一覧取得（本ファイル）・内容の読み書き
 * （report-store.jsのloadReport/saveReport）のいずれもS3から一貫して行われる。
 */

const fs = require("fs");
const path = require("path");

const { OUTPUT_DIR } = require("./shared/paths");
const { validateSlug } = require("./shared/path-safety");

// source ごとに、filesystem上で存在確認すべきファイル名を対応させる
// （server.jsのlistSlugs()・job-runner.jsのgetScheduledCompanyUrls()が個別に
// 持っていた「report.json」「company_context.json」という判定条件を集約したもの）。
const SOURCE_FILENAMES = {
  company_context: "company_context.json",
  report: "report.json",
  review: "review.json",
};

const VALID_SOURCES = Object.keys(SOURCE_FILENAMES);

/**
 * sourceの妥当性を検証する。未知のsourceは明示的なエラーにする（デフォルト値は
 * 設けない）。
 * @param {string} source
 */
function assertValidSource(source) {
  if (!source || !VALID_SOURCES.includes(source)) {
    throw new Error(`未知のsourceです: "${source}"。有効な値: ${VALID_SOURCES.join(", ")}`);
  }
}

/**
 * sourceごとに、実際にそのデータが使っているbackend種別（filesystem|s3）を
 * 既存の環境変数からそのまま解決する（一覧専用の新しい環境変数は導入しない。
 * 理由は本ファイル冒頭のコメント参照）。
 * @param {string} source
 * @returns {"filesystem"|"s3"}
 */
function resolveBackendForSource(source) {
  if (source === "company_context") {
    return (process.env.COMPANY_CONTEXT_STORE_BACKEND || "filesystem").toLowerCase();
  }
  if (source === "review") {
    return (process.env.REVIEW_STORE_BACKEND || "filesystem").toLowerCase();
  }
  // source === "report": report-store.js自身のbackend選択
  // （REPORT_STORE_BACKEND、既定"filesystem"）とそのまま揃えた（上記コメント参照）。
  return (process.env.REPORT_STORE_BACKEND || "filesystem").toLowerCase();
}

/**
 * OUTPUT_DIR配下を列挙し、指定ファイルが存在するslugだけを返す
 * （server.jsのlistSlugs()・job-runner.jsのgetScheduledCompanyUrls()と
 * 同じロジックを、対象ファイル名だけパラメータ化したもの）。
 * @param {string} filename
 * @returns {string[]}
 */
function listSlugsFromFilesystem(filename) {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((slug) => validateSlug(slug).ok) // 多層防御（ディレクトリ名は通常安全だが念のため）
    .filter((slug) => fs.existsSync(path.join(OUTPUT_DIR, slug, filename)));
}

/**
 * S3のprefix配下をListObjectsV2で列挙し、`<prefix><slug>.json`というフラットキー
 * 設計から、slug一覧を復元する（leads/backends/s3-backend.jsのlistLeads()と同じ
 * ページネーションパターンを踏襲）。
 * @param {string} bucket
 * @param {string} prefix
 * @param {string} region
 * @param {{client?:Object}} [options] - テスト時にS3Client相当のモックを注入するためのフック
 * @returns {Promise<string[]>}
 */
async function listSlugsFromS3(bucket, prefix, region, options = {}) {
  const { S3Client, ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const client = options.client || new S3Client({ region });

  const slugs = [];
  let continuationToken;
  do {
    // eslint-disable-next-line no-await-in-loop
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    (res.Contents || []).forEach((obj) => {
      if (!obj.Key || !obj.Key.endsWith(".json")) return; // .json以外のキーは対象外
      if (!obj.Key.startsWith(prefix)) return;
      const slug = obj.Key.slice(prefix.length, -".json".length);
      if (slug) slugs.push(slug);
    });
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return slugs;
}

/**
 * sourceに対応するS3設定（bucket/prefix/region）を、既存の各backendが使っている
 * 環境変数からそのまま取得する（company-context-store.js/review-store.jsのS3
 * backendが持つresolveConfig()と同じ環境変数名を再利用し、独自の設定名を
 * 新設しない）。
 * @param {string} source
 * @returns {{bucket:string, prefix:string, region:string}}
 */
function resolveS3ConfigForSource(source) {
  if (source === "company_context") {
    const bucket = process.env.COMPANY_CONTEXT_STORE_S3_BUCKET;
    if (!bucket) {
      throw new Error(
        "COMPANY_CONTEXT_STORE_S3_BUCKET が設定されていません（company_contextのS3一覧取得には必須です）"
      );
    }
    const region = process.env.AWS_REGION;
    if (!region) throw new Error("AWS_REGION が設定されていません");
    const prefix = process.env.COMPANY_CONTEXT_STORE_S3_PREFIX || "company-contexts/";
    return { bucket, prefix, region };
  }
  if (source === "review") {
    const bucket = process.env.REVIEW_STORE_S3_BUCKET;
    if (!bucket) {
      throw new Error("REVIEW_STORE_S3_BUCKET が設定されていません（reviewのS3一覧取得には必須です）");
    }
    const region = process.env.AWS_REGION;
    if (!region) throw new Error("AWS_REGION が設定されていません");
    const prefix = process.env.REVIEW_STORE_S3_PREFIX || "reviews/";
    return { bucket, prefix, region };
  }
  // source === "report": company_context/reviewと同じ命名パターン
  // （REPORT_STORE_S3_BUCKET・REPORT_STORE_S3_PREFIX）で解決する。report-store.js
  // 自身のS3 backend（report-store/backends/s3-backend.js）もPhase B-7で実装済みのため、
  // REPORT_STORE_BACKEND=s3設定時は一覧取得（本関数経由）・内容の読み書き
  // （report-store.jsのloadReport/saveReport）のいずれもS3から一貫して行われる。
  if (source === "report") {
    const bucket = process.env.REPORT_STORE_S3_BUCKET;
    if (!bucket) {
      throw new Error("REPORT_STORE_S3_BUCKET が設定されていません（reportのS3一覧取得には必須です）");
    }
    const region = process.env.AWS_REGION;
    if (!region) throw new Error("AWS_REGION が設定されていません");
    const prefix = process.env.REPORT_STORE_S3_PREFIX || "reports/";
    return { bucket, prefix, region };
  }
  throw new Error(`未知のsourceです: "${source}"`);
}

/**
 * 指定sourceを基準として、存在するcompany_slug一覧を返す。
 * @param {{source: "company_context"|"report"|"review"}} params
 * @param {{client?:Object}} [options] - S3使用時、テスト用のモッククライアントを注入するためのフック
 * @returns {Promise<string[]>}
 */
async function listCompanySlugs(params, options = {}) {
  const source = params && params.source;
  assertValidSource(source);

  const backend = resolveBackendForSource(source);
  if (backend === "filesystem") {
    return listSlugsFromFilesystem(SOURCE_FILENAMES[source]);
  }
  if (backend === "s3") {
    const { bucket, prefix, region } = resolveS3ConfigForSource(source);
    return listSlugsFromS3(bucket, prefix, region, options);
  }
  throw new Error(`未知のbackendです: "${backend}"`);
}

module.exports = { listCompanySlugs, VALID_SOURCES };
