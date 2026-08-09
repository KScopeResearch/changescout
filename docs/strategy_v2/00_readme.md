# strategy_v2 について

## これは何か

ChangeScout（プロフィール入力 → 分析 → レポート閲覧、いわゆる「プル型」サービス）とは
**完全に別コンセプト**の新規プロジェクトの設計資料一式である。

コードネーム（仮称）: **AI Opportunity Report**（略称 AOR）

`docs/strategy/PROJECT.md` の Product Portfolio に候補として挙がっていた
「AI Opportunity Report」を具体化したものにあたる。ChangeScout とは別プロダクトとして並走させる。

## 位置づけ

- この配下は **設計資料のみ**。`website/` 配下の HTML/CSS/JavaScript/JSON には一切手を加えていない。
- 実装・コミット・pushはこのフェーズでは行わない。
- ChangeScout の開発・運用方針には影響しない。

## 更新履歴

Phase1 MVP仕様の確定に伴うレビュー反映（セルフサーブ生成の廃止、Human in the Loop原則の明文化、
有料版へのブリッジ設計追加、Opportunity Score表示方式の変更、計測仕様の追加、信頼性表示の追加、
Phase2機能の分離）について、詳細は [CHANGELOG.md](CHANGELOG.md) を参照。

## ドキュメント一覧

| # | ファイル | 内容 |
|---|---|---|
| 01 | [01_concept.md](01_concept.md) | サービス概要・USP・ターゲット・ChangeScoutとの違い |
| 02 | [02_user_journey.md](02_user_journey.md) | 認知〜紹介までのユーザージャーニー |
| 03 | [03_lead_generation.md](03_lead_generation.md) | メールアドレス取得方法（適法・倫理的手段のみ） |
| 04 | [04_company_analysis.md](04_company_analysis.md) | ドメイン起点の企業解析設計 |
| 05 | [05_ai_pipeline.md](05_ai_pipeline.md) | AI処理パイプライン |
| 06 | [06_human_review.md](06_human_review.md) | AIと人間の役割分担 |
| 07 | [07_free_report.md](07_free_report.md) | 無料レポート設計 |
| 08 | [08_paid_report.md](08_paid_report.md) | 有料版との差別化 |
| 09 | [09_pricing.md](09_pricing.md) | 価格モデル案 |
| 10 | [10_lp_structure.md](10_lp_structure.md) | LP構成 |
| 11 | [11_sales_process.md](11_sales_process.md) | 営業フロー |
| 12 | [12_operations.md](12_operations.md) | 運営フロー |
| 13 | [13_architecture.md](13_architecture.md) | 将来アーキテクチャ |
| 14 | [14_risk.md](14_risk.md) | 法的・倫理的リスク |
| 15 | [15_roadmap.md](15_roadmap.md) | 段階的ロードマップ |
| 16 | [16_validation_plan.md](16_validation_plan.md) | 検証すべき仮説・最重要まとめ |

## 参照した外部調査（要約）

Web調査で参照した一次情報は各ドキュメント末尾に出典を記載している。主な調査領域:

- AI SDR / AI Prospecting（Artisan, Autobound, AiSDR, 11x, Regie.ai, Salesforge など）
- Sales Intelligence / Revenue Intelligence（ZoomInfo, 6sense, Gong, Clari）
- Competitive Intelligence（Klue, Crayon）
- ABM（Demandbase, 6sense, RollWorks）
- 日本の法規制（特定電子メール法、個人情報保護法、スクレイピングの適法性）
