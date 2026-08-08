# website/aor-lead-api/ — メール回収API（PJ2 第1実装）

## これは何か

`website/aor`（受信者向け静的LP）のメール登録フォームから将来送信される想定のリード情報
（`email` / `company_slug` / `captured_at` / `consent`）を、最小限だけ保存する独立した
HTTPサーバー。Node.js標準の`http`モジュールのみで実装している（npm依存なし）。

**`website/aor-admin`（Review Dashboard）とは完全に別アプリケーション**である
（[website/aor/README.md](../aor/README.md)の設計方針を踏襲した三つ目の独立コンポーネント）。
認証・セッション・CSRFの仕組みは一切共有しない。匿名の公開エンドポイントとして動作する。

設計の背景・検討過程は[docs/email-capture-design.md](../../docs/email-capture-design.md)
（Task27の設計レビュー、⑫が今回の実装状況）を参照。

## 今回のスコープ

**含む**: `POST /api/leads`によるリード情報の保存のみ。

**含まない**（意図的な見送り。理由は`docs/email-capture-design.md`⑫参照）:
メール送信・営業フォロー、Adminでのリード一覧閲覧UI、外部SaaS連携、本番インフラ・
GitHub Pages等へのデプロイ設定、honeypot等の高度なスパム対策、`website/aor`側の
実フロントエンド配線（`email-capture.js`は変更していない。ネットワーク送信は追加していない）。

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
- `company_slug`: 必須。`shared/path-safety.js`の`validateSlug()`で検証する
  （既存のReview Dashboard等と同じslug検証ロジックを再利用しており、独自実装はしていない）
- `consent`: 必須。厳密なboolean `true`のみ許可（文字列`"true"`等は拒否）
- `captured_at`はクライアントが指定しても無視され、サーバー側で生成した値を使う
- 上記4項目以外のフィールドは一切保存しない（許可リスト方式）

成功時は`201 { "ok": true }`、検証エラーは`400`、レート制限時は`429`を返す。

## 保存先とログ

| ファイル | 内容 | 備考 |
|---|---|---|
| `scripts/generator/logs/leads.jsonl` | 保存されたリード本体（`email`を含む） | 自動アーカイブ・保持期間ポリシーは未実装（`docs/email-capture-design.md`⑫参照、個人情報の保持方針は今回決定していない） |
| `scripts/generator/logs/leads-audit.jsonl` | 取得イベント（`timestamp`/`action`/`company_slug`/`success`のみ） | `admin-audit.jsonl`とは別ファイル。**`email`は一切含めない**（構造的に、この関数へemailを渡すコード自体が存在しない）。`admin-audit.jsonl`と同じくサイズ超過時はアーカイブする（Task43の`archiveIfOversize()`を再利用） |

いずれも既存の`shared/paths.js`の`LOGS_DIR`配下に置いているため、`scripts/generator/backup.js`の
既存の`TARGETS`（`label:"logs"`, `required:true`）がそのままバックアップ対象として適用される
（`backup.js`自体の変更は不要だった）。

## レート制限

`website/aor-admin/auth.js`のログイン試行レート制限（Task41）とは独立した専用実装
（`rate-limit.js`）。IPアドレス単位で、10分間に5回リクエストするとそのIPを30分間ブロックする
（成功・失敗を問わず全リクエストを数える。プロセス内メモリで管理するため、再起動でリセットされる）。

## CORS / Origin

本APIは匿名・Cookie非使用のエンドポイントのため、Originヘッダーをそのまま反映して
`Access-Control-Allow-Origin`を返す。ただし**これはあくまで補助的な措置であり、主たる
防御はレート制限・入力検証・consent必須化**である（Originヘッダーはリクエスト元が
任意に詐称できるため）。

## テスト

`scripts/generator/test/lead-api.test.js`（`run-all-tests.js`から自動実行される）。
バリデーション・レート制限の単体テストに加え、サーバーを一時ポートで起動してのHTTP統合テスト、
および「登録したメールアドレスが`leads.jsonl`以外（`leads-audit.jsonl`・サーバーの
標準出力/標準エラー出力）に一切出現しない」ことを確認するテストを含む。
