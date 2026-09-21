/**
 * report-preview-static.test.js — website/aor/report-preview.{html,js} の静的アサーション。
 * ブラウザ実行・jsdom は使わない（aor preview 用の JS テスト基盤が無いため、文言・構造が
 * 存在することを確認する軽量方式）。動的な view model は preview-ui / market-stats のテストで担保。
 *
 * Phase66 STEP2: Content SAME / Presentation NEW。
 *   Hero → Metrics（2-up: 市場の追い風 / 御社との適合） → WHY NOW → WHY YOU
 *   → THE OPPORTUNITY → FIRST STEP → 根拠(折りたたみ) → 情報源(折りたたみ・最後)
 *   → ほかのテーマ → Trust → 下部 CTA
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const js = fs.readFileSync(path.join(WEB, "assets", "js", "report-preview.js"), "utf-8");
const html = fs.readFileSync(path.join(WEB, "report-preview.html"), "utf-8");
const css = fs.readFileSync(path.join(WEB, "assets", "css", "preview-conversion.css"), "utf-8");

/* ---------- HTML: スクリプト・セクション構成 ---------- */

test("report-preview.html: 必要な JS を正しい順で読み込む（guard → stats → ui → illust → common → preview）", () => {
  const order = [
    "assets/js/summary-guard.js",
    "assets/js/market-stats.js",
    "assets/js/preview-ui.js",
    "assets/js/illustrations.js",
    "assets/js/common.js",
    "assets/js/report-preview.js",
  ];
  let last = -1;
  for (const src of order) {
    const idx = html.indexOf(src);
    assert.ok(idx !== -1, `${src} の <script> が無い`);
    assert.ok(idx > last, `${src} の読み込み順が正しくない`);
    last = idx;
  }
});

test("report-preview.html: Hero → Metrics → Executive Brief → Why Now → Why You → Opportunity → 根拠 → 情報源 → ほかのテーマ → Trust → CTA の順（Phase75 STEP1: IA Refresh）", () => {
  const idx = (id) => {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i !== -1, `セクション ${id} が無い`);
    return i;
  };
  const iHero = idx("report-hero");
  const iMetrics = idx("sec-metrics");
  const iExecBrief = idx("sec-exec-summary");
  const iWhyNow = idx("sec-why-now");
  const iWhyYou = idx("sec-why-you");
  const iOpp = idx("sec-opportunity");
  const iEvidence = idx("sec-evidence");
  const iSources = idx("sec-sources");
  const iLocked = idx("sec-locked");
  const iTrust = idx("sec-trust");
  const iCta = idx("sec-cta");

  assert.ok(!html.includes('id="sec-first-step"'), "旧 sec-first-step は Executive Brief へ統合され廃止されている");
  assert.ok(iHero < iMetrics, "Hero は Metrics より前");
  assert.ok(iMetrics < iExecBrief, "Metrics（Dashboard）は Executive Brief より前");
  assert.ok(iExecBrief < iWhyNow && iWhyNow < iWhyYou, "Executive Brief → WhyNow → WhyYou の順");
  assert.ok(iWhyYou < iOpp && iOpp < iEvidence, "WhyYou → Opportunity → 根拠 の順");
  assert.ok(iEvidence < iSources, "根拠 → 情報源 の順");
  assert.ok(iSources < iLocked && iLocked < iTrust && iTrust < iCta, "情報源 → ほかのテーマ → Trust → CTA の順");
});

/* ---------- JS: 描画順・データソース ---------- */

test("report-preview.js: render() が Hero → Metrics → ExecutiveSummary(Brief) → WhyNow → WhyYou → Opportunity → Evidence → Sources → Locked → Trust → CtaBottom の順で呼ぶ（Phase75 STEP1: IA Refresh。旧 renderFirstStep は Executive Brief へ統合され廃止）", () => {
  assert.doesNotMatch(js, /function renderFirstStep\(/, "renderFirstStep は削除済みのはず");
  const seq = [
    "renderHero(",
    "renderMetrics(",
    "renderExecutiveSummary(",
    "renderWhyNow(",
    "renderWhyYou(",
    "renderOpportunity(",
    "renderEvidence(",
    "renderSourcesV2(",
    "renderLockedThemes(",
    "renderTrust(",
    "renderCtaBottom(",
  ];
  let last = -1;
  for (const fn of seq) {
    const idx = js.indexOf(fn);
    assert.ok(idx !== -1, `${fn} の呼び出しが無い`);
    assert.ok(idx > last, `${fn} の順が正しくない`);
    last = idx;
  }
});

test("report-preview.js: business_summary をこのページでは一切描画しない（P0-1 の露出面をなくす）", () => {
  const codeOnly = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /business_summary/);
});

test("report-preview.js: summary-guard.js は引き続き読み込む（他ページ・将来のため）", () => {
  assert.match(html, /assets\/js\/summary-guard\.js/);
});

test("report-preview.js: top_sources を優先し、無ければ source_pages を使う", () => {
  assert.match(js, /data\.top_sources[\s\S]{0,80}data\.source_pages/);
});

test("report-preview.js: 隠れた情報源件数を「ほか N 件」として表示する", () => {
  assert.match(js, /hidden_sources_count/);
  assert.match(js, /ほか .*件/);
});

test("report-preview.js: 情報源セクションの見出しは『今回の分析で確認した情報源』", () => {
  assert.match(js, /今回の分析で確認した情報源/);
});

test("report-preview.js: evidence 結合には source_pages 全体を使う（getSourceMap(data.source_pages)）", () => {
  assert.match(js, /getSourceMap\(data\.source_pages\)/);
});

test("report-preview.js: 情報源ラベルの HTML 数値文字参照をデコードして表示する（&#8211; がそのまま出ない）", () => {
  assert.match(js, /function decodeHtmlEntities/);
  assert.match(js, /decodeHtmlEntities\(sp\.label/);
  assert.match(js, /decodeHtmlEntities\(src\.label/);
});

/* ---------- CTA: destination 維持・全 CTA が [data-cta] 経由 ---------- */

test("report-preview.js: CTA の href は email-capture.html + 既存クエリ（company/lead/token）を保持する", () => {
  assert.match(js, /email-capture\.html\?/);
  assert.match(js, /params\.set\("company", slug\)/);
  assert.match(js, /getLeadParam\(\)/);
  assert.match(js, /getReportTokenParam\(\)/);
  assert.match(js, /querySelectorAll\("\[data-cta\]"\)/);
});

test("report-preview.js: CTA は共有ヘルパー（ctaButton）で組み立て、Hero inline + 下部 を [data-cta] で配線", () => {
  assert.match(js, /function ctaButton\(/);
  // ctaButton の宣言1 + 下部 CTA の呼び出しで 2 回以上「ctaButton(」が出る
  const ctaButtonRefs = (js.match(/ctaButton\(/g) || []).length;
  assert.ok(ctaButtonRefs >= 2, "ctaButton の宣言 + 下部の呼び出し");
  // data-cta 付与は renderHero の inline CTA と ctaButton ヘルパーの 2 箇所（実行時は 2 要素）
  const dataCta = (js.match(/setAttribute\("data-cta", ""\)/g) || []).length;
  assert.ok(dataCta >= 2, "Hero inline CTA と ctaButton ヘルパーの両方で data-cta を付与");
  // 全 CTA は querySelectorAll("[data-cta]") 経由で href を配線
  assert.match(js, /querySelectorAll\("\[data-cta\]"\)[\s\S]*?setAttribute\("href", target\)/);
});

test("report-preview.js: CTA 文言は Hero inline・下部とも「無料版レポートを見る」に統一されている（Phase76 STEP4: Link UX Cleanup）", () => {
  const matches = js.match(/無料版レポートを見る/g) || [];
  assert.ok(matches.length >= 2, "Hero inline CTA と 下部CTA の両方に同一文言があるはず");
});

/* ---------- 数字の捏造禁止 ---------- */

test("report-preview.js: 市場数値は MarketStats（抽出）に委譲し、preview.js 内でリテラル数値を組み立てない", () => {
  assert.match(js, /PreviewUI\.buildOpportunityViewModel/);
  assert.match(js, /PreviewUI\.marketSnapshot/);
  assert.doesNotMatch(js, /\d+\s*兆円|\d+\s*億円|\d+(\.\d+)?\s*%[^）】]/);
});

test("report-preview.js: 『御社との適合』カードは確信度・why_company の既存フィールドのみを使う（新しいスコアを作らない）", () => {
  assert.match(js, /function buildFitMetricCard/);
  assert.match(js, /vm\.confidence\.level/);
  assert.match(js, /vm\.whyCompany/);
  assert.doesNotMatch(js, /Math\.random/);
});

/* ---------- Hero の要素 ---------- */

test("report-preview.js: Hero に AOR ブランド行 / 宛名 / メインキャッチ(h1) / サブコピー / Pill / 専門家監修バッジ / Hero画像がある（Phase75 STEP2/STEP3: 実画像化）", () => {
  assert.match(js, /report-hero__brand/);
  assert.match(js, /BUSINESS OPPORTUNITY REPORT/);
  assert.match(js, /PreviewUI\.salutation\(cp\.name\)/);
  assert.match(js, /report-hero__headline/);
  assert.match(js, /PreviewUI\.heroSubcopy/);
  assert.match(js, /report-hero__pill|report-hero__chip/);
  assert.match(js, /hero-review-badge/);
  assert.match(js, /hero-illust-img/);
  assert.match(js, /assets\/images\/hero-business-dashboard-v1\.png/);
  assert.match(js, /専門家監修/);
});

test("report-preview.js: Hero headline は h1（ページ最大の見出し）", () => {
  assert.match(js, /createElement\("h1"\)/);
  assert.match(js, /headline\.id = "hero-headline"/);
});

test("report-preview.js: Hero variant B は市場数値を主語にする（数値2件以上で自動切替は preview-ui が判定）", () => {
  assert.match(js, /variant === "B"/);
  assert.match(js, /pickHeroVariant/);
});

/* ---------- Metrics / Trust / First Step ---------- */

test("report-preview.js: Metrics は 2-up カード（市場の追い風 / 御社との適合）+ 数字カード + 比較バー + タイムライン を扱う", () => {
  assert.match(js, /metrics-2up/);
  assert.match(js, /市場の追い風/);
  assert.match(js, /御社との適合/);
  assert.match(js, /market-stats/);
  assert.match(js, /market-bar/);
  assert.match(js, /market-timeline/);
});

test("report-preview.js: 今日やること（旧 FIRST STEP）は Executive Brief の TODAY カードへ統合されている（Phase75 STEP1: IA Refresh）", () => {
  assert.match(js, /free_opportunity[\s\S]{0,20}first_action/);
  assert.match(js, /exec-brief-card--today/);
  assert.match(js, /"TODAY"/);
});

/* ---------- Phase76 STEP1: Final UX Polish（重複削減・続きを読む） ---------- */

test("report-preview.js: Executive Brief Card1（今回見つかったビジネスチャンス）にも「続きを読む」（#sec-opportunity）がある", () => {
  const body = js.slice(js.indexOf("function renderExecutiveSummary("), js.indexOf("function execBriefCard("));
  assert.match(body, /glyph:\s*"target"[\s\S]{0,300}jumpHref:\s*"#sec-opportunity"/);
});

test("report-preview.js: WHY NOW はExecutive Briefと重複する冒頭一文をそのまま太字ハイライト表示しない（reason-card__highlightを使わない）", () => {
  const body = js.slice(js.indexOf("function renderWhyNow("), js.indexOf("function renderWhyYou("));
  assert.doesNotMatch(body, /reason-card__highlight/);
});

test("report-preview.js: WHY YOU の Strength Analysis 引用は要約（summarizeSentence）で短く表示する", () => {
  const body = js.slice(js.indexOf("function renderWhyYou("), js.indexOf("function renderOpportunity("));
  const strengthBlock = body.slice(body.indexOf("strength-card__text"));
  assert.match(strengthBlock.slice(0, 400), /PreviewUI\.summarizeSentence\(firstSentence/);
});

test("report-preview.js: Dashboard（Metrics）から重複していた「今回わかったこと」insight-cards・Why this matters引用を削除した（Executive Snapshot・KPIは維持）", () => {
  const body = js.slice(js.indexOf("function renderMetrics("), js.indexOf("function buildMarketMetricCard("));
  assert.doesNotMatch(body, /insight-cards/);
  assert.doesNotMatch(body, /why-this-matters/);
  assert.match(body, /exec-snapshot--dashboard/, "Executive Snapshotは維持されているはず");
  assert.match(body, /kpi-row/, "KPIカードは維持されているはず");
});

test("report-preview.js: buildInsightCards は未使用のため削除されている", () => {
  assert.doesNotMatch(js, /function buildInsightCards/);
});

test("report-preview.js: 「続きを読む」クリックでジャンプ先の見出しを一瞬ハイライトする（CSSアニメーション、新しい文言は追加しない）", () => {
  assert.match(js, /exec-brief-card__more/);
  assert.match(js, /sec-head--flash/);
  const wireBody = js.slice(js.indexOf("function wireJumpHighlight("));
  assert.doesNotMatch(wireBody.slice(0, 600), /textContent\s*=\s*["'][^"']+["']/, "新しい文言を追加していないはず");
});

test("report-preview.js: render() は wireJumpHighlight を呼ぶ", () => {
  const start = js.indexOf("function render(data, slug)");
  const body = js.slice(start, js.indexOf("function renderPrintChrome("));
  assert.match(body, /wireJumpHighlight\(\)/);
});

test("preview-conversion.css: .sec-head--flash は prefers-reduced-motion で停止する", () => {
  assert.match(css, /\.sec-head--flash\s*\{[\s\S]*?animation:/);
  const idx = css.indexOf(".sec-head--flash");
  const reduceBlock = css.slice(idx);
  assert.match(reduceBlock, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.sec-head--flash[\s\S]*?animation:\s*none/);
});

test("preview-conversion.css: .kpi-card のpaddingは24pxに統一（border-radiusはPhase76 STEP4で24pxへ統一）", () => {
  const idx = css.indexOf(".kpi-card {");
  const block = css.slice(idx, css.indexOf("}", idx));
  assert.match(block, /padding:\s*24px/);
  assert.match(block, /border-radius:\s*24px/);
});

test("report-preview.js: Trust strip（メールアドレス登録だけ / 専門家監修 / 無料版を毎週配信 / 停止可能）を CTA の前に描画する", () => {
  assert.match(js, /PreviewUI\.trustItems/);
  assert.match(js, /trust-strip/);
  const iTrust = js.indexOf("renderTrust(");
  const iCtaBottom = js.indexOf("renderCtaBottom(");
  assert.ok(iTrust !== -1 && iCtaBottom !== -1 && iTrust < iCtaBottom, "renderTrust は renderCtaBottom より前");
});

/* ---------- Responsive / a11y ---------- */

test("preview-conversion.css: モバイル breakpoint と reduced-motion 対応がある", () => {
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion/);
});

test("preview-conversion.css: stat-card はモバイルで縦積み（flex-basis 100%）", () => {
  assert.match(css, /@media[\s\S]*?\.stat-card\s*\{[\s\S]*?flex-basis:\s*100%/);
});

test("preview-conversion.css: Metrics 2-up はモバイルで 1 カラム", () => {
  assert.match(css, /\.metrics-2up\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*1fr\)/);
  assert.match(css, /@media[\s\S]*?\.metrics-2up\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("preview-conversion.css: CTA V3 はモバイルで全幅、focus-visible のアウトラインがある", () => {
  assert.match(css, /@media[\s\S]*?\.cta-v3__btn\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.cta-v3__btn:focus-visible/);
});

test("preview-conversion.css: 横スクロール防止に body { overflow-x: hidden } と stat 値の overflow-wrap がある", () => {
  assert.match(css, /body\s*\{\s*overflow-x:\s*hidden/);
  assert.match(css, /\.stat-card__value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
});

test("report-preview.js: illustration は aria-hidden（意味は本文が担う）", () => {
  assert.match(js, /setAttribute\("aria-hidden", "true"\)/);
});

/* ---------- Phase76 STEP4: Final Polish（Contrast AA + Link UX Cleanup） ---------- */

test("preview-conversion.css: 白背景カード上のGoldラベル（exec-snapshot__title / exec-brief-card__label / metric-card__fit-tag）はGold文字をやめ、Navy文字+Goldバッジへ変更している", () => {
  [".exec-snapshot__title", ".exec-brief-card__label", ".metric-card__fit-tag"].forEach((sel) => {
    const idx = css.indexOf(sel + " {");
    assert.ok(idx !== -1, `${sel} のルールが無い`);
    const block = css.slice(idx, css.indexOf("}", idx));
    assert.doesNotMatch(block, /color:\s*var\(--aor-gold/, `${sel} がまだGold文字のまま`);
    assert.match(block, /color:\s*var\(--aor-navy\)/, `${sel} がNavy文字になっていない`);
    assert.match(block, /border:\s*1px solid var\(--aor-gold\)/, `${sel} にGoldボーダーが無い`);
  });
});

test("report-preview.js: CTA直下に固定コピー2行（メールアドレス登録だけで無料版レポートを毎週配信します。/詳細分析サンプルも確認できます。）がある", () => {
  assert.match(js, /メールアドレス登録だけで無料版レポートを毎週配信します。/);
  assert.match(js, /詳細分析サンプルも確認できます。/);
});

test("report-preview.js: 「続きを読む」は矢印付き表記（続きを読む →）になっている", () => {
  assert.match(js, /続きを読む\s*→/);
});

test("preview-conversion.css: Executive Brief カードの余白（上下28px/左右24px）・タイトル（20px/700/margin-bottom10px）・本文（16px/line-height1.8）が更新されている", () => {
  const cardIdx = css.indexOf(".exec-brief-card {");
  const cardBlock = css.slice(cardIdx, css.indexOf("}", cardIdx));
  assert.match(cardBlock, /padding:\s*28px 24px/);

  const titleIdx = css.indexOf(".exec-brief-card__title {");
  const titleBlock = css.slice(titleIdx, css.indexOf("}", titleIdx));
  assert.match(titleBlock, /font-size:\s*20px/);
  assert.match(titleBlock, /font-weight:\s*700/);
  assert.match(titleBlock, /margin:\s*0 0 10px/);

  const bodyIdx = css.indexOf(".exec-brief-card__body {");
  const bodyBlock = css.slice(bodyIdx, css.indexOf("}", bodyIdx));
  assert.match(bodyBlock, /font-size:\s*16px/);
  assert.match(bodyBlock, /line-height:\s*1\.8/);
});

test("preview-conversion.css: Dashboard KPIカードにGold 3pxライン・24px Radius・Heroと同じShadowが適用されている", () => {
  const idx = css.indexOf(".kpi-card {");
  const block = css.slice(idx, css.indexOf("}", idx));
  assert.match(block, /border-top:\s*3px solid var\(--aor-gold\)/);
  assert.match(block, /border-radius:\s*24px/);
  assert.match(block, /box-shadow:\s*var\(--shadow-xl\)/);
});
