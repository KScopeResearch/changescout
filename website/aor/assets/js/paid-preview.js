/*
 * AOR paid-preview.html — Phase69 STEP2（Detailed Analysis / Paid Preview Premium Redesign）
 *
 * 方針: Content SAME / Presentation NEW。表示するデータは既存の report.json
 * （published JSON）のフィールドのみ。新しい数値・事実・文章は一切作らない。
 *
 * 新 Information Architecture（Constitution 準拠。旧 paid_analysis.priority_matrix /
 * execution_support / monitoring / roadmap(day_30-90) / additional_opportunities は
 * 今回の redesign で表示対象から外れた。データ自体は report.json に残っており削除していない）:
 *   Executive Report Cover → Executive Summary → Business Intelligence Dashboard
 *   → Market Analysis → Company Analysis → Opportunity Canvas → Competitive Perspective
 *   → Action Roadmap → Evidence Library → Source Library → Additional Opportunities → CTA → Footer
 *
 * decision_summary.recommendation は存在すれば Executive Summary の「結論」として使う
 * （無ければ free_opportunity.title にフォールバック）。それ以外の paid_analysis フィールドは
 * 新 IA に該当セクションが無いため今回は描画しない。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const slug = getCompanyParam();
  if (!slug) {
    showError(
      document.getElementById("state-error-content"),
      "対象データが見つかりません。",
      "URLに ?company=<会社ID> を指定してアクセスしてください。"
    );
    showState("state-error", STATE_IDS);
    return;
  }
  try {
    const data = await fetchCompanyData(slug);
    render(data, slug);
    showState("page", STATE_IDS);
  } catch (err) {
    console.error("[AOR] 詳細分析データの読み込みに失敗しました:", err);
    showError(
      document.getElementById("state-error-content"),
      "レポートを読み込めませんでした。",
      "ブラウザのセキュリティ制限により、file:// で直接開いた場合はデータ（JSON）の読み込みがブロックされることがあります。簡易サーバーを起動してからアクセスしてください（例: python -m http.server）。"
    );
    showState("state-error", STATE_IDS);
  }
}

/* ==================== 全体描画 ==================== */

function render(data, slug) {
  const sourceMap = getSourceMap(data.source_pages);
  const vm = PreviewUI.buildOpportunityViewModel(data);
  const theme = PreviewUI.pickVisualTheme(data);
  const snapshot = PreviewUI.marketSnapshot(data);

  renderCover(data, vm, theme);
  renderExecSummary(data, vm, snapshot);
  renderDashboard(data, vm, snapshot, theme);
  renderMarketAnalysis(data, vm, snapshot, theme);
  renderCompanyAnalysis(data, vm, theme);
  renderOpportunityCanvas(data, vm, snapshot, theme);
  renderCompetitivePerspective(data, theme);
  renderRoadmap(data, theme);
  renderEvidence(data, sourceMap, theme);
  renderSources(data, theme);
  renderLocked(data.locked_opportunities);
  renderCta(slug);
  renderFooter(data);
  initPpScrollReveal();
}

/* ==================== SECTION 1: Executive Report Cover ==================== */

function renderCover(data, vm, theme) {
  const el = document.getElementById("pp-cover");
  el.innerHTML = "";
  const cp = data.company_profile || {};

  const header = document.createElement("div");
  header.className = "hero-cover-header";
  header.innerHTML =
    `<p class="report-hero__brand">` +
    `<span class="report-hero__brand-mark">AOR</span>` +
    `<span class="report-hero__doctype">BUSINESS OPPORTUNITY REPORT</span>` +
    `</p>` +
    `<div class="hero-cover-badges">` +
    `<span class="hero-cover-badge hero-cover-badge--free">PREMIUM ANALYSIS</span>` +
    `<span class="hero-cover-badge hero-cover-badge--confidential">CONFIDENTIAL</span>` +
    `<span class="hero-review-badge"><span aria-hidden="true">${Illustrations.glyph("shield_check", { size: 14 })}</span> 専門家監修</span>` +
    `</div>`;
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "hero-body";
  body.appendChild(textP("report-hero__company", PreviewUI.salutation(cp.name)));
  body.appendChild(textP("report-hero__cover-lede", "詳細分析レポート"));

  const h1 = document.createElement("h1");
  h1.className = "report-hero__headline";
  h1.textContent = vm.title || vm.headline || "";
  body.appendChild(h1);

  const sub = PreviewUI.oneLineSummary(vm.title);
  if (sub) body.appendChild(textP("report-hero__variant-line", sub));

  const metaItems = [
    ["作成日", formatDate(data.meta && data.meta.generated_at)],
    ["分析対象企業", cp.name || cp.domain],
    ["公開情報ソース数", sourceCount(data) ? sourceCount(data) + "件" : ""],
    ["確信度", vm.confidence && vm.confidence.level],
  ].filter(([, v]) => v);
  if (metaItems.length) {
    const meta = document.createElement("dl");
    meta.className = "hero-cover-meta";
    metaItems.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      meta.append(dt, dd);
    });
    body.appendChild(meta);
  }
  el.appendChild(body);

  const illust = document.createElement("div");
  illust.className = "hero-illust";
  illust.setAttribute("aria-hidden", "true");
  illust.innerHTML = Illustrations.hero(theme);
  el.appendChild(illust);
}

/* ==================== SECTION 2: Executive Summary（左70%/右30%） ==================== */

function renderExecSummary(data, vm, snapshot) {
  const el = document.getElementById("pp-exec-summary");
  el.innerHTML = "";
  const summary = (data.paid_analysis || {}).decision_summary || {};
  const fa = (data.free_opportunity || {}).first_action || "";

  const card = document.createElement("div");
  card.className = "exec-summary";
  card.innerHTML =
    `<div class="exec-summary__head">` +
    `<div class="exec-summary__title-wrap">` +
    `<span class="exec-summary__icon" aria-hidden="true">${Illustrations.glyph("intelligence_dashboard", { size: 20 })}</span>` +
    `<h2 class="exec-summary__title">Executive Summary</h2>` +
    `</div>` +
    `<span class="exec-summary__badge">経営層向け要約</span>` +
    `</div>`;

  const body = document.createElement("div");
  body.className = "exec-summary__body";

  const leftRows = [
    ["結論", summary.recommendation || vm.title],
    ["Why Now", PreviewUI.summarizeSentence(vm.whyNow, 110)],
    ["Why You", PreviewUI.summarizeSentence(vm.whyCompany, 110)],
    ["今日からできる一歩", PreviewUI.summarizeSentence(fa, 110)],
  ].filter(([, v]) => v);
  if (leftRows.length) {
    const left = document.createElement("dl");
    left.className = "exec-summary__narrative";
    leftRows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.className = "exec-summary__label";
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.className = "exec-summary__value";
      dd.textContent = value;
      left.append(dt, dd);
    });
    body.appendChild(left);
  }

  const snapItems = [
    ["確信度", "target", vm.confidence && vm.confidence.level],
    ["ソース数", "evidence_stack", sourceCount(data) ? sourceCount(data) + "件" : ""],
  ].filter(([, , v]) => v);
  if (snapItems.length) {
    const snap = document.createElement("div");
    snap.className = "exec-snapshot";
    snap.appendChild(textP("exec-snapshot__title", "Executive Snapshot"));
    const list = document.createElement("dl");
    list.className = "exec-snapshot__list";
    snapItems.forEach(([label, glyph, value]) => {
      const row = document.createElement("div");
      row.className = "exec-snapshot__row";
      row.innerHTML =
        `<span class="exec-snapshot__icon" aria-hidden="true">${Illustrations.glyph(glyph, { size: 16 })}</span>` +
        `<dt>${escapeText(label)}</dt><dd>${escapeText(value)}</dd>`;
      list.appendChild(row);
    });
    snap.appendChild(list);
    body.appendChild(snap);
  }

  if (!body.children.length) return;
  card.appendChild(body);
  el.appendChild(card);
}

/* ==================== SECTION 3: Business Intelligence Dashboard ==================== */

function renderDashboard(data, vm, snapshot, theme) {
  const el = document.getElementById("pp-dashboard");
  el.innerHTML = "";

  el.appendChild(secHead("Business Intelligence Dashboard", theme));

  const kpis = [
    vm.marketChange ? { glyph: "line_chart", label: "市場変化", value: "あり" } : null,
    /補助金|助成金/.test(String(vm.whyNow || "") + String(vm.marketChange || ""))
      ? { glyph: "subsidy_policy", label: "補助金・制度", value: "あり" }
      : null,
    sourceCount(data) ? { glyph: "evidence_stack", label: "ソース数", value: sourceCount(data) + "件" } : null,
    vm.confidence && vm.confidence.level ? { glyph: "target", label: "確信度", value: vm.confidence.level } : null,
  ].filter(Boolean);
  if (kpis.length) {
    const row = document.createElement("div");
    row.className = "kpi-row";
    kpis.forEach((k) => {
      const c = document.createElement("div");
      c.className = "kpi-card";
      c.innerHTML =
        `<span class="kpi-card__icon" aria-hidden="true">${Illustrations.glyph(k.glyph, { size: 18 })}</span>` +
        `<p class="kpi-card__label">${escapeText(k.label)}</p>` +
        `<p class="kpi-card__value">${escapeText(k.value)}</p>`;
      row.appendChild(c);
    });
    el.appendChild(row);
  }

  const why = PreviewUI.summarizeSentence(vm.whyNow, 90);
  if (why) {
    const wtm = document.createElement("div");
    wtm.className = "why-this-matters";
    wtm.innerHTML =
      `<p class="why-this-matters__label">Why this matters</p>` +
      `<p class="why-this-matters__quote">${escapeText(why)}</p>`;
    el.appendChild(wtm);
  }

  const items = [
    { glyph: "line_chart", label: "市場", text: PreviewUI.summarizeSentence(vm.marketChange, 70) },
    { glyph: "building", label: "御社", text: PreviewUI.summarizeSentence(vm.whyCompany, 70) },
    { glyph: "sparkles", label: "今動く理由", text: PreviewUI.summarizeSentence(vm.whyNow, 70) },
  ].filter((it) => it.text);
  if (items.length) {
    const grid = document.createElement("div");
    grid.className = "insight-cards";
    items.forEach((it) => {
      const c = document.createElement("div");
      c.className = "insight-card";
      c.innerHTML =
        `<span class="insight-card__icon" aria-hidden="true">${Illustrations.glyph(it.glyph, { size: 18 })}</span>` +
        `<p class="insight-card__label">${escapeText(it.label)}</p>` +
        `<p class="insight-card__text">${escapeText(it.text)}</p>`;
      grid.appendChild(c);
    });
    el.appendChild(grid);
  }
}

/* ==================== SECTION 4: Market Analysis ==================== */

function renderMarketAnalysis(data, vm, snapshot, theme) {
  const el = document.getElementById("pp-market-analysis");
  el.innerHTML = "";
  if (!vm.marketChange && !vm.whyNow) return;

  el.appendChild(secHead("Market Analysis", theme));

  const indicators = [];
  if (vm.marketChange) indicators.push({ glyph: "new_business", label: "市場変化" });
  if (/補助金|助成金/.test(String(vm.whyNow || "") + String(vm.marketChange || ""))) {
    indicators.push({ glyph: "subsidy_policy", label: "補助金" });
  }
  if (snapshot.years && snapshot.years.length) {
    indicators.push({ glyph: "milestone", label: `${snapshot.years[0]}年が節目` });
  }
  if (indicators.length) {
    const row = document.createElement("div");
    row.className = "momentum-row";
    indicators.forEach((ind) => {
      const item = document.createElement("div");
      item.className = "momentum-item";
      item.innerHTML =
        `<span class="momentum-item__icon" aria-hidden="true">${Illustrations.glyph(ind.glyph, { size: 18 })}</span>` +
        `<span class="momentum-item__label">${escapeText(ind.label)}</span>`;
      row.appendChild(item);
    });
    el.appendChild(row);
  }

  if (vm.marketChange) {
    const card = document.createElement("div");
    card.className = "reason-card";
    card.appendChild(textP("ec-block-label", "Market Change（全文）"));
    card.appendChild(textP("reason-card__text", vm.marketChange));
    el.appendChild(card);
  }

  if (vm.whyNow) {
    const card = document.createElement("div");
    card.className = "reason-card reason-card--feature";
    const iconCol = document.createElement("div");
    iconCol.className = "reason-card__icon-col";
    iconCol.innerHTML =
      `<span class="reason-card__icon" aria-hidden="true">${Illustrations.glyph(theme, { size: 28 })}</span>` +
      `<p class="reason-card__category">WHY NOW</p>`;
    card.appendChild(iconCol);
    const first = (String(vm.whyNow).match(/^[\s\S]*?。/) || [vm.whyNow])[0];
    const rest = String(vm.whyNow).slice(first.length).trim();
    const highlight = document.createElement("p");
    highlight.className = "reason-card__highlight";
    highlight.innerHTML = escapeText(first).replace(
      /([0-9０-９][0-9０-９.,]*(?:%|％|倍|件|年|兆|億|万)?)/g,
      "<strong>$1</strong>"
    );
    card.appendChild(highlight);
    if (rest) card.appendChild(textP("reason-card__text", rest));
    el.appendChild(card);
  }

  if (snapshot.stats.length) {
    const grid = document.createElement("div");
    grid.className = "market-stats";
    snapshot.stats.forEach((s) => {
      const card = document.createElement("div");
      card.className = "stat-card" + (s.isWorld ? " stat-card--world" : "");
      card.innerHTML =
        `<div class="stat-card__value">${escapeText(s.value)}</div>` +
        `<div class="stat-card__label">${escapeText(s.label || "")}</div>`;
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  if (snapshot.years.length >= 2) {
    const tl = document.createElement("ol");
    tl.className = "market-timeline";
    tl.setAttribute("aria-label", "市場の節目となる年");
    snapshot.years.forEach((y) => {
      const li = document.createElement("li");
      li.className = "market-timeline__item";
      li.innerHTML = `<span class="market-timeline__dot" aria-hidden="true"></span><span class="market-timeline__year">${escapeText(y)}年</span>`;
      tl.appendChild(li);
    });
    el.appendChild(tl);
  }
}

/* ==================== SECTION 5: Company Analysis ==================== */

function renderCompanyAnalysis(data, vm, theme) {
  const el = document.getElementById("pp-company-analysis");
  el.innerHTML = "";
  if (!vm.whyCompany) return;
  const cp = data.company_profile || {};

  el.appendChild(secHead("Company Analysis", theme));

  const wc = String(vm.whyCompany);
  const firstSentence = (wc.match(/^[\s\S]*?。/) || [wc])[0];
  const restSentences = wc.slice(firstSentence.length).trim();

  const rows = [
    ["会社名", cp.name || ""],
    ["業種", cp.industry_label || ""],
  ].filter(([, v]) => v);
  if (rows.length) {
    const intro = document.createElement("div");
    intro.className = "company-snapshot";
    intro.innerHTML =
      `<p class="company-snapshot__title"><span aria-hidden="true">${Illustrations.glyph("company_profile", { size: 15 })}</span> Company Snapshot</p>`;
    const grid = document.createElement("div");
    grid.className = "company-snapshot__grid";
    const left = document.createElement("div");
    left.className = "company-snapshot__profile company-intro-card";
    rows.forEach(([label, text]) => {
      const row = document.createElement("div");
      row.className = "company-intro-card__row";
      row.appendChild(textP("company-intro-card__label", label));
      row.appendChild(textP("company-intro-card__value", text));
      left.appendChild(row);
    });
    left.innerHTML +=
      `<p class="company-snapshot__verified"><span aria-hidden="true">${Illustrations.glyph("check_circle", { size: 14 })}</span> 公開情報確認済み</p>`;
    grid.appendChild(left);

    const fitText = PreviewUI.summarizeSentence(restSentences || firstSentence, 90);
    if (fitText) {
      const right = document.createElement("div");
      right.className = "company-snapshot__connection";
      right.appendChild(textP("company-snapshot__connection-label", "Opportunity Fit"));
      right.appendChild(textP("company-snapshot__connection-text", fitText));
      grid.appendChild(right);
    }
    intro.appendChild(grid);
    el.appendChild(intro);
  }

  if (firstSentence) {
    const strength = document.createElement("div");
    strength.className = "strength-card";
    strength.appendChild(textP("strength-card__label", "Strength"));
    const q = document.createElement("blockquote");
    q.className = "strength-card__text";
    q.textContent = firstSentence;
    strength.appendChild(q);
    el.appendChild(strength);
  }

  const card = document.createElement("div");
  card.className = "reason-card";
  card.appendChild(textP("ec-block-label", "Why You（全文）"));
  card.appendChild(textP("reason-card__text", vm.whyCompany));
  el.appendChild(card);
}

/* ==================== SECTION 6: Opportunity Canvas ==================== */

function renderOpportunityCanvas(data, vm, snapshot, theme) {
  const el = document.getElementById("pp-opportunity-canvas");
  el.innerHTML = "";
  el.appendChild(secHead("Opportunity Canvas", theme));

  const canvas = document.createElement("div");
  canvas.className = "opportunity-canvas";
  canvas.appendChild(textP("opportunity-canvas__kicker", "Opportunity Canvas"));

  const card = document.createElement("article");
  card.className = "oppv2 opportunity-canvas__layer opportunity-canvas__layer--1";
  card.innerHTML = `<div class="oppv2__head"><span class="oppv2__eyebrow">THE OPPORTUNITY</span></div>` +
    `<h3 class="oppv2__title">${escapeText(vm.title)}</h3>`;
  const summary = PreviewUI.oneLineSummary(vm.title);
  if (summary) {
    card.innerHTML += `<section class="oppv2__block oppv2__block--summary"><p class="oppv2__block-label">一言でいうと</p><p class="oppv2__summary-text">${escapeText(summary)}</p></section>`;
  }
  canvas.appendChild(card);

  const fa = (data.free_opportunity || {}).first_action || "";
  const triad = [];
  const ease = PreviewUI.summarizeSentence(fa, 60);
  if (ease) triad.push({ label: "導入しやすさ", text: ease });
  const marketText =
    PreviewUI.summarizeSentence(vm.marketChange, 60) ||
    (snapshot.stats[0] ? `${snapshot.stats[0].value}（${snapshot.stats[0].label || ""}）` : "");
  if (marketText) triad.push({ label: "市場性", text: marketText });
  const need = PreviewUI.summarizeSentence(vm.whyNow, 60);
  if (need) triad.push({ label: "顧客ニーズ", text: need });

  if (triad.length) {
    const layer2 = document.createElement("section");
    layer2.className = "canvas-layer canvas-layer--impact opportunity-canvas__layer opportunity-canvas__layer--2";
    layer2.appendChild(textP("canvas-layer__kicker", "Layer 2 — Business Impact"));
    layer2.appendChild(textP("oppv2__block-label", "このチャンスで期待できること"));
    const grid = document.createElement("div");
    grid.className = "opp-triad";
    triad.forEach((t) => {
      const c = document.createElement("div");
      c.className = "opp-triad__card";
      c.appendChild(textP("opp-triad__label", t.label));
      c.appendChild(textP("opp-triad__text", t.text));
      grid.appendChild(c);
    });
    layer2.appendChild(grid);
    canvas.appendChild(layer2);
  }

  if (vm.impact) {
    const layer3 = document.createElement("section");
    layer3.className = "canvas-layer canvas-layer--outcome opportunity-canvas__layer opportunity-canvas__layer--3";
    layer3.appendChild(textP("canvas-layer__kicker", "Layer 3 — Expected Outcome"));
    layer3.appendChild(textP("canvas-layer__text", vm.impact));
    canvas.appendChild(layer3);
  }

  el.appendChild(canvas);
}

/* ==================== SECTION 7: Competitive Perspective（新設） ==================== */

const CP_CATEGORY_LABEL = {
  government: "Government",
  company: "Company",
  directory: "Company",
  industry_association: "Industry",
  technology: "Industry",
  statistics: "Research",
  review: "Research",
  news: "News",
};
const CP_CATEGORY_GLYPH = {
  Government: "shield_check",
  Company: "building",
  Industry: "market_network",
  Research: "line_chart",
  News: "search",
};
const CP_CATEGORY_ORDER = ["Government", "Industry", "Company", "Research", "News"];

// 「今回どの種類の情報を根拠にしたか」を示すだけ。ランキング・スコアリング・競合生成は行わない。
function renderCompetitivePerspective(data, theme) {
  const el = document.getElementById("pp-competitive-perspective");
  el.innerHTML = "";
  const list = Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  if (!list.length) return;

  const counts = {};
  list.forEach((sp) => {
    const cat = CP_CATEGORY_LABEL[sp.source_type] || "Research";
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const cards = CP_CATEGORY_ORDER.filter((cat) => counts[cat]);
  if (!cards.length) return;

  el.appendChild(secHead("Competitive Perspective", theme));
  el.appendChild(
    textP("ec-premium-preview__lede", "今回の分析がどの種類の公開情報を根拠にしているかを示します。")
  );

  const grid = document.createElement("div");
  grid.className = "cp-grid";
  cards.forEach((cat) => {
    const c = document.createElement("div");
    c.className = "cp-card";
    c.innerHTML =
      `<span class="cp-card__icon" aria-hidden="true">${Illustrations.glyph(CP_CATEGORY_GLYPH[cat], { size: 20 })}</span>` +
      `<p class="cp-card__label">${cat}</p>` +
      `<p class="cp-card__count">${counts[cat]}件</p>`;
    grid.appendChild(c);
  });
  el.appendChild(grid);
}

/* ==================== SECTION 8: Action Roadmap（First Step を昇格） ==================== */

function renderRoadmap(data, theme) {
  const el = document.getElementById("pp-roadmap");
  el.innerHTML = "";
  const fa = (data.free_opportunity || {}).first_action || "";
  const steps = PreviewUI.buildFirstActionViewModel(fa);
  if (!steps.length) return;

  el.appendChild(secHead("Action Roadmap", theme));

  if (steps.length <= 1) {
    const p = document.createElement("p");
    p.className = "first-action__single";
    p.textContent = steps[0] || fa;
    el.appendChild(p);
    return;
  }

  const ol = document.createElement("ol");
  ol.className = "first-action__steps first-action__steps--timeline";
  steps.forEach((st, i) => {
    const li = document.createElement("li");
    li.className = "first-action__step";
    li.innerHTML =
      `<span class="first-action__step-num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>` +
      `<span class="first-action__step-badge">STEP${i + 1}</span>` +
      `<p>${escapeText(st)}</p>`;
    if (i < steps.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "first-action__step-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
      li.appendChild(arrow);
    }
    ol.appendChild(li);
  });
  el.appendChild(ol);

  const doneBadge = document.createElement("p");
  doneBadge.className = "first-action__done-badge";
  doneBadge.innerHTML =
    `<span aria-hidden="true">${Illustrations.glyph("rocket", { size: 14 })}</span> ` +
    `<span class="first-action__done-badge-tag">TODAY</span> 今日30分で始められます`;
  el.appendChild(doneBadge);
}

/* ==================== SECTION 9: Evidence Library ==================== */

const EVIDENCE_BADGE_LABEL = {
  company: "Company",
  government: "Government",
  industry_association: "Industry",
  statistics: "Research",
  technology: "Industry",
  news: "News",
  directory: "Company",
  review: "Research",
};
const BADGE_COLOR_KEY = {
  company: "company",
  government: "gov",
  industry_association: "industry",
  statistics: "research",
  technology: "industry",
  news: "news",
  directory: "company",
  review: "research",
};

function renderEvidence(data, sourceMap, theme) {
  const el = document.getElementById("pp-evidence");
  el.innerHTML = "";
  const evidence = (data.free_opportunity || {}).evidence || [];
  if (!evidence.length) return;

  el.appendChild(secHead("Evidence Library", theme));
  el.appendChild(textP("ec-premium-preview__lede", "公開情報・市場データ・企業情報を組み合わせて分析しました。"));

  const ul = document.createElement("ul");
  ul.className = "evi-list evi-list--card";
  evidence.forEach((ev, i) => {
    const src = sourceMap.get(ev.source_id) || {};
    const colorKey = BADGE_COLOR_KEY[src.source_type] || "research";
    const badgeLabel = EVIDENCE_BADGE_LABEL[src.source_type] || "Research";
    const li = document.createElement("li");
    li.className = "evi-item evi-item--" + (src.source_type || "other") + " evi-card";
    li.innerHTML =
      `<span class="evi-item__num" aria-hidden="true">${i + 1}</span>` +
      `<span class="evi-item__chip badge-cat badge-cat--${colorKey}">${badgeLabel}</span>` +
      (src.label ? `<p class="evi-item__title">${escapeText(decodeHtmlEntities(src.label))}</p>` : "") +
      (ev.quote ? `<blockquote class="evi-item__quote">${escapeText(ev.quote)}</blockquote>` : "") +
      (src.url
        ? `<p class="evi-item__src"><a href="${escapeText(src.url)}" target="_blank" rel="noopener noreferrer">出典を開く</a></p>`
        : "");
    ul.appendChild(li);
  });
  el.appendChild(ul);
}

/* ==================== SECTION 10: Source Library ==================== */

const SOURCE_BADGE_LABEL = {
  company: "Company",
  government: "Government",
  industry_association: "Industry",
  statistics: "Research",
  technology: "Industry",
  news: "News",
  directory: "Company",
  review: "Research",
};
const SOURCE_ICON = {
  company: "building",
  directory: "building",
  government: "shield_check",
  statistics: "line_chart",
  technology: "line_chart",
  industry_association: "line_chart",
  news: "search",
  review: "search",
};

function renderSources(data, theme) {
  const el = document.getElementById("pp-sources");
  el.innerHTML = "";
  const list = Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  if (!list.length) return;
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;

  el.appendChild(secHead("Source Library", theme));
  el.appendChild(
    textP(
      "ec-premium-preview__lede",
      `今回の分析で確認した情報源（${list.length}件${hidden > 0 ? " ＋ ほか " + hidden + " 件" : ""}）。`
    )
  );

  const grid = document.createElement("div");
  grid.className = "source-card-grid";
  list.forEach((sp) => {
    const colorKey = BADGE_COLOR_KEY[sp.source_type] || "research";
    const badgeLabel = SOURCE_BADGE_LABEL[sp.source_type] || "Research";
    const card = document.createElement("a");
    card.className = "source-card badge-cat--" + colorKey + "-border";
    card.href = sp.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.innerHTML =
      `<span class="source-card__icon" aria-hidden="true">${Illustrations.glyph(SOURCE_ICON[sp.source_type] || "search", { size: 18 })}</span>` +
      `<span class="source-card__badge badge-cat badge-cat--${colorKey}">${badgeLabel}</span>` +
      `<p class="source-card__title">${escapeText(decodeHtmlEntities(sp.label || sp.url))}</p>` +
      (sp.source_role
        ? `<p class="source-card__role">利用目的: ${escapeText(SOURCE_ROLE_LABELS[sp.source_role] || sp.source_role)}</p>`
        : "");
    grid.appendChild(card);
  });
  el.appendChild(grid);
}

/* ==================== SECTION 11: Additional Opportunities ==================== */

function renderLocked(lockedOpportunities) {
  const el = document.getElementById("pp-locked");
  el.innerHTML = "";
  const items = lockedOpportunities || [];
  if (!items.length) return;

  const panel = document.createElement("div");
  panel.className = "locked-panel";
  panel.appendChild(textP("locked-panel__title", `ほか${items.length}件のビジネスチャンス候補があります`));
  panel.appendChild(textP("locked-panel__lede", "詳細分析版で、根拠と最初の一歩まで確認できます。"));
  const cards = document.createElement("div");
  cards.className = "cards cards--locked-grid";
  items.forEach((opp) => {
    const card = createOpportunityCard(opp, { variant: "locked" });
    const lockIcon = card.querySelector(".opp-card__lock-icon");
    if (lockIcon) lockIcon.innerHTML = Illustrations.glyph("lock_premium", { size: 16 });
    const note = document.createElement("span");
    note.className = "opp-card--locked__note";
    note.textContent = "詳細分析版で公開";
    card.appendChild(note);
    cards.appendChild(card);
  });
  panel.appendChild(cards);
  panel.appendChild(textP("locked-panel__highlight", `ほか${items.length}件あります。`));
  el.appendChild(panel);
}

/* ==================== SECTION 12: Premium CTA ==================== */

function renderCta(slug) {
  const el = document.getElementById("pp-cta");
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cta-v3 cta-final";

  wrap.appendChild(textP("cta-final__title", "無料版では毎週新しい分析が届きます"));
  wrap.appendChild(
    textP(
      "cta-final__desc",
      "詳細分析版はテーマを深掘りする有料オプションです。まずは無料版で、新しいビジネスチャンスを毎週お届けします。"
    )
  );

  const compare = document.createElement("div");
  compare.className = "pp-compare-cards";
  compare.innerHTML =
    `<div class="pp-compare-card">` +
    `<p class="pp-compare-card__title">無料版</p>` +
    `<p class="pp-compare-card__text">今回のテーマを毎週更新でお届け</p>` +
    `</div>` +
    `<div class="pp-compare-card pp-compare-card--premium">` +
    `<p class="pp-compare-card__title">詳細分析版</p>` +
    `<p class="pp-compare-card__text">市場規模・競合・実行ロードマップまで深掘り</p>` +
    `</div>`;
  wrap.appendChild(compare);

  const cta = document.createElement("a");
  cta.className = "cta-v3__btn";
  cta.href = `email-capture.html?company=${encodeURIComponent(slug)}`;
  cta.innerHTML =
    `<span class="cta-v3__btn-text">無料版を毎週受け取る</span>` +
    `<span class="cta-v3__btn-arrow" aria-hidden="true">${Illustrations.glyph("cta_arrow", { size: 16 })}</span>`;
  wrap.appendChild(cta);
  wrap.appendChild(textP("cta-final__note", "営業電話はいたしません。公開情報ベースで分析します。"));

  el.appendChild(wrap);
}

/* ==================== SECTION 13: Footer ==================== */

function renderFooter(data) {
  const el = document.getElementById("pp-footer");
  el.innerHTML = "";
  const gen = formatDate(data.meta && data.meta.generated_at);
  const count = sourceCount(data);

  el.innerHTML =
    `<div class="report-footer__brand">` +
    `<span class="report-footer__brand-mark">AOR</span>` +
    `<span class="report-footer__brand-doctype">BUSINESS OPPORTUNITY REPORT</span>` +
    `</div>` +
    `<p class="report-footer__tagline">専門家監修・公開情報分析レポート</p>` +
    `<p class="report-footer__links">` +
    `<a href="#" id="pp-footer-correction">情報修正依頼</a> ・ ` +
    `<a href="#" id="pp-footer-opt-out">配信停止</a> ・ ` +
    `<a href="index.html">運営会社</a> ・ ` +
    `<a href="privacy.html">プライバシー</a>` +
    `</p>` +
    (gen || count
      ? `<p class="report-footer__meta">${[gen ? "分析日: " + escapeText(gen) : "", count ? "分析ソース数: " + count + "件" : ""].filter(Boolean).join(" ・ ")}</p>`
      : "") +
    `<p class="report-footer__copyright">© ${new Date().getFullYear()} AOR — Business Opportunity Report</p>`;

  document.getElementById("pp-footer-correction").setAttribute("href", mailtoLink("レポート内容の訂正について"));
  document.getElementById("pp-footer-opt-out").setAttribute(
    "href",
    mailtoLink("配信停止のご連絡", "配信停止を希望します。\n")
  );
}

/* ==================== Animation（Initial Report と同一） ==================== */

function initPpScrollReveal() {
  const targets = Array.from(
    document.querySelectorAll(
      "#pp-cover, #pp-exec-summary, #pp-dashboard, #pp-market-analysis, #pp-company-analysis, #pp-opportunity-canvas, #pp-competitive-perspective, #pp-roadmap, #pp-evidence, #pp-sources, #pp-locked, #pp-cta"
    )
  );
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || typeof IntersectionObserver === "undefined") {
    targets.forEach((el) => el.classList.add("reveal", "is-visible"));
    return;
  }

  targets.forEach((el) => el.classList.add("reveal"));
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -80px 0px" }
  );
  targets.forEach((el) => observer.observe(el));
}

/* ==================== 小さなヘルパー ==================== */

function secHead(title, theme) {
  const h = document.createElement("div");
  h.className = "sec-head";
  h.innerHTML =
    `<span class="sec-head__glyph" aria-hidden="true">${Illustrations.glyph(theme, { size: 20 })}</span>` +
    `<h2 class="sec-head__title">${escapeText(title)}</h2>`;
  return h;
}

function textP(className, text) {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

function escapeText(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function decodeHtmlEntities(s) {
  var t = String(s == null ? "" : s);
  if (!/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|#39);/i.test(t)) return t;
  return t
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sourceCount(data) {
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;
  return list.length + hidden;
}
