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
- **`paid_analysis.priority_matrix` に存在しないidを書いてはならない**（Phase54 STEP5追加）:
  `priority_matrix.quadrants.*.opportunity_ids` に書けるのは `additional_opportunities[].id`
  （`locked-*` / `add-*`）だけ。`free-1` のような無料版Opportunity（`free_opportunity`）を指すidや、
  どこにも定義していないidを作らない。詳細は [opportunity-generation.md](opportunity-generation.md)
- **`evidence_strength: "reference"`のsourceのみを根拠に、対象企業固有の事実を断定してはならない**
  （PJ2 AOR追加。`source_type: news`単独を根拠にしないルールと同じ考え方を、
  `evidence_strength`にも適用したもの。検索結果には対象企業とは無関係な別企業の情報が
  混入することがあり、そのような情報は`reference`として区別されている。`reference`の
  sourceは、他の`primary`/`secondary`のsourceと組み合わせた補助的な裏付けとしてのみ使うこと）

## 関連性と会社適合（Phase53 STEP10.12で追加）

実データでのレポート生成で、対象企業と無関係な情報源（別地域の自治体補助金、同名の別会社・
別ブランド等）をOpportunityの根拠にしてしまう事故が確認された。以下を必ず守ること。

1. **未確認の会社能力を創作しない**: `sources`に根拠がない限り、「店舗ネットワークを持つ」
   「IoT構築を行っている」「顧客データを大量に保有している」「海外拠点を持つ」「○○業界に強い」
   等を事実としてOpportunityの根拠にしてはならない。確認できない場合は「公開情報からは
   確認できない」と明記する。
2. **会社固有の主張は`source_type: "company"`または一次情報に基づく**: `why_company`で
   述べる対象企業固有の事実は、必ず`source_type: "company"`のsource（会社自身のページ）か、
   それに準じる一次情報に裏付けられていなければならない。`why_company`のevidenceには
   最低1件の`source_type: "company"`を含めること。
3. **無関係な政府ページを会社のevidenceにしない**: `source_type: "government"`であっても、
   対象企業の所在地・業種・事業と結びつかないローカルな制度（例: 対象企業と無関係な市区町村の
   移住・定住・空き家補助金）を、対象企業固有のOpportunityの根拠として使ってはならない。
   `evidence_strength: "reference"`や`score`が低いsourceは、関連性が低いと判断された
   sourceである。主要な根拠にしない。
4. **会社適合が確認できない場合は情報不足と明記する**: `sources`から対象企業の事業内容が
   十分に分からず、企業実態と整合するOpportunityを構成できない場合は、無理に生成せず、
   `free_opportunity.why_now`にその旨（何の情報が不足しているか）を正直に記述する。
5. **日本政府の施策と中国政府の施策を取り違えない**: JLOX+・クールジャパン戦略・JETRO等は
   **日本政府・日本の公的機関**の施策である。sourceに書かれている施策の主体（どの国の政府か、
   どの機関か）を正確に保持し、「中国政府系助成金」「中国政府がクールジャパン戦略を公表」の
   ような主体の取り違えをしてはならない。sourceに書かれている主体とOpportunity内の主体を
   一致させること。

## Opportunity と Market Change の質（Phase54 STEP1で追加）

実データ生成で、Opportunityが「対象企業が既にやっている事業の言い換え」に、Market Changeが
「対象企業自身の説明」になってしまう事故が確認された（IL LEGAME・カレイドスコープ）。以下を守ること。

### Opportunity（`free_opportunity` / `locked_opportunities` / `paid_analysis`）

1. **既存事業の説明をOpportunityにしない**: `free_opportunity.title` および `locked_opportunities[].title`
   は、`company_profile.business_summary` や会社ページに書かれている「現在の事業内容」の言い換え・
   増強（「〜の強化」「〜の拡販」だけ）であってはならない。Opportunityとは、対象企業が**まだ
   やっていない/踏み込めていない前向きな一手**である。
2. **優先する方向性**: 次のいずれかに寄せること —
   (a) **AI/生成AIの活用・導入**（自社業務の変革、または顧客への提供）、
   (b) **新規事業・新サービスの立ち上げ／既存ノウハウの商品化・サービス化**、
   (c) **新しい市場・顧客セグメント・地域への拡張**、
   (d) **業務プロセスの変革・効率化**、
   (e) **制度変更・市場変化を捉えた新しい打ち手**。
   会社の強み（`source_type:"company"`で確認できる事実）を土台に、上記の方向へ**発展**させる。
3. **evidenceは2件以上、うち1件以上は非companyの関連source**: `free_opportunity.evidence` は
   最低2件。少なくとも1件は `source_type` が `government`/`statistics`/`industry_association`/
   `technology` で、かつ `evidence_strength: "reference"` でも `score <= 30` でもない
   （＝関連性が低いと判断されていない）source を含めること。company sourceだけ、
   または降格sourceだけを根拠にOpportunityを組み立ててはならない。
4. **`why_company`は土台、`why_now`は変化**: `why_company` は company/一次情報で会社の強み・
   立ち位置を述べる。`why_now` は「なぜ今か」を**外部の変化**（市場・制度・技術・競合・需要）で
   説明する。`why_now` が会社の説明だけで終わってはならない。

### Market Change（`free_opportunity.market_change`）

5. **市場変化は外部の変化であり、会社の説明ではない**: `market_change` には、対象企業の外で
   起きている変化（市場規模・成長率の統計、制度・補助金・規制の変更、AI/技術トレンド、
   競合や顧客行動の変化）を、**それを示すsourceのsource_idを添えて**書くこと。
6. **最低1件は外部市場source**: `market_change` は、`source_type` が `government`/`statistics`/
   `industry_association`/`technology` の source を最低1件引用する。`source_type:"company"` の
   source **だけ**で `market_change` を構成してはならない。外部の市場source が sources に
   無い場合は、`market_change` にその旨（「公開情報からは対象企業の市場に関する外部データを
   十分に取得できなかった」）を正直に書く。
7. **同名・別住所の企業を「同業他社」「競合」として扱わない**: sources に対象企業と同じ社名の
   別法人（所在地〔市区町村〕・事業内容が異なる）が含まれていても、それを対象企業の競合・
   同業他社として `market_change` に書いてはならない（例: 目黒区の声優事務所、渋谷区のWeb制作会社を
   千代田区のコンサル会社の同業他社としない）。

### Phase54 STEP8で追加した3ルール

8. **他社の製品名・サービス名をそのまま Opportunity のタイトルにしない**: sources に別の会社の
   具体的な商品名・サービス名（例: 「AI導入の立て直し」）が出てきても、それを対象企業が
   立ち上げるべき Opportunity の `title` にそのまま流用してはならない。Opportunity は対象企業
   固有の一手として、一般的な機能・価値で記述する（例: 「AI導入定着支援サービスの立ち上げ」）。
9. **market_change / why_now を、score が低い1件の source だけで組み立てない**:
   `evidence_strength: "reference"` や `score <= 30` の source は関連性が低いと判断されている。
   `market_change` と `why_now` の主軸は、`government`/`statistics`/`industry_association`/
   `technology` で reference/低score でない source に置くこと。低score source を「唯一の根拠」に
   しない。相応の外部 source が sources に無い場合は、その旨（市場変化に関する十分な外部データを
   取得できなかった）を正直に書く。
10. **中国の動画配信プラットフォームを「政府系」「国営」と記述しない**: bilibili（哔哩哔哩）、
    愛奇芸（iQIYI）、騰訊視頻（Tencent Video）、優酷（Youku）、芒果TV 等は**商業サービス**である。
    「中国政府系プラットフォーム」「中国国営プラットフォーム」等と記述してはならない。
    「中国の動画配信プラットフォーム」「中国のネット配信サービス」等と記述する。
    （規制・配信許可は国家広電総局が所管するが、それはプラットフォームが政府系であることを
    意味しない。規制の主体〈広電総局〉とプラットフォームの運営主体〈民間企業〉を混同しない。）

### Phase54 STEP8A.2 で追加した Hard Rules（主体帰属・捏造禁止）

これらは「守れなかった場合、レポートを送ってはいけない」レベルの必須ルールである。
validate-report.js がこれらの違反の一部を機械検出して **error（HOLD）** にする。

- **RULE-A（主体帰属を推測しない）**: 政府・自治体・企業・プラットフォームの「主体」を
  source に明示されていないのに付与してはならない。特に中国側の規制・機関と、日本側の
  政策・機関を**別の主体**として厳密に扱う。以下は禁止:
  - 「中国政府がクールジャパン戦略を公表」「中国政府系プラットフォーム」「中国政府系助成金」
  - 「日本政府が（実際は中国の）規制を実施」
  source に「A省が」「B機構が」と書いてあれば、その主体をそのまま保持する。書いていない場合は
  主体を特定せず「〜という制度がある」「〜の動きがある」と主体をぼかして書く。
- **RULE-B（クールジャパン戦略＝日本側）**: 「クールジャパン戦略」「JLOX+」「JETRO」「JLOD」は
  **日本政府・日本の公的機関**の施策・機関である。中国政府・中国当局の施策として記述してはならない。
- **RULE-C（中国の配信プラットフォーム）**: bilibili（哔哩哔哩）・愛奇芸（iQIYI）・騰訊視頻
  （Tencent Video）・優酷（Youku）・芒果TV 等は**民間の商業サービス**。source に「政府所有」
  「国営」「政府運営」と明記されていない限り、「政府系」「国営」と決めつけず、
  「中国の動画配信プラットフォーム」「中国の動画配信サービス」と中立に書く。
- **RULE-D（他社の固有名詞を流用しない）**: `title` / `first_action` / `why_now` / `why_company`
  に、検索で出てきた**別の会社の製品名・サービス名・キャッチコピー**をそのまま入れてはならない
  （例: 「AI導入の立て直し」）。対象企業の一手として、一般的な機能・価値で言い換える
  （例: 「AI活用型・新規事業立ち上げ支援」）。
- **RULE-E（Market Change を捏造しない）**: 外部市場 source（government/statistics/
  industry_association/technology・news 可で、reference/低score でないもの）が sources に
  1件も無い場合、`market_change` を無理に作ってはならない。
  「公開情報では、貴社の市場に関する十分な外部データを確認できませんでした。」等、
  情報不足を明記する。**別の会社の情報を市場変化として使って埋めてはならない。**
- **RULE-F（Evidence 不足時は推測で埋めない）**: 対象企業に関連する外部 relevant source が
  0件なら、`why_now` / `why_company` を推測で埋めず、確認できた事実だけを書く。

## 参照

- [system-analysis.md](system-analysis.md): システムプロンプト全体の構成
- [opportunity-generation.md](opportunity-generation.md): 出力すべきJSON構造の詳細定義
- [../prompt-company-analysis.md](../prompt-company-analysis.md): Task8時点で作成した設計ドキュメント（本ファイルの元になった6原則の初出）
