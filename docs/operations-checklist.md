# 本番運用チェックリスト（Task21、Task22でバックアップ節、Task23で障害対応フローを追加、Task29でE2Eランブック節を追加）

AORパイプライン（`scripts/generator/`）とReview Dashboard（`website/aor-admin/`）を
本番相当の環境で起動・運用する前に確認する項目。Phase1 MVPの範囲（DB不要・npm依存なし・
セルフホスト前提）を維持したまま、最低限の運用安全性を確保することが目的。

## 本番環境の前提条件まとめ（Task29で追加）

初回起動時に何を準備すればよいかを1箇所にまとめる（詳細は各リンク先を参照）。

| 項目 | 内容 |
|---|---|
| Node.jsバージョン | メジャーバージョン24（CI・ローカル開発とも`v24.18.0`で動作確認済み）。理由は[scripts/generator/README.md「CIのNode.jsバージョンについて」](../scripts/generator/README.md)参照 |
| 必須環境変数 | `ADMIN_USER`・`ADMIN_PASSWORD`（未設定だと`website/aor-admin/server.js`が起動しない） |
| 任意環境変数 | `ADMIN_PORT`（既定4600）、`LLM_PROVIDER`/`SEARCH_PROVIDER`とAPIキー（mock運用なら不要）、`JOB_SCHEDULER_ENABLED`等。一覧は[website/aor-admin/README.md「環境変数一覧」](../website/aor-admin/README.md)参照 |
| Lead保存先（PJ2） | 既定は`filesystem`（`scripts/generator/logs/leads/`）。`LEAD_STORE_BACKEND=s3`を指定するとS3へ切替可能（`LEAD_STORE_S3_BUCKET`必須、`LEAD_STORE_S3_PREFIX`・`AWS_REGION`）。値・S3バケットの運用設定・責務分担は[scripts/generator/README.md「Leadライフサイクル管理とS3バックエンド」](../scripts/generator/README.md#leadライフサイクル管理とs3バックエンドscriptsgeneratorleadspj2で追加)参照。実値のテンプレートは[.env.example](../.env.example)参照（実際のキー値はリポジトリに保存しない） |
| 必要ディレクトリ | `scripts/generator/output/`・`scripts/generator/logs/`。いずれも初回書き込み時に`fs.mkdirSync(..., {recursive:true})`で自動作成されるため、事前に手動作成する必要は無い |
| ファイル権限 | Node.jsプロセスの実行ユーザーに、上記2ディレクトリと`website/aor/data/`への読み書き権限が必要（OS依存のため個別手順はここでは扱わない） |
| `website/aor`（受信者向けLP）の配信方法 | サーバーサイドコード無しの静的サイト。配信方法の詳細は[website/aor/README.md](../website/aor/README.md)（Task29で新設）参照 |
| `website/aor-admin`（Review Dashboard）の起動方法 | `node website/aor-admin/server.js`。詳細は[website/aor-admin/README.md「使い方」](../website/aor-admin/README.md)参照 |
| バックアップ方法 | `node scripts/generator/backup.js`。詳細は本ファイル「バックアップ・リストア」節参照 |
| ログ保存場所 | `scripts/generator/logs/`配下（`admin-audit.jsonl`・`job-history.jsonl`・`llm-usage.jsonl`・`search-usage.jsonl`・`job-runtime-state.json`）。**Task43でローテーション/整理を実装済み**（`admin-audit.jsonl`・`llm-usage.jsonl`・`search-usage.jsonl`は10MB超過時にアーカイブ（削除はしない）、`job-history.jsonl`は90日より古い行を整理。詳細は本ファイル「未実装・既知の制約」参照） |

## 一連の運用フロー（E2Eランブック、Task29で追加）

「起動してからレポートを1件、顧客に見える状態まで持っていく」までの一連の操作は、
これまで機能ごとに複数のREADMEへ分散して記載されていた（生成は`scripts/generator/README.md`、
レビュー操作は`website/aor-admin/README.md`、障害対応は本ファイル、という具合）。
初めて運用する第三者が迷わないよう、通し番号付きで手順とリンク先だけをここにまとめる
（各ステップの詳細はリンク先を参照。ここでは重複説明しない）。

1. **サーバー起動**: `ADMIN_USER`/`ADMIN_PASSWORD`等の環境変数を設定した上で
   `node website/aor-admin/server.js`を実行する。詳細は
   [website/aor-admin/README.md「使い方」](../website/aor-admin/README.md#使い方)
   「環境変数一覧」参照
2. **設定確認**: `node scripts/generator/check-config.js`で`[ERROR]`が0件であることを確認、
   起動後は`GET /api/health`が`{"status":"ok"}`を返すことを確認する（本ファイル
   「デプロイ前チェックリスト」参照）
3. **レポート生成**: `node scripts/generator/generate-company-report.js <会社URL>`、または
   Jobs Dashboard（`http://<host>:<port>/jobs.html`）から`generate-report`ジョブを投入する。
   詳細は[scripts/generator/README.md「使い方」](../scripts/generator/README.md#使い方)参照
4. **Review Dashboardで確認**: `http://<host>:<port>/`の一覧から対象社を開き、内容・
   品質評価（`evaluation`）を確認する。詳細は
   [website/aor-admin/README.md「UI構成」](../website/aor-admin/README.md#ui構成)参照
5. **コメント・修正指示**: 詳細画面からコメント追加・修正指示（fix）を行う。CLIで行う場合は
   `node scripts/generator/review/review-cli.js comment|fix <report.jsonのパス> ...`
6. **差し戻し**: 内容に問題がある場合は「差し戻し」操作（`requestRevision`）を行う
   （`review.status`が`needs_revision`になる）
7. **再レビュー**: 必要に応じてレポートを再生成（手順3）するか、内容を確認した上で
   再度手順4〜6を繰り返す。**注意**: レポートを再生成しても`review.json`の承認状態は
   自動的にリセットされない（Task29で確認、後述「既知の注意点」参照）。再生成後は
   必ず差し戻し・再承認の手順を踏むこと
8. **承認**: 内容に問題が無ければ「承認する」操作（`approve`）を行う。承認条件・
   `isPublishable()`の判定基準は
   [scripts/generator/README.md「人間レビューworkflow」](../scripts/generator/README.md#人間レビューworkflowscriptsgeneratorreviewtask13で追加)参照
9. **公開**: 詳細画面の「公開する」ボタン、または
   `node scripts/generator/publish-report.js <slug>`を実行する。詳細は
   [scripts/generator/README.md「レポートの公開」](../scripts/generator/README.md#レポートの公開publish-reportjstask24で追加)参照
10. **website/aorで顧客向け表示確認**: `website/aor/report-preview.html?company=<slug>`
    （簡易サーバー経由、`file://`直接開きは不可）で、公開したデータが正しく表示されることを
    確認する。**公開を取り消したい場合**（誤公開・内容の緊急差し替え等）は、詳細画面の
    「公開を取り消す」ボタン、または`node scripts/generator/unpublish-report.js <slug>`を
    実行する（Task38で追加）。取り消し後、`website/aor/data/<slug>.json`が削除され、
    上記の表示確認が404相当（データ無し）になることを確認する。詳細は
    [scripts/generator/README.md「公開の取り消し」](../scripts/generator/README.md#公開の取り消しunpublish-reportjstask38で追加)参照
11. **問題発生時**: 本ファイル「障害発生時の一般的な対応フロー」「障害時のリストア手順」を参照

### 既知の注意点（Task29で実機確認）

- ~~**再生成は承認状態を自動的に無効化しない**~~ → **Task36で解消済み**。`isPublishable()`が
  `report.meta.generated_at`と`review.reviewed_at`を比較し、承認より後にレポートが再生成
  された場合は`publishable: false`になるよう変更した。運用ルール（「再生成したら必ず
  差し戻してから再レビューする」）は引き続き推奨するが、徹底が漏れてもシステム側で
  水際検知されるようになった（詳細は[scripts/generator/review/review-schema.md](../scripts/generator/review/review-schema.md)
  「publishable判定」参照）
- **差し戻しは公開済みデータを自動的に取り下げない**: 一度公開したレポートを差し戻し
  （`needs_revision`）にしても、`website/aor/data/<slug>.json`は公開されたままになる
  （承認・差し戻し操作自体が自動でunpublishする設計にはなっていない。意図的な設計、
  「レビュー判断」と「公開データの取り下げ」を別操作とする方針は維持）。既に公開済みの
  内容を取り下げたい場合は、**Task38で追加した`node scripts/generator/unpublish-report.js
  <slug>`（またはReview Dashboardの「公開を取り消す」ボタン）を使う**（手動でのファイル
  削除は今後は不要。詳細は[scripts/generator/README.md「公開の取り消し」](../scripts/generator/README.md)参照）

## デプロイ前チェックリスト

- [ ] `ADMIN_USER`・`ADMIN_PASSWORD`を設定済み（未設定だと`website/aor-admin/server.js`は
      起動しない。詳細は[website/aor-admin/README.md](../website/aor-admin/README.md)
      「なぜ未設定だと起動を拒否するのか」参照）
- [ ] 実LLM/実検索を使う場合、`LLM_PROVIDER`/`SEARCH_PROVIDER`と対応するAPIキーを設定済み
      （mockのみで運用する場合は不要。`node scripts/generator/check-config.js`で
      "Configuration check passed" になることを確認する）
- [ ] `node scripts/generator/check-config.js`を実行し、`[ERROR]`行が0件であることを確認した
      （`[WARN]`行のみなら起動可能。SEARCH_PROVIDERのAPIキー未設定時はmockへ自動
      フォールバックするため、意図した動作であれば無視してよい）
- [ ] `GET /api/health`が`{"status":"ok", ...}`（HTTP 200）を返すことを確認した
      （サーバー起動後、`curl http://<host>:<port>/api/health`等で確認）
- [ ] CI（`.github/workflows/quality-check.yml`）がPASSしていることを確認した
      （リポジトリの[README.md](../README.md)のバッジ、またはGitHub Actionsの実行結果を参照）
- [ ] `scripts/generator/output/`・`scripts/generator/logs/`のバックアップ方針を確認した
      （両ディレクトリともDB不要でファイルベースのため、バックアップ対象はファイル
      コピーで足りる。詳細は[scripts/generator/README.md](../scripts/generator/README.md)
      「運用ログ一覧」参照）
- [ ] `node scripts/generator/backup.js`が正常終了することを確認した（`backup/<タイムスタンプ>/`
      配下に`output`/`logs`が作成されていればOK。詳細は
      [scripts/generator/README.md](../scripts/generator/README.md)
      「バックアップ・リストア」参照）
- [ ] Lead保存先にS3（`LEAD_STORE_BACKEND=s3`）を使う場合、`LEAD_STORE_S3_BUCKET`・
      `AWS_REGION`が設定済みであることを確認した（AWS Access Key/Secretは`.env.example`にも
      リポジトリ内のいかなるファイルにも書かず、実行環境側から供給する）。バケット側の
      Block Public Access・Object Ownership・SSE-S3・Versioningの設定は
      [scripts/generator/README.md](../scripts/generator/README.md)
      「Leadライフサイクル管理とS3バックエンド」参照

## 運用中の確認

- [ ] `GET /api/health`を定期的に監視する（外部監視ツールから、Basic認証なしでアクセス可能）
- [ ] `scripts/generator/logs/admin-audit.jsonl`で不審なログイン失敗（`login_failed`）が
      多発していないか、定期的に確認する
- [ ] `website/aor-admin/public/index.html`・`jobs.html`のステータスバー
      （Server Status / Job Runner Status）が"Degraded"になっていないか確認する
- [ ] `node scripts/generator/backup.js`を定期的に（例: 日次）実行し、`backup/`配下に
      新しいタイムスタンプディレクトリが増えていることを確認する

## 障害発生時の一般的な対応フロー（Task23で追加）

データの復元（バックアップからのリストア）が必要になる前に、まず以下の順で切り分ける。

1. **`GET /api/health`を確認する**（認証不要）。`status:"degraded"`の場合、`checks`の
   どの項目が`false`かで原因を絞り込む:
   - `auth: false` → `ADMIN_USER`/`ADMIN_PASSWORD`が未設定（通常はサーバー自体が
     起動しないため稀）
   - `jobs: false` → ジョブストアの内部異常
   - `output_dir`/`logs_dir: false` → 該当ディレクトリが削除された・権限がない
   - `config: false` → `LLM_PROVIDER`が非mockでAPIキー未設定
     （`node scripts/generator/check-config.js`で詳細確認）
2. **ログを確認する**（`scripts/generator/logs/`）:
   - 認証・アクセス関連の異常 → `admin-audit.jsonl`
   - ジョブの失敗理由 → `job-history.jsonl`（`status:"interrupted"`のエントリがあれば、
     前回プロセスが実行中のまま異常終了したことを示す。起動時に自動記録される。
     詳細は[scripts/generator/README.md](../scripts/generator/README.md)「起動時復旧」参照）
   - サーバープロセス自体のエラー → 標準エラー出力（`AOR_DEBUG=true`で詳細なstack traceも
     表示される）
3. **Review Dashboard/Jobs Dashboardが応答しない場合**: プロセスを再起動する。
   ジョブキューはメモリのみのため実行中ジョブの情報は失われるが、`review.json`・
   `report.json`はディスク上のファイルのため再起動の影響を受けない。再起動時に
   `job-history.jsonl`へ`interrupted`記録が自動的に残る
4. **データが壊れた/消えた場合のみ、バックアップからリストアする**（次節）

詳細（エラーハンドリングの方針、Server APIが返す内容等）は
[scripts/generator/README.md](../scripts/generator/README.md)「エラーハンドリング統一」
「障害時対応フロー」を参照。

## 障害時のリストア手順（Task22で追加）

1. （推奨）`website/aor-admin/server.js`を停止する
2. 復元したいバックアップを選び、`backup/<タイムスタンプ>/<label>/`の中身を元の場所へ
   コピーする（詳細手順は[scripts/generator/README.md](../scripts/generator/README.md)
   「バックアップ・リストア」参照）
3. 復元後、以下を確認する:
   ```bash
   node scripts/generator/check-config.js
   node scripts/generator/run-all-tests.js
   ```
4. `website/aor-admin/server.js`を再起動し、Review Dashboard・Jobs Dashboard・SSE自動更新が
   正常に動作することを目視確認する

## 未実装・既知の制約（本番運用前に把握しておくこと）

- ~~**実LLM/実検索providerは未検証（Task23時点でも未実施）**~~ → **Task30〜32で
  `deepseek`（実LLM）・`tavily`（実検索）を実際にAPIキーで検証済み**。E2E
  （生成→レビュー→承認→公開→website/aor表示）まで実データで確認し、その過程で判明した
  `published_at`欠落問題もTask32で是正した（詳細は
  [docs/real-provider-verification.md](real-provider-verification.md)、
  [docs/final-audit-report.md](final-audit-report.md)参照）。**`openai`/`qwen`/`bing`は
  引き続き未検証**（コードのみ実装済み）。これらを使う前は、上記と同様に
  `experiments/run-experiments.js`・`experiments/run-search-experiments.js`で
  動作・品質・コストを確認することを推奨する
- 複数レビュー担当者アカウントには未対応（`ADMIN_USER`/`ADMIN_PASSWORD`は1組のみ）
- ~~ログイン試行のレート制限は未実装~~ → **Task41で解消済み**。IPアドレス単位で
  5分間に5回失敗すると10分間ブロックする（詳細は
  [website/aor-admin/README.md「ログイン試行レート制限」](../website/aor-admin/README.md)参照）
- ~~ログファイルのローテーション・自動削除は未実装~~ → **Task43で解消済み**。
  `admin-audit.jsonl`・`llm-usage.jsonl`・`search-usage.jsonl`は10MB超過時にアーカイブ
  （削除はしない、監査・コスト分析の証跡を残すため）、`job-history.jsonl`は90日より古い
  行を整理する（世代ファイルは作らずin place整理、Jobs Dashboardの表示に影響しない設計。
  詳細は[scripts/generator/README.md「運用ログ一覧」](../scripts/generator/README.md)、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task43」参照）
- `Secure`Cookie属性は付与していない（`http://localhost`前提のため。HTTPS環境で本番運用
  する場合は`website/aor-admin/auth.js`への追加が必要）
- **中断されたジョブの自動再実行はしない**（Task23）: 起動時復旧は`job-history.jsonl`への
  記録のみを行い、`queued`への自動復帰や自動リトライは行わない（前回の実行内容が
  分からないため、安全側の設計）。必要な場合は利用者が改めてジョブを追加すること

これらの詳細・理由は[website/aor-admin/README.md](../website/aor-admin/README.md)
「制約・未実装事項」、[scripts/generator/README.md](../scripts/generator/README.md)
「Task19以降との関係」を参照。
