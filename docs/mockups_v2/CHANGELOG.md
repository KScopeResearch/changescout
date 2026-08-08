# CHANGELOG（docs/mockups_v2）

## 2026-08-06 — Phase5.1品質改善: priority_matrixのデータ重複解消

Phase5でのHTML実装完了後、品質改善のみを目的にデータ構造を整理した（機能・仕様変更なし）。
対応する戦略ドキュメント・モックデータの変更は[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md)を参照。

### 変更内容

- `04_paid_report.md`: 優先順位マトリクスの説明を`opportunity_ids`＋`Map`解決方式に更新

### 変更ファイル（今回分）

- 更新: `04_paid_report.md`

---

## 2026-08-05（5）— paid_analysisの最終確定（Phase1最終、HTML実装前の最後の設計変更）

HTML実装開始後にスキーマ変更が発生しない状態にすることを目的に、`paid_analysis`を最終確定した。
対応する戦略ドキュメント・モックデータの変更は[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md)を参照。

### 変更内容

- `04_paid_report.md`: 「表示内容」「画面構成」「計測」「必要データ」に`decision_summary`
  （意思決定サマリー、画面最上部に配置）を追加。`priority_matrix`の説明を`items[]`方式に更新
- `03_email_capture.md`・`04_paid_report.md`: `registration_bonus`を`extended_analysis`へ改名

### 変更ファイル（今回分）

- 更新: `03_email_capture.md`, `04_paid_report.md`

---

## 2026-08-05（4）— 有料版のデータ構造を確定（paid_analysis）

HTML実装前の最後の設計として、有料版（paid-preview）が表示する情報を`paid_analysis`として固定した。
対応する戦略ドキュメント・モックデータの変更は [../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `04_paid_report.md`: 「表示内容」「画面構成」「必要データ」「Phase4以降」を`paid_analysis`の
  5フィールド（追加Opportunity一覧・優先順位マトリクス・90日実行ロードマップ・実行支援メニュー・
  継続監視テーマ）を軸に全面改訂。従来「サンプル1件のみ完全表示、残りは有料プランで」としていた
  Phase1提供範囲を、`paid_analysis`全体の静的描画に拡張

### ⚠️ 既存HTMLへの影響（破壊的変更、継続）

`website/aor/paid-preview.js`は旧`paid_preview_opportunity`・`opportunities_open`・
`opportunities_locked`を前提に「無料版Opportunityの続きを見せる」実装になっており、
v2.2では`data.paid_analysis`の5フィールドを描画する実装へ**画面構成そのものの作り直し**が必要になる。
詳細は[../mock_data/README.md](../mock_data/README.md)を参照。

### 変更ファイル（今回分）

- 更新: `04_paid_report.md`

---

## 2026-08-05（3）— 登録直後の体験を再設計（registration_bonus）

無料版を「1件深掘り方式」に変更したことに伴い、メール登録直後の価値提供を再設計した。
対応する戦略ドキュメント・モックデータの変更は [../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `02_report_preview.md`: CTA周りの文言を「登録すると1件を無条件で開放」から
  「登録すると、このOpportunityの市場規模・競合状況・リスクまで踏み込んだ追加分析が見られます」
  に修正。新しいOpportunityが開放されるという誤解を招く表現を排除
- `03_email_capture.md`: 「登録後の流れ」を全面改訂。見出しを「登録ありがとうございます」ではなく
  「追加分析を公開しました」とし、`free_opportunity.registration_bonus`をその場で表示する体験に変更
- `04_paid_report.md`: 位置づけ・目的・表示内容・画面構成を全面改訂。「無料版Opportunityの続きを
  見せる画面」から「追加Opportunity分析・優先順位付け・根拠資料一覧・実行支援という新しい価値を
  見せる画面」に役割を再定義

### ⚠️ 既存HTMLへの影響（破壊的変更、継続）

`website/aor/email-capture.js`の成功画面ロジックは、旧`paid_preview_opportunity`
（新しいOpportunity1件の即時開放）を前提に作られており、v2.1では**表示するデータの意味そのもの**が
変わる（同じOpportunityの追加分析を表示する体験への作り直しが必要）。単純なフィールド名の
置き換えでは対応できない。詳細は[../mock_data/README.md](../mock_data/README.md)を参照。

### 変更ファイル（今回分）

- 更新: `02_report_preview.md`, `03_email_capture.md`, `04_paid_report.md`

---

## 2026-08-05（2）— 情報源拡張＋無料版1件深掘り化

実際の経営者・事業責任者が「自社向けに考えられた分析」と感じられる品質へ近づけるための設計変更。
対応する戦略ドキュメント・モックデータの変更は [../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md) を参照。

### 変更内容

- `02_report_preview.md`: 画面構成を「関連度『高』の市場変化を最大3件カード表示」から
  「深掘りOpportunity1件（why_now/why_company/market_change/evidence/first_action）＋
  さらに検討可能なテーマ（タイトルのみのロック表示）」へ全面改訂。参照元の開示に
  source_type（company/government/industry_association/statistics/news/technology）を反映

### ⚠️ 既存HTMLへの影響（破壊的変更）

本改訂と[../mock_data/CHANGELOG.md](../mock_data/CHANGELOG.md)のスキーマv2.0化により、
`website/aor/`配下の既存3画面（report-preview.html / email-capture.html / paid-preview.html）は
旧フィールド（`opportunities_open` / `opportunities_locked` / `paid_preview_opportunity`）を
参照しているため、そのままでは正しく動作しない。HTML側の追従対応は本コミットのスコープ外。

### 変更ファイル（今回分）

- 更新: `02_report_preview.md`

---

## 2026-08-05 — Phase1 MVP仕様確定（レビュー反映）

実装前レビュー（8観点レビュー、TOP20改善提案）を受けて、以下を修正した。
対応する`docs/strategy_v2/`側の変更は [../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md) を参照。

### 1. セルフサーブ即時生成フォームの廃止

- `01_lp.md`: 一次CTA「無料でレポートを受け取る（会社ドメイン入力の即時生成フォーム）」を削除し、
  「サービスについて相談する」（問い合わせ・資料請求、人間対応前提）に変更
- 理由: 即時生成はHuman in the Loop原則（未レビューのまま配信するか、レビュー待ちで結局即時で
  なくなるか）と構造的に両立しないため

### 2. Human in the Loop前提の統一

- `02_report_preview.md`: 「このレポートは送信前に人間が内容を確認しています」をヘッダー帯に追加
  （従来01のFAQにしかなかった）
- `01_lp.md`: セルフサーブ廃止の経緯を明記し、原則からの逸脱を許さない設計であることを記録

### 3. 無料版→有料版への導線強化

- `03_email_capture.md`: 登録後の「有料版の一部プレビュー」を「ロック中Opportunity1件の完全開放」に具体化
- `03_email_capture.md`: 登録から数分以内の自動フォローメール送信を追加（人的フォロー待ちの空白期間を解消）
- `04_paid_report.md`: 有料プランCTAに目安価格を明示、無料版/有料版比較表を01_lpへ移設

### 4. ロックされたOpportunityの追加

- `02_report_preview.md`: 関連度「中」の市場変化をタイトルのみロック表示するセクションを新設
- `03_email_capture.md`: 登録直後にロック中1件を無条件開放する導線を明記

### 5. Opportunity Scoreの変更

- `02_report_preview.md`: 「総合スコア0〜100のゲージ表示」を廃止し、関連度バッジ（高/中）＋
  一言理由に統一。数値の信頼度スコアは社内利用（05_admin_review）に限定

### 6. 計測仕様の追加

- 新規ファイル `07_measurement.md` を追加。画面別イベント定義、KPI対応表を新設
- `README.md`にファイル一覧・Phase対応表の該当行を追加

### 7. 信頼性表示の追加

- `02_report_preview.md`: 「参照元の開示」セクションを新設（ミラー効果、実際に参照した自社ページ種別を明示）
- `03_email_capture.md`: フォーム直近に個人情報の取り扱いに関する明記を追加

### 8. Phase2機能の分離

- `04_paid_report.md`: 競合比較・営業メール案・提案資料たたき台をPhase2以降に明示的に分離し、
  Phase1では「ご相談ください」導線（人的対応）に置き換え
- `05_admin_review.md`: 既定表示を「チェックリスト＋最終ドラフト」のみとし、
  パイプライン全ステップ表示を異常時のみの展開表示に変更
- `06_dashboard_future.md`: 冒頭に「Phase1のHTML実装スコープには含まない」の明記を追加
- `README.md`: Phase対応表を更新し、各画面のPhase1/Phase2境界を明確化

### 変更ファイル

- 更新: `01_lp.md`, `02_report_preview.md`, `03_email_capture.md`, `04_paid_report.md`,
  `05_admin_review.md`, `06_dashboard_future.md`, `README.md`
- 新規: `07_measurement.md`, `CHANGELOG.md`（本ファイル）
