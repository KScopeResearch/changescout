# quality-report.md — Task18/19/22 自動品質レポート

生成日時: 2026-08-07T23:56:48.436Z

## Configuration Check

> ⚠️ **参考情報のみ**。CI環境ではADMIN_USER/ADMIN_PASSWORD・LLM/SEARCH APIキーを設定していないことが正常なため（mock providerのみでテストが完結する設計）、ここでの`[ERROR]`は上記「総合結果」のPASS/FAIL判定には一切影響しない（Task22で意図的に非ブロッキングとした）。

- [INFO] 管理画面認証: ADMIN_USER/ADMIN_PASSWORD 設定OK
- [INFO] LLM provider: mock（APIキー不要）
- [INFO] 検索 provider: mock（APIキー不要）

## テスト結果サマリー

- テスト数: 143
- PASS: 143
- FAIL: 0（うちブロッキング: 0、非ブロッキング/ネットワーク依存: 0）
- SKIPPED: 0
- 実行時間（node --test内部計測）: 40586.1ms
- 実行時間（run-all-tests.js全体計測、プロセス起動込み）: 40653ms

## カバレッジ概算

> ⚠️ npm系のカバレッジ計測ツール（istanbul/nyc等）は「npmパッケージ追加禁止」の要件により使用していない。以下はモジュール単位で対応するテストファイルが存在するかの**構造的な近似値**であり、行/分岐カバレッジではない。

- 対応テストが存在するモジュール: 23 / 28（約82%）

| モジュール | テストファイル |
|---|---|
| validate-report.js | validator.test.js |
| quality-evaluator.js | quality.test.js |
| review/review-engine.js | review.test.js |
| jobs/job-store.js | jobs.test.js |
| jobs/job-runner.js | jobs.test.js |
| jobs/job-engine.js | jobs.test.js |
| search/search-client.js | search.test.js |
| search/query-builder.js | search.test.js |
| deduplicate-sources.js | search.test.js |
| llm/llm-client.js | llm.test.js |
| generate-company-report.js | generator.test.js |
| publish-report.js | publish-report.test.js |
| shared/json-file.js | shared.test.js |
| shared/retry.js | shared.test.js |
| shared/date-utils.js | shared.test.js |
| shared/logger.js | shared.test.js |
| shared/paths.js | shared.test.js |
| shared/cli-utils.js | error-handling.test.js |
| shared/config-validator.js | error-handling.test.js |
| shared/redact.js | error-handling.test.js, security.test.js |
| company-context.js | generator.test.js（間接的にbuildCompanyContext経由） |
| normalize-sources.js | （未対応・下記「注意事項」参照） |
| merge-sources.js | （未対応・下記「注意事項」参照） |
| score-sources.js | （未対応・下記「注意事項」参照） |
| simulate-ai-analysis.js | llm.test.js（mock-provider.js経由で間接的に） |
| review/review-cli.js | （未対応・下記「注意事項」参照） |
| jobs/job-cli.js | （未対応・下記「注意事項」参照） |
| website/aor-admin/server.js | security.test.js（未認証401/認証済み200/CSRF拒否） |

## Dashboard確認

- 結果: OK
- 詳細: 未認証401・認証済み200・/api/reports・/api/jobsの応答を確認しました
- 【範囲】ここではAPI疎通（未認証401・認証済み200・/api/reports・/api/jobs）のみを自動確認している。実ブラウザでのUI描画・SSE自動更新・console.errorの確認は別途Claude Browser等で目視確認する（run-all-tests.jsはNode標準モジュールのみで完結させる要件のため、ブラウザ自動操作は含まない）。

## 注意事項

- generator.test.jsはhttps://example.com（IANA予約の安全な公開テストドメイン）への実HTTP取得を行うため、ネットワーク環境によっては失敗しうる（唯一のネットワークI/Oを伴うテスト）。Task19で「方式C」を採用し、このテストのみ失敗しても全体の終了コードをFAILにしない（CI環境のDNS障害・一時的な外部サイト停止・egress制限でCI全体が赤くなることを防ぐため）。ただし失敗時は必ずログ・quality-report.mdに記録される。
- jobs.test.jsは指数バックオフ（1秒/2秒/4秒）の実時間待ちを含むため、テストスイート全体の実行時間の大半（数十秒）を占める。高速化のためにリトライ間隔を短縮する設定は、本番のリトライ仕様とテストを乖離させないため、あえて行っていない。
- search/tavily-provider.js・search/bing-provider.js・llm/openai-provider.js・deepseek-provider.js・qwen-provider.jsは、実APIキーを設定していないため実際の外部API呼び出しを伴うテストは実施していない（isConfigured()がfalseになることのみ確認）。
- website/aor-admin/public/配下のフロントエンドJS（list.js/detail.js/jobs.js等）は、ブラウザDOM APIに依存するためnode:testでは直接テストしていない。動作確認はClaude Browserでの実ブラウザ確認に依っている。
