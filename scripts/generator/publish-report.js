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
 * 使い方:
 *   node scripts/generator/publish-report.js <slug>
 */

const fs = require("fs");
const path = require("path");

const { readJsonSafe, writeJson } = require("./shared/json-file");
const { OUTPUT_DIR, REPO_ROOT } = require("./shared/paths");
const { validateSlug, isWithinDir } = require("./shared/path-safety"); // Task25: パストラバーサル対策
const engine = require("./review/review-engine");
const { createLogger } = require("./shared/logger");
const { runCli } = require("./shared/cli-utils");

const logger = createLogger("publish-report");

const AOR_DATA_DIR = path.join(REPO_ROOT, "website", "aor", "data");

/**
 * @param {string} slug
 * @returns {string} website/aor/data/<slug>.json の絶対パス
 */
function publishedPathFor(slug) {
  return path.join(AOR_DATA_DIR, `${slug}.json`);
}

/**
 * 指定slugが公開済みかどうかを返す（website/aor/data/<slug>.jsonの存在確認のみ）。
 * @param {string} slug
 * @returns {boolean}
 */
function isPublished(slug) {
  return fs.existsSync(publishedPathFor(slug));
}

/**
 * 承認済み（isPublishable()===true）のレポートをwebsite/aor/data/<slug>.jsonへ公開する。
 * report.json・review.jsonはいずれも読み取りのみで、一切変更しない。
 *
 * @param {string} slug
 * @returns {{ok:boolean, publishedPath?:string, reasons?:string[], error?:string}}
 */
function publishReport(slug) {
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

  const report = readJsonSafe(reportPath);
  if (!report) {
    return { ok: false, error: `report.jsonが見つかりません: ${slug}（先にgenerate-reportジョブを実行してください）` };
  }

  // engine.loadReview()はreview.jsonが無ければcreateEmptyReview()相当の初期状態を返す
  // （review-cli.js/server.jsと同じ既存パターンをそのまま再利用。独自実装しない）。
  const review = engine.loadReview(reviewPath, report.id);
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
  if (fs.existsSync(publishedPath)) {
    logger.warn(`既存のファイルを上書きします: ${publishedPath}（再公開、または偶然のファイル名衝突の可能性があります）`);
  }

  fs.mkdirSync(AOR_DATA_DIR, { recursive: true });
  writeJson(publishedPath, report); // 内容は変換・加工せずそのまま書き込む

  logger.info(`公開しました: ${slug} → ${publishedPath}`);
  return { ok: true, publishedPath };
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("使い方: node publish-report.js <slug>");
    process.exitCode = 2;
    return;
  }

  const result = publishReport(slug);
  if (!result.ok) {
    console.error(`公開できませんでした: ${result.error}`);
    if (result.reasons) result.reasons.forEach((r) => console.error(`  - ${r}`));
    process.exitCode = 1;
    return;
  }

  console.log(`公開しました: ${result.publishedPath}`);
}

if (require.main === module) {
  runCli(async () => main());
}

module.exports = { publishReport, isPublished, publishedPathFor, validateSlug, AOR_DATA_DIR };
