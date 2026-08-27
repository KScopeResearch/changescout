# 13_architecture.md — 将来アーキテクチャ

**注: 本ドキュメントは将来構想の設計メモであり、現時点での実装を意味しない。
`website/` 配下への変更は本フェーズでは一切行わない。**

## コンポーネント構成（構想）

```
[リード管理]  ターゲットリスト・オプトイン記録・送信履歴の管理
     ↓
[企業解析エンジン]  ドメイン→HP取得→構造化データ抽出（04_company_analysis.md）
     ↓
[市場変化データベース]  ChangeScoutと共有する変化データ（法改正・補助金・ニュース等）
     ↓
[AIパイプライン]  業種推測→関連度判定→Opportunity/Action生成→メール生成（05_ai_pipeline.md）
     ↓
[レビューキュー]  人間の承認待ちドラフトを管理するワークフロー（06_human_review.md）
     ↓
[送信基盤]  メール配信、到達率・開封・クリックのトラッキング
     ↓
[レポートページ]  無料/有料レポートの表示、登録フォーム（07/08/10）
     ↓
[分析・モニタリング]  KPIダッシュボード、監査ログ
```

## ChangeScoutとの資産共有ポイント

- **市場変化データベース**: ChangeScoutの分析エンジンが参照するデータと、AORが参照する
  データは本質的に同じものになりうる。`database/opportunities.csv` のようなデータ資産を
  両プロダクトで共有できれば、開発コストと精度の両方にレバレッジが効く
  （PROJECT.mdの「Reusable Assets」原則に合致）
- **企業解析エンジン**: AORで開発する「ドメイン→企業情報」の解析エンジンは、
  ChangeScoutの「プロフィール入力」を補助・自動補完する機能としても転用できる可能性がある
  （入力の手間を減らす方向での統合）

## データフロー上の注意点

- レビューキューを経由しない自動送信経路を作らない（[06_human_review.md](06_human_review.md)の原則を
  アーキテクチャレベルで強制する）
- オプトイン/オプトアウト状態を単一の真実源（Single Source of Truth）で管理し、
  送信基盤がこれを必ず参照する設計にする（誤送信防止、[14_risk.md](14_risk.md)）

## メール送信アーキテクチャ v1.0

Phase44でSmartlead・blastengine双方から書面回答を受領したことを受け、Initial AOR・Weekly AORの
送信Provider構成を正式仕様として記録する（回答原文・詳細な許容/条件事項は
[docs/external-provider-confirmations.md](../external-provider-confirmations.md)参照）。

### 1. Provider構成

| メール種別 | Provider | 送信条件 |
|---|---|---|
| Initial AOR | blastengine API | 公開メールアドレス宛・企業ごとの個別レポート・初回接触として原則1回のみ |
| Weekly AOR | Amazon SES API | 本人が明示的にオプトインした宛先のみ・定期配信 |

InitialとWeeklyは異なる送信用途であり、異なる送信ポリシーを持つ。両者は別の送信基盤・別の送信条件で
運用し、一方の変更が他方の送信ポリシーへ影響しないようにする。

### 2. Provider選定理由

**Initial AOR = blastengine API**
- blastengine確認済み利用ポリシーに適合（`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」参照）
- 初回・個別送信という用途に合致
- 対象は公開アドレスであり、一斉メルマガ用途ではない

**Weekly AOR = Amazon SES API**
- 受信者本人の明示的なオプトイン後にのみ送信
- Lambdaによるスケジュール配信を想定した定期配信基盤

**blastengineの許可は無条件ではない**: blastengineからの回答は、Provider構成表に記載した利用パターン（公開アドレス・個別レポート・原則1回のみ、外部購入リストではない、苦情/バウンス後は送信しない）に加えて、本ドキュメント3節（共通Suppression）・4節（オプトアウト仕様）・5節（ドメインウォームアップ仕様）に記載する条件の実装・遵守を実質的な前提条件として提示している（詳細は`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」の「必須条件として要求した事項」参照）。

※ 上記はいずれも各Providerの運用ポリシー・利用規約との整合性に基づく記載であり、法律上の適法性評価ではない。

### 3. 共通Suppression仕様

Provider（blastengine／Amazon SES）を問わず、送信前に以下のSuppression状態を確認する共通レイヤーを
設計原則とする。

- Bounce
- Complaint
- Unsubscribe

いずれかに該当する宛先には、使用するProviderにかかわらず送信しない。実装方法は本ドキュメントの対象外とする。

### 4. オプトアウト仕様

**Initial AOR**:
- 配信停止導線をメール本文へ記載する
- List-Unsubscribeヘッダー対応は**予定**（未実装）

**Weekly AOR**:
- ワンクリック配信停止URLを設ける
- List-Unsubscribeヘッダー対応は**予定**（未実装）

いずれも現時点では未実装であり、上記は目標仕様として記録する。

### 5. ドメインウォームアップ仕様

blastengineからの回答（`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」参照）を
根拠として、以下を運用仕様とする。

- 新しいFromドメインは、送信開始から約2週間かけてウォームアップする
- 初期は少量送信から開始し、段階的に送信量を増やす
- 「2週間」等の数値はblastengineから提示された目安の一例であり、確定した固定値ではない

## 段階的な構築方針

初期フェーズ（Phase 0〜1、[15_roadmap.md](15_roadmap.md)）では上記コンポーネントの多くを
スプレッドシート・手作業・汎用AIチャット（ChatGPT/Claude）で代替し、
検証が進んだ工程から順にシステム化する。「先にシステムを作ってから検証する」のではなく、
「検証しながら、繰り返し発生する工程だけをシステム化する」順序を守る
（PROJECT.mdの「Automate Everything」「Build Fast」原則に合致）。
