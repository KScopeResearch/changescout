/*
 * AOR report-preview.html — Phase55 STEP3（Conversion 版）
 *
 * Email → Preview → 詳細分析 の導線を前提に、「御社向けの営業提案」として描画する。
 * 描画順: Hero → この機会 → 市場で起きていること → なぜ御社か → 今日できること
 *        → 根拠(折りたたみ) → 情報源(折りたたみ) → 人による確認 → ほかのテーマ → CTA
 *
 * データは published JSON（common.js の fetchCompanyData）のみ。API 連携・LLM なし。
 * pure な view model 変換は preview-ui.js / market-stats.js、図は illustrations.js。
 *
 * Phase55 P0-1: business_summary は本ページでは一切表示しない（壊れた抽出結果の露出面を
 * なくすため）。会社の実態は「なぜ御社か（why_company）」で示す。summary-guard.js は
 * 読み込み維持（他ページ・将来のため）。
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
    trackEvent("preview_view", data);
  } catch (err) {
    console.error("[AOR] レポートデータの読み込みに失敗しました:", err);
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
  const variant = PreviewUI.pickHeroVariant(data);
  const theme = PreviewUI.pickVisualTheme(data);
  const review = PreviewUI.humanReviewLine(data);

  renderHero(data, vm, variant, theme, review);
  renderOpportunity(vm, theme);
  renderMarketSection(data, vm, theme);
  renderWhyYou(vm, theme);
  renderFirstAction(data, theme);
  renderEvidence(data, sourceMap);
  renderSourcesV2(data);
  renderReviewSection(review);
  renderLockedThemes(data.locked_opportunities);
  renderCtaBottom();
  renderFooter(data);
  wireCtas(slug);
}

/* ==================== Hero ==================== */

function renderHero(data, vm, variant, theme, review) {
  const el = document.getElementById("report-hero");
  el.innerHTML = "";
  const cp = data.company_profile || {};

  el.appendChild(textP("report-hero__eyebrow", "御社向け 市場機会レポート"));
  el.appendChild(textP("report-hero__company", `${cp.name || ""} 様へ`));

  // Headline: variant B = 市場変化を主語 / variant A = Opportunity を benefit で
  const headline = document.createElement("h1");
  headline.className = "report-hero__headline";
  if (variant === "B" && vm.stats.length) {
    const s = vm.stats[0];
    headline.textContent = `${labelWithScope(s)}は ${s.value}。この変化に、御社が取れる一手があります。`;
  } else {
    headline.textContent = vm.headline;
  }
  el.appendChild(headline);

  // Opportunity Pill
  const pill = document.createElement("p");
  pill.className = "report-hero__pill";
  const plabel = document.createElement("span");
  plabel.className = "report-hero__pill-label";
  plabel.textContent = "この機会";
  const ptext = document.createElement("span");
  ptext.textContent = vm.title;
  pill.append(plabel, ptext);
  el.appendChild(pill);

  // Subheadline: なぜ御社か の1文目
  const sub = firstSentence(vm.whyCompany);
  if (sub) el.appendChild(textP("report-hero__sub", sub));

  // Illustration
  const illust = document.createElement("div");
  illust.className = "hero-illust";
  illust.innerHTML = Illustrations.hero(theme);
  el.appendChild(illust);

  // Badges: 市場バッジ（先頭 stat）＋ Human Review
  const badges = document.createElement("div");
  badges.className = "report-hero__badges";
  if (vm.stats.length) {
    const b = document.createElement("span");
    b.className = "market-badge";
    b.innerHTML =
      `<span class="market-badge__value">${escapeText(vm.stats[0].value)}</span>` +
      `<span class="market-badge__label">${escapeText(labelWithScope(vm.stats[0]))}</span>`;
    badges.appendChild(b);
  }
  badges.appendChild(reviewLineEl(review, true));
  el.appendChild(badges);

  // Inline CTA
  const cta = document.createElement("a");
  cta.className = "hero-cta-inline";
  cta.href = "#";
  cta.setAttribute("data-cta", "");
  cta.textContent = "▸ この機会を詳しく見る";
  el.appendChild(cta);
}

/* ==================== ① この機会 ==================== */

function renderOpportunity(vm, theme) {
  const el = document.getElementById("sec-opportunity");
  el.innerHTML = "";
  el.appendChild(secHead("この機会", theme));

  const card = document.createElement("article");
  card.className = "oppv2";

  const eyebrow = document.createElement("span");
  eyebrow.className = "oppv2__eyebrow";
  eyebrow.textContent = "OPPORTUNITY";
  card.appendChild(eyebrow);

  const title = document.createElement("h3");
  title.className = "oppv2__title";
  title.textContent = vm.title;
  card.appendChild(title);

  card.appendChild(oppBlock("なぜ今、この機会か", vm.whyNow));
  if (vm.impact) card.appendChild(oppBlock("見込まれるインパクト", vm.impact));

  if (vm.confidence && (vm.confidence.level || vm.confidence.caveat)) {
    const c = document.createElement("p");
    c.className = "oppv2__confidence";
    c.innerHTML =
      `<strong>確信度: ${escapeText(vm.confidence.level || "中")}</strong>` +
      (vm.confidence.caveat ? ` — ${escapeText(vm.confidence.caveat)}` : "");
    card.appendChild(c);
  }

  el.appendChild(card);
}

/* ==================== ② 市場で起きていること ==================== */

function renderMarketSection(data, vm, theme) {
  const el = document.getElementById("sec-market");
  el.innerHTML = "";
  el.appendChild(secHead("市場で起きていること", theme));

  // Stat cards
  if (vm.stats.length) {
    const grid = document.createElement("div");
    grid.className = "market-stats";
    vm.stats.forEach((s) => {
      const cardEl = document.createElement("div");
      cardEl.className = "stat-card";
      cardEl.innerHTML =
        `<div class="stat-card__value">${escapeText(s.value)}</div>` +
        `<div class="stat-card__label">${escapeText(labelWithScope(s))}</div>` +
        (s.sourceId ? `<div class="stat-card__src">出典: ${escapeText(s.sourceId)}</div>` : "");
      grid.appendChild(cardEl);
    });
    el.appendChild(grid);
  } else {
    el.appendChild(textP("market-stats__none", "公開情報からは、視覚化できる市場の数値は確認できませんでした。"));
  }

  // 比較バー（「約N倍」がある場合のみ・deterministic）
  const mult = vm.stats.find((s) => s.kind === "multiple");
  if (mult) {
    const m = mult.value.match(/(\d+(?:\.\d+)?)/);
    const factor = m ? parseFloat(m[1]) : 0;
    if (factor > 1 && factor <= 20) {
      const bar = document.createElement("div");
      bar.className = "market-bar";
      const pct = Math.round((1 / factor) * 100);
      bar.innerHTML =
        `<div>現在 → 目標: <strong>${escapeText(mult.value)}</strong></div>` +
        `<div class="market-bar__track"><div class="market-bar__fill" style="width:${pct}%"></div></div>`;
      el.appendChild(bar);
    }
  }

  // market_change 本文
  if (vm.marketChange) {
    const p = document.createElement("p");
    p.style.margin = "12px 0 0";
    p.style.fontSize = "0.94rem";
    p.style.lineHeight = "1.85";
    p.textContent = vm.marketChange;
    el.appendChild(p);
  }

  // 中間 CTA
  const cta = document.createElement("div");
  cta.className = "cta-v2";
  cta.style.marginTop = "20px";
  const a = document.createElement("a");
  a.className = "cta-v2__btn";
  a.href = "#";
  a.setAttribute("data-cta", "");
  a.textContent = ctaText();
  cta.appendChild(a);
  el.appendChild(cta);
}

/* ==================== ③ なぜ御社か ==================== */

function renderWhyYou(vm, theme) {
  const el = document.getElementById("sec-whyyou");
  el.innerHTML = "";
  el.appendChild(secHead("なぜ御社に、この機会か", theme));

  const p = document.createElement("p");
  p.style.margin = "0";
  p.style.fontSize = "0.95rem";
  p.style.lineHeight = "1.85";
  if (vm.whyCompany && vm.whyCompany.length >= 20) {
    p.textContent = vm.whyCompany;
  } else {
    p.textContent =
      "このOpportunityは、公開情報から確認できた御社の事業領域と、市場変化との接点をもとに候補として提示しています。";
  }
  el.appendChild(p);
}

/* ==================== ④ 今日できること ==================== */

function renderFirstAction(data, theme) {
  const el = document.getElementById("sec-firstaction");
  el.innerHTML = "";
  el.appendChild(secHead("今日できること", theme));

  const fa = (data.free_opportunity || {}).first_action || "";
  const steps = PreviewUI.buildFirstActionViewModel(fa);
  const wrap = document.createElement("div");
  wrap.className = "first-action";

  if (steps.length <= 1) {
    const p = document.createElement("p");
    p.className = "first-action__single";
    p.textContent = steps[0] || fa || "（この機会に着手するための最初の一歩は、詳細分析でご案内します）";
    wrap.appendChild(p);
  } else {
    const ol = document.createElement("ol");
    ol.className = "first-action__steps";
    steps.forEach((s) => {
      const li = document.createElement("li");
      li.className = "first-action__step";
      const p = document.createElement("p");
      p.textContent = s;
      li.appendChild(p);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
  }
  el.appendChild(wrap);
}

/* ==================== ⑤ 根拠（折りたたみ） ==================== */

function renderEvidence(data, sourceMap) {
  const el = document.getElementById("sec-evidence");
  el.innerHTML = "";
  const evidence = (data.free_opportunity || {}).evidence || [];
  if (!evidence.length) return;

  const details = document.createElement("details");
  details.className = "disclosure";
  const summary = document.createElement("summary");
  summary.textContent = `この提案の根拠（${evidence.length}件）`;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "disclosure__body";
  const ul = document.createElement("ul");
  ul.className = "evi-list";
  evidence.forEach((ev) => {
    const src = sourceMap.get(ev.source_id) || {};
    const li = document.createElement("li");
    li.className = "evi-item evi-item--" + (src.source_type || "other");
    const chip = document.createElement("span");
    chip.className = "evi-item__chip";
    chip.textContent = (SOURCE_TYPE_LABELS[src.source_type] || src.source_type || "参考") + (src.label ? " · " + src.label : "");
    li.appendChild(chip);
    if (ev.quote) {
      const q = document.createElement("blockquote");
      q.className = "evi-item__quote";
      q.textContent = ev.quote;
      li.appendChild(q);
    }
    if (src.url) {
      const sp = document.createElement("p");
      sp.className = "evi-item__src";
      const a = document.createElement("a");
      a.href = src.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "出典を開く";
      sp.appendChild(a);
      li.appendChild(sp);
    }
    ul.appendChild(li);
  });
  body.appendChild(ul);
  details.appendChild(body);
  el.appendChild(details);
}

/* ==================== ⑥ 情報源（折りたたみ・カテゴリ別） ==================== */

function renderSourcesV2(data) {
  const el = document.getElementById("sec-sources");
  el.innerHTML = "";
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  if (!list.length) return;
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;

  const details = document.createElement("details");
  details.className = "disclosure";
  const summary = document.createElement("summary");
  summary.textContent =
    `参照した情報源（${list.length}件${hidden > 0 ? " ＋ ほか " + hidden + " 件" : ""}）`;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "disclosure__body";
  PreviewUI.categorizeSources(list).forEach((group) => {
    const g = document.createElement("div");
    g.className = "source-group";
    g.appendChild(textP("source-group__label", group.label));
    const ul = document.createElement("ul");
    ul.className = "source-group__list";
    group.items.forEach((sp) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = sp.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = sp.label || sp.url;
      li.appendChild(a);
      ul.appendChild(li);
    });
    g.appendChild(ul);
    body.appendChild(g);
  });
  details.appendChild(body);
  el.appendChild(details);
}

/* ==================== ⑦ 人による確認 ==================== */

function renderReviewSection(review) {
  const el = document.getElementById("sec-review");
  el.innerHTML = "";
  el.appendChild(reviewLineEl(review, false));
}

/* ==================== ⑧ ほかの検討テーマ ==================== */

function renderLockedThemes(lockedOpportunities) {
  const el = document.getElementById("sec-locked");
  el.innerHTML = "";
  const items = lockedOpportunities || [];
  if (!items.length) return;

  const panel = document.createElement("div");
  panel.className = "locked-panel";
  panel.appendChild(textP("locked-panel__title", `ほか${items.length}件のOpportunity候補があります`));
  panel.appendChild(textP("locked-panel__lede", "詳細分析版で、根拠と最初の一歩まで確認できます。"));
  const cards = document.createElement("div");
  cards.className = "cards";
  items.forEach((opp) => {
    cards.appendChild(createOpportunityCard(opp, { variant: "locked" }));
  });
  panel.appendChild(cards);
  el.appendChild(panel);
}

/* ==================== ⑨ CTA（下部） ==================== */

function renderCtaBottom() {
  const el = document.getElementById("sec-cta");
  el.innerHTML = "";
  const a = document.createElement("a");
  a.className = "cta-v2__btn";
  a.href = "#";
  a.setAttribute("data-cta", "");
  a.textContent = ctaText();
  el.appendChild(a);

  const proof = document.createElement("div");
  proof.className = "cta-v2__proof";
  ["御社向けに整理した分析", "公開情報ベース", "運営が内容を確認済み"].forEach((t) => {
    const s = document.createElement("span");
    s.textContent = t;
    proof.appendChild(s);
  });
  el.appendChild(proof);
}

/* ==================== フッター ==================== */

function renderFooter(data) {
  const el = document.getElementById("report-footer");
  el.innerHTML = "";
  const rows = [
    "AI Opportunity Report 運営事務局",
    linkRow("情報が異なる場合はこちら", mailtoLink("レポート内容の訂正について")),
    linkRow("配信停止はこちら", mailtoLink("配信停止のご連絡", "配信停止を希望します。\n")),
  ];
  const gen = formatDate(data.meta && data.meta.generated_at);
  if (gen) rows.push(`このレポートの作成日: ${gen}`);

  rows.forEach((content) => {
    const p = document.createElement("p");
    p.className = "report-footer__row";
    if (typeof content === "string") p.textContent = content;
    else p.appendChild(content);
    el.appendChild(p);
  });
}

/* ==================== CTA 配線（destination は既存仕様を維持） ==================== */

function wireCtas(slug) {
  const params = new URLSearchParams();
  params.set("company", slug);
  const leadId = getLeadParam();
  const reportToken = getReportTokenParam();
  if (leadId) params.set("lead", leadId);
  if (reportToken) params.set("token", reportToken);
  const target = `email-capture.html?${params.toString()}`;

  document.querySelectorAll("[data-cta]").forEach((el) => {
    el.setAttribute("href", target);
    el.addEventListener("click", function () {
      trackEvent("cta_click", null, { placement: el.className || "cta" });
    });
  });
}

/* ==================== 小さなヘルパー ==================== */

function ctaText() {
  return "このOpportunityをさらに詳しく見る（市場規模・競合・リスク｜無料）";
}

function secHead(title, theme) {
  const h = document.createElement("div");
  h.className = "sec-head";
  const g = document.createElement("span");
  g.className = "sec-head__glyph";
  g.setAttribute("aria-hidden", "true");
  g.innerHTML = Illustrations.glyph(theme, { size: 20 });
  const t = document.createElement("h2");
  t.className = "sec-head__title";
  t.textContent = title;
  h.append(g, t);
  return h;
}

function oppBlock(label, text) {
  const s = document.createElement("section");
  s.className = "oppv2__block";
  s.appendChild(textP("oppv2__block-label", label));
  const p = document.createElement("p");
  p.textContent = text;
  s.appendChild(p);
  return s;
}

function reviewLineEl(review, compact) {
  const p = document.createElement("p");
  p.className = "review-line" + (review.approved ? "" : " review-line--pending");
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = review.approved ? "✓" : "⚠";
  const text = document.createElement("span");
  text.textContent = compact ? (review.approved ? "運営 確認済み" : "レビュー中") : review.line;
  p.append(icon, " ", text);
  return p;
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

function firstSentence(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  const m = t.match(/^[\s\S]*?。/);
  return (m ? m[0] : t).trim();
}

// stat label に、米ドル建ての世界市場であることが分かる補足を付ける（数字は変えない）
function labelWithScope(stat) {
  if (!stat) return "";
  const lbl = stat.label || "";
  if (/ドル/.test(stat.value || "") && /市場/.test(lbl) && !/世界|グローバル|国内/.test(lbl)) {
    return "世界の" + lbl;
  }
  return lbl;
}

/* ==================== 計測（STEP3: 外部送信しない・point の整理のみ） ==================== */

function trackEvent(name, data, extra) {
  // STEP3 では analytics backend を新設しない。将来の計測点を明示するためのフック。
  // 既存の識別情報があってもこの段階では外部送信しない。
  try {
    const detail = Object.assign({ event: name }, extra || {});
    if (data && data.company_profile) detail.slug = data.company_profile.domain || undefined;
    if (typeof window !== "undefined" && window.console && window.__AOR_DEBUG__) {
      window.console.debug("[AOR track]", detail);
    }
  } catch (e) {
    /* no-op */
  }
}
