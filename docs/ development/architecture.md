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
