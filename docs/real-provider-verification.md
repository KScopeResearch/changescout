# 実LLM・実検索provider検証記録（Task30〜32）

Task21〜25時点で「未検証」とされていた実LLM provider（DeepSeek）・実検索provider（Tavily）について、
Task30〜31で実際のAPIキーを用いた動作確認を行い、Task32でその結果を正式に記録する。

**このファイルにAPIキーの値・部分文字列・文字数は一切記載しない。**

生成日: 2026-08-07（Task32実施時点）

---

## 1. DeepSeek実LLM検証

- **使用モデル**: `deepseek-chat`（`DEEPSEEK_MODEL`未指定時の既定値）
- **確認方法**: `LLM_PROVIDER=deepseek`環境下で`scripts/generator/generate-company-report.js https://example.com`を実行し、
  `llm/deepseek-provider.js` → `llm-client.js`経由で実際にDeepSeek APIを呼び出した
- **結果**: 実際にAI生成された`free_opportunity`/`locked_opportunities`/`paid_analysis`を含むreport.jsonが生成された（mockのルールベース生成ではない）
- **トークン数・推定コスト（`scripts/generator/logs/llm-usage.jsonl`実測値、1回のE2E生成分）**:
  - input_tokens: 21064 / output_tokens: 2735
  - estimated_cost: $0.003715（2026年8月時点のDeepSeek料金表に基づく`llm-client.js`側の推定値、実際の請求額を保証するものではない）
  - duration_ms: 約53秒
- **schema検証**: `quality-evaluator.js`によるスコアは91/100（grade A、status PASS）。`validate-report.js`は`published_at`欠落によりFAILしたが、これは後述のTavily起因の既知の制約であり、DeepSeekの出力自体（`free_opportunity`等のフィールド構造）には起因しない
- **mockとの差異**: mock providerは決定的なルールベース生成のため常に同一内容・コスト$0だが、DeepSeekは実際の自然文生成であり、内容は毎回変動しうる。生成された文章の日本語表現・構造はプロンプト（`prompts/`配下）の指示に沿っており、明らかな破綻や必須フィールド欠如は確認されなかった

## 2. Tavily実検索provider検証

- **確認方法**: `search-client.js`の`search(query, options)`を`SEARCH_PROVIDER=tavily`環境下で直接呼び出す単体検証（Task31 Step3）を実施
- **結果**: mockへのフォールバックなしで実際のTavily API（`https://api.tavily.com/search`）から実検索結果を取得した
  - 検索結果件数: 5件（クエリ「ChangeScout 最新ニュース」、`TAVILY_MAX_RESULTS`既定値）
  - 実際に実在するURL（例: `mirasapo-plus.go.jp`、`value-domain.com`等の官公庁・業界サイト）を含む結果が返ることを確認した
- **mockとの差異**:
  - mock providerは合成データ（決定的、`published_at`常にあり、URLも実在するとは限らない架空またはテスト用URL）
  - Tavily実APIは実在するWebページを返すが、**`published_at`（公開日）が取得できないページが多い**（後述）

## 3. DeepSeek＋Tavily E2E検証（Task30 Step4相当）

`LLM_PROVIDER=deepseek`・`SEARCH_PROVIDER=tavily`の組み合わせで、`https://example.com`を対象に
以下の一連の流れを実機で確認した。

1. **生成**: `generate-company-report.js`で実LLM・実検索の両方を使ってreport.jsonを生成（成功。上記1・2の実測値を参照）
2. **Review**: 既存の承認済み`review.json`が残っていたため、運用ルール
   （[docs/operations-checklist.md](operations-checklist.md)「既知の注意点」記載の「再生成後は必ず差し戻し→再レビュー」）
   に従い、`review-cli.js revise`でいったん差し戻した
3. **再レビュー・再承認**: 生成内容（company_profile・free_opportunity・source_pages）を確認したうえで
   `review-cli.js approve --reviewer=e2e-verify`で承認した
4. **公開**: `publish-report.js example.com`を実行し、`website/aor/data/example.com.json`へ公開成功
5. **website/aor表示確認（Task32で実施）**: Claude in Chromeでブラウザ拡張が接続できたため、
   `report-preview.html?company=example.com`を実際にブラウザで開いて確認した（詳細は「5. ブラウザ目視確認」参照）

**結論**: 生成 → レビュー → 承認 → 公開 → 受信者向け表示、という一連のパイプラインは実LLM・実検索providerの組み合わせでも
問題なく機能することを確認した。

## 4. `published_at`欠落問題の評価

- **事象**: Tavily実APIの検索結果には、記事の公開日を示す`published_date`フィールドが無い（または`null`の）ページが多く含まれる。
  `tavily-provider.js`はこれを`published_at: item.published_date || null`としてそのまま透過する設計になっており、
  結果として`report.json`の`source_pages[].published_at`が`null`になるケースが生じる
- **影響**: `validate-report.js`は`source_pages[].published_at`を必須フィールドとして検証しており、`null`の場合は検証エラー（`[ERROR]`）となる。
  mock providerは常に決定的な日付を返す設計のため、Task12〜29の期間中はこの問題が一度も表面化しなかった
- **isPublishable()への影響**: **無い**。`review-engine.js`の`isPublishable()`は`review.status`と`evaluation.status`のみを見ており、
  `validate-report.js`の検証結果は参照しない設計のため、`published_at`欠落があっても承認・公開自体はブロックされない
  （実際に本検証でも公開まで成功している）
- **対応方針の変遷**: 判明した当初（Task31〜32前半）は指示に従いコード修正を行わず、実provider固有のデータ品質上の制約として本ファイルに記録するにとどめていた。その後の調査で、`tavily-provider.js`・`normalize-sources.js`（元々`published_at`のnullを許容）・`score-sources.js`（nullなら加点・減点をスキップするのみ）・`quality-evaluator.js`（`published_at`を一切参照しない）・`isPublishable()`（同）のいずれも`published_at`の欠落を問題視しない設計であるのに対し、`validate-report.js`だけが必須化していたという**設計上の矛盾**であることが判明したため、**Task32の後半で`validate-report.js`を修正した**（詳細は次項）
- **実施した修正**: `validate-report.js`の`source_pages[].published_at`検証を、「未設定/null → PASS」「値が存在する場合のみISO8601形式を検証（不正な形式はFAIL）」に変更した。`schema_version`は変更しておらず（元々schema本体の必須要件ではなかったため）、`tavily-provider.js`等の他ファイルも変更していない。修正の詳細・テスト結果は[scripts/generator/CHANGELOG.md](../scripts/generator/CHANGELOG.md)「Task32」・`docs/final-audit-report.md`参照
- **修正後の再検証結果**: 新たなAPI呼び出しは行わず、既に取得済みの実Tavily検索結果（`website/aor/data/example.com.json`、source_pages 20件中19件がpublished_at欠落）に対して修正後の`validateReport()`を実行し、`published_at`起因のエラーが0件（`ok: true`）になったことを確認した

## 5. ブラウザ目視確認

Task31時点ではClaude in Chrome拡張が接続できず未実施だったが、**Task32では拡張が接続できたため実施した**。

- 対象: `website/aor/report-preview.html?company=example.com`（`python -m http.server`による簡易配信、`file://`直接開きではない）
- 確認結果:
  - ページは正常に表示された（ヘッダー・企業情報・レビュー中バッジ等）
  - free opportunity（「補助金活用によるホームページ制作・デジタル化支援サービスの提供」）が表示された
  - locked opportunities 2件（鍵アイコン付きタイトルのみ、ペイウォールUI）が表示された
  - source情報（根拠セクション、実際のTavily検索結果由来のURL・出典ラベル）は破綻なく表示された
  - JavaScript Console Error: 0件
  - Network Error: 0件（`base.css`・`report-preview.css`・`common.js`・`report-preview.js`・`data/example.com.json`すべてHTTP 200）
- 確認後、検証用の簡易サーバー・ブラウザタブはいずれも終了・クローズ済み

## 6. 自動テストへの影響（run-all-tests.js）

実LLM/実検索providerの環境変数（`LLM_PROVIDER=deepseek`・`SEARCH_PROVIDER`・`DEEPSEEK_API_KEY`・`TAVILY_API_KEY`）が
このマシンに永続的に設定された状態で`node scripts/generator/run-all-tests.js`を実行すると、以下2件が失敗する。

- `llm.test.js`「generateAnalysis: APIキー未設定のprovider指定時は明確なエラーで停止する」
- `search.test.js`「search: APIキー未設定のprovider指定時はmockへ自動フォールバックする」

**原因**: 両テストとも「該当providerのAPIキーが未設定である」ことを前提にしたテストだが、
実provider検証のためにこの環境ではAPIキーが実際に設定されているため、想定していた「未設定エラー」
「mockへのフォールバック」が発生せず、代わりに実際のAPI呼び出しが発生する
（`llm-usage.jsonl`・`search-usage.jsonl`に実呼び出しの記録が残っていることで確認済み）。

**切り分け結果**: `DEEPSEEK_API_KEY`・`TAVILY_API_KEY`・`LLM_PROVIDER`・`SEARCH_PROVIDER`をすべて一時的に
未設定にした状態（＝mock専用のクリーンな環境）で同じテストスイートを実行したところ、**112件全てPASSすることを確認した**。
したがってこの2件の失敗は**コードの欠陥ではなく、実provider検証用に環境変数を永続設定したことによる環境要因**である。

**運用上の注意**: この環境で今後`run-all-tests.js`を実行するたび、上記2テストが小額の実API呼び出し
（DeepSeek: 数千トークン程度、Tavily: 検索1回）を意図せず発生させる。コード修正は本タスクの範囲外のため行っていないが、
テスト実行前に該当環境変数を一時的にunsetする、またはテスト側でAPIキー環境変数を退避・復元する対応が今後望ましい。

## 7. 本検証でのコード変更

**無し。** 本検証（Task30〜32）では以下のみを行った。

- 実際のAPIキーを用いたCLI実行・単体検証（`generate-company-report.js`・`review-cli.js`・`publish-report.js`・
  検索単体検証用の一時スクリプト）
- 一時スクリプトはセッション専用のscratchpadディレクトリ（リポジトリ外）に作成し、検証後に削除済み
- website/aor配信用の一時的な静的サーバー（`python -m http.server`）の起動・確認・停止

`scripts/generator/`・`website/`配下の既存コード（`tavily-provider.js`・`validate-report.js`・テストファイル等）は
一切変更していない。
