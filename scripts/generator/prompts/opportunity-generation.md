# opportunity-generation.md — 出力JSON構造の詳細定義

`schema_version 2.4`（[docs/mock_data/README.md](../../../docs/mock_data/README.md)）に準拠した、
`free_opportunity` / `locked_opportunities` / `paid_analysis`の3キーを出力してください。
`source_pages`・`company_profile`・`send_target`・`human_review`等は**あなたの出力対象外**です
（呼び出し側が別途組み立てます）。

## `free_opportunity`

最も関連性の高い1件を深掘りしたOpportunity。

```json
{
  "title": "Opportunityのタイトル（一文）",
  "why_now": "なぜ今この機会なのか（fact区分: company_contextの事実に基づく記述）",
  "why_company": "なぜこの会社なのか（fact区分: 対象企業固有の事実と結びつける）",
  "market_change": "根拠となる市場変化そのものの説明（fact区分）",
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

**`evidence`のルール**（[quality-rules.md](quality-rules.md)必須条件1〜5）:
- 最低4件を目安に、`company`・`government`または`statistics`・`industry_association`または
  `technology`の`source_type`を持つ`source_id`を組み合わせること（`news`単独は不可）
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

**`priority_matrix`のidルール**: `opportunity_ids`に登場する全てのidは、必ず
`additional_opportunities[].id`に実在すること。1つのidを複数の象限に重複して割り当てないこと。
4つの象限（`high_impact_low_effort`/`high_impact_high_effort`/`low_impact_low_effort`/
`low_impact_high_effort`）を全て出力すること（該当なしの象限は`opportunity_ids: []`でよい）。

## 出力例

3社分の実例（`docs/mock_data/01_manufacturing.json`等の`free_opportunity`・`paid_analysis`）が
参考になります。ただし、これらは架空企業の手作業データであり、実際の`company_context`とは
対応していません。**構造の参考としてのみ**扱ってください。
