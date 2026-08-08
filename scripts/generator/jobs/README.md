# scripts/generator/jobs/ — Job Runner / Scheduler（Task16）

## これは何か

AI Opportunity Reportの生成パイプラインを「ジョブ」として非同期・リトライ可能に実行し、
一定間隔での自動実行（スケジューラ）にも対応させるための実行基盤。目的は
「AI Opportunity Reportを毎日自動生成できる状態にする」こと。

- メモリ内キュー（DB不要）
- 指数バックオフでの自動リトライ（1秒→2秒→4秒、最大3回）
- `setInterval()`のみで実装したスケジューラ（cronライブラリ不使用）
- `scripts/generator/logs/job-history.jsonl`への実行履歴記録
- `website/aor-admin/`のJobs画面からの操作・SSEによるリアルタイム表示

## ディレクトリ構成

```
scripts/generator/jobs/
├── job-store.js    … ジョブのインメモリレジストリ（CRUD、状態別スナップショット）
├── job-engine.js    … 4種類のjob typeハンドラ（既存モジュールへの薄いアダプタ）
├── job-runner.js     … キュー処理・リトライ・スケジューラ・履歴記録のオーケストレーション
├── job-cli.js         … CLI（website/aor-admin/server.jsのJobs APIを呼ぶHTTPクライアント）
└── README.md          … 本ファイル
```

## アーキテクチャ上の判断（重要）

要件「メモリキューで十分です」に従い、ジョブの状態はプロセスのメモリ内にのみ保持し、
ディスクへの永続化は行わない（`job-history.jsonl`は**実行結果のログ**であり、
キューの状態そのものの永続化ではない）。

一方で、以下3つの要件を同時に満たす必要がある。

1. `job-cli.js`で`enqueue`した後、別のコマンド呼び出しで`status`・`history`を確認できること
2. `website/aor-admin/`のJobs画面がリアルタイムに状態を表示できること（SSE）
3. スケジューラが継続的に動き続けること（`setInterval()`はプロセスが生きている間だけ動く）

これらはいずれも「**同じジョブ状態を、複数のコマンド・複数の画面から参照できる、
常駐プロセス**」を前提とする。そこで、ジョブランタイム（`job-store.js`・`job-engine.js`・
`job-runner.js`）は**website/aor-admin/server.js（Task14/15で既に常駐プロセスとして
存在する）の内部でシングルトンとして動かす**設計にした。

この結果、`job-cli.js`は`scripts/generator/review/review-cli.js`（ファイルシステム＝
`review.json`を介して状態を共有する）とは異なり、**HTTPクライアントとして
`website/aor-admin/server.js`のJobs API（`/api/jobs/*`）を呼び出す**設計になっている。
`job-cli.js`を使うには、事前に`website/aor-admin/server.js`を起動しておく必要がある
（`ADMIN_HOST`・`ADMIN_PORT`・`ADMIN_USER`・`ADMIN_PASSWORD`環境変数で接続先・認証情報を指定。
既定は`localhost:4600`）。

`job-store.js`・`job-engine.js`・`job-runner.js`自体はHTTPを一切知らない、素のNode.js
モジュールとして実装しているため、`website/aor-admin/server.js`を経由せず直接
`require()`して使うことも可能（下記「単体での動作確認」参照）。

## Job種類（最低対応4種類）

| type | 必須params | 内部で呼ぶ既存モジュール | 何をするか |
|---|---|---|---|
| `generate-report` | `{url}` | `generate-company-report.js`の`generateCompanyReport()` | フルパイプライン（fetch→…→AI分析→品質評価→検証）を実行し、report.json等を保存する |
| `quality-check` | `{slug}` | `quality-evaluator.js` | 既存report.jsonを読み直し、品質スコアのみ再計算してreport.evaluation・evaluation.mdを更新する |
| `review-sync` | `{slug}` | （ダミー） | 【ダミー実装】Task14で「review.json↔report.json.human_reviewは同期しない」と最終決定しているため、実処理は行わない。将来方針変更時の拡張ポイント |
| `search-refresh` | `{url}` | `company-context.js`の`buildCompanyContext()` | 情報収集（fetch→merge→normalize→deduplicate→score）のみをやり直し、company_context.jsonを更新する（AI分析はやり直さない） |

いずれも**既存モジュールをそのまま呼ぶだけ**で、ロジックの再実装はしていない
（`job-engine.js`のJSDoc参照）。`generate-company-report.js`は本Taskで、CLIとしての
動作（`node generate-company-report.js <url>`）を変えずに`generateCompanyReport()`を
`module.exports`する形へリファクタリングした（`require.main === module`ガードを追加）。

## Queue構造・状態遷移

```
queued ──run──→ running ──成功──→ completed
                    │
                    ├──失敗（リトライ余地あり）──→ running（自動リトライ）
                    │
                    └──失敗（リトライ上限）────→ failed ──手動retry──→ queued
                    
queued ──cancel──→ cancelled
running ──cancel（協調的）──→ （次のリトライの合間でcancelled）
```

ジョブ1件のデータ構造（`job-store.js`）:

```js
{
  id, type, params,
  status: "queued"|"running"|"completed"|"failed"|"cancelled",
  attempts, maxAttempts,
  cancelRequested: boolean,
  createdAt, startedAt, finishedAt,
  result, error,
  events: [{at, status, detail}],  // このジョブ固有の状態遷移ログ
}
```

**実行方式は直列（1件ずつ）**。同じ出力ディレクトリへの同時書き込み競合を避けるため、
Phase1では並列実行をせず、キューに積まれた順（FIFO）に1件ずつ処理する。

## Retry仕様（要件⑤）

失敗時は指数バックオフで自動リトライする: **1秒→2秒→4秒、最大3回**（＝初回の試行と
合わせて最大4回試行する。`job-runner.js`の`RETRY_DELAYS_MS = [1000, 2000, 4000]`、
`DEFAULT_MAX_ATTEMPTS = 4`）。全て失敗すると`status: "failed"`になる。

`failed`状態のジョブは`job-cli.js retry <id>`（またはDashboardの`retry`ボタン）で
`queued`へ戻し、再度リトライシーケンス（1試行目から）を実行できる（手動retry）。

### キャンセルの仕様

- `queued`中のジョブ: 即座に`cancelled`にする
- `running`中のジョブ: `cancelRequested`フラグを立てるだけで、**実行中の処理を強制中断はしない**
  （協調的キャンセル）。次のリトライ試行に入る直前でこのフラグを確認し、立っていれば
  それ以上リトライせず`cancelled`にする。1回の試行の途中（例: `generateCompanyReport()`が
  実行中）で即座に打ち切ることはできない（Phase1の既知の制約。「未実装事項」参照）

## Scheduler仕様（要件④）

`setInterval()`のみで実装（cronライブラリ不使用）。`job-runner.js`の`startScheduler(intervalMs)`
が、指定間隔ごとに`scripts/generator/output/`配下の**既存の全会社**（各社の
`company_context.json`に保存された`input_url`）に対して`generate-report`ジョブを自動投入する。
新しい会社登録リストの仕組みは作らず、既存データを再利用する設計。

`website/aor-admin/server.js`起動時、環境変数`JOB_SCHEDULER_ENABLED=true`が設定されている
場合のみスケジューラを開始する（既定は無効）。間隔は`JOB_SCHEDULER_INTERVAL_MS`（既定: 24時間
＝`86400000`）。

```bash
JOB_SCHEDULER_ENABLED=true JOB_SCHEDULER_INTERVAL_MS=3600000 \
ADMIN_USER=admin ADMIN_PASSWORD=xxxx node website/aor-admin/server.js
# → 1時間ごとに、既存の全会社のgenerate-reportジョブを自動投入する
```

**なぜ既定で無効なのか**: Review Dashboardを単に起動しただけで、意図せず全社のレポートが
自動的に再生成され始める（＝AI分析のトークン消費や情報収集の負荷が発生する）ことを避けるため。

## History仕様（要件⑥）

`scripts/generator/logs/job-history.jsonl`（既存の`llm-usage.jsonl`・`search-usage.jsonl`・
`admin-audit.jsonl`と同じ`logs/`ディレクトリ）に、ジョブの実行（1回の試行シーケンス全体、
＝completed/failed/cancelledの確定時点）ごとに1行追記する。

```js
{ job_id, type, params, status, started_at, finished_at, duration_ms, attempts, error, created_at }
```

`started_at`/`finished_at`は開始・終了、`duration_ms`は実行時間、`status`が成功/失敗、
`error`がエラー内容、`attempts`がリトライ回数（要件どおり）。

## CLI（要件⑧）

```bash
# 事前にwebsite/aor-admin/server.jsを起動しておくこと
ADMIN_USER=admin ADMIN_PASSWORD=xxxx node website/aor-admin/server.js &

export ADMIN_USER=admin ADMIN_PASSWORD=xxxx

node scripts/generator/jobs/job-cli.js enqueue generate-report --url=https://company.jp
node scripts/generator/jobs/job-cli.js enqueue quality-check --slug=company.jp
node scripts/generator/jobs/job-cli.js enqueue review-sync --slug=company.jp
node scripts/generator/jobs/job-cli.js enqueue search-refresh --url=https://company.jp

node scripts/generator/jobs/job-cli.js run              # キュー状況の確認（enqueue時に自動実行されるため通常は不要）
node scripts/generator/jobs/job-cli.js retry <job-id>
node scripts/generator/jobs/job-cli.js cancel <job-id>
node scripts/generator/jobs/job-cli.js status [<job-id>] # job-id省略時はキュー全体のサマリー
node scripts/generator/jobs/job-cli.js history [--limit=20]
```

`enqueue`は追加と同時にサーバー側で自動的にキュー処理が始まる（`job-runner.js`の
`enqueue()`が`processQueue()`をfire-and-forgetで呼ぶ）。`run`コマンドは、明示的な
「今すぐ処理させる」操作というよりは、現在のキュー状況を確認するための補助コマンドとして
実装している（詳細は「アーキテクチャ上の判断」参照）。

## 単体での動作確認（サーバーなしで直接テストする場合）

`job-store.js`・`job-engine.js`・`job-runner.js`はHTTPを知らないプレーンなNode.js
モジュールなので、`website/aor-admin/server.js`を経由せず直接requireしてテストできる。

```js
const runner = require("./scripts/generator/jobs/job-runner");
const job = runner.enqueue("quality-check", { slug: "example.com" });
// ... しばらく待つ ...
console.log(job.status); // "completed" 等
```

## Dashboard（website/aor-admin/、要件⑦）

`website/aor-admin/public/jobs.html`にJobs画面を追加した。Queue/Running/Completed/Failed/
Cancelledの各列と、最新の実行ログ（`job-history.jsonl`の直近N件）を表示する。
`/api/jobs/events`（SSE）で自動更新される。詳細は
[website/aor-admin/README.md](../../website/aor-admin/README.md)を参照。

## 未実装事項

- **実行中ジョブの強制中断は未実装**: `cancel`は協調的（次のリトライ試行の合間でのみ
  反映される）。1回の試行の途中で即座に打ち切ることはできない
- **並列実行は未対応**: 常に1件ずつ直列処理する（Phase1のシンプルさ優先の判断）
- **スケジューラの対象会社リストは`output/`内の既存データに限定**: 新規会社を
  スケジュール登録する専用の仕組みはない
- **`job-cli.js`はサーバー起動が前提**: `website/aor-admin/server.js`を起動していないと
  CLIは使えない（「アーキテクチャ上の判断」参照）
