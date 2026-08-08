/*
 * AOR Phase5.1 - email-capture.html（登録画面）
 * 仕様: docs/mockups_v2/03_email_capture.md / docs/strategy_v2/07_free_report.md
 * 使用フィールド: company_profile, free_opportunity.extended_analysis
 * paid_preview_opportunity（旧スキーマ）は使用禁止。API連携なし、静的モック。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

let currentData = null;
let currentSlug = null;

document.addEventListener("DOMContentLoaded", init);

/**
 * エントリポイント。?company= を読み取り、データ取得→事前入力、またはエラー表示を行う。
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

  try {
    currentData = await fetchCompanyData(currentSlug);
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

  wireToggle();
  wireForm();
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

/** フォーム送信（静的モック: 送信先なし、バリデーション後にその場で成功画面へ）を配線する。 */
function wireForm() {
  const form = document.getElementById("capture-form");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const emailInput = document.getElementById("email");
    const emailError = document.getElementById("email-error");
    const consentInput = document.getElementById("consent");
    const consentLabel = document.getElementById("consent-label");
    const consentError = document.getElementById("consent-error");

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

    showSuccess(emailInput.value);
  });
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
