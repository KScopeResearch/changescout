# website/aor/ — 受信者向けLP（Task29でREADMEを新設）

## これは何か

AORが生成したレポートを、レポート送付先（受信者）が閲覧するための静的サイト。
`report-preview.html`（無料版）・`email-capture.html`（登録画面）・`paid-preview.html`（有料版）の
3画面と、それらが読み込む公開データ（`data/<slug>.json`）で構成される。

**サーバーサイドのコードは一切無い**（HTML/CSS/JS + 静的JSONのみ）。セッション・Cookie・
DBも使用しない。3画面は`?company=<slug>`というURLクエリのみで状態を共有する
（`assets/js/common.js`の`getCompanyParam()`参照）。

## 本番運用チェックリストとの関係

本ドキュメントは配信方法（どうやってサーバーに乗せるか）のみを扱う。生成から公開までの
運用手順は[docs/operations-checklist.md「一連の運用フロー」](../../docs/operations-checklist.md)、
公開データ（`data/`配下）の管理方針は
[scripts/generator/README.md「website/aor/data/の管理方針」](../../scripts/generator/README.md)を参照。

## 配信方法

静的ファイルのみで構成されるため、HTTPで配信できる手段であれば何でもよい（Node.js製の
専用サーバーは無い・作らない設計）。**`file://`で直接開くとブラウザのセキュリティ制限で
`fetch('data/<slug>.json')`がブロックされ、正しく表示されない**ため、必ず何らかのHTTPサーバー
経由でアクセスすること。

### ローカル動作確認

このリポジトリでは開発時、Node標準機能のみという制約の対象外（`website/aor/`自体は
Node.js実装物ではないため）として、Python標準の`http.server`を使っている
（`.claude/launch.json`の`aor-report-preview`設定、port 8123）。

```bash
python -m http.server 8123 --directory website/aor
# → http://localhost:8123/report-preview.html?company=<slug> で確認
```

Node.jsの`npx serve`等、他の静的サーバーでも同様に動作する（動作要件は「単純な静的ファイル配信」
のみで、特別な設定は不要）。

### 本番環境

以下のいずれの方式でも動作する（本プロジェクトは特定の方式を強制しない。npm依存を増やさない
という制約は`scripts/generator/`側のみに適用され、配信インフラの選定はその対象外）。

- 汎用Webサーバー（nginx/Apache等）の静的ファイル配信機能でこのディレクトリを公開する
- 静的ホスティングサービス（S3+CloudFront、Netlify、Cloudflare Pages等）へこのディレクトリを
  そのままアップロードする
- 既存の`website/aor-admin/server.js`と同じNode.jsプロセスから配信する場合は、別途
  静的配信ルートを追加する実装が必要（**現状は未実装**。`website/aor-admin/`と
  `website/aor/`は完全に別アプリケーションとして分離されている設計のため、
  この統合自体が新機能追加に相当する。必要になった場合は別タスクで検討する）

いずれの方式でも、`data/<slug>.json`への読み取りアクセス（`GET`のみ、認証不要）が
必要になる点は共通（`report-preview.html`等が`fetch('data/<slug>.json')`で直接読み込むため）。
`data/`配下の書き込みは`scripts/generator/publish-report.js`（サーバー上で直接実行するか、
`website/aor-admin/server.js`経由）が担うため、配信サーバー自体に書き込み権限は不要。

## 既知の制約

- 3画面共通のエラー表示（`fetch`失敗時）は、原因（404・ネットワークエラー・`file://`制限等）に
  関わらず同一の固定文言を表示する（意図的な設計。詳細は
  [docs/pre-launch-rehearsal.md](../../docs/pre-launch-rehearsal.md)「★★★★」参照。
  `website/aor`のUI・仕様は変更しない方針のため、この挙動も変更しない）
- HTTPS化・ドメイン設定・CDN設定等は配信方式ごとに異なるため、本ドキュメントでは扱わない
  （利用する配信サービスの手順に従うこと）
