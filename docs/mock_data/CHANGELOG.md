# CHANGELOG（docs/mock_data）

## 2026-08-06（2）— Task10: score/published_at追加＋evaluation追加（schema_version据え置き）

`scripts/generator/`にTask9で導入したValidator（`source_pages`の`score`/`published_at`必須化）に
より、Task9より前に手作業で作成した3社分のJSONがFAILする状態になっていた
（[../../scripts/generator/README.md](../../scripts/generator/README.md)の既知の制約として記録済み）。
Task10（品質評価エンジン`quality-evaluator.js`の導入）に合わせて、この既知の制約を解消した。
機能・UI・既存フィールドの意味は変更していない（追加のみ）。

### 主な変更

1. **`source_pages`各項目に`score`（0〜100）・`published_at`（ISO8601）を追加**:
   `scripts/generator/score-sources.js`の採点基準に準拠した目安値を手動で付与した
2. **トップレベルに`evaluation`を追加**: `scripts/generator/quality-evaluator.js`を実際に実行し、
   その出力（`{score, grade, status, reasons[], warnings[], improvements[], breakdown}`）を
   そのまま格納した（手作業での数値の捏造はしていない）
3. `schema_version`は`"2.4"`のまま据え置き（既存フィールドの改名・削除を伴わない追加のみのため）
4. 3社とも`scripts/generator/validate-report.js`で`検証結果: PASS`になることを確認した

### 各社の評価結果

| ファイル | evaluationスコア | grade | status | human_review.status |
|---|---|---|---|---|
| 01_manufacturing.json | 96 | A | PASS | approved |
| 02_construction.json | 91 | A | PASS | pending_review |
| 03_service.json | 84 | B | PASS | needs_revision |

03_service.jsonは`human_review.status`が`needs_revision`のままでも`evaluation.status`が`PASS`に
なる（情報源・根拠の質そのものは十分だが、レビュー担当者が指摘した出典の古さの確認が未完了、
という状態を意図的に表現している）。これは既存の`human_review`に関するレビューフローの説明と
矛盾しない（`evaluation`は情報の質、`human_review`は配信可否の最終判断という別軸のため）。

### 変更ファイル（今回分）

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`

---

## 2026-08-06 — スキーマv2.4: データ重複解消（Phase5.1品質改善）

Phase5でHTML実装（`website/aor/`）が完了した後、実際の描画結果を踏まえてデータ重複を解消した。
機能・UI・仕様は変更していない。対応するドキュメント・HTML側の変更は
[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)を参照。

### 主な変更

1. **`priority_matrix`を`items[]`から`opportunity_ids`へ変更**: v2.3で導入した、各象限に
   `title`/`expected_effect`を埋め込む方式は`additional_opportunities`とのデータ重複を生んでいた。
   v2.4では`opportunity_ids`（idの配列）のみを保持し、`additional_opportunities`を唯一の正とする
2. **`source_pages`に`id`を追加**: `src-1`〜`src-N`の連番id
3. **`free_opportunity.evidence`を正規化**: `source_type`/`source_role`/`evidence_strength`/
   `citation_excerpt`/`source_name`/`source_url`の6項目保持から、`source_id`+`quote`の2項目のみへ
4. `meta.schema_version`を`"2.3"`から`"2.4"`へ、`meta.pipeline_version`を
   `"phase1-dummy-v2.3"`から`"phase1-dummy-v2.4"`へ更新

### 変更ファイル（今回分）

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`

---

## 2026-08-05（4）— スキーマv2.3: paid_analysisの最終確定（Phase1最終）

HTML実装開始後にスキーマ変更が発生しない状態にすることを目的に、`paid_analysis`を最終確定した。
対応する戦略ドキュメント・画面仕様の変更は[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)を参照。

### 主な変更

1. **`paid_analysis.decision_summary`を先頭に追加**: `recommendation`/`recommended_timing`/
   `expected_impact`/`investment_level`/`reason[]`の5項目。3社ともAI推奨の打ち手を1文で集約し、
   優先順位マトリクスの結論と整合する理由を添えた
2. **`registration_bonus` → `extended_analysis`へ改名**: `free_opportunity`配下のキー名を変更。
   3社とも同一の内容のまま、キー名のみ変更した
3. **`priority_matrix`を`opportunity_ids`参照方式から`items[]`埋め込み方式へ変更**: 各象限が
   `id`/`title`/`expected_effect`を直接持つようにし、`additional_opportunities`との突き合わせ
   処理なしでHTML描画できるようにした
4. `meta.schema_version`を`"2.2"`から`"2.3"`へ、`meta.pipeline_version`を
   `"phase1-dummy-v2.2"`から`"phase1-dummy-v2.3"`へ更新

### 変更ファイル（今回分）

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`

---

## 2026-08-05（3）— スキーマv2.2: 有料版データ構造`paid_analysis`を新設

有料版（paid-preview）のデータ構造を確定した
（[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)参照）。
3社分のJSONフィクスチャに`paid_analysis`を追加した。

### 主な変更

1. **`paid_analysis`を新設**: `free_opportunity`とは別の、有料版専用データ。
   `additional_opportunities`（追加Opportunity、タイトル・概要・期待効果・関連度の軽量構造で
   2〜4件）・`priority_matrix`（効果×工数の2軸4象限、JSON構造で保持）・`roadmap`（30/60/90日の
   実行計画）・`execution_support`（人的支援メニュー一覧）・`monitoring`（継続監視テーマ一覧）の
   5フィールドで構成
2. 3社とも`locked_opportunities`の2件を`additional_opportunities`に引き継ぎ（同一`id`）、
   無料版では未言及の新規テーマを1件追加して計3件にした
3. `roadmap.day_30`の起点として、3社とも無料版`first_action`の実行を組み込み、
   無料版→登録特典→有料版の実行計画に一貫性を持たせた
4. `meta.schema_version`を`"2.1"`から`"2.2"`へ、`meta.pipeline_version`を
   `"phase1-dummy-v2.1"`から`"phase1-dummy-v2.2"`へ更新

### 変更ファイル（今回分）

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`

---

## 2026-08-05（2）— スキーマv2.1: 登録直後の体験再設計（registration_bonus）＋信頼度設計

「登録直後の体験」の再設計（[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)参照）を受けて、
3社分のJSONフィクスチャを更新した。

### 主な変更

1. **`free_opportunity.registration_bonus`を追加**: `market_size`/`competition`/`risks`/
   `priority`/`case_examples`/`confidence_note`の6項目。旧`paid_preview_opportunity`
   （登録直後に新しいOpportunityを1件開放する方式）は復活させず、廃止したままとした
2. **`confidence_note`**: どの情報源を組み合わせたか・情報が更新される可能性・人間が確認済みで
   あることを説明する文言を3社とも追加。免責文言ではなく分析品質の説明として記述した
3. **`evidence_strength`を追加**: `source_pages`および`free_opportunity.evidence`の各要素に
   `primary`/`secondary`/`reference`の3段階を付与。`company`/`government`型は`primary`、
   `industry_association`/`statistics`/`technology`型は`secondary`、`news`型は`reference`に統一した
4. `meta.schema_version`を`"2.0"`から`"2.1"`へ、`meta.pipeline_version`を
   `"phase1-dummy-v2"`から`"phase1-dummy-v2.1"`へ更新

### 変更ファイル（今回分）

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`

---

## 2026-08-05 — スキーマv2.0: 情報源拡張＋無料版1件深掘り化

実際の経営者・事業責任者が「自社向けに考えられた分析」と感じられる品質に近づけるための
設計変更（[../strategy_v2/CHANGELOG.md](../strategy_v2/CHANGELOG.md)、
[../mockups_v2/CHANGELOG.md](../mockups_v2/CHANGELOG.md)参照）を受けて、3社分の
JSONフィクスチャを全面的に作り直した。

### 主な変更

1. **情報ソース範囲の拡張**: `source_pages`に`source_type`（company/government/
   industry_association/statistics/news/technology）と`source_role`（company_fact/
   market_change/industry_trend/evidence）を追加。3社とも官公庁資料・業界団体レポート・
   ニュースを組み合わせた構成に変更
2. **無料版Opportunityの深掘り化**: `opportunities_open`（3件配列）を廃止し、
   `free_opportunity`（title, why_now, why_company, market_change, evidence, first_action の
   単一オブジェクト）に置き換え。3社とも「一次情報＋企業自身の事実＋業界情報」を
   組み合わせた根拠（evidence配列）を持たせた
3. **ロックOpportunityの軽量化**: `opportunities_locked`（詳細データ付き2件）と
   `paid_preview_opportunity`（登録直後の即時開放用）を廃止し、`locked_opportunities`
   （タイトルのみの2件配列）に統合
4. **ai_pipeline.step3_market_changes_candidates の拡張**: 各候補に`sources_combined`
   （組み合わせた情報源タイプ）と`selected_as_free_opportunity`フラグを追加し、
   「ニュース単独を根拠にしない」原則の適用状況を追跡可能にした
5. `meta.schema_version`を`"1.0"`から`"2.0"`へ、`meta.pipeline_version`を
   `"phase1-dummy-v1"`から`"phase1-dummy-v2"`へ更新

### 破壊的変更（既存HTMLへの影響）

`website/aor/`配下の既存3画面（report-preview.html / email-capture.html / paid-preview.html）は
旧スキーマ（`opportunities_open` / `opportunities_locked` / `paid_preview_opportunity`）を前提に
実装されており、本変更によりそのままでは正しく動作しなくなる。詳細は
[README.md](README.md)の「v1.0からの変更点（既存HTMLへの影響）」を参照。
HTML側の追従は本コミットのスコープ外。

### 変更ファイル

- 更新: `README.md`, `01_manufacturing.json`, `02_construction.json`, `03_service.json`
- 新規: `CHANGELOG.md`（本ファイル）
