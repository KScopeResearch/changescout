/*
 * AOR Phase5.1 - email-capture.html（登録画面）
 * 仕様: docs/mockups_v2/03_email_capture.md / docs/strategy_v2/07_free_report.md
 * 使用フィールド: company_profile, free_opportunity.extended_analysis
 * paid_preview_opportunity（旧スキーマ）は使用禁止。
 *
 * 【PJ2 第2実装】フォーム送信はwebsite/aor-lead-apiのPOST /api/leadsへ接続する
 * （LEAD_API_BASE_URLはcommon.js参照）。送信するのはemail/company_slug/consentのみ。
 *
 * 【PJ2 Phase3前段】report-preview.htmlから ?lead=<lead_id>&token=<report_token> を
 * 伴って遷移してきた場合（=report_generated済みLeadへのメールリンク経由）は、
 * 上記の自己登録フォーム（email再入力）ではなく、Phase4-A/B（詳しい有料レポートが欲しい／
 * 毎週無料レポートに同意する）の選択UIを表示する。emailは再入力させない
 * （Lead側で既に把握済みのため）。呼び出し先のPOST /api/leads/:lead_id/<action>自体は
 * 今回まだ実装していない（今回のスコープはlead_id・report_tokenの受け渡し経路のみ）。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

const PHASE4_ACTIONS = {
  paid: "paid-report-request",
  weekly: "weekly-report-consent",
};

let currentData = null;
let currentSlug = null;
let currentLeadId = null;
let currentReportToken = null;
let isSubmitting = false; // PJ2 第2実装: 二重送信防止（永続的なidempotency機構は今回不要）
let isPhase4Submitting = false; // PJ2 Phase3前段: Phase4-A/Bボタンの二重送信防止

document.addEventListener("DOMContentLoaded", init);

/**
 * エントリポイント。?company= を読み取り、データ取得→事前入力、またはエラー表示を行う。
 * ?lead=/?token= が両方指定されている場合はPhase4-A/B選択UIを、それ以外は既存の
 * 自己登録フォームを表示する。
 * @returns {Promise<void>}
 */
async function init() {
  currentSlug = getCompanyParam();

  if (!currentSlug) {
    showError(
      document.getElementById("state-error-content"),
      "対象データが見つかりません。",
      "URLに ?company=<会社ID> を指定してアクセスしてください。"
    );
    showState("state-error", STATE_IDS);
    return;
  }

  currentLeadId = getLeadParam();
  currentReportToken = getReportTokenParam();

  try {
    currentData = await fetchCompanyData(currentSlug);
    renderPremiumLp(currentData);
    prefillOptionalFields(currentData);
    showState("page", STATE_IDS);
  } catch (err) {
    console.error("[AOR] 会社データの読み込みに失敗しました:", err);
    showError(
      document.getElementById("state-error-content"),
      "データを読み込めませんでした。",
      "ブラウザのセキュリティ制限により、file:// で直接開いた場合はデータ（JSON）の読み込みがブロックされることがあります。簡易サーバーを起動してからアクセスしてください（例: python -m http.server）。"
    );
    showState("state-error", STATE_IDS);
    return;
  }

  if (currentLeadId && currentReportToken) {
    document.getElementById("capture-form").hidden = true;
    document.getElementById("phase4-section").hidden = false;
    // Phase4 モードでは Section9 の固定見出し（無料版訴求）は文脈が合わないため隠す。
    // phase4-section 自体の見出し（「続けてお選びください」）が案内役を担う。
    document.querySelector(".ec-cta-section__title").hidden = true;
    document.querySelector(".ec-cta-section__desc").hidden = true;
    wirePhase4Actions();
  } else {
    wireToggle();
    wireForm();
  }
}

/**
 * 会社名・業種の任意項目に、AI推定値を初期値として入れる。
 * @param {Object} data - 会社データ
 */
function prefillOptionalFields(data) {
  const companyNameInput = document.getElementById("company-name");
  const industryInput = document.getElementById("industry");

  companyNameInput.value = data.company_profile.name;
  industryInput.value = data.company_profile.industry_label;

  const hintText = "AI推定です。内容が異なる場合は修正してください。";
  document.getElementById("company-name-hint").textContent = hintText;
  document.getElementById("industry-hint").textContent = hintText;

  document.getElementById("footer-opt-out").setAttribute(
    "href",
    mailtoLink("配信停止のご連絡", "配信停止を希望します。\n")
  );
}

/* ====================================================================
 * Phase69 STEP1: Premium LP（Content SAME / Presentation NEW）
 * 表示するデータは fetchCompanyData() が返す既存 report.json のフィールドのみ。
 * 新しい数値・文章は一切生成しない。preview-ui.js / market-stats.js の
 * 既存のビュー変換関数（Content SAME の Initial Report と同じもの）を再利用する。
 * ==================================================================== */

function renderPremiumLp(data) {
  const vm = PreviewUI.buildOpportunityViewModel(data);
  const theme = PreviewUI.pickVisualTheme(data);
  const snapshot = PreviewUI.marketSnapshot(data);

  renderCover(data, vm, theme, snapshot);
  renderWhatYouGet(data, vm);
  renderDashboard(data, vm, snapshot);
  renderPremiumPreview(data, vm);
  renderWeeklyPreview(vm);
  renderTrustSection(data);
  renderEcFooter(data);
  initEcScrollReveal();
}

// Phase69 STEP1: Initial Report と同じ Intersection Observer による Fade + Scale + 16px Up。
// prefers-reduced-motion では即表示。IntersectionObserver 非対応環境でも即表示にフォールバック。
function initEcScrollReveal() {
  const targets = Array.from(
    document.querySelectorAll(
      "#ec-cover, #ec-what-you-get, #ec-dashboard, #ec-premium-preview, .ec-structure, #ec-weekly-preview, #ec-trust, .ec-faq, #ec-cta-section"
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

/* ---------- SECTION 1: Executive Cover ---------- */
function renderCover(data, vm, theme, snapshot) {
  const el = document.getElementById("ec-cover");
  el.innerHTML = "";
  const cp = data.company_profile || {};

  const header = document.createElement("div");
  header.className = "hero-cover-header";

  const brand = document.createElement("p");
  brand.className = "report-hero__brand";
  brand.innerHTML =
    `<span class="report-hero__brand-mark">AOR</span>` +
    `<span class="report-hero__doctype">BUSINESS OPPORTUNITY REPORT</span>`;
  header.appendChild(brand);

  const badgeCluster = document.createElement("div");
  badgeCluster.className = "hero-cover-badges";
  badgeCluster.innerHTML =
    `<span class="hero-cover-badge hero-cover-badge--free">FREE EDITION</span>` +
    `<span class="hero-cover-badge hero-cover-badge--confidential">CONFIDENTIAL</span>` +
    `<span class="hero-review-badge"><span aria-hidden="true">${Illustrations.glyph("shield_check", { size: 14 })}</span> 専門家監修</span>`;
  header.appendChild(badgeCluster);
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "hero-body";

  body.appendChild(textP("report-hero__company", PreviewUI.salutation(cp.name)));
  body.appendChild(textP("report-hero__cover-lede", "御社専用追加分析"));

  const h1 = document.createElement("h1");
  h1.className = "report-hero__headline";
  h1.textContent = vm.title || vm.headline || "";
  body.appendChild(h1);

  const sub = PreviewUI.heroSubcopy(vm.whyCompany) || PreviewUI.oneLineSummary(vm.title);
  if (sub) body.appendChild(textP("report-hero__variant-line", sub));

  const cta = document.createElement("a");
  cta.className = "hero-cta-inline cta-v3__btn cta-v3__btn--hero";
  cta.href = "#ec-cta-section";
  const arrow = Illustrations.glyph("cta_arrow", { size: 16 });
  cta.innerHTML = `<span class="cta-v3__btn-text">無料版を毎週受け取る</span><span class="cta-v3__btn-arrow" aria-hidden="true">${arrow}</span>`;
  body.appendChild(cta);

  const trustBar = document.createElement("ul");
  trustBar.className = "hero-cover-trust";
  trustBar.setAttribute("aria-label", "このレポートについて");
  PreviewUI.trustItems(data).forEach((it) => {
    const li = document.createElement("li");
    li.innerHTML = `<span aria-hidden="true">${Illustrations.glyph("check_circle", { size: 13 })}</span> ${escapeText(it.label)}`;
    trustBar.appendChild(li);
  });
  body.appendChild(trustBar);

  el.appendChild(body);

  const illust = document.createElement("div");
  illust.className = "hero-illust";
  illust.setAttribute("aria-hidden", "true");
  illust.innerHTML = Illustrations.hero(theme);
  el.appendChild(illust);
}

/* ---------- SECTION 2: 追加分析ではここまで分かります ---------- */
function renderWhatYouGet(data, vm) {
  const el = document.getElementById("ec-what-you-get");
  el.innerHTML = "";
  const ext = (data.free_opportunity || {}).extended_analysis || {};
  const fa = (data.free_opportunity || {}).first_action || "";

  const items = [
    { glyph: "line_chart", label: "市場規模", text: PreviewUI.summarizeSentence(ext.market_size, 70) },
    { glyph: "market_network", label: "競合分析", text: PreviewUI.summarizeSentence(ext.competition, 70) },
    { glyph: "rocket", label: "最初の一歩", text: PreviewUI.summarizeSentence(fa, 70) },
  ].filter((it) => it.text);
  if (!items.length) return;

  el.appendChild(ecSecHead("追加分析ではここまで分かります"));

  const grid = document.createElement("div");
  grid.className = "why-matters-cards";
  items.forEach((it) => {
    const c = document.createElement("div");
    c.className = "why-matters-card";
    c.innerHTML =
      `<span class="why-matters-card__icon" aria-hidden="true">${Illustrations.glyph(it.glyph, { size: 20 })}</span>` +
      `<p class="why-matters-card__label">${escapeText(it.label)}</p>` +
      `<p class="why-matters-card__text">${escapeText(it.text)}</p>`;
    grid.appendChild(c);
  });
  el.appendChild(grid);
}

/* ---------- SECTION 3: Executive Dashboard ---------- */
function renderDashboard(data, vm, snapshot) {
  const el = document.getElementById("ec-dashboard");
  el.innerHTML = "";
  const cp = data.company_profile || {};
  const nonWorld = snapshot.stats.filter((s) => !s.isWorld);
  const top = nonWorld.length ? nonWorld[0] : snapshot.stats[0];
  const core = coreTerm(vm.title);
  const fit = cp.industry_label && core ? `${cp.industry_label} × ${core}` : cp.industry_label || core || "";
  const count = sourceCount(data);

  const kpis = [
    top ? { glyph: "line_chart", label: "市場の追い風", value: top.value } : null,
    fit ? { glyph: "building", label: "御社との適合", value: fit } : null,
    count ? { glyph: "evidence_stack", label: "ソース数", value: count + "件" } : null,
    vm.confidence && vm.confidence.level ? { glyph: "target", label: "確信度", value: vm.confidence.level } : null,
  ].filter(Boolean);
  if (!kpis.length) return;

  el.appendChild(ecSecHead("Executive Dashboard"));

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

  const why = PreviewUI.summarizeSentence(vm.whyNow, 90);
  if (why) {
    const wtm = document.createElement("div");
    wtm.className = "why-this-matters";
    wtm.innerHTML =
      `<p class="why-this-matters__label">Why this matters</p>` +
      `<p class="why-this-matters__quote">${escapeText(why)}</p>`;
    el.appendChild(wtm);
  }
}

/* ---------- SECTION 4: 詳細分析サンプル（ぼかしプレビュー） ---------- */
function renderPremiumPreview(data, vm) {
  const el = document.getElementById("ec-premium-preview");
  el.innerHTML = "";
  const ext = (data.free_opportunity || {}).extended_analysis || {};

  const items = [
    { glyph: "line_chart", label: "市場規模分析", text: ext.market_size },
    { glyph: "market_network", label: "競合マップ", text: ext.competition },
    { glyph: "rocket_milestone", label: "実行ロードマップ", text: ext.priority || ext.case_examples },
  ].filter((it) => it.text);
  if (!items.length) return;

  el.appendChild(ecSecHead("詳細分析サンプル"));
  el.appendChild(textP("ec-premium-preview__lede", "登録すると、以下の分析を全文でご覧いただけます。"));

  const grid = document.createElement("div");
  grid.className = "ec-premium-grid";
  items.forEach((it) => {
    const c = document.createElement("div");
    c.className = "ec-premium-card";
    c.innerHTML =
      `<div class="ec-premium-card__head">` +
      `<span class="ec-premium-card__icon" aria-hidden="true">${Illustrations.glyph(it.glyph, { size: 18 })}</span>` +
      `<span class="ec-premium-card__label">${escapeText(it.label)}</span>` +
      `</div>` +
      `<p class="ec-premium-card__blur">${escapeText(it.text)}</p>` +
      `<div class="ec-premium-card__lock" aria-hidden="true">${Illustrations.glyph("lock_premium", { size: 20 })}<span>登録して全文を見る</span></div>`;
    grid.appendChild(c);
  });
  el.appendChild(grid);
}

/* ---------- SECTION 6: 毎週届く内容（サンプル） ---------- */
function renderWeeklyPreview(vm) {
  const el = document.getElementById("ec-weekly-preview");
  el.innerHTML = "";
  if (!vm.title) return;

  el.appendChild(ecSecHead("毎週届く内容"));
  el.appendChild(textP("ec-premium-preview__lede", "登録後は、新しいビジネスチャンスをこの形式で毎週お届けします。"));

  const card = document.createElement("div");
  card.className = "ec-weekly-card";
  card.innerHTML =
    `<p class="ec-weekly-card__tag">今週の追加ビジネスチャンス（サンプル）</p>` +
    `<p class="ec-weekly-card__title">${escapeText(vm.title)}</p>` +
    `<p class="ec-weekly-card__note">実際の配信では、その時点で見つかった最新のビジネスチャンスをお届けします。</p>`;
  el.appendChild(card);
}

/* ---------- SECTION 7: Trust ---------- */
function renderTrustSection(data) {
  const el = document.getElementById("ec-trust");
  el.innerHTML = "";
  const items = PreviewUI.trustItems(data);
  const wrap = document.createElement("ul");
  wrap.className = "trust-strip";
  wrap.setAttribute("aria-label", "このレポートについて");
  items.forEach((it) => {
    const li = document.createElement("li");
    li.className = "trust-strip__item";
    li.innerHTML = `<span class="trust-strip__icon" aria-hidden="true">${Illustrations.glyph("check_circle", { size: 14 })}</span> ${escapeText(it.label)}`;
    wrap.appendChild(li);
  });
  el.appendChild(wrap);
}

/* ---------- SECTION 10: Footer ---------- */
function renderEcFooter(data) {
  const el = document.getElementById("ec-footer");
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
    `<a href="#" id="footer-correction">情報修正依頼</a> ・ ` +
    `<a href="#" id="footer-opt-out">配信停止</a> ・ ` +
    `<a href="index.html">運営会社</a> ・ ` +
    `<a href="privacy.html">プライバシー</a>` +
    `</p>` +
    (gen || count
      ? `<p class="report-footer__meta">${[gen ? "分析日: " + escapeText(gen) : "", count ? "分析ソース数: " + count + "件" : ""].filter(Boolean).join(" ・ ")}</p>`
      : "") +
    `<p class="report-footer__copyright">© ${new Date().getFullYear()} AOR — Business Opportunity Report</p>`;

  document.getElementById("footer-correction").setAttribute(
    "href",
    mailtoLink("レポート内容の訂正について")
  );
}

/* ---------- 小さなヘルパー（report-preview.js と同じ方針。新しい数値・文章は作らない） ---------- */

function ecSecHead(title) {
  const h = document.createElement("h2");
  h.className = "sec-title";
  h.textContent = title;
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

// top_sources 優先・無ければ source_pages（report-preview.js の sourceCount と同じロジック）。
function sourceCount(data) {
  const list =
    Array.isArray(data.top_sources) && data.top_sources.length ? data.top_sources : data.source_pages || [];
  const hidden = typeof data.hidden_sources_count === "number" ? data.hidden_sources_count : 0;
  return list.length + hidden;
}

// Opportunity title から定型語尾を取り除いた中核フレーズ（report-preview.js の coreTerm と同じ）。
function coreTerm(title) {
  const t = String(title || "").trim().replace(/（src-\d+[^）]*）/g, "");
  if (!t) return "";
  const m = t.match(/^(.*?)(の立ち上げ|の提供|の展開|の構築|の開発|の商品化|の体系化と展開|の導入|の強化|の拡大)$/);
  return (m ? m[1] : t.replace(/。$/, "")).trim();
}

/** 任意項目トグル（既定は折りたたみ）の開閉を配線する。 */
function wireToggle() {
  const toggleBtn = document.getElementById("toggle-optional");
  const optionalFields = document.getElementById("optional-fields");

  toggleBtn.addEventListener("click", () => {
    const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", String(!isExpanded));
    optionalFields.hidden = isExpanded;
    toggleBtn.textContent = isExpanded ? "詳細を確認（任意・2項目）" : "詳細を閉じる";
  });
}

/**
 * PJ2 第2実装: website/aor-lead-api の POST /api/leads を呼び出す。
 * email/company_slug/consentのみを送信する（captured_atはサーバー側生成のため送らない）。
 * @param {{email:string, company_slug:string, consent:boolean, hp_website:string}} payload
 * @returns {Promise<{status:number, data:?Object}>}
 */
async function submitLead(payload) {
  const res = await fetch(`${LEAD_API_BASE_URL}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // レスポンスボディが無い/不正なJSONの場合はdata=nullのまま、status判定側で扱う
  }
  return { status: res.status, data };
}

/** @param {string} message */
function showApiError(message) {
  const el = document.getElementById("api-error");
  el.textContent = message;
  el.hidden = false;
}

function hideApiError() {
  const el = document.getElementById("api-error");
  el.hidden = true;
  el.textContent = "";
}

/** フォーム送信を配線する。website/aor-lead-api の POST /api/leads へ送信する（PJ2 第2実装）。 */
function wireForm() {
  const form = document.getElementById("capture-form");
  const submitBtn = document.getElementById("submit-btn");
  const arrowEl = submitBtn.querySelector(".ec-submit__arrow");
  if (arrowEl && typeof Illustrations !== "undefined") {
    arrowEl.innerHTML = Illustrations.glyph("cta_arrow", { size: 16 });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return; // 二重送信防止（ボタンdisabled化に加えた保険）

    const emailInput = document.getElementById("email");
    const emailError = document.getElementById("email-error");
    const consentInput = document.getElementById("consent");
    const consentLabel = document.getElementById("consent-label");
    const consentError = document.getElementById("consent-error");
    const hpInput = document.getElementById("hp-website");

    hideApiError();

    const emailValid = emailInput.checkValidity();
    emailError.hidden = emailValid;
    if (!emailValid) {
      emailInput.focus();
      return;
    }

    const consentValid = consentInput.checked;
    consentError.hidden = consentValid;
    consentLabel.classList.toggle("consent--error", !consentValid);
    if (!consentValid) return;

    isSubmitting = true;
    submitBtn.disabled = true;

    let succeeded = false;
    try {
      const { status, data } = await submitLead({
        email: emailInput.value,
        company_slug: currentSlug,
        consent: true,
        hp_website: hpInput ? hpInput.value : "",
      });

      if (status === 201) {
        succeeded = true;
        showSuccess(emailInput.value);
      } else if (status === 429) {
        showApiError("送信回数が多すぎます。しばらく時間をおいてから再度お試しください。");
      } else if (status >= 500) {
        showApiError("一時的な問題が発生しました。しばらくしてから再度お試しください。");
      } else {
        // 400系: サーバー側のバリデーションエラー文言をそのまま表示する
        // （server.jsの各エラーメッセージはユーザー入力を含まない固定文言のみ）。
        showApiError((data && data.error) || "入力内容をご確認ください。");
      }
    } catch (err) {
      showApiError("通信エラーが発生しました。ネットワーク接続をご確認のうえ、再度お試しください。");
    } finally {
      isSubmitting = false;
      if (!succeeded) submitBtn.disabled = false; // 成功時はフォーム自体が非表示になるため再有効化不要
    }
  });
}

/**
 * PJ2 Phase3前段: Phase4-A（詳しい有料レポートが欲しい）・Phase4-B（毎週無料レポートに
 * 同意する）の各ボタンを配線する。lead_id・report_tokenのみを送信し、emailは送らない
 * （emailは既にLead側で把握済み、URLにも含めない）。
 */
function wirePhase4Actions() {
  const paidBtn = document.getElementById("phase4-paid-btn");
  const weeklyBtn = document.getElementById("phase4-weekly-btn");

  paidBtn.addEventListener("click", () => submitPhase4Action(PHASE4_ACTIONS.paid, paidBtn, weeklyBtn));
  weeklyBtn.addEventListener("click", () => submitPhase4Action(PHASE4_ACTIONS.weekly, weeklyBtn, paidBtn));
}

/**
 * Phase4-A/Bの選択を website/aor-lead-api の
 * `POST /api/leads/:lead_id/<action>`（body: {report_token}）へ送信する。
 * 【PJ2 Phase3前段のスコープ】呼び出し先のAPIエンドポイント自体は今回まだ実装していない
 * ため、現時点では404が返る想定である（今回実装するのはlead_id・report_tokenの
 * 受け渡し経路のみ。エンドポイント本体の実装は別タスクで行う）。
 * @param {string} action - "paid-report-request" または "weekly-report-consent"
 * @param {HTMLButtonElement} clickedBtn
 * @param {HTMLButtonElement} otherBtn
 */
async function submitPhase4Action(action, clickedBtn, otherBtn) {
  if (isPhase4Submitting) return;
  isPhase4Submitting = true;
  clickedBtn.disabled = true;
  otherBtn.disabled = true;
  hidePhase4Error();

  try {
    const res = await fetch(`${LEAD_API_BASE_URL}/api/leads/${encodeURIComponent(currentLeadId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_token: currentReportToken }),
    });

    if (res.ok) {
      showPhase4Success();
    } else if (res.status === 429) {
      showPhase4Error("送信回数が多すぎます。しばらく時間をおいてから再度お試しください。");
    } else {
      showPhase4Error("現在この操作を受け付けられませんでした。しばらくしてから再度お試しください。");
    }
  } catch (err) {
    showPhase4Error("通信エラーが発生しました。ネットワーク接続をご確認のうえ、再度お試しください。");
  } finally {
    isPhase4Submitting = false;
    clickedBtn.disabled = false;
    otherBtn.disabled = false;
  }
}

/** @param {string} message */
function showPhase4Error(message) {
  const el = document.getElementById("phase4-error");
  el.textContent = message;
  el.hidden = false;
}

function hidePhase4Error() {
  const el = document.getElementById("phase4-error");
  el.hidden = true;
  el.textContent = "";
}

function showPhase4Success() {
  const el = document.getElementById("phase4-success");
  el.textContent = "ありがとうございます。承りました。";
  el.hidden = false;
}

/**
 * 送信成功画面（「追加分析を公開しました」体験）を表示する。
 * @param {string} email - 入力されたメールアドレス（確認文言に表示するだけで送信はしない）
 */
function showSuccess(email) {
  document.getElementById("capture-form").hidden = true;

  const successEl = document.getElementById("success");
  successEl.hidden = false;
  document.getElementById("success-email").textContent = email;
  const checkIcon = document.querySelector(".ec-success__check-icon");
  if (checkIcon && typeof Illustrations !== "undefined") {
    checkIcon.innerHTML = Illustrations.glyph("check_circle", { size: 22 });
  }

  renderExtendedAnalysis(currentData.free_opportunity && currentData.free_opportunity.extended_analysis);

  const linkEl = document.getElementById("paid-preview-link");
  linkEl.setAttribute("href", `paid-preview.html?company=${encodeURIComponent(currentSlug)}`);

  successEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * free_opportunity.extended_analysis（市場規模・競合状況・想定リスク・優先順位・
 * 参考となる公開事例・confidence_note）を描画する。
 * @param {Object} [ext] - free_opportunity.extended_analysis
 */
function renderExtendedAnalysis(ext) {
  const wrap = document.getElementById("extended-analysis");
  wrap.innerHTML = "";
  if (!ext) return;

  const box = document.createElement("div");
  box.className = "ext-analysis";

  const items = [
    ["市場規模", ext.market_size],
    ["競合状況", ext.competition],
    ["想定リスク", ext.risks],
    ["優先順位", ext.priority],
    ["参考となる公開事例", ext.case_examples],
  ];

  items.forEach(([label, text]) => {
    if (!text) return;
    const item = document.createElement("div");
    item.className = "ext-analysis__item";
    const labelEl = document.createElement("span");
    labelEl.className = "ext-analysis__label";
    labelEl.textContent = label;
    item.appendChild(labelEl);
    const p = document.createElement("p");
    p.textContent = text;
    item.appendChild(p);
    box.appendChild(item);
  });

  wrap.appendChild(box);

  if (ext.confidence_note) {
    const note = document.createElement("p");
    note.className = "ext-analysis__confidence";
    note.textContent = ext.confidence_note;
    box.appendChild(note);
  }
}
