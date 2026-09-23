# 18_phase55_ux_conversion_design.md — Phase55 AOR UX / Conversion Design

> **歴史的設計資料（Phase55時点）**
>
> 本書は Phase55 時点の UX 設計・意思決定記録です。
> Phase69 以降の正式仕様・運用ルールは
> `19_aor_v1_constitution.md` を優先してください。
> 本書は設計判断の背景を保存する目的で保持します。

> 位置づけ: Phase54 RC1（Production リリース済み・commit `9ad6d75`）を前提に、AOR の
> First Impression と Conversion を「レポート通知」から「営業提案書」へ転換するための **設計書**。
> 本ドキュメントは設計のみ。実装は Phase55 STEP3 以降。

作成: 2026-09-08 / Phase55 STEP2 / Git baseline HEAD `9ad6d75`（feature/aor-pipeline、origin/main `b2e24fc`）

---

## 1. Audit Summary（STEP1 の結論）

| 項目 | 値 |
|---|---|
| Conversion Funnel Score | kscope 45 / ab-i 50 / illegame 39 / **平均 44.7 / 100** |
| 技術品質（Phase54 で担保） | 十分（real numbers・real citations・forward-looking opportunity） |
| 弱点 | First Impression / Relevance / Visual hierarchy / CTA / Weekly の recurring value |

### 検出課題（STEP1 分類）

- **P0-1**（Hotfix `9ad6d75` で暫定対応済み）: illegame preview の `business_summary` が Markdown ダンプ表示。恒久対応は `fetch-company.js` 別トラック。
- **P1**: (1) メールに hook ゼロ (2) preview で source-pages が Opportunity より前＝根拠→結論の逆順 (3) Opportunity タイトルの先出しサマリー無し (4) Visual hierarchy 破綻（最大要素＝社名、Opp title 1.02rem ≒ 本文、見出し 0.78rem、数字視覚化ゼロ） (5) kscope の business_summary が LP 煽り文 (6) Weekly が Initial のコピー。
- **P2**: CTA が抽象的・機会と非連動／数字が地の文に埋没／evidence バッジ過多／first_action が card 最下部／eyebrow が製品ラベル／illegame の industry_label が「中小企業」／market_change が why_company の後。
- **P3**: footer の死にリンク／生成日の過剰表示／mobile 480px のみ／trust 導線の視認性最下位。

### 無味乾燥の原因（A〜E）

| | 原因 | Phase55 で対応する Principle |
|---|---|---|
| A. Copy | 件名＝発見の通知でなく事務通知。本文に benefit / curiosity / urgency ゼロ | Principle D（CTA）+ §7 Email |
| B. IA | source が Opportunity より先／サマリー無し／first_action が最下部 | Principle B（結論→根拠）+ §13 |
| C. Visual | 主役が視覚的に主役でない／数字が地の文に溶ける | Principle C（数字は見る）+ §9, §10 |
| D. Hook | 「うちに関係ある」の瞬間（why_company）が下スクロール後 | Principle A（5秒で価値）+ §6 Hero |
| E. Conversion | CTA が抽象的・機会と非連動／死にリンク | Principle D + §11 |

---

## 2. UX Design Principles（Phase55 で固定）

### Principle A — 5秒で価値が伝わる
Preview / Email を開いて最初に目に入る情報は **① Opportunity ② Why you ③ Why now** のみ。
Source（外部情報源リンク集）・生成日・訂正導線・evidence quote は **ファーストビューに出さない**。

### Principle B — 結論 → 根拠（順番を逆転）

| 現状（RC1） | 新設計（V2） |
|---|---|
| Company name → business_summary → **Sources** → Opportunity(card) → locked → CTA | **Hero（Opportunity 先出し）→ Opportunity 詳細 → Why You → Market Change → First Action → Evidence → Sources → locked → CTA** |

Sources は「隠す」のではなく「最後に、折りたたんで」置く（信頼担保は残す）。

### Principle C — 数字は「読む」のでなく「見る」
市場規模・成長率・制度・補助金額・導入率は文章から抽出し、**stat カード / 比較バー / タイムライン**で提示する（§10）。存在しない数字は作らない（抽出のみ）。

### Principle D — CTA は価値を約束する
「追加分析を見る（無料）」→ 押した先で得られるものを動詞化し、**その Opportunity と紐づける**（§11 CTA Library）。

### Principle E — Weekly は「差分」を届ける
「更新されました」を禁止。**今週変わったこと（What Changed）を最初に**届ける。Weekly は Initial のコピーではなく別製品として設計する（§8）。

---

## 3. Hero Design（3案・ワイヤーフレーム）

### 共通要素の定義

| 要素 | 内容 | データソース |
|---|---|---|
| Eyebrow | サービス識別の小ラベル | 固定文言 |
| Headline | 「御社に〜な売上機会が見つかりました」の1行 | `free_opportunity.title` を平叙文へ変換 |
| Subheadline | 「なぜ御社か」を1文 | `why_company` の要約（既存データ、AI 不要） |
| Opportunity Pill | Opportunity タイトルを丸チップで強調 | `free_opportunity.title` |
| Market Badge | 「なぜ今か」の数字1つ | `market_change` / `extended_analysis.market_size` から抽出した代表数値 |
| Human Review Badge | 「◯月◯日 運営が内容を確認済み」 | `human_review.reviewed_at` / `.reviewer` |

---

### A案 — 営業提案書型（推奨）

```
┌──────────────────────────────────────────────┐
│  ご提案 · AI Opportunity Report               │  ← Eyebrow
│                                              │
│  株式会社ABI 様へ                             │  ← 宛名（小さめ）
│                                              │
│  中国市場向けアニメIPの                        │  ← Headline（1.6〜1.9rem, bold）
│  「共同制作・ローカライズ支援」を               │
│  新しい収益の柱にできます。                     │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ ● この機会                              │  │  ← Opportunity Pill（塗り）
│  │   中国市場向けアニメIPの共同制作・         │  │
│  │   ローカライズ支援サービスの立ち上げ       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  御社は日中両市場の制作・配信・ライセンス       │  ← Subheadline（why_company 1文）
│  実績を持ち、この機会を最短距離で形にできます。  │
│                                              │
│  [ 海外アニメ市場 6兆円へ ]  [ ✓ 9/8 運営確認済み ] │  ← Market Badge + Review Badge
└──────────────────────────────────────────────┘
      ↓（続けて Opportunity 詳細）
```

- トーン: 「コンサルタントからの1枚提案」。二人称・断定・benefit 先行。
- Headline は `title` を「〜できます」「〜が見つかりました」の平叙文に機械変換（テンプレート、AI 不要）。
- 長所: 営業提案書の体感が最も強い。経営者の "自分事" 化が速い。
- 短所: 断定調が強すぎると「押し売り」に見えるリスク → Subheadline で根拠を即添える。

---

### B案 — 市場インサイト型

```
┌──────────────────────────────────────────────┐
│  今、御社の市場で起きていること · AOR           │  ← Eyebrow
│                                              │
│  海外アニメ市場は 2033年までに 約6兆円へ。      │  ← Headline（市場変化が主語）
│  2024年の 3倍。                               │
│                                              │
│  [ 2024: 2.17兆円 ]───────▶[ 2033目標: 6兆円 ] │  ← Market Badge（比較バー）
│                                              │
│  この波に、御社が取れる一手：                   │
│  ┌────────────────────────────────────────┐  │
│  │ ● 中国市場向けアニメIPの共同制作・         │  │  ← Opportunity Pill
│  │   ローカライズ支援サービスの立ち上げ       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  御社は日中の制作・配信実績を持つため、          │  ← Subheadline
│  この一手を最短で実行できます。 [ ✓ 9/8 確認済み ]│
└──────────────────────────────────────────────┘
```

- トーン: 「市場アナリストのブリーフィング」。まず外部変化 → then 御社の一手。
- 長所: 「AIの押し付け提案」感が薄い。Why now が最初に立つ。数字の会社は説得力が高い（ab-i 向き）。
- 短所: market_change の数字が弱い会社（kscope・illegame）では Headline が作りにくい → その場合 A案へフォールバック。

---

### C案 — AIアナリスト型

```
┌──────────────────────────────────────────────┐
│  AIが公開情報から見つけた機会 · AOR             │  ← Eyebrow
│                                              │
│  株式会社カレイドスコープ の事業と、            │  ← Headline
│  今の市場変化を照合しました。                   │
│                                              │
│  → 見つかった機会が 1件 あります。              │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ 発見した機会                             │  │
│  │ ● AI活用型・新規事業開発支援サービスの     │  │  ← Opportunity Pill
│  │   立ち上げ                               │  │
│  │                                         │  │
│  │ 照合した根拠: 4件（政府統計 / 業界 / 自社） │  │  ← Evidence count
│  │ 確信度: 中（市場規模は追加調査が必要）      │  │  ← Confidence（confidence_note から）
│  └────────────────────────────────────────┘  │
│                                              │
│  [ ✓ 2026年9月8日 運営が内容を確認しました ]     │
└──────────────────────────────────────────────┘
```

- トーン: 「AIの分析結果を、正直な確信度つきで提示」。透明性が主役。
- 長所: 過大表現をしない誠実さ。数字が弱い会社でも成立。B2B の慎重な担当者に効く。
- 短所: 「発見が1件だけ」を前面に出すと物足りなく見えるリスク → locked themes 件数を併記して緩和。

---

### Hero 3案の比較・使い分け

| 観点 | A 営業提案書 | B 市場インサイト | C AIアナリスト |
|---|---|---|---|
| First Impression の強さ | ◎ | ○ | △ |
| 押し売り感の低さ | △ | ○ | ◎ |
| market_change の数字が弱い会社での成立 | ○ | ✗ | ◎ |
| 経営者（意思決定者）向け | ◎ | ○ | △ |
| バックオフィス担当者向け | △ | ○ | ◎ |
| 実装コスト | 低（テンプレ変換のみ） | 中（数値抽出＋比較 UI） | 低 |

**推奨**: **A案をデフォルト**、market_change に score>=70 の統計数値が2つ以上あれば **B案**へ自動切替、
`confidence_note` に「追加調査が必要」が含まれる場合は A案 Subheadline に確信度を1行添える（C案の誠実さを部分採用）。
STEP5 の A/B テストで A vs B を比較する。

---

## 4. Email Design（Initial・3パターン）

### 現行（RC1）

| 項目 | 現行 |
|---|---|
| Subject | `<会社名> 様向け AI Opportunity Report が完成しました` |
| Preview Text | なし（`<head>` に meta description なし） |
| Opening | 「貴社向けの AI Opportunity Report（無料版）が完成しました。」 |
| Hook | なし |
| Opportunity teaser | なし |
| Why Now teaser | なし |
| CTA | 「レポートを見る」（青ボタン） |
| Footer | 運営事務局 / 「心当たりがない場合は破棄」/「配信停止は返信」 |

**問題**: 開封しても本文の情報量がゼロ。クリック理由が「一応見る」以上にならない。件名も「完成通知」。

---

### V2 パターン1 — Opportunity 直球型（推奨・A案 Hero と対）

| 項目 | V2 | 理由 |
|---|---|---|
| Subject | `【株式会社ABI 様】中国市場向けアニメIP展開に、新しい収益機会があります` | 宛名 + Opportunity の要点。「完成しました」でなく「機会があります」= 発見の通知 |
| Preview Text | `海外アニメ市場は2033年までに約6兆円へ。御社が取れる一手を1件ご提案します。` | 数字 + 「1件の提案」= 具体性と軽さ |
| Opening | `株式会社ABI 様\n\n公開情報から御社の事業と今の市場変化を照合したところ、取り組む価値のある機会が1件見つかりました。` | 「なぜ御社に届いたか」を最初の1文で説明（P1-1 直撃） |
| Hook | `御社は日中両市場での制作・配信実績をお持ちです。その強みを、拡大する中国向けIP需要に向けられます。` | why_company の1文要約 = 「うちに関係ある」瞬間をメール内で作る |
| Opportunity teaser | `▸ 機会: 中国市場向けアニメIPの共同制作・ローカライズ支援サービスの立ち上げ` | title をそのまま。1行 |
| Why Now teaser | `▸ なぜ今: 政府のIP360補助金が2026年度に創設。海外アニメ市場は6兆円目標（2024年の3倍）。` | why_now から数字2つ |
| CTA | `[ この機会の詳細（市場規模・根拠・最初の一歩）を見る ]` | §11 CTA Library C-1。得られるものを列挙 |
| Footer | 運営事務局 / `このレポートは送信前に運営が内容を確認しています（2026年9月8日）` / List-Unsubscribe（現状維持）+「返信でも承ります」 | Human Review を footer にも1行（信頼） |

---

### V2 パターン2 — 市場変化フック型（B案 Hero と対）

| 項目 | V2 |
|---|---|
| Subject | `海外アニメ市場が6兆円へ（2024年の3倍）。株式会社ABI 様の一手をご提案` |
| Preview Text | `政府のIP360補助金が2026年度に創設。御社の日中実績を活かせる機会です。` |
| Opening | `株式会社ABI 様\n\n御社の市場で、見過ごせない変化が起きています。` |
| Hook | `経済産業省は2033年までに海外アニメ市場を約6兆円へ拡大する目標を掲げ、IP360補助金の公募も始まりました。` |
| Opportunity teaser | `この変化に対して御社が取れる一手を1件、根拠つきでまとめました。\n▸ 中国市場向けアニメIPの共同制作・ローカライズ支援サービスの立ち上げ` |
| Why Now teaser | `（Opening と Hook に集約済み）` |
| CTA | `[ 変化の詳細と、御社の一手を見る ]` |
| Footer | パターン1 と同じ |

---

### V2 パターン3 — 1件深掘りの誠実型（C案 Hero と対）

| 項目 | V2 |
|---|---|
| Subject | `株式会社カレイドスコープ 様｜AIが見つけた機会 1件（根拠4件・運営確認済み）` |
| Preview Text | `新規事業の成功企業は2割（PwC調査）。御社の伴走型支援 × AI の機会です。` |
| Opening | `株式会社カレイドスコープ 様\n\n御社の公開情報と市場データを照合し、取り組む価値のある機会を1件に絞ってまとめました。` |
| Hook | `PwCの調査では、投資回収まで至った新規事業を持つ企業は全体の2割。御社の「失敗をコントロールする」伴走型支援は、この課題に直接応えられます。` |
| Opportunity teaser | `▸ 機会: AI活用型・新規事業開発支援サービスの立ち上げ` |
| Why Now teaser | `▸ 根拠: 政府統計1件・自社情報2件・補助金ニュース1件（計4件）。確信度: 中（市場規模は追加調査が必要）。` |
| CTA | `[ この機会の根拠と、今日できることを見る ]` |
| Footer | パターン1 と同じ |

---

### Email 3パターンの使い分け

- **パターン1** をデフォルト。
- market_change に強い統計数字が2つ以上 → **パターン2**。
- `confidence_note` に「追加調査が必要」等の留保が強い → **パターン3**。
- STEP5 A/B: 件名だけ（1 vs 2）を先に回し、Open Rate を見る。

**設計上の制約（守る）**: メール本文の Opportunity teaser / Why Now teaser / Hook は、
**published JSON（`free_opportunity` / `human_review`）から機械抽出**する。AI 生成はしない（Phase55 STEP4 実装時も同様）。

---

## 5. Weekly Email Design（別製品として）

### Initial と Weekly の役割分担

| | Initial | Weekly |
|---|---|---|
| 目的 | 初回の関心獲得（attention → relevance → curiosity） | 継続接触の価値提供（recurring value → habit → trust） |
| 主役 | Opportunity（1件の発見） | **Change（前回からの差分）** |
| 件名 | 「〜に新しい収益機会があります」 | 「〜の市場で、今週動いたこと」 |
| 想定頻度 | 1回 | 毎週（Weekly consent 済みのみ） |

### Weekly メール必須ブロック

```
件名: 【株式会社ABI 様】今週、御社の市場で動いたこと（9/8週）

━━ What Changed This Week ━━
前回レポート（9/1）以降の変化:
 ・制度   IP360補助金 第2回公募が開始（締切 10/15）
 ・市場   アニメ制作市場が初の4,000億円超え（帝国データバンク）
 ・競合   （検出なし）
 ・AIトレンド （検出なし）
 ※ 変化が検出されなかった週は「今週は大きな変化はありませんでした」と正直に書く

━━ New / Updated Opportunity ━━
 ・更新: 「中国市場向けアニメIPの共同制作・ローカライズ支援」
   → 補助金の締切が具体化。次回公募スケジュールを確認する好機。

━━ Watch List（来週見るべき指標）━━
 ・IP360 第2回公募の要件詳細（10月上旬公表予定）
 ・アニメ制作市場の四半期統計

[ 今週のレポートを見る ]
```

### Weekly の "What Changed" 判定ロジック（設計・実装は STEP4）

- 前回 published と今回 published の diff:
  - `free_opportunity.title` が変わった → 「Opportunity が更新されました」
  - `market_change` 内の src-N 集合 / 主要数値が変わった → 「市場データが更新」
  - `locked_opportunities` に追加 → 「新しいテーマ候補」
- diff が無い週は **抑制**（送らない or「変化なし」と明記）。空メールを送らない。
- **AI 不使用**。純粋に2つの JSON の構造比較。

### report-preview 側の Weekly 対応（設計）

- `?mode=weekly` パラメータ（or lead の `last_weekly_sent_report_generated_at` 比較）で、
  preview の Hero 直下に「今週の変化」バナーを差し込む。Initial では非表示。

---

## 6. Opportunity Card Redesign

### 現行カードの問題（STEP1 より）

| # | 問題 |
|---|---|
| 1 | title `1.02rem` ≒ 本文 `0.92rem`。カードの主役が視覚的に主役でない |
| 2 | ブロック順が `Why Now → なぜ御社なのか → 市場変化 → 根拠 → 最初の一歩`。**結論（Business Impact）が無く**、最初の一歩が最後 |
| 3 | 「Why Now / 市場変化」の見出しが `0.78rem`（極小） |
| 4 | evidence が `source_type + source_role + strength` の3バッジ×4件でノイジー |
| 5 | `market_change` の数字が地の文 |
| 6 | `extended_analysis`（market_size / priority / confidence_note）が preview に一切出ていない（無料版では非表示設計だが、confidence だけは出す価値がある） |

### 新カード構造（必須要素と役割）

```
┌─────────────────────────────────────────────┐
│  この機会                                    │  ← eyebrow（塗り）
│                                             │
│  中国市場向けアニメIPの共同制作・             │  ← Opportunity title（1.3〜1.5rem, bold）
│  ローカライズ支援サービスの立ち上げ           │
│                                             │
│  ── なぜ今 ────────────────────────────────  │  ← 見出し 0.9rem 以上・区切り線
│  政府のIP360補助金が2026年度に創設。          │
│  海外アニメ市場は2033年までに6兆円目標。       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │  ← Market stat カード（§10）
│  │ 6兆円    │ │ +26%     │ │ 3兆8407億 │   │
│  │ 2033目標 │ │ 海外売上 │ │ 市場全体  │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│                                             │
│  ── なぜ御社 ──────────────────────────────  │
│  御社は日中両市場の制作・配信・ライセンス      │
│  実績を持ち、この機会を最短で形にできます。    │
│                                             │
│  ── 見込まれるインパクト ─────────────────── │  ← 【新設】Business Impact
│  補助金を活用すれば初期投資リスクを抑えつつ、  │     （extended_analysis.priority の要約）
│  新しい収益の柱を作れます。                   │
│                                             │
│  ┌─────────────────────────────────────┐   │  ← First Action（強調ボックス・上位へ移動）
│  │ 今日できること                        │   │
│  │ IP360補助金の次回公募スケジュールを     │   │
│  │ 確認し、自社IPの中国向け案件を1件企画    │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  この提案は 4件の根拠に基づきます              │  ← Evidence count（折りたたみトグル）
│  ▸ 根拠を見る（政府1・統計1・自社2）    [開く] │
│  確信度: 中 — 補助金の詳細は今後更新の可能性   │  ← Confidence（confidence_note 由来・1行）
└─────────────────────────────────────────────┘
```

| 要素 | 役割 | データソース |
|---|---|---|
| Opportunity title | 発見の1行。カードの視覚的主役 | `free_opportunity.title` |
| なぜ今（Why Now） | タイミングの正当化 | `why_now` |
| Market stat カード | 数字を「見せる」 | `why_now` / `market_change` / `market_size` から抽出 |
| なぜ御社（Why Your Company） | 自分事化のフック | `why_company` |
| **見込まれるインパクト（Business Impact）** | 「で、うちに何の得？」への回答（新設） | `extended_analysis.priority` の要約 |
| First Action | 「今日できること」。card 中位へ移動（現状は最下部） | `first_action` |
| Evidence（折りたたみ） | 信頼担保。既定は閉じる。バッジは strength のみに削減 | `evidence` + `source_pages` |
| Confidence | 誠実さ。1行 | `extended_analysis.confidence_note` から「中/高」と留保を抽出 |

- **evidence バッジ削減**: `source_type`（政府/統計/業界/自社）＋ 出典名のみ。`source_role` と `evidence_strength` バッジは廃止（strength は左ボーダー色で表現）。
- **market_change 単体ブロックは廃止**し、「なぜ今」に統合（現状は why_company の後に孤立）。

---

## 7. Market Change Visualization（TRY-D）

数字の種類ごとに UI パターンを割り当てる。**SVG 不要**（CSS の div / flex / border で構成）。

### パターン1 — Stat カード（横並び 2〜3枚）

```
┌──────────┐ ┌──────────┐ ┌──────────┐
│  6兆円    │ │  +26%    │ │  2割     │   ← 数字（1.6rem, bold, primary）
│  海外市場 │ │  前年比  │ │  成功率  │   ← ラベル（0.75rem, muted）
│  2033目標 │ │  海外売上│ │  (PwC)   │   ← 補足/出典（0.7rem）
└──────────┘ └──────────┘ └──────────┘
```
用途: 市場規模・成長率・導入率・比率。1カードに数字は1つだけ。

### パターン2 — 比較バー（Before → After）

```
2024年              2033年目標
2.17兆円  ━━━━━━━━▶  6兆円
[███████░░░░░░░░░░░░░░░░░░]  約3倍
```
用途: 「N年でX倍」「現状 vs 目標」。CSS の width % で塗り。

### パターン3 — タイムライン（制度・補助金の時系列）

```
2026年度 ──●── IP360補助金 創設（海外展開支援・PF構築支援）
         │
      現在 ●   ← 「今ここ」マーカー
         │
     次回公募 ○ スケジュール要確認
```
用途: 制度変更・補助金公募・政策目標年。縦線＋●で表現。

### パターン4 — 補助金額バッジ

```
[ 補助金 IP360 ]  海外展開支援・開発PF構築支援
                  AI・XR・ブロックチェーン活用が対象
```
用途: 制度名 + 対象範囲。金額が明記されている場合のみ「最大◯◯万円」を数字で。

### 抽出ルール（設計）

- `why_now` / `market_change` / `extended_analysis.market_size` から、`\d[\d,]*\s*(兆|億|万)?円`、`\d+(\.\d+)?\s*%`、`\d{4}\s*年`、`約\d+倍`、`CAGR\s*\d+` を正規表現抽出。
- 抽出結果が **0件なら stat セクション自体を出さない**（数字を作らない）。
- 抽出結果が多い会社（ab-i）は上位3つ、少ない会社（kscope・illegame）は1〜2つ。
- illegame の「17兆3,777億9,000万米ドル」のような**通貨単位が混在**するものは、単位を明記して1カードに（誤解防止）。

---

## 8. CTA Library（10案・5カテゴリ）

現行「追加分析を見る（無料）」の問題: (1) 何が見られるか不明 (2) この機会と紐づかない (3) 「見る」だけで benefit ゼロ (4) 同一文言を2回再掲。

| # | カテゴリ | CTA 文言 | 用途 |
|---|---|---|---|
| C-1 | 好奇心 | この機会の詳細（市場規模・根拠・最初の一歩）を無料で見る | デフォルト。得られる中身を列挙 |
| C-2 | 好奇心 | AIがこの機会をどう分析したか、根拠まで見る | 透明性を求める慎重な担当者 |
| C-3 | 経営判断 | この機会に取り組むべきか、判断材料を無料で受け取る | 意思決定者向け。「判断」を主語に |
| C-4 | 経営判断 | 御社の他の検討テーマ（あと2件）も無料で見る | locked themes を餌に。件数を明示 |
| C-5 | 市場規模 | この市場が今後どこまで伸びるか、数字で確認する | market_size が強い会社（ab-i） |
| C-6 | 市場規模 | 対象市場の規模・成長率・競合状況を無料で見る | 市場分析を求める層 |
| C-7 | リスク | この機会に取り組む場合のリスクと前提を確認する | 保守的な B2B 担当者。`extended_analysis.risks` を餌に |
| C-8 | リスク | 「今動かないコスト」を含めて無料で分析を受け取る | urgency。現状維持バイアスへの反論 |
| C-9 | 競合比較 | 同業他社がこの変化にどう動いているか見る | 競合意識の高い層。`extended_analysis.competition` |
| C-10 | 競合比較 | 御社がこの機会で先行するための最初の一歩を見る | 先行者利益フレーム |

### CTA 配置ルール

- Hero 直下に **軽い CTA（テキストリンク）**: 「▸ この機会の中身を見る」
- Opportunity card の後に **メイン CTA（ボタン）**: C-1 or C-3
- ページ最下部に **再掲 CTA**: ただし文言を変える（例: 上部 C-1、下部 C-4「他の検討テーマも見る」）
- CTA には可能なら Opportunity タイトルの短縮を含める: 「〈中国IP展開〉の詳細を見る」

STEP5 A/B: C-1（好奇心）vs C-3（経営判断）vs C-8（リスク/urgency）。

---

## 9. Human Review UX（TRY-H）

現行: `✓ 人間による確認済み`（緑バッジ、header 中位）。「いつ・何を・誰が」が無い。

### 改善案（3レベル）

| レベル | 表示 | 位置 |
|---|---|---|
| L1 最小 | `✓ 運営が確認済み` | 現状維持（不足） |
| L2 推奨 | `✓ 2026年9月8日、運営がこのレポートの内容を確認しました` | Hero の Review Badge + footer に1行 |
| L3 詳細 | `✓ 送信前チェック済み` を押すと展開: 「会社情報の正確性 / 出典の妥当性 / Opportunity の論理 / 送信先の適法性 を確認（確認者: 運営 / 2026-09-08）」 | Hero Badge クリックで展開。`human_review.checklist` を使う |

- `human_review.reviewed_at` を人間可読な日付に。
- `human_review.checklist`（現状すべて null）に将来値が入れば L3 で表示。今は「4項目を確認」の定型文。
- 位置: Hero 内に必ず1つ（信頼はファーストビューに置く価値がある。Principle A の例外）。

---

## 10. Source UX（TRY-F）

現行: `source-pages` セクションが Opportunity より前・全リンク展開・「ほか N 件」。

### 新設計

- **位置**: Opportunity card と CTA の **間**（Principle B: 結論→根拠）。
- **既定は折りたたみ**: `▸ この分析が参照した情報源（5件 + ほか N 件）` のトグル。開くとリスト。
- **Evidence Chips**: Opportunity card 内の evidence 折りたたみは、出典を「政府 · 経済産業省」「統計 · 帝国データバンク」のようなチップ（クリックで元記事）に。quote は展開時のみ。
- **Top / Hidden の区別を明示**: Top Sources（分析の主根拠）と Hidden（参考）をラベル分け。
- directory / review / Wikipedia は Phase54 のガードで既に top から除外済み（維持）。

---

## 11. First Action UX（TRY-G）

現行: card 最下部の薄青ボックス「最初の一歩」。

### 新設計

- **名称**: 「今日できること」（"最初の一歩" より行動を促す）。
- **位置**: Opportunity card 内の Business Impact 直後（card 中位）。加えて Hero 直下にも1行サマリーを置く選択肢（A/B）。
- **形式**: チェックボックス風の1アクション + 所要時間の目安（あれば）。
- 例（ab-i）: `☐ IP360補助金の次回公募スケジュールを確認する（15分）` `☐ 自社IPの中国向けローカライズ案件を1件、企画書化する`
  - ※ `first_action` は現状1文なので、句点/接続詞で2ステップに機械分割する程度（AI 不使用）。

---

## 12. Conversion Flow（導線とユーザー心理）

```
① Email 受信
   心理: 「また営業メールか」→ 件名で判定（2秒）
   設計: 件名に宛名 + Opportunity or 市場数字。「完成しました」を排除
        ↓
② Email 開封
   心理: 「で、何が入ってるの?」
   設計: Opening 1文で「なぜ御社に届いたか」。Hook で why_company。teaser で Opportunity/Why now
        ↓
③ CTA クリック → Preview
   心理: 「本当に自社向け? それとも汎用テンプレ?」
   設計: Hero で Opportunity + Why you + Why now を5秒で。source は見せない（Principle A/B）
        ↓
④ Preview スクロール
   心理: 「根拠は? 数字は? 具体的に何すれば?」
   設計: stat カードで数字を見せる。Business Impact で「うちの得」。今日できること。evidence は折りたたみで安心担保
        ↓
⑤ CTA（メイン）クリック → Email Capture
   心理: 「メアド出す価値ある? しつこく営業される?」
   設計: CTA で得られるもの明示（市場規模/競合/リスク）。capture ページに「営業電話はしません」（既存）
        ↓
⑥ 登録直後 → 追加分析（同じ Opportunity の解像度を上げる）
   心理: 「登録してよかった or 時間の無駄だった」
   設計: 07_free_report.md の方針どおり。新 Opportunity でなく同一 Opportunity の market_size/competition/risks
        ↓
⑦ Weekly 登録
   心理: 「毎週来て価値ある?」
   設計: 初回 Weekly で What Changed を実演。変化が無い週は送らない/正直に書く
        ↓
⑧ Paid 転換
   心理: 「お金払う価値ある?」
   設計: 08_paid_report.md（複数 Opportunity を同じ深さ + 実行支援 + 更新頻度）
```

各段階で「離脱の主因」を潰す設計にする（②=情報量ゼロ、③=汎用に見える、④=数字が読めない、⑤=価値不明）。

---

## 13. 3社比較設計

| | kscope（カレイドスコープ） | ABI | illegame（イル・レガメ） |
|---|---|---|---|
| **Hero 案** | A案（数字が弱い） | **B案**（6兆円・3倍・+26%） | A案 or C案（数字が米ドル混在で弱い） |
| **Headline** | 「新規事業の成功率を、AI活用で引き上げる支援サービスを立ち上げられます」 | 「海外アニメ市場6兆円へ。中国向けIP展開を、御社の新しい柱に」 | 「人手不足の中小企業に、AI業務効率化を"現場目線"で届けられます」 |
| **Opportunity Pill** | AI活用型・新規事業開発支援サービスの立ち上げ | 中国市場向けアニメIPの共同制作・ローカライズ支援サービスの立ち上げ | 中小企業向けAI活用型・業務効率化コンサルティングサービスの立ち上げ |
| **Market stat（見せる数字）** | 「新規事業 成功率 2割（PwC）」/「3年 で成否判断」 | 「6兆円 2033目標」「+26% 海外売上」「3.8兆円 市場全体」 | 「8割半減 中小企業の雇用者数(2040)」「約3割 が AI活用」（米ドル市場規模は単位明記で1枚） |
| **Why Your Company（Subheadline）** | 「失敗をコントロールする伴走型支援のノウハウを、AIで拡張できます」 | 「日中両市場の制作・配信・ライセンス実績を、拡大する中国需要へ」 | 「コンサル×IT開発を自社で持ち、管理工数33%削減の実績があります」 |
| **Business Impact** | 既存事業の延長で早期に実現可能・市場ニーズ大 | 補助金で初期投資リスクを抑えつつ新収益の柱 | 既存の強みを直接活かせる最優先テーマ |
| **今日できること** | 既存顧客にヒアリング → AI活用サービスメニューを試作 | IP360補助金の次回公募を確認 → 自社IP案件を1件企画 | 既存顧客2〜3社に AI業務効率化のパイロットを無償提案 |
| **CTA** | C-1（好奇心）or C-3（経営判断） | C-5（市場規模）「この市場がどこまで伸びるか、数字で確認する」 | C-3（経営判断）「取り組むべきか判断材料を受け取る」 |
| **Confidence 表示** | 「中 — 市場規模は追加調査が必要」（confidence_note より） | 「中 — 補助金の詳細は今後更新の可能性」 | 「中 — AI活用率は調査機関により異なる」 |
| **注意** | business_summary が LP 煽り文（P1-5）→ Hero では business_summary を使わず why_company を主に | — | business_summary は Hotfix `9ad6d75` で非表示中。恒久対応後に industry_label も「中小企業」→ 具体化 |

---

## 14. KPI 設計（実装しない・定義のみ）

### Funnel メトリクス

| 段階 | メトリクス | イベント名（案） | 現状計測 |
|---|---|---|---|
| Email | Open Rate | `email_open`（blastengine webhook / 1px） | 未（blastengine は error webhook のみ） |
| Email → Preview | Preview Click Rate | `preview_link_click`（reportUrl のクエリで判別） | 部分（アクセスログ） |
| Preview | Scroll Depth（25/50/75/100%） | `preview_scroll_depth` | 未 |
| Preview | Time on Page | `preview_dwell` | 未 |
| Preview → Capture | CTA Click Rate | `cta_click`（CTA ごとに id） | 未 |
| Capture | Email Capture Rate | `email_capture_submit` | 部分（Lead 生成） |
| Capture → 追加分析 | 追加分析到達率 | `paid_preview_view` | 未 |
| Weekly | Weekly Consent Rate | `weekly_consent`（Lead field 済み） | ○ |
| Weekly | Weekly Open / Click | `weekly_open` / `weekly_click` | 未 |
| Paid | Paid Request Rate | `paid_report_request`（Lead field 済み） | ○ |

### 目標（暫定・STEP5 で baseline 取得後に確定）

- Preview Click Rate: 現状不明 → まず計測
- CTA Click Rate: **> 15%**（B2B 提案書として）
- Email Capture Rate（Preview 到達者ベース）: **> 10%**
- Weekly Consent Rate（Capture 者ベース）: **> 30%**

### 計測実装の前提（STEP3-4）

- report-preview.js に軽量イベント送信（Lead API の既存 Function URL へ POST、PII なし・`lead_id` タグのみ）。
- blastengine の open tracking が使えるか要確認（Trial プラン）。使えなければ Preview 到達を open の代理指標にする。

---

## 15. Phase55 実装ロードマップ

```
STEP2（本STEP・完了）
  UX/Conversion Design ← docs/strategy_v2/18（詳細な監査ログは非公開の監査記録（backup配下）を参照）
        │
        ▼
STEP3  Preview UI 実装
  - report-preview.html / .css / .js の描画順を Principle B へ
  - Hero コンポーネント（A案デフォルト、B案条件切替）
  - Opportunity card 再構成（Business Impact / 今日できること / evidence 折りたたみ）
  - Market stat カード（数値抽出 + CSS 可視化）
  - source-pages を Opportunity の下・折りたたみへ
  - Human Review L2
  - 計測イベント（scroll depth / cta click）
  - 【依存】なし（frontend のみ・published JSON はそのまま読む）
  - 【禁止】report 再生成・S3 report/published 変更
        │
        ▼
STEP4  Email Template 実装
  - send-initial-report.js buildEmailContent V2（パターン1 デフォルト）
  - send-weekly-report.js を「What Changed」中心へ（前回 published との JSON diff）
  - 件名/preview text/teaser は published JSON から機械抽出（AI 不使用）
  - 【依存】STEP3（reportUrl 先の preview が V2 であること）
        │
        ▼
STEP5  A/B UX Test
  - Hero A vs B、CTA C-1 vs C-3 vs C-8、件名パターン1 vs 2
  - KPI baseline 取得（§14）
  - 【依存】STEP3 + STEP4 + 計測実装
  - 【方法】少数の実 Lead で比較、または内部レビュー + ヒューリスティック評価
        │
        ▼
STEP6  Production Deploy + blastengine E2E
  - STEP3/4 の frontend を deploy-aor-web.js で Production へ
  - 3社（or 新規テスト Lead）へ V2 メール再送 → preview 確認
  - 【依存】STEP5 で V2 が RC1 を上回ることを確認
  - 【前提】Phase54 STEP9 と同じ手順（review 再承認 → publish → deploy → 送信）
```

### 依存関係サマリ

- STEP3 は独立（frontend のみ）。**最初に着手**。
- STEP4 は STEP3 完了後（メールのリンク先が V2 preview である必要）。
- STEP5 は STEP3+4+計測。
- STEP6 は STEP5 の結果次第。
- **P0-1 恒久対応**（`fetch-company.js`）は STEP3 と並行可能な別トラック。illegame の industry_label 具体化もここで。

---

## 16. Production Safety（本 STEP 実績）

| 項目 | 実績 |
|---|---|
| Report writes / Review writes / Publish writes / Lead writes | **0** |
| blastengine / SES / CloudFront / Web Deploy | **0** |
| Lambda / DNS / IAM | **0** |
| Git commit / push | **0**（HEAD `9ad6d75` 不変） |
| AI（DeepSeek）/ Tavily / Report 再生成 / Weekly 生成 | **0** |
| 変更ファイル | `docs/strategy_v2/18_phase55_ux_conversion_design.md`（新規）と監査記録（新規）のみ。frontend / source コードは未編集。詳細な監査ログは非公開の監査記録（backup配下）を参照。 |

---

## 17. STEP3 Implementation Spec（次STEPの実装仕様）

### 対象ファイル（STEP3 で編集を許可）

- `website/aor/report-preview.html`
- `website/aor/assets/css/base.css` / `report-preview.css`
- `website/aor/assets/js/report-preview.js`
- （新規）`website/aor/assets/js/hero.js` or report-preview.js 内に集約
- （新規）`website/aor/assets/js/market-stats.js`（数値抽出 + stat カード生成、UMD でテスト可能に）
- test: `scripts/generator/test/report-preview-static.test.js` 拡張、`market-stats.test.js` 新規

### 描画順（`render()` の新仕様）

```
1. renderHero(data)              ← 新規。Eyebrow / 宛名 / Headline / Subheadline / Opportunity Pill / Market Badge / Review Badge
2. renderMainOpportunity(...)    ← 再構成。title 大 / なぜ今(+stat) / なぜ御社 / Business Impact / 今日できること / evidence 折りたたみ / confidence
3. renderMarketStats(data)       ← 新規（Opportunity 内 or 直下）
4. renderSourcePages(...)        ← Opportunity の後・折りたたみ既定 closed
5. renderLockedThemes(...)
6. renderCta(slug)               ← 文言を CTA Library から。上下で別文言
7. renderFooter()                ← Human Review 1行追加
```

### Hero 切替ロジック（B案発動条件）

```js
function pickHeroVariant(data) {
  const nums = extractMarketNumbers(data.free_opportunity); // §7 の抽出
  if (nums.filter(n => n.kind === "market_size" || n.kind === "growth").length >= 2) return "B";
  return "A"; // デフォルト
}
```

### market-stats 抽出（純関数・テスト対象）

- input: `{ why_now, market_change, extended_analysis.market_size }`
- output: `[{ value: "6兆円", label: "海外市場 2033目標", source: "src-20", kind: "market_size" }, ...]`（最大3）
- 0件なら stat セクションを描画しない
- 単位混在（米ドル）は `label` に単位を含める

### Human Review L2（純関数）

- input: `human_review`
- output: `"2026年9月8日、運営がこのレポートの内容を確認しました"` or `"レビュー中"`

### 計測（最小）

- `report-preview.js` に `trackEvent(name, meta)` を追加。`meta` は `{ lead_id }` のみ（URL クエリの `lead` から）。
- 送信先: 既存 Lead API Function URL の新エンドポイント（or 既存の許可ルート）。PII・token は送らない。
- イベント: `preview_view` / `preview_scroll_depth`（25/50/75/100）/ `cta_click`（{cta_id}）。

### STEP3 の Definition of Done

- [ ] Hero が Opportunity / Why you / Why now を5秒で見せる（source は初期表示に無い）
- [ ] Opportunity card に Business Impact と「今日できること」がある
- [ ] 数字が stat カードで見える（数字が無い会社では非表示）
- [ ] source-pages は Opportunity の下・既定折りたたみ
- [ ] Human Review が「いつ確認したか」を含む
- [ ] 3社 preview がローカルで正しく描画（kscope / ab-i / illegame。illegame は Hotfix の guard と共存）
- [ ] フルスイート PASS
- [ ] Production 変更なし・AI なし・commit まで（push は STEP6 まで保留 or STEP ごとに判断）

---

## 18. 参照

- [07_free_report.md](07_free_report.md) — 無料レポート設計（1件深掘り方式・価値の積み上げ）
- [08_paid_report.md](08_paid_report.md) — 有料版設計
- [10_lp_structure.md](10_lp_structure.md) — LP 構成
- [02_user_journey.md](02_user_journey.md) — ユーザージャーニー
- 詳細な監査ログは非公開の監査記録（backup配下）を参照（STEP1 Audit＝本設計の根拠、P0-1 Hotfix＝commit 9ad6d75）。
