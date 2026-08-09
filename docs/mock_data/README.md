# mock_data について

## これは何か

`docs/mockups_v2/02_report_preview.md`（無料レポート画面）をはじめとする画面のHTML実装で
そのまま使える、**固定のダミーデータ（フィクスチャ）**。AIパイプライン（[05_ai_pipeline.md](../strategy_v2/05_ai_pipeline.md)）を
実際に動かさなくても、実データに近い構造でHTMLを組めるようにするための準備データであり、
本ドキュメント自体はまだHTML実装ではない。

- 実在企業は一切登場しない。会社名・ドメインはすべて架空（ドメインは`.example.jp`を使用し、
  実在ドメインと衝突しないようにしている）
- 制度名（ものづくり補助金、電子帳簿保存法、時間外労働上限規制など）は実在するが、
  出典URL（`source.example.com`配下）はすべてダミー。業界団体名（日本精密機械工業会、
  日本記帳代行サービス協会等）も架空
- `website/`配下は変更していない。commit・pushも行っていない

## ディレクトリ構成

```text
mock_data/
├── README.md         … 本ファイル（スキーマ説明）
├── CHANGELOG.md       … 変更履歴
├── 01_manufacturing.json
├── 02_construction.json
└── 03_service.json
```

## データ参照関係

v2.4でデータの重複を解消し、以下の参照関係に整理した。矢印は「参照する側 → 参照される側（正）」を表す。

```text
free_opportunity.evidence ──(source_id)──> source_pages（正）

paid_analysis.priority_matrix ──(opportunity_ids)──> paid_analysis.additional_opportunities（正）

free_opportunity
      │
      ↓ 登録
free_opportunity.extended_analysis
      │
      ↓ 有料化
paid_analysis
```

`evidence`と`priority_matrix`は、どちらも「参照するだけ」で実体データを持たない。
実体（引用元の詳細・Opportunityのタイトルや期待効果）は必ず`source_pages`・
`additional_opportunities`側にのみ存在する（詳細は「更新ルール」を参照）。

## 更新ルール

データを更新する際は、以下のルールを守ることで重複・不整合を防ぐ。

- **Opportunity情報は`additional_opportunities`のみ更新する。** `priority_matrix`は
  `opportunity_ids`（id配列）だけを持ち、タイトルや期待効果を直接保持しない
- **`priority_matrix`はIDだけ保持する。** 表示に必要なタイトル・期待効果は、描画側が
  `additional_opportunities`から都度解決する（`website/aor/assets/js/common.js`の
  `getOpportunityMap()`を参照）
- **source情報は`source_pages`のみ更新する。** 出典名・URL・`source_type`・`source_role`・
  `evidence_strength`はすべて`source_pages`側の責務であり、他の箇所に複製しない
- **`evidence`は`source_id`参照のみ保持する。** `evidence`配下には引用文（`quote`）と
  参照先の`source_id`のみを置き、出典名・URLを再掲しない（`resolveEvidence()`で結合する）

## スキーマバージョン 2.4（現行・品質改善版）

2026-08-05、実際の経営者・事業責任者が「自社向けに考えられた分析」と感じられる品質へ近づけるため、
スキーマを2段階で刷新した（v1.0からの破壊的変更）。詳細は[CHANGELOG.md](CHANGELOG.md)を参照。

**2.0での変更**
1. **情報源の拡張**: 企業公式サイトだけでなく、官公庁資料・業界団体レポート・大手ニュースを
   組み合わせて1つのOpportunityを裏付ける構造にした（`source_pages`・`evidence`に
   `source_type`/`source_role`を追加）
2. **無料版Opportunityの深掘り化**: 「関連度の高いOpportunityを3件、浅く紹介する」方式から、
   「最も関連性の高い1件を、なぜ今か・なぜこの会社かまで深掘りする」方式に変更した
   （`opportunities_open`配列 → `free_opportunity`単一オブジェクトへ変更）

**2.1での変更**
3. **登録直後の体験の再設計**: 「登録すると新しいOpportunityを1件開放する」（`paid_preview_opportunity`）
   という方式を廃止し、「無料版で見せた同じOpportunityの理解を深める追加分析」に変更した
   （フィールド名は当初`registration_bonus`。v2.3で`extended_analysis`に改名、後述）
4. **情報源の信頼度設計**: `source_pages`・`free_opportunity.evidence`の各要素に
   `evidence_strength`（primary/secondary/reference）を追加した

**2.2での変更**
5. **有料版専用データ`paid_analysis`を新設**: 無料版・登録特典が「1件のOpportunityを理解する」
   体験であるのに対し、有料版は「実際に動くための判断材料を提供する（意思決定支援）」という
   独自の価値を持つデータ構造にした。`additional_opportunities`（追加Opportunity2〜4件、軽量構造）・
   `priority_matrix`（効果×工数の優先順位マトリクス）・`roadmap`（30/60/90日の実行計画）・
   `execution_support`（人的支援メニュー）・`monitoring`（継続監視テーマ）の5フィールドで構成する

**2.3での変更（Phase1最終確定 — これ以降HTML実装開始まではスキーマ変更を想定しない）**
6. **`paid_analysis.decision_summary`を新設**: `paid_analysis`の**先頭**に配置する意思決定サマリー。
   `recommendation`/`recommended_timing`/`expected_impact`/`investment_level`/`reason[]`の5項目
7. **`registration_bonus` → `extended_analysis`へ改名**: 「登録の見返り（ボーナス）」ではなく
   「同じOpportunityの理解を広げる分析」であることを名称にも反映した
8. **`priority_matrix`を`opportunity_ids`参照方式から`items[]`埋め込み方式へ変更**: 各象限が
   `additional_opportunities`のidだけでなく、`title`・`expected_effect`を直接持つようにし、
   HTML側で結合処理をせずに描画できるようにした

**2.4での変更（品質改善 — HTML実装完了後のデータ重複解消）**

Phase1のHTML実装（`website/aor/`）が完了し、実際に描画してみたところ、v2.3で導入した
`priority_matrix.items[]`と`free_opportunity.evidence`の一部フィールドが、それぞれ
`additional_opportunities`・`source_pages`とデータを重複保持していることが分かった。
機能・UIは変更せず、**データ構造のみ**を正規化した。

9. **`priority_matrix`を`items[]`から`opportunity_ids`へ戻す（v2.3からの再変更）**: 各象限が
   `title`・`expected_effect`を埋め込む方式（v2.3）は`additional_opportunities`とのデータ重複を
   生んでいた。v2.4では象限が`opportunity_ids`（idの配列）のみを保持し、表示側が
   `additional_opportunities`から`Map`で解決する方式に戻した。**JSON構造としては旧v2.2と同じ
   `opportunity_ids`だが、解決方法がid検索の都度実行ではなく`Map`の事前構築に変わっている点が異なる**
10. **`source_pages`に`id`を追加**: `src-1`〜`src-N`形式の連番id
11. **`free_opportunity.evidence`を正規化**: `source_type`/`source_role`/`evidence_strength`/
    `citation_excerpt`/`source_name`/`source_url`という6項目の重複保持をやめ、
    `source_id`（`source_pages`のid参照）と`quote`（引用文）の2項目のみを保持する方式に変更した。
    出典名・URL・種別バッジは、描画時に`source_pages`から解決する

**⚠️ 破壊的変更のため、v1.0〜v2.3スキーマを前提に実装済みの既存HTMLはそのままでは動作しない。**
影響範囲は本READMEの「v1.0からの変更点」を参照。

## ファイル一覧

| ファイル | 業種 | 会社名（架空） |
|---|---|---|
| [01_manufacturing.json](01_manufacturing.json) | 製造業（精密部品） | 桜庭精密工業株式会社 |
| [02_construction.json](02_construction.json) | 建設業（総合建設） | 陽だまり建設株式会社 |
| [03_service.json](03_service.json) | サービス業（バックオフィス支援） | 清流バックオフィスサービス株式会社 |

3社は意図的に**人間レビューのステータスを分けている**（`05_admin_review.md`実装時に
異なる状態のテストデータとしてそのまま使えるようにするため）。

| 会社 | human_review.status | 用途 |
|---|---|---|
| 01_manufacturing | `approved`（承認済み） | 送信済み・受信者側画面（02〜04）の表示確認用 |
| 02_construction | `pending_review`（未レビュー） | レビューキュー一覧・詳細画面の初期状態確認用 |
| 03_service | `needs_revision`（差し戻し） | 差し戻し理由・修正フローの確認用 |

## JSON構造説明

### `meta`
生成日時・スキーマバージョン・業種カテゴリなどのメタ情報。`schema_version`は`"2.4"`。

### `company_profile`
[02_report_preview.md](../mockups_v2/02_report_preview.md)のヘッダー帯に対応。
`name_is_ai_estimated` / `industry_is_ai_estimated` / `business_summary_is_ai_estimated`は、
その項目がAI推定かどうかを示すフラグ（推定である旨の表示・訂正導線の出し分けに使う）。

### `source_pages`（v2.4で`id`追加 — 出典情報の唯一の正）
「参照元の開示」セクション（[04_company_analysis.md](../strategy_v2/04_company_analysis.md)の
「参照元の開示」）に対応。**企業自身の公開ページに限らず、この分析全体の根拠となった情報源すべて**
を対象とする。**出典名・URL・種別・信頼度はこの配列にのみ保持し、他の場所（`evidence`等）には
複製しない**（更新ルール参照）。各要素は以下を持つ。

- `id`（v2.4で追加）: `src-1`、`src-2`…の連番。`free_opportunity.evidence[].source_id`から参照される
- `source_type`: `company` / `government` / `industry_association` / `statistics` / `news` / `technology`
- `source_role`: `company_fact`（対象企業自身の事実） / `market_change`（Opportunityの根拠となる
  市場変化そのもの） / `industry_trend`（業界全体の傾向） / `evidence`（補強する追加的な裏付け）
- `evidence_strength`（v2.1で追加）: `primary` / `secondary` / `reference` の3段階。
  一次情報（`company`/`government`）は`primary`、業界情報（`industry_association`/`statistics`/
  `technology`）は`secondary`、ニュースは`reference`に統一している。AIパイプラインが根拠を
  組み立てる際、`primary`のソースを優先して使う設計（[04_company_analysis.md](../strategy_v2/04_company_analysis.md)
  「情報ソースの優先順位」）
- `label` / `url`: 出典名・出典URL
- `score`（Task10で追加）: 情報源の信頼度スコア（0〜100）。`scripts/generator/score-sources.js`の
  採点基準に準拠した目安値を手動で付与している（実データではないため実採点はしていない）
- `published_at`（Task10で追加）: 出典の公開・更新日時（ISO8601）。`scripts/generator/`の
  Validator（`validate-report.js`）が`source_pages`各項目に必須化したため追加した

### `ai_pipeline`
[05_ai_pipeline.md](../strategy_v2/05_ai_pipeline.md)の①〜④ステップの出力に相当する内部データ。

- `step1_company_analysis`: 会社解析結果
- `step2_industry_inference`: 業種推測（第一候補＋確信度、他候補）
- `step3_market_changes_candidates`: 関連度判定前の候補一覧。各候補には`sources_combined`
  （どの`source_type`を組み合わせて裏付けたか）を付与し、「ニュース単独を根拠にしない」原則
  （[04_company_analysis.md](../strategy_v2/04_company_analysis.md)の「情報源の利用条件」）が
  機能していることを示す。`selected_as_free_opportunity: true`の候補が`free_opportunity`の元になる。
  関連度「低」で除外された項目には`reason_excluded`を付ける
- `step4_relevance_summary`: 関連度の内訳集計
- `internal_confidence_score`: 社内専用の数値信頼度スコア（0〜100）。**受信者向け画面には
  表示しない**（[05_ai_pipeline.md](../strategy_v2/05_ai_pipeline.md)の「対外表示との使い分け」）

### `free_opportunity`（v2.0の中核的な変更点）
無料版で表示する、**最も関連性の高い1件を深掘りしたOpportunity**。
[07_free_report.md](../strategy_v2/07_free_report.md)「構成案（改訂: 1件深掘り方式）」に対応。

| フィールド | 内容 |
|---|---|
| `title` | Opportunityのタイトル |
| `why_now` | なぜ今この機会なのか（市場・制度側のタイミング） |
| `why_company` | なぜこの会社なのか（対象企業固有の事実との結びつき） |
| `market_change` | 根拠となる市場変化そのものの説明 |
| `evidence` | 根拠の配列（v2.4で正規化、次項参照）。**複数の情報源タイプを組み合わせる**ことを想定し、3社とも`government`+`company`（＋`industry_association`）の組み合わせにしている |
| `first_action` | 完全に具体的な、最初の実行アクション |
| `extended_analysis` | 登録直後に開放する追加分析（v2.1で追加、v2.3で`registration_bonus`から改名）。詳細は次項 |

旧`opportunities_open`（3件配列）・`opportunities_locked`（詳細データ付き2件）・
`paid_preview_opportunity`は本バージョンで**廃止**した。

#### `free_opportunity.evidence`（v2.4で正規化）

**変更点**: v2.3までは`source_type`/`source_role`/`evidence_strength`/`citation_excerpt`/
`source_name`/`source_url`の6項目を各要素が個別に保持しており、`source_pages`の内容と
重複していた。v2.4では**引用文と参照先idのみ**を保持する。

| フィールド | 内容 |
|---|---|
| `source_id` | `source_pages[].id`への参照（例:`"src-3"`） |
| `quote` | 引用文（旧`citation_excerpt`） |

```json
{ "source_id": "src-3", "quote": "DX枠については、生産設備のみならず…補助対象に含める" }
```

`source_type`・`source_role`・`evidence_strength`・出典名・URLは、描画時に`source_pages`から
`source_id`で引いて解決する（`website/aor/assets/js/common.js`の`resolveEvidence()`）。

#### `free_opportunity.extended_analysis`（v2.1で追加、v2.3で改名）

**名称変更**: 当初`registration_bonus`という名称だったが、「登録の見返り」ではなく
「同じOpportunityの理解を広げる分析」であることを反映し、`extended_analysis`に変更した。

登録直後、同じOpportunityについて**理解を一段深める**追加分析。新しいOpportunityの開放ではない
（[07_free_report.md](../strategy_v2/07_free_report.md)「登録直後の体験（追加分析）」）。

| フィールド | 内容 |
|---|---|
| `market_size` | このOpportunityが対象とする市場・機会の規模感 |
| `competition` | 同業他社の動き（定性的な位置づけ） |
| `risks` | 着手する上での想定リスク |
| `priority` | 他の検討テーマと比べてなぜこれを最優先とすべきか |
| `case_examples` | 参考となる公開事例。特定できない場合は「個社名までは特定していない」と正直に示す |
| `confidence_note` | どの情報源を組み合わせたか・情報が更新される可能性・人間が確認済みであることの説明。**免責文言ではなく分析品質の説明**として書く |

### `locked_opportunities`（変更）
「さらに検討可能なテーマ」。**タイトルのみ**を持つ軽量なオブジェクトの配列。
関連度・根拠・アクションのデータは一切持たせない（まだ深掘り分析していないテーマという位置づけ。
[07_free_report.md](../strategy_v2/07_free_report.md)「有料版へのブリッジ設計」）。

```json
{ "id": "locked-1", "title": "サプライチェーン再編に伴う新規取引機会" }
```

### `paid_analysis`（v2.2で追加、v2.3で構造確定）

有料版専用のトップレベルデータ。`free_opportunity`とは完全に別物であり、
「1件のOpportunityを理解する」（無料版・登録特典）体験の先にある**意思決定支援**の価値を担う
（[08_paid_report.md](../strategy_v2/08_paid_report.md)「`paid_analysis`のデータ構造」）。

```json
paid_analysis
├── decision_summary {}           … 意思決定サマリー（先頭に配置、v2.3で追加）
├── additional_opportunities []   … 追加Opportunity（2〜4件、軽量構造）
├── priority_matrix {}            … 効果×工数の2軸優先順位付け
├── roadmap {}                    … 30/60/90日の実行ロードマップ
├── execution_support []          … 人的支援メニューの一覧
└── monitoring []                 … 継続監視テーマの一覧
```

#### `decision_summary`（v2.3で追加、先頭に配置）

「結局どうすべきか」を一言に集約する、有料版画面の最上部に置くサマリー。
`additional_opportunities`・`priority_matrix`・`roadmap`を読み解かなくても、まずここだけで
意思決定の方向性が分かるようにする。

| フィールド | 内容 |
|---|---|
| `recommendation` | 推奨する打ち手そのもの（一文） |
| `recommended_timing` | いつ着手すべきか |
| `expected_impact` | 期待される効果 |
| `investment_level` | 必要な投資規模の目安（`低`/`中`/`高〜`等、自由記述） |
| `reason` | 上記の推奨に至った理由の配列。`additional_opportunities`や`priority_matrix`の結論を裏付ける形で書く |

#### `additional_opportunities`

`locked_opportunities`の実体版。各要素は`id`（`locked_opportunities`と対応するidを再利用）に加え、
以下4項目のみを持つ**軽量構造**（詳細分析は将来の拡張ポイントとして残す）。

| フィールド | 内容 |
|---|---|
| `title` | Opportunityのタイトル |
| `summary` | 概要（2〜3行） |
| `expected_effect` | 期待効果 |
| `relevance` | 関連度（`高`/`中`） |

3社とも、無料版で見せた`locked_opportunities`の2件（`locked-1`/`locked-2`）に加えて、
無料版では一切言及していない新規テーマを1件（`add-3`）追加し、計3件にしている。
「タイトルだけ知っていたものが開放される」体験と「有料版でしか分からない新しい発見がある」
体験の両方を作るための意図的な設計。

#### `priority_matrix`（v2.4で`opportunity_ids`方式に統一 — データの唯一の正は`additional_opportunities`）

効果×工数の2軸4象限（`high_impact_low_effort` / `high_impact_high_effort` /
`low_impact_low_effort` / `low_impact_high_effort`）で`additional_opportunities`を分類する。
図ではなくJSON構造で保持し、表示側（HTML）で可視化する設計。

**変更の経緯**: v2.2の`opportunity_ids`（idのみ）は、HTML側で1件ずつid検索して結合する必要があり
実装が煩雑だった。そこでv2.3では`title`・`expected_effect`を象限データに直接埋め込む`items[]`
方式に変更したが、これは`additional_opportunities`とのデータ重複を生んだ（同じ情報を2箇所で
更新する必要が生じる）。v2.4では**`opportunity_ids`（idの配列）のみを保持**する方式に戻し、
実装側では**事前に`Map`を1回構築してから参照する**ことで、id検索の煩雑さを解消しつつ重複も避ける。

```json
{ "label": "高効果・低工数（最優先）", "opportunity_ids": ["locked-1"] }
```

```javascript
// website/aor/assets/js/common.js の getOpportunityMap() を使用
const opportunityMap = getOpportunityMap(paidAnalysis.additional_opportunities);
const opp = opportunityMap.get("locked-1"); // { id, title, summary, expected_effect, relevance }
```

`additional_opportunities`側だけを更新すれば、`priority_matrix`側の表示内容も自動的に
最新化される（同じデータを2箇所で保守する必要がない）。

#### `roadmap`

`day_30` / `day_60` / `day_90`の3ブロック。各ブロックは`actions`（配列）と`expected_outcome`
（期待成果）を持つ。3社ともday_30の1つ目のアクションは、無料版`first_action`の実行を起点とする形にし、
無料版→登録特典→有料版の実行計画が一貫した流れになるようにしている。

#### `execution_support`

人が支援する内容の一覧。各要素は`label`（例:「追加調査」「営業資料作成」「提案書レビュー」
「市場調査」）と`description`（何を支援するかの一言）を持つ。3社とも4項目、内容は会社ごとに
個別化している。

#### `monitoring`

今後注視すべきテーマの一覧。各要素は`theme`（例:「法改正」「補助金」「競合動向」「業界ニュース」）と
`description`（具体的に何を監視するか）を持つ。3社とも4項目。Phase1では静的な一覧表示に留まり、
実際のアラート配信は行わない。

### `send_target`
送信先情報。[03_lead_generation.md](../strategy_v2/03_lead_generation.md)の適法な取得経路に
対応する`acquisition_route`と、オプトイン記録状況を持つ。`05_admin_review.md`の
「送信先情報」表示に対応。

### `human_review`
[06_human_review.md](../strategy_v2/06_human_review.md)のレビュー状態。

- `status`: `"approved"` / `"pending_review"` / `"needs_revision"` のいずれか
- `checklist`: レビューチェックリスト5項目（`06_human_review.md`と同一の5項目）。
  `pending_review`状態の会社では未確認項目を`null`にしている
- `review_history`: 承認履歴のログ配列（誰が・いつ・何をしたか）

### `evaluation`（Task10で追加）

`scripts/generator/quality-evaluator.js`が算出する品質評価結果。`{ score, grade, status,
reasons[], warnings[], improvements[], breakdown }`の形を持つ。採点基準・配点・
grade/statusの導出方法の詳細は[scripts/generator/README.md](../../scripts/generator/README.md)
「品質評価エンジン（quality-evaluator.js）」を参照（本READMEでは重複記載しない）。

3社とも`source_pages`にscore/published_atを追加した上で`quality-evaluator.js`を実際に実行し、
その出力をそのまま格納している（手作業での数値の捏造はしていない）。`website/aor/`のHTML側は
本フィールドを一切参照しない（社内向けの品質シグナルであり、受信者向け画面には表示しない設計。
[05_ai_pipeline.md](../strategy_v2/05_ai_pipeline.md)「対外表示との使い分け」と同じ考え方）。

## HTML実装（website/aor/）との対応

`website/aor/`配下の3画面（report-preview / email-capture / paid-preview）はv2.4スキーマに
対応済み（Phase5.1時点）。使用しているフィールドと解決方法は以下の通り。

| 画面 | 使用する主なフィールド | 備考 |
|---|---|---|
| `report-preview.js` | `company_profile`, `human_review`, `free_opportunity`（`evidence`は`resolveEvidence()`で`source_pages`と結合）, `locked_opportunities`, `source_pages` | |
| `email-capture.js` | `company_profile`, `free_opportunity.extended_analysis` | |
| `paid-preview.js` | `paid_analysis`全フィールド。`priority_matrix`は`getOpportunityMap()`で`additional_opportunities`と結合 | |

`opportunities_open`・`opportunities_locked`（旧構造）・`paid_preview_opportunity`・
`registration_bonus`・`priority_matrix.items`は、HTML側にも一切参照が残っていない
（Phase5.1で確認済み）。

## スキーマの安定性について

本ドキュメント（schema_version 2.4）をもって、`paid_analysis`関連の構造変更とデータ正規化は
完了した。`schema_version`自体は2.4のまま据え置いている（Task10での変更は既存フィールドの
改名・削除を伴わない**追加のみ**であり、`website/aor/`の表示ロジックにも影響しないため）。

- Task10（`scripts/generator/`側の品質評価エンジン導入）に伴い、`source_pages`各項目へ
  `score`/`published_at`を追加し、トップレベルに`evaluation`を追加した
- いずれも**追加のみ**で既存フィールドの改名・削除は伴わない。`website/aor/`のHTML/CSS/JSは
  本追加に合わせた変更を行っていない（参照していないフィールドのため）

今後スキーマを変更する場合は、既存の変更履歴と同様にCHANGELOG・README・
strategy_v2/mockups_v2側のドキュメント・`website/aor/`のJSを同時に更新する。

## 今回のスコープ外（未対応）

- 営業メール本文（件名・本文）そのもののドラフトは含めていない
- 根拠資料一覧（evidence横断集約）は`paid_analysis`に含めていない（[08_paid_report.md](../strategy_v2/08_paid_report.md)に
  記載のとおり「将来追加」の位置づけ）
- `additional_opportunities`の詳細分析（why_now/why_company相当の深掘り）は未着手。
  現状は`title`/`summary`/`expected_effect`/`relevance`の軽量構造のみ
