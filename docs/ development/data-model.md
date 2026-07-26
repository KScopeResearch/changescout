＃data-model.md

Phase 2-1: 市場変化データモデル設計。現在のHTMLモック（`website/mock-dashboard.html`, `website/opportunity-detail.html`）が固定文字列でハードコードしている内容を、将来データ・AI生成へ移行できる構造として整理する。**設計のみであり、今回は実装変更を行わない。**

## Entity関係と責務

```
MarketChange
    ↓
Opportunity
    ↓
ActionPlan
```

| Entity | 責務 |
|---|---|
| `MarketChange` | 市場変化・制度変更・ニュース等の**客観情報**。企業プロフィールに依存しない |
| `Opportunity` | `MarketChange` × `CompanyProfile` から生まれる、企業ごとの**影響・判断理由** |
| `ActionPlan`（Phase 2-4で`action_plan`として実装） | 営業担当者が実際に**取る行動**（誰に・何を・どうやって） |

**設計ドキュメント（本ファイル）上ではこの3層は責務が混在していない**：MarketChangeは`impact`/`reason`/`action`のような企業依存フィールドを持たず、それらはOpportunity（下記2節）に、営業行動固有のテンプレートはActionPlanに、それぞれ明確に分離している。

**ただし実装（`website/data/market-changes.json`）は責務が混在している**：Phase 2-3で`impact`/`reason`/`action`/`overview1`/`overview2`/`why_now`を、Phase 2-4で`action_plan`を、いずれも実装速度を優先してMarketChangeオブジェクトへ直接内包した（各Phaseの実装メモ内で「本来はOpportunity生成ロジックが持つべき値の暫定的な内包」と明記済み）。これは意図的なMVP期間中の技術的負債であり、実際にOpportunity生成ロジックを実装する際（Phase 3以降）は、この2つのフィールド群を`MarketChange`から切り離し、`Opportunity`/`ActionPlan`として独立させる必要がある。

## 1. MarketChange（市場変化）

市場で起きた変化そのものを表す、企業プロフィールに依存しない客観情報。

| フィールド | 説明 | 現在のモックでの相当箇所 |
|---|---|---|
| `id` | 一意識別子 | なし（新規） |
| `title` | 変化のタイトル | `detailTitle` / `card{n}Title`（例：「補助金対象拡大」） |
| `category` | 種別（補助金／法改正／制度改正／市場変化） | `detailTag` / `card{n}Tag` |
| `summary` | 一行要約 | `detailFact` / `card{n}Fact` |
| `source` | 発表元 | `evidenceMeta{n}` の発表元部分（例：中小企業庁） |
| `published_date` | 公開日 | `evidenceMeta{n}` の日付部分（例：2026.07.24） |
| `target_industries` | 関連する業種（複数可） | `overrides` オブジェクトのキー（manufacturing/construction/professional/other/it-dx） |
| `evidence` | 根拠情報のリスト（`{title, source, date}`） | Evidenceセクション（`evidenceTitle{n}`/`evidenceMeta{n}`） |

**意図的に含めない項目**：ユーザー提示の例には `opportunity_type` と `recommended_actions` が含まれていたが、これらはMarketChange単体では決まらず、企業プロフィールと組み合わせて初めて決まる値のため、後述の `Opportunity` 側に置く。MarketChangeに持たせると「同じ市場変化でも会社によって異なるはずの推奨アクション」を1つの変化に固定してしまい、パーソナライズの前提と矛盾するため過剰設計として除外する。

## 2. Opportunity（機会）

`MarketChange` と `CompanyProfile` を掛け合わせて生成される、企業ごとの提案。

```
MarketChange + CompanyProfile → Opportunity → Dashboard Card / Opportunity Detail → Recommended Action
```

| フィールド | 説明 | 現在のモックでの相当箇所 |
|---|---|---|
| `id` | 一意識別子 | なし（新規） |
| `market_change_id` | 参照する MarketChange | — |
| `company_profile_snapshot` | 生成時点の CompanyProfile（`industry`/`customerSegment`/`product`/`region`） | AI Transparencyパネルの `genIndustry`/`genCustomerSegment`/`genProduct`/`genRegion` |
| `score` | Opportunity Score | 各カードの `Score {n}` バッジ、貴社の機会スコア(`82`) |
| `priority` | 重要度（高／中／低） | `あなたへの重要度：高` タグ |
| `impact` | 影響内容 | `card{n}Impact` / `summaryImpact` |
| `reason`（**判断理由・ロック済み用語**） | AIが重要度を判断した根拠 | `card{n}Reason` / `summaryReason` |
| `action`（**推奨アクション・ロック済み用語**） | ユーザーが取るべき具体的行動 | `card{n}Action` / `summaryAction` / `actionTitle` |
| `affected_company_estimate` | 影響候補企業数（AI推定値） | `topic-card__target` / `actionTarget` の「18社」等 |
| `estimated_revenue` | 想定売上機会（AI推定値） | `actionEffect` 内の「最大400万円」 |
| `generated_content` | 生成コンテンツ（`{mail, talk, proposal}`） | `genMail`/`genTalk`/`genProposal` |

`score`・`affected_company_estimate`・`estimated_revenue` はすべて確定値ではなくAI推定値として扱う（`CLAUDE.md` の Product Principles に準拠、UI上は `ai-estimate-note` で明示）。

## 3. CompanyProfileとOpportunity生成の関係

現在 `company-profile.html` が `localStorage`（キー `changescout_profile`）に保存する5項目のうち、どれがOpportunity生成にどう使われるかを整理する。`companyName`はWeek1 Must Fixで追加した項目。

| CompanyProfileの項目 | Opportunity生成での役割 |
|---|---|
| `companyName`（企業名、任意） | 業種に依存しない表示置換のみ。入力がある場合、固定デモ企業名「株式会社フィールドDX」をDashboard/Opportunity Detailの該当箇所で置き換える。Opportunity生成ロジック自体には使わない |
| `industry`（業種） | **主キー**。どの `MarketChange`／どのOpportunityテンプレートを選ぶかを決める一次分類。未選択時は既定表示のまま（パーソナライズしない） |
| `customerSegment`（顧客層） | 補完レイヤー。入力がある場合のみ `affected_company_estimate` や `reason` に「（〇〇が中心）」等の形で追記 |
| `product`（商材） | 補完レイヤー。入力がある場合のみ `reason` や `generated_content` に「貴社の商材『〇〇』との親和性も…」等の形で追記 |
| `region`（営業地域） | 補完レイヤー。入力がある場合のみ `affected_company_estimate` に「〇〇エリアが中心」等の形で追記 |

**注意**：`customerSegment`／`product`／`region`／`companyName`が未入力の場合、その項目に関する記述は一切追加しない（`companyName`未入力時は固定デモ企業名の表示を維持）。存在しない情報を推測・捏造してテンプレートを埋めることは禁止する（`CLAUDE.md` Product Principles「推測によるプロフィール補完は禁止」に対応）。

## 4. AI Transparency仕様

現在実装済みの「この提案が生成された理由」パネルを正式仕様として整理する。パネルは2種類の情報で構成される。

**参照情報**（Opportunity生成が参照する情報の種類。個別のOpportunityに依らない固定ディスクロージャー）:
- プロフィール情報
- 公開されている市場情報
- 業界制度・法改正情報

**生成結果**（個別のOpportunityインスタンスが実際に持つ値）:
- 判断理由 = `Opportunity.reason`
- 推奨アクション = `Opportunity.action`
- 想定影響 = `Opportunity.impact` / `Opportunity.estimated_revenue`

加えてパネルは「どのCompanyProfile入力が使われたか」（`genIndustry`/`genCustomerSegment`/`genProduct`/`genRegion`）と「どのMarketChangeが検知されたか」（`genMarketChange` = `MarketChange.summary`）を表示する。いずれも値が存在する項目のみ表示し、存在しない項目の行は非表示のままとする現行仕様を維持する。

## 5. 設計対象外（Out of Scope）

以下はPhase 2-1のデータモデル設計には含めない。

- CRM連携
- 自動営業実行
- リードスコアリング高度化
- 完全自動市場ニュース収集
- 精密売上予測
- 機械学習モデル設計

## 6. 現在のUIとの対応表

| 現在のUI要素 | 将来データ |
|---|---|
| ビジネスチャンスカード（`topic-card`） | `Opportunity` |
| カードのタグ（`card{n}Tag`/`detailTag`） | `MarketChange.category` |
| カードのタイトル（`card{n}Title`/`detailTitle`） | `MarketChange.title` |
| ファクト（`card{n}Fact`/`detailFact`） | `MarketChange.summary` |
| 影響（`card{n}Impact`/`summaryImpact`） | `Opportunity.impact` |
| 判断理由 | `Opportunity.reason` |
| 推奨アクション | `Opportunity.action` |
| 影響候補企業（`topic-card__target`/`actionTarget`） | `Opportunity.affected_company_estimate` |
| 想定売上機会（`actionEffect`内） | `Opportunity.estimated_revenue` |
| Evidence（`evidenceTitle{n}`/`evidenceMeta{n}`） | `MarketChange.evidence[]` |
| メール／トーク／提案資料生成 | `Opportunity.generated_content` |
| 貴社の機会内訳（`industry-breakdown`） | 業種内の複数`Opportunity`をカテゴリ別に集計したサマリー |
| AI Transparency：業種／顧客層／商材／営業地域 | `Opportunity.company_profile_snapshot` |
| AI Transparency：検知した市場変化 | `MarketChange.summary`（再掲） |
| AI Transparency：参照情報／分析タイミング | Opportunityに依らない固定ディスクロージャー |
| AI推定値注記（`ai-estimate-note`） | AI推定フィールド（score/affected_company_estimate/estimated_revenue等）共通のディスクロージャー |
