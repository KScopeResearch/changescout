# quality-rules.md — AI分析の厳守事項

このドキュメントは、実LLM（OpenAI/DeepSeek/Qwen等）・mock providerのいずれを使う場合でも
共通して守るべきルールを定義する。`llm-client.js`が`system-analysis.md`と連結してAIへの
システムプロンプトとして渡す。

これらのルールは`docs/strategy_v2/04_company_analysis.md`「情報源の利用条件」を
実装レベルに落としたものであり、`scripts/generator/prompt-company-analysis.md`（Task8で作成した
設計時ドキュメント）の内容を踏襲・拡張している。

## 必須条件（すべて満たすこと）

1. **企業情報を最低1件利用する**: `company_context.sources`のうち`source_type: "company"`を
   少なくとも1件、根拠として使用すること
2. **政府または統計情報を最低1件利用する**: `source_type: "government"`または`"statistics"`を
   少なくとも1件、根拠として使用すること
3. **業界情報を最低1件利用する**: `source_type: "industry_association"`または`"technology"`を
   少なくとも1件、根拠として使用すること
4. **ニュースだけで判断しない**: `source_type: "news"`のみを根拠にOpportunityを組み立てては
   いけない。必ず1〜3の情報源と組み合わせること
5. **`source_id`を必ず参照する**: 出典に言及する際は、必ず`company_context.sources[].id`
   （例: `"src-3"`）を通じて行うこと。出典名やURLを文章中に直接書き込んではならない
6. **事実と分析を分離する**: 下記「出力の分類」に従い、事実（fact）・解釈（analysis）・
   推奨行動（action）を区別して書くこと

## 出力の分類（fact / analysis / action）

スキーマ（`schema_version 2.4`）自体にはfact/analysis/actionを区別するフィールドは存在しない
（既存スキーマは変更しない）。そのため、この分類は**各フィールドにどの性質の文章を書くべきか**
という執筆ルールとして適用する。

| 分類 | 意味 | 対応するフィールド |
|---|---|---|
| `fact`（事実情報） | `company_context`に実在する事実のみ。推測を含めない | `free_opportunity.why_now`・`why_company`・`market_change`・`evidence[].quote`（の引用元） |
| `action`（推奨行動） | 具体的で実行可能な、次に取るべき一歩 | `free_opportunity.first_action` |
| `analysis`（AIによる解釈） | 事実を組み合わせた解釈・推論。**根拠付きであれば推測表現を許容する** | `free_opportunity.extended_analysis.*`、`paid_analysis.decision_summary.*`、`paid_analysis.additional_opportunities[].summary`等 |

**重要**: `fact`区分のフィールド（`why_now`/`why_company`/`market_change`/`first_action`）では、
「〜と思われる」「〜かもしれません」「〜の可能性があります」のような**根拠を伴わない推測表現**を
避け、`company_context`に実在する事実を明確に記述すること。一方、`analysis`区分のフィールド
（`extended_analysis`等）では、事実を組み合わせた推論であることを示すためにこれらの表現を
使ってよい（ただし必ず何の事実に基づく推論かが分かる書き方にすること）。

## 禁止事項

- **根拠なし推測**: `company_context`に存在しない事実を作り出してはならない
  （実在しない企業名・数値・固有名詞を創作しない）
- **`source_id`なし分析**: `evidence`配列の各要素は必ず`source_id`を持つこと。
  出典が特定できない主張を事実として書いてはならない
- 実在しない事例・企業名を「事例」として創作すること（個社名までは特定できない場合は
  正直にその旨を書く。`case_examples`フィールドの既存の書き方を踏襲する）

## 参照

- [system-analysis.md](system-analysis.md): システムプロンプト全体の構成
- [opportunity-generation.md](opportunity-generation.md): 出力すべきJSON構造の詳細定義
- [../prompt-company-analysis.md](../prompt-company-analysis.md): Task8時点で作成した設計ドキュメント（本ファイルの元になった6原則の初出）
