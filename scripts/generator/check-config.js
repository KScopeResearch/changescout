#!/usr/bin/env node
/**
 * check-config.js — Task21: 環境変数設定を単独で検証するCLI。
 *
 * website/aor-admin/server.js起動時のチェック（ADMIN_USER/ADMIN_PASSWORD必須）とは別に、
 * LLM_PROVIDER/SEARCH_PROVIDERを含めた設定全体を、サーバーを起動せずに確認したい場合に使う。
 *
 * 使い方:
 *   node scripts/generator/check-config.js
 *
 * 終了コード: 全項目OKなら0、いずれかがerror扱いなら1（warnのみの場合は0）。
 */

const { checkAll, formatReport } = require("./shared/config-validator");
const { runCli } = require("./shared/cli-utils"); // Task23: 他CLIとのエラーハンドリング方針統一

function main() {
  const { ok, results } = checkAll();

  console.log("設定チェック結果:");
  console.log(formatReport(results));

  if (ok) {
    console.log("\nConfiguration check passed");
  } else {
    console.log("\nConfiguration check failed");
    console.log(
      "\n必須設定が不足しています。上記の[ERROR]行を確認し、環境変数を設定してから再実行してください" +
        "（mock providerを使う場合はAPIキーは不要です。詳細はscripts/generator/README.md参照）。"
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  // Task23: checkAll()が予期せず例外を投げた場合でも、生のスタックトレースではなく
  // 統一フォーマット（致命的エラー:・exitCode=1・stack表示はAOR_DEBUG時のみ）で扱われるようにする。
  // main()自体が意図的に設定するexitCode=1（設定不備、正常系の失敗）はrunCli()の対象外で
  // そのまま反映される。
  runCli(async () => main());
}

module.exports = { main };
