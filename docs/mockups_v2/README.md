# mockups_v2 について

## これは何か

`docs/strategy_v2/` の設計に基づく、**AI Opportunity Report（AOR）MVPの画面仕様書**。
実装ではなく、画面設計（目的・構成・表示項目・必要データの整理）のみを対象とする。

- HTML・React・その他コードは一切含まない
- `website/` 配下は変更していない
- commit・pushは行っていない

## 更新履歴

Phase1 MVP仕様確定のためのレビュー反映を実施した。変更内容の詳細は [CHANGELOG.md](CHANGELOG.md) を参照。

## ドキュメント一覧

| # | ファイル | 内容 | 主な利用者 |
|---|---|---|---|
| - | [README.md](README.md)（本ファイル） | 全体像・画面遷移図 | — |
| - | [CHANGELOG.md](CHANGELOG.md) | 変更履歴 | — |
| 01 | [01_lp.md](01_lp.md) | サービスLP（AOR一般紹介ページ、問い合わせ導線） | レポート受信者・見込み顧客 |
| 02 | [02_report_preview.md](02_report_preview.md) | 無料レポート画面（パーソナライズ版、ロック要素込み） | エンドターゲット企業担当者 |
| 03 | [03_email_capture.md](03_email_capture.md) | メール登録画面（即時1件開放込み） | エンドターゲット企業担当者 |
| 04 | [04_paid_report.md](04_paid_report.md) | 有料版レポート画面 | 登録済み/契約済み顧客 |
| 05 | [05_admin_review.md](05_admin_review.md) | Human Review画面（社内） | AOR運営担当者 |
| 06 | [06_dashboard_future.md](06_dashboard_future.md) | ログイン後ダッシュボード（将来、Phase1実装スコープ外） | 有料プラン契約企業 |
| 07 | [07_measurement.md](07_measurement.md) | 計測仕様（KPI・イベント定義） | 開発者・運営担当者 |

各ファイルは共通のフォーマットで整理している: 目的 / 誰が使うか / ユーザー心理 / CTA /
表示項目 / 必要データ / 今はダミーで良い部分 / Phase4以降。

## 画面遷移図

### 顧客（エンドターゲット企業）側のメインフロー

```
（営業メール受信）
      ↓ メール内リンクをクリック
02_report_preview.md（無料レポート／開放済みOpportunity＋ロック中Opportunityのタイトル表示）
      ↓ 「さらに詳しいレポートを見る」CTA（ロック解除の具体的ベネフィットを明示）
03_email_capture.md（メール登録）
      ↓ 登録送信 → その場でロック中Opportunityのうち1件を完全開放
04_paid_report.md（有料版レポート／開放済み1件＋残りロック中の提示、目安価格つきCTA）
      ↓ 有料プラン契約 or 「ご相談ください」導線 → 営業担当フォロー（11_sales_process.md）
06_dashboard_future.md（ログイン後ダッシュボード、Phase2〜3以降。Phase1実装スコープ外）
```

### 補助的な接続（いつでも到達可能なハブ）

```
02_report_preview.md ──┐
03_email_capture.md  ──┼── 「詳しく知る」リンク ──→ 01_lp.md（サービスLP）
04_paid_report.md    ──┘                              ↓ 「サービスについて相談する」CTA
                                                  （問い合わせ・資料請求。即時レポート生成は行わない）
```

`01_lp.md` は上記メインフローに従属しない独立到達可能なページであり、
検索・紹介経由の見込み顧客や、送信元を確認したい担当者を受け止める役割を持つ。
**当初検討したセルフサーブ即時生成フォームは、Human in the Loop原則と両立しないため廃止した
（[CHANGELOG.md](CHANGELOG.md)参照）。**

### 社内オペレーションフロー（顧客には非表示）

```
（AIパイプライン実行、05_ai_pipeline.md）
      ↓ ドラフト生成
05_admin_review.md（Human Review画面）
      ↓ 承認
（送信、02_report_preview.md として顧客側に到達）
```

`05_admin_review.md` は `02_report_preview.md` が顧客に届く**前段階**に位置する社内ゲートであり、
[06_human_review.md](../strategy_v2/06_human_review.md)の「AIドラフト→人間レビュー→送信」を
画面として具体化したもの。

## 各画面のPhase対応（15_roadmap.mdとの対応）

| 画面 | Phase 0 | Phase 1 | Phase 2 | Phase 3以降 |
|---|---|---|---|---|
| 02_report_preview | 手作業で代替 | 簡易LP化（ロック要素・信頼性表示込み） | システム化 | 継続改善 |
| 03_email_capture | 手作業で代替 | 簡易フォーム化（即時1件開放込み） | システム化 | 継続改善 |
| 04_paid_report | — | 開放済み1件＋ロック表示＋人的相談導線 | 競合比較・営業メール案・提案資料たたき台の自動化 | 実行支援の拡充 |
| 05_admin_review | チャットツールで代替 | 最小限のUI（チェックリスト＋最終ドラフトのみ） | パイプライン詳細表示・本格運用 | 複数レビュアー対応 |
| 01_lp | — | 構築（問い合わせ導線のみ） | 継続改善 | 業種別出し分け |
| 07_measurement | 手動集計 | 基本イベント計測 | 分析ダッシュボード化 | コホート分析 |
| 06_dashboard_future | — | **実装スコープ外** | 構想 | 構築 |

（[15_roadmap.md](../strategy_v2/15_roadmap.md)のPhase定義に対応。Phase 0〜1では大半の画面を
システム化せず、AIチャット+手作業で代替する方針と整合させている。）

---

## 作成ファイル一覧

- `docs/mockups_v2/README.md`
- `docs/mockups_v2/CHANGELOG.md`
- `docs/mockups_v2/01_lp.md`
- `docs/mockups_v2/02_report_preview.md`
- `docs/mockups_v2/03_email_capture.md`
- `docs/mockups_v2/04_paid_report.md`
- `docs/mockups_v2/05_admin_review.md`
- `docs/mockups_v2/06_dashboard_future.md`
- `docs/mockups_v2/07_measurement.md`
