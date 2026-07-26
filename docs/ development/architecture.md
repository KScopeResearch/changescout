＃architecture.md

## Current Architecture

```
CompanyProfile（company-profile.htmlでの入力）
        ↓
localStorage（changescout_profile キー）
        ↓
MarketChange JSON（website/data/market-changes.json、fetchMarketChanges()で取得）
        ↓
Opportunity Renderer（pickMarketChange()でCompanyProfile.industryに一致する1件を選択し、
                      Dashboard Card1 / Opportunity Detailの該当項目を描画）
        ↓
ActionPlan Renderer（同じMarketChangeエントリのaction_plan値を
                      AI Action Plan #1 / Recommended Actionへ描画）
```

各段階は失敗時に手前の状態へフォールバックする（JSON取得失敗・業種未一致→既存のハードコード`overrides`、プロフィール未入力→静的HTML）。詳細はPhase 2-3/2-4の節を参照。

- **現在は静的サイト＋JSON駆動MVP**：ビルドツール・バックエンド・データベースを持たない。GitHub Pagesでホスティングし、`website/data/market-changes.json`を唯一の可変データソースとして`fetch`する。
- **UIとデータソースを分離している**：HTML/CSS側の構造（`personalizeFromProfile()`によるDOM書き換え）はそのままに、データの出どころだけを「ハードコード`overrides`」→「`market-changes.json`」→（将来）「API」と差し替えられる形にしてある。

## Future Architecture（構想・未着手）

```
MarketChange JSON
        ↓
API（MarketChange / Opportunity生成エンドポイント）
        ↓
Database（MarketChange・Opportunity・ActionPlanの永続化）
        ↓
AI Pipeline（実際のOpportunity生成・スコアリング。現状はすべて人手で書かれたテンプレート）
```

- **将来API置換可能な設計**：`website/js/market-data.js`の`fetchMarketChanges()`が唯一のデータ取得窓口になっているため、この関数の中身を実APIへの`fetch`に差し替えるだけで、呼び出し側（Card1・Detail・ActionPlanの描画ロジック）は変更不要。
- 着手条件は`docs/strategy/ROADMAP.md`の「Phase 3移行条件」を参照。現時点では技術的な置換可能性を確保しているのみで、実装判断はしていない。
- **移行ポイント（MarketChange/Opportunity/ActionPlanの分離）**：`website/data/market-changes.json`は現在、実装速度優先で`impact`/`reason`/`action`/`overview1`/`overview2`/`why_now`（Opportunity相当）と`action_plan`（ActionPlan相当）をMarketChangeオブジェクトへ直接内包している（意図的なMVP期間中の技術的負債。詳細は`data-model.md`の「Entity関係と責務」を参照）。Database導入時は、この1つのJSONオブジェクトを`market_changes`テーブルと、これを参照する`opportunities`テーブル・`action_plans`テーブルへ分割することが、責務分離を実装に反映させる具体的な移行ポイントになる。

## 現在のアーキテクチャ詳細（website/）

- 静的マルチページサイト（ビルドツール・バックエンドなし）。各HTMLファイルはインラインの`<style>`/`<script>`を持つ自己完結構成。
- ページ構成：`index.html`（LP）→ `company-profile.html`（会社プロフィール入力）→ `profile-complete.html`（登録完了・レポートプレビュー）→ `mock-dashboard.html`（ダッシュボード）→ `opportunity-detail.html`（詳細）
- パーソナライズは`localStorage`キー`changescout_profile`（`{companyName, industry, customerSegment, product, region}`）を介して行う。各ページの`personalizeFromProfile()`が業種別の`overrides`オブジェクトを参照し、DOM要素をidベースで書き換える。`companyName`（企業名、任意項目）のみ業種に依存せず、固定デモ企業名「株式会社フィールドDX」をDashboard/Opportunity Detailの該当箇所で置き換える用途に使う（Week1 Must Fix）。
- 自由入力項目（顧客層・商材・地域）は業種オーバーライドの上に「補完レイヤー」として追記するのみで、未入力の項目は推測・捏造しない。
- ホスティングはGitHub Pages（`.github/workflows/deploy-pages.yml`、`website/`配下をpush時に自動デプロイ）。
- Playwright（`tests/pages.spec.js`）で8ケース（desktop/mobile × 4ページ）を検証し、`scripts/generate-review.js`が`website/review/report.json`を生成。`website/review/index.html`でファイルアップロードなしにAIレビュー可能。

## 次フェーズに向けた技術課題

- 現在の市場変化・Opportunity内容はすべて静的なハードコード（`overrides`オブジェクト）。実データ・生成ロジックへの置き換えが必要。
- バックエンド・データベースは未着手（`database/opportunities.csv`も空）。
- Phase 2-1として、上記ハードコードを置き換えるための `MarketChange` / `Opportunity` データモデルを設計済み。詳細は[data-model.md](./data-model.md)を参照。現時点では設計のみで実装は未着手。
- Phase 2-2として、そのスキーマに沿ったサンプルデータ（[sample-market-changes.json](./sample-market-changes.json) 10件、Opportunity生成例は[sample-data.md](./sample-data.md)）を作成済み。

## Phase 2-3 実装内容（アーキテクチャ検証・最小限のデータ駆動化）

固定HTMLモックを維持したまま、Dashboard Card1とOpportunity Detailの主要な文言をJSON駆動に置き換える検証を実施。全カード動的化やAI API接続は行っていない。

- **JSONデータ配置**：`website/data/market-changes.json`（`docs/ development/sample-market-changes.json`と同じ10件をベースに、実際にCard1で使う3件（manufacturing/construction/professional）のみ`impact`/`reason`/`action`/`overview1`/`overview2`/`why_now`/`tag_class`を追加）。GitHub Pagesから静的ファイルとしてfetch可能。
- **Browser fetch**：`website/js/market-data.js`（新規共通スクリプト）が`fetch("data/market-changes.json")`でデータを取得し、`target_industries`で`CompanyProfile.industry`に一致する最初の1件を返す。`mock-dashboard.html`・`opportunity-detail.html`の両方から読み込み、同一データソースを参照することでDashboard/Detail間の文言の食い違いを防止。
- **localStorage連携**：既存の`changescout_profile`（`industry`/`customerSegment`/`product`/`region`）をそのまま利用。JSON側にimpact/reason/actionが揃っている場合のみ上書きし、`customerSegment`が入力されている場合は既存の補完レイヤーと同じ文言（「（〇〇を中心に）」）を再適用する。未入力項目は引き続き推測しない。
- **フォールバック**：JSON取得失敗・`industry`未一致・プロフィール未入力のいずれの場合も、既存の同期処理（`personalizeFromProfile()`のハードコード`overrides`、またはプロフィール未入力時の静的HTML）がそのまま表示され続ける。検証用に`#card1`（Dashboard）・`#detailHero`（Detail）へ`data-source`属性（`static`/`override`/`json`）を付与し、どの経路で描画されたかを外部から確認できるようにした。
- **将来API置換可能性**：`fetchMarketChanges()`は`fetch("data/market-changes.json")`を1箇所に閉じ込めており、将来この行を実APIエンドポイントへの`fetch`に差し替えるだけで、呼び出し側（Card1・Detailの描画ロジック）は変更不要な構造にしてある。

**今回あえて動的化しなかった部分**：Dashboard Card2・Card3、AI Action Plan、Opportunity DetailのRecommended Action（`actionTarget`/`actionReason`/`actionEffect`/メール・トーク・提案資料生成）は今回の検証範囲外とし、既存のハードコード`overrides`のまま。

## Phase 2-4 実装内容（AI Action Plan / Recommended ActionのJSON駆動化）

Phase 2-3で対象外としたAI Action Plan（Dashboard）とRecommended Action（Opportunity Detail）まで、同一のMarketChangeデータソースで一貫表示できるよう拡張。UIデザイン・既存ラベル（判断理由・推奨アクション）は変更していない。

- **データモデル拡張**：`website/data/market-changes.json`の各MarketChangeエントリに`action_plan`（`title`/`target`/`reason`/`expected_effect`/`templates.{mail,talk,proposal}`）を追加。市場変化そのものの情報（`impact`/`reason`/`action`等）とは別フィールドとして分離し、根拠のない数値・成果保証表現は含めていない。対象はmc-001/mc-003/mc-005/mc-009（manufacturing/construction/professional/other）の4件。
- **MarketChange → ActionPlanデータフロー**：
  ```
  website/data/market-changes.json
          │ fetchMarketChanges() + pickMarketChange()（js/market-data.js、Phase 2-3と共通）
          ▼
  MarketChange.action_plan
          │ 同一エントリを参照
          ├─▶ Dashboard AI Action Plan #1（a1Title/a1Target/a1Reason/a1Effect/a1Mail/a1Talk/a1Proposal）
          └─▶ Opportunity Detail Recommended Action（actionTitle/actionTarget/actionReason/actionEffect/genMail/genTalk/genProposal）
  ```
  優先順位は「JSON `action_plan` → 既存`overrides` → 静的HTML」。`customerSegment`/`product`/`region`の補完レイヤーはJSON上書き後に再適用し、未入力項目は推測しない。
- **JSON駆動化した範囲**：AI Action Plan #1 / Recommended Action本体・メール・トーク・提案資料生成（テンプレート参照のみ、生成ロジックはPhase 3以降）。
- **固定のまま残した範囲**：Dashboard Card2・Card3、AI Action Plan #2・#3、プロフィール未入力時の全表示。
- **検証**：`#actionPlan1`（Dashboard）・`#recommendedAction`（Detail）に`data-source`属性（`static`/`override`/`json`）を付与し、Phase 2-3と同じ方式で描画経路を確認可能にした。
- **将来API化時の置換ポイント**：`action_plan`は現状JSON内に静的に埋め込んでいるが、本来はOpportunity生成ロジックが動的に算出すべき値（`data-model.md`のOpportunity定義に対応）。将来は`fetchMarketChanges()`の返り値、または新設する`fetchOpportunity(marketChangeId, companyProfile)`のようなAPI呼び出しに置き換えることを想定し、呼び出し側（Dashboard/Detailの描画ロジック）の構造は変更不要。

## Week1 Must Fix 実装内容（`docs/strategy/FINAL_MVP_PLAN.md`対応）

初期顧客候補に見せる際に「壊れている」と感じさせないための、デモ品質・一貫性向上を目的とした最小変更。新しいアーキテクチャや生成ロジックの追加は行っていない。

- **IT・DX支援業種のフル対応**：`website/data/market-changes.json`のmc-007（既存エントリ）に`impact`/`reason`/`action`/`overview1`/`overview2`/`why_now`/`tag_class`/`action_plan`を追加し、Phase 2-3/2-4のJSON駆動の仕組み（`fetchMarketChanges()`/`pickMarketChange()`）だけでCard1・Opportunity Detail・AI Action Plan/Recommended Actionが連携するようにした。新規MarketChangeの追加ではなく、既存エントリの不足フィールド補完で対応（新しいMarketChangeモデルの変更は行っていない）。あわせて`mock-dashboard.html`/`opportunity-detail.html`の`overrides`オブジェクトと`breakdownOverrides`にも`it-dx`キーを追加し、JSON取得失敗時のフォールバック表示も他業種と同水準にした。これにより、対応業種は製造業・建設業・士業・IT・DX支援の4業種になった（「その他」はPhase 2-4からAI Action Plan/Recommended Actionのみ対応のまま、変更なし）。
- **企業名パーソナライズ**：`changescout_profile`に`companyName`（企業名、任意項目）を追加。`company-profile.html`に入力欄を追加し、Dashboard 2箇所・Opportunity Detail 1箇所の固定デモ企業名「株式会社フィールドDX」を、入力があった場合のみ置き換える。未入力時は現状表示を維持。メール／トーク／提案資料生成テンプレート内の署名部分は今回のスコープ外（別途対応候補として`docs/strategy/FINAL_MVP_PLAN.md`に記載）。
- **AI表現の整合性**：Dashboard/Opportunity Detail/AI Transparency/AI Action Planの範囲を確認し、「AIが算出した貴社の機会スコア」を「AI推定による貴社の機会スコア」に修正（唯一の過大表現だった箇所）。他の「AI推定値」等の表記は既存のまま維持。LP・オンボーディング（`index.html`等）に残る同種の表現は今回のスコープ外とし、`docs/strategy/ROADMAP.md`のRemaining Issuesに記録した。
