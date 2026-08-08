# scripts/generator/ — AI分析パイプライン（Phase1 MVP / Task8〜Task18）

## これは何か

会社URLを入力として、`docs/mock_data`のschema_version 2.4に準拠した`report.json`を生成する
コマンドラインツール。`website/aor/`が読み込む静的JSON（`docs/mock_data/*.json`）を、
将来的に人手で書く代わりに自動生成できるようにするための、Phase1 MVP実装。

## 【開発ルール】新しい機能追加前には run-all-tests.js を実行する（Task18で追加）

```bash
node scripts/generator/run-all-tests.js
```

Validator/Review/Jobs/Generator/Search/LLM(Mock)の自動テストと、Dashboardの起動・API疎通確認を
1コマンドで実行し、`scripts/generator/quality-report.md`を生成する。既存の挙動を壊していないか
（回帰がないか）を、新しい機能を追加する**前**と**後**の両方で確認する習慣を徹底する。
終了コードは全テストPASS・Dashboard確認OKの場合のみ`0`。詳細は「テスト基盤（Task18）」を参照。

## 処理フロー（Task12更新版）

```
会社URL
  ↓ [1] company fetch   … fetch-company.js（実HTTP取得、対象企業自身のURLのみ）
  ↓ [1'] search fetch   … fetch-government/industry/news/statistics.js が
  │                        search-client.js（Task12で追加）経由で検索を行う。
  │                        SEARCH_PROVIDER環境変数でmock/tavily/bingを切替
  │                        （デフォルトmock、APIキー未設定時は自動でmockにフォールバック）
  ↓ [2] merge           … merge-sources.js: 5系統の生データを1つの配列へ統合
  ↓ [3] normalize       … normalize-sources.js: 取得元によらず同一構造へ正規化
  ↓ [4] deduplicate     … deduplicate-sources.js: URL/タイトル/PDF違い等の重複を統合
  ↓ [5] score           … score-sources.js: 0〜100のスコアを付与し降順ソート
  ↓ [6] company_context生成 … company-context.js: スコア上位20件に絞り込み、idを確定
  ↓ [7] AI分析          … llm-client.js（Task11で追加。LLM_PROVIDER環境変数でmock/openai/deepseek/qwenを切替）
  ↓ [8] 品質評価        … quality-evaluator.js（Task10で追加、report.evaluationを算出）
  ↓ [9] 検証            … validate-report.js
report.json（schema_version 2.4、evaluationフィールドを含む）
+ evaluation.md（Task10で追加、品質評価の人間可読レポート）
```

[1]〜[6]は`company-context.js`の`buildCompanyContext()`内部で順番に実行される。
[7]〜[9]は`generate-company-report.js`が呼び出す。品質評価（[8]）は検証（[9]）より前に
実行し、評価結果自体もreport.jsonの一部として検証対象に含める。AI分析（[7]）の詳細は
「LLM抽象化レイヤー（llm-client.js、Task11で追加）」、検索（[1']）の詳細は
「検索抽象化レイヤー（search-client.js、Task12で追加）」を参照。

## 使い方

```bash
# デフォルト（LLM_PROVIDER・SEARCH_PROVIDERともに未設定 = mock、APIキー不要）
node scripts/generator/generate-company-report.js https://company.jp

# 実LLM・実検索を使う場合（該当providerのAPIキーが必要）
LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... \
SEARCH_PROVIDER=tavily TAVILY_API_KEY=tvly-... \
  node scripts/generator/generate-company-report.js https://company.jp
```

出力:
- `scripts/generator/output/<会社ドメイン>/company_context.json`
- `scripts/generator/output/<会社ドメイン>/report.json`
- `scripts/generator/output/<会社ドメイン>/evaluation.md`
- `scripts/generator/logs/llm-usage.jsonl`（Task11で追加。追記式のコストログ）

Validatorを単体で使う場合:

```bash
node scripts/generator/validate-report.js path/to/report.json
```

品質評価エンジンを単体で使う場合（既存のreport.jsonを再評価したいとき等）:

```bash
node scripts/generator/quality-evaluator.js path/to/report.json
```

複数providerを一括比較する場合（Task11で追加。詳細は「provider別コスト比較」参照）:

```bash
node scripts/generator/experiments/run-experiments.js https://company.jp
```

## モジュール一覧と役割

```
scripts/generator/
├── generate-company-report.js   … CLIエントリポイント（[7]AI分析・[8]品質評価・[9]検証を呼び出す）
├── company-context.js           … [1]〜[6]を順に実行し company_context を組み立てる
├── fetch-company.js             … [1] 会社ページの取得（実装、実際にHTTP取得する）
├── fetch-government.js          … [1'] 官公庁資料の取得（Task12でsearch-client.js経由に変更）
├── fetch-industry.js            … [1'] 業界情報の取得（Task12でsearch-client.js経由に変更）
├── fetch-news.js                … [1'] ニュースの取得（Task12でsearch-client.js経由に変更）
├── fetch-statistics.js          … [1'] 統計の取得（Task12でsearch-client.js経由に変更）
├── search/                      … [1'] 検索抽象化レイヤー（Task12で追加）
│   ├── search-client.js         …   provider切替・retry・timeout・エラー処理・フォールバック・usage logging
│   ├── search-interface.js      …   provider共通契約の検証・生fetchアイテムへの変換ヘルパー
│   ├── query-builder.js         …   会社名から検索クエリ（最低5件）を自動生成
│   ├── mock-search-provider.js  …   決定的な合成結果を返す（APIキー不要、動作確認済み）
│   ├── tavily-provider.js       …   Tavily Search API（低コスト候補、Task30〜32で実API検証済み）
│   └── bing-provider.js         …   Bing Web Search API（比較用、未検証・APIキーなし）
├── merge-sources.js             … [2] 5系統の生データを1配列に統合
├── normalize-sources.js         … [3] 取得元によらず同一構造へ正規化
├── deduplicate-sources.js       … [4] 重複統合（URL/タイトル/PDF違い/同記事、Task12で近似判定を補強）
├── score-sources.js             … [5] 0〜100スコア付与・降順ソート
├── llm/                         … [7] LLM抽象化レイヤー（Task11で追加）
│   ├── llm-client.js            …   provider切替・retry・timeout・エラー処理・コスト計算のハブ
│   ├── openai-provider.js       …   OpenAI（比較用、未検証・APIキーなし）
│   ├── deepseek-provider.js     …   DeepSeek（低コスト候補、Task30〜32で実API検証済み）
│   ├── qwen-provider.js         …   Qwen/DashScope（低コスト候補、未検証・APIキーなし）
│   └── mock-provider.js         …   simulate-ai-analysis.jsをラップ（APIキー不要、動作確認済み）
├── prompts/                     … [7] AIへ渡すプロンプト定義（Task11で追加）
│   ├── system-analysis.md       …   システムプロンプト全体の構成
│   ├── opportunity-generation.md…   出力JSON構造の詳細定義
│   └── quality-rules.md         …   厳守事項（fact/analysis/action区分、推測禁止等）
├── simulate-ai-analysis.js      … [7] ルールベースのAI分析シミュレーション。Task11で
│                                     mock-provider.jsに役割を移管（削除はしていない）
├── prompt-company-analysis.md   … Task8時点の設計ドキュメント（prompts/の元になった6原則の初出）
├── quality-evaluator.js         … [8] 品質評価（Task10で追加、モジュール兼CLI）
├── validate-report.js           … [9] report.jsonの機械的検証（モジュール兼CLI）
├── jobs/                        … Job Runner / Scheduler（Task16で追加）
│   ├── job-store.js             …   ジョブのインメモリレジストリ
│   ├── job-engine.js            …   4種類のjob typeハンドラ（既存モジュールへのアダプタ）
│   ├── job-runner.js            …   キュー処理・リトライ・スケジューラ・履歴記録
│   ├── job-cli.js               …   CLI（website/aor-admin/server.jsのJobs APIを呼ぶ）
│   └── README.md                …   詳細ドキュメント
├── review/                      … 人間レビューworkflow（Task13で追加）
│   ├── review-engine.js         …   状態遷移のコアロジック（Pure Function中心）
│   ├── review-cli.js            …   CLIフロントエンド（approve/reject/revise/comment/fix/history/status）
│   ├── review-schema.md         …   review.jsonのスキーマ定義
│   └── fixtures/                …   review.jsonのテスト用fixture（pending/approved/needs_revision/rejected）
├── logs/                        … llm-usage.jsonl（Task11）・search-usage.jsonl（Task12）・
│                                    admin-audit.jsonl（Task15、website/aor-admin/の監査ログ）・
│                                    job-history.jsonl（Task16、Job Runnerの実行履歴）
├── experiments/                 … provider別の生成結果比較
│   ├── run-experiments.js       …   Task11: mock/deepseek/qwen/openaiを一括実行するスクリプト
│   ├── *-result.json            …   Task11の実行結果（APIキーなしはskipped:trueで記録）
│   ├── run-search-experiments.js…   Task12: 検索→context生成→AI分析→品質評価を一気通貫で実行
│   └── search-results/*.json    …   Task12の実行結果（pipeline_stats・source_type内訳・evaluation）
├── fixtures/                    … quality-evaluator.jsのテスト用report.json（good/average/bad）
├── shared/                      … 共通ユーティリティ（Task18で追加）
│   ├── logger.js                …   DEBUG/INFO/WARN/ERRORの4段階ロガー
│   ├── json-file.js             …   JSON読み書きの共通化
│   ├── retry.js                 …   retry + timeoutの共通化（llm-client.js・search-client.jsが使用）
│   ├── paths.js                 …   OUTPUT_DIR/LOGS_DIR/PROMPTS_DIR等の一元管理
│   ├── date-utils.js            …   ISO8601関連（正規表現・生成・検証）
│   ├── cli-utils.js             …   CLIエントリポイントの安全な実行（process.exit()回避パターン）
│   ├── config-validator.js      …   環境変数・provider設定の検証（Task21で追加）
│   └── log-rotation.js          …   ログのアーカイブ・期間ベース整理（Task43で追加）
├── check-config.js              … 設定チェック単体CLI（Task21で追加。詳細は後述の節を参照）
├── backup.js                    … バックアップ取得CLI（Task22で追加。詳細は後述の節を参照）
├── check-docs.js                … README記載内容の簡易整合性チェックCLI（Task22で追加）
├── publish-report.js            … 承認済みレポートのwebsite/aor/data/への公開CLI（Task24で追加）
├── unpublish-report.js          … 公開済みレポートのwebsite/aor/data/からの取り下げCLI（Task38で追加）
├── test/                        … 自動テスト（Task18で追加、node:testのみ使用）
│   ├── validator.test.js        …   validate-report.js
│   ├── quality.test.js          …   quality-evaluator.js
│   ├── review.test.js           …   review/review-engine.js
│   ├── jobs.test.js             …   jobs/{job-store,job-runner,job-engine}.js
│   ├── search.test.js           …   search/search-client.js・query-builder.js・deduplicate-sources.js
│   ├── llm.test.js              …   llm/llm-client.js（mock providerのみ）
│   ├── generator.test.js        …   generate-company-report.js（エンドツーエンド、実HTTP有）
│   ├── shared.test.js           …   shared/配下のテスト
│   ├── error-handling.test.js   …   エラーハンドリング統一の対象（Task23で追加）
│   ├── security.test.js         …   secret非記録・未認証拒否・CSRF拒否（Task23で追加）
│   ├── publish-report.test.js   …   publish-report.js（Task24で追加）
│   └── unpublish-report.test.js …   unpublish-report.js（Task38で追加）
├── run-all-tests.js             … 全自動テスト+Dashboard確認を1コマンドで実行（Task18で追加）
├── quality-report.md            … run-all-tests.jsが生成する品質レポート（実行のたび上書き）
├── output/                      … 生成物の出力先（会社ドメインごとのディレクトリ）
└── README.md                    … 本ファイル
```

## 本番運用準備（Task21で追加、Task22でバックアップ、Task23でエラーハンドリング・ログ安全性・起動時復旧を追加）

### 設定チェック（shared/config-validator.js・check-config.js）

`shared/config-validator.js`は、LLM_PROVIDER/SEARCH_PROVIDER/ADMIN_USER・ADMIN_PASSWORDの
設定状況を検証する共通モジュール。**providerごとに必要なAPIキー名をこのファイルへ
新たにハードコードしてはいない**。`llm-client.js`・`search-client.js`がすでに持つ
provider抽象化（`resolveProviderId()`・`getProvider(id)`・`provider.requiresApiKey`・
`provider.isConfigured()`）をそのまま再利用しているため、providerの追加・変更があっても
`config-validator.js`側の変更は不要（重複実装を避けるための設計）。secret値（APIキー
そのもの）はログにもメッセージにも一切含めない。

| チェック対象 | 未設定/未設定キー時の扱い | 理由 |
|---|---|---|
| `ADMIN_USER`/`ADMIN_PASSWORD` | error（該当プロセスの起動をブロック） | Review Dashboardの認証を守るため（Task15からの既存方針） |
| `LLM_PROVIDER`が非mockでAPIキー未設定 | error | `llm-client.js`は未設定だと`generateAnalysis()`実行時に例外を投げる設計のため（分析結果の信頼性に直結） |
| `SEARCH_PROVIDER`が非mockでAPIキー未設定 | warn（ブロックしない） | `search-client.js`は未設定だと自動的にmockへフォールバックする既存設計のため（エラーにしない） |
| mock provider（LLM/SEARCH共通） | 常にok | APIキー不要（要件どおり、mock利用時にAPIキーを必須化しない） |

単独で設定を確認したい場合:

```bash
node scripts/generator/check-config.js
# 全項目OK → "Configuration check passed"（終了コード0）
# errorが1件以上 → "Configuration check failed"（終了コード1）。warnのみなら終了コード0
```

`generate-company-report.js`のCLI（`main()`のみ。ライブラリとして呼ぶ
`generateCompanyReport()`関数自体はこのチェックを行わない。テスト・他モジュールからの
呼び出しに影響を与えないため）でも、fetch/LLM呼び出しを始める前にLLM/SEARCH設定を検証し、
不備があれば早期に分かりやすいエラーで停止する。

**quality-report.md（Task22）**: `run-all-tests.js`は`checkAll()`の結果を`quality-report.md`の
「Configuration Check」セクションへ**参考情報として**記載する。**採用したがCIの合否判定には
一切使わない**（CI環境（`.github/workflows/quality-check.yml`）は`ADMIN_USER`等を設定しない
前提のため、これらの`[ERROR]`を合否に使うと必ずCIが赤くなってしまう）。実際、
`run-all-tests.js`の総合結果（`allOk`）の計算式は`blockingFailedNames`・`tapSummary.tests`・
`dashboard.ok`のみを見ており、`configCheck`の結果は一切参照していない
（ADMIN_USER未設定の環境で実行しても「総合結果: PASS」になることを確認済み）。

`website/aor-admin/server.js`の起動時チェック（ADMIN_USER/ADMIN_PASSWORD必須のブロッキング
チェック、LLM/SEARCH設定の参考表示）については
[website/aor-admin/README.md](../../website/aor-admin/README.md)「起動時の設定チェック」
「Health Check API」を参照。

### バックアップ・リストア（backup.js、Task22で追加）

Node標準`fs`のみでディレクトリコピーを行うバックアップCLI。zip圧縮等は行わない
（npm非依存、シンプルさ優先）。

```bash
node scripts/generator/backup.js
# → <repo root>/backup/<YYYY-MM-DD_HHMMSS>/ 配下にコピーを作成
```

**バックアップ対象**:

| 対象 | 扱い | 理由 |
|---|---|---|
| `scripts/generator/output/` | 必須（無いとエラー停止） | AI生成レポート・review.json本体 |
| `scripts/generator/logs/` | 必須（無いとエラー停止） | 監査ログ・ジョブ履歴・利用ログ（インシデント調査に必要） |
| `website/aor-admin/` | 推奨（無ければ警告のみでスキップ） | Review Dashboardのコード一式 |
| `website/aor/data/` | 推奨（同上、**Task25で追加**） | 公開済みレポート（`publish-report.js`の書き込み先）・手動サンプルデータ。他にバックアップ手段が無いため |
| `docs/` | 推奨（同上） | 設計ドキュメント・運用チェックリスト |
| `.github/workflows/` | 推奨（同上） | CI設定 |

`node_modules/`・`.git/`は対象ディレクトリ配下に紛れ込んでいてもコピーしない
（現状のバックアップ対象にはいずれも存在しないが、事故防止のため明示的に除外している）。
コピー元（`scripts/generator/output/`等）は一切変更しない。実行のたび新しいタイムスタンプ
ディレクトリを作成するため、既存のバックアップも上書きしない。secret値を含みうる
ファイルの中身自体はログへ出力せず、対象ラベルとファイル数のみを記録する。

**リストア手順**:

1. （推奨）`website/aor-admin/server.js`を停止する。稼働中のままファイルを上書きしても、
   すでに開いているプロセスのメモリ内セッション等には影響しないが、`scripts/generator/output/`
   や`logs/`を書き換えている最中に他プロセスが同時に読み書きする競合を避けるため、
   停止してからのリストアを推奨する
2. 復元したい対象を選び、`backup/<タイムスタンプ>/<label>/`の中身を元の場所へコピーする。
   例（output/のみ復元する場合）:
   ```bash
   cp -r backup/2026-08-07_010000/output/* scripts/generator/output/
   ```
3. 復元後、以下を確認する:
   ```bash
   node scripts/generator/check-config.js   # 環境変数設定が壊れていないか
   node scripts/generator/run-all-tests.js  # 全テスト・Dashboard疎通を確認
   ```
   さらに`website/aor-admin/server.js`を起動し、Review Dashboard・Jobs Dashboardが
   正常に表示されること、SSEによる自動更新が機能することを目視確認する

`backup/`ディレクトリ自体はリポジトリのバージョン管理対象として想定していない
（`.gitignore`は本プロジェクトに存在しないため、コミット時に含めないよう手動で
注意すること）。

### README整合性監査（check-docs.js、Task22で追加）

Task22で、`scripts/generator/README.md`・`website/aor-admin/README.md`・
`scripts/generator/jobs/README.md`・`scripts/generator/review/review-schema.md`・
`docs/operations-checklist.md`の記載内容（CLIコマンド・APIパス・環境変数・ファイルパス・
schema説明・status値・provider名）を実装と突き合わせて確認した。**結果、意味のある差分は
見つからなかった**（Task18〜21で都度READMEを更新してきた運用が機能していたことを確認）。
具体的に照合した内容の例:

- `jobs/README.md`のRetry仕様（`RETRY_DELAYS_MS = [1000, 2000, 4000]`・
  `DEFAULT_MAX_ATTEMPTS`）・`job-cli.js`のサブコマンド一覧（enqueue/run/retry/cancel/
  status/history）→ 実装と完全一致
- `review-schema.md`の`review.json.status`4値（pending_review/approved/needs_revision/
  rejected）→ `review-engine.js`の`VALID_STATUSES`と完全一致
- `website/aor-admin/README.md`のAPI一覧（`/api/report/:id`等のパスパラメータ含む）・
  環境変数表（ADMIN_USER/ADMIN_PASSWORD/ADMIN_PORT/JOB_SCHEDULER_*）→
  `server.js`/`auth.js`の実装と完全一致

機械的に検証できる範囲（コマンド例のファイルパス実在性・環境変数表の名前が実際に
コード中で参照されているか）は`check-docs.js`として恒久化した:

```bash
node scripts/generator/check-docs.js
# 問題なし → "Docs check passed"（終了コード0）
# 問題あり → 該当ファイル・問題点を表示し "Docs check failed"（終了コード1）
```

**意図的にスコープ外にしたこと**: API仕様の細部・schema説明文の意味的な正しさ・
status値の遷移条件等は、正規表現による機械チェックでは検出できない（誤検出/見逃しの
リスクが高い）ため、`check-docs.js`には含めていない。過剰な自動化よりも、Task22で
実施したような人間（Claude）によるレビューの方が適していると判断した。

### 運用ログ一覧（scripts/generator/logs/）

| ファイル | 追加Task | 内容 | 書き込み元 |
|---|---|---|---|
| `llm-usage.jsonl` | Task11 | LLM呼び出し1回ごとの`{provider, model, input_tokens, output_tokens, estimated_cost, duration_ms, created_at}` | `llm/llm-client.js` |
| `search-usage.jsonl` | Task12 | 検索呼び出し1回ごとの`{requested_provider, used_provider, ...}`（フォールバック有無を含む） | `search/search-client.js` |
| `admin-audit.jsonl` | Task15 | Review Dashboardの認証イベント・レビュー操作の監査ログ（`{at, user, ip, action, target, success, detail}`） | `website/aor-admin/auth.js` |
| `job-history.jsonl` | Task16 | Job Runnerのジョブ実行履歴（開始・終了・成否・試行回数等） | `jobs/job-runner.js` |

**個人情報・secretは保存しない**: いずれのログもAPIキー・パスワード・セッショントークン等の
secret値を書き込まない（`llm-usage.jsonl`/`search-usage.jsonl`はトークン数・コスト等の
メタデータのみ、`admin-audit.jsonl`の`user`は`ADMIN_USER`のユーザー名文字列であり
パスワードは含まない、`ip`は接続元IPアドレスのみ）。会社名・URL等、レポート対象企業に
関する情報は含まれうる点は運用上留意すること。

**Task23で追加した構造的な保険（`shared/redact.js`）**: `job-history.jsonl`の`error`
（`jobs/job-runner.js`の`writeHistory()`）、`admin-audit.jsonl`の`detail`
（`website/aor-admin/auth.js`の`logAudit()`）は、書き込み前に`redactSecrets()`を通す。
これらのフィールドはエラーメッセージをそのまま記録する設計であり、将来実LLM/検索providerの
エラーメッセージ（外部APIのレスポンス本文をそのまま含みうる）が記録される可能性があるため、
`sk-...`/`tvly-...`のような既知のキー接頭辞・`Authorization: Bearer ...`・`XXX_API_KEY=...`
パターンを機械的に`[REDACTED]`へ置き換える。**完全性は保証しない**（正規表現ベースの簡易的な
保険であり、未知の形式のキーは検出できない）。詳細は`shared/redact.js`のコメント参照。
なお、ジョブの`error`フィールド自体（メモリ内・APIレスポンス、`/api/jobs`等）はredactしない
（認証済み管理者向けのデバッグ情報として、絶対パス等はそのまま見せた方が有用なため。
永続ファイルへの書き込み時にのみ適用する設計）。

**バックアップ**: いずれも追記式のJSON Lines（`.jsonl`）で、`scripts/generator/output/`
（レポート本体）とは独立している。本番運用時は`scripts/generator/output/`と合わせて
`scripts/generator/logs/`もバックアップ対象に含めることを推奨する（監査ログ・ジョブ履歴は
インシデント調査・利用実績の追跡に必要なため。取得方法は上記「バックアップ・リストア」参照）。

**ログローテーション/整理（`shared/log-rotation.js`、Task43で追加）**: Task42の設計検討で
「ログ種別ごとに性質が異なる」ことが判明したため、単一の画一的な方式ではなく、用途に応じた
2方式を使い分けている。

| ファイル | 方式 | 閾値/保持期間 | 削除の有無 |
|---|---|---|---|
| `llm-usage.jsonl`・`search-usage.jsonl`・`admin-audit.jsonl` | `archiveIfOversize()`: サイズ超過時に`<ファイル名>.archive-<timestamp>`へリネームして退避 | 10MB（`ARCHIVE_SIZE_BYTES`、各書き込み元ファイル内の定数） | **しない**（アーカイブのみ。監査・コスト分析目的で内容を失わないことを優先） |
| `job-history.jsonl` | `pruneOlderThan()`: 行ごとの`created_at`を見て古い行のみin place削除（世代ファイルは作らない） | 90日（`JOB_HISTORY_RETENTION_DAYS`、`jobs/job-runner.js`で定義） | **する**（Jobs Dashboardが`readHistory(limit)`で直接読む運用ログのため、無期限保持より
  ファイルサイズを抑えることを優先。JSON解析に失敗した行・日時が不正/欠落した行は
  安全側で削除しない） |

いずれも各ログの書き込み関数（`llm-client.js`の`writeLog()`、`search-client.js`の`writeLog()`、
`auth.js`の`logAudit()`、`job-runner.js`の`writeHistory()`）内で、追記の直前/直後に呼び出す。
`appendJsonLine()`（`shared/json-file.js`）自体はローテーションを意識しないシンプルな追記の
ままにしている（既存の設計方針・単一責任を維持するため）。アーカイブファイル・整理後の
`job-history.jsonl`はいずれも既存のJSON Lines形式のまま（1行あたりのフィールド構成は
変更していない）。

### エラーハンドリング統一（Task23）

CLI（`scripts/generator/`配下の全エントリポイント）とServer API（`website/aor-admin/server.js`）
とで、それぞれ以下の方針に統一した。

**CLI**: `shared/cli-utils.js`の`runCli(mainFn)`に統一する。

- 例外発生時: `致命的エラー: ${err.message}`を表示し、`process.exitCode = 1`を設定する
  （`process.exit()`は使わない。Windows + Node v24でfetch()実行後にprocess.exit()を呼ぶと
  クラッシュする既知の問題があるため、Task11から一貫した方針）
- stack traceは`AOR_DEBUG=true`（または`"1"`）設定時のみ表示する（Task23で追加。通常運用では
  利用者に不要な内部情報を見せないため）
- Task23で`validate-report.js`・`quality-evaluator.js`・`review/review-cli.js`・
  `jobs/job-cli.js`・`check-config.js`・`check-docs.js`・`run-all-tests.js`を`runCli()`へ
  統一した（従来は`process.exit()`直書き、独自の`main().catch(...)`、
  トップレベルのtry/catchが無い等、ファイルごとに方式が異なっていた）
- `generate-company-report.js`の唯一残っていた`process.exit(2)`（引数なし時）も
  `process.exitCode`方式に統一した

**Server API（`website/aor-admin/server.js`）**:

- 想定内のバリデーションエラー（review-engine.js/job-runner.js等が投げる、安全な文言と
  分かっているメッセージ）は、そのまま`400`＋`{error: err.message}`で返す（既存方針を維持）
- 想定外の例外（fsエラー等、内部の絶対パスを含みうる）を拾う汎用の`500`ハンドラは、
  レスポンスには汎用メッセージ（`{error: "サーバー内部でエラーが発生しました"}`）のみを返し、
  詳細（`err.stack`）はサーバー側のログにのみ出力する（Task23で変更。内部パスを
  レスポンスボディに含めないため）
- secret値（APIキー等）はいかなるAPIレスポンスにも含めない（`/api/health`は元々この方針。
  `config-validator.js`自体がAPIキーの値を一切扱わない設計のため、構造的に含まれ得ない）

### 障害時対応フロー（Task23）

1. **`GET /api/health`を確認する**（認証不要）。`status:"degraded"`なら`checks`の
   どの項目が`false`かを確認する（`auth`＝ADMIN_USER/ADMIN_PASSWORD未設定、`jobs`＝
   ジョブストア異常、`output_dir`/`logs_dir`＝該当ディレクトリへのアクセス不可、
   `config`＝LLM/SEARCH providerの設定不備）
2. **ログを確認する**（`scripts/generator/logs/`。詳細は「運用ログ一覧」参照）:
   - 認証・アクセス関連 → `admin-audit.jsonl`
   - ジョブの実行結果・失敗理由 → `job-history.jsonl`（`status:"interrupted"`のエントリが
     あれば、前回プロセスが異常終了した際に実行中だったジョブ。次節参照）
   - サーバープロセス自体のエラー → 標準エラー出力（`logger.error()`、`AOR_DEBUG=true`で
     詳細なstack traceも出力される）
3. **Dashboardが応答しない場合**: プロセスを再起動する
   （`ADMIN_USER=... ADMIN_PASSWORD=... node website/aor-admin/server.js`）。
   ジョブキューはメモリのみのため、再起動すると実行中だったジョブの情報はプロセスの
   メモリから失われるが、起動時に自動で`job-history.jsonl`へ`interrupted`扱いの記録が
   残る（次節「起動時復旧」参照）。レビュー状態（`review.json`）・レポート本体
   （`report.json`）はディスク上のファイルのため、再起動の影響を受けない
4. **データが壊れた/消えた場合**: 上記「バックアップ・リストア」の手順で復元する

### 起動時復旧（Job Runner、Task23で追加）

Job Runnerのジョブキューはメモリのみで永続化しない設計（jobs/README.md「アーキテクチャ上の
判断」参照）のため、`website/aor-admin/server.js`が予期せず終了・再起動すると、実行中
だったジョブの情報はメモリから失われる。この状況を検出できるよう、`jobs/job-runner.js`は
現在実行中のジョブのみを`scripts/generator/logs/job-runtime-state.json`という小さな別ファイル
に記録する（`job-history.jsonl`とは別物。**job構造・キューの状態遷移は変更していない**）。

サーバー起動時に毎回`jobRunner.recoverInterruptedJobs()`を呼び、このファイルに記録が
残っていれば「前回は正常終了しなかった」と判断して、`job-history.jsonl`へ
`status: "interrupted"`のレコードを1件残し、記録を消す。該当ジョブはqueued/failed等へ
自動的に戻したり再実行したりはしない（前回の実行内容が分からないため、安全側に倒して
「記録だけ残す」設計。必要であれば、利用者が改めて同じジョブを手動でenqueueする）。

### レポートの公開（publish-report.js、Task24で追加）

**背景**: Task23の運用前リハーサルで、`scripts/generator/output/<slug>/report.json`
（AIパイプラインの生成物）と`website/aor/data/<slug>.json`（受信者向けLPが実際に読み込む
ファイル）を繋ぐ処理が存在しないことが判明した
（[docs/pre-launch-rehearsal.md](../../docs/pre-launch-rehearsal.md)参照）。両者は
schema_version 2.4で構造が完全に一致しているため、変換は一切行わずそのままコピーする
方式で公開機能を追加した。

**設計方針（検討した3方式のうちAを採用）**:

| 方式 | 内容 | 採否 |
|---|---|---|
| A. 明示的な公開操作 | `publishReport(slug)`をCLI・Dashboardボタン両方から呼ぶ | **採用** |
| B. Job Runnerへpublish job type追加 | ジョブキュー・リトライ機構に乗せる | 見送り |
| C. 承認と同時に自動公開 | `approve()`実行時に自動でコピー | 見送り |

- Bを見送った理由: 公開はローカルファイルI/Oのみで完結する決定的な操作であり、
  Job Runnerが提供する指数バックオフ再試行（一時的な失敗に備える仕組み）の恩恵がない
- Cを見送った理由: `review-engine.js`は一貫して「Pure Function・副作用なし」の設計方針を
  守ってきており、`approve()`にファイルシステムへの書き込みという副作用を混ぜると
  この方針が崩れる。また、承認のタイミングと実際に公開するタイミングを分離できることは
  運用上も価値がある（複数社まとめて承認し、公開は別のタイミングでまとめて行う、
  といった運用が可能になる）

**使い方（CLI）**:

```bash
node scripts/generator/publish-report.js <slug>
# 成功: 公開しました: <website/aor/data/<slug>.json への絶対パス>
# 失敗（未承認等）: 公開できませんでした: ...（理由を表示、終了コード1）
```

**使い方（Dashboard）**: 詳細画面（`/detail.html?company=<slug>`）に「website/aorへの公開」
欄が追加されており、「公開する」（未公開時）/「再公開する」（公開済み・内容更新時）
ボタンから実行できる。`publishable`（`isPublishable() === true`）でない間はボタンが
無効化され、クリックできない。一覧画面にも「公開」列（●=公開済み、—=未公開）を追加した。

**安全性**:

- `report.json`・`review.json`はいずれも読み取り専用で、一切変更しない
  （`publish-report.test.js`で実際にファイル内容のバイト比較により確認済み）
- 公開可否の判定は`review-engine.js`の`isPublishable()`をそのまま使う（独自の判定ロジックは
  作らない）。未承認（`review.status !== "approved"`）・`evaluation.status === "FAIL"`・
  **承認後にreport.jsonが再生成された（Task36で追加、詳細は「publishable判定」節参照）**の
  いずれかに該当する場合はCLI・API（`POST /api/publish/:slug`）のいずれから呼んでも拒否される
- 公開の実行者（`user`）・日時（`at`）・対象slug（`target`）は`admin-audit.jsonl`へ
  `action: "publish"`として記録される（成功・失敗いずれも記録。詳細は
  [website/aor-admin/README.md](../../website/aor-admin/README.md)「Audit Log」参照）
- `website/aor/data/<slug>.json`への書き込みは`report.json`の内容をそのままコピーするのみで、
  フィールドの変換・加工は一切行わない
- **（Task25で追加）パストラバーサル対策**: `slug`はURLパスセグメント・CLI引数のいずれから
  渡されうるが、[shared/path-safety.js](shared/path-safety.js)の`validateSlug()`（英数字・
  ドット・ハイフンのみ許可、`".."`は拒否）と`isWithinDir()`（解決後のパスが
  `OUTPUT_DIR`/`website/aor/data/`配下に収まっているかの二重チェック）を経由しない限り、
  一切のファイル読み書きを行わない。同じ関数を`website/aor-admin/server.js`の
  `loadCompany()`（Task14から存在。`/api/report/:id`等が内部で使用）にも適用した
  （詳細な経緯・実測結果は[docs/final-audit-report.md](../../docs/final-audit-report.md)参照）
- **（Task25で追加）上書き検知**: `website/aor/data/`には手動サンプル
  （`company-01-manufacturing.json`等）とAIパイプラインが公開したデータが同じ
  ディレクトリに混在する（次節「website/aor/data/の管理方針」参照）。公開先に既存ファイルが
  ある場合は`WARN`ログを出す（ブロックはしない。再公開は正規の操作のため）

### website/aor/data/の管理方針（Task25で追加）

`website/aor/data/`配下には性質の異なる2種類のファイルが混在する。

| 種別 | 例 | 由来 | 上書きされうるか |
|---|---|---|---|
| 手動サンプルデータ | `company-01-manufacturing.json`・`company-02-construction.json`・`company-03-service.json` | Task7以前に人手で作成した、実在しないフィクション企業のデモ用データ（`docs/mock_data/`由来） | slugが偶然一致しない限り上書きされない |
| AIパイプライン公開データ | `example.com.json`等 | `scripts/generator/output/<slug>/report.json`を`publish-report.js`で公開したもの | 同じslugで再公開すると意図的に上書きされる（想定内） |

**運用上の注意**:

- 手動サンプルの3ファイルは、AIパイプラインが生成するslug（`slugFromUrl()`が実際の
  企業ドメインから生成する。例: `https://example.com` → `example.com`）と偶然一致する
  可能性は極めて低い（`company-01-manufacturing`のような命名はドメイン名としては
  非現実的なため）が、ゼロではない。公開操作で既存ファイルを上書きする場合は
  `logger.warn()`でログに記録される（上記「安全性」参照）ため、
  `scripts/generator/logs/`の標準エラー出力を運用担当者が確認すること
- 手動サンプルを誤って上書き・削除した場合の復旧手段は無い（gitで管理されていないため）。
  `node scripts/generator/backup.js`は**Task25から`website/aor/data/`も推奨バックアップ
  対象に含めている**（Task24で公開機能を追加した時点ではバックアップ対象から漏れていたが、
  本番公開前の最終監査で発見し追加した。詳細は「バックアップ・リストア」参照）。
  定期的にバックアップを取得しておくこと
- website/aorのUI・仕様自体はこのファイル混在の影響を受けない（`report-preview.html`等は
  `?company=<slug>`に対応する`data/<slug>.json`をそのまま読むだけで、ファイルの由来を
  区別しない設計のため）

### 公開の取り消し（unpublish-report.js、Task38で追加）

**背景**: Task24で`publish-report.js`を追加した際、公開の取り消し機能は意図的にスコープ外と
し、`website/aor/data/<slug>.json`を手動で退避・削除するという緊急時の代替手順のみを
本ファイル・`docs/operations-checklist.md`に文書化していた。Task34の残存課題評価で
「対応可能だが必須ではない」と判定した上で、Task38で実装した。

**設計方針**: `publish-report.js`と対称的な最小構成。`shared/path-safety.js`の
`validateSlug()`・`isWithinDir()`をそのまま再利用し（パストラバーサル対策の重複実装を
避ける）、`AOR_DATA_DIR`・`publishedPathFor()`・`isPublished()`も`publish-report.js`から
importして再利用している（独自実装しない）。`report.json`・`review.json`はいずれも
一切参照・変更しない（`website/aor/data/<slug>.json`の削除のみを行う単純な操作のため）。

**使い方（CLI）**:

```bash
node scripts/generator/unpublish-report.js <slug>
# 成功（公開済みだった場合）: 公開を取り消しました: <website/aor/data/<slug>.json への絶対パス>
# 成功（元々未公開だった場合）: 既に非公開です（対象ファイルが存在しません）: <slug>
# 失敗（不正なslug等）: 公開を取り消せませんでした: ...（理由を表示、終了コード1）
```

**使い方（Dashboard）**: 詳細画面（`/detail.html?company=<slug>`）の「website/aorへの公開」欄に、
公開済みの場合のみ「公開を取り消す」ボタンが表示される（`POST /api/unpublish/:slug`）。

**冪等性についての設計判断**: 既に非公開（対象ファイルが存在しない）状態で実行してもエラーには
せず、`{ok: true, alreadyUnpublished: true}`を返す（成功扱い）。「非公開状態にする」という
目標状態への操作という位置づけのため、既に目標状態に達している場合はエラーにしない方が
（二重クリック・リトライ時に運用担当者を混乱させないため）運用上望ましいと判断した。

**publishable判定・承認状態との関係**: unpublish操作は`review.json`の承認状態
（`review.status`）には一切影響しない。「公開データを取り下げる」ことと「レビュー判断を覆す」
ことは意図的に別の操作として設計している（取り消し後に何もせず再度「公開する」ボタンを押すと、
`isPublishable()`が引き続き`true`であればそのまま再公開できる）。

**監査ログ**: 公開の実行者・日時・対象slugは`admin-audit.jsonl`へ`action: "unpublish"`として
記録される（成功・失敗いずれも記録。`publish`アクションと同じ形式）。

## 人間レビューworkflow（scripts/generator/review/、Task13で追加）

AI生成レポート（`report.json`）は、そのままでは配信に使えない。生成 → 品質評価 → 人間レビュー →
（承認された場合のみ）配信可、という一連の流れを、JSONベース・DB不要・CLI完結で管理する。

```
AI分析（llm-client.js、Task11）
   ↓
品質評価（quality-evaluator.js、Task10）… report.evaluation に格納
   ↓
人間レビュー（review-engine.js、Task13）… review.json に格納（report.jsonとは別ファイル）
   │
   │  pending_review ──approve────────→ approved
   │         │                              │
   │         ├──reject──────────────→ rejected
   │         │
   │         └──requestRevision───→ needs_revision ──approve──→ approved
   │
   ↓
publishable判定（isPublishable）
   = review.status === "approved" AND evaluation.status !== "FAIL"
   ↓
（true の場合のみ）配信可能
```

### 設計方針: なぜreport.jsonの`human_review`と別にreview.jsonを新設したか

`report.json`には元々（Task8時点から）`human_review`という埋め込みフィールドがあるが、
Task13では**あえて別ファイル`review.json`**を新設した（`scripts/generator/output/<slug>/review.json`）。
理由と、両者が今は同期しないという既知の制約は
[review/review-schema.md](review/review-schema.md)「設計方針」に詳しく記載している。要点:

- `report.json`（schema_version 2.4）の構造を変更しないため
- コメント・修正指示・監査履歴（監査ログ）を持つ本格的なレビューworkflowは、
  将来的なDB移行を見据えて独立コンポーネントとして設計すべきため
- **既知の制約（Task14で「同期しない」と最終決定）**: `review.json`が`approved`になっても
  `report.json`側の`human_review.status`は自動更新されない。理由（enumの非互換等）は
  [review/review-schema.md](review/review-schema.md)「同期方針の最終決定（Task14）」を参照

### Review Dashboard（website/aor-admin/、Task14で追加、Task15で認証を追加）

`review-cli.js`と同じ`review-engine.js`のPure Functionを使う、ブラウザベースの管理画面を
`website/aor-admin/`に追加した（`website/aor/`＝受信者向け画面とは別アプリケーション、
変更していない）。一覧・詳細表示、承認・却下・差し戻し・コメント・修正指示の操作、
SSEによる自動更新に対応する。Task15でBasic認証・セッションCookie・CSRF対策・
セキュリティヘッダ・監査ログ（`logs/admin-audit.jsonl`、下記参照）を追加し、
`ADMIN_USER`/`ADMIN_PASSWORD`未設定時は起動を拒否するようにした。詳細は
[website/aor-admin/README.md](../../website/aor-admin/README.md)を参照。

```bash
ADMIN_USER=admin ADMIN_PASSWORD=xxxx node website/aor-admin/server.js
# → http://localhost:4600
```

### Job Runner / Scheduler（scripts/generator/jobs/、Task16で追加）

`generate-company-report.js`・`quality-evaluator.js`・`company-context.js`（search）を
「ジョブ」として非同期・リトライ可能に実行するための基盤を`scripts/generator/jobs/`に追加した。
目的は「AI Opportunity Reportを毎日自動生成できる状態にする」こと。メモリ内キュー、
指数バックオフでのリトライ（1秒→2秒→4秒、最大3回）、`setInterval()`のみで実装した
スケジューラ、`logs/job-history.jsonl`への実行履歴記録に対応する。ジョブランタイムは
`website/aor-admin/server.js`（常駐プロセス）内で動かし、`website/aor-admin/`に
Jobs画面（一覧・追加・retry・cancel、SSE自動更新）を追加した。詳細は
[jobs/README.md](jobs/README.md)を参照。

```bash
# 事前にADMIN_USER/ADMIN_PASSWORDを設定してwebsite/aor-admin/server.jsを起動しておくこと
node scripts/generator/jobs/job-cli.js enqueue generate-report --url=https://company.jp
node scripts/generator/jobs/job-cli.js status
node scripts/generator/jobs/job-cli.js history
```

### CLIコマンド一覧

```bash
# 承認・却下・差し戻し（いずれも --reviewer=NAME が必須）
node scripts/generator/review/review-cli.js approve <report.jsonのパス> --reviewer=ops-1 [--comment="..."]
node scripts/generator/review/review-cli.js reject  <report.jsonのパス> --reviewer=ops-1 [--comment="..."]
node scripts/generator/review/review-cli.js revise  <report.jsonのパス> --reviewer=ops-1 [--comment="..."] [--fix="..." --fix="..."]

# コメント・修正指示の追加のみ（statusは変更しない）
node scripts/generator/review/review-cli.js comment  <report.jsonのパス> --actor=ops-1 --text="..."
node scripts/generator/review/review-cli.js fix      <report.jsonのパス> --actor=ops-1 --description="..."

# 参照系
node scripts/generator/review/review-cli.js history <report.jsonのパス>
node scripts/generator/review/review-cli.js status   <report.jsonのパス>   # review.jsonの検証結果とpublishableを表示
```

`review.json`は`<report.jsonと同じディレクトリ>/review.json`に保存される
（`scripts/generator/output/<slug>/report.json` → `scripts/generator/output/<slug>/review.json`）。
まだ`review.json`が存在しない場合、初回コマンド実行時に`pending_review`の初期状態から自動生成される。

### review-engine.jsの設計: Pure Function中心

`approve()`/`reject()`/`requestRevision()`/`addComment()`/`addFix()`はすべてPure Function
（同じ入力に対して常に同じ出力を返し、引数のreviewオブジェクトを変更せず新しいオブジェクトを返す）。
ファイルI/O（`loadReview()`/`saveReview()`）はこれらとは明確に分離している。`review-cli.js`は
「I/Oで読む → pure関数で状態を更新 → I/Oで書く」という薄いフロントエンドに徹する。

### publishable判定（Task5、Task36で条件追加）

```js
const { isPublishable } = require("./review/review-engine");
const { publishable, reasons } = isPublishable(review, report.evaluation, report);
```

`review.status === "approved"`かつ`evaluation.status !== "FAIL"`の**両方**を満たした場合のみ
`true`。品質評価が`PASS`でもレビューが未承認なら配信不可、逆にレビューが`approved`でも
品質評価が`FAIL`（例: 情報源が極端に薄いレポート）なら配信不可、という両輪のガードになっている。

**（Task36で追加）第3引数`report`を渡すと、`report.meta.generated_at`が`review.reviewed_at`より
後（＝承認後に`report.json`が再生成された可能性がある）場合も`false`になる**。Task29で判明した
「同一slugで再生成しても承認状態が自動的に無効化されない」という既知の制約への対応
（詳細は[review/review-schema.md](review/review-schema.md)「publishable判定」参照）。
`report`は省略可能で、省略時はTask36以前と同じ2条件のみで判定する。

### validate-report.jsの拡張（Task6）

`validateReport()`（report.json用）とは別に、`validateReview(review)`（review.json用）を追加した。
チェック内容は[review/review-schema.md](review/review-schema.md)「バリデーション」を参照。

## 検索抽象化レイヤー（search-client.js、Task12で追加）

`fetch-government.js` / `fetch-industry.js` / `fetch-news.js` / `fetch-statistics.js`（Task9まで
静的なシミュレーションデータを返していた）を、特定検索サービスに依存しない検索抽象化レイヤー
経由に置き換えた。各fetch-*.jsは`query-builder.js`でクエリを組み立て、
`search-client.js`の`search(query, options)`のみを呼ぶ（provider実装を意識しない）。

### provider切替方法

| provider | 環境変数 | 必要なAPIキー | 備考 |
|---|---|---|---|
| `mock`（デフォルト） | `SEARCH_PROVIDER=mock`（省略時のデフォルト） | 不要 | クエリから決定的な合成結果を生成。動作確認済み |
| `tavily` | `SEARCH_PROVIDER=tavily` | `TAVILY_API_KEY` | LLM向けに設計された検索API。**Task30〜32で実APIキーによる動作確認済み**（詳細は[docs/real-provider-verification.md](../../docs/real-provider-verification.md)参照） |
| `bing` | `SEARCH_PROVIDER=bing` | `BING_SEARCH_API_KEY` | Bing Web Search API。未検証（APIキーなし） |

その他の環境変数: `SEARCH_TIMEOUT_MS`（既定15000）、`SEARCH_MAX_RETRIES`（既定2）。

**【llm-client.jsとの重要な設計上の違い】** `LLM_PROVIDER`にAPIキーのないproviderを指定すると
`llm-client.js`はエラーで停止するが、`SEARCH_PROVIDER`にAPIキーのないproviderを指定した場合、
`search-client.js`は**警告ログを出した上で自動的にmockへフォールバックする**（ユーザー指示
「未設定の場合：必ずmockへfallbackする」に対応）。検索は情報収集の一部であり、mockでも
パイプライン全体を最後まで検証できるため、LLM分析ほど厳格に停止させる必要はないという判断。

### 検索クエリの自動生成（query-builder.js）

会社名から最低5クエリを自動生成する（Task4要件）。

| カテゴリ | クエリ例 | 付与するsource_type |
|---|---|---|
| news | `{会社名} 最新ニュース` | `news` |
| government | `{会社名} 補助金` | `government` |
| industry（1） | `{会社名} 業界動向` | `industry_association` |
| industry（2） | `{会社名} 技術` | `technology` |
| statistics | `{会社名} 市場` | `statistics` |

会社名は`company-context.js`の`guessCompanyName()`が、会社ページの`<title>`から区切り文字
（`|`・`-`等）より前の部分を抜き出して簡易的に推測する（本格的な会社名抽出はAI分析の役割）。

### 共通インタフェース

```js
{
  id, displayName, requiresApiKey,
  isConfigured(): boolean,
  searchRaw(query, options): Promise<{
    results: Array<{ title, url, snippet, published_at, organization }>,
    usage: Object
  }>
}
```

providerは検索エンジン固有の生の結果を返すだけでよく、AOR独自の分類（`source_type`/
`source_role`）を知る必要はない。`search-client.js`が呼び出し元（fetch-*.js）から渡された
`options.sourceType`/`options.sourceRole`を結果に付与し、`normalize-sources.js`が期待する
生fetchアイテム形式（`{source_type, source_role, label, url, content, organization,
published_at, ok, simulated}`）に変換する（`search-interface.js`の`toRawSourceItem()`）。

### retry・timeout・エラー処理・usage logging

llm-client.jsと同じ堅牢な設計（Promise.raceによるハードタイムアウト、指数バックオフでの
retry）を採用している。`search-client.js`の`search()`が返す`results`の形状は
`search-interface.js`の`validateSearchRawShape()`で検証し、不正な場合はretryまたはエラーにする。
呼び出しごとに`scripts/generator/logs/search-usage.jsonl`へ`{requested_provider, used_provider,
fallback, query, source_type, result_count, duration_ms, created_at}`を追記する
（`fallback: true`ならAPIキー未設定によるmockフォールバックが発生したことを示す）。

### 重複検出アルゴリズムの補強（deduplicate-sources.jsの修正、Task12で発見・修正）

Task12の実装中に、`deduplicate-sources.js`の「同記事」近似判定（一方のタイトルがもう一方を
包含する場合に重複とみなす）が、**会社名のような短いタイトルを、検索結果タイトル全て
（「会社名 + サフィックス」の形式）に対して誤って「同記事」と判定してしまう**バグを発見した。
例えば会社ページのタイトルが単に`"Example Domain"`である場合、検索結果タイトル
`"Example Domain 補助金に関する検索結果"`にこの文字列が丸ごと含まれるため、無関係な
複数カテゴリの情報源がすべて同一グループに統合されてしまい、`11件取得 → 1件` まで
過剰に削減される事象を実際に確認した。

**修正**: 包含関係があるだけでなく、短い方の文字列が長い方に対して十分な割合
（60%以上）を占める場合のみ「同記事」とみなすよう`isDuplicate()`を修正した
（`scripts/generator/deduplicate-sources.js`）。あわせて`mock-search-provider.js`の
合成タイトルも、会社名が全体に対して占める割合が下がるよう調整した（二重の対策）。
修正後は`example.com`で`11件取得 → 6件`（1社ページ + 5カテゴリ、意図通り）に改善したことを確認済み。

## LLM抽象化レイヤー（llm-client.js、Task11で追加）

`simulate-ai-analysis.js`（Task8のルールベース・シミュレーション）を実LLMに置き換え可能にする、
特定AIサービスに依存しない抽象化レイヤー。`generate-company-report.js`は
`llm-client.js`の`generateAnalysis(context)`のみを呼び出し、実際にどのproviderが動くかは
`LLM_PROVIDER`環境変数で切り替わる（アプリケーションコード側の変更は不要）。

### provider切替方法

| provider | 環境変数 | 必要なAPIキー | 備考 |
|---|---|---|---|
| `mock`（デフォルト） | `LLM_PROVIDER=mock`（省略時のデフォルト） | 不要 | `simulate-ai-analysis.js`をそのまま利用。ルールベースで課金なし |
| `deepseek` | `LLM_PROVIDER=deepseek` | `DEEPSEEK_API_KEY` | 低コスト高性能AIとして優先候補。モデル名は`DEEPSEEK_MODEL`で上書き可（既定`deepseek-chat`） |
| `qwen` | `LLM_PROVIDER=qwen` | `QWEN_API_KEY` | Alibaba Cloud DashScope（OpenAI互換モード）。モデル名は`QWEN_MODEL`で上書き可（既定`qwen-plus`） |
| `openai` | `LLM_PROVIDER=openai` | `OPENAI_API_KEY` | 比較用。モデル名は`OPENAI_MODEL`で上書き可（既定`gpt-4o-mini`） |

その他の環境変数（省略時は既定値を使用）:

- `LLM_TIMEOUT_MS`（既定30000）: 1回の呼び出しのタイムアウト（ミリ秒）
- `LLM_MAX_RETRIES`（既定2）: タイムアウト・エラー時の再試行回数（指数バックオフ、500ms→1000ms→…）

**【Task30〜32で更新】** Task11時点では「本プロジェクトでは実際のAPIキーを一切設定していない
（プロジェクトルール: 有料外部サービスのAPIキー設定は行わない）」という前提で、
`openai-provider.js`・`deepseek-provider.js`・`qwen-provider.js`はいずれもコードとしては
実装済みだが未検証だった。**Task30〜32で、ユーザーの明示的な許可のもとDeepSeekの実APIキーを
用いて実際に動作確認した**（`deepseek-provider.js`のみ検証済み。詳細は
[docs/real-provider-verification.md](../../docs/real-provider-verification.md)参照）。
`openai-provider.js`・`qwen-provider.js`は引き続き未検証のまま（有料APIキーを設定していない）。
`LLM_PROVIDER`に`mock`以外を指定してもAPIキーが未設定の場合は、`llm-client.js`が実行前に
明確なエラーメッセージで停止する（無言でmockにフォールバックはしない）。

### 共通インタフェース

各provider（`llm/*.js`）は以下の形を実装する。

```js
{
  id, displayName, model, requiresApiKey,
  pricing: { inputPerMillion, outputPerMillion, currency, asOf, note },
  isConfigured(): boolean,
  callRaw({ context, systemPrompt, userPrompt, timeoutMs, signal }): Promise<{ content, usage }>
}
```

`llm-client.js`の`generateAnalysis(context)`は、providerの`callRaw()`をretry・timeoutで
ラップして呼び出し、返ってきた`content`（JSON文字列、前後に説明文やコードフェンスが
付いていても救済抽出を試みる）をパースして`free_opportunity`/`locked_opportunities`/
`paid_analysis`の形状を検証し、`usage`からproviderの`pricing`を使って推定コストを計算する。
結果は`{ free_opportunity, locked_opportunities, paid_analysis, usage, provider }`で返る
（`source_pages`は含まない。`context.sources`から`buildSourcePages()`で別途組み立てる責務は
`generate-company-report.js`側にある）。

### retry・timeout・エラー処理の仕様

- **timeout**: `AbortController`をproviderへ渡すのに加え、`Promise.race`相当のハードタイムアウトを
  二重に設ける。provider実装がAbortSignalを尊重しない場合でも、必ず`timeoutMs`で確定する
- **retry**: タイムアウト・HTTPエラー・不正JSON等、いずれの失敗も指数バックオフで再試行する
  （`LLM_MAX_RETRIES`回まで）。全て失敗した場合は最後のエラー内容を含む例外を投げる
- **エラー処理**: APIキー未設定・不明なprovider名・AI出力の必須キー欠如は、いずれも
  原因が分かる日本語メッセージで例外を投げる。`generate-company-report.js`はこれを
  `main().catch()`で捕捉し、`process.exitCode = 1`で終了する（**`process.exit()`は使わない**。
  Node.js v24 + Windows環境で、`fetch()`実行後に`process.exit()`を呼ぶとlibuvのネイティブ
  アサーションでクラッシュする既知の問題を確認したため）

### コスト計算・ログ（Task7）

`provider.pricing`（`inputPerMillion`/`outputPerMillion`、USD）と実際のtoken使用量から
推定コストを計算し、`scripts/generator/logs/llm-usage.jsonl`に1行1呼び出しのJSON Linesとして
追記する（`{provider, model, input_tokens, output_tokens, estimated_cost, duration_ms, created_at}`）。
**料金はいずれも2026年8月時点の目安値であり、正確な請求額を保証しない。** 予算判断に使う前に、
各providerの公式pricingページで最新価格を必ず確認すること（各provider実装ファイルの
コメントに参照先を記載）。

### provider別コスト比較方法（Task8: experiments/）

```bash
node scripts/generator/experiments/run-experiments.js https://company.jp
```

同一の`company_context`を全provider（mock/deepseek/qwen/openai）に投げ、結果を
`scripts/generator/experiments/<provider>-result.json`に保存する。APIキーが未設定のproviderは
実際には呼び出さず`{skipped: true, reason: "..."}`として記録する（本プロジェクトの実行では
mock以外は全てskipped）。APIキーを用意できる場合、この仕組みでprovider間の
出力品質（`quality-evaluator.js`で評価）・トークン数・コストを横並び比較できる。

### 本番推奨構成

Task11時点（実LLM未検証）での暫定的な推奨は以下のとおり。**実際にAPIキーを用意して
`experiments/run-experiments.js`で比較検証した上で最終決定すること**（本プロジェクトでは未実施）。

- **第一候補**: `deepseek`（低コスト・OpenAI互換で切替コストが低い）
- **比較・フォールバック用**: `openai`（実績が豊富、価格はDeepSeekより高め）
- **開発・CI用**: `mock`（無料・高速・決定的な出力でパイプラインの動作確認に向く）

## 品質評価エンジン（quality-evaluator.js、Task10で追加）

`validate-report.js`が「形式が正しいか（壊れていないか）」を判定するのに対し、
`quality-evaluator.js`は「内容の質が十分か」を100点満点で採点する。両者は役割が異なり、
検証パイプラインでは品質評価（[8]）を先に実行し、その結果（`evaluation`）を含めた
report.json全体を検証（[9]）する順序になっている。

採点対象は主に `source_pages`（情報源の量・多様性・新しさ・スコア分布）、
`free_opportunity.evidence`（実際に引用された根拠の質・件数）、`human_review.status`
（人間レビューの進捗）の3系統。12項目・合計100点の内訳は以下のとおり。

| 項目 | 配点 | 何を見るか |
|---|---|---|
| 情報源数 | 8点 | `source_pages.length` |
| 情報源バランス | 8点 | `source_type`の種類数 |
| 政府情報有無 | 6点 | `government`または`statistics`が1件以上あるか |
| 企業情報有無 | 6点 | `company`が1件以上あるか |
| 業界情報有無 | 6点 | `industry_association`または`technology`が1件以上あるか |
| ニュース非偏重 | 8点 | `news`の比率が低いほど高得点 |
| 引用の質 | 8点 | `evidence[].quote`が実際に埋まっている件数 |
| 情報源scoreの平均 | 15点 | `source_pages[].score`の平均値 |
| source_type偏り | 8点 | 特定の`source_type`への集中度が低いほど高得点 |
| source_role偏り | 8点 | 特定の`source_role`への集中度が低いほど高得点 |
| evidence数 | 8点 | `free_opportunity.evidence.length` |
| human_review状態 | 11点 | `approved`=満点、`pending_review`=中間、`needs_revision`=0点 |

出力は `{ score, grade, status, reasons[], warnings[], improvements[], breakdown }`。
`grade`（A〜D）と`status`（PASS/REVIEW/FAIL）は同じscoreから**別々の基準**で導出する
（ユーザー指定はstatusの5段階しきい値のみのため、gradeは一般的な10点刻みの4段階を
独自に採用した）。

- `grade`: A=90-100 / B=80-89 / C=70-79 / D=0-69
- `status`: PASS=80-100 / REVIEW=50-79 / FAIL=0-49

**既知の特性（バグではない）**: `human_review状態`は12項目のうちの1つ（11点）に過ぎないため、
情報源・根拠の質そのものが高ければ、`human_review.status`が`needs_revision`や
`pending_review`のままでも`status`が`PASS`になり得る。`quality-evaluator.js`が測っているのは
あくまで「情報の質」であり、「配信可能かどうか（人間レビューの完了）」とは別の軸である
（配信可否の最終判断は引き続き`human_review.status`が担う）。

`report.evaluation`にはこの評価結果がそのまま格納され、`scripts/generator/output/<slug>/evaluation.md`
にも人間可読なMarkdownとして出力される。

## Task12時点の制限（重要）

このツールは**Phase1.5 MVP**であり、以下は意図的にシミュレーション（未実装）またはmockでの
検証にとどまっている。

| 工程 | Task12時点の状態 | 実装予定 |
|---|---|---|
| `fetch-company.js` | **実際にHTTP取得する**（与えられたURL1件のみ）。`Last-Modified`ヘッダーがあれば`published_at`として利用 | — |
| `fetch-government.js` / `fetch-industry.js` / `fetch-news.js` / `fetch-statistics.js` | **search-client.js経由の検索に対応済み**。ただしデフォルトのSEARCH_PROVIDER=mockでは、決定的な合成結果（`simulated: true`）を返す。実検索providerは有料APIキーを設定していないため未検証 | ユーザー自身がAPIキーを用意して`experiments/run-search-experiments.js`で検証 |
| `normalize-sources.js` / `merge-sources.js` / `deduplicate-sources.js` / `score-sources.js` | 実装済み（Task9）。Task12でmock検索データ（1社ページ＋5カテゴリ×2件の近似重複）を通した実質的な重複統合・多様なスコア分布を確認済み | 実検索providerでの実データ検証は未実施 |
| `llm-client.js`（AI分析） | **コードは実装済み（mock/openai/deepseek/qwen）**。ただし本プロジェクトでは有料APIキーを設定していないため、`openai`/`deepseek`/`qwen`は**未検証**。デフォルトの`mock`（`simulate-ai-analysis.js`のルールベース）で動作確認している | ユーザー自身がAPIキーを用意して`experiments/run-experiments.js`で検証 |

**現在の状態（Task30〜32で更新）**: 上表は**Task12時点**の記録であり、当時は実検索・実LLM
providerともに未検証だった。その後**Task30〜32で、`tavily`（実検索）・`deepseek`（実LLM）を
実際のAPIキーで検証済み**（E2E含む）。`bing`・`openai`・`qwen`は引き続き未検証のまま。
詳細・実測値は[docs/real-provider-verification.md](../../docs/real-provider-verification.md)参照。

**生成されたreport.jsonは、そのままでは配信に使用できない。** `human_review.status`は常に
`"pending_review"`で生成され、[06_human_review.md](../../docs/strategy_v2/06_human_review.md)の
原則どおり人間の確認・承認を経る必要がある。

## normalize-sources.js: 正規化後の構造

取得元（company/government/industry/news/statistics）によらず、以下の構造に統一する。
不足項目は`null`を許容する。

```
{ id, title, url, organization, published_at, summary, quote,
  source_type, source_role, evidence_strength, score }
```

`id`と`score`はnormalize段階では`null`（company-context.jsでのスコア確定・上位20件選定後に確定する）。

## deduplicate-sources.js: 重複とみなす条件

- URL完全一致
- タイトル完全一致
- URL末尾違い（末尾スラッシュ・クエリ・フラグメントのみが異なる）
- PDF違い（拡張子だけが異なる同一ドキュメント）
- 同記事（正規化タイトルが一致、またはどちらかがもう一方を包含する近似一致）

重複と判定された場合は、`published_at`・`organization`・`summary`の充実度から算出した
「情報量スコア」が高い方を残す。

## score-sources.js: スコア仕様

`source_type`とタイトル・URLから内部カテゴリ（政府/企業IR/企業公式/業界団体/技術団体/
大手ニュース/専門誌/ブログ/SNS/その他）を推定し、以下の基礎点を与える。

| カテゴリ | 基礎点 |
|---|---|
| 政府 | 95 |
| 統計 | 90 |
| 企業IR | 90 |
| 企業公式 | 88 |
| 業界団体 | 85 |
| 技術団体 | 82 |
| 大手ニュース | 75 |
| 専門誌 | 70 |
| ブログ | 40 |
| SNS | 20 |
| その他 | 50 |

加点・減点:

- 新しい情報（`published_at`が12か月以内）: **+10**
- 古い情報（`published_at`が24か月以上前）: **−10**
- 引用（`quote`）あり: **+5**
- 著者（`author`）あり: **+5**（現状の正規化データには`author`フィールドが存在しないため、
  実質的には発火しない。将来`normalize-sources.js`が著者情報を持てるようになった際のための
  拡張ポイントとして用意している）

最終スコアは0〜100にクランプする。

**重要**: ここで使う「政府/企業IR/企業公式/…」等の内部カテゴリは、スコア計算専用の分類であり、
`docs/mock_data`・`website/aor`が使う公式の`source_type`列挙型（company/government/
industry_association/statistics/news/technology）は一切変更していない。

## AI分析プロンプトの厳守事項

[prompts/quality-rules.md](prompts/quality-rules.md)（Task11で追加、実際にllm-client.jsが
システムプロンプトとして読み込む）に定義した、実LLM・mock問わず適用すべき厳守事項
（[04_company_analysis.md](../../docs/strategy_v2/04_company_analysis.md)の
「情報源の利用条件」に対応。[prompt-company-analysis.md](prompt-company-analysis.md)（Task8時点の
設計ドキュメント）の6原則を踏襲）:

1. ニュースだけで判断しない（company + government/statistics + industry を組み合わせる）
2. 企業情報必須
3. 政府または統計必須
4. 業界情報必須
5. evidenceは`source_id`参照のみを保持し、出典名・URLを直接埋め込まない
6. 推測禁止（company_contextにない事実を作らない。事実と推論を文章上で区別する）

**（Task11で追加）fact/analysis/action区分**: スキーマ自体は変更していないため、この区分は
「どのフィールドにどの性質の文章を書くか」という執筆ルールとして適用する（詳細は
[prompts/quality-rules.md](prompts/quality-rules.md)）。`why_now`/`why_company`/`market_change`/
`first_action`はfact/action区分（根拠のない推測表現を避ける）、`extended_analysis`等は
analysis区分（根拠付きの推論であれば許容）。`validate-report.js`がこれを**警告**として
機械的にチェックする（詳細は次節）。

`mock-provider.js`（旧`simulate-ai-analysis.js`、Task11でmockへ役割移管）は、これらのルールを
形式的に満たす構造（evidenceの組み合わせ方等）を再現しているが、**文章の内容自体は
実際のAI分析ではない**（ルールベースのテンプレート）。実LLM provider（openai/deepseek/qwen）は
`prompts/`のプロンプトに従って実際に文章を生成する想定で、Task11時点では未検証だったが、
**Task30〜32で`deepseek`は実際にこのプロンプトに従って生成し、明らかな破綻や必須フィールド
欠如が無いことを確認済み**（`openai`/`qwen`は引き続き未検証。詳細は
[docs/real-provider-verification.md](../../docs/real-provider-verification.md)参照）。

## Validatorのチェック項目（Task9で追加）

[validate-report.js](validate-report.js)は以下を検証する。

- `meta.schema_version`が`"2.4"`であること
- 必須フィールドの存在（company_profile / source_pages / free_opportunity / paid_analysis 等）
- ID重複（`source_pages[].id`、`locked_opportunities[].id`、`additional_opportunities[].id`）
- `evidence[].source_id`が`source_pages`に実在すること
- `priority_matrix`の整合性（4象限すべての存在、`opportunity_ids`が`additional_opportunities`に
  実在すること、同一Opportunityが複数象限に重複割り当てされていないこと）
- **（Task9で追加）** `source_pages`各項目:
  - `score`が必須・0〜100の数値であること
  - `published_at`は任意。未設定/`null`はPASS、値が存在する場合のみISO8601形式であることを
    検証する（**Task32で変更**。Tavily等の実検索providerでは公開日を取得できない検索結果が
    多く存在する（実測でsource_pagesの95%）ことが判明したため、日付欠落自体はエラー扱いに
    しないよう修正した。「取得できないこと」と「取得した日付が不正であること」を区別する。
    `score-sources.js`（後述）・`quality-evaluator.js`・`isPublishable()`はいずれも元々
    `published_at`の欠落を問題視しない設計だったため、この修正で挙動が変わるのは
    `validate-report.js`のみ）
  - `source_type`・`source_role`が列挙型の値であること
  - `source_pages`内でのURL重複がないこと
- **（Task10で追加）** `evaluation`（quality-evaluator.jsの出力）:
  - `report.evaluation`が存在すること
  - `score`が0〜100の数値であること
  - `grade`が`"A"|"B"|"C"|"D"`のいずれかであること
  - `status`が`"PASS"|"REVIEW"|"FAIL"`のいずれかであること
  - `reasons`/`warnings`/`improvements`が配列であること
- **（Task11で追加、いずれも警告）** AI出力の内容品質:
  - fact/action区分のフィールド（`why_now`/`why_company`/`market_change`/`first_action`/
    `evidence[].quote`）に根拠なし推測を示す表現（「〜と思われる」「〜かもしれません」等）が
    含まれていないか（`extended_analysis`等のanalysis区分は対象外、許容する）
  - `extended_analysis`の6項目・`decision_summary.recommendation`・
    `additional_opportunities[].summary`が空になっていないか
- **（Task12で追加）** `source_pages`各項目:
  - `label`（タイトル相当）が必須であること
  - `url`が必須であること
- 旧スキーマ（`opportunities_open`、`registration_bonus`、evidenceの`source_url`/`source_name`/
  `citation_excerpt`、priority_matrixの`items[]`）が残っていないこと

**設計メモ（Task11）**: AI出力の「JSON形式」「必須キー」チェックは、実は2段階で行っている。
1段階目は`llm-client.js`内部（AIの生レスポンスを受け取った直後、`report.json`へ組み込む前）で、
不正なJSON・`free_opportunity`/`locked_opportunities`/`paid_analysis`欠如を検出し**その場で
retryまたはエラー**にする。2段階目は本ファイル（`validate-report.js`）で、組み立て後の
`report.json`全体をスキーマ・整合性・内容品質の観点で検証する。役割が異なるため両方残している。

**Task9時点の既知の制約はTask10で解消済み**: `docs/mock_data/*.json`に`score`・`published_at`・
`evaluation`を追加し、現在は3ファイルとも本Validatorで`PASS`になることを確認済み
（詳細は[docs/mock_data/README.md](../../docs/mock_data/README.md)・
[docs/mock_data/CHANGELOG.md](../../docs/mock_data/CHANGELOG.md)参照）。

## 動作確認済みの実行例

```bash
# 実URL（安全な公開テストドメイン）に対する実フェッチ + フルパイプライン（mock provider）の確認
node scripts/generator/generate-company-report.js https://example.com

# 既存モックデータ（company-01）と同じドメインに対する、フェッチ失敗時のフォールバック確認
node scripts/generator/generate-company-report.js https://sakuraba-seimitsu.example.jp

# Validator単体での既存モックデータ検証（Task10でscore/published_at/evaluationを追加済みのためPASS）
node scripts/generator/validate-report.js docs/mock_data/01_manufacturing.json

# 品質評価エンジン単体でのfixtureテスト（good→PASS, average→REVIEW, bad→FAILを想定）
node scripts/generator/quality-evaluator.js scripts/generator/fixtures/good.json
node scripts/generator/quality-evaluator.js scripts/generator/fixtures/average.json
node scripts/generator/quality-evaluator.js scripts/generator/fixtures/bad.json

# provider別比較実験（Task11で追加。APIキー未設定のprovider以外はskippedとして記録）
node scripts/generator/experiments/run-experiments.js https://example.com

# 検索→context生成→AI分析→品質評価の一気通貫実験（Task12で追加）
node scripts/generator/experiments/run-search-experiments.js https://example.com

# 不明なprovider指定・APIキー未設定時のエラー処理確認
LLM_PROVIDER=unknown node scripts/generator/generate-company-report.js https://example.com   # 明確なエラーで終了（Task11）
LLM_PROVIDER=deepseek node scripts/generator/generate-company-report.js https://example.com  # APIキー未設定エラーで終了（Task11）
SEARCH_PROVIDER=tavily node scripts/generator/generate-company-report.js https://example.com # APIキー未設定→mockへ自動フォールバック（Task12）

# 人間レビューworkflow一連の流れ（Task13で追加）
node scripts/generator/review/review-cli.js comment scripts/generator/output/example.com/report.json --actor=ops-1 --text="確認中"
node scripts/generator/review/review-cli.js approve scripts/generator/output/example.com/report.json --reviewer=ops-1 --comment="承認します"
node scripts/generator/review/review-cli.js status  scripts/generator/output/example.com/report.json  # publishable: true を確認
node scripts/generator/review/review-cli.js history scripts/generator/output/example.com/report.json
```

`generate-company-report.js`が生成したreport.json、`docs/mock_data/*.json`、
`fixtures/*.json`はいずれも`validate-report.js`で`検証結果: PASS`（構造は正しい）。
`quality-evaluator.js`の`status`（内容の質）はfixtureごとに意図どおりPASS/REVIEW/FAILへ分かれる。
`review/fixtures/*.json`はいずれも`validateReview()`で`ok: true`。

## 共通ユーティリティ（scripts/generator/shared/、Task18で追加）

Task8〜16で個別に実装されていた以下の重複コードを`shared/`へ統合した（挙動・エラーメッセージは
維持し、既存CLIの出力は変えていない）。

| 統合前の重複箇所 | 統合先 |
|---|---|
| `JSON.parse(fs.readFileSync(...))` / `fs.writeFileSync(path, JSON.stringify(...))`（6ファイル以上） | `shared/json-file.js`（`readJson`/`readJsonSafe`/`writeJson`/`appendJsonLine`/`readJsonLines`） |
| retry + timeout（llm-client.js・search-client.jsにほぼ同一実装） | `shared/retry.js`（`withRetryAndTimeout`） |
| `OUTPUT_DIR`/`LOGS_DIR`/`PROMPTS_DIR`の`path.join(__dirname, ...)`再計算（ファイルごとに`__dirname`からの相対階層数が異なり、将来ファイル移動で静かに壊れるリスクがあった） | `shared/paths.js` |
| ISO8601正規表現（validate-report.js） | `shared/date-utils.js`（`ISO_8601_PATTERN`/`nowIso`/`isValidIso8601`） |
| `process.exit()`回避パターン（fetch()後にprocess.exit()を呼ぶとlibuvがクラッシュする既知の問題への対処、コメントごと複数ファイルに重複） | `shared/cli-utils.js`（`runCli`） |
| 各ファイル個別のconsole.warn/error（内部エラー・リトライ警告） | `shared/logger.js`（DEBUG/INFO/WARN/ERROR、`AOR_DEBUG=true`でDEBUG有効化） |

`website/aor-admin/{server.js, auth.js}`もこれらを利用するようリファクタリングした
（`scripts/generator/`への依存は元々あったため、一貫性のため）。

**方針転換しなかったこと**: `scripts/generator全体を確認し、util・core・providers・shared等への
整理が必要であれば実施`という要件に対し、既存ファイルの物理的な再配置（例:
`llm/`・`search/`・`review/`・`jobs/`を`core/`配下へ移す等）は**行わなかった**。
理由: `require()`パスが20箇所以上に及び、移動に伴う書き換え漏れのリスクが
「既存CLIとの互換性は維持してください」という要件に対して見合わないと判断したため。
代わりに、実際に重複していたロジックのみを`shared/`へ抽出する、影響範囲を限定した
アプローチを取った。

## テスト基盤（scripts/generator/test/、Task18で追加）

Node標準の`node:test`・`node:assert`のみを使用（npm依存なし）。Validator・Review・Jobs・
Quality・Search・LLM(Mock)・Generator・`shared/`・エラーハンドリング（Task23）・
セキュリティ（Task23）を計10ファイルでカバーする（99テスト、`node scripts/generator/
run-all-tests.js`実行時のtapサマリー参照。詳細は「エラーハンドリング統一（Task23）」
「セキュリティ関連テスト（Task23）」参照）。

```bash
# 個別のテストファイルを実行する場合
node --test scripts/generator/test/validator.test.js

# 全テストファイルをまとめて実行する場合
node --test "scripts/generator/test/*.test.js"

# 【推奨】Dashboard確認・quality-report.md生成まで含めて実行する場合
node scripts/generator/run-all-tests.js
```

`generator.test.js`のみ`https://example.com`への実HTTP取得を伴う（プロジェクトの安全なテスト
ドメイン規約に従う）。`jobs.test.js`は指数バックオフの実時間待ちを含むため、テストスイート
全体で数十秒かかる（詳細は`quality-report.md`の「注意事項」参照）。

### run-all-tests.js（要件5・6）

1. `node --test --test-reporter=tap`でtest/配下の全テストを実行し、TAPサマリーをパースする
2. `website/aor-admin/server.js`を一時的な別ポート（4601、通常運用の4600と衝突しない）で
   起動し、未認証401・認証済み200・`/api/reports`・`/api/jobs`の応答を確認してから停止する
   （Dashboard確認。UIの描画やSSE自体はNode標準モジュールだけでは検証できないため、
   API疎通確認にとどめている。実ブラウザでの確認は別途手動/Claude Browserで行う）
3. モジュール単位の対応テスト有無から、カバレッジの**構造的な近似値**を算出する
   （istanbul/nyc等のカバレッジ計測ツールはnpm依存のため使用していない）
4. `scripts/generator/quality-report.md`を生成する（テスト数・PASS・FAIL・実行時間・
   カバレッジ概算・注意事項を含む。ネットワーク依存テストが失敗した場合は、それが
   「ブロッキング」扱いか「非ブロッキング」扱いかを区別して記載する。詳細は次節参照）
5. **ブロッキングな**失敗が0件、かつテスト件数>0、かつDashboard確認OKの場合のみ
   終了コード`0`を返す（ネットワーク依存テストの失敗はブロッキングに含めない。理由は
   次節「CI/CD」参照）

## CI/CD（`.github/workflows/quality-check.yml`、Task19で追加）

push・pull_request（全ブランチ対象）およびworkflow_dispatchで、`ubuntu-latest`上で
`node scripts/generator/run-all-tests.js`を実行し、その終了コードでジョブの成否を判定する。
CIステータスバッジはリポジトリルートの[README.md](../../README.md)に掲載している
（実リポジトリ`KScopeResearch/changescout`の情報のみを使用）。

### npm installステップが無い理由

このリポジトリには`package.json`が存在しない。`scripts/generator/`配下はNode.js標準
モジュールのみで実装されており（Task8以降、一貫した設計方針）、npm依存パッケージを
一切使用していない。そのためCIワークフローにも`npm install`/`npm ci`のステップは
存在しない（存在しないpackage.jsonに対して実行するとエラーになるため、意図的に省略した）。

### CIのNode.jsバージョンについて

`actions/setup-node@v4`で`node-version: "24"`（メジャーバージョン24に固定、パッチ/マイナー
バージョンは自動追従）を指定している。理由:

- ローカル開発・全テスト（Task23時点で99件）のPASS確認は一貫してNode.js v24.18.0で行っており、CIとローカルの
  実行環境をメジャーバージョンで揃えることで、環境差に起因する不可解な失敗のリスクを
  最小化できる
- Node.jsは奇数メジャーバージョンが約6か月でEOLになるCurrent版、偶数メジャーバージョンが
  Active LTSに移行する慣例があり、v24は偶数メジャーバージョンにあたる
- パッチ/マイナーは自動追従にすることで、Node.js側のセキュリティ修正等を自動的に
  取り込みつつ、メジャーバージョンの破壊的変更にはさらされない

### generator.test.jsのネットワーク依存テストの扱い（「方式C」）

`generator.test.js`の1件目のテスト（`network-test-names.js`の`NETWORK_TEST_NAME`）は
`https://example.com`への実HTTP取得を行う、テストスイート内で唯一の実ネットワークI/Oを
伴うテストである。CI環境ではDNS解決やegressポリシーの違いにより、コード自体に問題が
無くても一時的に失敗しうる。

検討した3つの方式:

- **方式A（CIでskip）**: 実際のHTTPフェッチ経路（URL取得〜パース〜レポート生成の
  フルパイプライン）がCI上で一切検証されなくなり、実運用に近い確認ができなくなる
- **方式B（mock URLに切替）**: 何を検証しているかが変わってしまう上、モックサーバーの
  構築・保守コストが発生し、「実際のDNS/HTTP挙動を確認する」という本来の目的を損なう
- **方式C（現状維持・失敗時は警告扱い）**: 実運用に最も近い検証を毎回試みつつ、
  一時的な外部要因による失敗でCI全体をブロックしない。**この方式を採用した**

実装（`run-all-tests.js`）: `test/network-test-names.js`が定義する`NETWORK_TEST_NAME`を
`NETWORK_DEPENDENT_TEST_NAMES`という許可リストとして保持し、TAP出力から抽出した
失敗テスト名をこのリストでフィルタして`blockingFailedNames`（1件でもあれば全体FAIL）と
`networkFailedNames`（ログ・quality-report.mdには記録するが全体判定には影響しない）に
分離している。`network-test-names.js`を独立ファイルにしているのは、`generator.test.js`を
直接`require()`すると`node:test`の`test()`呼び出しがその場で実行登録されてしまう
（＝`run-all-tests.js`自身のプロセス内で実HTTPテストが余計に走ってしまう）副作用を
避けるためである。

### quality-report.mdのアーティファクト保存

`actions/upload-artifact@v4`で`scripts/generator/quality-report.md`を`if: always()`
付きでアップロードしている。`run-all-tests.js`がFAIL（終了コード1）した場合でも、
GitHub Actionsのジョブ実行結果画面からアーティファクトとしてダウンロード・確認できる。

## Task19以降との関係

- **【Task24で解消済み】承認済みレポートをwebsite/aorへ公開する導線**（Task23の運用前
  リハーサルで発見した★★★★★課題。詳細は
  [docs/pre-launch-rehearsal.md](../../docs/pre-launch-rehearsal.md)参照）:
  `publish-report.js`を新設し、Review Dashboardから明示的に「公開する」操作を
  行うことで解消した（詳細は下記「レポートの公開（Task24で追加）」参照）
- ~~**実search/LLM providerの検証（Task23時点でも未実施）**~~ → **Task30〜32で解消済み**。
  `tavily`（実検索）・`deepseek`（実LLM）は実際のAPIキーで動作確認済み（E2E含む、詳細は
  [docs/real-provider-verification.md](../../docs/real-provider-verification.md)参照）。
  `bing`・`openai`・`qwen`は引き続き未検証のまま。これらを使う前は、実際のAPIキーを用意し
  `experiments/run-search-experiments.js`・`experiments/run-experiments.js`で
  動作・品質・コストを比較検証することが引き続き望ましい
- **`review.json`と`report.json.human_review`の同期**: Task14で「同期しない」と最終決定した
  （[review/review-schema.md](review/review-schema.md)参照）。将来スキーマを刷新する場合は、
  `human_review`を`report.json`から削除し`review.json`に一本化する方向で検討する
- **複数レビュー担当者アカウント**: `website/aor-admin/`は現状、単一の
  `ADMIN_USER`/`ADMIN_PASSWORD`のみ（未対応のまま。
  [website/aor-admin/README.md](../../website/aor-admin/README.md)「制約・未実装事項」参照）。
  ~~ログイン試行のレート制限なし~~ → **Task41で解消済み**（IPアドレス単位、5分間に5回失敗で
  10分間ブロック。詳細は[website/aor-admin/README.md「ログイン試行レート制限」](../../website/aor-admin/README.md)参照）
- **Job Runnerの強制中断・並列実行**: `scripts/generator/jobs/`のcancelは協調的
  （実行中の処理を即座に打ち切れない）、実行は常に直列。本番運用でスループットが
  問題になる場合は検討が必要（[jobs/README.md](jobs/README.md)「未実装事項」参照）
- **カバレッジの構造的近似値からの脱却**: Task18のカバレッジ概算はモジュール単位の
  対応テスト有無に基づく粗い近似であり、行/分岐カバレッジではない。npm解禁時に
  istanbul/nyc等を導入すれば、より正確な計測が可能になる
- **website/aor-adminのフロントエンドJSは自動テスト対象外**: `list.js`/`detail.js`/`jobs.js`は
  ブラウザDOM APIに依存するため`node:test`では検証していない（Claude Browser等の
  実ブラウザ確認に依存し続ける）

これらは本READMEの時点では未着手。
