# 19_aor_v1_constitution.md — AOR v1.0 Development Constitution

> 位置づけ: Phase67〜68（Initial Report の Premium 化・Executive Report 化・Print/PDF 対応）で確定した
> ブランド・デザイン・情報設計・データ契約・配信仕様を、**v1.0 リリース品質の最上位仕様**として1文書に固定する。
> 今後の Claude への指示書・レビュー・実装・デザイン・AI生成は、本文書と矛盾してはならない。
> 本ドキュメントは Documentation Only（Phase69 STEP0）。コード変更・commit・push は行っていない。

作成: 2026-09-20 / Phase69 STEP0 / Git baseline: `feature/aor-pipeline` HEAD `40b431c`
（Phase67 STEP1/STEP2「design(aor): premium consulting report ui」「Executive Intelligence Report cover + dashboard」、
Phase68 STEP1「AOR Brand Quality Final」、Phase68 STEP2「Print / PDF Edition」を前提とする）

---

## Chapter 1 — AOR Product Vision

### AOR とは何か

AOR（**A**I **O**pportunity **R**eport、正式表記 **AOR BUSINESS OPPORTUNITY REPORT**）は、
ChangeScout（社内コードネーム Project Lighthouse）が提供する Product Lighthouse ポートフォリオの一角で、
公開情報・市場動向・企業情報を分析し、対象企業ごとに個別化した「ビジネスチャンス」を無料で提示するレポート製品である。

### 目的

- 経営者・新規事業責任者が自力で行うと数時間〜数日かかる情報収集・分析を、AI と専門家監修によって数分で読めるレポートへ圧縮する。
- ChangeScout のミッション「変化を価値へ（AI を使って情報収集・分析・意思決定の時間を劇的に削減する）」を、
  最初に無料で価値を体験してもらう入口（リードジェネレーション）として実装したものが AOR である。
- 収益ファネル「無料レポート → メール登録 → 無料版（Weekly）→ SaaS → 有料版」の最初の2段（無料レポート・メール登録）を担う。

### 誰向けか

- 一次ターゲット: 中小企業の**経営者・新規事業責任者**。税理士・建設・補助金・法改正・バックオフィスなど BtoB セグメントを優先。
- 送付先はコールドプロスペクト（未接点の企業）を含むため、**営業メールに見えない・押し売りに見えないこと**が設計上の必須要件になる。

### 無料版 / 詳細版の位置づけ

| 版 | 内容 | 目的 |
|---|---|---|
| **Initial Report（無料版・単発）** | `free_opportunity` 1件をフルに開示。Locked Opportunities（`locked_opportunities`）はタイトルのみ | 初回の価値体験。メールアドレス登録への導線 |
| **Weekly Report（無料版・継続）** | 週次で新しい変化・機会を配信（`weekly_report_consent === true` の受信者のみ） | 継続的な関係構築。Initial のコピーではなく「今週変わったこと」を届ける別設計（Phase55 で確立） |
| **詳細分析版（有料版・将来）** | `paid_analysis`（市場規模・競合・リスク分析等）と Locked Opportunities の開示 | 収益化。v1.0 時点では CTA 導線のみ実装済み、決済・提供部分は対象外 |

### AOR は「営業メール」ではなく「経営インテリジェンスレポート」である

これは AOR の一番の存在意義に関わる原則であり、Chapter 2〜5 のすべてのルールの根拠になる。

- 件名・本文・Cover・CTA のいずれにも、煽り文・値引き感・「今だけ」「絶対」等のセールス表現を使わない。
- トーンは **Bloomberg Intelligence × McKinsey Executive Report**（Phase68 STEP1 の目標品質）。
- 「発見の通知」であって「営業の接触」ではない、という体験を Cover 1ページ目から一貫させる。

---

## Chapter 2 — Brand Identity

### 正式ブランド名（固定・改変禁止）

```
AOR
BUSINESS OPPORTUNITY REPORT
```

- 上段 "AOR" がブランドマーク、下段 "BUSINESS OPPORTUNITY REPORT" がドキュメントタイプ表記。英語表記・全て大文字。
- Hero（Report Cover）左上、Footer、印刷ヘッダーの3箇所で必ずこのペアで表示する。

### 固定コピー（ブランド契約）

以下は AOR ページ上で使ってよい・使うべき定型コピーであり、言い換えを禁止する。

| コピー | 用途 |
|---|---|
| 専門家監修 | Review バッジ（`human_review.status === "approved"` の時）、Trust 項目、Footer |
| 公開情報分析レポート | Footer タグライン（「専門家監修・公開情報分析レポート」として結合表示） |
| 御社専用分析 | Hero Pill、下部 CTA 周辺の訴求 |
| 無料版 | CTA タイトル「無料版を毎週メールで受け取る」等 |

### 禁止コピー（CSS・HTML・JS 全文検索でゼロ件を維持する）

- 登録不要
- 無料で閲覧
- 人間確認済み
- 人間による確認済み
- 運営確認済み
- 運営が内容を確認済み

> Phase68 STEP1 時点で `website/aor/report-preview.html` / `assets/css/preview-conversion.css` /
> `assets/js/report-preview.js` / `assets/js/illustrations.js` の4ファイルを全文検索し、上記6語がゼロ件であることを確認済み。
> 以後、この4ファイルを変更するたびに同じ検索を再実行し、ゼロ件を維持すること。

### Trust 4項目（固定・順序も固定）

1. メールアドレス登録だけ
2. 専門家監修（未承認時は「運営がレビュー中」に自動で切り替わる。これは禁止コピーではない）
3. 無料版を毎週配信
4. 配信はいつでも停止できます

> 実装上の注記: この文言は `preview-ui.js` の `trustItems()` が返す値であり、`preview-ui.js` は Protected Layer
> （Chapter 6）に属するため report-preview 側からは編集できない。現行実装の4項目目は「配信はいつでも停止可」であり、
> 本憲章が定める正式コピー「配信はいつでも停止できます」と完全一致していない。**v1.0 リリース前に `preview-ui.js` 側の
> 修正が必要な既知の差分**として記録する（本憲章の対象外＝別チケット）。

### レビューバッジの2状態

| 状態 | 表示 | 条件 |
|---|---|---|
| 承認済み | 「専門家監修」+ shield アイコン | `human_review.status === "approved"` |
| 未承認 | 「運営がレビュー中」+ search アイコン | 上記以外 |

---

## Chapter 3 — Design System

Phase67〜68 で確定した Initial Report のデザイン原則。`website/aor/assets/css/preview-conversion.css` の
`:root` トークンと `@media print` ブロックを正とする。

### Colors

5色のみで構成する（accent はこの5系統からのみ選ぶ。base.css のテーマカラー〔青/緑/紫〕は他ページとの共通基盤として
残すが、AOR Premium コンポーネント〔Hero/CTA/Footer/Dashboard/Canvas/Locked 等〕は以下を優先する）。

| 役割 | トークン | 値 |
|---|---|---|
| Navy（基調・見出し・強調背景） | `--aor-navy` | `#0b1c33` |
| Navy Soft（グラデーション相方） | `--aor-navy-soft` | `#16294a` |
| Gold（アクセント・表紙ライン・確信度等） | `--aor-gold` | `#c9a24b` |
| Emerald（ポジティブ・信頼・進捗） | `--aor-emerald` / `--aor-emerald-dark` | `#059669` / `#047857` |
| Slate Border（枠線統一） | `--aor-border` | `#e7ecf3` |
| Slate 背景（薄灰） | `--aor-gray-bg` | `#f4f6f9` |
| White | — | `#ffffff` |

- 印刷（`@media print`）では Navy の大面積背景（Hero/CTA/Footer/KPI カード等）はすべて白背景＋Navy文字へ変換し、
  Gold/Emerald はアクセント（左ボーダー・アイコン）としてのみ残す。「色だけに意味を持たせない」原則を維持する。

### Typography

| レベル | 用途 | モバイル | デスクトップ（min-width:1024px） |
|---|---|---|---|
| H1 | Hero メインタイトル（Opportunity） | 約24px | 48〜60px（`.report-hero__headline` 最大 3.75rem） |
| H2 | セクション見出し（`.sec-head__title`） | 約17px | 32px |
| H3 | カード見出し（`.oppv2__title` 等） | 約18px | 26px 前後 |
| Body | 本文 | 16px（`body` 基準） | 17〜18px |
| Caption | ラベル・メタ情報 | 11〜12px | 14px |

- h1 はページに1つだけ（Hero のみ）。Opportunity / Market の見出しはすべて h2（`secHead()` ヘルパー経由）。
- 印刷時は `font-size: 11pt` を基準にし、行間 1.5 を維持する（Chapter 12 Print QA 準拠）。

### Radius

- 大型カード（Hero・Executive Summary・Canvas Layer・KPI 行・CTA 等）: `--radius-xl` = **24px**
- 中型カード: 14〜20px（旧世代コンポーネント含む。24px への統一は将来の技術的負債として記録）

### Shadow

- Premium Soft: `--shadow-soft` = `0 16px 40px -24px rgba(15,23,42,0.22)`
- 強調用: `--shadow-xl` = `0 30px 64px -28px rgba(11,28,51,0.38)`
- 印刷では全て `box-shadow: none !important`。

### Grid / Spacing

- コンテナ最大幅: モバイル・タブレットは可変、デスクトップ（min-width:1024px）で `--max-width: 1200px`。
- ただし本文（読み物：reason-card／oppv2 本文／opportunity-fit／strength-card／exec-summary 値 等）は
  **読み幅最適化のため 720px を上限**とする（1200px コンテナの中で本文だけ狭める）。
- セクション間隔: モバイル 48〜72px、タブレット 88〜96px、デスクトップ **96〜120px**。
- カード内 padding: モバイル 16〜20px、デスクトップ 32〜34px（Executive Summary / Canvas Layer / Opportunity 等の大型カード）。

### Icons — SVG Only

- すべてのアイコンは `website/aor/assets/js/illustrations.js` の `Illustrations.glyph(name, {size})` /
  `Illustrations.hero(theme)` から生成する inline SVG。
- **絵文字（Emoji）は禁止**。`common.js` 由来で残っていた🔒（ロックアイコン）は Phase68 STEP1 で
  report-preview.js 側の DOM 後処理により SVG（`lock_premium`）へ置換済み。同様のパターン（外部関数が
  絵文字を差し込むケース）が見つかった場合も、Protected Layer 側は変更せず report-preview.js からの
  後処理で置換すること。
- Hero 背景には Business Intelligence モチーフ（ノード網・接続線・円形チャート・光点）を `biBackdrop()` として実装。
  外部画像・`<image>`・`url(http...)` は一切使用しない。

---

## Chapter 4 — Information Architecture

Initial Report（`report-preview.js` の `render()`）の描画順を、今後の標準構成として固定する。
**この順番を変更する場合は本憲章の改訂が必要**（実装だけを変えてはならない）。

1. **Report Cover**（Hero） — AOR ブランド／FREE EDITION・CONFIDENTIAL・専門家監修バッジ／会社名／巨大 Opportunity タイトル／リードコピー／下部メタデータ／CTA
2. **Executive Summary** — 左: 結論・Why Now要約・Why You要約／右: Executive Snapshot（Opportunity / Market Signal / Company Fit / Confidence / Sources）
3. **Market Intelligence Dashboard** — KPI 4枚（市場の追い風／補助金・制度／節目の年／確信度）＋ Market Momentum（横バー）＋ Why this matters 引用
4. **Why Now** — 市場背景（マガジンレイアウト・引用強調）
5. **Why You** — Company Snapshot（プロフィール＋今回見つかった接点）／Strength Analysis／Opportunity Fit
6. **Opportunity Canvas** — Opportunity（巨大タイトル）／Business Impact（3カード）／Expected Outcome（Navy カード）
7. **Why This Opportunity Matters** — 3 Insight Cards（市場背景／御社との一致／今始める理由）
8. **First Step Roadmap** — 横タイムライン（デスクトップ）／縦タイムライン（モバイル・印刷）
9. **Evidence Intelligence** — 折りたたみ。カテゴリ左帯・番号丸バッジ・引用ボックス
10. **Source Library** — 折りたたみなしの常時カードグリッド。アイコン・カテゴリ・利用目的
11. **More Opportunities**（Locked） — COMING NEXT カード。グラデーション境界・簡潔な訴求
12. **CTA** — Trust 4項目（直前に表示）＋「無料版を毎週メールで受け取る」＋ボタン
13. **Footer** — ブランド・タグライン・リンク（情報修正依頼／配信停止／運営会社／プライバシー）・分析日・分析ソース数・コピーライト

> 実装上の注記: Trust 4項目は独立した `#sec-trust` セクションとして CTA の直前（11 と 12 の間）にレンダリングされる。
> 上記リストでは spec の13項目構成を維持しつつ、Trust を「12. CTA」に含めて記載した。

---

## Chapter 5 — Copywriting Rules

### 見出し

- 短く、結論ファースト。「〜について」のような説明的な見出しを避け、名詞句または断定文で終える。
- 英語ラベル（Executive Summary / Opportunity Canvas / Why This Matters 等）はセクションの性格を示す
  kicker として使い、日本語見出しと併用してよい（英語のみにしない）。

### Why Now

- 市場背景・制度変化・タイミングの理由を語る。数値は必ず情報源からの抜粋（Chapter 7 参照）。

### Why You

- 企業固有の理由に限定する。一般論・業界平均の話を Why You に混ぜない（それは Why Now の役割）。

### Expected Outcome

- 「儲かります」ではなく「期待できること」を語る。断定的な利益予測・数値保証をしない。

### CTA

- 営業臭を出さない。「今すぐ」「限定」「特別」等の煽りワードを使わない。
- ボタン文言は行動を明確化する動詞句（例:「御社専用の追加分析を見る（無料）」）。
- 下部 CTA 直前には必ず Trust 4項目を置き、安心材料を先に見せてから行動を促す。

### Footer

- ブランド説明のみ。CTA・訴求文をここに二重で置かない。
- 必須項目: AOR ロゴ・ドキュメントタイプ・タグライン・リンク4種・分析日・分析ソース数・コピーライト。

---

## Chapter 6 — Data Contract

**「Content SAME / Presentation NEW」** — Phase67 以降のすべての Initial Report 改修に共通する最上位原則。
表示するデータは既存の `report.json`（公開済み JSON）のフィールドのみを使い、新しい数値・事実は一切作らない。
数字・事実はすべて既存フィールドから抽出・言い換えるだけで、LLM も乱数も表示時には使わない。

### Presentation Layer（編集OK）

| ファイル | 役割 |
|---|---|
| `website/aor/report-preview.html` | DOM の骨格（`<section id="...">` の入れ物のみ） |
| `website/aor/assets/css/preview-conversion.css` | 全ビジュアル（画面・印刷）。report-preview.html 専用 |
| `website/aor/assets/js/report-preview.js` | データ→DOM への描画ロジック。新しい文章・数値の生成禁止 |
| `website/aor/assets/js/illustrations.js` | SVG アイコン・イラストの追加のみ |

### Protected Layer（編集禁止）

| 対象 | 理由 |
|---|---|
| `website/aor/assets/js/preview-ui.js` | Presentation と Email Teaser（`shared/report-teaser.js`）の parity を保つ純関数群 |
| `website/aor/assets/js/market-stats.js` | 市場数値の抽出ロジック（乱数・LLM不使用のパーサー） |
| `website/aor/assets/js/common.js` | 全ページ共通のデータ取得・バッジ生成・mailto 導線 |
| `report.json` スキーマ・Generator（`scripts/generator/**`） | AI パイプライン・検証ロジック全体 |
| Lambda / Lead Store / Published Store | 配信基盤（Chapter 9・10） |

- Presentation Layer から Protected Layer の**関数を呼ぶ**ことは常に許可される（`PreviewUI.xxx()` 等）。
  禁止されるのは Protected Layer の**ファイルを編集する**こと。
- Protected Layer 由来の望ましくない出力（例: 絵文字アイコン）は、Presentation Layer 側での
  DOM 後処理（`querySelector` → 差し替え）で対処し、Protected Layer 自体は変更しない
  （Chapter 3 Icons、Phase68 STEP1 の lock アイコン差し替えが実例）。

---

## Chapter 7 — AI Generation Contract

report.json を生成する AI パイプライン（Generator／DeepSeek）に対する品質契約。

### AI が生成してよいもの

- **Why Now**（`free_opportunity.why_now`） — 市場背景の説明文
- **Why You**（`free_opportunity.why_company`） — 企業固有の理由の説明文
- **First Step**（`free_opportunity.first_action`） — 最初の一歩の提案文
- **Evidence 要約**（`free_opportunity.evidence[].quote` 等） — 出典からの要約・抜粋

これらはいずれも「**既存の検索結果・企業情報を要約・言い換えた文章**」であり、Presentation 側の
`summarizeSentence()` 等が行う「抜粋」と同じ性質のものに限る。

### AI が生成してはいけないもの（推測禁止）

- 市場数字（市場規模・成長率・CAGR 等）
- 補助金数字（金額・件数・締切等）
- 企業情報（未確認の会社名・所在地・事業内容の創作）
- 出典（存在しない source_id・存在しない記事の引用）
- URL（存在しないリンクの生成）
- 統計値全般（存在を確認できない数値の記載）

上記はすべて「情報源に実際に記載されている値の抽出」でなければならず、AI が「もっともらしい数値」を
補完することを禁止する。Generator 側にはこれを強制する複数のゲート（`validate-report.js` の
Opportunity Evidence Gate、`quality-rules.md` の関連性ルール等）が既に実装されている。

---

## Chapter 8 — Evidence Rules

### 出典カテゴリの優先順位

1. **Government**（政府・自治体・省庁） — 制度・補助金の一次情報として最優先
2. **Official Company**（企業公式） — 対象企業自身の一次情報。`source_type: "company"` は
   重複排除時も最優先で残す（Phase53 STEP10.11 で確定した `deduplicate-sources.js` の `preferWithinGroup` ルール）
3. **Industry Association**（業界団体） — 業界動向の裏付け
4. **Research**（調査会社・統計） — 市場規模・成長率等の定量データ
5. **News**（報道） — タイミング・時事性の裏付け。優先順位は最も低い

`directory` / `review` 等の低信頼カテゴリは `top_sources` から除外される（Generator 側の Gate-5）。

### Evidence と Source の違い

| | Evidence（根拠） | Source（情報源） |
|---|---|---|
| データ元 | `free_opportunity.evidence[]` | `data.top_sources` \|\| `data.source_pages` |
| 目的 | 「なぜこの提案なのか」を1件ずつ具体的な引用で示す | 「今回の分析で参照したページ一覧」を透明性のために示す |
| 表示位置 | Opportunity の直後（IA 順9） | Evidence の直後、最後から2番目（IA 順10） |
| UI | 番号丸バッジ＋カテゴリ左帯＋引用ボックス | カードグリッド。アイコン・カテゴリ・タイトル・利用目的（`source_role`）。URL 文字列は画面表示しない |
| 印刷時 | 出典リンクの URL を文字列で併記（クリックできないため） | URL は印刷でも非表示のまま（カテゴリ・利用目的で十分と判断） |

---

## Chapter 9 — Delivery Rules

v1.0 時点で確定している配信基盤の仕様を文書化する（コード変更はしない）。

### 送信経路の分離

| 経路 | 用途 | 実装 |
|---|---|---|
| **Initial Report** | 初回無料レポートの通知 | `blastengine` Transaction API（`pj2-aor-initial-report-delivery` Lambda。SES クライアントは使わない） |
| **Weekly Report** | 週次継続配信 | **Amazon SES**（`pj2-aor-weekly-report-delivery` Lambda）。`weekly_report_consent === true` の受信者のみ、送信直前に再チェック |
| **blastengine Webhook** | Initial の bounce/error 通知受信 | `pj2-aor-blastengine-webhook` Lambda + Function URL。Basic 認証（HMAC 署名なし） |
| **Unsubscribe** | 配信停止 | `pj2-aor-lead-api` Lambda + Function URL。`report_token` 方式 |

- SES は **Production Access 承認済み**（2026-09-05、`Max24HourSend: 50000` / `MaxSendRate: 14`）。
  ただし Weekly の本格送信前には From ドメインの段階的ウォームアップが運用条件として必要。
- blastengine には Sandbox 相当の「配信可能アドレス」許可リストが存在する（トライアルプラン時）。
  本番運用前に解除、または送信先の事前登録が必要。

### Canonical Published Store

- S3 バケット `changescout-pj2-aor-data-179127602551` に `reports/` `reviews/` `company-contexts/` `published/` の
  4 prefix。**Weekly 送信が読むのは `published/<slug>.json` のみ**。
- ブラウザ（`report-preview.html`）が読むのは別バケット `changescout-pj2-aor-web-179127602551` の
  `data/<slug>.json`（CloudFront 配信）。**この2経路は別物であり、`publish-report.js`（S3 canonical 公開）と
  `deploy-aor-web.js`（Web バケット + CloudFront invalidation）の両方を実行しないと「メールは届くがレポートが
  開けない」障害になる**（Phase51/53 で実際に発生・修正済みの既知障害パターン）。

### Lead State Machine

```
collected → validated → report_generated → delivery_approved
  → initial_report_queued → initial_report_sent
```

- `delivery_status`: `active` / `bounced`（blastengine の DROP/HARDERROR/SOFTERROR Webhook で `bounced` に遷移。
  一度 `bounced` になった Lead は再送しない＝`isDeliveryBlocked`）
- `delivery_approval_status`: `pending` / `approved`（Admin API または Review 経由。Review 承認と Delivery
  承認は独立した状態）
- `weekly_report_consent`: Weekly 送信の可否フラグ。true の Lead のみ SES 経路の対象になる
- **同一 email × 同一 company の重複送信は禁止**。`createLead()` は既存 Lead を検出すると新規作成せず
  `resubmitted` history を追加するのみ（同一 email でも company が違えば別 Lead）

---

## Chapter 10 — Git / AWS Boundary（PJ2 運用ルール）

| 領域 | ブランチ / 環境 | 状態 |
|---|---|---|
| **feature/aor-pipeline** | 開発ブランチ | すべての AOR 改修はここで行う。commit は自由、push はユーザー確認後のみ |
| **origin/main** | 保護ブランチ | 直接変更しない。merge は別途承認プロセス |
| **AOR Website**（S3 web バケット + CloudFront） | 本番配信 | `deploy-aor-web.js` の明示実行でのみ更新（`AOR_DEPLOY_EXECUTE=yes` が必須の安全弁） |
| **Admin**（管理画面 / Admin API） | 本番 | Review・Delivery Approval の人手承認窓口。`ADMIN_USER`/`ADMIN_PASSWORD` が未設定の環境では起動不可 |
| **Lead API**（`pj2-aor-lead-api`） | 本番 Lambda | Unsubscribe・Delivery Approval の一部を担う。Function URL 公開エンドポイント |
| **Lambda**（7関数） | 本番 | `scripts/generator/` 丸ごと + 刈り込んだ node_modules の fat bundle。リポジトリにデプロイスクリプトは存在せず、手動ビルド・手動デプロイが現行運用 |
| **Published Store / Delivery Store** | 本番 S3 | Chapter 9 参照。Read-Only 原則（このドキュメント作成のような Documentation Only 作業では一切触れない） |

- AWS 操作・実送信・AI 実行を伴う作業は、**都度ユーザーの明示確認を取ってから実行する**
  （feedback: PJ2 の AWS 作業確認スタイル＝通常フロー確認は YES/NO 最小限、リスク分岐は必ず停止）。

---

## Chapter 11 — Testing Standard

### 必須テストスイート

| スイート | 対象 | 現行件数 |
|---|---|---|
| `report-preview-static.test.js` | report-preview.html/js の構造・描画順・CTA 配線 | ✓ |
| `hero-layout.test.js` | Hero の DOM 構造・append 順序の固定 | ✓ |
| `business-chance-copy.test.js` | ブランド表記統一・禁止語・Hero/Email の一貫性 | ✓ |
| `trust-section.test.js` | Trust 4項目・renderTrust の位置 | ✓ |
| `responsive-css.test.js` | レスポンシブ・a11y の静的 CSS チェック | ✓ |
| **上記5ファイル合計** | Initial Report Presentation 全体 | **67件** |
| `preview-ui.test.js` / `report-teaser-parity.test.js` | preview-ui.js と shared/report-teaser.js の parity | ✓ |
| Generator 全体（`scripts/generator/test/*.test.js`） | AI パイプライン・validate・quality-evaluator・delivery 等 | **1794件**（上記 report-preview 系67件を含む） |

### PASS 条件

- `node --test scripts/generator/test/*.test.js` が **1794 / 1794 PASS**。
- Presentation 変更時は必ず report-preview 関連5ファイルを個別実行し、67件 PASS を確認してから
  フルスイートを実行する（時間短縮のための段階的検証。Phase67〜68 で確立した手順）。
- Visual QA（Playwright）: 対象3社（ab-i.jp / illegame.com / kscope.co.jp）、幅
  375 / 390 / 430 / 768 / 1024 / 1440px で Console Error = 0、`undefined`/`null`/`[object Object]` = 0、
  横スクロール = 0、CTA リンク正常を確認する。
- Print QA（Phase68 STEP2 で確立）: Playwright の実 Chromium 印刷エンジン（`page.pdf()` /
  `emulateMedia({media:'print'})`）で3社の PDF を生成し、Cover が1ページ目に独立していること、
  Executive Summary が2ページ目から始まること、カード途中改ページがないことを確認する。

---

## Chapter 12 — Release Checklist（v1.0 リリース前）

### Design

- [ ] Report Cover / Executive Summary / Dashboard / Why Now / Why You / Opportunity Canvas /
      Why This Opportunity Matters / First Step / Evidence / Source Library / Locked / CTA / Footer が
      Chapter 4 の IA 順で揃っている
- [ ] Colors が Navy / Gold / Emerald / Slate / White の範囲内（Premium コンポーネント）
- [ ] SVG アイコンのみ、絵文字ゼロ
- [ ] Chapter 2 の禁止コピー6語がゼロ件

### Delivery

- [ ] Initial=blastengine / Weekly=SES の経路分離が維持されている
- [ ] `publish-report.js` + `deploy-aor-web.js` の両方が実行され、Published Store と Web 配信が一致している
- [ ] Weekly は `weekly_report_consent === true` のみに送信直前再チェックで絞られている

### AWS

- [ ] SES Production Access が有効（Sandbox に戻っていない）
- [ ] blastengine の配信可能アドレス制限（トライアルプラン）が本番運用条件を満たしている
- [ ] Lambda 7関数の LastModified が最新コードと一致している（fat bundle 再デプロイ漏れがない）

### Leads

- [ ] Lead State Machine（Chapter 9）の遷移がテストで担保されている
- [ ] bounced Lead への再送がブロックされている
- [ ] 同一 email×company の重複 Lead が作られない

### Published Store

- [ ] `published/<slug>.json` と `website/aor/data/<slug>.json` が SHA256 一致
- [ ] Review Status Sync（`syncPublishedHumanReview`）が公開物にのみ反映され、`report.json`/`review.json` 原本を変えていない

### Lambda

- [ ] 7関数すべて Invocations/Errors が正常範囲
- [ ] Webhook（blastengine / SES event processing）が実トラフィックで検証済み

### Email

- [ ] Initial / Weekly とも「Opportunity」「市場機会」の英語混在コピーがゼロ
- [ ] 件名・本文に禁止コピー（Chapter 2）がゼロ

### Responsive

- [ ] 375 / 390 / 430 / 768 / 1024 / 1440px で崩れなし・横スクロールなし

### Accessibility

- [ ] focus-visible がすべてのインタラクティブ要素（CTA・Source card・Footer リンク・Evidence リンク）に効く
- [ ] `prefers-reduced-motion` でアニメーション停止
- [ ] コントラスト AA（特に Navy 背景上の低不透明度テキスト）

### Print

- [ ] Cover が1ページ目に独立（`break-after: page`）
- [ ] Executive Summary が2ページ目先頭
- [ ] カード単位の途中改ページがない
- [ ] CTA が印刷ではボタンではなく URL 文字列 + プレースホルダーになっている

### QA

- [ ] 1794 / 1794 PASS
- [ ] 3社 Visual QA PASS（画面・印刷の両方）
- [ ] Git diff が意図したファイルのみ（Presentation 変更時は4ファイル、Data/Delivery 変更時は Protected
      Layer の該当ファイルのみ）
- [ ] Push は毎回ユーザーの明示確認を得てから

---

*本憲章に対する変更（章の追加・削除、固定コピーの変更、IA 順の変更等）は、実装より先にこのファイルを改訂すること。*
