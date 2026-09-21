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

test("report-preview.js: CTA 文言に「無料」が含まれる（Hero inline・下部）", () => {
  assert.match(js, /無料でレポートを見る/);
  // Phase73 STEP8（CTA Premium Finish）: 下部CTAボタン文言を「無料版を毎週受け取る」から
  // 「無料版レポートを受け取る」へ変更。
  assert.match(js, /無料版レポートを受け取る/);
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

test("report-preview.js: Hero に AOR ブランド行 / 宛名 / メインキャッチ(h1) / サブコピー / Pill / 専門家監修バッジ / 大型イラストがある", () => {
  assert.match(js, /report-hero__brand/);
  assert.match(js, /BUSINESS OPPORTUNITY REPORT/);
  assert.match(js, /PreviewUI\.salutation\(cp\.name\)/);
  assert.match(js, /report-hero__headline/);
  assert.match(js, /PreviewUI\.heroSubcopy/);
  assert.match(js, /report-hero__pill|report-hero__chip/);
  assert.match(js, /hero-review-badge/);
  assert.match(js, /Illustrations\.hero\(theme\)/);
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
