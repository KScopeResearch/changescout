＃architecture.md

## 現在のアーキテクチャ（website/）

- 静的マルチページサイト（ビルドツール・バックエンドなし）。各HTMLファイルはインラインの`<style>`/`<script>`を持つ自己完結構成。
- ページ構成：`index.html`（LP）→ `company-profile.html`（会社プロフィール入力）→ `profile-complete.html`（登録完了・レポートプレビュー）→ `mock-dashboard.html`（ダッシュボード）→ `opportunity-detail.html`（詳細）
- パーソナライズは`localStorage`キー`changescout_profile`（`{industry, customerSegment, product, region}`）を介して行う。各ページの`personalizeFromProfile()`が業種別の`overrides`オブジェクトを参照し、DOM要素をidベースで書き換える。
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
