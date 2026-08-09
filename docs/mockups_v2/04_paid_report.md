# 04_paid_report.md — 有料版レポート画面

対応する設計書: [08_paid_report.md](../strategy_v2/08_paid_report.md) / [09_pricing.md](../strategy_v2/09_pricing.md) / [05_ai_pipeline.md](../strategy_v2/05_ai_pipeline.md) / [11_sales_process.md](../strategy_v2/11_sales_process.md)

## 位置づけ

登録直後の追加分析（[03_email_capture.md](03_email_capture.md)の`extended_analysis`）の先に
用意された、有料プランの本編プレビュー画面。無料版・登録特典が「1件のOpportunityを深く理解する」
体験であるのに対し、有料版は**視野を広げ、実行に移すための材料を揃える**ことで差別化する
（[08_paid_report.md](../strategy_v2/08_paid_report.md)「有料版で提供する価値」）。

**注**: この画面は無料版Opportunityの「続き」を見せる場ではない。同じOpportunityの深掘りは
登録特典（追加分析）で既に完結している。この画面は**新しい価値**（追加Opportunity分析・
優先順位付け・根拠資料一覧・実行支援）を提示する場である。また、無料版と有料版の機能比較
（何が違うか）は、この画面ではなく[01_lp.md](01_lp.md)の料金セクションに掲載する。

## 目的

「これ1件だけでなく、他にも考えるべきことがあり、それを実行に移すための材料も揃っている」と
感じてもらい、有料プラン契約へつなげること。

## 誰が使うか

- [03_email_capture.md](03_email_capture.md)で登録し、追加分析（`extended_analysis`）まで見た担当者
- 有料プラン契約済みの担当者（フル閲覧）

## ユーザー心理

無料版・登録特典を通じて、1件のOpportunityについては十分な納得を得ている段階。
ここでの関心は「他にも機会はあるのか」「どこから手をつければいいのか」という
視野の広さ・実行可能性に移る。

## CTA

- 未契約者向け: 「有料プランに申し込む（月額◯円〜）」「営業担当に相談する」
  — **目安価格をボタン文言に含める**。価格不明のまま検討させないため（[09_pricing.md](../strategy_v2/09_pricing.md)）
- 契約者向け: 「このOpportunityをお気に入りに追加」（[06_dashboard_future.md](06_dashboard_future.md)への布石）

## 表示内容（改訂: `paid_analysis`構造に対応）

[08_paid_report.md](../strategy_v2/08_paid_report.md)「`paid_analysis`のデータ構造」に対応する。
`free_opportunity`とは別の、有料版専用データ（`paid_analysis`）をそのまま画面に落とし込む。

### Phase1で提供する内容（すべて`paid_analysis`から静的に描画）

1. **意思決定サマリー**（`decision_summary`、**画面最上部に配置**）: 推奨する打ち手・着手時期・
   期待効果・投資規模の目安・理由を、下記2〜6を読まなくても分かる形で先頭に集約する
2. **追加Opportunity分析**（`additional_opportunities`、2〜4件）: タイトル・概要・期待効果・
   関連度をカード形式で一覧表示する。無料版ほどの深さ（why_now等）は持たせない、軽量な提示
3. **優先順位マトリクス**（`priority_matrix`）: 効果×工数の2×4象限で`additional_opportunities`を
   分類表示する（図ではなくJSONデータをもとにHTML側で可視化する。各象限は`opportunity_ids`
   （id配列）のみを持ち、`additional_opportunities`から構築した`Map`で解決して描画する。
   タイトル・期待効果を象限データ側に複製しない、[08_paid_report.md](../strategy_v2/08_paid_report.md)
   「`priority_matrix`」参照）
4. **90日実行ロードマップ**（`roadmap`）: 30日／60日／90日の3ブロックで「やること」「期待成果」を提示する。
   無料版の`first_action`をday_30の起点として引き継いで見せる
5. **実行支援メニュー**（`execution_support`）: 追加調査・営業資料作成・提案書レビュー・市場調査等の
   一覧を提示し、各項目から「ご相談ください」導線につなげる
6. **継続監視テーマ**（`monitoring`）: 法改正・補助金・競合動向・業界ニュース等、今後注視すべき
   テーマの一覧を提示する（Phase1では静的表示。実際のアラート配信はPhase2以降）
7. **有料プラン申込みCTA（目安価格付き）＋「ご相談ください」導線**

### Phase2以降に分離する内容

- **実行支援・継続監視の自動化**: `execution_support`・`monitoring`は静的な一覧だが、
  実際の対応（追加調査の実施、アラート配信）はPhase1では人手（[11_sales_process.md](../strategy_v2/11_sales_process.md)）・
  UI外で行う。自動化は[06_dashboard_future.md](06_dashboard_future.md)、Phase2以降
- **`roadmap`の動的な再生成**: Phase1はAIドラフト＋人間レビューによる静的な構造化ドラフト。
  状況変化に応じた自動更新はPhase2以降
- **根拠資料一覧の自動集約**: 無料版・登録特典・追加Opportunity分析の全evidenceを横断的に
  集約する機能はPhase1では簡易的な一覧表示に留める

## 画面構成

1. ヘッダー: 「〇〇株式会社 様 向け 詳細レポート」、更新日時
2. **意思決定サマリー**（`decision_summary`、画面最上部）
3. 追加Opportunity一覧（`additional_opportunities`、カード形式）
4. 優先順位マトリクス（`priority_matrix`、2×4象限の可視化）
5. 90日実行ロードマップ（`roadmap`、30/60/90日の3ブロック）
6. 実行支援メニュー（`execution_support`一覧）＋「ご相談ください」導線
7. 継続監視テーマ（`monitoring`一覧）
8. CTA（有料プラン申込み、目安価格付き）
9. フッター

## 計測（Phase1で必須）

- 有料版画面到達、`decision_summary`の閲覧（画面最上部のため、ほぼ全員が到達する想定。
  その先へのスクロール率と比較することで「サマリーだけで離脱したか」を把握する）
- `additional_opportunities`各カードの閲覧
- `priority_matrix`・`roadmap`の表示到達（スクロール完読の代理指標）
- `upgrade_cta_click`（有料プラン申込みボタン）
- `consult_cta_click`（「ご相談ください」導線、`execution_support`のどの項目から発生したかも記録） —
  実需シグナルとして計測し、Phase2機能化の優先順位判断に使う（[07_measurement.md](07_measurement.md)）

## 必要データ

- `paid_analysis`（`decision_summary` / `additional_opportunities` / `priority_matrix` / `roadmap` / `execution_support` / `monitoring`）
- [06_human_review.md](../strategy_v2/06_human_review.md)でのレビュー結果
- Standardプランの目安価格（[09_pricing.md](../strategy_v2/09_pricing.md)）

## 今はダミーで良い部分

- 「ご相談ください」導線の先（実際の営業対応フローそのものはUIの外、[11_sales_process.md](../strategy_v2/11_sales_process.md)で運用）
- `priority_matrix`の算出ロジック（Phase1では人間が最終決定してよい。表示のみ先に固める）
- `monitoring`の実際のアラート配信（画面上に一覧は表示するが、実際の通知配信は
  [06_dashboard_future.md](06_dashboard_future.md)側で扱う、Phase2以降）

## Phase4以降（現ロードマップのPhase3より先）

- `additional_opportunities`の完全な深掘り分析への自動拡張（why_now/why_company/evidence付き）
- `roadmap`の状況変化に応じた自動再生成
- PowerPoint/Wordファイルとしての自動書き出し・ダウンロード
- CRMへのワンクリック取り込み連携
