# opportunity-generation.md — 出力JSON構造の詳細定義

`schema_version 2.4`（[docs/mock_data/README.md](../../../docs/mock_data/README.md)）に準拠した、
`free_opportunity` / `locked_opportunities` / `paid_analysis`の3キーを出力してください。
`source_pages`・`company_profile`・`send_target`・`human_review`等は**あなたの出力対象外**です
（呼び出し側が別途組み立てます）。

## `free_opportunity`

最も関連性の高い1件を深掘りしたビジネスチャンス。
**「対象企業がまだやっていない前向きな一手」**であり、既存事業の言い換えではない
（詳細は [quality-rules.md](quality-rules.md)「Opportunity と Market Change の質」）。

**読者は中小企業・店舗の経営者。テーマは「経営者が明日使える距離」に寄せること**
（quality-rules.md「ビジネスチャンスの『近さ』」/ RULE-THEME-1〜8）。
世界市場・国家戦略・巨大市場規模を `title` / `why_now` の主語にしない。
地域・商圏・業界レベルの変化を最低2件、具体的に挙げること。

```json
{
  "title": "Opportunityのタイトル（一文）。既存事業の言い換え・「〜の強化/拡販」だけは不可。AI活用・新規事業/商品化・市場拡張・業務変革・制度変化を捉えた一手のいずれかへ寄せる",
  "why_now": "なぜ今か（fact区分: 外部の変化＝市場・制度・技術・競合・需要 で説明する。会社の説明だけで終わらせない）",
  "why_company": "なぜこの会社なのか（fact区分: source_type:\"company\"/一次情報で会社の強み・立ち位置を述べ、それをtitleの方向へ発展させられる根拠を示す）",
  "market_change": "対象企業の外で起きている変化（市場規模・成長率の統計、制度・補助金・規制の変更、AI/技術トレンド、競合・顧客行動の変化）を、それを示すsource_idを添えて書く。会社の説明にしない。同名・別住所の別法人を『同業他社』にしない。【Rule16】score>=70 の外部市場source（government/statistics/industry_association、または score>=70 の news/technology）を最低1件、market_change の本文中に『（src-N）』の形で必ず明記する（evidence 配列に入れるだけでは不可）。【Rule17】補助金まとめ記事・補助金一覧記事だけで構成しない（市場・統計・政策・業界データを含める）。【Rule18】score>=70 の外部市場source が sources に無ければ『公開情報では十分な市場変化を確認できませんでした。』と書く（推測禁止）",
  "evidence": [
    { "source_id": "src-N", "quote": "根拠となる引用文（sources[].summaryやquoteから抜粋・要約）" }
  ],
  "first_action": "完全に具体的な、最初の実行アクション（action区分）",
  "extended_analysis": {
    "market_size": "市場規模の記述（analysis区分。根拠付き推論を許容）",
    "competition": "競合状況の記述（analysis区分）",
    "risks": "着手する上での想定リスク（analysis区分）",
    "priority": "他の検討テーマと比べてなぜこれを最優先とすべきか（analysis区分）",
    "case_examples": "参考となる公開事例。特定できない場合は正直にその旨を書く（analysis区分）",
    "confidence_note": "どの情報源を組み合わせたか・情報が更新される可能性の説明（analysis区分）"
  }
}
```

**`evidence`のルール**（[quality-rules.md](quality-rules.md)必須条件1〜5・Phase54ルール3・STEP8A.4）:
- **最低4件**（company 1件以上 + government/statistics/industry_association/news のうち score>=70・
  非reference のものを 2件以上 + score<=30 は最大1件）
- うち1件以上は非companyの関連source（`source_type`が`government`/`statistics`/
  `industry_association`/`technology`で、`evidence_strength:"reference"`でも`score<=30`でもないもの）
- `news`単独は不可、company sourceだけも不可
- `source_id`は必ず`company_context.sources[].id`に実在するものを使うこと

## `locked_opportunities`

「さらに検討可能なテーマ」。**タイトルのみ**を持つ軽量配列（2件を目安）。

```json
[
  { "id": "locked-1", "title": "テーマ1のタイトル" },
  { "id": "locked-2", "title": "テーマ2のタイトル" }
]
```

## `paid_analysis`

```json
{
  "decision_summary": {
    "recommendation": "推奨する打ち手そのもの（一文、analysis区分）",
    "recommended_timing": "いつ着手すべきか",
    "expected_impact": "期待される効果",
    "investment_level": "必要な投資規模の目安（低/中/高〜等、自由記述）",
    "reason": ["推奨に至った理由1", "理由2", "..."]
  },
  "additional_opportunities": [
    {
      "id": "locked-1",
      "title": "locked_opportunitiesの該当titleと同一にする",
      "summary": "概要（2〜3行、analysis区分）",
      "expected_effect": "期待効果",
      "relevance": "高 または 中"
    },
    { "id": "locked-2", "title": "...", "summary": "...", "expected_effect": "...", "relevance": "..." },
    { "id": "add-3", "title": "無料版では言及していない新規テーマ", "summary": "...", "expected_effect": "...", "relevance": "..." }
  ],
  "priority_matrix": {
    "quadrants": {
      "high_impact_low_effort": { "label": "高効果・低工数（最優先）", "opportunity_ids": ["..."] },
      "high_impact_high_effort": { "label": "高効果・高工数（計画的に着手）", "opportunity_ids": ["..."] },
      "low_impact_low_effort": { "label": "低効果・低工数（余力があれば）", "opportunity_ids": ["..."] },
      "low_impact_high_effort": { "label": "低効果・高工数（非推奨）", "opportunity_ids": ["..."] }
    }
  },
  "roadmap": {
    "day_30": { "actions": ["...", "..."], "expected_outcome": "..." },
    "day_60": { "actions": ["...", "..."], "expected_outcome": "..." },
    "day_90": { "actions": ["...", "..."], "expected_outcome": "..." }
  },
  "execution_support": [
    { "label": "追加調査", "description": "..." }
  ],
  "monitoring": [
    { "theme": "法改正", "description": "..." }
  ]
}
```

**`additional_opportunities`のidルール**: `locked_opportunities`と同じidを持つ要素を
必ず含め（内容は`locked_opportunities`のタイトルを引き継いだ詳細版）、それに加えて
`locked_opportunities`にはない新規テーマを1件以上（`add-3`、`add-4`…の連番id）追加すること。

**`priority_matrix`のidルール（内部参照整合性・厳守）**:
- `opportunity_ids`に書けるのは**`additional_opportunities[].id`（＝`locked-1`/`locked-2`/`add-3`…）だけ**。
- **存在しないidを作らないこと。** 特に `free-1` / `free-N` のような「無料版Opportunity（`free_opportunity`）」を
  指すidは**使わない**。`free_opportunity` は単一の項目であり、`priority_matrix` の対象外である。
- `priority_matrix` に何かを載せたい場合は、まずそのテーマを `additional_opportunities` に
  （`add-4` 等の連番idで）追加し、そのidを `opportunity_ids` に書くこと。
- 1つのidを複数の象限に重複して割り当てないこと（同一象限内でも重複させない）。
- 4つの象限（`high_impact_low_effort`/`high_impact_high_effort`/`low_impact_low_effort`/
  `low_impact_high_effort`）を全て出力すること（該当なしの象限は`opportunity_ids: []`でよい）。

## 出力例

3社分の実例（`docs/mock_data/01_manufacturing.json`等の`free_opportunity`・`paid_analysis`）が
参考になります。ただし、これらは架空企業の手作業データであり、実際の`company_context`とは
対応していません。**構造の参考としてのみ**扱ってください。
