#!/usr/bin/env node
/**
 * unpublish-report.js — Task38: 公開済みレポートをwebsite/aor/data/から取り下げる。
 *
 * 【背景】Task24でpublish-report.jsを追加した際、公開の取り消し（unpublish）機能は
 * 意図的にスコープ外とし、docs/operations-checklist.mdに「website/aor/data/<slug>.jsonを
 * 手動で退避・削除する」という緊急時の代替手順のみを文書化していた（Task25「未実施でも
 * 公開可能だが将来的に改善すべき事項」参照）。Task34の残存課題リリース影響評価で
 * 「分類B（運用開始後の対応で問題ない）」と判定した上で、Task38で実装した。
 *
 * 【設計方針: publish-report.jsと対称の最小構成】
 *   - publishReport()と同じ`shared/path-safety.js`の`validateSlug()`・`isWithinDir()`を
 *     再利用する（パストラバーサル対策の重複実装を避ける。Task25の教訓を踏襲）
 *   - report.json・review.jsonは一切参照しない（publish-report.jsと異なり、公開可否の
 *     判定が不要な単純な削除操作のため。読む必要が無いものは読まない、というシンプルさを優先）
 *   - `website/aor/data/<slug>.json`の削除のみを行う。report.json・review.jsonの内容や
 *     review.jsonのstatusには一切手を触れない（承認状態を書き換えたりreject扱いにしたりしない。
 *     「公開データを取り下げる」ことと「レビュー判断を覆す」ことは別の操作という設計）
 *
 * 【冪等性についての設計判断】
 *   既に非公開（ファイルが存在しない）状態でunpublishReport()を呼んだ場合、エラーにはせず
 *   `ok: true, alreadyUnpublished: true`を返す。理由: unpublishは「非公開状態にする」という
 *   目標状態への操作であり、既に目標状態に達している場合にエラーとするのはHTTP DELETEの
 *   一般的な冪等性の考え方（対象が既に無くても操作としては成功）に合わせた方が運用上扱いやすい
 *   （例: 二重クリック・リトライで失敗通知が出て運用担当者を混乱させることを避ける）。
 *
 * 使い方:
 *   node scripts/generator/unpublish-report.js <slug>
 */

const fs = require("fs");

const { validateSlug, isWithinDir } = require("./shared/path-safety"); // Task25: パストラバーサル対策
const { createLogger } = require("./shared/logger");
const { runCli } = require("./shared/cli-utils");
// publish-report.jsが既に持つAOR_DATA_DIR/publishedPathFor/isPublishedをそのまま再利用する
// （公開先ディレクトリ・パス計算・存在確認のロジックをここで再実装しない）。
const { AOR_DATA_DIR, publishedPathFor, isPublished } = require("./publish-report");

const logger = createLogger("unpublish-report");

/**
 * 指定slugの公開データ（website/aor/data/<slug>.json）を削除する。
 * report.json・review.jsonはいずれも参照・変更しない（削除対象はwebsite/aor/data/<slug>.jsonのみ）。
 *
 * @param {string} slug
 * @returns {{ok:boolean, unpublishedPath?:string, alreadyUnpublished?:boolean, error?:string}}
 */
function unpublishReport(slug) {
  // Task25と同じ多層防御パターン: 呼び出し経路（CLI引数・HTTPルーティング）に関わらず
  // ここで必ず検証する（詳細はshared/path-safety.jsのコメント参照）。
  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) {
    return { ok: false, error: slugCheck.error };
  }

  const publishedPath = publishedPathFor(slug);
  if (!isWithinDir(publishedPath, AOR_DATA_DIR)) {
    return { ok: false, error: `不正なslugです（website/aor/data/外を指しています）: ${slug}` };
  }

  if (!fs.existsSync(publishedPath)) {
    logger.info(`既に非公開です（対象ファイルが存在しません）: ${slug}`);
    return { ok: true, alreadyUnpublished: true };
  }

  fs.rmSync(publishedPath, { force: true });
  logger.info(`公開を取り消しました: ${slug} → ${publishedPath}`);
  return { ok: true, unpublishedPath: publishedPath, alreadyUnpublished: false };
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("使い方: node unpublish-report.js <slug>");
    process.exitCode = 2;
    return;
  }

  const result = unpublishReport(slug);
  if (!result.ok) {
    console.error(`公開を取り消せませんでした: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (result.alreadyUnpublished) {
    console.log(`既に非公開です（対象ファイルが存在しません）: ${slug}`);
  } else {
    console.log(`公開を取り消しました: ${result.unpublishedPath}`);
  }
}

if (require.main === module) {
  runCli(async () => main());
}

module.exports = { unpublishReport, isPublished, publishedPathFor, AOR_DATA_DIR };
