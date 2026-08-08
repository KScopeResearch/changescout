# 07_measurement.md — 計測仕様

対応する設計書: [02_user_journey.md](../strategy_v2/02_user_journey.md) / [16_validation_plan.md](../strategy_v2/16_validation_plan.md)

## 位置づけ

レビューで指摘された通り、計測機構がなければ[16_validation_plan.md](../strategy_v2/16_validation_plan.md)の
仮説検証そのものが成立しない。本ドキュメントは、Phase1のHTML実装に**必須スコープとして含めるべき**
計測イベントを定義する。実装ツール（アクセス解析サービス等）の選定はここでは扱わず、
「何を・どの画面で・何のために計測するか」の仕様のみを定める。

## 計測対象KPIと画面の対応

[02_user_journey.md](../strategy_v2/02_user_journey.md)の「ジャーニー上のKPI仮説」に対応させる。

| KPI | 対応画面 | 主要イベント |
|---|---|---|
| 開封率・クリック率 | メール（画面外） | メール開封トラッキング、リンククリック |
| 滞在時間・スクロール完読率 | [02_report_preview.md](02_report_preview.md) | ページ到達、セクション到達、滞在時間 |
| レポート閲覧→登録の転換率 | 02 → [03_email_capture.md](03_email_capture.md) | CTAクリック、フォーム送信成功 |
| 有料転換率 | [04_paid_report.md](04_paid_report.md) | 有料プランCTAクリック、相談導線クリック |
| 紹介経由リード数 | メール（画面外） | 流入経路パラメータ |

## 画面別イベント定義

### 02_report_preview（無料レポート）

- `report_view`: ページ到達（会社ID、流入経路を含む）
- `section_view`: 各セクション（参照元開示／開放済みOpportunity／ロック中Opportunity）への到達
- `locked_opportunity_view`: ロック中Opportunityセクションが画面に表示されたか
- `cta_click`（一次/二次を区別）

### 03_email_capture（登録）

- `form_view`: フォーム表示
- `optional_fields_expand`: 任意項目トグルを開いたか
- `form_submit_success` / `form_submit_error`
- `unlock_content_view`: 登録直後に開放されたOpportunityの閲覧

### 04_paid_report（有料版）

- `paid_report_view`
- `upgrade_cta_click`: 有料プラン申込みボタンのクリック
- `consult_cta_click`: 「ご相談ください」導線のクリック（競合比較・営業メール案・提案資料たたき台への
  需要シグナルとして計測し、Phase2機能化の優先順位判断に使う）

### 05_admin_review（社内、参考値として）

- `review_duration`: 1件あたりのレビュー所要時間（[06_human_review.md](../strategy_v2/06_human_review.md)の
  SLA5〜10分の実測検証に使う）
- `review_result`: 承認/差し戻し/破棄の内訳

## Phase1での実装方針

- 高度なBIツールは不要。一般的なWebアクセス解析ツール相当でページビュー・イベント計測ができれば十分
- 個人を特定する形でのトラッキングは行わない。会社ID・流入経路・イベント種別の
  組み合わせで集計できれば足りる（[14_risk.md](../strategy_v2/14_risk.md)の個人情報保護方針と整合させる）
- 週次オペレーション（[12_operations.md](../strategy_v2/12_operations.md)）でこれらの指標を
  レビューする運用に接続する

## 今はダミーで良い部分

- ダッシュボード上でのリアルタイム可視化（Phase1はログ・簡易集計で足り、
  [06_dashboard_future.md](06_dashboard_future.md)のような可視化画面は不要）

## Phase4以降

- コホート分析、業種別セグメント分析
- A/Bテスト基盤との連携（[07_free_report.md](../strategy_v2/07_free_report.md)のA/Bテスト前提と接続）
