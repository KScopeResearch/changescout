# 08_paid_report.md — 有料版との差別化

## 基本方針

無料版が「量」で驚かせるのではなく「これは自分向けだ」という精度で価値を証明する設計であるのに対し、
有料版は **継続性・深さ・実行支援** で差別化する。

## 差別化ポイント

| 軸 | 無料版 | 登録特典 | 有料版 |
|---|---|---|---|
| 扱うOpportunity | 最も関連度の高い1件 | 同じ1件（理解を深める） | ロック中だった追加テーマ＋優先順位付け |
| 深さ | why_now/why_company/market_change/evidence/first_action | ＋市場規模・競合状況・リスク・優先順位・事例（`extended_analysis`） | 追加テーマも同水準で深掘り |
| 更新頻度 | 単発（送付時点のスナップショット） | 単発 | 月次・週次の継続更新、変化発生時のアラート（Phase2） |
| Action | 完全に具体的な最初の一歩（1件のみ） | 同左（追加なし） | 実行支援（90日アクションプラン、実行ロードマップ） |
| 対象範囲 | 単一Opportunity | 単一Opportunity | 複数Opportunityの横断・優先順位付け・根拠資料一覧 |
| 連携 | なし | なし | Slack通知、API連携、CRM連携（将来） |
| 提供形態 | 静的なWebページ | 静的なWebページ（登録直後にその場表示） | ダッシュボード、または定期メール配信 |

## 有料版で提供する価値（改訂）

有料版は「無料版のOpportunityの続き」ではない。同じOpportunityの深掘りは登録特典
（`extended_analysis`）で既に完結しており、有料版は**視野を広げ、実行に移すための材料を揃える**
という新しい価値を提供する。無料版＝「最も重要なOpportunityを理解する」、登録後＝「それをさらに
深く理解する」に対して、有料版＝**「実際に動くための判断材料を提供する（意思決定支援）」**が
価値の核である。この価値は`paid_analysis`という単一のデータ構造にまとめる
（詳細は「`paid_analysis`のデータ構造」を参照）。

| 提供価値 | 内容 | 対応する`paid_analysis`フィールド | Phase1での扱い |
|---|---|---|---|
| 意思決定サマリー | 「結局どうすべきか」を先頭で一言に集約する（推奨判断・タイミング・期待効果・投資規模・理由） | `decision_summary` | 提供可能。AIがドラフトし、人間がレビューする |
| 追加Opportunity分析 | ロック中だったテーマを含む2〜4件を、タイトル・概要・期待効果・関連度で提示する（詳細分析は後から拡張できる軽量構造） | `additional_opportunities` | 提供可能。無料版ほどの深さ（why_now等）は持たせず、まず存在を示す |
| 優先順位付け | 各Opportunityを効果・工数の2軸で分類し、着手順位を示す | `priority_matrix` | 提供可能（人間が最終確認。図ではなくJSON構造で保持し、表示側で可視化する） |
| 実行ロードマップ（90日） | 30/60/90日の各期間で「やること」「期待成果」を示す | `roadmap` | AIがドラフトし、人間がレビューした上で提供する構造化ドラフトとして提供可能。
  Opportunityごとの完全自動・動的な再生成はPhase2以降 |
| 実行支援 | 追加調査・営業資料作成・提案書レビュー・市場調査など、人が支援する内容の一覧 | `execution_support` | Phase1から人的窓口として提供。一覧は静的、対応自体は[11_sales_process.md](11_sales_process.md)で人手対応 |
| 継続モニタリング | 今後注視すべきテーマ（法改正・補助金・競合動向・業界ニュース）の一覧提示 | `monitoring` | Phase1はテーマ一覧の静的表示のみ。実際のアラート配信・自動追跡は`docs/mockups_v2/06_dashboard_future.md`、Phase2以降 |
| 根拠資料一覧 | 無料版・登録特典・追加Opportunity分析で使った全evidenceを一覧化し、社内共有・意思決定の材料にする | （`additional_opportunities`の拡張データとして将来追加） | Phase1では簡易的な一覧表示に留める |
| 相談対応 | 上記のうち自動化されていない部分（競合比較・営業メール案・提案資料たたき台を含む）を、担当者が個別に対応する窓口 | `execution_support`と連動 | Phase1から提供（メール等の人的窓口） |

## `paid_analysis`のデータ構造

`free_opportunity`（無料版・登録特典）とは別に、有料版専用のトップレベルデータとして
`paid_analysis`を保持する。

```
paid_analysis
├── decision_summary {}           … 意思決定サマリー（先頭に配置）
├── additional_opportunities []   … 追加Opportunity（2〜4件、軽量構造）
├── priority_matrix {}            … 効果×工数の2軸優先順位付け
├── roadmap {}                    … 30/60/90日の実行ロードマップ
├── execution_support []          … 人的支援メニューの一覧
└── monitoring []                 … 継続監視テーマの一覧
```

### `decision_summary`（先頭に配置、Phase1最終確定で追加）

有料版画面の最上部に置く「結局どうすべきか」の一言集約。`additional_opportunities`・
`priority_matrix`・`roadmap`を読み解かなくても、まずここだけで意思決定の方向性が分かるようにする
（[08_paid_report.md](08_paid_report.md)の基本方針にある「意思決定支援」を最も端的に体現する項目）。

| フィールド | 内容 |
|---|---|
| `recommendation` | 推奨する打ち手そのもの（一文） |
| `recommended_timing` | いつ着手すべきか |
| `expected_impact` | 期待される効果 |
| `investment_level` | 必要な投資規模の目安（`低`/`中`/`高`等） |
| `reason[]` | 上記の推奨に至った理由（複数可、`additional_opportunities`や`priority_matrix`の
  結論を裏付ける形で書く） |

### `additional_opportunities`（2〜4件）

無料版の`locked_opportunities`（タイトルのみ）に対応する実体。各要素は次の4項目のみを持つ
軽量構造とし、**詳細分析（why_now/why_company/evidence等）は後から追加できる拡張性**を残す。

| フィールド | 内容 |
|---|---|
| `title` | Opportunityのタイトル |
| `summary` | 概要（2〜3行） |
| `expected_effect` | 期待効果 |
| `relevance` | 関連度（`高`/`中`） |

`locked_opportunities`と同じ`id`を持たせることで、無料版で見せた「ロック中テーマ」と
有料版で開放される内容の対応関係を追跡できるようにする。無料版で一度も言及していない
新規テーマを含めてもよい（「タイトルだけ知っていたものが開放される」体験と「有料版でしか
分からない新しい発見がある」体験の両方を作る）。

### `priority_matrix`（品質改善で`opportunity_ids`方式に統一）

効果（高/低）×工数（高/低）の2軸で`additional_opportunities`を分類する。図ではなくJSON構造で
保持し、表示側（HTML）で可視化する。

**設計変更の経緯**: 当初（v2.2）は各象限に`opportunity_ids`（IDの配列）のみを持たせていたが、
HTML実装（Phase5）では`title`・`expected_effect`を直接埋め込んだ`items[]`（v2.3）に変更した。
しかしこれは`additional_opportunities`とのデータ重複を生み、更新時に2箇所を同期する必要が
生じてしまった。**品質改善（Phase5.1）で`opportunity_ids`（IDの配列のみ）に統一し、
`additional_opportunities`を唯一の正とする**。HTML側の実装が煩雑にならないよう、
`additional_opportunities`から`id → Opportunity`の`Map`を1回だけ構築してから参照する
（`website/aor/assets/js/common.js`の`getOpportunityMap()`）。

```
paid_analysis.additional_opportunities  … データの正
        ↑
        │ id で参照
paid_analysis.priority_matrix.quadrants.*.opportunity_ids
```

```
priority_matrix
└── quadrants
    ├── high_impact_low_effort   { label, opportunity_ids: [] }  … 最優先
    ├── high_impact_high_effort  { label, opportunity_ids: [] }  … 計画的に着手
    ├── low_impact_low_effort    { label, opportunity_ids: [] }  … 余力があれば
    └── low_impact_high_effort   { label, opportunity_ids: [] }  … 非推奨
```

```javascript
const opportunityMap = new Map(additionalOpportunities.map((o) => [o.id, o]));
// 各象限の描画時: quadrant.opportunity_ids.map((id) => opportunityMap.get(id))
```

`additional_opportunities`側だけを更新すれば、`priority_matrix`の表示内容も自動的に
最新化される。同じ情報を2箇所で保守する必要はない。

### `roadmap`

90日を30日単位で3分割し、各期間で「やること（`actions`）」「期待成果（`expected_outcome`）」を持つ。

```
roadmap
├── day_30 { actions: [], expected_outcome }
├── day_60 { actions: [], expected_outcome }
└── day_90 { actions: [], expected_outcome }
```

無料版の`first_action`（最初の一歩）をday_30の起点として引き継ぐことで、無料版→登録特典→
有料版の実行計画が一貫した流れになるようにする。

### `execution_support`

人が支援する内容の一覧。各要素は`label`（例:「追加調査」「営業資料作成」「提案書レビュー」
「市場調査」）と`description`（何を支援するかの一言）を持つ。[11_sales_process.md](11_sales_process.md)の
人的フォローが対応する窓口そのものであり、実際の対応内容は会社ごとに個別化する。

### `monitoring`

今後注視すべきテーマの一覧。各要素は`theme`（例:「法改正」「補助金」「競合動向」「業界ニュース」）と
`description`（具体的に何を監視するか）を持つ。Phase1では静的な一覧表示に留め、実際の
継続監視・アラート配信の仕組みは`docs/mockups_v2/06_dashboard_future.md`（Phase2以降）で構築する。

## 登録特典との関係（無料版→登録→有料版の価値の積み上げ）

[07_free_report.md](07_free_report.md)の「価値の積み上げ設計」に基づき、無料版は「発見」、
登録直後は「同じOpportunityの理解を深める」（`extended_analysis`）、有料版は「実行に移すための
広がり」を担当する。**登録直後に新しいOpportunityを1件開放する、という旧設計は採用しない**。
有料版で初めて、ロック中だった追加テーマの分析に着手する。

有料プランへの申込み導線（ペイウォール）の近くには、Standardプランの**目安価格**を明示する
（[09_pricing.md](09_pricing.md)）。価格が分からないまま検討させることは離脱要因になるため、
価格提示を先送りしない。

## 有料化のトリガー設計

無料レポートを読んだ担当者が「継続的にこの情報が欲しい」と感じる瞬間を捉える。

- 「変化が起きたら知りたい」→ アラート機能への訴求
- 「自社の他部門にも関係しそう」→ 複数部門レポートへの訴求
- 「これを元に何をすればいいか一緒に考えてほしい」→ 人的支援付きプランへの訴求（[09_pricing.md](09_pricing.md)）

## ChangeScoutとの接続

有料版の「継続的な市場変化モニタリング」というコンセプトは、ChangeScout本体の提供価値と
本質的に重なる。AORの有料版は、将来的にはChangeScoutの契約への「入口プラン」として
統合される可能性がある（詳細は [16_validation_plan.md](16_validation_plan.md) の統合案）。

## 参考: 業界の類似ポジショニング

Sales Intelligence / Revenue Intelligence市場では、データ提供に留まるツール（ZoomInfo等）と
AI・予測機能まで踏み込むツール（6sense等）とで価格帯が10倍以上異なる
（ZoomInfoは年額1.5万ドル前後から、6senseは年額6万〜10万ドル以上から）。
AORの有料版も「単なる情報提供」で終わらせず、「意思決定・実行の支援」まで踏み込むことで
価格の正当性を作る必要がある。

---

## 出典

- [6sense vs ZoomInfo pricing](https://pipeline.zoominfo.com/sales/6sense-vs-zoominfo)
