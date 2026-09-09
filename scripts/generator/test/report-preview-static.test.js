/**
 * report-preview-static.test.js — website/aor/report-preview.{html,js} の静的アサーション。
 * ブラウザ実行・jsdom は使わない（aor preview 用の JS テスト基盤が無いため、文言・構造が
 * 存在することを確認する軽量方式）。動的な view model は preview-ui / market-stats のテストで担保。
 *
 * Phase56 STEP1: Hero / First-View 全面リデザイン。
 *   Hero V3 → Benefit カード → 上部 CTA → Market Snapshot → Opportunity Card V3
 *   → 根拠(折りたたみ) → 情報源(折りたたみ・最後) → 人による確認 → ほかのテーマ
 *   → Trust → 下部 CTA
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

test("report-preview.html: First-View → 結論 → 根拠 → CTA の順（Hero が先頭・source は最後の折りたたみ）", () => {
  const idx = (id) => {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i !== -1, `セクション ${id} が無い`);
    return i;
  };
  const iHero = idx("report-hero");
  const iBenefits = idx("sec-benefits");
  const iCtaTop = idx("sec-cta-top");
  const iSnapshot = idx("sec-snapshot");
  const iOpp = idx("sec-opportunity");
  const iEvidence = idx("sec-evidence");
  const iSources = idx("sec-sources");
  const iReview = idx("sec-review");
  const iTrust = idx("sec-trust");
  const iCta = idx("sec-cta");

  assert.ok(iHero < iBenefits, "Hero は Benefit カードより前");
  assert.ok(iBenefits < iCtaTop && iCtaTop < iSnapshot, "Benefit → 上部CTA → Snapshot の順");
  assert.ok(iSnapshot < iOpp, "Snapshot は Opportunity より前");
  assert.ok(iOpp < iEvidence && iEvidence < iSources, "Opportunity → 根拠 → 情報源 の順");
  assert.ok(iOpp < iSources, "情報源は Opportunity より後（結論→根拠）");
  assert.ok(iSources < iReview, "情報源 → 人による確認 の順");
  assert.ok(iTrust < iCta, "Trust は下部 CTA の直前");
  assert.ok(iSources < iCta, "情報源 → 下部CTA の順");
});

/* ---------- JS: 描画順・データソース ---------- */

test("report-preview.js: render() が Hero → Benefits → CtaTop → Snapshot → Opportunity → Evidence → Sources → Review → Locked → Trust → CtaBottom の順で呼ぶ", () => {
  const seq = [
    "renderHero(",
    "renderBenefits(",
    "renderCtaTop(",
    "renderSnapshot(",
    "renderOpportunity(",
    "renderEvidence(",
    "renderSourcesV2(",
    "renderReviewSection(",
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

/* ---------- CTA: destination 維持・全 CTA が [data-cta] 経由 ---------- */

test("report-preview.js: CTA の href は email-capture.html + 既存クエリ（company/lead/token）を保持する", () => {
  assert.match(js, /email-capture\.html\?/);
  assert.match(js, /params\.set\("company", slug\)/);
  assert.match(js, /getLeadParam\(\)/);
  assert.match(js, /getReportTokenParam\(\)/);
  assert.match(js, /querySelectorAll\("\[data-cta\]"\)/);
});

test("report-preview.js: CTA は共有ヘルパー（ctaButton）で組み立て、Hero inline + 上部 + 下部 を [data-cta] で配線", () => {
  assert.match(js, /function ctaButton\(/);
  // ctaButton の宣言1 + 呼び出し（上部・下部）で 3 回以上「ctaButton(」が出る
  const ctaButtonRefs = (js.match(/ctaButton\(/g) || []).length;
  assert.ok(ctaButtonRefs >= 3, "ctaButton の宣言 + 上部/下部の呼び出し");
  // data-cta 付与は renderHero の inline CTA と ctaButton ヘルパーの 2 箇所（実行時は 3 要素）
  const dataCta = (js.match(/setAttribute\("data-cta", ""\)/g) || []).length;
  assert.ok(dataCta >= 2, "Hero inline CTA と ctaButton ヘルパーの両方で data-cta を付与");
  // 全 CTA は querySelectorAll("[data-cta]") 経由で href を配線
  assert.match(js, /querySelectorAll\("\[data-cta\]"\)[\s\S]*?setAttribute\("href", target\)/);
});

test("report-preview.js: CTA 文言に「無料」が含まれる（上部・下部とも）", () => {
  assert.match(js, /無料で続きを見る/);
  assert.match(js, /御社専用の追加分析を見る（無料）/);
});

/* ---------- 数字の捏造禁止 ---------- */

test("report-preview.js: 市場数値は MarketStats（抽出）に委譲し、preview.js 内でリテラル数値を組み立てない", () => {
  assert.match(js, /PreviewUI\.buildOpportunityViewModel/);
  assert.match(js, /PreviewUI\.marketSnapshot/);
  assert.doesNotMatch(js, /\d+\s*兆円|\d+\s*億円|\d+(\.\d+)?\s*%[^）】]/);
});

/* ---------- Hero V3 の要素 ---------- */

test("report-preview.js: Hero に eyebrow / 宛名 / メインキャッチ(h1) / サブコピー / Pill / 確認済みバッジ / 大型イラストがある", () => {
  assert.match(js, /report-hero__eyebrow/);
  assert.match(js, /様へ/);
  assert.match(js, /report-hero__headline/);
  assert.match(js, /PreviewUI\.heroSubcopy/);
  assert.match(js, /report-hero__pill|report-hero__chip/);
  assert.match(js, /hero-review-badge/);
  assert.match(js, /Illustrations\.hero\(theme\)/);
  assert.match(js, /人間による確認済み/);
});

test("report-preview.js: Hero headline は h1（ページ最大の見出し）", () => {
  assert.match(js, /createElement\("h1"\)/);
  assert.match(js, /headline\.id = "hero-headline"/);
});

test("report-preview.js: Hero variant B は市場数値を主語にする（数値2件以上で自動切替は preview-ui が判定）", () => {
  assert.match(js, /variant === "B"/);
  assert.match(js, /pickHeroVariant/);
});

/* ---------- Benefit カード / Trust / Snapshot ---------- */

test("report-preview.js: Benefit カード（なぜ今 / なぜ御社 / 今日できること）を描画する", () => {
  assert.match(js, /PreviewUI\.benefitCards/);
  assert.match(js, /benefit-cards/);
  assert.match(js, /benefit-card__label/);
});

test("report-preview.js: Trust strip（登録不要 / 無料 / 確認済み / 停止可能）を CTA の前に描画する", () => {
  assert.match(js, /PreviewUI\.trustItems/);
  assert.match(js, /trust-strip/);
  const iTrust = js.indexOf("renderTrust(");
  const iCtaBottom = js.indexOf("renderCtaBottom(");
  assert.ok(iTrust !== -1 && iCtaBottom !== -1 && iTrust < iCtaBottom, "renderTrust は renderCtaBottom より前");
});

test("report-preview.js: Market Snapshot は 数字カード + 比較バー + タイムライン を扱う", () => {
  assert.match(js, /market-stats/);
  assert.match(js, /market-bar/);
  assert.match(js, /market-timeline/);
});

/* ---------- Responsive / a11y ---------- */

test("preview-conversion.css: モバイル breakpoint と reduced-motion 対応がある", () => {
  assert.match(css, /@media\s*\(max-width:\s*480px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion/);
});

test("preview-conversion.css: stat-card はモバイルで縦積み（flex-basis 100%）", () => {
  assert.match(css, /@media[\s\S]*?\.stat-card\s*\{[\s\S]*?flex-basis:\s*100%/);
});

test("preview-conversion.css: Benefit カードはモバイルで 1 カラム", () => {
  assert.match(css, /@media[\s\S]*?\.benefit-cards\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
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
