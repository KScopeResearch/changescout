# Phase55 STEP5 — A/B UX Test + KPI Baseline

作成: 2026-09-08 / 評価者: Claude Code / 対象ブランチ: `feature/aor-pipeline`

> 本STEPは **評価・確定フェーズ**。Production Mutation = 0 / AI・Tavily・Search API = 0 /
> 本番送信 = 0 / コード変更 = 0（評価用スクリプトのみ実行、artifact 追加のみ commit）。

---

## 1. Git baseline

| 項目 | 値 |
|---|---|
| HEAD | `529a78a` test(aor): make preview/email tests hermetic (tracked fixtures, no untracked data) |
| Branch | `feature/aor-pipeline` |
| Ahead / Behind（vs origin/feature/aor-pipeline） | 0 / 0 |
| origin/main | 未変更（`b2e24fc`） |
| `git diff --check` | clean |

作業前の working tree の `M`（logs / output / quality-report.md）は Phase54 以前からの未コミット差分で、本STEPでは触れていない。

---

## 2. Evaluation scope

評価対象は Phase55 STEP3（Preview）+ STEP4（Email）の実装済みコード。

| 面 | 主要ファイル |
|---|---|
| Preview | `website/aor/report-preview.html` / `assets/js/report-preview.js` / `assets/js/preview-ui.js` / `assets/js/market-stats.js` / `assets/js/illustrations.js` / `assets/css/preview-conversion.css` |
| Email | `scripts/generator/shared/report-teaser.js` / `shared/market-numbers.js` / `leads/email-render.js` / `leads/send-initial-report.js` / `leads/send-weekly-report.js` |

評価データ: RC1 published レポート3社（tracked test fixture `scripts/generator/test/fixtures/aor/` = published と同一内容、illegame の壊れ `business_summary` のみ個人情報をダミー化）。

```
kscope.co.jp   株式会社カレイドスコープ   theme=ai_dx     Hero=A
ab-i.jp        株式会社ABI               theme=overseas   Hero=B
illegame.com   株式会社イル・レガメ       theme=ai_dx     Hero=A
```

Preview の実ブラウザ描画は **不可**（Claude ブラウザ拡張が未接続）。§9 は静的 CSS / DOM 検査のみで、目視確認済みとは記載しない。

---

## 3. 3-company Preview evaluation

Preview 描画順（実装）: Hero → ①この機会 → ②市場で起きていること → ③なぜ御社か → ④今日できること → ⑤根拠(折りたたみ) → ⑥情報源(折りたたみ) → ⑦人による確認 → ⑧ほかのテーマ → ⑨CTA。
→ **「結論→根拠」順が成立**（情報源は結論より後・折りたたみ）。

### 5-1. Hero 評価

| 要素 | kscope | ab-i | illegame |
|---|---|---|---|
| eyebrow | 「御社向け 市場機会レポート」（製品ラベルでなく価値ラベル）✓ | ✓ | ✓ |
| company（`<name> 様へ`） | ✓ | ✓ | ✓ |
| headline | A型: 「AI活用型・新規事業開発支援サービスに、御社が取り組める余地があります。」 | B型: 「世界の海外アニメ市場は 約6兆円。この変化に、御社が取れる一手があります。」 | A型: 「中小企業向けAI活用型・業務効率化コンサルティングサービスに、御社が取り組める余地があります。」 |
| Opportunity Pill（「この機会」+ title） | ✓ | ✓ | ✓ |
| subheadline（why_company 1文目） | ✓ | ✓ | ✓ |
| hero illustration（theme別 inline SVG） | ai_dx | overseas | ai_dx |
| badges（先頭 stat + 運営確認済み） | 「2割」+「運営 確認済み」 | 「約6兆円」+「運営 確認済み」 | 「17兆3,777億9,000万米ドル」+「運営 確認済み」⚠ |
| inline CTA「▸ この機会を詳しく見る」 | ✓ | ✓ | ✓ |

**Hero NG チェック**（STEP5-A の NG 例）:

| NG項目 | kscope | ab-i | illegame |
|---|---|---|---|
| 会社名だけが大きい | 回避（headline が最大要素） | 回避 | 回避 |
| Opportunity が見つけにくい | 回避（Pill で明示） | 回避 | 回避 |
| Opportunity title が本文サイズ | 回避（Pill・oppv2__title=1.28rem） | 回避 | 回避 |
| 情報源が先に見える | 回避 | 回避 | 回避 |
| CTA が先に出て意味不明 | 回避（inline CTA は機会文脈の後） | 回避 | 回避 |
| product/system 説明が価値より目立つ | 回避 | 回避 | 回避 |
| **数字が信じ難いスケール** | — | — | **該当**: Hero badge / stat card が「17兆3,777億9,000万米ドル」。日本の中小企業向けレポートで米ドル建て17兆＝現実味が薄い（P2・別トラック既知） |

### Preview per-section 所見

- **kscope**: whyNow が長文（VM で約230字）だが読める。stats が「2割 / 8割」= 新規事業成功率で、これは *市場規模* ではなく *成功比率*。「市場で起きていること」セクションの主役数字としては弱い（P2）。比較バー無し（multiple 無し）。first_action 2ステップに分割成功。
- **ab-i**: 最も強い。stats = 約6兆円 / 2.17兆円 / 約3倍、`multiple` があるので比較バー（現在→目標 約3倍、fill 33%）が出る。whyNow に補助金・国家目標・26%成長と具体。first_action 2ステップ。overseas illustration 妥当。
- **illegame**: whyNow は白書引用で説得力あり。ただし stat card が USD 兆単位2枚 + CAGR8.0%。USD 巨大数値は Email teaser では除外されるが **Preview では表示される**（既知 NOTE）。§9 に mobile overflow リスクを記載。

### Preview 10-second test（Q1自社向け / Q2 Opportunity / Q3 なぜ今 / Q4 なぜ自社 / Q5 次の行動）

| | Q1 | Q2 | Q3 | Q4 | Q5 |
|---|---|---|---|---|---|
| kscope | YES | YES | PARTIAL（whyNow は濃いが、数字が「2割/8割」で市場変化として弱い） | YES | YES |
| ab-i | YES | YES | YES | YES | YES |
| illegame | YES | YES | PARTIAL（whyNow は明確だが stat card の米ドル17兆が理解の邪魔） | YES | YES |

---

## 4. 3-company Email evaluation

Email 本文構造（実出力を確認）: 宛名 → 「機会を1件に絞って整理」→ ― 今回の機会 ―（title）→【なぜ今か】→【なぜ御社か】→【市場の動き】→「このレポートで整理していること」4点 → ▼CTA（reportUrl）→ ※運営確認済み → 配信停止（URL + 返信）→ 運営事務局。

- **Subject（3社共通形）**: `【<会社名> 様】御社に関係する新しい市場機会を整理しました`（44字以内、煽り無し、宛名 + 「市場機会」明示）
- **Preheader（共通）**: `御社の事業との接点が考えられる市場機会と、いま起きている変化を1件に絞って整理しました。`
- **CTA**: `▼ このOpportunityの詳細を見る` + URL（`report-preview.html?company=&lead=&token=` 保持）
- **Human Review**: `※ 2026年9月8日、運営がこのレポートの内容と出典を確認しました`
- **Unsubscribe**: URL リンク + 「本メールへの直接のご返信でも承ります」両方保持

### Email 10-second test（YES / NO）

| 質問 | kscope | ab-i | illegame |
|---|---|---|---|
| Q1. 自社向けメールと分かる | YES | YES | YES |
| Q2. 新しい市場機会のメールと分かる | YES | YES | YES |
| Q3. 何が機会か分かる | YES | YES | YES |
| Q4. なぜ今見る価値があるか分かる | PARTIAL（whyNow の数字が「2割/8割」で弱い） | YES | YES（白書「現状維持は最大のリスク」） |
| Q5. Preview を開く理由がある | YES | YES | YES |

### Email 個社所見

- **kscope**: 【市場の動き】が「2割（割合） / 8割（割合）」。ラベルが両方「割合」で情報量が薄い。誤りではないが訴求は弱い（P2）。
- **ab-i**: 【なぜ今か】が `…プロモーション…` で **文の途中で切れている**（excerpt の文境界処理・既知 NOTE、P2）。【市場の動き】「約6兆円 / 2.17兆円（海外アニメ市場）」は良い。
- **illegame**: 【市場の動き】「CAGR8.0%（サービス需要） / 8割半ば（割合）」。「8割半ば」は白書の「2040年に雇用者数が2018年比8割半ばへ減少」の一部で、単独では意味が取りにくい（P2）。米ドル17兆は正しく除外されている ✓。

---

## 5. 10-second test サマリ

- Preview: ab-i = 5/5 YES。kscope / illegame = 4 YES + 1 PARTIAL（いずれも Q3「なぜ今」＝数字の質）。NO は 0。
- Email: ab-i / illegame = 5/5 YES（ab-i は文切れの表記 P2 あり）。kscope = 4 YES + 1 PARTIAL。NO は 0。
- **Opportunity・Why You・CTA・Preview を開く理由は3社すべてで成立。** 弱点は「市場変化の数字の質」に集中（kscope=比率のみ / illegame=非現実的スケールの USD）。これは Report 生成側（別トラック）の課題で、Preview/Email の UI 実装の欠陥ではない。

---

## 6. Hero A / B / C evaluation

現行実装: **A = デフォルト**、`market_change` 等に size/growth 系の円建て数値が2つ以上あれば **B へ自動切替**（`pickHeroVariant`）、`confidence_note` に留保があれば A の subheadline に確信度1行（C の誠実さを部分採用）。C は独立 variant としては未実装。

実データ割当: kscope → A / ab-i → B / illegame → A（USD は円建て momentum に数えないため B にならない = 意図どおり）。

| 評価軸（1–5） | Hero A（営業提案書） | Hero B（市場インサイト） | Hero C（AIアナリスト） | 根拠（1行） |
|---|---|---|---|---|
| 自分向け感 | 4 | 4 | 3 | A/B とも冒頭が「<社名> 様へ」+ Opportunity Pill。C は「発見1件・根拠4件」が主語で会社が後退。 |
| Opportunity 明確さ | 5 | 4 | 4 | A は headline 自体が Opportunity の平叙文。B は headline が市場数字で Opportunity は Pill に降りる。 |
| なぜ今 明確さ | 3 | 5 | 3 | B は headline に市場数値が出るので「今」が一目。A/C は本文（①この機会）まで読む必要。 |
| 営業提案書感 | 5 | 4 | 2 | A は「御社が取り組める余地があります」で提案トーン。C は分析レポートトーン。 |
| ビジュアルインパクト | 4 | 5 | 3 | B は大きな市場数字 + 比較バー。illustration は3案共通。 |
| CTA 明確さ | 4 | 4 | 4 | inline CTA 文言は3案共通「▸ この機会を詳しく見る」。 |
| 情報過多にならない | 4 | 4 | 3 | C は「根拠4件・確信度・locked件数」を Hero に集めるため密度が上がる。 |
| 総合 | **4.1** | **4.3** | **3.1** | — |

**候補別ラベル**: A = **Strong** / B = **Strong**（数値が強い会社限定）/ C = **Weak**（独立実装の価値が低い。誠実さは既に A に部分移植済み）。

**Recommended Hero: 現行の「A デフォルト + B 自動切替」を維持**（＝新規実装なし）。3社のうち B が有効なのは ab-i のみ、A が自然なのは kscope / illegame。C を独立 variant として起こす必要は現時点でない。

---

## 7. CTA C-1 / C-3 / C-8 evaluation

現行実装の CTA 文言:
- Hero inline: `▸ この機会を詳しく見る`
- 中間 / 下部ボタン: `このOpportunityをさらに詳しく見る（市場規模・競合・リスク｜無料）`
- Email: `▼ このOpportunityの詳細を見る`
- 遷移先: 3箇所すべて `email-capture.html?company=<slug>&lead=<lead>&token=<token>`（RC1 と同一・`wireCtas()` で配線）

現行はいずれも **C-1（好奇心・得られる中身を列挙）** の系統。

| 評価軸（1–5） | C-1 好奇心（現行） | C-3 経営判断 | C-8 リスク/urgency | 根拠（1行） |
|---|---|---|---|---|
| 好奇心喚起 | 4 | 3 | 4 | C-1 は「市場規模・競合・リスク」の列挙で中身が見える。C-8 は「今動かないコスト」で引く。 |
| Opportunity との関連 | 5 | 4 | 3 | C-1/C-3 は「この機会」を主語にできる。C-8 は urgency 側に寄り機会が薄まる。 |
| 次の行動の明確さ | 4 | 5 | 3 | C-3「判断材料を受け取る」は次アクションが具体。 |
| Conversion ポテンシャル | 4 | 4 | 3 | C-8 は3社の Opportunity が「立ち上げ」提案で、現状維持コストの根拠が弱く空振りしやすい。 |
| 情報の匂い（information scent） | 5 | 4 | 3 | C-1 は遷移先で得られるものと文言が一致（capture ページに市場規模・競合の記載）。 |
| 総合 | **4.4** | **4.0** | **3.2** | — |

**候補別ラベル**: C-1 = **Strong** / C-3 = **Medium**（意思決定者セグメントが分かれば有効）/ C-8 = **Weak**（今の Opportunity 種別と相性が悪い）。

**Recommended CTA: C-1 を維持**（現行どおり）。実トラフィックが取れた段階で C-1 vs C-3 の A/B を推奨。C-8 は当面見送り。

---

## 8. Privacy QA（3社 × Email / Preview）

チェック: 代表者名 / 住所 / 資本金 / 個人プロフィール / 壊れた Markdown / 内部データ構造 / 不要な company profile dump。

| 面 | kscope | ab-i | illegame |
|---|---|---|---|
| Email（subject/preheader/text/html） | 混入なし | 混入なし | **混入なし**（`代表者` `幸田` `外神田` `千代田区` `600万` `資本金` `## |` `| ---` すべて0件） |
| Preview（Hero / VM / stats / firstAction / sources / review 行） | 混入なし | 混入なし | **混入なし**（同上フラグ全0件） |

- `report-preview.js` は `business_summary` を **描画経路のどこでも参照しない**（`company_profile` の参照は `name` / `domain` のみ）。P0-1 の壊れた summary は Preview に再表示されない。
- `report-teaser.js` / `email-render.js` も `business_summary` を使わない。会社の実態は `why_company`（`free_opportunity`）で示す。
- P0-1 guard（`summary-guard.js`）を迂回する新規実装は無い。`summary-guard.js` は将来・他ページ用に読み込みだけ維持。

→ **Privacy QA: 3社すべて PASS。**

---

## 9. Responsive QA — 静的 CSS / DOM 検査のみ（実ブラウザ描画は未実施）

> Claude ブラウザ拡張が未接続のため、375/390/768/1280px の実レンダリングは行っていない。
> 以下は `preview-conversion.css` / `base.css` / `report-preview.js` のコード検査に基づく評価であり、**目視確認済みではない**。

| 確認項目 | 静的評価 | 備考 |
|---|---|---|
| horizontal scroll なし | △ 要実機確認 | `html, body` に `overflow-x: hidden` 無し。`* { box-sizing: border-box }` と `.page { max-width:760px; padding:0 16px }` はあり。 |
| Hero 崩れ | ○ | headline は日本語で任意折返し可。`report-hero__badges` は `flex-wrap: wrap`。 |
| Opportunity card 崩れ | ○ | `.oppv2` は幅指定なし・padding のみ。`@480` で title 1.28→1.15rem。 |
| Stat card 崩れ | △ **要注意（illegame）** | `.stat-card { flex: 1 1 120px }` + `@480 { flex-basis: 100% }`。ただし `.stat-card__value { word-break: keep-all; font-size: 1.5rem（@480 1.35rem） }` で、illegame の値 `17兆3,777億9,000万米ドル`（18字・分割不可の漢字+桁区切り数字）は 375px 全幅カード内幅（≈315px）に対しほぼ限界。**overflow → 横スクロールの可能性あり。** |
| CTA が画面外に飛び出さない | ○ | `@480 { .cta-v2__btn { display: block } }`。 |
| accordion 操作可能 | ○ | ネイティブ `<details>`（根拠 / 情報源）。JS 不要。 |
| illustration 過大表示なし | ○ | `.hero-illust__svg { width:100%; max-width:340px; height:auto }`。 |
| mobile で情報順序維持 | ○ | 単一カラム・DOM 順 = 視覚順。メディアクエリでの並べ替え無し。 |
| prefers-reduced-motion | ○ | `@media (prefers-reduced-motion: reduce)` あり。 |

**P2（要対応・STEP6 前）**: illegame の Preview stat card で長い USD 値がモバイル幅を超える恐れ。対策候補（本STEPでは実装しない）: `.stat-card__value` に `overflow-wrap: anywhere` / 12字超の値はフォント段階縮小 / そもそも Report 生成側で「世界のサービス市場」を対象市場から外す（別トラック）。加えて `body { overflow-x: hidden }` の保険。

---

## 10. KPI 定義（正式化・実装しない）

### Funnel（正式）

```
Email sent → Email open → Preview link click → Preview scroll → CTA click
→ Email capture submit → Detailed analysis → Weekly consent → Paid report request
```

### Primary KPI

| KPI | 定義 |
|---|---|
| `preview_link_click_rate` | Email 受信者のうち Preview を開いた割合 |

### Secondary KPI

`preview_cta_click_rate` / `email_capture_submit_rate` / `weekly_consent_rate` / `paid_report_request_rate`

### UX diagnostic KPI（将来計測）

`preview_scroll_depth`（25/50/75/100%）/ `hero_visibility` / `opportunity_visibility` / `why_you_visibility` / `cta_visibility` / `preview_dwell`

---

## 11. KPI Baseline

| Metric | Baseline | Target | Status |
|---|---|---|---|
| Preview Link Click Rate | N/A | > 15%（暫定・要 baseline） | **NOT YET MEASURABLE** |
| Preview CTA Click Rate | N/A | > 15% | **NOT YET MEASURABLE** |
| Email Capture Rate（Preview 到達者ベース） | N/A | > 10% | **NOT YET MEASURABLE** |
| Weekly Consent Rate（Capture 者ベース） | N/A | > 30% | **NOT YET MEASURABLE**（Lead field は存在・分母が無い） |
| Paid Report Request Rate | N/A | 未設定 | **NOT YET MEASURABLE**（Lead field は存在） |
| Preview Scroll Depth | N/A | diagnostic | **NOT IMPLEMENTED** |
| Hero / Opportunity / WhyYou / CTA visibility | N/A | diagnostic | **NOT IMPLEMENTED** |
| Email Open Rate | N/A | diagnostic | **NOT IMPLEMENTED**（blastengine Trial は error webhook のみ・open tracking 不可） |

- 現時点で **実測できる Funnel 数値は無い**（RC1 の E2E 送信3通は自社アドレス宛の疎通確認で、母数としては使えない）。
- 数値は一切推測していない。すべて `N/A` / `NOT YET MEASURABLE` / `NOT IMPLEMENTED`。

## 12. KPI Targets（暫定・「達成済み」ではない）

| Metric | Target | 出典 |
|---|---|---|
| CTA Click Rate | > 15% | STEP2 §14（B2B 提案書想定） |
| Email Capture Rate | > 10% | STEP2 §14 |
| Weekly Consent Rate | > 30% | STEP2 §14 |

これらは **Target** としてのみ保存。STEP5 時点の達成状況は「未測定」。

---

## 13. Tracking future specification（本STEPでは本番実装しない）

| event_name | 意味 | 発火点 | 実装予定位置 |
|---|---|---|---|
| `email_open` | Email 開封 | 1px / webhook | blastengine Trial では不可 → Preview 到達を代理指標に |
| `preview_link_click` | Email の CTA から Preview を開いた | reportUrl のクエリ | Lead API（アクセス時に lead/token で記録） |
| `preview_scroll_depth` | スクロール到達（25/50/75/100） | `report-preview.js` scroll | `trackEvent()` |
| `cta_click` | Preview 内 CTA クリック | `report-preview.js` `wireCtas()`（既に `trackEvent("cta_click", …, {placement})` のフックあり） | `trackEvent()` |
| `email_capture_submit` | capture フォーム送信 | `email-capture.html` | Lead 生成時に既存 |
| `weekly_consent` | Weekly 同意 | capture フォーム | Lead field 済み |
| `paid_report_request` | 有料レポート希望 | capture / 後続画面 | Lead field 済み |

### Event schema 案（最小・PII 禁止）

```json
{ "event_name": "...", "lead_id": "...", "report_id": "...", "occurred_at": "ISO8601", "source": "email|preview|capture" }
```

**payload に入れない**: email アドレス / 会社住所 / 代表者名 / 資本金 / 物理住所 / company_profile dump。
**送信先（将来）**: Lead API の既存 Function URL へ軽量 POST（`report-preview.js` の `trackEvent()` は現状 `window.__AOR_DEBUG__` 時の `console.debug` のみ・外部送信なし）。

---

## 14. Recommended Hero

**A（デフォルト）+ B（円建て size/growth 数値2つ以上で自動切替）を維持。** 新規 variant 実装なし。
- 変更しない理由: 3社の実データで A=2社 / B=1社 が自然に成立。C の誠実さ（確信度表示）は既に A の subheadline に取り込み済み。
- STEP2 default（Hero A）から逸脱しない。

## 15. Recommended CTA

**C-1（好奇心・「市場規模・競合・リスク｜無料」列挙）を維持。**
- 変更しない理由: 遷移先（capture ページ）の説明と情報の匂いが一致。C-8（urgency）は現行 Opportunity 種別（新規事業の「立ち上げ」提案）と相性が悪い。
- 将来: 実トラフィック確保後に **C-1 vs C-3** を A/B。件名は STEP2 の「パターン1 vs パターン2」を Open Rate で先行テスト（ただし blastengine Trial では Open 取得不可 → Preview 到達率で代替）。

---

## 16. GO / GO WITH NOTES / NO-GO

### 判定: **GO WITH NOTES**

**GO 条件の充足**:

| 条件 | 判定 |
|---|---|
| 3社すべてで Opportunity が理解できる | ✓ |
| 3社すべてで Why Now が概ね理解できる | △（kscope / illegame は PARTIAL・数字の質。UI ではなく Report 生成側の課題） |
| CTA の意味が明確 | ✓（C-1・機会連動・遷移先一致） |
| 重大な Privacy 問題なし | ✓（3社 Email/Preview とも P0-1 フラグ全0） |
| Responsive 問題なし | △（静的検査のみ。illegame stat card の mobile overflow が未確認リスク） |
| Email → Preview 導線が成立 | ✓（Subject/preheader/teaser/CTA/URL 一貫） |
| CI PASS | ✓（後述 §11 Test） |
| Production data unchanged | ✓ |

**NOTES（P2・Conversion を阻害する重大問題ではない）**:

1. **illegame Preview の USD 巨大 stat**（17兆米ドル）: スケールの現実味が薄く、モバイルで stat card overflow の恐れ。→ Report 生成側で対象市場を見直す別トラック + `stat-card__value` の折返し保険。
2. **kscope の「市場の動き」が比率のみ**（2割 / 8割・ラベル「割合」）: 市場変化の数字として弱い。→ Report 生成側 or stat 抽出の閾値調整。
3. **ab-i Email の whyNow 文切れ**（`…プロモーション…`）: `excerpt()` の文境界処理（既知 NOTE）。
4. **illegame Email の「8割半ば（割合）」**: 文脈から切り離すと意味不明。→ market-numbers の label 精度。
5. **Tracking 未実装 → 実 KPI baseline 0**: 想定どおり。STEP6 以降で軽量 event を実装してから baseline を取る。
6. **Responsive は静的検査のみ**: STEP6 の本番デプロイ前に実機（375/390/768/1280）確認を必須事項として持ち越し。

いずれも「Opportunity が理解できない」「Why You 不成立」「CTA 不明」「Privacy leak」「壊れ summary 表示」「Responsive 崩壊」「URL 破壊」には該当しない。

---

## 17. Remaining P2 items（STEP6 へ持ち越し）

| # | 項目 | 面 | 推奨対応 | 実装STEP |
|---|---|---|---|---|
| P2-1 | illegame USD stat のスケール / mobile overflow | Preview + Report生成 | 対象市場の見直し（別トラック）+ `overflow-wrap:anywhere` / `body{overflow-x:hidden}` | STEP6 前 |
| P2-2 | kscope の市場数字が比率のみ | Report生成 / market-stats | size 系数字が無い会社は stat セクションを控えめに（「視覚化できる数値なし」文言へフォールバック） | 別トラック |
| P2-3 | Email whyNow の文切れ | `report-teaser.excerpt` | 文境界で切る／最短1文は許容 | STEP4 追補 or STEP6 |
| P2-4 | 「8割半ば（割合）」等の曖昧ラベル | `shared/market-numbers` `pickLabel` | 文脈語を label に含める / 単独で意味不明なら不採用 | 別トラック |
| P2-5 | 実機 Responsive 未確認 | Preview | STEP6 デプロイ前にブラウザ実測 | STEP6 |
| P2-6 | tracking 未実装 | Preview / Lead API | §13 の event schema で軽量実装 → baseline 取得 | STEP6 以降 |

---

## 18. STEP6 handoff

**STEP5 判定 = GO WITH NOTES。** STEP6（本番デプロイ）は Phase54 STEP9 手順をベースに実施可。

STEP6 で守る前提:
- 対象3社（kscope.co.jp / ab-i.jp / illegame.com）の RC1 published を STEP3/STEP4 実装で再描画。**Report JSON は変更しない。**
- Review 再承認 → Publish → Web Deploy（`AOR_DEPLOY_EXECUTE=yes`）→ CloudFront invalidation → 本番 preview 目視。
- blastengine 送信は Trial allowlist の自社3アドレスのみ（`kouda@kscope.co.jp` / `info@illegame.com` / `kouda@ab-i.jp`）。DROP/HARDERROR/SOFTERROR が出たら停止。
- `origin/main` は変更しない。feature ブランチのみ。

STEP6 開始前に片付けるべき NOTES:
- **P2-1（illegame stat overflow）**: 最低限 `body { overflow-x: hidden }` + `stat-card__value { overflow-wrap: anywhere }` を入れてから本番へ。または illegame の対象市場を差し替えて再生成（別トラック判断）。
- **P2-5（実機 Responsive）**: 375/390/768/1280 を実ブラウザで確認し、横スクロール・カード崩れが無いことを目視。
- 上記2点が未了なら STEP6 は Preview デプロイのみ先行し、blastengine 送信は保留する選択も可。

STEP6 に持ち込んで良い（ブロッカーではない）NOTES: P2-2 / P2-3 / P2-4（Report 生成・teaser の質。UI ではない）、P2-6（tracking は本番後に追加可）。

---

## Production Safety（STEP5 実績）

```
Report Store write:        0
Review write:              0
Publish write:             0
Lead write:                0
blastengine send:          0
SES send:                  0
Lambda invoke:             0
Lambda deploy:             0
S3 production write:       0
CloudFront invalidation:   0
DNS change:                0
origin/main change:        0
AI API:                    0
Tavily API:                0
Search API:                0
```

コード変更なし。commit するのは本 artifact のみ。
