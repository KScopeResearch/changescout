/*
 * AOR report-preview.html — Phase56 STEP1（Hero / First-View 全面リデザイン）
 *
 * Email → Preview → CTA の導線を LP 品質へ。ファーストビューで
 * 「御社に何の市場機会があるのか」「なぜ御社か」「無料・人間確認済み」を伝える。
 *
 * 描画順:
 *   Hero V3（宛名 / Opportunity 見出し / Why You / 数字バッジ / 確認済みバッジ / 大型イラスト）
 *   → Benefit カード3枚（なぜ今 / なぜ御社 / 今日できること）
 *   → 上部 CTA
 *   → Market Snapshot（数字カード / 比較バー / タイムライン）
 *   → Opportunity Card V3（Opportunity → なぜ今 → なぜ御社 → 見込まれるインパクト → 今日できること）
 *   → 根拠(折りたたみ) → 情報源(折りたたみ・最後) → 人による確認 → ほかのテーマ
 *   → Trust（登録不要 / 無料 / 人間確認済み / 停止可能） → 下部 CTA
 *
 * データは published JSON（common.js の fetchCompanyData）のみ。API 連携・LLM なし。
 * pure な view model 変換は preview-ui.js / market-stats.js、図は illustrations.js。
 *
 * Phase55 P0-1: business_summary は本ページでは一切表示しない。会社の実態は
 * 「なぜ御社か（why_company）」で示す。summary-guard.js は読み込み維持（将来のため）。
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
  const snapshot = PreviewUI.marketSnapshot(data);

  renderHero(data, vm, variant, theme, review, snapshot);
  renderBenefits(data, theme);
  renderCtaTop();
  renderSnapshot(snapshot, theme);
  renderOpportunity(data, vm, theme);
  renderEvidence(data, sourceMap);
  renderSourcesV2(data);
  renderReviewSection(review);
  renderLockedThemes(data.locked_opportunities);
  renderTrust(data);
  renderCtaBottom();
  renderFooter(data);
  wireCtas(slug);
}

/* ==================== Hero V3 ==================== */

function renderHero(data, vm, variant, theme, review, snapshot) {
  const el = document.getElementById("report-hero");
  el.innerHTML = "";
  el.setAttribute("aria-labelledby", "hero-headline");
  const cp = data.company_profile || {};

  // 確認済みバッジ（右上固定）
  const badge = document.createElement("p");
  badge.className = "hero-review-badge" + (review.approved ? "" : " hero-review-badge--pending");
  const bi = document.createElement("span");
  bi.setAttribute("aria-hidden", "true");
  bi.textContent = review.approved ? "✓" : "⚠";
  const bt = document.createElement("span");
  bt.textContent = review.approved ? "人間による確認済み" : "運営がレビュー中";
  badge.append(bi, " ", bt);
  el.appendChild(badge);

  const body = document.createElement("div");
  body.className = "hero-body";

  // Eyebrow
  const eyebrow = document.createElement("p");
  eyebrow.className = "report-hero__eyebrow";
  ["AI Opportunity Report", "無料レポート", review.approved ? "運営確認済み" : "レビュー中"].forEach((t, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "report-hero__eyebrow-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "·";
      eyebrow.appendChild(sep);
    }
    const s = document.createElement("span");
    s.textContent = t;
    eyebrow.appendChild(s);
  });
  body.appendChild(eyebrow);

  // 宛名
  body.appendChild(textP("report-hero__company", `${cp.name || ""} 様へ`));

  // メインキャッチ（ページ最大要素）
  const headline = document.createElement("h1");
  headline.className = "report-hero__headline";
  headline.id = "hero-headline";
  if (variant === "B" && snapshot.stats.length) {
    const s = snapshot.stats[0];
    headline.textContent = `${labelWithScope(s)}は ${s.value}。この市場変化に、御社が取れる一手があります。`;
  } else {
    headline.textContent = vm.headline || vm.title;
  }
  body.appendChild(headline);

  // サブコピー（Why You・1〜2文）
  const sub = PreviewUI.heroSubcopy(vm.whyCompany);
  if (sub) body.appendChild(textP("report-hero__sub", sub));

  // Opportunity Pill（3チップ）
  const pill = document.createElement("p");
  pill.className = "report-hero__pill";
  ["AI Opportunity", "Priority", "無料版"].forEach((t) => {
    const c = document.createElement("span");
    c.className = "report-hero__chip";
    c.textContent = t;
    pill.appendChild(c);
  });
  body.appendChild(pill);

  // Market Badge（数字1〜2件・無ければ非表示）
  if (snapshot.stats.length) {
    const badges = document.createElement("div");
    badges.className = "report-hero__badges";
    const bl = document.createElement("span");
    bl.className = "report-hero__badges-label";
    bl.textContent = "市場で起きていること";
    badges.appendChild(bl);
    snapshot.stats.slice(0, 2).forEach((s) => {
      const b = document.createElement("span");
      b.className = "market-badge";
      b.innerHTML =
        `<span class="market-badge__value">${escapeText(s.value)}</span>` +
        `<span class="market-badge__label">${escapeText(labelWithScope(s))}</span>`;
      badges.appendChild(b);
    });
    body.appendChild(badges);
  }

  // インライン CTA
  const cta = document.createElement("a");
  cta.className = "hero-cta-inline";
  cta.href = "#";
  cta.setAttribute("data-cta", "");
  cta.textContent = "▸ 無料で続きを見る";
  body.appendChild(cta);

  el.appendChild(body);

  // 大型イラスト
  const illust = document.createElement("div");
  illust.className = "hero-illust";
  illust.setAttribute("aria-hidden", "true");
  illust.innerHTML = Illustrations.hero(theme);
  el.appendChild(illust);
}

/* ==================== Benefit カード3枚 ==================== */

function renderBenefits(data, theme) {
  const el = document.getElementById("sec-benefits");
  el.innerHTML = "";
  const cards = PreviewUI.benefitCards(data);
  if (!cards.length) return;

  const grid = document.createElement("div");
  grid.className = "benefit-cards";
  const GLYPH = { why_now: "subsidy_policy", why_company: "new_business", first_action: "generic_insight" };
  cards.forEach((c) => {
    const card = document.createElement("article");
    card.className = "benefit-card";
    const icon = document.createElement("span");
    icon.className = "benefit-card__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = Illustrations.glyph(GLYPH[c.key] || theme, { size: 22 });
    card.appendChild(icon);
    card.appendChild(textP("benefit-card__label", c.label));
    card.appendChild(textP("benefit-card__text", c.text));
    grid.appendChild(card);
  });
  el.appendChild(grid);
}

/* ==================== 上部 CTA ==================== */

function renderCtaTop() {
  const el = document.getElementById("sec-cta-top");
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cta-v3 cta-v3--top";
  wrap.appendChild(ctaButton("無料で続きを見る"));
  wrap.appendChild(textP("cta-v3__sub", "市場規模・競合・リスク分析を確認できます。"));
  el.appendChild(wrap);
}

/* ==================== Market Snapshot ==================== */

function renderSnapshot(snapshot, theme) {
  const el = document.getElementById("sec-snapshot");
  el.innerHTML = "";
  if (!snapshot.stats.length && !snapshot.years.length) return;

  el.appendChild(secHead("市場で起きていること", theme));

  if (snapshot.stats.length) {
    const grid = document.createElement("div");
    grid.className = "market-stats";
    snapshot.stats.forEach((s) => {
      const card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML =
        `<div class="stat-card__value">${escapeText(s.value)}</div>` +
        `<div class="stat-card__label">${escapeText(labelWithScope(s))}</div>` +
        (s.sourceId ? `<div class="stat-card__src">出典: ${escapeText(s.sourceId)}</div>` : "");
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  // 比較バー（「約N倍」がある場合のみ）
  if (snapshot.multiple) {
    const m = String(snapshot.multiple.value).match(/(\d+(?:\.\d+)?)/);
    const factor = m ? parseFloat(m[1]) : 0;
    if (factor > 1 && factor <= 20) {
      const bar = document.createElement("div");
      bar.className = "market-bar";
      const pct = Math.max(8, Math.round((1 / factor) * 100));
      bar.innerHTML =
        `<div class="market-bar__caption">現在 → 目標: <strong>${escapeText(snapshot.multiple.value)}</strong></div>` +
        `<div class="market-bar__track"><div class="market-bar__now" style="width:${pct}%"></div></div>` +
        `<div class="market-bar__ends"><span>現在</span><span>目標</span></div>`;
      el.appendChild(bar);
    }
  }

  // タイムライン（年・CSS のみ）
  if (snapshot.years.length >= 2) {
    const tl = document.createElement("ol");
    tl.className = "market-timeline";
    tl.setAttribute("aria-label", "市場の節目となる年");
    snapshot.years.forEach((y) => {
      const li = document.createElement("li");
      li.className = "market-timeline__item";
      const dot = document.createElement("span");
      dot.className = "market-timeline__dot";
      dot.setAttribute("aria-hidden", "true");
      const yr = document.createElement("span");
      yr.className = "market-timeline__year";
      yr.textContent = y + "年";
      li.append(dot, yr);
      tl.appendChild(li);
    });
    el.appendChild(tl);
  }
}

/* ==================== Opportunity Card V3 ==================== */

function renderOpportunity(data, vm, theme) {
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

  if (vm.whyNow) card.appendChild(oppBlock("なぜ今、この機会か", vm.whyNow));
  if (vm.whyCompany) card.appendChild(oppBlock("なぜ御社に、この機会か", vm.whyCompany));
  if (vm.impact) card.appendChild(oppBlock("見込まれるインパクト", vm.impact));

  // 今日できること
  const fa = (data.free_opportunity || {}).first_action || "";
  const steps = PreviewUI.buildFirstActionViewModel(fa);
  if (steps.length) {
    const s = document.createElement("section");
    s.className = "oppv2__block oppv2__block--action";
    s.appendChild(textP("oppv2__block-label", "今日できること"));
    if (steps.length <= 1) {
      const p = document.createElement("p");
      p.className = "first-action__single";
      p.textContent = steps[0] || fa;
      s.appendChild(p);
    } else {
      const ol = document.createElement("ol");
      ol.className = "first-action__steps";
      steps.forEach((st) => {
        const li = document.createElement("li");
        li.className = "first-action__step";
        const p = document.createElement("p");
        p.textContent = st;
        li.appendChild(p);
        ol.appendChild(li);
      });
      s.appendChild(ol);
    }
    card.appendChild(s);
  }

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

/* ==================== 根拠（折りたたみ） ==================== */

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

/* ==================== 情報源（折りたたみ・最後・カテゴリ別） ==================== */

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
    `今回の分析で確認した情報源（${list.length}件${hidden > 0 ? " ＋ ほか " + hidden + " 件" : ""}）`;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "disclosure__body";
  body.appendChild(
    textP(
      "disclosure__lede",
      "この提案は、以下の公開情報を照合して組み立てています。数値はいずれも情報源に記載の表現です。"
    )
  );
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

/* ==================== 人による確認 ==================== */

function renderReviewSection(review) {
  const el = document.getElementById("sec-review");
  el.innerHTML = "";
  el.appendChild(reviewLineEl(review, false));
}

/* ==================== ほかの検討テーマ ==================== */

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

/* ==================== Trust / Micro Proof ==================== */

function renderTrust(data) {
  const el = document.getElementById("sec-trust");
  el.innerHTML = "";
  const items = PreviewUI.trustItems(data);
  const wrap = document.createElement("ul");
  wrap.className = "trust-strip";
  wrap.setAttribute("aria-label", "このレポートについて");
  items.forEach((it) => {
    const li = document.createElement("li");
    li.className = "trust-strip__item";
    const icon = document.createElement("span");
    icon.className = "trust-strip__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✓";
    const t = document.createElement("span");
    t.textContent = it.label;
    li.append(icon, " ", t);
    wrap.appendChild(li);
  });
  el.appendChild(wrap);
}

/* ==================== 下部 CTA ==================== */

function renderCtaBottom() {
  const el = document.getElementById("sec-cta");
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cta-v3 cta-v3--bottom";
  wrap.appendChild(ctaButton("御社専用の追加分析を見る（無料）"));
  wrap.appendChild(textP("cta-v3__sub", "市場規模・競合・リスク分析を確認できます。"));

  const proof = document.createElement("div");
  proof.className = "cta-v2__proof";
  ["御社向けに整理した分析", "公開情報ベース", "運営が内容を確認済み"].forEach((t) => {
    const s = document.createElement("span");
    s.textContent = t;
    proof.appendChild(s);
  });
  wrap.appendChild(proof);
  el.appendChild(wrap);
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

function ctaButton(label) {
  const a = document.createElement("a");
  a.className = "cta-v3__btn";
  a.href = "#";
  a.setAttribute("data-cta", "");
  const t = document.createElement("span");
  t.className = "cta-v3__btn-text";
  t.textContent = label;
  const arrow = document.createElement("span");
  arrow.className = "cta-v3__btn-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "→";
  a.append(t, arrow);
  return a;
}

// 3 箇所以上で参照される CTA 文言（テスト・一貫性のため関数として保持）
function ctaText() {
  return "御社専用の追加分析を見る（無料）";
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

/* ==================== 計測（将来の計測点の整理のみ・外部送信しない） ==================== */

function trackEvent(name, data, extra) {
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
