/*
 * AOR Phase5.1 - email-capture.html（登録画面）
 * 仕様: docs/mockups_v2/03_email_capture.md / docs/strategy_v2/07_free_report.md
 * 使用フィールド: company_profile, free_opportunity.extended_analysis
 * paid_preview_opportunity（旧スキーマ）は使用禁止。
 *
 * 【PJ2 第2実装】フォーム送信はwebsite/aor-lead-apiのPOST /api/leadsへ接続する
 * （LEAD_API_BASE_URLはcommon.js参照）。送信するのはemail/company_slug/consentのみ。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

let currentData = null;
let currentSlug = null;
let isSubmitting = false; // PJ2 第2実装: 二重送信防止（永続的なidempotency機構は今回不要）

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
