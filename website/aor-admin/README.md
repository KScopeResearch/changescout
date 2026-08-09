# website/aor-admin/ — Review Dashboard（Task14、Task15で認証・監査ログ、Task16でJobs画面を追加）

## これは何か

`scripts/generator/output/` 配下のAI生成レポート（`report.json`）を、人間が一覧・詳細確認し、
承認・却下・差し戻し・コメント・修正指示を行うための社内向け管理画面。**受信者向け画面
（`website/aor/`）とは完全に別のアプリケーション**であり、`website/aor/`のHTML/CSS/JSは
一切変更していない。

- レビュー状態遷移のロジックは一切ここに実装しない。すべて
  [scripts/generator/review/review-engine.js](../../scripts/generator/review/review-engine.js)の
  Pure Functionをサーバー経由で呼び出す（重複実装なし）
- `publishable`の判定も同様に`review-engine.js`の`isPublishable()`のみを使う（UI側で
  独自の合否判定ロジックは書いていない）
- 新規npmパッケージは使用していない（Node.js標準の`http`・`crypto`モジュールのみ）
- **（Task15）認証必須**: HTML/CSS/JS/API/SSEのすべてのルートが認証済みセッションを要求する
- **（Task18）** `server.js`・`auth.js`は`scripts/generator/shared/`の共通ユーティリティ
  （logger・json-file・date-utils）を使うようリファクタリングした。`node scripts/generator/run-all-tests.js`は
  本サーバーを一時ポート（4601）で起動し、未認証401・認証済み200等のAPI疎通も自動確認する
  （詳細は[scripts/generator/README.md](../../scripts/generator/README.md)「テスト基盤（Task18）」参照）

## 使い方

```bash
ADMIN_USER=admin ADMIN_PASSWORD=your-password node website/aor-admin/server.js
# → Review Dashboard: http://localhost:4600
```

`ADMIN_USER`・`ADMIN_PASSWORD`が未設定の場合、**サーバーは起動しない**（「認証・セッション」
の節を参照）。`ADMIN_PORT`環境変数でポートを変更できる（既定4600）。

ブラウザで`http://localhost:4600/`を開くと、ブラウザ標準のBasic認証ダイアログが表示される。
`ADMIN_USER`/`ADMIN_PASSWORD`を入力すると、以降はセッションCookieで認証状態が保持される
（毎回のBasic認証は不要）。

`scripts/generator/output/<slug>/` にレポート（`report.json`・任意で`review.json`）が
存在する会社が一覧に表示される。`review.json`がまだ存在しない会社は、
`pending_review`の初期状態として表示される（ファイルはAPI操作時に初めて作成される）。

## ディレクトリ構成

```
website/aor-admin/
├── server.js              … Node標準httpのみのバックエンド（静的配信 + API + SSE + Jobs API）
├── auth.js                 … 認証・セッション・CSRF・監査ログ（Task15で追加）
├── README.md               … 本ファイル
└── public/
    ├── index.html           … 一覧画面
    ├── detail.html          … 詳細画面（?company=<slug>）
    ├── jobs.html             … Jobs画面（Task16で追加）
    └── assets/
        ├── css/admin.css
        └── js/
            ├── api.js        … APIへの薄いfetchラッパー（UIとAPIの分離点、CSRFトークン付与）
            ├── list.js       … 一覧画面のロジック・SSE購読
            ├── detail.js     … 詳細画面のロジック・操作フォーム
            ├── jobs.js       … Jobs画面のロジック・SSE購読（Task16で追加）
            └── status.js     … Server/Job Runner状態表示バーのロジック（Task21で追加）
```

## UI構成

- **一覧画面（`/index.html`）**: 会社名・`review.status`・`evaluation.status`・
  `score`/`grade`・`publishable`（○/△/×）・`reviewer`・`review日時`を一覧表示。
  行クリックで詳細画面へ遷移。SSE（後述）で自動更新される。
  **（Task23）** `evaluation.status === "FAIL"`の行は背景色で強調表示する
  （`.row-eval-fail`、一覧が多いと見落としやすいため）。
  **（Task24）** 「公開」列（●=website/aor/data/へ公開済み、—=未公開）を追加した
- **詳細画面（`/detail.html?company=<slug>`）**: `free_opportunity`（title/why_now/
  why_company/market_change/first_action/evidence）・`evaluation`（reasons/warnings/
  improvements）・`review.json`（comments/fixes/history）を横断表示し、承認・却下・
  差し戻し・コメント追加・修正指示追加のフォームを提供する。
  **（Task23）** `reviewer`/`reviewed_at`に加え「最終更新」（`review.json`の
  `reviewed_at`・`history[].at`・`comments[].at`・`fixes[].at`のうち最新のもの。
  承認/却下/差し戻し以外の操作＝コメント・修正指示の追加も反映される）、
  および`comments`/`fixes`/`history`それぞれの件数（`fixes`は未解決件数も）を表示する。
  **（Task24）** 「website/aorへの公開」欄と「公開する」/「再公開する」ボタンを追加した。
  `publishable`でない間はボタンを無効化し、未承認レポートを誤って公開できないようにしている
  （サーバー側の`publishReport()`自体もisPublishable()===falseなら拒否するため二重の防御）。
  **（Task38）** 公開済みの場合のみ「公開を取り消す」ボタンも表示する。こちらは
  `publishable`の状態に関わらず常に押せる（既に公開してしまったものを取り下げたい、
  という運用ニーズのため）
- **Jobs画面（`/jobs.html`、Task16で追加）**: ジョブの追加フォームと、Queue/Running/
  Completed/Failed/Cancelledの各列、直近の実行ログ（`job-history.jsonl`）を表示する。
  `failed`のジョブには`retry`ボタン、`queued`/`running`のジョブには`cancel`ボタンを表示する。
  **（Task23）** 各ジョブの行に実行時間（`startedAt`〜`finishedAt`、実行中は現在時刻までの
  経過時間）を追加した。ロジックはすべて
  [scripts/generator/jobs/job-runner.js](../../scripts/generator/jobs/job-runner.js)
  に委譲している（詳細は[jobs/README.md](../../scripts/generator/jobs/README.md)参照）
- **状態表示バー（`/index.html`・`/jobs.html`共通、Task21で追加）**: ヘッダー直下に
  「Server: OK/Degraded」「Job Runner: OK/Degraded」「最終確認: HH:MM:SS」を表示する。
  `public/assets/js/status.js`が`GET /api/health`を15秒間隔でポーリングして更新する
  （詳細は「Health Check API」参照）

### publishableの○/△/×表示について

`isPublishable()`が返すのは真偽値（`true`/`false`）のみ。一覧画面ではこれを3アイコンに
分類して表示している: `publishable === true` → ○、`false`かつ`review.status ===
"needs_revision"` → △（対応中）、それ以外の`false`（`pending_review`/`rejected`、および
**Task36で追加**した「`review.status === "approved"`だが承認後にreport.jsonが再生成された
ため`publishable === false`」のケース）→ ×。
**これは表示上の分類であり、判定値そのものの再計算・独自ロジックの追加ではない**
（`isPublishable()`の戻り値をそのまま使っている。`public/assets/js/list.js`参照。
`list.js`自体はTask36で変更していない。既存の「`publishable`が`false`なら×」という
分岐がこの新しいケースも自然にカバーするため）。

## API構成

UIとAPIを分離している（`public/assets/js/api.js`がAPIへの唯一の窓口）ため、将来UIを
React等へ置き換える場合もAPIはそのまま流用できる想定。**すべて認証必須**（次節参照）。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/session` | ログイン中のusernameとCSRFトークンを返す（Task15で追加、フロントエンドが起動時に取得） |
| GET | `/api/reports` | 全社サマリー一覧（一覧画面用） |
| GET | `/api/report/:id` | 1社分のreport.json・review.json・publishable・published・validationを返す（詳細画面用） |
| GET | `/api/status/:id` | review.jsonとpublishableのみを返す（軽量版） |
| GET | `/api/events` | SSE。接続時と、`scripts/generator/output/`配下の変更検知時に一覧サマリーをpushする |
| POST | `/api/comment/:id` | body: `{text}`。`review-engine.js`の`addComment()`を呼ぶ（`actor`はセッションから） |
| POST | `/api/fix/:id` | body: `{description}`。`addFix()`を呼ぶ（`actor`はセッションから） |
| POST | `/api/approve/:id` | body: `{comment?}`。`approve()`を呼ぶ（`reviewer`はセッションから） |
| POST | `/api/reject/:id` | body: `{comment?}`。`reject()`を呼ぶ（`reviewer`はセッションから） |
| POST | `/api/revise/:id` | body: `{comment?, fixes?: string[]}`。`requestRevision()`を呼ぶ（`reviewer`はセッションから） |
| POST | `/api/publish/:id` | 承認済み（`publishable===true`）のレポートをwebsite/aor/data/へ公開する（Task24で追加）。未承認の場合は400 |
| POST | `/api/unpublish/:id` | website/aor/data/`<id>.json`を削除し公開を取り消す（Task38で追加）。既に非公開の場合もエラーにせず`{ok:true, already_unpublished:true}`を返す（冪等）。不正なslugの場合のみ400 |
| GET | `/api/jobs` | 全ジョブのステータス別スナップショット（Task16で追加） |
| GET | `/api/jobs/history?limit=N` | 直近N件のジョブ実行履歴（Task16で追加） |
| GET | `/api/jobs/events` | SSE。ジョブ状態の変化をpushする（Task16で追加、`/api/events`とは別チャンネル） |
| GET | `/api/jobs/:id` | 1件のジョブ詳細（Task16で追加） |
| POST | `/api/jobs/enqueue` | body: `{type, params, maxAttempts?}`。ジョブをキューへ追加し即座に実行を開始する（Task16で追加） |
| POST | `/api/jobs/:id/retry` | `failed`のジョブを`queued`へ戻す（Task16で追加） |
| POST | `/api/jobs/:id/cancel` | ジョブをキャンセルする（Task16で追加） |
| GET | `/logout` | セッションを破棄しCookieを削除、`/`へ302リダイレクト |
| GET | `/api/health` | ヘルスチェック（Task21で追加）。**認証不要**（後述） |

`:id`は`scripts/generator/output/`配下のディレクトリ名（例: `example.com`）。すべての
POSTエンドポイントは、操作後の`review`・`publishable`・`publishable_reasons`をJSONで返し、
かつ`scripts/generator/output/<slug>/review.json`へ保存する（`review-cli.js`が生成する
ファイルと完全に同じ形式・同じ保存先）。

**（Task15）`reviewer`/`actor`はリクエストボディからは一切受け取らない。** UIからも入力欄を
廃止した上で、サーバー側（`server.js`の`handleReviewAction()`）でも認証済みセッションの
`username`のみを使う。たとえAPIを直接叩いてbodyに別人の名前を仕込んでも、無視されて
ログイン中のusernameが使われる（なりすまし防止）。

## Health Check API（Task21で追加、Task23で`checks`を拡張）

```
GET /api/health
```

外部の監視ツール（ロードバランサのヘルスチェック、uptime監視等）から、Basic認証なしで
サーバーの稼働状況を確認できるようにするためのエンドポイント。**このルートだけは
`auth.authenticate()`を経由しない**（`/logout`と同様、`server.js`の`http.createServer()`内で
認証チェックより前に処理する）。secret値・APIキー・内部ファイルパス等の機微情報は
一切含めない。

応答例（200 OK、全項目OKの場合）:

```json
{
  "status": "ok",
  "uptime": 12345,
  "version": "aor-admin/phase1-task21",
  "checks": { "auth": true, "jobs": true, "output_dir": true, "logs_dir": true, "config": true }
}
```

**status/degraded判定ルール**: `checks`の値が**全て`true`**の場合のみ`status:"ok"`
（HTTP 200）。**いずれか1つでも`false`**なら`status:"degraded"`（HTTP 503）。

| checks項目 | 内容 | falseになる条件 |
|---|---|---|
| `auth` | `ADMIN_USER`/`ADMIN_PASSWORD`が設定されているか（`auth.checkRequiredEnv().ok`） | 未設定（通常はこの場合サーバー自体が起動しないため、実際には常にtrueのはず） |
| `jobs` | `job-store.js`の`snapshot()`が例外なく呼べるか | ジョブストアの内部異常（通常発生しない） |
| `output_dir` | `scripts/generator/output/`への読み取りアクセスがあるか（Task23で追加） | ディレクトリが削除された・権限が無い等 |
| `logs_dir` | `scripts/generator/logs/`への読み取りアクセスがあるか（Task23で追加） | 同上 |
| `config` | LLM_PROVIDER/SEARCH_PROVIDERが非mockでAPIキー未設定でないか（Task23で追加、`config-validator.js`の`checkLlmConfig()`/`checkSearchConfig()`が`level:"error"`を返さないか） | 実providerを指定したがAPIキーが無い |

- `uptime`: プロセス起動からの秒数（`process.uptime()`）
- `version`: `server.js`内で手動管理する固定文字列定数（`package.json`が存在しない設計の
  ため、npmの`version`フィールドは使えない。gitコマンド経由でコミットハッシュを読む方式は
  git非搭載の実行環境で失敗しうるため採用しなかった）

`config`はLLM_PROVIDER側の不備（error）のみを見る。SEARCH_PROVIDER側の不備は
`search-client.js`が自動的にmockへフォールバックする既存設計のため`warn`扱いであり、
`config`をfalseにはしない（詳細は
[scripts/generator/README.md](../../scripts/generator/README.md)「設定チェック」参照）。
設定の詳細（どのproviderのどのキーが不足しているか）はこのAPIには含めない
（secret値を返さない方針を徹底するため、真偽値のみに留めている）。詳細を見たい場合は
`node scripts/generator/check-config.js`を使う。

## 起動時の設定チェック（Task21で追加）

`server.js`起動時、`console.log`で2種類のチェック結果を表示する:

1. **`ADMIN_USER`/`ADMIN_PASSWORD`（必須、ブロッキング）**: 既存どおり、未設定なら
   サーバーを起動しない（後述「なぜ未設定だと起動を拒否するのか」参照）
2. **`LLM_PROVIDER`/`SEARCH_PROVIDER`（参考情報、非ブロッキング）**: 起動ログに
   設定状況を表示するが、**起動そのものはブロックしない**。理由: Review Dashboardは
   Job RunnerでAI分析ジョブを実行しない限りLLM/検索providerを呼ばない。既存レポートの
   閲覧・承認/却下だけを行う運用では、LLM/検索の設定は不要であり、それを理由に
   Dashboardの起動自体を拒否するのは過剰と判断した。実際にジョブを実行する際は、
   `scripts/generator/llm/llm-client.js`・`scripts/generator/search/search-client.js`
   自身が持つ既存の実行時チェック（前者はエラーで停止、後者はmockへ自動フォールバック。
   詳細は[scripts/generator/README.md](../../scripts/generator/README.md)参照）がそのまま働く

いずれのチェックも、判定ロジック本体は
[scripts/generator/shared/config-validator.js](../../scripts/generator/shared/config-validator.js)
に共通化してあり、`auth.js`・`server.js`・`scripts/generator/generate-company-report.js`・
`scripts/generator/check-config.js`から重複なく再利用している。

## Job Runnerの起動時復旧（Task23で追加）

ジョブキューはメモリのみで永続化しない設計のため、`server.js`が予期せず終了・再起動すると、
実行中だったジョブの情報は失われる。`server.js`は起動のたびに
`jobRunner.recoverInterruptedJobs()`を呼び、前回終了時に実行中だったジョブがあれば
`scripts/generator/logs/job-history.jsonl`へ`status: "interrupted"`の記録を残す
（Jobs画面の「最新ログ」に表示される）。ジョブオブジェクトの構造・キューの状態遷移は
変更していない。詳細な仕組みは
[scripts/generator/README.md](../../scripts/generator/README.md)「起動時復旧」を参照。

## SSEによる自動更新（WebSocketなし）

`fs.watch(OUTPUT_DIR, { recursive: true })`で`scripts/generator/output/`配下の変更を検知し、
接続中の全SSEクライアントへ最新の一覧サマリーをpushする。これにより、**Dashboardの外**
（`scripts/generator/review/review-cli.js`をターミナルから直接実行した場合など）で
`review.json`が更新されても、開いているブラウザの一覧画面が自動的に更新される
（動作確認済み。「④動作確認結果」参照）。

## 認証方法（Task15）

**Basic認証 → セッションCookie**の2段階。

1. `ADMIN_USER`・`ADMIN_PASSWORD`環境変数と一致する`Authorization: Basic`ヘッダーを
   検証する（ブラウザの標準認証ダイアログが自動的にこのヘッダーを送る。カスタムログイン
   画面は作っていない）
2. 認証に成功すると、サーバーがランダムなセッショントークン（`crypto.randomBytes(32)`）を
   発行し、`Set-Cookie: sid=...; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`
   （8時間）で返す。以降のリクエストはこのCookieのみで認証される（Basic認証の
   ダイアログは初回ログイン時にのみ表示される）
3. Cookieがない、または期限切れ・不正な場合は、`401 Unauthorized` +
   `WWW-Authenticate: Basic realm="..."` を返し、ブラウザに再度ダイアログを出させる

HTML/CSS/JS/API/SSE、すべてのルートがこの認証を通る（`server.js`の`http.createServer()`内で
`/logout`を除く全リクエストに対して`auth.authenticate()`を呼ぶ）。

パスワード比較は`crypto.timingSafeEqual()`（SHA-256ハッシュ同士を比較し、タイミング攻撃・
長さ漏洩を避ける）で行う。

## ログイン試行レート制限（Task41）

総当たり攻撃対策として、IPアドレス単位のログイン試行レート制限を実装している
（`website/aor-admin/auth.js`）。`ADMIN_USER`/`ADMIN_PASSWORD`が単一組み合わせのため、
ユーザー名単位ではなくIPアドレス単位で制限する（詳細な設計比較・採用理由はTask40の
検討記録参照。ログファイル活用方式・外部ミドルウェア方式は、既存のnpm非依存・DB不要
方針との適合性を優先し不採用とした）。

- **方式**: プロセス内メモリの`Map`で管理（`sessions`と同じパターン、DB不要）
- **閾値**: 5分間の時間窓内に5回ログインに失敗すると、そのIPを10分間ブロックする
  （`RATE_LIMIT_WINDOW_MS`・`RATE_LIMIT_MAX_ATTEMPTS`・`RATE_LIMIT_BLOCK_MS`、
  `auth.js`で定義。「管理画面用途で通常利用を妨げず、総当たり試行を現実的に遅延させる
  バランス」という目安値）
- **ブロック中の挙動**: 正しい`ADMIN_USER`/`ADMIN_PASSWORD`を送っても`401`を返す
  （監査ログに`login_rate_limited`として記録）
- **カウンタのリセット**: ログインに成功すると、そのIPの失敗回数はただちにクリアされる
  （正しい認証情報を入力すればすぐに通常状態へ戻る）
- **既存の有効なセッションによる認証はこの制限の対象外**（セッションCookieでの
  通常操作は妨げられない。制限の対象はBasic認証ヘッダーによる新規ログイン試行のみ）
- **プロセス再起動でリセットされる**: `sessions`と同じくメモリ内管理のため、
  サーバー再起動でブロック状態も含め全てリセットされる（攻撃者のブロックも解除されて
  しまう一方、誤ってブロックされた正当な利用者も再起動で復旧できる）

## セッション方式（Task15）

- メモリ内の`Map`で保持する（DB不要という要件どおり。プロセス再起動で全セッションが失われる）
- 有効期限8時間（`SESSION_TTL_MS`、`website/aor-admin/auth.js`で定義）
- Cookie属性: `HttpOnly`（JavaScriptから読み取り不可、XSS経由の窃取を防ぐ）・`Path=/`・
  `SameSite=Strict`（他サイトからのクロスサイトリクエストにCookieを付与しない）。
  `Secure`属性は付与していない（本ツールは`http://localhost`前提のPhase1 MVPのため。
  HTTPSでの本番運用時は`Secure`を追加すること。「未実装事項」参照）

### ログアウト

`GET /logout`でセッションをサーバー側のMapから削除し、Cookieを`Max-Age=0`で上書きして
無効化する。ログアウト後は同じCookie値を使い回してもサーバー側に該当セッションが
存在しないため401になる（動作確認済み）。

## CSRF対策（Task15、最低限）

Synchronizer Token方式。セッション発行時に`crypto.randomBytes(32)`でCSRFトークンも生成し、
セッションに紐づけて保持する。フロントエンドは`GET /api/session`でこのトークンを取得し、
以降のPOSTリクエストで`X-CSRF-Token`ヘッダーに付与する（`public/assets/js/api.js`）。
サーバーは全POSTリクエストでこのヘッダーとセッションのトークンを比較し、
一致しなければ`403 Forbidden`＋監査ログ`csrf_failed`を記録する。GETリクエストは
状態を変更しないためCSRF検証の対象外（要件どおり「POST時のみ検証」）。

## セキュリティヘッダ（Task15、最低限）

`auth.js`の`applySecurityHeaders()`を全レスポンス（静的ファイル・API・エラー応答含む）に
適用する。

| ヘッダー | 値 | 目的 |
|---|---|---|
| `X-Frame-Options` | `DENY` | 他サイトからのiframe埋め込み（クリックジャッキング）を防ぐ |
| `X-Content-Type-Options` | `nosniff` | ブラウザによるMIMEタイプの推測を無効化する |
| `Referrer-Policy` | `no-referrer` | 他サイトへ遷移する際にURL（会社名等を含みうる）を送らない |
| `Cache-Control` | `no-store` | 認証済みの内部情報をブラウザ・中間キャッシュに保存させない |

## Audit Log（監査ログ、Task15）

`scripts/generator/logs/admin-audit.jsonl`（既存の`llm-usage.jsonl`・`search-usage.jsonl`と
同じディレクトリ。Task11/12から続くランタイムログの置き場所という位置づけ）に、
1行1イベントのJSON Linesで追記する。`scripts/generator/output/`とは別ファイル・別ディレクトリ。

記録するイベントと`action`の値:

| action | 記録タイミング |
|---|---|
| `login_success` / `login_failed` | Basic認証の成功・失敗 |
| `login_rate_limited` | ログイン試行レート制限によりブロック中のIPからのアクセス試行（Task41で追加） |
| `unauthenticated` | セッションCookieもBasic認証もない状態でのアクセス試行 |
| `logout` | `/logout`実行時 |
| `csrf_failed` | POSTのCSRFトークン検証失敗 |
| `comment` / `fix` / `approve` / `reject` / `revise` | 対応するレビュー操作の成功・失敗いずれも |
| `publish` | `POST /api/publish/:id`の成功・失敗いずれも（Task24で追加。公開者・日時・対象slugが記録される） |
| `unpublish` | `POST /api/unpublish/:id`の成功・失敗いずれも（Task38で追加。既に非公開だった場合は`detail: "already_unpublished"`を記録する） |

各レコードの形: `{at, user, ip, action, target, success, detail}`（`at`はISO8601、
`target`は対象companyのslugまたはパス、`ip`は`req.socket.remoteAddress`）。

**スコープ上の判断**: `GET /api/reports`等の一覧・詳細の**閲覧**は監査ログに記録していない
（SSEの自動更新も含め高頻度に発生するため、ログが読み取りアクセスで埋もれてしまうことを
避けた）。記録対象は「認証イベント」と「状態を変更する操作」に絞っている。

`admin-audit.jsonl`を含む`scripts/generator/logs/`配下の全ログファイル（用途・PII/secret
非保存の方針・バックアップ推奨）については
[scripts/generator/README.md](../../scripts/generator/README.md)「運用ログ一覧」を参照。

## 環境変数一覧（Task15で追加）

| 変数 | 必須 | 説明 |
|---|---|---|
| `ADMIN_USER` | **必須** | Basic認証のユーザー名。未設定だと起動を拒否する |
| `ADMIN_PASSWORD` | **必須** | Basic認証のパスワード。未設定だと起動を拒否する |
| `ADMIN_PORT` | 任意（既定4600） | サーバーのポート番号 |
| `JOB_SCHEDULER_ENABLED` | 任意（既定`false`、Task16で追加） | `true`にすると、起動時にJob Schedulerを開始する |
| `JOB_SCHEDULER_INTERVAL_MS` | 任意（既定86400000＝24時間、Task16で追加） | スケジューラの実行間隔（ミリ秒） |

### なぜ未設定だと起動を拒否するのか

Review Dashboardは人間レビューの承認・却下という重要な操作を扱う。認証情報が
未設定のまま誤って起動してしまうと、認証なしで誰でも承認・却下できてしまう
（Task14まではこの状態だった）。この事故を構造的に防ぐため、`ADMIN_USER`・
`ADMIN_PASSWORD`のいずれかが欠けている場合はサーバーを起動せず、
理由を明示したエラーメッセージを出して終了する（`website/aor-admin/auth.js`の
`checkRequiredEnv()`、`server.js`が起動前に呼ぶ）。

## review.json と report.json.human_review の同期方針（Task14で決定）

**同期しない。** 理由・詳細は
[scripts/generator/review/review-schema.md](../../scripts/generator/review/review-schema.md)
「同期方針の最終決定（Task14）」を参照。要点: `review.json`のstatus（4値、`rejected`を含む）と
`report.json.human_review.status`（3値）がenumとして非互換であり、同期すると
スキーマ変更かデータ欠落のいずれかが必要になるため。この結果、詳細画面では
`evaluation.improvements`（生成時点のhuman_review.statusを参照）と`review.json`（現在の
レビュー状態）が食い違って見えることがある。詳細画面にはこれを説明する注記を表示している。

## 制約・未実装事項

- **単一の管理者アカウントのみ**（`ADMIN_USER`/`ADMIN_PASSWORD`は1組のみ）。
  複数レビュー担当者を個別のアカウントで区別する仕組みは未実装（全員が同じ
  `ADMIN_USER`名でログインすることになり、監査ログ上の`user`もその名前になる）
- **`Secure`Cookie属性なし**: `http://localhost`前提のため`Secure`を付けていない。
  HTTPS環境で本番運用する場合は追加が必要
- ~~**レート制限なし**~~ → **Task41で解消済み**。IPアドレス単位のログイン試行レート制限
  （5分間に5回失敗で10分間ブロック）を実装した。詳細は「ログイン試行レート制限（Task41）」参照
- `fixes[]`を「解決済み」にする専用の操作は未実装（`review-engine.js`側の制約、
  Task13からの申し送り事項）
- **（Task16で解消）** レポートの新規生成は、Jobs画面（`/jobs.html`）から
  `generate-report`ジョブを追加することで可能になった
- **Job Runnerの制約**: 実行中ジョブの強制中断は協調的（即座には打ち切れない）、
  実行は常に直列（並列実行は未対応）。詳細は
  [scripts/generator/jobs/README.md](../../scripts/generator/jobs/README.md)「未実装事項」を参照
