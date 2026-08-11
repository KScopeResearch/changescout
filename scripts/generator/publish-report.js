#!/usr/bin/env node
/**
 * publish-report.js — Task24: 承認済みレポートをwebsite/aor/data/へ公開する。
 *
 * 【背景】Task23の運用前リハーサルで、scripts/generator/output/<slug>/report.json
 * （AIパイプラインの生成物）とwebsite/aor/data/<slug>.json（受信者向けLPが実際に
 * 読み込むファイル）を繋ぐ処理が存在しないことが判明した
 * （docs/pre-launch-rehearsal.md「★★★★★」参照）。両者はschema_version 2.4で
 * 完全に構造が一致しているため、変換は一切行わずそのままコピーする設計とした。
 *
 * 【設計方針: 方式A（明示的な公開操作）を採用】
 * 検討した3方式（A: 明示コピーCLI、B: Job Runnerへpublish job type追加、
 * C: 承認操作と同時に自動公開）のうち、Aを採用した。
 *   - B（job type化）は見送った: 公開はローカルファイルI/Oのみで完結する決定的な
 *     操作であり、Job Runnerが提供する指数バックオフ再試行（一時的な失敗に備える
 *     仕組み）の恩恵がない。job-history.jsonlへの記録・キュー管理のオーバーヘッドが
 *     見合わない
 *   - C（承認と同時に自動公開）は見送った: review-engine.jsは一貫して
 *     「Pure Function・副作用なし」の設計方針を守ってきており、approve()の中に
 *     ファイルシステムへの書き込みという副作用を混ぜると、この方針を崩すことになる。
 *     また、承認のタイミングと実際に受信者へ公開するタイミングを分離できることは
 *     運用上も価値がある（例: 複数社まとめて承認しておき、公開は別のタイミングで
 *     まとめて行う、といった運用ができる）
 *   - A（明示的な公開操作）は、本ファイルの`publishReport()`を唯一のロジック実体とし、
 *     CLI（本ファイルのmain()）とwebsite/aor-admin/server.jsの
 *     `POST /api/publish/:slug`の両方から呼び出すことで、重複実装を避けている
 *
 * 【安全性】
 *   - report.json・review.jsonは一切書き換えない（読み取り専用）
 *   - 公開可否の判定はreview-engine.jsの`isPublishable()`をそのまま使う
 *     （独自の判定ロジックを作らない。review-engine.jsのTask14からの一貫方針）
 *   - website/aor/data/<slug>.jsonへは、report.jsonの内容をそのまま書き込む
 *     （フィールドの変換・加工は一切行わない）
 *
 * 【PJ2 AOR Phase 3-D-1: published-store.js経由でのS3対応】
 * Lambda等、website/aor/data/へのローカルファイル書き込みが成立しない実行環境からも
 * 「公開済みかどうか」を判定できるよう、公開状態の永続化をpublished-store.js
 * （company-context-store.js等と同じfilesystem/S3バックエンド切替パターン）経由に変更した。
 *
 *   - website/aor/data/<slug>.jsonへのローカル書き込みは、PUBLISHED_STORE_BACKENDの値に
 *     関わらず**常に**行う（published-store/backends/filesystem-backend.jsを直接使用）。
 *     これはdeploy-aor-web.js（ローカルのwebsite/aor/配下を直接読んで実公開用S3+CloudFrontへ
 *     同期する）が今回のPhase 3-D-1のスコープ外であり、既存のローカル公開経路を廃止しない
 *     ためである。
 *   - PUBLISHED_STORE_BACKEND=s3を指定した場合のみ、上記に加えてpublished-store.js
 *     （設定されたbackend）へも書き込む。PUBLISHED_STORE_BACKEND未設定・"filesystem"の場合は
 *     上と同じファイルへの冪等な再書き込みになるだけなので、二重I/Oを避けるためスキップする。
 *   - **Lambda側の公開判定に使うcanonical stateはpublished store（PUBLISHED_STORE_BACKENDで
 *     設定されたbackend）である。** filesystem設定時（既定）はこのcanonical stateが
 *     website/aor/data/<slug>.json自身と一致するため、既存の挙動・意味は一切変わらない。
 *   - isPublished()はpublished-store.jsのisPublished()（上記canonical state）へ完全に委譲する
 *     形へ変更したため、**戻り値がbooleanからPromise<boolean>に変わった**（呼び出し元は
 *     すべてawaitするよう更新済み。unpublish-report.js・send-initial-report.js・
 *     website/aor-admin/server.js参照）。
 *
 * 使い方:
 *   node scripts/generator/publish-report.js <slug>
 */

const path = require("path");

const { OUTPUT_DIR } = require("./shared/paths");
const { validateSlug, isWithinDir } = require("./shared/path-safety"); // Task25: パストラバーサル対策
const engine = require("./review/review-engine");
const reviewStore = require("./review/review-store"); // PJ2 AOR: review backend接続PoC（下記コメント参照）
const reportStore = require("./report-store"); // PJ2 AOR: report backend接続（Phase B-4）
const publishedStore = require("./published-store"); // PJ2 AOR Phase 3-D-1: 公開状態のcanonical state
const publishedFsBackend = require("./published-store/backends/filesystem-backend"); // 既存ローカル公開経路（常時維持）
const { createLogger } = require("./shared/logger");
const { runCli } = require("./shared/cli-utils");

const logger = createLogger("publish-report");

const AOR_DATA_DIR = publishedFsBackend.AOR_DATA_DIR;

/**
 * @param {string} slug
 * @returns {string} website/aor/data/<slug>.json の絶対パス
 */
function publishedPathFor(slug) {
  return publishedFsBackend.publishedPathFor(slug);
}

/**
 * 指定slugが公開済みかどうかを返す（published-store.js経由。PUBLISHED_STORE_BACKENDで
 * 設定されたbackendでの判定＝Lambda側の公開判定に使うcanonical state）。
 * 【PJ2 AOR Phase 3-D-1】従来は同期関数（fs.existsSyncの戻り値をそのまま返す）だったが、
 * published-store.jsのAPIに合わせてPromiseを返すよう変更した。呼び出し元は必ずawaitすること。
 * @param {string} slug
 * @param {{client?:Object}} [options] - PUBLISHED_STORE_BACKEND=s3使用時のテスト用DIフック（省略可）。
 * @returns {Promise<boolean>}
 */
async function isPublished(slug, options = {}) {
  return publishedStore.isPublished(slug, options);
}

/** @returns {boolean} PUBLISHED_STORE_BACKENDがs3等、filesystem以外に設定されているか */
function usesNonFilesystemPublishedBackend() {
  return (process.env.PUBLISHED_STORE_BACKEND || "filesystem").toLowerCase() !== "filesystem";
}

/**
 * 承認済み（isPublishable()===true）のレポートをwebsite/aor/data/<slug>.jsonへ公開する。
 * report.json・review.jsonはいずれも読み取りのみで、一切変更しない。
 *
 * 【PJ2 AOR: review backend接続PoC】review.jsonの読み込みは、従来の
 * `engine.loadReview(reviewPath, ...)`（任意のファイルパスを直接受け取る既存API）から、
 * `review-store.js`（company_slugを安定したidentifierとして受け取るbackend抽象化層）
 * 経由へ切り替えた。REVIEW_STORE_BACKEND環境変数が未設定の場合は既定でfilesystem
 * backendが使われ、filesystem-backend.jsのreviewFilePath(slug)は
 * `OUTPUT_DIR/<slug>/review.json`という、このファイルが従来使っていた`reviewPath`と
 * **全く同じ物理パス**を指すため、既存のreview.json・既存の呼び出し元との互換性は
 * 完全に維持される（review.jsonの内容・スキーマは一切変更しない）。review-store.jsの
 * loadReview/saveReviewはPromiseを返すため、本関数もこれに伴いasyncへ変更した。
 *
 * 【PJ2 AOR: report backend接続（Phase B-4）】report.jsonの読み込みも、従来の
 * `readJsonSafe(reportPath)`（直接filesystem読み込み）から`report-store.js`の
 * `loadReport(slug)`経由へ切り替えた。REPORT_STORE_BACKEND環境変数が未設定の場合は
 * 既定でfilesystem backendが使われ、filesystem-backend.jsのreportFilePath(slug)は
 * `OUTPUT_DIR/<slug>/report.json`という、このファイルが従来使っていた`reportPath`と
 * **全く同じ物理パス**を指すため、既存のreport.json・既存の呼び出し元との互換性は
 * 完全に維持される（report.jsonの内容・スキーマは一切変更しない）。
 * `loadReport()`は「存在しない」場合にnullを返す点は従来の`readJsonSafe()`と同じだが、
 * 「存在するが不正JSON」の場合は例外を投げる点が異なる（filesystem-backend.jsが
 * readJson()を使うため）。従来の`readJsonSafe()`はいずれのケースもnullへ丸めていたため、
 * 既存の「report.jsonが見つかりません」というエラー文言・挙動を変えないよう、
 * 下記でtry/catchして同じ意味へ揃えている。
 *
 * @param {string} slug
 * @param {{client?:Object}} [options] - PUBLISHED_STORE_BACKEND=s3使用時、テスト用の
 *   モックS3クライアントをpublished-store.jsへ注入するためのフック（省略可。他store
 *   （report-store.js等）と同じDIパターン）。website/aor/data/へのローカル書き込みには
 *   S3クライアントを使わないため影響しない。
 * @returns {Promise<{ok:boolean, publishedPath?:string, reasons?:string[], error?:string}>}
 */
async function publishReport(slug, options = {}) {
  // Task25: HTTPルーティング（server.jsの正規表現）やCLI引数など、呼び出し経路に
  // 関わらずここで必ず検証する（パストラバーサル対策の多層防御、詳細は
  // shared/path-safety.jsのコメント参照）。
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) {
    return { ok: false, error: slugCheck.error };
  }

  const reportPath = path.join(OUTPUT_DIR, slug, "report.json");
  const reviewPath = path.join(OUTPUT_DIR, slug, "review.json");

  // 上記の文字種チェックに加え、実際に解決したパスがOUTPUT_DIR配下に収まっているかも
  // 確認する（server.jsのserveStatic()と同じ多層防御パターン）。
  if (!isWithinDir(reportPath, OUTPUT_DIR) || !isWithinDir(reviewPath, OUTPUT_DIR)) {
    return { ok: false, error: `不正なslugです（OUTPUT_DIR外を指しています）: ${slug}` };
  }

  let report;
  try {
    report = await reportStore.loadReport(slug);
  } catch (err) {
    // 既存のreadJsonSafe()と同じく、不正JSONも「見つからない」扱いへ丸める
    // （report-store.jsのfilesystem backendは不正JSON時に例外を投げるため、
    // ここで吸収して従来のエラーメッセージ・挙動を維持する）。
    report = null;
  }
  if (!report) {
    return { ok: false, error: `report.jsonが見つかりません: ${slug}（先にgenerate-reportジョブを実行してください）` };
  }

  // reviewStore.loadReview()はreview.jsonが無ければcreateEmptyReview()相当の初期状態を返す
  // （engine.loadReview()と同じ既存契約。PJ2 AOR: 今回backend経由へ切り替えた）。
  const review = await reviewStore.loadReview(slug, report.id);
  const { publishable, reasons } = engine.isPublishable(review, report.evaluation || null, report);

  if (!publishable) {
    return {
      ok: false,
      reasons,
      error: "このレポートはまだ公開できません（review.statusがapprovedでないか、品質評価がFAILです）",
    };
  }

  const publishedPath = publishedPathFor(slug);
  if (!isWithinDir(publishedPath, AOR_DATA_DIR)) {
    return { ok: false, error: `不正なslugです（website/aor/data/外を指しています）: ${slug}` };
  }

  // Task25: website/aor/data/には、手動で用意したサンプルデータ（company-01-manufacturing等）と
  // AIパイプラインが公開したデータが同じディレクトリに混在する。既存ファイルを上書きする場合
  // （再公開、またはたまたまslugがサンプルのファイル名と一致した場合）は必ず警告ログを出す
  // （ブロックはしない。再公開は意図した正規の操作のため）。運用方針の詳細は
  // scripts/generator/README.md「website/aor/data/の管理方針」参照。
  if (await publishedFsBackend.existsPublished(slug)) {
    logger.warn(`既存のファイルを上書きします: ${publishedPath}（再公開、または偶然のファイル名衝突の可能性があります）`);
  }

  // 既存のローカル公開経路（deploy-aor-web.jsの同期元）はPUBLISHED_STORE_BACKENDの値に
  // 関わらず常に維持する。内容は変換・加工せずそのまま書き込む。
  await publishedFsBackend.writePublished(slug, report);
  logger.info(`公開しました（filesystem）: ${slug} → ${publishedPath}`);

  // PJ2 AOR Phase 3-D-1: Lambda側の公開判定に使うcanonical stateはpublished store。
  // PUBLISHED_STORE_BACKEND=filesystem（既定）の場合は上と同じファイルへの冪等な
  // 再書き込みになるだけなので、二重I/Oを避けるためs3等の非filesystem設定時のみ実行する。
  if (usesNonFilesystemPublishedBackend()) {
    await publishedStore.savePublished(slug, report, options);
    logger.info(`公開しました（published store / ${process.env.PUBLISHED_STORE_BACKEND}）: ${slug}`);
  }

  return { ok: true, publishedPath };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("使い方: node publish-report.js <slug>");
    process.exitCode = 2;
    return;
  }

  const result = await publishReport(slug);
  if (!result.ok) {
    console.error(`公開できませんでした: ${result.error}`);
    if (result.reasons) result.reasons.forEach((r) => console.error(`  - ${r}`));
    process.exitCode = 1;
    return;
  }

  console.log(`公開しました: ${result.publishedPath}`);
}

if (require.main === module) {
  runCli(main);
}

module.exports = { publishReport, isPublished, publishedPathFor, validateSlug, AOR_DATA_DIR };
