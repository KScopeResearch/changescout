# CHANGELOG（docs/strategy_v2）

## 2026-08-06 — Phase5.1品質改善: priority_matrixのデータ重複解消

Phase5でのHTML実装完了後、品質改善のみを目的にデータ構造を整理した（機能・仕様変更なし）。
対応する画面仕様・モックデータの変更は[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md)を参照。

### 変更内容

- `08_paid_report.md`: `priority_matrix`の説明を、v2.3の`items[]`埋め込み方式（データ重複あり）から、
  v2.4の`opportunity_ids`参照＋`additional_opportunities`からの`Map`構築方式に更新

### 変更ファイル（今回分）

- 更新: `08_paid_report.md`

---

## 2026-08-05（5）— paid_analysisの最終確定（Phase1最終、HTML実装前の最後の設計変更）

HTML実装開始後にスキーマ変更が発生しない状態にすることを目的に、`paid_analysis`を最終確定した。
対応する画面仕様・モックデータの変更は[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md)を参照。

### 変更内容

- `08_paid_report.md`: `paid_analysis`の先頭に`decision_summary`（recommendation/
  recommended_timing/expected_impact/investment_level/reason[]）を新設。「有料版で提供する価値」表に
  「意思決定サマリー」行を追加。`priority_matrix`のデータ構造を`opportunity_ids`参照方式から
  `items[]`埋め込み方式に変更（HTML描画時の突き合わせ処理を不要にするため）
- `07_free_report.md`・`08_paid_report.md`: `registration_bonus`を`extended_analysis`へ改名
  （「登録の見返り」ではなく「同じOpportunityの理解を広げる分析」であることを名称に反映）

### 変更ファイル（今回分）

- 更新: `07_free_report.md`, `08_paid_report.md`

---

## 2026-08-05（4）— 有料版のデータ構造を確定（paid_analysis）

HTML実装前の最後の設計として、有料版（paid-preview）が表示する情報を`paid_analysis`として固定した。
対応する画面仕様・モックデータの変更は [../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `08_paid_report.md`: 「有料版で提供する価値」表に`paid_analysis`フィールドとの対応列を追加。
  90日アクションプラン・実行ロードマップ等をPhase2の相談ベース対応からPhase1提供可能へ格上げ。
  新規セクション「`paid_analysis`のデータ構造」を追加し、`additional_opportunities` /
  `priority_matrix` / `roadmap` / `execution_support` / `monitoring`の5フィールドを定義

### 変更ファイル（今回分）

- 更新: `08_paid_report.md`

---

## 2026-08-05（3）— 登録直後の体験を再設計（registration_bonus）

無料版を「1件深掘り方式」に変更したことに伴い、メール登録直後の価値提供を再設計した。
対応する画面仕様・モックデータの変更は [../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `07_free_report.md`: 「価値の積み上げ設計（発見→理解を深める→実行に移す）」を新設し、
  無料版・登録・有料版の役割を明確化。「有料版へのブリッジ設計（ロック要素）」を
  「登録直後の体験（追加分析）」に置き換え、`registration_bonus`（market_size/competition/
  risks/priority/case_examples/confidence_note）を定義。「登録直後に新しいOpportunityを
  1件開放する」という旧設計は明示的に不採用とした
- `08_paid_report.md`: 差別化ポイント表に「登録特典」列を追加。「有料版で提供する価値」を新設し、
  追加Opportunity分析・優先順位付け・根拠資料一覧・90日アクションプラン・実行ロードマップ・
  継続モニタリング・相談対応の7項目とPhase1での扱いを整理。「無料版からの即時ブリッジ」を
  「登録特典との関係」に置き換え

### 変更ファイル（今回分）

- 更新: `07_free_report.md`, `08_paid_report.md`

---

## 2026-08-05（2）— 情報源拡張＋無料版1件深掘り化

実際の経営者・事業責任者が「自社向けに考えられた分析」と感じられる品質へ近づけるための設計変更。
対応する画面仕様・モックデータの変更は [../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `04_company_analysis.md`: 「情報ソースの優先順位（拡張版）」を新設。一次情報／業界情報／
  大手ニュース・専門メディアの3階層と、情報源の利用条件（出典表示・推測と事実の区別・
  ニュース単独を根拠にしない・有料記事本文の無断利用禁止）を明記。「参照元の開示」に
  `source_type`/`source_role`の2軸分類を追加
- `07_free_report.md`: 構成案を「関連度の高い市場変化を1〜3件並べる」方式から
  「最も関連性の高いOpportunity1件を深掘りする」方式に全面改訂。`why_now`/`why_company`/
  `market_change`/`evidence`/`first_action`の構造を導入。「有料版へのブリッジ設計」も
  ロック要素を「詳細データ付きだが非表示」から「タイトルのみで根拠自体を持たない」に変更
- `05_ai_pipeline.md`: ③市場変化抽出に「ニュース記事単独を根拠にしない」原則を明記。
  ⑤Opportunity生成を「関連度が最も高い1件のみ深掘り」に変更、⑥Action生成の出力を
  `first_action`として明確化

### 変更ファイル（今回分）

- 更新: `04_company_analysis.md`, `05_ai_pipeline.md`, `07_free_report.md`

---

## 2026-08-05 — Phase1 MVP仕様確定（レビュー反映）

`docs/mockups_v2/`の画面設計レビュー結果を、戦略ドキュメント側にも反映した。
画面レベルの変更詳細は [../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md) を参照。

### 変更内容

- `06_human_review.md`: 「適用範囲の原則（例外を作らない）」を新設。
  将来的なセルフサーブ等の即時チャネルであってもHuman in the Loopの例外を作らないことを明記し、
  セルフサーブ即時生成フォームを却下した判断の根拠として記録
- `07_free_report.md`: 「有料版へのブリッジ設計（ロック要素）」「信頼性の明示（Human in the Loop表示）」を新設。
  構成案にロックされた追加Opportunityと信頼性表示の項目を追加
- `08_paid_report.md`: 「Phase1における提供範囲（Phase2機能の分離）」「無料版からの即時ブリッジ」を新設。
  競合比較・営業メール案・提案資料たたき台をPhase2以降に明示的に分離
- `09_pricing.md`: 価格設計における注意点に、ペイウォール付近での目安価格の早期提示を追加
- `05_ai_pipeline.md`: 信頼度スコアの設計方針に、対外表示（定性バッジ）と内部指標（数値）の
  使い分けを明記
- `04_company_analysis.md`: 「参照元の開示（信頼性設計）」を新設。ミラー効果による信頼構築の方針を追加
- `02_user_journey.md`: 「計測仕様」セクションを新設し、`docs/mockups_v2/07_measurement.md`への
  参照を追加
- `00_readme.md`: 更新履歴セクションを追加し、本CHANGELOGへの導線を追加

### 変更ファイル

- 更新: `00_readme.md`, `02_user_journey.md`, `04_company_analysis.md`, `05_ai_pipeline.md`,
  `06_human_review.md`, `07_free_report.md`, `08_paid_report.md`, `09_pricing.md`
- 新規: `CHANGELOG.md`（本ファイル）
