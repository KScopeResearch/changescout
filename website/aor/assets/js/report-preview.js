/*
 * AOR report-preview.html — Phase66 STEP6（Initial Report Visual Upgrade v2）
 *
 * 方針: Content SAME / Presentation NEW（継続）。表示するデータは既存の report.json
 * （published JSON）のフィールドのみ。新しい数値・事実は一切作らない。
 * 数字・事実はすべて既存フィールドから取り出す／言い換えるだけで、LLM も乱数も使わない。
 *
 * 描画順（Phase75 STEP1: IA Refresh — Dashboard を上へ、Executive Summary は
 *   Executive Brief［30秒で伝わる4カード。旧 FIRST STEP セクションはここに統合］へ置換）:
 *   Hero → Metrics(Dashboard) → Executive Brief → WHY NOW → WHY YOU → THE OPPORTUNITY
 *   → Why This Matters → EVIDENCE → SOURCE → MORE OPPORTUNITIES → CTA → Footer
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
  renderMetrics(data, vm, theme, snapshot);
  renderExecutiveSummary(data, vm, snapshot);
  renderWhyNow(vm, theme, snapshot);
  renderWhyYou(data, vm, theme);
  renderOpportunity(data, vm, theme, snapshot);
  renderWhyThisMatters(vm);
  renderEvidence(data, sourceMap);
  renderSourcesV2(data);
  renderLockedThemes(data.locked_opportunities);
  renderTrust(data);
  renderCtaBottom();
  renderFooter(data);
  renderPrintChrome(data);
  wireCtas(slug);
  wireJumpHighlight();
  initScrollReveal();
}

// Phase68 STEP2 STEP13: 印刷専用ヘッダー・フッター（全ページ共通）。
// position:fixed で用意し、画面表示では .print-only が隠す。ページ番号は
// ブラウザの印刷ダイアログが提供する「ヘッダーとフッター」設定に委ねる
// （CSS Paged Media の @page 余白ボックスは主要ブラウザが未実装のため）。
function renderPrintChrome(data) {
  document.querySelectorAll(".print-chrome").forEach((el) => el.remove());

  const cp = (data && data.company_profile) || {};
  const gen = formatDate(data.meta && data.meta.generated_at);

  const header = document.createElement("div");
  header.className = "print-only print-chrome print-header";
  header.innerHTML =
    `<span class="print-header__brand">AOR BUSINESS OPPORTUNITY REPORT</span>` +
    (cp.name ? `<span class="print-header__company">${escapeText(cp.name)}</span>` : "");
  document.body.appendChild(header);

  const footer = document.createElement("div");
  footer.className = "print-only print-chrome print-footer";
  footer.innerHTML =
    `<span>aor.changescout.jp</span>` +
    (gen ? `<span>分析日: ${escapeText(gen)}</span>` : "") +
    `<span>© ${new Date().getFullYear()} AOR</span>`;
  document.body.appendChild(footer);
}

// Phase68 STEP2 STEP1: 印刷時は折りたたみ（Evidence/Sources の <details>）を強制的に開く。
// ネイティブ要素の折りたたみは CSS だけでは確実に解除できないため、beforeprint で開き、
// afterprint で画面表示の状態へ戻す（ユーザーが操作していた open/closed は変えない）。
if (typeof window !== "undefined" && window.addEventListener) {
  let printReopened = [];
  window.addEventListener("beforeprint", () => {
    printReopened = Array.from(document.querySelectorAll("details.disclosure:not([open])"));
    printReopened.forEach((d) => {
      d.open = true;
    });
  });
  window.addEventListener("afterprint", () => {
    printReopened.forEach((d) => {
      d.open = false;
    });
    printReopened = [];
  });
}

// Phase67 STEP14: Intersection Observer による軽量アニメーション（Fade + 16px Up）。
// prefers-reduced-motion では即表示。IntersectionObserver 非対応環境でも即表示にフォールバック。
function initScrollReveal() {
  const ids = [
    "report-hero",
    "sec-metrics",
    "sec-exec-summary",
    "sec-why-now",
    "sec-why-you",
    "sec-opportunity",
    "sec-why-matters",
    "sec-evidence",
    "sec-sources",
    "sec-locked",
    "sec-cta",
  ];
  const targets = ids.map((id) => document.getElementById(id)).filter(Boolean);
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

/* ==================== Hero（STEP3: LP 品質へアップグレード） ==================== */

function renderHero(data, vm, variant, theme, review, snapshot) {
  const el = document.getElementById("report-hero");
  el.innerHTML = "";
  el.setAttribute("aria-labelledby", "hero-headline");
  const cp = data.company_profile || {};

  // Phase68 STEP2: Cover ヘッダー行（左: AOR ブランド / 右: FREE EDITION・CONFIDENTIAL・専門家監修）。
  // flex-wrap のヘッダーに収め、狭幅では自然に折り返す（固定px配置に頼らない）。
  const header = document.createElement("div");
  header.className = "hero-cover-header";

  const brand = document.createElement("p");
  brand.className = "report-hero__brand";
  const mark = document.createElement("span");
  mark.className = "report-hero__brand-mark";
  mark.textContent = "AOR";
  const doctype = document.createElement("span");
  doctype.className = "report-hero__doctype";
  doctype.textContent = "BUSINESS OPPORTUNITY REPORT";
  brand.append(mark, doctype);
  header.appendChild(brand);

  const badgeCluster = document.createElement("div");
  badgeCluster.className = "hero-cover-badges";

  const freeEdition = document.createElement("span");
  freeEdition.className = "hero-cover-badge hero-cover-badge--free";
  freeEdition.textContent = "FREE EDITION";
  badgeCluster.appendChild(freeEdition);

  const confidential = document.createElement("span");
  confidential.className = "hero-cover-badge hero-cover-badge--confidential";
  confidential.textContent = "CONFIDENTIAL";
  badgeCluster.appendChild(confidential);

  const badge = document.createElement("p");
  badge.className = "hero-review-badge" + (review.approved ? "" : " hero-review-badge--pending");
  const bi = document.createElement("span");
  bi.setAttribute("aria-hidden", "true");
  bi.innerHTML = Illustrations.glyph(review.approved ? "shield_check" : "search", { size: 14 });
  const bt = document.createElement("span");
  bt.textContent = review.approved ? "専門家監修" : "運営がレビュー中";
  badge.append(bi, " ", bt);
  badgeCluster.appendChild(badge);

  header.appendChild(badgeCluster);
  el.appendChild(header);

  // Phase75 STEP2/STEP3: Hero を左右2カラム（左=コピー・右=実画像、比率60/40）へ。
  // コピー（宛名・見出し・タイトル・サブタイトル・CTA）は一切変更しない。
  const heroGrid = document.createElement("div");
  heroGrid.className = "hero-grid";

  const body = document.createElement("div");
  body.className = "hero-body";

  // 宛名（会社名 + 経営者様）
  body.appendChild(textP("report-hero__company", PreviewUI.salutation(cp.name)));

  // Cover タグライン（固定コピー。会社固有の数値・事実は含まない）
  body.appendChild(textP("report-hero__cover-lede", "御社向けのビジネスチャンスがあります！"));

  // メインキャッチ（ページ最大要素・h1は1つだけ）: 巨大タイトルとして Opportunity（vm.title）を表示
  const headline = document.createElement("h1");
  headline.className = "report-hero__headline";
  headline.id = "hero-headline";
  headline.textContent = vm.title || PreviewUI.oneLineSummary(vm.title) || vm.headline || "";
  body.appendChild(headline);

  // Variant 行（A: 提案サマリ文 / B: 市場数値を主語にした文）。Hero Variant ロジックは維持。
  const nonWorld = snapshot.stats.filter((s) => !s.isWorld);
  const variantLine = document.createElement("p");
  variantLine.className = "report-hero__variant-line";
  if (variant === "B" && nonWorld.length) {
    const s = nonWorld[0];
    variantLine.textContent = `${labelWithScope(s)}が ${s.value}。御社に取れる一手があります。`;
  } else {
    variantLine.textContent = PreviewUI.oneLineSummary(vm.title) || vm.headline || vm.title;
  }
  if (variantLine.textContent) body.appendChild(variantLine);

  // リード文（Why You・1〜2文。会社固有の根拠）
  const sub = PreviewUI.heroSubcopy(vm.whyCompany);
  if (sub) body.appendChild(textP("report-hero__sub", sub));

  // Pill（無料 / 御社専用分析。Cover 内では控えめなキャプションとして表示）
  const pill = document.createElement("p");
  pill.className = "report-hero__pill";
  ["無料", "御社専用分析"].forEach((t) => {
    const c = document.createElement("span");
    c.className = "report-hero__chip";
    c.textContent = t;
    pill.appendChild(c);
  });
  body.appendChild(pill);

  // Market Badge（経営者に近い数字1〜2件・無ければ非表示）
  const heroStats = snapshot.stats.filter((s) => !s.isWorld);
  const shown = heroStats.length ? heroStats : snapshot.stats;
  if (shown.length) {
    const badges = document.createElement("div");
    badges.className = "report-hero__badges";
    const bl = document.createElement("span");
    bl.className = "report-hero__badges-label";
    bl.textContent = snapshot.worldOnly ? "参考データ" : "新しい市場の動き";
    badges.appendChild(bl);
    shown.slice(0, 2).forEach((s) => {
      const b = document.createElement("span");
      b.className = "market-badge";
      b.innerHTML =
        `<span class="market-badge__value">${escapeText(s.value)}</span>` +
        `<span class="market-badge__label">${escapeText(labelWithScope(s))}</span>`;
      badges.appendChild(b);
    });
    body.appendChild(badges);
  }

  // Cover Meta 行（作成日 / 分析対象 / 分析ソース数 / 確信度。すべて既存フィールドから）
  const metaItems = heroCoverMeta(data, vm, cp);
  if (metaItems.length) {
    const meta = document.createElement("dl");
    meta.className = "hero-cover-meta";
    metaItems.forEach((m) => {
      const dt = document.createElement("dt");
      dt.textContent = m.label;
      const dd = document.createElement("dd");
      dd.textContent = m.value;
      meta.append(dt, dd);
    });
    body.appendChild(meta);
  }

  // Phase72 STEP2: Executive Cover（C案）Trust 4項目（CTA の直前）。#sec-trust と同じ
  // .trust-strip クラス（preview-conversion.css）を再利用し、新規 CSS は追加しない。
  const heroTrust = document.createElement("ul");
  heroTrust.className = "trust-strip";
  heroTrust.setAttribute("aria-label", "このレポートについて");
  PreviewUI.trustItems(data).forEach((it) => {
    const li = document.createElement("li");
    li.className = "trust-strip__item";
    const icon = document.createElement("span");
    icon.className = "trust-strip__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = Illustrations.glyph("check_circle", { size: 14 });
    const t = document.createElement("span");
    t.textContent = it.label;
    li.append(icon, " ", t);
    heroTrust.appendChild(li);
  });
  body.appendChild(heroTrust);

  // 大型 CTA ボタン（高さ52px以上。Hero 独自に data-cta を付与し、既存の CTA 計測契約を維持）
  const cta = document.createElement("a");
  cta.className = "hero-cta-inline cta-v3__btn cta-v3__btn--hero";
  cta.href = "#";
  cta.setAttribute("data-cta", "");
  const ctaText = document.createElement("span");
  ctaText.className = "cta-v3__btn-text";
  ctaText.textContent = "無料でレポートを見る";
  const ctaArrow = document.createElement("span");
  ctaArrow.className = "cta-v3__btn-arrow";
  ctaArrow.setAttribute("aria-hidden", "true");
  ctaArrow.innerHTML = Illustrations.glyph("cta_arrow", { size: 16 });
  cta.append(ctaText, ctaArrow);
  body.appendChild(cta);

  heroGrid.appendChild(body);

  // Phase75 STEP2: 図形/SVG Hero を実画像（illustrations.js の SVG を Playwright で
  // PNG化したもの）へ置換。右カラム（40%）に配置。
  const heroImg = document.createElement("img");
  heroImg.className = "hero-illust-img";
  heroImg.src = "assets/images/hero-business-dashboard-v1.png";
  heroImg.width = 1200;
  heroImg.height = 720;
  heroImg.alt = "Business Intelligence Dashboard";
  heroGrid.appendChild(heroImg);

  el.appendChild(heroGrid);
}

// Report Cover 下部メタ行: 作成日 / 分析対象 / 分析ソース数 / 確信度。
// 既存フィールド（meta.generated_at / company_profile / source_pages・top_sources /
// confidence_note 由来の level）のみを使い、値が無い項目は出さない。
function heroCoverMeta(data, vm, cp) {
  const out = [];
  const gen = formatDate(data.meta && data.meta.generated_at);
  if (gen) out.push({ label: "作成日", value: gen });
  const target = cp.name || cp.domain;
  if (target) out.push({ label: "分析対象", value: target });
  const count = sourceCount(data);
  if (count) out.push({ label: "分析ソース数", value: count + "件" });
  if (vm.confidence && vm.confidence.level) out.push({ label: "確信度", value: vm.confidence.level });
  return out;
}

// top_sources 優先・無ければ source_pages（renderSourcesV2 と同じ優先順位）の件数。
function sourceCount(data) {
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;
  return list.length + hidden;
}

/* ==================== Executive Summary（Phase68 STEP3: 2カラム Premium 化） ==================== */
// 左: 今回の結論 / Why Now要約 / Why You要約。右: Executive Snapshot 5項目（SVGアイコン付き）。
// いずれも既存フィールドの先頭抜粋・言い換えのみで、新しい文章・数値は作らない。
// Phase75 STEP2: Executive Brief（旧 Executive Summary を置換。30秒で価値が伝わる
// 4カードのみに絞る。WHY NOW/WHY YOU はここでは120字程度の抜粋のみとし、全文は
// 下部の該当セクション（sec-why-now / sec-why-you）へ「続きを読む」でジャンプする
// ページ内アンカーとする。新しい文章は一切生成せず、既存フィールドの切り出しのみ）。
function renderExecutiveSummary(data, vm, snapshot) {
  const el = document.getElementById("sec-exec-summary");
  el.innerHTML = "";
  if (!vm.title && !vm.whyNow && !vm.whyCompany) return;

  el.appendChild(secHead("Executive Brief", "intelligence_dashboard"));

  const cards = document.createElement("div");
  cards.className = "exec-brief-cards";

  if (vm.title) {
    const body = PreviewUI.summarizeSentence(vm.impact || vm.marketChange || vm.whyNow, 90);
    cards.appendChild(
      execBriefCard({
        glyph: "target",
        label: "今回見つかったビジネスチャンス",
        title: vm.title,
        body,
        jumpHref: "#sec-opportunity",
      })
    );
  }

  if (vm.whyNow) {
    cards.appendChild(
      execBriefCard({
        glyph: "line_chart",
        label: "なぜ今なのか",
        body: PreviewUI.summarizeSentence(vm.whyNow, 120),
        jumpHref: "#sec-why-now",
      })
    );
  }

  if (vm.whyCompany) {
    cards.appendChild(
      execBriefCard({
        glyph: "building",
        label: "なぜ御社なのか",
        body: PreviewUI.summarizeSentence(vm.whyCompany, 120),
        jumpHref: "#sec-why-you",
      })
    );
  }

  const fa = (data.free_opportunity || {}).first_action || "";
  if (fa) {
    cards.appendChild(execBriefCard({ glyph: "rocket", label: "今日やること", body: fa, isToday: true }));
  }

  if (!cards.children.length) return;
  el.appendChild(cards);
}

/**
 * @param {{glyph:string, label:string, title?:string, body?:string, jumpHref?:string, isToday?:boolean}} args
 */
function execBriefCard({ glyph, label, title, body, jumpHref, isToday }) {
  const c = document.createElement("div");
  c.className = "exec-brief-card" + (isToday ? " exec-brief-card--today" : "");

  const head = document.createElement("div");
  head.className = "exec-brief-card__head";
  const icon = document.createElement("span");
  icon.className = "exec-brief-card__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = Illustrations.glyph(glyph, { size: 18 });
  head.appendChild(icon);
  if (isToday) {
    const badge = document.createElement("span");
    badge.className = "exec-brief-card__badge";
    badge.textContent = "TODAY";
    head.appendChild(badge);
  }
  c.appendChild(head);

  c.appendChild(textP("exec-brief-card__label", label));
  if (title) c.appendChild(textP("exec-brief-card__title", title));
  if (body) c.appendChild(textP("exec-brief-card__body", body));
  if (jumpHref) {
    const a = document.createElement("a");
    a.className = "exec-brief-card__more";
    a.href = jumpHref;
    a.textContent = "続きを読む";
    c.appendChild(a);
  }
  return c;
}

/* ==================== Metrics（STEP4: 経営ダッシュボード化） ==================== */

function renderMetrics(data, vm, theme, snapshot) {
  const el = document.getElementById("sec-metrics");
  el.innerHTML = "";

  const marketCard = buildMarketMetricCard(vm, snapshot);
  const fitCard = buildFitMetricCard(data, vm);
  if (!marketCard && !fitCard && !snapshot.stats.length && !snapshot.years.length) return;

  el.appendChild(secHead("Market Intelligence Dashboard", theme));

  // Phase75 STEP5: Executive Snapshot（確信度 / 公開情報ソース数 / 市場シグナル件数 /
  // 更新日 / レポート種別）を、廃止した旧 Executive Summary からこちらへ移設。
  // 数値の新規生成は行わず、既存フィールドの件数・日付のみ表示する（内容は変更なし）。
  const gen = formatDate(data.meta && data.meta.generated_at);
  const snapItems = [
    ["Confidence", "target", vm.confidence && vm.confidence.level],
    ["Sources", "evidence_stack", sourceCount(data) ? sourceCount(data) + "件" : ""],
    ["Market Signals", "line_chart", snapshot.stats.length ? snapshot.stats.length + "件" : ""],
    ["Updated", "calendar", gen],
    ["Report Type", "shield_check", "Initial Report（無料版）"],
  ].filter(([, , v]) => v);
  if (snapItems.length) {
    const snap = document.createElement("div");
    snap.className = "exec-snapshot exec-snapshot--dashboard";
    snap.appendChild(textP("exec-snapshot__title", "Executive Snapshot"));
    const list = document.createElement("dl");
    list.className = "exec-snapshot__list";
    snapItems.forEach(([label, glyph, value]) => {
      const row = document.createElement("div");
      row.className = "exec-snapshot__row";
      const icon = document.createElement("span");
      icon.className = "exec-snapshot__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = Illustrations.glyph(glyph, { size: 16 });
      row.appendChild(icon);
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      row.append(dt, dd);
      list.appendChild(row);
    });
    snap.appendChild(list);
    el.appendChild(snap);
  }

  // Phase67 STEP3: 上段 KPI 4カード（市場の追い風 / 補助金・制度 / 節目の年 / 確信度）。
  // いずれも既存フィールドから確認できた項目のみ表示（捏造しない）。
  const kpis = buildKpiCards(vm, snapshot);
  if (kpis.length) {
    const kpiRow = document.createElement("div");
    kpiRow.className = "kpi-row";
    kpis.forEach((k) => {
      const c = document.createElement("div");
      c.className = "kpi-card";
      const icon = document.createElement("span");
      icon.className = "kpi-card__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = Illustrations.glyph(k.glyph, { size: 18 });
      c.appendChild(icon);
      c.appendChild(textP("kpi-card__label", k.label));
      c.appendChild(textP("kpi-card__value", k.value));
      if (k.note) c.appendChild(textP("kpi-card__note", k.note));
      kpiRow.appendChild(c);
    });
    el.appendChild(kpiRow);
  }

  const sourceMixCard = buildSourceMixCard(data);

  if (marketCard || fitCard || sourceMixCard) {
    const grid = document.createElement("div");
    grid.className = "metrics-2up" + (sourceMixCard ? " metrics-2up--3" : "");
    if (marketCard) grid.appendChild(marketCard);
    if (sourceMixCard) grid.appendChild(sourceMixCard);
    if (fitCard) grid.appendChild(fitCard);
    el.appendChild(grid);
  }

  // 3指標インジケーター（市場変化 / 補助金 / 節目の年。実データに基づく場合のみ表示）
  const indicators = momentumIndicators(vm, snapshot, theme);
  if (indicators.length) {
    const row = document.createElement("div");
    row.className = "momentum-row";
    indicators.forEach((ind) => {
      const item = document.createElement("div");
      item.className = "momentum-item";
      const icon = document.createElement("span");
      icon.className = "momentum-item__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = Illustrations.glyph(ind.glyph, { size: 18 });
      const label = document.createElement("span");
      label.className = "momentum-item__label";
      label.textContent = ind.label;
      item.append(icon, label);
      row.appendChild(item);
    });
    el.appendChild(row);
  }

  // Phase76 STEP1: 旧・重複していた本文引用ブロック（市場/御社/今動く理由の3枚カードと
  // 冒頭抜粋の引用）は Executive Brief / WHY NOW / WHY YOU と内容が重複していたため削除した
  // （Dashboard は数値・メタ情報中心に。Executive Snapshot・KPIカードは維持）。

  if (snapshot.worldOnly) {
    el.appendChild(
      textP("market-stats__note", "※ 御社の地域・業界に絞った数字は確認できませんでした。以下は参考データ（広域市場）です。")
    );
  }

  if (snapshot.stats.length) {
    const grid = document.createElement("div");
    grid.className = "market-stats";
    snapshot.stats.forEach((s) => {
      const card = document.createElement("div");
      card.className = "stat-card" + (s.isWorld ? " stat-card--world" : "");
      card.innerHTML =
        (s.isWorld && !snapshot.worldOnly ? `<div class="stat-card__scope">参考データ</div>` : "") +
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

// 「市場の追い風」カード: snapshot の先頭の数字（既に経営者に近い順へ並び替え済み）+
// why_now からの短い抜粋（数字が何の話かを1行で補う。新しい数値は作らない）。
function buildMarketMetricCard(vm, snapshot) {
  const nonWorld = snapshot.stats.filter((s) => !s.isWorld);
  const top = nonWorld.length ? nonWorld[0] : snapshot.stats[0];
  if (!top) return null;
  const insight = PreviewUI.summarizeSentence(vm.whyNow, 46);
  const card = document.createElement("div");
  card.className = "metric-card";
  card.innerHTML =
    `<div class="metric-card__label">市場の追い風</div>` +
    `<div class="metric-card__value-row">` +
    `<span class="metric-card__trend-icon" aria-hidden="true">${windTrendIcon()}</span>` +
    `<span class="metric-card__value">${escapeText(top.value)}</span>` +
    `</div>` +
    `<div class="metric-card__note">${escapeText(labelWithScope(top))}</div>` +
    `<span class="metric-card__trend-bar" aria-hidden="true">${marketTrendBar()}</span>` +
    (insight ? `<div class="metric-card__insight">${escapeText(insight)}</div>` : "");
  return card;
}

// 「市場の追い風」カード用の小さな装飾アイコン（円 + 上向き矢印）。数値は一切含まない
// （円グラフ風に見えるが、確信度リングと違い割合を表現するものではない）。
function windTrendIcon() {
  return (
    '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">' +
    '<circle cx="18" cy="18" r="15" stroke="currentColor" stroke-opacity="0.25" stroke-width="3"/>' +
    '<path d="M11 21l7-9 7 9" stroke="#059669" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>"
  );
}

// 「市場の追い風」カード用の小さなトレンドバー（装飾のみ・値は含まない）。
function marketTrendBar() {
  return (
    '<svg width="64" height="16" viewBox="0 0 64 16" fill="none" aria-hidden="true">' +
    '<path d="M2 13 L16 9 L28 11 L42 5 L62 3" stroke="#059669" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>"
  );
}

// 「御社との適合度」カード用の小さなネットワークダイアグラム（会社×市場の2ノード）。
function fitNetworkIcon() {
  return (
    '<svg width="30" height="20" viewBox="0 0 30 20" fill="none" aria-hidden="true">' +
    '<line x1="6" y1="14" x2="22" y2="6" stroke="currentColor" stroke-opacity="0.35"/>' +
    '<circle cx="6" cy="14" r="4" fill="#c9a24b" stroke="none"/>' +
    '<circle cx="22" cy="6" r="4" fill="currentColor" fill-opacity="0.4" stroke="none"/>' +
    "</svg>"
  );
}

// Phase73 STEP3 Card3「公開情報分析」: 出典を Government / Company / Research / News の
// 4カテゴリで件数集計するだけの表示（円グラフは使わない。捏造なし・存在件数のみ）。
function buildSourceMixCard(data) {
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  if (!list.length) return null;
  const counts = { gov: 0, company: 0, research: 0, news: 0 };
  list.forEach((sp) => {
    const key = BADGE_COLOR_KEY[sp.source_type];
    if (key === "gov") counts.gov++;
    else if (key === "company") counts.company++;
    else if (key === "research" || key === "industry") counts.research++;
    else if (key === "news") counts.news++;
  });
  const rows = [
    ["Government", "gov", counts.gov],
    ["Company", "company", counts.company],
    ["Research", "research", counts.research],
    ["News", "news", counts.news],
  ].filter(([, , n]) => n > 0);
  if (!rows.length) return null;

  const card = document.createElement("div");
  card.className = "metric-card metric-card--source-mix";
  card.innerHTML =
    `<div class="metric-card__label">公開情報分析</div>` +
    `<ul class="source-mix-list">` +
    rows
      .map(
        ([label, key, n]) =>
          `<li class="source-mix-list__item badge-cat--${key}"><span class="source-mix-list__label">${escapeText(label)}</span><span class="source-mix-list__count">${n}件</span></li>`
      )
      .join("") +
    `</ul>`;
  return card;
}

// 「御社との適合度」カード: 御社の業種（industry_label）× 今回のテーマ（title の中核部分）。
// 併せて確信度（confidence_note から抽出済み）と why_company の一文も表示する。
// いずれも既存フィールドの言い換えのみで、新しいスコアや数値は作らない。
function buildFitMetricCard(data, vm) {
  const cp = (data && data.company_profile) || {};
  const industry = cp.industry_label || "";
  const core = coreTerm(vm.title);
  if (!industry && !core && !(vm.confidence && vm.confidence.level)) return null;

  const note = PreviewUI.summarizeSentence(vm.whyCompany, 60);
  const card = document.createElement("div");
  card.className = "metric-card metric-card--fit";
  const valueHtml =
    industry && core
      ? `${escapeText(industry)} <span class="metric-card__x" aria-hidden="true">×</span> ${escapeText(core)}`
      : escapeText(industry || core);
  const ring = vm.confidence && vm.confidence.level ? confidenceRing(vm.confidence.level) : "";
  const checkGlyph = Illustrations.glyph("check_circle", { size: 14 });
  card.innerHTML =
    `<div class="metric-card__label">御社との適合度<span class="metric-card__fit-tag">事業適合分析</span>` +
    `<span class="metric-card__network-icon" aria-hidden="true">${fitNetworkIcon()}</span></div>` +
    (ring
      ? `<div class="metric-card__ring-row">` +
        `<div class="metric-card__ring" aria-hidden="true">${ring}</div>` +
        `<div class="metric-card__ring-body">` +
        (valueHtml ? `<div class="metric-card__value metric-card__value--pair">${valueHtml}</div>` : "") +
        `<div class="metric-card__confidence">確信度 ${escapeText(vm.confidence.level)}</div>` +
        `</div></div>`
      : (valueHtml ? `<div class="metric-card__value metric-card__value--pair">${valueHtml}</div>` : "")) +
    `<div class="metric-card__note"><span class="metric-card__check" aria-hidden="true">${checkGlyph}</span>今回の提案は御社の既存事業と接続できます。</div>` +
    (note ? `<div class="metric-card__insight">${escapeText(note)}</div>` : "");
  return card;
}

// 確信度（高/中/低）をリングチャートの円弧割合へ機械的に変換するだけの表示補助（★変換と同じ位置づけ）。
// 高=88割 中=62割 低=35割 の固定割当て。新しい判定・数値は作らない。
// Phase73 STEP3（重要修正）: 確信度（高/中/低）をリングの塗り量へ機械的に変換するだけの
// 表示補助。以前はここに具体的なパーセント数値を文字表示していたが、これは実際には
// 存在しない数値の捏造にあたるため廃止し、HIGH/MEDIUM/LOW の定型ラベルのみを表示する
// （塗り量の違いは視覚的な強弱の表現であり、割合の主張ではない）。
function confidenceRing(level) {
  const fillRatio = level === "高" ? 0.88 : level === "低" ? 0.35 : 0.62;
  const label = level === "高" ? "HIGH" : level === "低" ? "LOW" : "MEDIUM";
  const r = 15;
  const c = 2 * Math.PI * r;
  const dash = c * fillRatio;
  return (
    `<svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">` +
    `<circle cx="18" cy="18" r="${r}" fill="none" stroke="var(--color-primary-border)" stroke-width="4"/>` +
    `<circle cx="18" cy="18" r="${r}" fill="none" stroke="currentColor" stroke-width="4" ` +
    `stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" ` +
    `transform="rotate(-90 18 18)"/>` +
    `<text x="18" y="21" text-anchor="middle" font-size="6.5" font-weight="800" fill="currentColor" stroke="none">${label}</text>` +
    `</svg>`
  );
}

// Opportunity title から「の立ち上げ」等の定型語尾を取り除いた中核フレーズを返す
// （preview-ui.js の oneLineSummary と同じ語尾パターンを流用。新しい語は作らない）。
function coreTerm(title) {
  const t = String(title || "").trim().replace(/（src-\d+[^）]*）/g, "");
  if (!t) return "";
  const m = t.match(/^(.*?)(の立ち上げ|の提供|の展開|の構築|の開発|の商品化|の体系化と展開|の導入|の強化|の拡大)$/);
  return (m ? m[1] : t.replace(/。$/, "")).trim();
}

// 3指標インジケーター（市場変化 / 補助金 / 節目の年）。
// いずれも既存データから存在が確認できた場合のみ表示し、無い指標は捏造しない。
function momentumIndicators(vm, snapshot) {
  const out = [];
  if (vm.marketChange) {
    out.push({ glyph: "new_business", label: "市場変化" });
  }
  if (/補助金|助成金/.test(String(vm.whyNow || "") + String(vm.marketChange || ""))) {
    out.push({ glyph: "subsidy_policy", label: "補助金" });
  }
  if (snapshot.years && snapshot.years.length) {
    out.push({ glyph: "milestone", label: `${snapshot.years[0]}年が節目` });
  }
  return out.slice(0, 3);
}

// Phase67 STEP3: 上段 KPI 4カード（市場の追い風 / 補助金・制度 / 節目の年 / 確信度）。
// snapshot / vm の既存フィールドのみを使い、確認できない項目は出さない（捏造しない）。
function buildKpiCards(vm, snapshot) {
  const out = [];
  const nonWorld = snapshot.stats.filter((s) => !s.isWorld);
  const top = nonWorld.length ? nonWorld[0] : snapshot.stats[0];
  if (top) out.push({ glyph: "line_chart", label: "市場の追い風", value: top.value, note: labelWithScope(top) });

  if (/補助金|助成金/.test(String(vm.whyNow || "") + String(vm.marketChange || ""))) {
    out.push({ glyph: "subsidy_policy", label: "補助金・制度", value: "あり", note: "" });
  }

  if (snapshot.years && snapshot.years.length) {
    out.push({ glyph: "milestone", label: "節目の年", value: snapshot.years[0] + "年", note: "" });
  }

  if (vm.confidence && vm.confidence.level) {
    out.push({ glyph: "target", label: "確信度", value: vm.confidence.level, note: "" });
  }
  return out;
}

// 「今回わかったこと」3枚: 市場（market_change）/ 御社（why_company）/ 今動く理由（why_now）。
// いずれも既存フィールドの要約のみ（summarizeSentence）。データが無い項目は出さない。
/* ==================== WHY NOW（STEP5: Feature Card 化） ==================== */

function renderWhyNow(vm, theme, snapshot) {
  const el = document.getElementById("sec-why-now");
  el.innerHTML = "";
  if (!vm.whyNow) return;
  el.appendChild(secHead("なぜ今なのか", theme));

  const card = document.createElement("div");
  card.className = "reason-card reason-card--feature";

  // Phase73 STEP5: 左側の狭いカラムを market_signal_radar（コンパクト版）へ差し替え
  // （雑誌レイアウトの大きなインフォグラフィック）。
  const iconCol = document.createElement("div");
  iconCol.className = "reason-card__icon-col";
  const icon = document.createElement("span");
  icon.className = "reason-card__icon reason-card__icon--radar";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = Illustrations.market_signal_radar_compact();
  iconCol.appendChild(icon);
  iconCol.appendChild(textP("reason-card__category", "MARKET CHANGE"));
  card.appendChild(iconCol);

  // Phase76 STEP1: 冒頭一文は Executive Brief Card2 で既に要約表示済みのため、
  // WHY NOW セクションで再び太字ハイライト表示して重複させない（新しい文章は作らない。
  // 既存の数字強調のみ、表示する残りの文章に引き続き適用する）。
  const first = (String(vm.whyNow).match(/^[\s\S]*?。/) || [vm.whyNow])[0];
  const rest = String(vm.whyNow).slice(first.length).trim();
  const bodyText = rest || first;

  const p = document.createElement("p");
  p.className = "reason-card__text";
  p.innerHTML = escapeText(bodyText).replace(
    /([0-9０-９][0-9０-９.,]*(?:%|％|倍|件|年|兆|億|万)?)/g,
    "<strong>$1</strong>"
  );
  card.appendChild(p);

  el.appendChild(card);

  // Phase73 STEP4: Insight Timeline（市場変化 / 補助金 / タイミング。存在する項目のみ）。
  // momentumIndicators() と同じ既存フィールド判定を再利用し、新しい文章は作らない。
  const timelineItems = momentumIndicators(vm, snapshot || { years: [] });
  if (timelineItems.length) {
    const timeline = document.createElement("div");
    timeline.className = "why-now-timeline";
    timelineItems.forEach((it) => {
      const item = document.createElement("div");
      item.className = "why-now-timeline__item";
      const icon = document.createElement("span");
      icon.className = "why-now-timeline__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = Illustrations.glyph(it.glyph, { size: 18 });
      item.appendChild(icon);
      item.appendChild(textP("why-now-timeline__label", it.label));
      timeline.appendChild(item);
    });
    el.appendChild(timeline);
  }
}

/* ==================== WHY YOU（Phase68 STEP5: Company Intelligence） ==================== */

// Company Snapshot（左: 会社名/業種/分析対象/公開情報確認済み・右: 今回見つかった接点）
// → Strength Analysis（本文冒頭・引用カード）→ Opportunity Fit（残り全文・背景付き）。
// いずれも既存フィールド（company_profile / why_company）のみ。新しい事実は作らない。
function renderWhyYou(data, vm, theme) {
  const el = document.getElementById("sec-why-you");
  el.innerHTML = "";
  if (!vm.whyCompany) return;
  el.appendChild(secHead("なぜ御社なのか", theme));
  el.appendChild(sectionSceneEl("opportunity_network"));

  const cp = (data && data.company_profile) || {};
  const wc = String(vm.whyCompany);
  const firstSentence = (wc.match(/^[\s\S]*?。/) || [wc])[0];
  const restSentences = wc.slice(firstSentence.length).trim();

  // Company Snapshot（左: プロフィール行 / 右: 今回見つかった接点）
  const rows = [
    ["会社名", cp.name || ""],
    ["業種", cp.industry_label || ""],
    ["分析対象", cp.domain || cp.name || ""],
  ].filter(([, v]) => v);
  const connectionExcerpt = PreviewUI.summarizeSentence(restSentences || firstSentence, 80);
  if (rows.length || connectionExcerpt) {
    const intro = document.createElement("div");
    intro.className = "company-snapshot";
    const snapTitle = document.createElement("p");
    snapTitle.className = "company-snapshot__title";
    const snapIcon = document.createElement("span");
    snapIcon.setAttribute("aria-hidden", "true");
    snapIcon.innerHTML = Illustrations.glyph("company_profile", { size: 15 });
    const snapText = document.createElement("span");
    snapText.textContent = "Company Snapshot";
    snapTitle.append(snapIcon, " ", snapText);
    intro.appendChild(snapTitle);

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
    const verified = document.createElement("p");
    verified.className = "company-snapshot__verified";
    const vIcon = document.createElement("span");
    vIcon.setAttribute("aria-hidden", "true");
    vIcon.innerHTML = Illustrations.glyph("check_circle", { size: 14 });
    const vText = document.createElement("span");
    vText.textContent = "公開情報確認済み";
    verified.append(vIcon, " ", vText);
    left.appendChild(verified);
    grid.appendChild(left);

    if (connectionExcerpt) {
      const right = document.createElement("div");
      right.className = "company-snapshot__connection";
      right.appendChild(textP("company-snapshot__connection-label", "今回見つかった接点"));
      right.appendChild(textP("company-snapshot__connection-text", connectionExcerpt));
      grid.appendChild(right);
    }
    intro.appendChild(grid);
    el.appendChild(intro);
  }

  // Strength Analysis（強み・本文冒頭一文の引用カード）
  // Phase76 STEP1: Executive Brief Card3 と重複しないよう、冒頭説明を短い引用に絞る
  // （新しい文章は作らず、既存の summarizeSentence で要約するのみ）。
  if (firstSentence) {
    const strength = document.createElement("div");
    strength.className = "strength-card";
    strength.appendChild(textP("strength-card__label", "Strength Analysis"));
    const q = document.createElement("blockquote");
    q.className = "strength-card__text";
    q.textContent = PreviewUI.summarizeSentence(firstSentence, 60);
    strength.appendChild(q);
    el.appendChild(strength);
  }

  // Opportunity Fit（残り全文・背景付き）
  if (restSentences) {
    const fit = document.createElement("div");
    fit.className = "opportunity-fit-card";
    fit.appendChild(textP("opportunity-fit-card__label", "Opportunity Fit"));
    fit.appendChild(textP("opportunity-fit-card__text", restSentences));
    el.appendChild(fit);
  }
}

/* ==================== THE OPPORTUNITY（STEP6: 強化） ==================== */

function renderOpportunity(data, vm, theme, snapshot) {
  const el = document.getElementById("sec-opportunity");
  el.innerHTML = "";
  el.appendChild(secHead("今回見つけたビジネスチャンス", theme));
  el.appendChild(sectionSceneEl("ai_growth_dashboard"));

  const canvas = document.createElement("div");
  canvas.className = "opportunity-canvas";
  const canvasKicker = document.createElement("p");
  canvasKicker.className = "opportunity-canvas__kicker";
  canvasKicker.textContent = "Opportunity Canvas";
  canvas.appendChild(canvasKicker);

  const card = document.createElement("article");
  card.className = "oppv2 opportunity-canvas__layer opportunity-canvas__layer--1";

  const head = document.createElement("div");
  head.className = "oppv2__head";
  const eyebrow = document.createElement("span");
  eyebrow.className = "oppv2__eyebrow";
  eyebrow.textContent = "THE OPPORTUNITY";
  head.appendChild(eyebrow);
  if (vm.confidence && vm.confidence.level) {
    const stars = document.createElement("span");
    stars.className = "oppv2__stars";
    stars.setAttribute("aria-label", `確信度 ${vm.confidence.level}`);
    stars.textContent = confidenceStars(vm.confidence.level);
    head.appendChild(stars);
  }
  card.appendChild(head);

  const title = document.createElement("h3");
  title.className = "oppv2__title";
  title.textContent = vm.title;
  card.appendChild(title);

  // 一言でいうと（20〜44字）
  const summary = PreviewUI.oneLineSummary(vm.title);
  if (summary) {
    const s = document.createElement("section");
    s.className = "oppv2__block oppv2__block--summary";
    s.appendChild(textP("oppv2__block-label", "一言でいうと"));
    s.appendChild(textP("oppv2__summary-text", summary));
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

  canvas.appendChild(card);

  // Layer2: Business Impact（導入しやすさ / 市場性 / 顧客ニーズ。既存データのみ）
  const triad = opportunityTriad(data, vm, snapshot);
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

  // Layer3: Expected Outcome（期待できること全文。既存 extended_analysis.priority のみ）
  if (vm.impact) {
    const layer3 = document.createElement("section");
    layer3.className = "canvas-layer canvas-layer--outcome opportunity-canvas__layer opportunity-canvas__layer--3";
    layer3.appendChild(textP("canvas-layer__kicker", "Layer 3 — Expected Outcome"));
    layer3.appendChild(textP("canvas-layer__text", vm.impact));
    canvas.appendChild(layer3);
  }

  // Phase73 STEP1: Executive Takeaway（Goldカード）。データは Initial Report が既に持つ
  // free_opportunity.extended_analysis.priority（vm.impact）のみを要約表示する。
  // paid_analysis.decision_summary は有料層データのため参照しない（Free/Paid境界を維持）。
  const takeaway = PreviewUI.summarizeSentence(vm.impact, 96);
  if (takeaway) {
    const tw = document.createElement("div");
    tw.className = "executive-takeaway";
    tw.appendChild(textP("executive-takeaway__label", "Executive Takeaway"));
    tw.appendChild(textP("executive-takeaway__text", takeaway));
    canvas.appendChild(tw);
  }

  el.appendChild(canvas);
}

// 確信度（高/中/低）を★の数へ機械的に変換するだけの表示補助。新しい判定は行わない。
function confidenceStars(level) {
  const n = level === "高" ? 5 : level === "低" ? 2 : 4;
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

// 「導入しやすさ / 市場性 / 顧客ニーズ」の3カード。いずれも既存フィールドからの抜粋のみ
// （first_action / market_change・market snapshot / why_now）。元データが無い項目は出さない。
function opportunityTriad(data, vm, snapshot) {
  const fa = (data.free_opportunity || {}).first_action || "";
  const out = [];
  const ease = PreviewUI.summarizeSentence(fa, 60);
  if (ease) out.push({ label: "導入しやすさ", text: ease });

  const marketText =
    PreviewUI.summarizeSentence(vm.marketChange, 60) ||
    (snapshot.stats[0] ? `${snapshot.stats[0].value}（${labelWithScope(snapshot.stats[0])}）` : "");
  if (marketText) out.push({ label: "市場性", text: marketText });

  const need = PreviewUI.summarizeSentence(vm.whyNow, 60);
  if (need) out.push({ label: "顧客ニーズ", text: need });

  return out;
}

/* ==================== Why This Opportunity Matters（Phase68 STEP7: 新設） ==================== */
// Opportunity と First Step の間。3 Insight Cards（市場背景 / 御社との一致 / 今始める理由）。
// いずれも Why Now / Why You からの抜粋のみ。新しい文章は生成しない。
function renderWhyThisMatters(vm) {
  const el = document.getElementById("sec-why-matters");
  el.innerHTML = "";

  const wc = String(vm.whyCompany || "");
  const firstCompanySentence = (wc.match(/^[\s\S]*?。/) || [wc])[0];
  const restCompanySentence = wc.slice(firstCompanySentence.length).trim();

  const items = [
    { glyph: "market_network", label: "市場背景", text: PreviewUI.summarizeSentence(vm.marketChange || vm.whyNow, 70) },
    { glyph: "company_profile", label: "御社との一致", text: PreviewUI.summarizeSentence(restCompanySentence || firstCompanySentence, 70) },
    { glyph: "rocket_milestone", label: "今始める理由", text: PreviewUI.summarizeSentence(vm.whyNow, 70) },
  ].filter((it) => it.text);
  if (!items.length) return;

  el.appendChild(secHead("このビジネスチャンスが重要な理由", "sparkles"));

  const grid = document.createElement("div");
  grid.className = "why-matters-cards";
  items.forEach((it) => {
    const c = document.createElement("div");
    c.className = "why-matters-card";
    const icon = document.createElement("span");
    icon.className = "why-matters-card__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = Illustrations.glyph(it.glyph, { size: 20 });
    c.appendChild(icon);
    c.appendChild(textP("why-matters-card__label", it.label));
    c.appendChild(textP("why-matters-card__text", it.text));
    grid.appendChild(c);
  });
  el.appendChild(grid);
}

/* ==================== 根拠（STEP8: カードデザイン刷新・折りたたみ） ==================== */

const EVIDENCE_BADGE_LABEL = {
  company: "企業情報",
  government: "政府",
  industry_association: "市場",
  statistics: "市場",
  technology: "市場",
  news: "ニュース",
  directory: "企業情報",
  review: "調査",
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

// Phase75 STEP7: 折りたたみを開いた後も、先頭3件のみを常時表示し、残りは
// ネストした「さらに表示」details に格納する（データは1件も削らない・全件保持）。
function buildEvidenceList(evidence, sourceMap, offset) {
  const ul = document.createElement("ul");
  ul.className = "evi-list evi-list--card";
  evidence.forEach((ev, i) => {
    const src = sourceMap.get(ev.source_id) || {};
    const colorKey = BADGE_COLOR_KEY[src.source_type] || "research";
    const badgeLabel = EVIDENCE_BADGE_LABEL[src.source_type] || "参考";
    const li = document.createElement("li");
    li.className = "evi-item evi-item--" + (src.source_type || "other") + " evi-card";
    const num = document.createElement("span");
    num.className = "evi-item__num";
    num.setAttribute("aria-hidden", "true");
    num.textContent = String(offset + i + 1);
    li.appendChild(num);
    const chip = document.createElement("span");
    chip.className = "evi-item__chip badge-cat badge-cat--" + colorKey;
    chip.textContent = badgeLabel;
    li.appendChild(chip);
    if (src.label) {
      const t = document.createElement("p");
      t.className = "evi-item__title";
      t.textContent = decodeHtmlEntities(src.label);
      li.appendChild(t);
    }
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
  return ul;
}

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
  body.appendChild(secHead("今回の提案の根拠", "evidence_stack"));
  body.appendChild(sectionSceneEl("market_growth_chart"));
  body.appendChild(
    textP("disclosure__lede", "公開情報・市場データ・企業情報を組み合わせて分析しました。")
  );

  const visible = evidence.slice(0, 3);
  const rest = evidence.slice(3);
  body.appendChild(buildEvidenceList(visible, sourceMap, 0));

  if (rest.length) {
    const moreDetails = document.createElement("details");
    moreDetails.className = "disclosure disclosure--nested";
    const moreSummary = document.createElement("summary");
    moreSummary.textContent = `さらに表示（残り${rest.length}件）`;
    moreDetails.appendChild(moreSummary);
    const moreBody = document.createElement("div");
    moreBody.className = "disclosure__body";
    moreBody.appendChild(buildEvidenceList(rest, sourceMap, 3));
    moreDetails.appendChild(moreBody);
    body.appendChild(moreDetails);
  }

  details.appendChild(body);
  el.appendChild(details);
}

/* ==================== 情報源（STEP9: Accordion Card 化・折りたたみ・最後） ==================== */

const SOURCE_BADGE_LABEL = {
  company: "企業公式",
  government: "政府",
  industry_association: "業界団体",
  statistics: "調査会社",
  technology: "業界団体",
  news: "ニュース",
  directory: "企業公式",
  review: "調査会社",
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

// Phase67 STEP9: Sources Library（Accordion 廃止・常時表示のカードライブラリ化）。
// データソースは従来通り top_sources 優先／無ければ source_pages（変更なし）。
function renderSourcesV2(data) {
  const el = document.getElementById("sec-sources");
  el.innerHTML = "";
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  if (!list.length) return;
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;

  el.appendChild(secHead("今回の分析で確認した情報源", "market_network"));
  el.appendChild(
    textP(
      "sources-lede",
      `今回の分析で確認した情報源（${list.length}件${hidden > 0 ? " ＋ ほか " + hidden + " 件" : ""}）。数値はいずれも情報源に記載の表現です。`
    )
  );

  const grid = document.createElement("div");
  grid.className = "source-card-grid";
  list.forEach((sp) => {
    const colorKey = BADGE_COLOR_KEY[sp.source_type] || "research";
    const badgeLabel = SOURCE_BADGE_LABEL[sp.source_type] || "その他";
    const card = document.createElement("a");
    card.className = "source-card badge-cat--" + colorKey + "-border";
    card.href = sp.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const icon = document.createElement("span");
    icon.className = "source-card__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = Illustrations.glyph(SOURCE_ICON[sp.source_type] || "search", { size: 18 });
    card.appendChild(icon);
    const badge = document.createElement("span");
    badge.className = "source-card__badge badge-cat badge-cat--" + colorKey;
    badge.textContent = badgeLabel;
    card.appendChild(badge);
    const title = document.createElement("p");
    title.className = "source-card__title";
    title.textContent = decodeHtmlEntities(sp.label || sp.url);
    card.appendChild(title);
    if (sp.source_role) {
      const role = document.createElement("p");
      role.className = "source-card__role";
      role.textContent = "利用目的: " + (SOURCE_ROLE_LABELS[sp.source_role] || sp.source_role);
      card.appendChild(role);
    }
    grid.appendChild(card);
  });
  el.appendChild(grid);
}

/* ==================== ほかの検討テーマ（STEP10: 高級化） ==================== */

function renderLockedThemes(lockedOpportunities) {
  const el = document.getElementById("sec-locked");
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
    // Phase68 STEP15: 🔒 絵文字（common.js 由来）を SVG アイコンへ差し替える（Emoji 禁止）。
    const lockIcon = card.querySelector(".opp-card__lock-icon");
    if (lockIcon) lockIcon.innerHTML = Illustrations.glyph("lock_premium", { size: 16 });
    const note = document.createElement("span");
    note.className = "opp-card--locked__note";
    note.textContent = "詳細分析版で公開";
    card.appendChild(note);
    cards.appendChild(card);
  });
  panel.appendChild(cards);

  const highlight = document.createElement("p");
  highlight.className = "locked-panel__highlight";
  highlight.textContent = `ほか${items.length}件あります。`;
  panel.appendChild(highlight);

  el.appendChild(panel);
}

/* ==================== Trust / Micro Proof（下部 sec-trust セクション） ==================== */

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
    icon.innerHTML = Illustrations.glyph("check_circle", { size: 14 });
    const t = document.createElement("span");
    t.textContent = it.label;
    li.append(icon, " ", t);
    wrap.appendChild(li);
  });
  el.appendChild(wrap);
}

/* ==================== 下部 CTA（STEP11: LP仕様） ==================== */

function renderCtaBottom() {
  const el = document.getElementById("sec-cta");
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "cta-v3 cta-v3--bottom cta-final";

  // Phase73 STEP8: CTA Premium Finish（見出し・Benefit Stripの文言を更新）。
  wrap.appendChild(textP("cta-final__title", "毎週、新しいビジネスチャンスをお届けします。"));

  const points = document.createElement("ul");
  points.className = "cta-final__points";
  ["公開情報だけを分析", "専門家監修", "配信停止はいつでも可能"].forEach((t) => {
    const li = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "cta-final__points-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = Illustrations.glyph("check_circle", { size: 14 });
    const label = document.createElement("span");
    label.textContent = t;
    li.append(icon, label);
    points.appendChild(li);
  });
  wrap.appendChild(points);

  wrap.appendChild(ctaButton("無料版レポートを受け取る"));
  // Phase75 STEP8: 補足文を1行に簡素化（既存のTrust文言=email-render.jsと同じ確立済み
  // コピーを再利用。新しい文章は作らない）。
  wrap.appendChild(textP("cta-final__note", "メールアドレス登録だけで無料版を毎週配信"));

  // Phase68 STEP2 STEP12: 印刷専用 CTA（ボタンではなく URL 文字列 + QR風プレースホルダー）。
  // 画面には出さない（.print-only は @media print のみ表示）。QR コードは生成しない。
  const printCta = document.createElement("div");
  printCta.className = "print-only cta-print";
  const qr = document.createElement("div");
  qr.className = "cta-print__qr";
  qr.setAttribute("aria-hidden", "true");
  qr.innerHTML = Illustrations.glyph("cta_arrow", { size: 20 });
  printCta.appendChild(qr);
  printCta.appendChild(textP("cta-print__note", "ブラウザ版で続きを確認できます。"));
  const url = document.createElement("p");
  url.className = "cta-print__url";
  url.textContent = typeof window !== "undefined" && window.location ? window.location.href : "";
  printCta.appendChild(url);
  wrap.appendChild(printCta);

  el.appendChild(wrap);
}

/* ==================== フッター（STEP12: ブランド化） ==================== */

function renderFooter(data) {
  const el = document.getElementById("report-footer");
  el.innerHTML = "";

  const brand = document.createElement("div");
  brand.className = "report-footer__brand";
  brand.innerHTML =
    `<span class="report-footer__brand-mark">AOR</span>` +
    `<span class="report-footer__brand-doctype">BUSINESS OPPORTUNITY REPORT</span>`;
  el.appendChild(brand);
  el.appendChild(textP("report-footer__tagline", "専門家監修・公開情報分析レポート"));

  const rows = [
    linkRow("情報修正依頼", mailtoLink("レポート内容の訂正について")),
    linkRow("配信停止", mailtoLink("配信停止のご連絡", "配信停止を希望します。\n")),
    linkRow("運営会社", "index.html"),
    linkRow("プライバシー", "privacy.html"),
  ];
  const gen = formatDate(data.meta && data.meta.generated_at);
  const count = sourceCount(data);

  const linkRowEl = document.createElement("p");
  linkRowEl.className = "report-footer__links";
  rows.forEach((content, i) => {
    if (i) linkRowEl.append(" ・ ");
    linkRowEl.appendChild(content);
  });
  el.appendChild(linkRowEl);

  const metaLine = document.createElement("p");
  metaLine.className = "report-footer__meta";
  const metaParts = [];
  if (gen) metaParts.push(`分析日: ${gen}`);
  if (count) metaParts.push(`分析ソース数: ${count}件`);
  metaLine.textContent = metaParts.join(" ・ ");
  if (metaParts.length) el.appendChild(metaLine);

  const year = new Date().getFullYear();
  el.appendChild(textP("report-footer__copyright", `© ${year} AOR — Business Opportunity Report`));
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

// Phase76 STEP1: Executive Brief の「続きを読む」クリックで、ジャンプ先の
// 見出し（.sec-head）を一瞬ハイライトする（CSSアニメーションのみ・新しい文言は
// 追加しない。ネイティブのアンカージャンプ自体は妨げない）。
function wireJumpHighlight() {
  document.querySelectorAll(".exec-brief-card__more").forEach((a) => {
    a.addEventListener("click", () => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      const target = document.querySelector(href);
      const head = target && target.querySelector(".sec-head");
      if (!head) return;
      head.classList.remove("sec-head--flash");
      void head.offsetWidth; // reflow でアニメーションを再トリガー
      head.classList.add("sec-head--flash");
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
  arrow.innerHTML = Illustrations.glyph("cta_arrow", { size: 16 });
  a.append(t, arrow);
  return a;
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

// Phase72 STEP2（実メールQA反映）: 各章先頭の小型説明イラスト（SVGのみ）。
function sectionSceneEl(name) {
  const wrap = document.createElement("div");
  wrap.className = "sec-scene";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = Illustrations.sectionScene(name);
  return wrap;
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

// 情報源ラベルに稀に残る HTML 数値文字参照（&#8211; 等）をプレーンテキストへ戻す。
// textContent 経由の表示は実体参照を解釈しないため、そのままだと文字参照が
// リテラル文字列として画面に出てしまう（例: "&#8211;" が "–" に変換されず残る）。
function decodeHtmlEntities(s) {
  var t = String(s == null ? "" : s);
  if (!/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|#39);/i.test(t)) return t;
  return t
    .replace(/&#(\d+);/g, function (_, d) {
      return String.fromCodePoint(parseInt(d, 10));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
      return String.fromCodePoint(parseInt(h, 16));
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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
