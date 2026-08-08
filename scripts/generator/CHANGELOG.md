# CHANGELOG（scripts/generator）

## 2026-08-08（24） — Task47〜49: 最終監査レポート更新・ドキュメント整合性監査・是正

Task34〜46で実施した残存課題の評価・対応（Task36・38・41・43・44・45・46）を踏まえ、
本番公開前の監査資料・運用ドキュメントを現状に合わせて棚卸しした一連の作業。
コード変更は行っていない（ドキュメントのみ）。

### 主な内容

1. **Task47**: `docs/final-audit-report.md`をTask46完了時点の状態へ更新した。
   実装済み機能一覧・自動テスト件数（112件→143件）・未検証事項・公開前必須事項・
   最終判定（条件付きGO、残る条件はGitHub Actions実行確認のみ）を最新化した
2. **Task48**: `docs/final-audit-report.md`以外の主要ドキュメント
   （`docs/operations-checklist.md`・`scripts/generator/README.md`・
   `scripts/generator/CHANGELOG.md`・各`README.md`・`.github/workflows/quality-check.yml`）
   を横断的に監査し、実装済み内容とドキュメント記載の不一致（古い「未検証」「未実装」
   表記の残存、CHANGELOGへのTask46記載漏れ等）を発見した。あわせて
   `run-all-tests.js`の`checkDashboardSmoke()`がCI環境の`ADMIN_USER`等に依存せず
   自前でテスト用認証情報を供給する設計であることを確認し、GitHub Actions実行時の
   リスクが従来想定より低いことを記録した（コード変更・ドキュメント変更は行っていない、
   発見のみ）
3. **Task49**: Task48で発見した不整合を是正した（詳細は下記「変更ファイル」参照）。
   `docs/operations-checklist.md`・`scripts/generator/README.md`の「実LLM/実検索provider
   未検証」「ログイン試行のレート制限なし」等の古い記述を、Task30〜32・Task41の実施内容に
   合わせて更新し、`docs/real-provider-verification.md`への相互参照を追加した。
   `scripts/generator/CHANGELOG.md`にTask44〜46のエントリを追加した。
   `docs/operations-checklist.md`のE2Eランブックに、既存の手順番号を変更せずunpublish操作を追記した

### 変更していないもの

- `report.json`・`review.json`のJSON構造・`schema_version 2.4`
- `website/aor`・`website/aor-admin`のコード・UI・API仕様
- provider実装・security実装（Task36/38/41/43/46の実装内容そのもの）

### 変更ファイル（今回分）

- 更新: `docs/final-audit-report.md`（Task47）、`docs/operations-checklist.md`、
  `scripts/generator/README.md`、`scripts/generator/CHANGELOG.md`（Task49）

---

## 2026-08-07（23） — Task46: Review Dashboard一覧APIへメモリキャッシュを実装（Task45の案Aに基づく）

Task45で実測した性能低下（5,000社で約1.05秒、10,000社で約2.05秒）に対応するため、
`GET /api/reports`・SSE初期送信を毎回のフルスキャンからメモリキャッシュ経由に変更した。

### 主な内容

1. **`website/aor-admin/server.js`にモジュールレベルの`reportsCache`を追加**:
   サーバー起動時に`listCompanySummaries()`を1回だけ計算して初期値とする
2. **既存の`fs.watch(OUTPUT_DIR, {recursive:true})`のデバウンス機構（300ms）が
   発火した時のみ再計算**: `broadcastReportsUpdate()`内で1回だけ`listCompanySummaries()`を
   呼び、`reportsCache`更新とSSE送信ペイロードの両方に使う（二重計算しない）
3. **`GET /api/reports`・`/api/events`初期送信を`reportsCache`参照に変更**:
   `listSlugs()`・`loadCompany()`・`toSummary()`自体は無変更のため、レスポンス形式・
   フィールド構造・件数・並び順はいずれも従来と完全に同一
4. **テスト2件を追加**（`test/security.test.js`）: 起動直後の`GET /api/reports`が配列を
   返すこと、および**report.json追加直後はキャッシュ未更新のため一覧に反映されず、
   fs.watchのデバウンス（300ms）後に反映される**ことを実測で確認する鮮度確認テスト

### 変更していないもの

- `report.json`・`review.json`のJSON構造・`schema_version 2.4`
- `website/aor`（受信者向けLP）
- `GET /api/reports`のレスポンス形式・`listSlugs()`/`loadCompany()`/`toSummary()`のロジック

### 変更ファイル（今回分）

- 更新: `website/aor-admin/server.js`、`scripts/generator/test/security.test.js`（テスト2件追加）

---

## 2026-08-07（22） — Task45: Review Dashboard一覧API（listCompanySummaries）の性能評価

Task44に続き、`website/aor-admin/server.js`の`listSlugs()`・`listCompanySummaries()`
（Review Dashboard一覧・`GET /api/reports`が使う）の性能特性を実測評価した。**コード変更は
行っていない**（評価・改善案の提示のみ）。

### 主な内容

- 合成データ（一時ディレクトリ、実データ不使用）で実測: 100社=55.57ms、1,000社=203.06ms、
  **5,000社=約1.05秒、10,000社=約2.05秒**と、明確な速度低下を確認した
- `fs.watch(OUTPUT_DIR, {recursive:true})`が出力ディレクトリ配下のあらゆる変更を検知し、
  300msデバウンス後に全社ぶんの`listCompanySummaries()`を再計算する設計のため、
  1社の更新が全社ぶんの再計算を誘発するという増幅要因を発見した
- `scripts/generator/output/`にはTask43のようなローテーション機構が無く、会社数は
  無期限に増加し続けるため、job-history.jsonl（Task44）とは異なり将来的にボトルネックと
  なる可能性が高いと判断した
- 改善案3案（メモリキャッシュ／インデックスファイル／現状維持）を比較し、
  既存の`fs.watch`インフラを再利用する「一覧情報キャッシュ（案A）」を推奨した
  （実装はTask46で実施）

### 変更ファイル（今回分）

- 無し（コード変更なし。評価結果はTask45完了報告・本CHANGELOGにのみ記録）

---

## 2026-08-07（21） — Task44: job-history.jsonl読み込み性能評価

`jobs/job-runner.js`の`readHistory(limit)`が`job-history.jsonl`全体を読み込んでから
末尾を切り出す実装（O(n)）になっている点について、大量データ時の性能を実測評価した。
**コード変更は行っていない**（評価のみ、対応不要と判断）。

### 主な内容

- 合成データ（一時ファイル、実データ不使用）で実測: 1,000件=2.30ms、10,000件=12.46ms、
  50,000件=58.54ms、200,000件（52MB）=265.02ms とほぼ線形にスケールすることを確認した
- 実際の`job-history.jsonl`（573件、164KB時点）では0.96msと、現状は全く問題にならない
  水準であることを確認した
- Task43で追加した90日保持整理と組み合わせると、この製品の現実的な運用規模
  （1日あたり数百件のジョブ実行を90日継続しても数万件程度）では実用上問題にならないと
  判断し、この時点での改善は不要と結論づけた

### 変更ファイル（今回分）

- 無し（コード変更なし。評価結果はTask44完了報告・本CHANGELOGにのみ記録）

---

## 2026-08-07（20） — Task43: ログのローテーション・整理を実装（Task42のハイブリッド方式）

Task42の設計検討で、`scripts/generator/logs/`配下の4ログファイルは性質が大きく異なる
（`job-history.jsonl`のみJobs Dashboard UIが実読、他3つは書き込み専用の監査/コスト分析用途）
ことが判明したため、単一の画一的な方式ではなくログ種別ごとに異なる方針を適用するハイブリッド
方式を採用し、実装した。

### 主な内容

1. **`scripts/generator/shared/log-rotation.js`を新規追加**: `archiveIfOversize()`
   （サイズ超過時に`<ファイル名>.archive-<timestamp>`へリネームして退避、削除はしない）と
   `pruneOlderThan()`（行ごとの日時フィールドを見て保持期間より古い行のみin place削除、
   世代ファイルは作らない）の2関数を用意した。既存の`appendJsonLine()`
   （`shared/json-file.js`）はシンプルな追記のみを行う設計のまま変更せず、ローテーション
   判定はこちらに分離した（単一責任を維持）
2. **`admin-audit.jsonl`・`llm-usage.jsonl`・`search-usage.jsonl`**: それぞれの書き込み
   関数（`auth.js`の`logAudit()`、`llm-client.js`・`search-client.js`の`writeLog()`）で
   `archiveIfOversize(path, 10MB)`を追記直前に呼ぶ。監査・コスト分析目的で内容を失わない
   ことを優先し、自動削除は実装していない
3. **`job-history.jsonl`**: `job-runner.js`の`writeHistory()`で`pruneOlderThan(HISTORY_PATH,
   90, "created_at")`を追記直後に呼ぶ。世代ファイルは作らないため`readHistory(limit)`の
   実装・挙動は変更していない（Task42で発見した「全件読み込んでから末尾切り出し」という
   設計上の性能課題自体は今回のスコープ外だが、90日で整理され続けることでファイルサイズが
   無期限には増えなくなり、間接的にこの課題の深刻化を抑える）
4. **不正な値は安全側で残す設計**: JSON解析に失敗した行、日時フィールドが不正/欠落した行は
   いずれも削除しない（`validate-report.js`のTask32修正等、本プロジェクト全体で一貫している
   「不正な値は安全側に倒す」方針を踏襲）
5. **テスト7件を追加**（`test/shared.test.js`）: サイズ閾値未満/以上でのアーカイブ挙動、
   存在しないファイルへの耐性、保持期間による削除・非削除、不正な日時/JSON行の非削除、
   削除対象が無い場合にファイルへ触れないこと。いずれも`os.tmpdir()`配下の一時ファイルのみを
   対象とし、実際の`scripts/generator/logs/`配下のファイルには一切触れていない

### 変更していないもの

- 各ログの1行あたりのJSON構造（フィールド構成）
- `report.json`・`review.json`のJSON構造・`schema_version 2.4`
- `website/aor`（受信者向けLP）
- `job-history.jsonl`の`readHistory(limit)`のロジック・戻り値の形（世代ファイル方式を
  採用しなかったため変更不要と判断した）

### 変更ファイル（今回分）

- 新規: `scripts/generator/shared/log-rotation.js`
- 更新: `website/aor-admin/auth.js`、`scripts/generator/llm/llm-client.js`、
  `scripts/generator/search/search-client.js`、`scripts/generator/jobs/job-runner.js`、
  `scripts/generator/test/shared.test.js`（テスト7件追加）、
  `scripts/generator/README.md`、`docs/operations-checklist.md`、`docs/final-audit-report.md`

---

## 2026-08-07（19） — Task41: ログイン試行レート制限を実装（Task40の設計に基づく）

Task40で検討した「プロセス内メモリによるIPアドレス単位のレート制限」を実装した。

### 主な内容

1. **`website/aor-admin/auth.js`にレート制限ロジックを追加**: 既存の`sessions` Mapと
   同じパターンでプロセス内メモリの`failedAttempts` Mapを新設。5分間の時間窓内に5回
   ログインに失敗すると、そのIPを10分間ブロックする（`RATE_LIMIT_WINDOW_MS`・
   `RATE_LIMIT_MAX_ATTEMPTS`・`RATE_LIMIT_BLOCK_MS`として定義）
2. **IPアドレス単位**: `ADMIN_USER`/`ADMIN_PASSWORD`が単一組み合わせのため、ユーザー名
   単位だと正当な利用者を誤ってロックアウトするリスクが高くなるという判断（Task40の
   設計検討）に基づく
3. **既存の有効なセッションは対象外**: レート制限は新規ログイン試行（Basic認証ヘッダーの
   検証）のみに適用し、セッションCookieでの通常操作は妨げない
4. **ログイン成功時にカウンタをリセット**: 正しい認証情報を入力すればすぐに通常状態へ戻る
5. **`isBlocked()`/`recordFailedAttempt()`に`now`引数を追加**（`review-engine.js`の
   `approve()`等と同じ、テスト時に時刻を注入できるパターン）。10分のブロック期間経過を
   実時間で待つことなく決定的にテストするため
6. **テスト6件を追加**（`test/security.test.js`）: 統合テスト2件（実サーバーを別ポートで
   起動し実HTTPリクエストで検証）、ユニットテスト4件（`now`引数注入によるブロック発生・
   期間経過後の復帰・時間窓超過によるリセット・カウンタクリアの確認）

### 変更していないもの

- `report.json`・`review.json`のJSON構造・`schema_version 2.4`
- `website/aor`（受信者向けLP）
- 既存のBasic認証・セッションCookie・CSRF検証ロジック

### 変更ファイル（今回分）

- 更新: `website/aor-admin/auth.js`、`scripts/generator/test/security.test.js`
  （テスト6件追加、`httpRequest()`に`port`オプション追加）、`website/aor-admin/README.md`

---

## 2026-08-07（18） — Task38: 公開取り消し（unpublish）機能を追加

Task24で公開機能（`publish-report.js`）を追加した際にスコープ外としていた「公開の取り消し」を、
Task34の残存課題評価（分類B: 運用開始後の対応で問題ない）を経て実装した。

### 主な内容

1. **`scripts/generator/unpublish-report.js`を新規追加**: `publish-report.js`と対称的な
   最小構成。`shared/path-safety.js`の`validateSlug()`・`isWithinDir()`、
   `publish-report.js`の`AOR_DATA_DIR`・`publishedPathFor()`・`isPublished()`をそのまま
   importして再利用し、重複実装を避けた。`website/aor/data/<slug>.json`の削除のみを行い、
   `report.json`・`review.json`はいずれも一切参照・変更しない
2. **冪等な設計**: 既に非公開（対象ファイルが存在しない）状態で実行してもエラーにせず
   `{ok: true, alreadyUnpublished: true}`を返す。「非公開状態にする」という目標状態への
   操作という位置づけのため、二重クリック・リトライで失敗通知が出て運用担当者を混乱させる
   ことを避ける設計とした
3. **`review.json`の承認状態には一切影響しない**: 「公開データを取り下げる」ことと
   「レビュー判断を覆す」ことを意図的に別操作として設計した（`publish-report.js`が
   `report.json`・`review.json`を読み取り専用として扱う方針を踏襲）
4. **API・UI追加**: `POST /api/unpublish/:slug`（`website/aor-admin/server.js`）、
   Review Dashboard詳細画面の「公開を取り消す」ボタン（公開済みの場合のみ表示、
   `publishable`の状態に関わらず常に押せる）
5. **監査ログ**: `admin-audit.jsonl`へ`action: "unpublish"`として記録（`publish`と同形式）
6. **テスト6件を追加**（`test/unpublish-report.test.js`）: 公開済み→取り消し成功、
   未公開→冪等にok:true、report.json/review.json非変更、取り消し後の再publish、
   パストラバーサル拒否、公開先パスの範囲確認

### 変更していないもの

- `report.json`・`review.json`のJSON構造・`schema_version 2.4`
- `website/aor`（受信者向けLP）
- `publish-report.js`本体（importして再利用するのみで変更なし）

### 変更ファイル（今回分）

- 新規: `scripts/generator/unpublish-report.js`、`scripts/generator/test/unpublish-report.test.js`
- 更新: `website/aor-admin/server.js`、`website/aor-admin/public/assets/js/api.js`、
  `website/aor-admin/public/assets/js/detail.js`、`scripts/generator/README.md`、
  `website/aor-admin/README.md`、`docs/operations-checklist.md`、`docs/final-audit-report.md`

---

## 2026-08-07（17） — Task36: isPublishable()に再生成後の整合性チェックを追加

Task29の実運用監査で判明していた「承認済み（`review.status === "approved"`）のレポートを
同一slugで再生成しても、`review.json`の承認状態が自動的には無効化されない」という既知の制約
（Task34で残存課題の中の最優先項目と評価）に対応した。

### 主な内容

1. **`review-engine.js`の`isPublishable(review, evaluation)`を`isPublishable(review,
   evaluation, report)`に拡張**: `report.meta.generated_at`が`review.reviewed_at`より後
   （＝承認より後にreport.jsonが再生成された可能性がある）場合、`publishable: false`とし、
   `reasons`に理由を追加する。`report`は省略可能で、省略時はTask36以前と同じ2条件のみで
   判定する（既存呼び出し元との後方互換性）
2. **日時比較はDate.parse()による数値比較**: 文字列の辞書順比較ではタイムゾーン表記
   （`Z`/`+09:00`等）混在時に時系列を正しく判定できないため、`shared/date-utils.js`の
   既存関数`isValidIso8601()`で形式検証した上で`Date.parse()`により数値比較する
3. **不正な状態は安全側（`false`）に倒す**: `review.reviewed_at`が存在しない、または
   `generated_at`/`reviewed_at`のいずれかが不正な日時形式・`Date.parse()`で`NaN`になる場合は、
   比較不能として`publishable: false`とする（`NaN`同士の比較が常に`false`になるため、
   ナイーブな実装だと不正日時のときに誤って「新しくない」と判定してしまう問題を回避）
4. **同時刻は許可**: `generated_at === reviewed_at`は「後に再生成された」とは言えないため
   `publishable`の判定を妨げない
5. **呼び出し元6箇所を更新**: `publish-report.js`（1箇所）、`website/aor-admin/server.js`
   （4箇所）、`review/review-cli.js`（1箇所）で`report`を追加で渡すよう変更
6. **テスト7件を追加**（`test/review.test.js`）: generated_at>reviewed_at→false、
   generated_at<reviewed_at→true、同時刻→true、reviewed_at欠如→false、不正な日時文字列→
   false、reportを渡さない後方互換呼び出し→従来どおりtrue、の6パターン＋既存の正常系1件

### 変更していないもの

- `report.json`・`review.json`のJSON構造（フィールド追加・削除・改名は無し。既存フィールド
  `meta.generated_at`・`reviewed_at`の比較のみで実現）
- `schema_version 2.4`
- `website/aor`（受信者向けLP）
- `website/aor-admin/public/assets/js/list.js`（○/△/×表示ロジックは`publishable`真偽値を
  そのまま使う既存の分岐のままで、新しいfalseケースも自然にカバーするため変更不要と判断した）

### 変更ファイル（今回分）

- 更新: `scripts/generator/review/review-engine.js`、`scripts/generator/publish-report.js`、
  `website/aor-admin/server.js`、`scripts/generator/review/review-cli.js`、
  `scripts/generator/test/review.test.js`（テスト7件追加）、
  `scripts/generator/review/review-schema.md`、`scripts/generator/README.md`、
  `website/aor-admin/README.md`、`docs/final-audit-report.md`

---

## 2026-08-07（16） — Task32: `validate-report.js`のpublished_at必須validationを是正

Task30〜31で実施した実Tavily検索の実API検証により、mock providerでは検出されなかった
`validate-report.js`の設計矛盾が判明した: `source_pages[].published_at`を必須・ISO8601形式
としていたが、`tavily-provider.js`（`item.published_date || null`）・`normalize-sources.js`
（`raw.published_at || null`）は元々nullを許容しており、`score-sources.js`もpublished_atが
nullなら加点・減点をスキップするだけで、`quality-evaluator.js`は元々published_atを一切参照
していない。にもかかわらず`validate-report.js`だけが必須化していたため、Tavily実検索結果
（実測で`source_pages`の95%が`published_at`欠落）を使うと機械的検証が意味なくFAILし続ける
状態になっていた。schema_version 2.4の原設計（`docs/strategy_v2/`）にも`published_at`の
必須要件は無く、Task10（`docs/mock_data/CHANGELOG.md`）でも「schema_versionは2.4のまま
据え置き（追加のみ）」と明記されており、この必須化はTask9で`validate-report.js`が独自に
追加したものだった。**なお、`published_at`の欠落は`isPublishable()`・公開処理・Review
Dashboard UI・website/aor・quality-evaluator.jsのいずれにも実害を与えておらず、
CLI/APIレベルで実態と乖離した"FAIL"表示が出るだけの問題だったことを事前調査で確認済み**。

### 主な内容

1. **`validate-report.js`の修正（最小限）**: `source_pages[].published_at`を、
   「未設定/null → PASS」「値が存在する場合のみISO8601形式を検証（不正な形式はFAIL）」に変更。
   「取得できないこと」と「取得した日付が不正であること」を区別するようにした。
   `score`必須・ISO8601形式チェック自体・他の検証項目は変更していない
2. **schema_version 2.4は変更していない**（元々published_atはschema本体の必須要件ではなかった
   ため、schema上の変更は発生しない）
3. **`tavily-provider.js`・`normalize-sources.js`・`score-sources.js`・
   `quality-evaluator.js`・`publish-report.js`・website/aorは変更していない**
   （いずれも元々published_atのnullを許容または無関係な実装だったため、変更不要と判断した）
4. **テスト追加（`test/validator.test.js`、4件）**: 正常なISO8601 → PASS、`null` → PASS、
   フィールド自体が存在しない → PASS、不正な文字列 → FAIL、の4パターンを既存のテスト設計・
   命名規則に合わせて追加した
5. **実データでの再検証**: 新たなAPI呼び出しは行わず、Task30〜32で既に取得済みの実Tavily
   検索結果（`website/aor/data/example.com.json`、source_pages 20件中19件がpublished_at欠落）
   に対して修正後の`validateReport()`を実行し、published_atに起因するエラーが0件になった
   ことを確認した

### 変更ファイル（今回分）

- 更新: `scripts/generator/validate-report.js`（published_atのバリデーションロジック・
  ヘッダーコメント）、`scripts/generator/test/validator.test.js`（テスト4件追加）、
  `README.md`、`docs/final-audit-report.md`、`docs/real-provider-verification.md`

---

## 2026-08-07（15） — Task29: 本番運用準備・データライフサイクル・障害復旧の最終総点検

大規模な新機能追加ではなく、既存実装の総点検。コード変更は行っていない
（ドキュメント3件の新設・更新のみ）。

### 主な内容

1. **データライフサイクル監査**: `output/`・`review.json`・`website/aor/data/`・
   `logs/`配下5種のログ・`backup/`について、生成元・保存場所・バックアップ対象を
   実装と突き合わせて確認した。バックアップ漏れは無かった
2. **承認→公開→再公開の実機監査（Case A/B/C/D）**: 新規公開・内容更新後の再公開・
   差し戻し後の再承認再公開・連続二重公開のいずれも、`report.json`/`review.json`を
   壊さず安全に動作することをテストデータ（`e2e-task29-test.example.com`）で確認した。
   その過程で、同一slugの再生成では`review.json`の承認状態が自動的に無効化されない
   こと、差し戻しでも公開済みファイルは自動的に非公開にならないことを実測で確認し、
   運用上の注意点として文書化した（いずれも既存の設計方針の範囲内であり、
   バグではないと判断。コード変更はしていない）
3. **異常系監査（12種）**: report.json/review.jsonの欠如・不正JSON、公開データ欠如、
   不正slug、存在しない会社/job、二重実行、サーバー再起動、job実行中の異常終了からの
   復旧（`job-runtime-state.json`経由）、backup対象ファイル欠如を実機再現し、
   いずれもHTTPステータス・エラーメッセージが適切で、secret/internal pathの漏洩が
   無いことを確認した
4. **バックアップ・リストアドリル**: `backup.js`実行→対象ファイル削除→
   `scripts/generator/README.md`記載の手順のみでの復旧→MD5一致確認、まで実施した
5. **本番運用手順の整理**: 起動から公開・障害対応までの一連の流れが複数READMEに
   分散していたため、`docs/operations-checklist.md`に通し番号付きのE2Eランブック節・
   本番環境の前提条件まとめ（Node.jsバージョン・環境変数・ディレクトリ・配信方法等の
   一覧表）を新設した
6. **`website/aor/README.md`を新設**: これまで存在しなかった、受信者向けLPの配信方法
   ドキュメント（静的サイトのため、任意のHTTP配信手段で動作すること等を明記）。
   `website/aor`自体のUI・仕様・コードは変更していない
7. **メール回収フローの再確認**: Task27の設計レビュー・実装の一致を再確認し、
   齟齬が無いことを確認した（実装変更なし）

### 変更ファイル（今回分）

- 新規: `website/aor/README.md`
- 更新: `docs/operations-checklist.md`（前提条件まとめ・E2Eランブック節を追加）、
  `docs/final-audit-report.md`（D・E節に追記）、`.github/workflows/quality-check.yml`
  （コメント内の見出し参照の誤字修正のみ、CI挙動は変更なし）、
  `scripts/generator/CHANGELOG.md`（本ファイル）
- コード変更なし（`scripts/generator/`・`website/aor-admin/`・`website/aor/`の
  実装ファイルはいずれも無変更）

---

## 2026-08-07（14） — Task27: メール回収・顧客導線の本番化設計レビュー

実装ではなく設計レビュー。メール保存・送信機能は実装していない（厳守事項により
今回は禁止）。コード変更なし。

### 主な内容

1. **メール回収フローをコード・実測の両面から完全に再トレース**: `report-preview.html`
   のCTA→`email-capture.html`→`paid-preview.html`の3画面が`?company=<slug>`という
   URLクエリのみで状態を共有していること、入力したメールアドレスが
   `document.getElementById('success-email')`への一時的なDOM表示以外どこにも
   残らないことをコードレベルで確認した
2. **仮のメールアドレス（`e2e-test@example.com`、実在の個人アドレスは不使用）で
   実機漏洩確認**: Console/Network/localStorage/sessionStorage/Cookie/URL/DOM/
   `scripts/generator/logs/`/`backup/`/`website/aor/data/`のすべてで痕跡が
   無いことを確認した
3. **`docs/email-capture-design.md`を新設**: 本番化する場合に必要な最小限の
   データ項目、個人情報・同意設計上の確認事項（法律判断はせず「確認が必要な
   事項」として整理）、保存方式4案（自社サーバー/外部フォーム・CRM/メール配信
   サービス/現状維持）の比較、推奨方式（短期は現状維持、実LLM検証完了後は
   自社サーバー保存を推奨）、既存コードベースで再利用できる仕組み
   （`auth.js`の監査ログパターン・`shared/json-file.js`・`backup.js`の
   TARGETS配列等）、将来API化する際のセキュリティ要件をまとめた
4. **無料→有料導線のUXを再評価**（UI変更なし、記録のみ）: CTA文言の一貫性・
   「メール送信の約束」と実装の一致（免責文言により透明性が保たれていることを
   確認）・価格表示の曖昧さ・プライバシーポリシーリンクが未実装であることを記録した

### 変更ファイル（今回分）

- 新規: `docs/email-capture-design.md`
- 更新: `docs/final-audit-report.md`（D節に追記）, `README.md`（リポジトリルート）,
  `scripts/generator/CHANGELOG.md`（本ファイルのみ、コード変更なし）

---

## 2026-08-07（13） — Task26: 本番運用リハーサル・E2Eユーザーフロー最終検証

コード変更は行っていない（検証専用タスク。実LLM/実検索providerはAPIキー未準備のため
引き続き未検証・mock providerのみ使用）。見込み客視点（LP→メール登録→レポート閲覧）と
管理者視点（レビュー→承認→公開→LP反映）を、実際に新規テスト会社
（`e2e-test-company.example.com`、明確にテスト用と分かるslug）を1件生成して
最初から最後まで通し、Task24/25の実装に問題が無いことを実地で再確認した。

### 実施内容の要点

- E2Eフロー: 生成（mock）→ pending_review → コメント（絵文字含む）→ 修正指示 →
  差し戻し → 再レビュー → 承認 → 公開 → website/aorで実際に閲覧、を完走
- 公開のCase A/B/C/D（承認済み/未承認/evaluation FAIL/存在しないslug）を
  curlで実測し、いずれも設計どおりの挙動を確認
- 公開前後で`report.json`・`review.json`のハッシュが完全に一致することを確認
  （publishReport()が読み取り専用であることの実測による再確認）
- 新しいパストラバーサルpayload（`....//....//etc/passwd`のような「サンドイッチ」型を含む）
  でも、Task25で導入した許可リスト方式の`validateSlug()`が正しく拒否することを確認
- `backup.js`での実際のバックアップ→ファイル破壊→リストアのドリルを実施し、
  バイト単位で元通りに復元できることを確認
- 2タブでのSSEリアルタイム反映（Review Dashboard・Jobs Dashboard両方）を再確認
- ログ4種（計1000行超）・全JSON状態ファイルを走査し、破損・重複・secret漏洩が
  無いことを確認
- 自動テスト112件（変化なし、コード変更が無いため）がすべてPASSすることを確認

### 変更ファイル（今回分）

- 更新: `scripts/generator/CHANGELOG.md`（本ファイルのみ。コード変更なし）
- テスト用に生成・検証後残置: `scripts/generator/output/e2e-test-company.example.com/`,
  `website/aor/data/e2e-test-company.example.com.json`（公開フローの動作実例として、
  `example.com`と同様に残してある。既存サンプル（company-01〜03）・`example.com`は
  一切変更していない）

---

## 2026-08-07（12） — Task25: 本番公開前の最終セキュリティ・品質監査

Task8〜Task24の実装全体を対象にした最終監査。新機能追加ではなく、検証と
軽微な修正（発見したセキュリティ問題の是正）のみを行った。実LLM/実検索provider
のAPIキー取得・実API検証は本タスクでも行っていない。

### 主な変更

1. **パストラバーサル脆弱性を発見・修正**: `publish-report.js`（Task24）の`slug`引数に
   検証が無く、バックスラッシュを含むslugでOUTPUT_DIR・`website/aor/data/`の外側を
   指しうることを発見。HTTP経由では実際には成立しない（Node標準URLパーサがドット
   セグメントを正規化するため）ことを実測したが、CLI引数経由では無防備だったため
   修正した。同じ脆弱パターンが**Task14から存在していた**`server.js`の
   `loadCompany()`にも同じ対策を適用した
2. **`scripts/generator/shared/path-safety.js`を新設**: `validateSlug()`・
   `isWithinDir()`を`publish-report.js`と`server.js`の両方から共通で使えるよう
   切り出した（重複実装を避けるため）
3. **`backup.js`に`website/aor/data/`を追加**: Task24で公開機能が書き込むように
   なったにも関わらず、それまでバックアップ対象から漏れていたことを発見し追加した
4. **`publish-report.js`に上書き検知の警告ログを追加**: 手動サンプルデータとの
   偶然の衝突・意図的な再公開のいずれの場合も`WARN`ログを出す（ブロックはしない）
5. **`publish-report.test.js`にセキュリティ回帰テストを6件追加**（計112テスト、
   Task24時点106 → 112）
6. **全APIエンドポイントの認証・認可を再点検**: 未認証401・CSRF403が全POSTルートに
   一貫して適用されていること、内部エラー情報が漏洩しないことを再確認した
7. **secret漏洩の実地確認**: `website/aor/`配下・`scripts/generator/logs/`
   （計899行）を全件走査し、secret混入0件を確認。`redact.js`が実際のログ蓄積
   （`security.test.js`が注入した偽の秘密情報10件）で確実に`[REDACTED]`へ
   置き換えていることを確認した
8. **`docs/final-audit-report.md`を新設**: 実装済み機能・セキュリティ・品質・
   未検証事項・公開前必須事項をまとめ、最終判定「条件付きGO」（実LLM/実検索
   provider検証完了までは内部確認用途に限定）を示した

### 変更ファイル（今回分）

- 新規: `scripts/generator/shared/path-safety.js`, `docs/final-audit-report.md`
- 更新: `scripts/generator/publish-report.js`, `website/aor-admin/server.js`,
  `scripts/generator/backup.js`, `scripts/generator/test/publish-report.test.js`,
  `scripts/generator/README.md`, `README.md`（リポジトリルート）,
  `docs/pre-launch-rehearsal.md`, `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（11） — Task24: 承認済みレポートの公開導線設計・実装

Task23（本番リハーサル）で発見した★★★★★課題（「承認」から「公開」への導線が
存在しない）への対応。`scripts/generator/output/<slug>/report.json`と
`website/aor/data/<slug>.json`はschema_version 2.4で構造が完全に一致しているため、
変換は行わずそのままコピーする方式で解消した。既存CLI・report.json/review.jsonの
スキーマ・jobs構造（既存4種のデータモデル）・website/aorの3画面の仕様はいずれも
変更していない。

### 主な変更

1. **`scripts/generator/publish-report.js`を新設**: `publishReport(slug)`が
   唯一のロジック実体。検討した3方式（A: 明示的な公開操作、B: Job Runnerへ
   publish job type追加、C: 承認と同時に自動公開）のうちAを採用した
   （理由: Bは公開が決定的なローカルファイルI/Oでリトライ機構の恩恵がない、
   Cはreview-engine.jsの「Pure Function・副作用なし」方針を崩し、承認と公開の
   タイミングを分離できなくなるため）。CLI（`node scripts/generator/publish-report.js
   <slug>`）と`website/aor-admin/server.js`の両方から同じ関数を呼ぶことで
   重複実装を避けている
2. **公開可否判定は`review-engine.js`の`isPublishable()`をそのまま再利用**:
   独自の判定ロジックは作らず、未承認・evaluation.status===FAILのいずれかで
   公開を拒否する。`report.json`・`review.json`はいずれも読み取り専用で、
   `publish-report.test.js`で実際に内容が変更されないことをバイト単位で確認した
3. **`website/aor-admin/server.js`に`POST /api/publish/:id`を追加**:
   成功・失敗いずれも`admin-audit.jsonl`へ`action:"publish"`として記録する
   （公開者=user、公開日時=at、対象slug=targetが既存の`logAudit()`の仕組みで
   自動的に記録される）。`/api/report/:id`・`/api/reports`のレスポンスに
   `published`（真偽値）を追加した
4. **Review DashboardのUIに公開導線を追加**: 詳細画面に「website/aorへの公開」欄と
   「公開する」/「再公開する」ボタン（`publishable`でない間は無効化）、
   一覧画面に「公開」列（●/—）を追加した
5. **`scripts/generator/test/publish-report.test.js`を新設**（7テスト）:
   未承認拒否・needs_revision拒否・evaluation FAIL拒否・公開成功時の内容一致・
   report.json/review.json非改変・存在しないslugのエラー処理・`isPublished()`の
   状態遷移を確認。計106テスト（Task23時点99 → 106）
6. **実機確認**: Review Dashboardで実際に承認→公開操作を行い、
   `website/aor/data/example.com.json`が生成されることを確認。Python静的サーバー
   （port 8123）で`report-preview.html`・`email-capture.html`・`paid-preview.html`の
   3画面すべてを実際に開き、公開されたデータが正しく表示され、Console Error/
   Network Errorが0件であることを確認した

### 変更ファイル（今回分）

- 新規: `scripts/generator/publish-report.js`, `scripts/generator/test/publish-report.test.js`
- 更新: `website/aor-admin/server.js`, `website/aor-admin/public/assets/js/{api.js, detail.js, list.js}`,
  `scripts/generator/run-all-tests.js`（COVERAGE_MAP更新）,
  `scripts/generator/README.md`, `website/aor-admin/README.md`,
  `docs/pre-launch-rehearsal.md`（★★★★★課題を解決済みとして追記）,
  `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（10） — Task23（本番リハーサル）: LP・ダッシュボード・メール回収・公開フロー総合検証

※ タスク番号が前回の「Task23: 運用完成度向上」と重複しているが、ユーザー側の指示書での
番号付けをそのまま踏襲した別タスクである。

新機能追加ではなく、実際の利用者・運営者視点でシステム全体を最初から最後まで操作し、
UI/UX・導線・運用フローを総点検するレビュー専用タスク。実LLM/実検索providerは今回も
未使用（mock providerのみ）。コード変更は行っていない（レビュー・記録が主目的のため）。
詳細な確認結果・発見事項は[docs/pre-launch-rehearsal.md](../../docs/pre-launch-rehearsal.md)を参照。

### 主な内容

1. **LP（website/aor/）総点検**: `report-preview.html`/`email-capture.html`/
   `paid-preview.html`をデスクトップ・タブレット・モバイル（375px）の3サイズ×3社分の
   サンプルデータで確認。Console Error/Warning・レイアウト崩れ（横方向オーバーフロー）は
   いずれも0件
2. **メールアドレス回収フローの検証**: 正常系・異常系（不正形式・空欄・日本語・292文字）の
   入力テストに加え、送信データ・`localStorage`/`sessionStorage`を実際に確認し、
   **フォーム送信が完全に静的（ネットワーク送信なし、ストレージ保存なし）であることを
   実証した**（`website/aor/assets/js/email-capture.js`のコードレビューと、ブラウザでの
   実測の両方で確認）
3. **Review Dashboard・Jobs Dashboardの実操作確認**: 承認・却下・差し戻し・コメント・
   修正指示・retry等を実際に実行し、2ブラウザタブでのSSEリアルタイム反映も確認
4. **★★★★★の重大な発見**: `scripts/generator/output/<slug>/report.json`と
   `website/aor/data/<slug>.json`はスキーマ構造（schema_version 2.4）が完全に一致するにも
   関わらず、両者を繋ぐ「公開」の仕組み（コピー・デプロイ等）がリポジトリ全体に存在しない
   ことを発見。Review Dashboardで承認しても、実際に受信者がレポートを閲覧できるようには
   ならない、という導線の断絶を記録した（対応は次タスクへ持ち越し。理由は
   pre-launch-rehearsal.md参照）
5. その他、優先度付きのUX観察事項（★4〜★1）を記録（詳細は同ドキュメント参照）

### 変更ファイル（今回分）

- 新規: `docs/pre-launch-rehearsal.md`
- 更新: `README.md`（リポジトリルート）, `scripts/generator/README.md`（「Task19以降との関係」に
  最重要事項を追記）, `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（9） — Task23: 運用完成度向上（エラーハンドリング・可観測性・運用品質改善）

実API（LLM/Search provider）検証はAPIキー未準備のため見送り、API非依存の運用安定性・
保守性を高めるフェーズ。既存CLI・report.json（schema_version 2.4）・review.json・
jobs構造・website/aorはいずれも変更していない。review-engine.js・job-engine.jsの
既存設計思想（Pure Function中心・薄いアダプタ）も維持している。

### 主な変更

1. **CLIのエラーハンドリングを`shared/cli-utils.js`の`runCli()`へ統一**:
   `validate-report.js`・`quality-evaluator.js`・`review/review-cli.js`・
   `jobs/job-cli.js`・`check-config.js`・`check-docs.js`・`run-all-tests.js`を統一した
   （従来は`process.exit()`直書き・独自の`main().catch(...)`・トップレベルcatch無し等、
   ファイルごとに方式が異なっていた）。`runCli()`自体にAOR_DEBUG時のみstack trace表示を追加。
   `generate-company-report.js`に残っていた唯一の`process.exit(2)`も`exitCode`方式に統一
2. **`website/aor-admin/server.js`の汎用500ハンドラを修正**: 想定外の例外（fsエラー等、
   絶対パスを含みうる）を拾う箇所は、レスポンスを汎用メッセージのみに変更し、詳細は
   サーバー側ログにのみ出力するようにした（内部パスをレスポンスボディに含めないため。
   想定内のバリデーションエラー・400応答は引き続きerr.messageをそのまま返す、既存方針を維持）
3. **`scripts/generator/shared/redact.js`を新設**: 永続ログ（`job-history.jsonl`の`error`・
   `admin-audit.jsonl`の`detail`）へ書き込む前に、既知のAPIキーパターン
   （`sk-...`/`tvly-...`/`Authorization: Bearer ...`/`XXX_API_KEY=...`）を`[REDACTED]`に
   置き換える構造的な保険。ジョブの`error`フィールド自体（メモリ内・APIレスポンス）は
   認証済み管理者向けのデバッグ情報としてredactしない
4. **Job Runnerの起動時復旧を追加**: `jobs/job-runner.js`に
   `scripts/generator/logs/job-runtime-state.json`（現在実行中のジョブのみを記録する
   小さな別ファイル、`job-history.jsonl`とは別物）を新設し、サーバー起動時に
   `recoverInterruptedJobs()`を呼んで、前回終了時に実行中だったジョブがあれば
   `job-history.jsonl`へ`status:"interrupted"`の記録を残す。**jobオブジェクトの構造・
   キューの状態遷移は変更していない**。自動的なqueuedへの復帰・自動リトライは行わない
5. **`GET /api/health`の`checks`を拡張**: `filesystem`を`output_dir`/`logs_dir`に分割し、
   `config`（LLM_PROVIDER側の設定不備のみを見る。SEARCH_PROVIDER側はwarn扱いのため含めない）
   を追加した。APIキーの値は引き続き一切含めない
6. **Dashboard操作性を改善**（`website/aor-admin/public/`）: 一覧画面でevaluation.status=FAIL
   の行を背景色で強調、詳細画面に「最終更新」（reviewed_atだけでなくcomments/fixes/history
   の最新時刻も反映）とcomments/fixes/history各件数を追加、Jobs画面に実行時間列を追加
7. **`scripts/generator/test/error-handling.test.js`・`security.test.js`を新設**:
   config-validator.js・redact.js・job-runnerの起動時復旧・runCli()のテスト
   （error-handling.test.js、18テスト）、secretがjob-history.jsonlに残らないことの統合
   テスト・server.jsの未認証401/認証済み200/CSRF拒否のテスト（security.test.js、3テスト）。
   計99テスト（Task22時点78 → 99）。`run-all-tests.js`のCOVERAGE_MAPも更新した
8. **README更新**: エラーハンドリング統一方針・障害時対応フロー・起動時復旧・
   redactSecrets()の適用範囲・Health API拡張の判定ルール・Dashboard UI変更点を
   scripts/generator/README.md・website/aor-admin/README.md・docs/operations-checklist.md
   に追記した

### 変更ファイル（今回分）

- 新規: `scripts/generator/shared/redact.js`, `scripts/generator/test/error-handling.test.js`,
  `scripts/generator/test/security.test.js`
- 更新: `scripts/generator/shared/cli-utils.js`, `scripts/generator/generate-company-report.js`,
  `scripts/generator/validate-report.js`, `scripts/generator/quality-evaluator.js`,
  `scripts/generator/review/review-cli.js`, `scripts/generator/jobs/job-cli.js`,
  `scripts/generator/jobs/job-runner.js`, `scripts/generator/check-config.js`,
  `scripts/generator/check-docs.js`, `scripts/generator/run-all-tests.js`,
  `website/aor-admin/server.js`, `website/aor-admin/auth.js`,
  `website/aor-admin/public/assets/js/{list.js, detail.js, jobs.js}`,
  `website/aor-admin/public/assets/css/admin.css`,
  `scripts/generator/README.md`, `website/aor-admin/README.md`, `docs/operations-checklist.md`,
  `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（8） — Task22: バックアップ・リストア基盤整備と運用ドキュメント検証

障害時に戻せる仕組みとドキュメント・実装の一致確認を整備するフェーズ。新規の分析ロジック
追加ではなく、既存の`shared/paths.js`・`config-validator.js`（Task21）等を再利用した基盤整備。
既存CLI・report.json（schema_version 2.4）・review.json・jobs構造・website/aorはいずれも
変更していない。

### 主な変更

1. **`scripts/generator/backup.js`を新設**: Node標準`fs`のみでディレクトリコピー方式の
   バックアップを取得するCLI。必須対象は`scripts/generator/output/`・`scripts/generator/logs/`
   （欠けているとエラー停止）、推奨対象は`website/aor-admin/`・`docs/`・`.github/workflows/`
   （欠けていれば警告のみでスキップ）。出力先は`<repo root>/backup/<タイムスタンプ>/`。
   コピー元は一切変更せず、実行のたび新しいタイムスタンプディレクトリを作るため既存の
   バックアップも上書きしない。secret値を含みうるファイルの中身自体はログへ出力しない
2. **`shared/paths.js`に`REPO_ROOT`を追加**: `backup.js`がscripts/generator外
   （website/aor-admin/・docs/等）を扱う必要があるため。既存の`GENERATOR_DIR`等の
   定義・エクスポート形は変更していない
3. **バックアップ・リストア手順をREADMEに文書化**: 取得コマンド・対象範囲・
   リストア手順（サーバー停止推奨・復元後の確認コマンド）を記載。実際に
   `backup.js`を実行し、生成されたバックアップから1ファイルを意図的に削除→復元し、
   復元後のファイルが元と完全一致（バイナリ比較）することを確認した
4. **README整合性監査を実施**: `scripts/generator/README.md`・
   `website/aor-admin/README.md`・`scripts/generator/jobs/README.md`・
   `scripts/generator/review/review-schema.md`・`docs/operations-checklist.md`の
   CLIコマンド・APIパス・環境変数・ファイルパス・schema説明・status値・provider名を
   実装と突き合わせて確認。意味のある差分は見つからなかった
5. **`scripts/generator/check-docs.js`を新設**: README整合性監査のうち機械的に検証できる
   範囲（コマンド例のファイルパス実在性、環境変数表の名前が実際にコード中で
   参照されているか）を恒久化した簡易チェックCLI。過剰実装を避けるため、
   API仕様の意味的な正しさ等はスコープ外とした
6. **`run-all-tests.js`にConfiguration Check結果を追加**: `config-validator.js`の
   `checkAll()`結果を`quality-report.md`の「Configuration Check」セクションへ
   **参考情報として**記載する。CI環境ではADMIN_USER等を設定しない前提のため、
   **総合結果（PASS/FAIL）の判定には一切使用しない**（`allOk`の計算式は変更していない。
   ADMIN_USER未設定の環境で実行しても「総合結果: PASS」になることを確認済み）

### 変更ファイル（今回分）

- 新規: `scripts/generator/backup.js`, `scripts/generator/check-docs.js`
- 更新: `scripts/generator/shared/paths.js`, `scripts/generator/run-all-tests.js`,
  `scripts/generator/README.md`, `docs/operations-checklist.md`,
  `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（7） — Task21: 本番運用準備（設定検証・ヘルスチェック・運用基盤整備）

設定ミスによる起動失敗防止・サービス状態確認・運用ログ確認を整備するフェーズ。
新規の分析ロジックの追加ではなく、既存のprovider抽象化（llm-client.js/search-client.js）
・review-engine.js・job-runner.js等をそのまま再利用した運用基盤整備。既存CLI・
report.json（schema_version 2.4）・review.json・jobs構造・website/aorはいずれも変更していない。

### 主な変更

1. **`scripts/generator/shared/config-validator.js`を新設**: ADMIN_USER/ADMIN_PASSWORD・
   LLM_PROVIDER・SEARCH_PROVIDERの設定状況を検証する共通モジュール。providerごとに
   必要なAPIキー名をハードコードせず、`llm-client.js`/`search-client.js`が既に持つ
   provider抽象化（`resolveProviderId()`/`getProvider(id)`/`requiresApiKey`/
   `isConfigured()`）をそのまま再利用している。secret値はログ・メッセージに一切含めない
2. **`scripts/generator/check-config.js`を新設**: 設定チェック単体CLI。
   全項目OKで`Configuration check passed`（終了コード0）、エラーがあれば
   `Configuration check failed`（終了コード1）。SEARCH_PROVIDERのAPIキー未設定はwarn扱いで
   ブロックしない（`search-client.js`の既存フォールバック挙動と整合させるため）
3. **`generate-company-report.js`のCLI（`main()`のみ）に起動前チェックを追加**:
   fetch/LLM呼び出しの前にLLM/SEARCH設定を検証し、不備があれば早期に停止する
   （ライブラリとして呼ぶ`generateCompanyReport()`関数自体は変更していない。
   テスト・他モジュールからの呼び出しに影響なし）
4. **`website/aor-admin/auth.js`の`checkRequiredEnv()`をリファクタリング**:
   環境変数の存在チェック自体を`config-validator.js`の`checkRequiredVars()`に委譲
   （Review Dashboard固有の案内文言はauth.js側に残し、判定ロジックの重複を解消。
   戻り値の形・挙動は変更なし）
5. **`website/aor-admin/server.js`に`GET /api/health`を追加**: 認証不要（外部監視ツール向け）。
   `{status, uptime, version, checks:{auth, jobs, filesystem}}`を返す。secret値は含まない。
   起動時にLLM/SEARCH設定の参考情報もログ表示するようにした（ADMIN_USER/ADMIN_PASSWORDの
   既存の起動ブロッキングチェックとは異なり、こちらは非ブロッキング。理由はREADME参照）
6. **Dashboard（`index.html`・`jobs.html`）に状態表示バーを追加**: 新設した
   `public/assets/js/status.js`が`/api/health`を15秒間隔でポーリングし、
   「Server: OK/Degraded」「Job Runner: OK/Degraded」「最終確認: 時刻」を表示する
7. **`scripts/generator/logs/`配下4ファイルの用途・PII/secret非保存方針・バックアップ
   推奨をREADMEに整理**（`llm-usage.jsonl`/`search-usage.jsonl`/`admin-audit.jsonl`/
   `job-history.jsonl`）
8. **`docs/operations-checklist.md`を新設**: 本番運用チェックリスト（デプロイ前・運用中・
   既知の制約）。リポジトリルート`README.md`からリンクした

### 変更ファイル（今回分）

- 新規: `scripts/generator/shared/config-validator.js`, `scripts/generator/check-config.js`,
  `website/aor-admin/public/assets/js/status.js`, `docs/operations-checklist.md`
- 更新: `scripts/generator/generate-company-report.js`, `website/aor-admin/auth.js`,
  `website/aor-admin/server.js`, `website/aor-admin/public/{index.html, jobs.html}`,
  `website/aor-admin/public/assets/css/admin.css`,
  `README.md`（リポジトリルート）, `scripts/generator/README.md`,
  `website/aor-admin/README.md`, `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-07（6） — Task19: CI/CD準備（GitHub Actions設定ファイル整備）

Task18で整備した`run-all-tests.js`を、実際にGitHub Actions上で実行できるようにする
フェーズ。新規のCI・機能追加ではなく、既存の品質ゲートをCIに接続するための整備。
既存CLI・report.json（schema_version 2.4）・review.json・jobs構造はいずれも変更していない。

### 主な変更

1. **`.github/workflows/quality-check.yml`を新設**: push・pull_request（全ブランチ対象）・
   workflow_dispatchで`ubuntu-latest`上で`node scripts/generator/run-all-tests.js`を実行し、
   終了コードでジョブの成否を判定する。`package.json`が存在しない（npm依存なし設計）ため、
   `npm install`ステップは意図的に省略している
2. **CIのNode.jsバージョンをメジャー24に固定**: ローカル開発で使用しているv24.18.0との
   環境差を最小化するため、`actions/setup-node@v4`で`node-version: "24"`を指定
   （パッチ/マイナーは自動追従）
3. **`generator.test.js`のネットワーク依存テストを「方式C」で扱うよう修正**:
   `https://example.com`への実HTTP取得を伴うテスト（唯一の実ネットワークI/Oテスト）は、
   CIでも引き続き実行するが、その失敗単体では全体のPASS/FAIL判定をブロックしない扱いに
   変更した。新設した`test/network-test-names.js`（`NETWORK_TEST_NAME`定数のみを持つ、
   実行副作用のないファイル）を`generator.test.js`と`run-all-tests.js`の両方から参照し、
   `run-all-tests.js`側で`blockingFailedNames`（全体判定に影響）と`networkFailedNames`
   （quality-report.mdに記録するが全体判定には影響しない）を分離するロジックを追加した
4. **`generator.test.js`の3件目のテストを1件目から独立させた**: 従来は1件目
   （実HTTP取得）が生成したreport.jsonを3件目が読み直す設計だったため、1件目が失敗すると
   3件目も連鎖的に失敗していた。3件目は`fixtures/good.json`を直接検証する形に変更し、
   1件目の成否と無関係に独立実行できるようにした
5. **`quality-report.md`をGitHub Actionsのアーティファクトとして保存**:
   `actions/upload-artifact@v4`を`if: always()`付きで実行し、`run-all-tests.js`が
   FAILした場合でもレポートを取得できるようにした
6. **リポジトリルートの`README.md`にCIステータスバッジを追加**: `git remote -v`で確認した
   実リポジトリ`KScopeResearch/changescout`の情報のみを使用（情報が確認できない場合は
   追加しない方針だったが、実在を確認できたため追加した）
7. **README更新**: `scripts/generator/README.md`に「CI/CD」節を新設し、npm installを
   省略する理由・Node.jsバージョン選定理由・方式C（ネットワーク依存テストの非ブロッキング化）
   の詳細・アーティファクト保存設定を明記した

### 変更ファイル（今回分）

- 新規: `.github/workflows/quality-check.yml`, `scripts/generator/test/network-test-names.js`
- 更新: `scripts/generator/test/generator.test.js`, `scripts/generator/run-all-tests.js`,
  `README.md`（リポジトリルート）, `scripts/generator/README.md`,
  `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-06（5） — Task18: リファクタリング・テスト強化・CI準備フェーズ（Phase1 Quality Gate）

機能追加ではなく品質保証・保守性向上・テスト基盤整備を目的としたフェーズ。既存CLI・
report.json（schema_version 2.4）・review.json・jobs構造はいずれも変更していない。

### 主な変更

1. **`scripts/generator/shared/`を新設**: `logger.js`（DEBUG/INFO/WARN/ERROR）・
   `json-file.js`（JSON読み書き）・`retry.js`（retry+timeout）・`paths.js`
   （OUTPUT_DIR/LOGS_DIR/PROMPTS_DIR等）・`date-utils.js`（ISO8601）・`cli-utils.js`
   （process.exit()回避パターン）。llm-client.js・search-client.js・validate-report.js・
   quality-evaluator.js・generate-company-report.js・review-engine.js・job-engine.js・
   job-runner.js・website/aor-admin/{server.js, auth.js}をこれらを使うようリファクタリングした
   （重複コードの削除。エラーメッセージ・CLI出力・挙動は維持）
2. **ディレクトリの物理的な再配置は行わなかった**（判断理由はREADME「共通ユーティリティ」参照。
   `require()`パス20箇所以上の書き換えリスクが「既存CLIとの互換性維持」要件に見合わないため）
3. **`scripts/generator/test/`を新設**: Node標準`node:test`のみを使用（npm依存なし）。
   `validator.test.js`・`quality.test.js`・`review.test.js`・`jobs.test.js`・`search.test.js`・
   `llm.test.js`・`generator.test.js`・`shared.test.js`の8ファイル、計78テスト
4. **`search.test.js`にTask12で発見・修正したdeduplicate-sources.jsのバグ
   （短い会社名が長い検索結果タイトルに偶然含まれて誤統合される問題）の回帰テストを追加**
5. **`run-all-tests.js`を追加**: 1コマンドでValidator/Review/Jobs/Generator/Search/LLM(Mock)の
   全自動テストとDashboard起動確認（未認証401・認証済み200・API疎通）を実行し、
   `quality-report.md`（テスト数・PASS・FAIL・実行時間・カバレッジ概算・注意事項）を生成する
6. **README新ルール**: 「新しい機能追加前にはrun-all-tests.jsを実行する」を明記

### 変更ファイル（今回分）

- 新規: `scripts/generator/shared/{logger,json-file,retry,paths,date-utils,cli-utils}.js`,
  `scripts/generator/test/{validator,quality,review,jobs,search,llm,generator,shared}.test.js`,
  `scripts/generator/run-all-tests.js`, `scripts/generator/quality-report.md`（実行のたび生成）
- 更新: `scripts/generator/{llm/llm-client.js, search/search-client.js, validate-report.js,
  quality-evaluator.js, generate-company-report.js, review/review-engine.js,
  jobs/job-engine.js, jobs/job-runner.js}`,
  `website/aor-admin/{server.js, auth.js}`,
  `scripts/generator/README.md`, `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-06（4） — Task16: Job Runner / Scheduler（自動実行ジョブ基盤）を追加

AI Opportunity Reportを「毎日自動生成できる」状態にするため、`scripts/generator/jobs/`に
ジョブ実行基盤（メモリキュー・指数バックオフでのリトライ・`setInterval()`スケジューラ・
実行履歴）を追加した。既存パイプライン（`generate-company-report.js`・
`quality-evaluator.js`・`validate-report.js`・`company-context.js`・`review-engine.js`）は
再実装せず、既存CLIも壊さずにJob経由で呼べるよう最小限リファクタリングした。

### 主な変更

1. **`scripts/generator/jobs/`を新設**: `job-store.js`（インメモリレジストリ）・
   `job-engine.js`（4種類のjob typeハンドラ）・`job-runner.js`（キュー処理・リトライ・
   スケジューラ・履歴記録）・`job-cli.js`（CLI）
2. **`generate-company-report.js`をリファクタリング**: 中核処理を`generateCompanyReport()`
   として`module.exports`し、`require.main === module`ガードを追加した。
   `node generate-company-report.js <url>`のCLI出力は完全に同一のまま維持している
3. **Job種類（最低対応4種類）**: `generate-report`（フルパイプライン）・
   `quality-check`（品質再評価のみ）・`review-sync`（ダミー実装、Task14の
   「同期しない」決定に整合）・`search-refresh`（情報収集のみ再実行）
4. **Retry: 指数バックオフ1秒→2秒→4秒、最大3回**（初回+リトライ3回＝最大4回試行）
5. **Scheduler: `setInterval()`のみで実装**（cronライブラリ不使用）。
   `JOB_SCHEDULER_ENABLED=true`で明示的に有効化しない限り自動起動しない
   （誤起動での意図しない全社再生成を防ぐため）
6. **`scripts/generator/logs/job-history.jsonl`を追加**: 開始・終了・実行時間・成功失敗・
   エラー・リトライ回数を記録
7. **`website/aor-admin/`にJobs画面を追加**: 一覧・追加・retry・cancel、SSEによる自動更新
8. **アーキテクチャ上の判断**: ジョブキューはメモリのみで永続化しないため、`job-cli.js`は
   `website/aor-admin/server.js`（常駐プロセス）のJobs APIを呼ぶHTTPクライアントとして
   実装した（詳細は`jobs/README.md`「アーキテクチャ上の判断」参照）

### 変更ファイル（今回分）

- 新規: `scripts/generator/jobs/{job-store.js, job-engine.js, job-runner.js, job-cli.js, README.md}`
- 更新: `scripts/generator/generate-company-report.js`（リファクタリングのみ、CLI出力は不変）,
  `website/aor-admin/server.js`（Jobs API・Jobs SSE・スケジューラ起動を追加）,
  `website/aor-admin/public/{index.html, detail.html}`（Jobsへのナビゲーションリンク追加）,
  `website/aor-admin/public/assets/js/api.js`（Jobs API呼び出し追加）,
  `website/aor-admin/README.md`, `scripts/generator/README.md`,
  `scripts/generator/CHANGELOG.md`（本ファイル）
- 新規（website/aor-admin/）: `public/jobs.html`, `public/assets/js/jobs.js`

---

## 2026-08-06（3） — Task15: Review Dashboardに認証・セッション・監査ログを追加

`website/aor-admin/`（Task14）を「社内で利用できる最低限安全なツール」まで強化した。
`website/aor-admin/`以外は変更していない（`review-engine.js`・`review.json`・
`report.json`のschema_version 2.4はいずれも無変更）。

### 主な変更

1. **`website/aor-admin/auth.js`を新設**: Basic認証 → セッションCookie（メモリ保持、
   Node標準`crypto`でトークン生成）・ログアウト・CSRF検証・監査ログ・セキュリティヘッダを集約
2. **全ルートを認証必須化**: HTML/CSS/JS/API/SSE、`/logout`以外のすべてのリクエストが
   認証済みセッションを要求する
3. **`reviewer`/`actor`の手入力欄をUIから廃止**: 認証済みセッションのusernameを
   サーバー側で使う設計に変更（クライアント指定の名前は一切信用しない）
4. **監査ログ`scripts/generator/logs/admin-audit.jsonl`を追加**: ログイン成功/失敗・
   ログアウト・CSRF失敗・レビュー操作（成功/失敗）を`{at, user, ip, action, target,
   success, detail}`形式で記録
5. **`ADMIN_USER`/`ADMIN_PASSWORD`未設定時は起動拒否**: 認証なしでの誤起動を構造的に防止
6. **CSRF対策（Synchronizer Token）**: `GET /api/session`でトークン配布、全POSTで
   `X-CSRF-Token`ヘッダーを検証
7. **セキュリティヘッダ**: `X-Frame-Options`・`X-Content-Type-Options`・
   `Referrer-Policy`・`Cache-Control`を全レスポンスに付与

### 変更ファイル（今回分）

- 新規: `website/aor-admin/auth.js`
- 更新: `website/aor-admin/server.js`,
  `website/aor-admin/public/{index.html, detail.html}`,
  `website/aor-admin/public/assets/js/{api.js, list.js, detail.js}`,
  `website/aor-admin/README.md`,
  `scripts/generator/README.md`, `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-06（2） — Task14: Review Dashboard（website/aor-admin/）を追加

Task13の`review-engine.js`をそのまま使う、ブラウザベースの管理画面を追加した。
`review-engine.js`・`review.json`のスキーマ・`report.json`（schema_version 2.4）は
いずれも変更していない。

### 主な変更

1. **`website/aor-admin/`を新設**: `server.js`（Node標準httpのみ、新規npm依存なし）・
   `public/{index.html, detail.html}`・`public/assets/{css,js}`
2. **API構成**: `GET /api/reports`（一覧）・`GET /api/report/:id`（詳細）・
   `GET /api/status/:id`・`GET /api/events`（SSE）・`POST /api/{comment,fix,approve,reject,revise}/:id`。
   すべて`scripts/generator/review/review-engine.js`のPure Functionを呼ぶのみで、
   状態遷移ロジックの重複実装はしていない
3. **SSEによる自動更新**: `fs.watch(scripts/generator/output/, {recursive:true})`で
   変更を検知し、接続中の全クライアントへ一覧を再送する。Dashboard外
   （`review-cli.js`をターミナルから直接実行した場合等）での変更も反映されることを確認済み
4. **publishable表示の○/△/×**: `isPublishable()`の戻り値（真偽値）をそのまま使い、
   `review.status`と組み合わせて3アイコンに分類する表示ロジックのみをUI側に追加した
   （判定ロジック自体の再実装ではない）
5. **`review.json`↔`report.json.human_review`の同期方針を最終決定**: 「同期しない」。
   理由は`review/review-schema.md`「同期方針の最終決定（Task14）」を参照

### 変更ファイル（今回分）

- 新規: `website/aor-admin/{server.js, README.md}`,
  `website/aor-admin/public/{index.html, detail.html}`,
  `website/aor-admin/public/assets/css/admin.css`,
  `website/aor-admin/public/assets/js/{api.js, list.js, detail.js}`
- 更新: `scripts/generator/README.md`, `scripts/generator/review/review-schema.md`,
  `scripts/generator/CHANGELOG.md`（本ファイル）

---

## 2026-08-06 — Task13: 人間レビューworkflow（review-engine.js）を追加

AI生成レポート（`report.json`）を人間が承認・却下・差し戻しできる、JSONベース・DB不要・
CLI完結のレビューworkflowを追加した。既存のTask8〜12のパイプライン・スキーマは変更していない。

### 主な変更

1. **`scripts/generator/review/`を新設**: `review-engine.js`（Pure Function中心の状態遷移
   ロジック）・`review-cli.js`（CLIフロントエンド）・`review-schema.md`（review.jsonの
   スキーマ定義）
2. **`review.json`を`report.json`とは別ファイルとして新設**: `scripts/generator/output/<slug>/`
   配下に`report.json`と並べて保存する。`report.json`の`schema_version 2.4`は変更していない
   （既存の`human_review`埋め込みフィールドとは意図的に非同期。理由は`review-schema.md`参照）
3. **statusの4状態**: `pending_review` / `approved` / `needs_revision` / `rejected`
   （`report.json`側の`human_review.status`にはない`rejected`を追加）
4. **`isPublishable(review, evaluation)`を追加**: `review.status === "approved"` かつ
   `evaluation.status !== "FAIL"`の両方を満たす場合のみ配信可能と判定する
5. **`validate-report.js`に`validateReview(review)`を追加**: review.jsonの形状検証
   （validateReport()とは独立した関数）
6. **`review/fixtures/`を新設**: `pending.json` / `approved.json` / `needs_revision.json` /
   `rejected.json`（いずれも実際のreview-engine.jsの関数で生成し、内容の捏造なし）

### 変更ファイル（今回分）

- 新規: `scripts/generator/review/{review-engine.js, review-cli.js, review-schema.md}`,
  `scripts/generator/review/fixtures/{pending,approved,needs_revision,rejected}.json`,
  `scripts/generator/CHANGELOG.md`（本ファイル）
- 更新: `scripts/generator/validate-report.js`（`validateReview()`追加）,
  `scripts/generator/README.md`（人間レビューworkflowの節を新設）,
  `docs/strategy_v2/05_ai_pipeline.md`（1段落追記）

---

## 2026-08-06（Task12以前）

Task8〜Task12の変更履歴は、当時CHANGELOG.mdが存在しなかったため本ファイルには記録していない。
詳細は各機能の実装時点のコミット相当の変更内容として`README.md`本文中の
「Task◯で追加」「Task◯で更新」等の記述、および会話履歴を参照。Task13以降の変更は
本ファイルに記録する。
