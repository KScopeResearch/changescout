# website/aor-lead-api/ — メール回収API（PJ2 第1実装: 保存基盤／第2実装: 公開フォーム接続／P0-2: 正式なLeadライフサイクルへ接続）

## これは何か

`website/aor`（受信者向け静的LP）の`email-capture.html`登録フォームから送信されるリード情報
（`email` / `company_slug` / `captured_at` / `consent`）を、最小限だけ保存する独立した
HTTPサーバー。Node.js標準の`http`モジュールのみで実装している（npm依存なし）。

**`website/aor-admin`（Review Dashboard）とは完全に別アプリケーション**である
（[website/aor/README.md](../aor/README.md)の設計方針を踏襲した三つ目の独立コンポーネント）。
認証・セッション・CSRFの仕組みは一切共有しない。匿名の公開エンドポイントとして動作する。

設計の背景・検討過程は[docs/email-capture-design.md](../../docs/email-capture-design.md)
（Task27の設計レビュー、⑫⑬が実装状況）を参照。

## 今回のスコープ（PJ2 第2実装）

**含む**: `website/aor/assets/js/email-capture.js`から実際に`POST /api/leads`へ接続。
送信するのは`email`/`company_slug`/`consent`のみ（`captured_at`はサーバー生成のため送らない）。
成功・入力エラー・APIエラー（429/5xx）・通信エラーのUI表示、二重送信防止、ハニーポット、
CORS許可リストを実装。

**含まない**（意図的な見送り。理由は`docs/email-capture-design.md`⑫⑬参照）:
メール送信・営業フォロー、Adminでのリード一覧閲覧UI、外部SaaS連携、本番インフラ・
GitHub Pages等へのデプロイ設定、保存データの保持期間・削除ポリシー。

## 使い方

```bash
node website/aor-lead-api/server.js
# → http://localhost:4700 （LEAD_API_PORT環境変数でポート変更可）
```

必須環境変数は無い（匿名の公開エンドポイントのため、`ADMIN_USER`/`ADMIN_PASSWORD`のような
起動時必須設定は存在しない）。

### API

`POST /api/leads`

```json
{ "email": "user@example.com", "company_slug": "example.com", "consent": true }
```

- `email`: 必須。簡易な形式検証（`@`とドメインのドットの存在、254文字以内）を行う
- `company_slug`: 必須。`shared/path-safety.js`の`validateSlug()`で形式検証したうえで、
  `company-context-store.js`の`loadCompanyContext(company_slug)`で対応する
  `company_context.json`（`input_url`）を解決する。存在しない`company_slug`は`400`
  （合成URLは作らない）
- `consent`: 必須。厳密なboolean `true`のみ許可（文字列`"true"`等は拒否）。受信条件としては
  維持するが、Lead本体には保存しない（`lead-store.js`のLead schemaに対応フィールドが無く、
  P0-2ではschemaを拡張しないという設計判断のため）
- `captured_at`はクライアントが指定しても無視される（サーバー側で保存する`collected_at`は
  `lead-store.js`が生成する）
- 上記以外のフィールドは一切保存しない

Lead本体の保存は`scripts/generator/leads/lead-store.js`の`createLead()`に委譲する
（`source`は固定値`"AOR公開フォーム"`、`collection_method`は既存の全Lead生成経路と同じ
`"public_website"`）。重複判定（同一`email`×同一`company_slug`は同一Lead、再投入は
history へ`resubmitted`を記録するのみ）も`createLead()`の既存ロジックがそのまま行う。

成功時（新規作成・resubmittedのいずれも）は`201 { "ok": true }`のみを返す
（`lead_id`・`report_token`・`email`は一切含めない）。検証エラーは`400`、レート制限時は
`429`を返す。

### Phase4-A/B API（PJ2 Phase4-A/B、今回追加）

`report_generated`以降のLead（`scripts/generator/leads/lead-store.js`で管理）に対する、
report-preview.html経由のメールリンクからの操作を受け付ける。

`POST /api/leads/:lead_id/paid-report-request`（Phase4-A: 詳しい有料レポートが欲しい）
`POST /api/leads/:lead_id/weekly-report-consent`（Phase4-B: 毎週無料レポートに同意する）

```json
{ "report_token": "..." }
```

- `lead_id`不明（存在しない・不正な形式） → `404`
- `report_token`不一致（未指定・空文字を含む） → `403`
- 成功 → `201 { "ok": true }`
- 成功時、Phase4-Aは`paid_report_requested`/`paid_report_requested_at`を、Phase4-Bは
  `weekly_report_consent`/`weekly_report_consent_at`を更新し、history（`lead-store.js`）へ
  対応イベントを追加する。両属性はLeadの`status`/`delivery_status`とは独立しており、
  このAPIはstatus/delivery_statusを一切変更しない
- 対象属性が既に`true`の場合は、再送（ボタンの多重クリック等）とみなし、
  書き込み・historyへの追記を行わずそのまま`201`を返す（べき等）
- `report_token`はレスポンス・エラー応答・ログ・historyのいずれにも含めない

## 保存先とログ

| ファイル/ディレクトリ | 内容 | 備考 |
|---|---|---|
| `scripts/generator/logs/leads/<lead_id>.json` | Lead本体（`email`を含む、`lead-store.js`管理） | P0-2以降の正式な保存先。import-leads.js・create-lead-from-email.js等、他のLead作成経路と同じライフサイクル管理下。自動アーカイブ・保持期間ポリシーは未実装（`docs/email-capture-design.md`⑫参照、個人情報の保持方針は今回決定していない） |
| `scripts/generator/logs/leads.jsonl` | （P0-2で廃止・過去データのみ残置） | POST /api/leadsからの新規追記は停止した。旧データの保持期間・削除方針は未決のため現状のまま残置している |
| `scripts/generator/logs/leads-audit.jsonl` | 取得イベント（`timestamp`/`action`/`company_slug`/`success`のみ） | `admin-audit.jsonl`とは別ファイル。**`email`は一切含めない**（構造的に、この関数へemailを渡すコード自体が存在しない）。`admin-audit.jsonl`と同じくサイズ超過時はアーカイブする（Task43の`archiveIfOversize()`を再利用） |

いずれも既存の`shared/paths.js`の`LOGS_DIR`配下に置いているため、`scripts/generator/backup.js`の
既存の`TARGETS`（`label:"logs"`, `required:true`）がそのままバックアップ対象として適用される
（`backup.js`自体の変更は不要だった）。

## レート制限

`website/aor-admin/auth.js`のログイン試行レート制限（Task41）とは独立した専用実装
（`rate-limit.js`）。IPアドレス単位で、10分間に5回リクエストするとそのIPを30分間ブロックする
（成功・失敗を問わず全リクエストを数える。プロセス内メモリで管理するため、再起動でリセットされる）。

## ハニーポット（PJ2 第2実装）

`website/aor/email-capture.html`に、人間には見えないダミー入力欄（`#hp-website`、
JSONフィールド名`hp_website`）を追加している（`position:absolute; left:-9999px`による
オフスクリーン配置。`display:none`/`visibility:hidden`は一部のbotが検知して回避するため
使わない。`tabindex="-1"`・`aria-hidden="true"`によりキーボード操作・スクリーンリーダー
利用者には一切影響しない）。

サーバー側（`HONEYPOT_FIELD = "hp_website"`）でこの欄に値が入っているリクエストを検知すると、
**保存せず、本物の成功と区別できない`201 { "ok": true }`を返す**（botに検知されたことを
悟らせないため）。`leads-audit.jsonl`には`action: "lead_honeypot_triggered"`として記録する
（`company_slug`は記録しない）。

## CORS / Origin

CORSは**許可リスト方式**。環境変数`LEAD_API_ALLOWED_ORIGINS`（カンマ区切り）で
許可するOriginを設定する。

```bash
LEAD_API_ALLOWED_ORIGINS="https://aor.example.jp,https://www.aor.example.jp" node website/aor-lead-api/server.js
```

未設定時は、[website/aor/README.md](../aor/README.md)のローカル動作確認手順
（`python -m http.server 8123 --directory website/aor`）に合わせた既定値
（`http://localhost:8123`）のみを許可する。**本番のAOR公開URLは本実装時点で未確定のため、
決め打ちのデフォルト値にはしていない**。本番配信時は必ず`LEAD_API_ALLOWED_ORIGINS`を
実際の配信先URLに設定すること。

許可リストに無いOriginからのリクエストには`Access-Control-Allow-Origin`ヘッダーを付与しない
（ブラウザ側でレスポンス読み取りがブロックされる）。**ただしCORS/Originチェックは認証機構
として扱わない**（Originヘッダーはブラウザ以外からは自由に詐称できるため、非ブラウザ経由の
リクエスト自体は許可リストに関わらず処理を継続する）。主たる防御はレート制限・入力検証・
consent必須化・ハニーポットである。

## website/aor側の設定（LEAD_API_BASE_URL）

`website/aor/assets/js/common.js`の`LEAD_API_BASE_URL`定数が、フロントエンドから見た
本APIのベースURL。`OPERATOR_EMAIL`と同じ「配置ごとにこの定数を書き換える」方式
（`website/aor`はビルドステップを持たない静的サイトのため）。既定値は
`http://localhost:4700`（ローカル動作確認用）。本番配信時は配信環境に合わせて書き換えること。

## テスト

`scripts/generator/test/lead-api.test.js`（`run-all-tests.js`から自動実行される）。
バリデーション・レート制限・CORS許可リスト・ハニーポット・Lead重複（email×company_slug）の
単体/統合テストに加え、「登録したメールアドレスがLead本体（`leads/<lead_id>.json`）以外
（`leads-audit.jsonl`・サーバーの標準出力/標準エラー出力）に一切出現しない」こと、および
`leads.jsonl`へ新規追記されないことを確認するテストを含む。

**実ブラウザでのE2E確認について**: このリポジトリにはPlaywright等のnpm依存が無いため
（本プロジェクト全体の「npm依存なし」方針、[README.md](../../README.md)参照）、実際の
ブラウザ操作を伴うE2Eの自動テストは追加していない。代わりに、実装時にClaude in Chromeを
使って`email-capture.html`から実際にフォーム送信を行い、成功・入力エラー・429・通信エラー・
ハニーポット・PII非漏洩を手動で確認済み（結果は完了報告に記録）。CIで自動的に繰り返し
確認されるのは、上記のHTTPレベルの統合テストの範囲になる。
