＃sample-data.md

Phase 2-2: [data-model.md](./data-model.md) のスキーマに沿ったサンプルデータ作成。MarketChangeの生データは [sample-market-changes.json](./sample-market-changes.json) に、Opportunity生成例とUI対応確認・次フェーズ提案はこのファイルにまとめる。**今回もデータ・ドキュメント作成のみで、実装変更は行っていない。**

## データ品質に関する注記

`sample-market-changes.json` の全10件は**公開情報ベースのサンプルデータ**であり、実在する制度改正・ニュースそのものではない。架空の制度・ニュース・市場規模・企業情報を事実として断定することは避け、各エントリの `source` に「（公開情報ベースのサンプル）」を明記した。実データ化する際は、記載した官公庁名等をそのまま信用せず、必ず一次情報（官公庁発表・公式文書）で裏取りすること。

## 1. MarketChangeサンプル（10件）

| id | 業種 | category | title |
|---|---|---|---|
| mc-001 | manufacturing | 補助金 | ものづくり補助金 対象要件拡大 |
| mc-002 | manufacturing | 制度改正 | 省エネ関連の報告義務見直し |
| mc-003 | construction | 法改正 | 建設業法改正（許可要件・取引適正化） |
| mc-004 | construction | 補助金 | 中小建設業者向けICT施工導入支援補助金 |
| mc-005 | professional | 制度改正 | 複数制度改正の同時実施 |
| mc-006 | professional | 法改正 | 電子帳簿保存法の運用見直し |
| mc-007 | it-dx | 税制改正 | 中小企業のDX推進を後押しする税制優遇拡充 |
| mc-008 | it-dx | 市場動向 | 中小企業向けサイバーセキュリティ対応の要請強化 |
| mc-009 | other | 市場動向 | 原材料・物流コスト上昇に伴う価格転嫁の動き |
| mc-010 | other | 制度改正 | 働き方改革関連ルールの適用範囲拡大 |

mc-001／mc-003／mc-005 は既存モック（`website/opportunity-detail.html` の manufacturing/construction/professional オーバーライド）と同一の内容を採用し、現行UIとサンプルデータの整合を取っている。mc-002・mc-004・mc-006〜mc-010 は今回新規に作成したサンプルで、IT/DX支援・その他BtoBを含む5業種区分（manufacturing/construction/professional/it-dx/other）をすべてカバーする。

## 2. Opportunity生成例（MarketChangeごとに1件）

各例は `MarketChange + CompanyProfile → Opportunity` の形式。CompanyProfileの空欄項目は「未入力」を意味し、その項目に由来する記述は追加しない（[data-model.md](./data-model.md) 3節のルールに準拠）。

**mc-001 + {業種: 製造業, 顧客層: 未入力, 商材: 未入力}**
タイトル：補助金対象企業へ営業メールを送信する
判断理由：補助金対象拡大により、対象となる製造業の見込み客の関心が高まっているため
推奨アクション：既存製造業顧客への情報提供を開始

**mc-002 + {業種: 製造業, 顧客層: 食品製造業, 商材: 生産管理システム}**
タイトル：省エネ報告対応にからめた提案機会
判断理由：報告様式見直しへの対応負担から、業務システムによる効率化ニーズが高まる可能性があるため
推奨アクション：食品製造業の既存顧客へ制度変更の周知と生産管理システムの提案を行う

**mc-003 + {業種: 建設業, 顧客層: 地域ゼネコン, 商材: 業務支援サービス}**
タイトル：制度変更対応に伴う顧客フォロー機会
判断理由：制度対応ニーズが発生する可能性
推奨アクション：既存顧客への情報提供

**mc-004 + {業種: 建設業, 顧客層: 未入力, 商材: 施工管理システム}**
タイトル：ICT施工導入補助金を切り口にした提案機会
判断理由：補助金新設によりICT施工導入のハードルが下がり、検討が進みやすくなっているため
推奨アクション：既存・見込み顧客へ補助金活用を前提とした導入提案を行う

**mc-005 + {業種: 士業, 顧客層: 未入力, 商材: 未入力}**
タイトル：顧問先企業へ制度改正の案内を送付する
判断理由：制度改正により、顧問先からの相談ニーズが高まる前に情報提供を行う好機であるため
推奨アクション：顧問先企業へ制度変更の案内を送付

**mc-006 + {業種: 士業, 顧客層: 小売業の顧問先, 商材: 未入力}**
タイトル：電子帳簿保存法対応の相談機会創出
判断理由：運用見直しにより顧問先から対応方法の問い合わせが増える可能性があるため
推奨アクション：小売業の顧問先を中心に運用見直しの影響を案内する

**mc-007 + {業種: IT・DX支援, 顧客層: 製造業・建設業向けDX導入支援, 商材: 未入力}**
タイトル：税制優遇を切り口にしたDX導入提案
判断理由：税額控除の適用要件緩和により、DX投資の意思決定ハードルが下がっている可能性があるため
推奨アクション：製造業・建設業向けの既存見込み客へ税制優遇の活用を前提とした導入提案を行う

**mc-008 + {業種: IT・DX支援, 顧客層: 未入力, 商材: セキュリティ診断サービス}**
タイトル：サプライチェーンセキュリティ対応の提案機会
判断理由：取引先からの対応要請が増えており、見込み客の検討が進みやすくなっている可能性があるため
推奨アクション：該当しそうな見込み客へセキュリティ診断サービスを案内する

**mc-009 + {業種: その他, 顧客層: 未入力, 商材: 未入力}**
タイトル：登録情報に関連する見込み客へ情報提供を行う
判断理由：検知された市場変化が貴社の登録情報と関連性が高いと判断されるため
推奨アクション：詳細を確認し、関連度の高い顧客へ情報提供を検討

**mc-010 + {業種: その他, 顧客層: 運送業の取引先, 商材: 勤怠管理システム}**
タイトル：適用拡大を切り口にした導入提案機会
判断理由：猶予終了により対応が必要になる企業が増える可能性があるため
推奨アクション：運送業の取引先を中心に対応状況を確認し、勤怠管理システムの導入を提案する

## 3. 現在のUIとの対応確認

| 画面 | UI要素 | データ項目 |
|---|---|---|
| Dashboard / Opportunity Detail | タイトル | `Opportunity.title`（元は `MarketChange.title` を流用） |
| Dashboard / Opportunity Detail | 判断理由 | `Opportunity.reason` |
| Dashboard / Opportunity Detail | 推奨アクション | `Opportunity.action` |
| Dashboard / Opportunity Detail | 影響 | `Opportunity.impact` |
| Dashboard / Opportunity Detail | 影響候補企業・想定売上機会 | `Opportunity.affected_company_estimate` / `Opportunity.estimated_revenue`（AI推定値） |
| Opportunity Detail | Evidence（根拠情報） | `MarketChange.evidence[]`（`source`/`published_date`を含む） |
| Opportunity Detail | AI Transparency：業種／顧客層／商材／営業地域 | `Opportunity.company_profile_snapshot`（＝生成時のCompanyProfile） |
| Opportunity Detail | AI Transparency：検知した市場変化 | `MarketChange.summary` |
| Opportunity Detail | AI Transparency：参照情報／分析タイミング | Opportunityに依らない固定ディスクロージャー（Generation metadata） |

## 4. Phase 2-3提案（優先順位）

1. **JSONデータをHTMLから読み込む**：今回作成した `sample-market-changes.json` を`mock-dashboard.html`/`opportunity-detail.html`から`fetch`し、現行の`overrides`ハードコードの置き換え先として使う。変更範囲が読み込み処理に限定でき、最もリスクが低く次の検証に直結するため最優先。
2. **Opportunity生成ロジック作成**：本ドキュメントの10件のOpportunity生成例をルール化し、`MarketChange × CompanyProfile.industry` からOpportunityを機械的に組み立てる関数を作る（customerSegment/product/regionの補完レイヤーは現行ロジックを踏襲）。
3. **localStorageプロフィールとの接続の刷新**：現状「`overrides[profile.industry]`を直接参照」している配線を、1・2で作った「JSON読み込み→Opportunity生成」経由に切り替える。既存のプロフィール読み込み自体は変更不要なため、優先度は3番目。
4. **API化準備**：MVP検証（Phase 2）の段階ではまだ早い。実データ・実ユーザーでの価値検証（Phase 2 の目的）が済んでからバックエンド化を検討するのが妥当なため、最も優先度が低い。
