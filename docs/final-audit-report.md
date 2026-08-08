# 本番公開前 総合監査レポート（Task25、Task32/Task47で更新）

Task8〜Task24で構築したAORシステム全体（情報収集→AI分析→品質評価→人間レビュー→承認→
公開→website/aorでの受信者向け閲覧、および運用基盤一式）を対象に、Task25で実施した
最終的なセキュリティ・品質監査の結果をまとめる。新機能追加ではなく、既存実装の
検証・軽微な修正のみを行った。**Task25時点では実LLM/実検索providerのAPIキー取得・
実API検証は行っておらず、既知の制約として扱っていたが、Task30〜32で実際にAPIキーを
用いた検証を実施した。** 詳細は[docs/real-provider-verification.md](real-provider-verification.md)、
本レポートの「D. 未検証事項」「E. 公開前必須事項」「F. 最終判定」の各追記を参照。

**Task47で追記**: Task34〜46で、残存課題の評価・対応を継続的に実施した
（再生成時承認失効問題・unpublish機能・ログイン試行レート制限・ログローテーション・
job-history/一覧APIの性能評価と一覧APIキャッシュ実装）。本レポートはTask47時点の
状態に合わせて棚卸し・更新している。個別の変更内容は各Taskの完了報告および
[scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)を参照。

生成日: 2026-08-07（Task25実施時点、Task32・Task47で更新）

---

## A. 実装済み機能

| 領域 | 内容 | 関連Task |
|---|---|---|
| 情報収集 | 会社サイト実フェッチ＋官公庁/業界/ニュース/統計の検索（mock/tavily/bing切替可） | Task8, 9, 12 |
| AI分析 | LLM抽象化レイヤー（mock/openai/deepseek/qwen切替可） | Task11 |
| 品質評価 | ルールベースの自動採点（score/grade/status） | Task10 |
| 人間レビュー | JSONベースのレビューワークフロー（approve/reject/revise/comment/fix、history記録） | Task13 |
| Review Dashboard | 一覧・詳細・レビュー操作・SSEリアルタイム更新 | Task14 |
| 認証・監査 | Basic認証＋セッションCookie・CSRF対策・監査ログ | Task15 |
| Job Runner | メモリキュー・指数バックオフ再試行・スケジューラ・起動時復旧 | Task16, 23 |
| CI/CD準備 | GitHub Actions設定ファイル（ローカル静的確認済み、後述） | Task19 |
| 設定検証 | 環境変数・provider設定の起動時チェック | Task21 |
| ヘルスチェック | `GET /api/health`（auth/jobs/output_dir/logs_dir/config） | Task21, 23 |
| バックアップ | ディレクトリコピー方式のバックアップCLI（Task25で`website/aor/data/`を追加） | Task22, 25 |
| エラーハンドリング統一 | 全CLIの`runCli()`統一、Server APIの内部情報非開示 | Task23 |
| **公開機能** | **承認済みレポートを`website/aor/data/`へ反映するCLI・Dashboard操作** | **Task24** |
| セキュリティ強化 | **パストラバーサル対策（`shared/path-safety.js`）をTask25で追加** | **Task25** |
| 本番リハーサル | LP・メール回収・Dashboard・公開フローの実機総点検 | Task23, 25 |
| 実provider検証 | DeepSeek実LLM・Tavily実検索・E2E（生成→レビュー→承認→公開→表示）を実データで検証 | Task30〜32 |
| 公開整合性チェック | `isPublishable()`が承認後の再生成を検知し公開をブロックする仕組み | Task36 |
| 公開取り消し（unpublish） | `unpublish-report.js`（CLI）・`POST /api/unpublish/:slug`・Dashboard操作 | Task38 |
| ログイン試行レート制限 | IPアドレス単位、5分間に5回失敗で10分間ブロック（プロセス内メモリ） | Task41 |
| ログローテーション/整理 | ログ種別ごとのハイブリッド方式（`shared/log-rotation.js`） | Task43 |
| 一覧APIキャッシュ | `GET /api/reports`のフルスキャンを回避するメモリキャッシュ | Task46 |

自動テスト: **143件**（`node scripts/generator/run-all-tests.js`、mock専用のクリーンな
環境で全PASS。内訳は下記「C. 品質」参照）。

---

## B. セキュリティ

### 認証

- 全`/api/*`ルート（`/api/health`を除く）はBasic認証→セッションCookieによる認証が必須。
  未認証アクセスは401を実測確認済み（`security.test.js`・本タスクでの`/api/publish/:id`個別確認の両方）
- `/api/health`のみ意図的に認証不要（外部監視ツール向け、secret値を返さない設計のため許容）

### CSRF

- 全POSTリクエスト（`/api/*`配下）はセッションCookieに紐づくCSRFトークン
  （`X-CSRF-Token`ヘッダー）の一致を要求。トークン無しのPOSTは403を実測確認済み

### パストラバーサル（Task25で発見・修正）

- **発見**: `scripts/generator/publish-report.js`（Task24で追加）の`slug`引数に
  検証が無く、`path.join(OUTPUT_DIR, slug, ...)`がバックスラッシュを含むslug
  （例: `..\..\Windows\System32\...`）でOUTPUT_DIR・`website/aor/data/`の外側を
  指しうることを、実際にNode.jsで直接呼び出して確認した
- **実際の悪用可能性の実測結果**: HTTP経由での攻撃は、Node標準のURLパーサが
  `../`のようなドットセグメントをルーティング前に正規化して除去するため、また
  `%2f`のようなURLエンコードされたスラッシュはデコードされずに文字列として
  扱われるため、実際には成立しないことを`curl`・Node標準`http`モジュールでの
  直接送信テストの両方で確認した。ただし**CLI引数（`process.argv`）はこの保護を
  経由しないため無防備であった**ことも確認した
- **修正**: `shared/path-safety.js`を新設し、`validateSlug()`（英数字・ドット・
  ハイフンのみ許可）と`isWithinDir()`（解決後パスの二重チェック）を実装。
  `publish-report.js`と、同じ脆弱パターンが**Task14から存在していた**
  `website/aor-admin/server.js`の`loadCompany()`（`/api/report/:id`等が使用）の
  両方に適用した。修正後、全パストラバーサルpayload（`..`、`../test`、
  `..\..\Windows\...`、`%2e%2e%2f`、`..%5C..%5Ctest`等）が拒否されることを
  実測再確認した
- 回帰テスト7件を`publish-report.test.js`に追加

### ファイル上書き対策

- `website/aor/data/`には手動サンプル（company-01〜03）とAIパイプライン公開データが
  混在する。slugの命名規則上、偶然の衝突は極めて起こりにくいが、既存ファイルを
  上書きする場合は必ず`WARN`ログを出すようにした（ブロックはしない。再公開は
  正規の操作のため）。運用方針は`scripts/generator/README.md`に明記した

### 入力検証・エラー情報の非開示

- リクエストボディは1MB上限（既存、Task15）
- ジョブ種別・パラメータは`job-runner.js`が検証（既存）
- 想定外の例外（fsエラー等）を拾う汎用500ハンドラは、内部の絶対パスを含みうる
  詳細をレスポンスに含めず、汎用メッセージのみを返す（Task23で対応、変更なし）

### secret管理

- `website/aor/`配下（`data/`・`assets/`・HTML）を全件grepし、
  `ADMIN_USER`/`ADMIN_PASSWORD`/APIキー/Cookie/セッショントークン/内部絶対パスの
  いずれも含まれないことを確認した（0件）
- `website/aor/assets/`にCookie・localStorage・sessionStorageへの書き込みコードが
  一切無いことをコード検索で確認した（`email-capture.html`の登録フォームが
  完全に静的モックであることの裏付け）
- `scripts/generator/logs/`（4ファイル、計899行）を全件走査し、
  パスワード・APIキー・セッショントークンのパターンに一致する行が無いことを確認した
- `redact.js`（Task23）の実効性を、実際に蓄積されたログから確認した:
  `security.test.js`が意図的に注入した偽の秘密情報（`sk-THIS-IS-A-FAKE-SECRET-...`）が
  `job-history.jsonl`に record された10件すべてで`[REDACTED]`に置き換わっており、
  生の値は1件も残っていないことを確認した（`grep`で0件）

**総合評価**: 認証・CSRF・secret管理は堅牢。パストラバーサルは実害が発生する前に
発見・修正できた（HTTP経由では元々成立しなかったが、CLI経路と多層防御の観点から
修正は適切だった）。

---

## C. 品質

### 自動テスト

```
node scripts/generator/run-all-tests.js
# tests 143 / pass 143 / fail 0（実provider用APIキー環境変数を外したクリーンな環境）
Dashboard確認: OK
=== 総合結果: PASS ===  EXIT CODE: 0
```

- Task23時点99件 → Task24で+7件（publish-report.test.js） → Task25で+6件
  （パストラバーサル回帰テスト）= 112件 → Task32で+4件（published_at関連）= 116件 →
  Task36で+7件（isPublishable整合性チェック）= 123件 → Task38で+6件（unpublish）= 129件 →
  Task41で+6件（レート制限）= 135件 → Task43で+7件（ログローテーション）= 142件 →
  Task46で+2件（一覧APIキャッシュ）= **143件**
- **（Task32以降の既知の環境要因）** この開発機には実DeepSeek/Tavily APIキーが
  検証目的で永続設定されており、その状態で`run-all-tests.js`を実行すると
  「APIキー未設定」を前提とする既存テスト2件（`llm.test.js`・`search.test.js`各1件）が
  実際にAPIを呼び出してしまい失敗する（143件中141件PASS）。該当環境変数を一時的に
  外すと143件全てPASSすることを都度確認しており、コードの欠陥ではなく環境要因と
  切り分け済み（詳細は「D. 未検証事項」参照）
- カバレッジは構造的近似値（npmカバレッジツール不使用の制約による）。詳細は
  `quality-report.md`参照

### 実機確認

- **Review Dashboard**: 一覧・詳細・承認・却下・差し戻し・コメント・修正指示・
  **公開・再公開**・Jobs追加・retry・SSE自動更新（2タブでのリアルタイム反映）を
  すべて実操作で確認。Console Error/Warning: 0件
- **Jobs Dashboard**: 同上、SSE反映も2タブで確認
- **LP（website/aor）**: `report-preview.html`/`email-capture.html`/
  `paid-preview.html`を、デスクトップ・タブレット(768px)・モバイル(375px)の
  3サイズ×3社分のサンプルデータ（company-01〜03）+ AIパイプライン公開データ
  （example.com）で確認。Console Error/Warning・Network Error・レイアウト崩れ
  （横方向オーバーフロー）はいずれも0件
- **メール回収フロー**: 正常系・異常系（空欄・不正形式・日本語・292文字）を確認。
  **フォーム送信が完全に静的（ネットワーク送信なし、localStorage/sessionStorage
  保存なし）であることを送信前後で実測し、Task23からの変化が無いことを確認した**
- **公開フロー**: Review Dashboardで承認→「公開する」ボタン→
  `website/aor/data/example.com.json`生成→3画面すべてで表示、を実際に確認した

---

## D. 未検証事項

- ~~**実LLM provider未検証**（`openai`/`deepseek`/`qwen`）~~ → **Task30〜32で検証済み**。
  `deepseek`（model: `deepseek-chat`）で実際にAPIキーを用いて動作・出力品質を確認した。
  詳細は[docs/real-provider-verification.md](real-provider-verification.md)参照（`openai`/`qwen`は引き続き未検証）
- ~~**実検索provider未検証**（`tavily`/`bing`）~~ → **Task30〜32で検証済み**。
  `tavily`で実際にAPIキーを用いてmockへのフォールバックなしに実検索結果を取得できることを確認した。
  詳細は同上（`bing`は引き続き未検証）
- **GitHub Actions実行未確認**: `.github/workflows/quality-check.yml`は
  ローカルで静的確認済み（YAML構造の目視確認、Node.jsバージョン・
  `run-all-tests.js`の呼び出し方・artifact保存設定・secret不要であることを
  個別に確認）だが、**実際にGitHub Actions上で実行して成功することは未確認**
  （本タスクの厳守事項によりpush・ワークフロー発火は行っていない）
- **実端末でのモバイル確認は未実施**: Claude Browserのモバイルエミュレーション
  （375x812）でのみ確認。実iOS/Android実機・実ブラウザでの確認はしていない
- ~~**大量データ時の性能は未検証**~~ → **Task44〜46で評価・一部対応済み**。
  `job-history.jsonl`（Jobs Dashboard用）は実測（573件で0.96ms、合成データで
  200,000件でも265ms）から、Task43の90日整理と組み合わせてPhase1 MVP規模では
  対応不要と判断した（Task44）。Review Dashboard一覧（`listCompanySummaries()`）は
  実測で5,000社時点で約1.05秒・10,000社で約2.05秒という明確な速度低下を確認した
  ため（Task45）、`GET /api/reports`・SSE初期送信をメモリキャッシュ
  （`reportsCache`）経由にし、`fs.watch`のデバウンス発火時のみ再計算する設計へ
  変更した（Task46）。**残存**: `listSlugs()`のディレクトリ列挙自体（1社あたり
  複数回のstat呼び出し）は未改善。数万社規模での`fs.watch(recursive:true)`
  自体の監視コストも未評価

**追記（Task32）**: 実providerを使ったブラウザ目視確認（`website/aor`受信者向け画面）は、
Task31時点ではClaude in Chrome拡張が未接続のため未実施だったが、**Task32では拡張が接続でき、
実施・確認済み**（`report-preview.html?company=example.com`でfree opportunity・locked
opportunities・source情報の表示、Console Error/Network Errorともに0件を確認）。詳細は
[docs/real-provider-verification.md](real-provider-verification.md)「5. ブラウザ目視確認」参照。
上記「大量データ時の性能」「実端末でのモバイル確認」、および次項の「GitHub Actions実行未確認」は
Task32時点でも引き続き未検証のまま残っている。

**追記（Task32、テストスイートへの副作用）**: `DEEPSEEK_API_KEY`/`TAVILY_API_KEY`/`LLM_PROVIDER`/
`SEARCH_PROVIDER`を実provider検証用にこの環境へ永続設定した結果、`run-all-tests.js`実行時に
「APIキー未設定」を前提とする既存テスト2件（`llm.test.js`・`search.test.js`各1件）が、
想定と異なり実際にAPIを呼び出してしまい失敗することを確認した。該当環境変数を一時的に外すと
112件全てPASSすることを確認済みであり、**コードの欠陥ではなく環境要因**と切り分けた
（コード修正は本タスクの範囲外のため未実施）。詳細は
[docs/real-provider-verification.md](real-provider-verification.md)「6. 自動テストへの影響」参照。

**追記（Task27）**: メール回収の本番化（実際にメールアドレスを保存・配信する機能）は
未実装であることを、Task27で設計レビューとして正式に整理した。現状のメール回収
フローは完全な静的モックであり（送信・保存の副作用が無いことを実測で再確認済み）、
これは意図的な設計であって不具合ではない。本番化する場合の必要情報・個人情報上の
留意点・保存方式の比較・推奨方式・将来のセキュリティ要件は
[docs/email-capture-design.md](email-capture-design.md)にまとめた。**推奨は
「実LLM/実検索provider検証が完了するまでは現状維持（D方式）」**であり、本番公開の
必須事項には含めない（実際に集客を始める段階で改めて着手すべき事項として扱う）。

**追記（Task29）**: 運用面・データ面・障害復旧面の最終総点検を実施した
（[docs/operations-checklist.md「本番環境の前提条件まとめ」「一連の運用フロー」](operations-checklist.md)を
新設）。承認→公開→再公開の4ケース（新規公開・内容更新後の再公開・差し戻し後の再承認再公開・
連続二重公開）、異常系12種（report.json/review.jsonの欠如・不正JSON、公開データ欠如、
不正slug、存在しない会社/job、二重実行、サーバー再起動、job実行中の異常終了からの復旧、
backup対象ファイル欠如）を実機で再現し、いずれも安全に処理されることを確認した。
バックアップ→改変→復旧のドリルも実施し、README記載の手順のみでMD5一致の完全復旧が
できることを確認した。新たな重大な問題は発見されなかったが、以下2点の運用上の
注意点を実測で確認し、ドキュメント化した（コード変更はしていない。運用ルールでの
対応を推奨する事項のため）:

- 承認済みレポートを同一slugで再生成しても、`review.json`の承認状態は自動的には
  無効化されない（再生成後は必ず差し戻し→再レビューを行う運用ルールが必要）
- 差し戻し（`needs_revision`）にしても、既に公開済みのファイルは自動的には
  非公開にならない（前述「未実施でも公開可能だが将来的に改善すべき事項」の
  「公開の取り消し（unpublish）機能」と対応する既知の制約）

詳細はTask29の完了報告を参照。

---

## E. 公開前必須事項

### これが終わらないと公開すべきではない

1. ~~**実LLM providerでの動作確認**~~ → **Task30〜32で完了**。`deepseek`（model: `deepseek-chat`）で
   実際にAPIキーを用いたエンドツーエンドの動作・出力品質確認を実施し、品質評価91/100（grade A、PASS）を
   確認した。詳細は[docs/real-provider-verification.md](real-provider-verification.md)参照
2. ~~**実検索providerでの動作確認**~~ → **Task30〜32で完了**。`tavily`で実際にAPIキーを用いて
   mockへのフォールバックなしに実検索結果（実在するURL含む）を取得できることを確認した。
   検証の過程で**`published_at`（公開日）が取得できないページが多い**（実測95%）ことが判明し、
   `validate-report.js`だけがこれを必須化しているという設計矛盾が見つかったため、**Task32で
   `validate-report.js`を修正し、`published_at`を任意化（未設定/nullはPASS、値がある場合のみ
   形式検証）した**。`isPublishable()`・公開処理・website/aor・quality-evaluator.jsはいずれも
   元々`published_at`を必須としていなかったため変更していない。詳細は
   [docs/real-provider-verification.md](real-provider-verification.md)「4. published_at欠落問題の評価」、
   [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task32」参照
3. **GitHub Actions実行確認（未完了・引き続き必須）**: ローカルでの静的確認では、実際のUbuntu環境・
   実際のGitHub Actionsランナーでの`node --version`の解決結果や、
   ネットワーク到達性（`generator.test.js`の実HTTPテスト）が意図通りに動くかは
   実行するまで分からない。**Task32時点でも本タスクの厳守事項（git push禁止）により未実施のまま**

### 未実施でも公開可能だが将来的に改善すべき事項

- 実端末でのモバイル確認
- ~~大量データ時の性能検証~~ → **Task44〜46で評価・一部対応済み**（詳細は上記
  「D. 未検証事項」参照）。`listSlugs()`のディレクトリ列挙自体の改善は未対応のまま残る
- 複数レビュー担当者アカウント対応
- ~~ログイン試行のレート制限~~ → **Task41で解消済み**。`website/aor-admin/auth.js`に
  IPアドレス単位のレート制限（5分間に5回失敗で10分間ブロック）をプロセス内メモリで実装した。
  既存の`sessions` Mapと同じ設計パターンを踏襲し、npm非依存・DB不要方針を維持している。
  詳細は[website/aor-admin/README.md「ログイン試行レート制限」](../website/aor-admin/README.md)、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task41」参照
- ~~ログのローテーション・自動削除~~ → **Task43で解消済み**。ログ種別ごとに異なる方針を
  適用するハイブリッド方式を採用した（`shared/log-rotation.js`）。`llm-usage.jsonl`・
  `search-usage.jsonl`・`admin-audit.jsonl`（監査・コスト分析用途、書き込み専用）は
  10MB超過時にアーカイブするのみで自動削除はしない。`job-history.jsonl`
  （Jobs Dashboardが直接読む運用ログ）は90日より古い行をin place整理する（世代ファイルは
  作らず、`readHistory(limit)`の挙動はそのまま維持）。詳細は
  [scripts/generator/README.md「運用ログ一覧」](../scripts/generator/README.md)、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task43」参照
- ~~公開の取り消し（unpublish）機能~~ → **Task38で解消済み**。`scripts/generator/
  unpublish-report.js`（CLI）・`POST /api/unpublish/:slug`・Review Dashboardの
  「公開を取り消す」ボタンを追加した。`publish-report.js`の`validateSlug()`・
  `isWithinDir()`・`AOR_DATA_DIR`等をそのまま再利用し、`report.json`・`review.json`は
  一切参照・変更しない設計。既に非公開の場合はエラーにせず成功扱い（冪等）とする設計判断とした。
  詳細は[scripts/generator/README.md「公開の取り消し」](../scripts/generator/README.md)、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task38」参照
- ファイル上書きの警告をログではなくDashboard UI上にも表示する改善
- ~~同一slugの再生成時に、既存の承認状態（`review.json`）を自動的に無効化する仕組み~~
  → **Task36で解消済み**。`review-engine.js`の`isPublishable(review, evaluation, report)`に
  第3引数`report`を追加し、`report.meta.generated_at`が`review.reviewed_at`より後（＝承認後に
  再生成された）場合は`publishable: false`とする検証を追加した。`report.json`・`review.json`
  いずれのJSON構造も変更せず、既存フィールドの比較のみで実現した。日時比較は`Date.parse()`に
  よる数値比較を用い、不正な日時・`reviewed_at`欠如はいずれも安全側（`false`）に倒す設計。
  詳細は[review/review-schema.md](../scripts/generator/review/review-schema.md)「publishable判定」、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task36」参照
  （Task29で発見、Task34でリリース判断への影響が最も高い残存項目と評価していた）
- ~~**（Task32で発見）Tavily実APIの`published_at`欠落**~~ → **Task32内で解消済み**。
  `validate-report.js`の`published_at`必須要件を任意化する最小限の修正を行い、
  `test/validator.test.js`にテスト4件を追加した。既存の実Tavily検索結果（source_pages
  20件中19件がpublished_at欠落）で再検証し、エラー0件（`ok: true`）になることを確認した
  （詳細は[docs/real-provider-verification.md](real-provider-verification.md)、
  [scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task32」参照）
- **（Task32で追加）テストスイートの環境依存**: 実provider用APIキーがこの環境に永続設定された
  状態では`run-all-tests.js`が2件失敗する（コードの欠陥ではなく環境要因、詳細は上記「D. 未検証事項」
  「追記（Task32、テストスイートへの副作用）」参照）。テスト実行前後でのAPIキー環境変数の
  退避・復元、またはテスト自体の環境非依存化を将来的に検討すべき

---

## F. 最終判定

# 条件付きGO（Conditional GO）— Task32で条件を再評価・縮小

**Task25時点の理由**: パイプライン全体（情報収集→AI分析→品質評価→人間レビュー→承認→公開→
受信者閲覧）の**仕組み自体**は、mock providerによる実機確認・112件の自動テスト・
セキュリティ監査（認証・CSRF・パストラバーサル・secret管理）を経て、堅牢であることを
確認した。運用基盤（バックアップ・ヘルスチェック・エラーハンドリング・監査ログ）も
一通り整備されている。しかし、この製品の中核的な価値は「AIが生成する分析内容の質」であり、
それは**mock providerでは検証できない**という理由で、実LLM/実検索providerでの検証完了まで
本番配信をNO-GOとしていた。

**Task32時点の再評価**: 上記「E. 公開前必須事項」1・2（実LLM/実検索providerでの動作確認）は
**Task30〜32で完了した**。DeepSeek（`deepseek-chat`）による実LLM生成、Tavilyによる実検索、
両者を組み合わせたE2E（生成→Review Dashboardでのレビュー→差し戻し→再承認→公開→
website/aorでの受信者向け表示）まで実機で確認し、品質評価91/100（grade A、PASS）、
Console/Network Errorともに0件を確認した。既存のセキュリティ監査・自動テスト・
バックアップ/リストア体制と合わせて、**AIが生成する分析内容の質を含めたパイプライン全体を
実データで検証できた**。

また、実Tavily検証の過程で`validate-report.js`が`published_at`を必須化していたという設計矛盾
（他の全モジュールはnullを許容・無関係）が判明したため、Task32内で最小限の修正（任意化）を行い、
既存の実検索結果での再検証・自動テスト4件追加を行った（詳細は上記「E. 公開前必須事項」2参照）。
これにより、実providerを使ったパイプライン全体（機械的検証を含む）が矛盾なく動作することを確認した。

一方、「E. 公開前必須事項」3（GitHub Actions実行確認）は本タスクの厳守事項（git push禁止）により
Task32でも引き続き未実施であり、実端末でのモバイル確認も未検証のまま残っている。

**Task47時点の再評価**: Task34〜46で、Task29・Task34が「残存課題の中で最も実害に直結しやすい」
と評価していた項目（再生成時承認失効問題）を含め、以下をすべて解消・評価済みとした。

- 再生成時の承認失効問題（Task36）
- Tavily実APIの`published_at`欠落（Task32）
- 公開の取り消し（unpublish）機能（Task38）
- ログイン試行のレート制限（Task41）
- ログのローテーション・自動削除（Task43）
- 大量データ時の性能（job-history.jsonl・一覧APIキャッシュ、Task44〜46）

いずれも`report.json`・`review.json`のJSON構造・`schema_version 2.4`・website/aor（受信者向けLP）
を変更せずに実現しており、既存の自動テスト（143件、mock専用のクリーンな環境で全PASS）にも
回帰は無いことを確認済み（各Taskの完了報告参照）。

**したがって**:
- 内部関係者向けのデモ・引き続きの開発・ステージング環境での確認 → **GO**（変更なし）
- 実際の見込み客への本番配信 → **条件付きGO**（Task32時点からの条件に変化なし。実LLM/実検索
  providerの検証完了、および今回解消した残存課題群により、AIが生成する分析内容の質・運用面の
  実害リスクはいずれも解消されたと判断する。**残る条件は引き続きGitHub Actions実行確認のみ**。
  これはTask25時点から「必須事項」として明記されていた項目であり、実際にCI環境で
  `run-all-tests.js`相当が問題なく完走することを確認したうえで、最終的なGOに切り替えることを
  推奨する。実端末モバイル確認・複数レビュー担当者対応・`listSlugs()`のさらなる最適化等は、
  Task25時点と同じく「未実施でも公開可能だが将来的に改善すべき事項」の扱いを維持する）

---

## 参考: 監査で確認した具体的な数値

- 自動テスト: **143件**（Task32〜46で112件から段階的に増加。内訳は「C. 品質」参照）。
  mock専用のクリーンな環境でPASS 143 / FAIL 0を確認。実provider用APIキーがこの環境に
  永続設定された状態ではPASS 141 / FAIL 2。原因は環境要因でありコードの欠陥ではないことを
  Task32以降継続して切り分け済み。詳細は「D. 未検証事項」参照
- 監査ログ総行数: 300行（`admin-audit.jsonl`）、secret混入0件（Task25時点。Task43で
  10MB超過時のアーカイブ機構を追加、削除はしていない）
- ジョブ履歴総行数: 281行（`job-history.jsonl`）、redact.js適用による
  `[REDACTED]`置き換え実績10件、生の秘密情報の残存0件（Task25時点。Task43で90日保持の
  整理機構を追加）
- website/aor配下ファイル: secret/絶対パス混入0件（全件grep）
- パストラバーサルpayload: 検証した7種類すべてで修正後は拒否を確認
- **（Task32追加）実LLM検証**: DeepSeek（`deepseek-chat`）、1回のE2E生成でinput_tokens 21064・
  output_tokens 2735・推定コスト$0.003715、品質評価91/100（grade A、PASS）
- **（Task32追加）実検索検証**: Tavily実APIから5件の実検索結果を取得（mockへのフォールバックなし）
- **（Task44追加）job-history.jsonl読み込み性能**: 実測573件で0.96ms、合成データで
  200,000件（52MB）でも265ms。Task43の90日整理と組み合わせ、Phase1 MVP規模では対応不要と判断
- **（Task45〜46追加）Review Dashboard一覧API性能**: `listCompanySummaries()`の実測で
  5,000社時点で約1.05秒・10,000社で約2.05秒の速度低下を確認（Task45）。`GET /api/reports`・
  SSE初期送信をメモリキャッシュ（`reportsCache`）経由に変更し、`fs.watch`のデバウンス発火時
  （変更検知から300ms後）のみ再計算する設計へ変更した（Task46）
