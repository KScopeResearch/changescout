/*
 * unsubscribe.html（配信停止画面）のスクリプト。
 *
 * URLの ?lead=<lead_id>&token=<token> を common.js の getLeadParam() /
 * getReportTokenParam() で読み取り、確認ボタンが明示的にクリックされた場合のみ
 * POST /api/leads/unsubscribe（body: {lead_id, token}）を送信する。
 *
 * 【重要】ページ読み込み時（DOMContentLoaded）には確認UIの表示のみを行い、一切の
 * fetch/POSTを行わない。GETでのアクセス（メールセキュリティスキャナ・リンクプレビュー等）
 * だけでは配信停止が発生しないようにするための必須要件。
 *
 * lead_id/token は console.error 等のログにも一切出力しない（漏洩防止）。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

let currentLeadId = null;
let currentReportToken = null;
let isSubmitting = false;

document.addEventListener("DOMContentLoaded", init);

// Phase75 STEP5: 無効リンク時、赤いエラー画面（fatal-error用のstate要素）ではなく
// 見出し/本文/補足の3点セットで案内する（result-sectionを再利用する）。
const INFO_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11v5" stroke-linecap="round"/>' +
  '<circle cx="12" cy="8" r="0.75" fill="currentColor" stroke="none"/></svg>';

const SUCCESS_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const INVALID_LINK_RESULT = {
  tone: "info",
  icon: INFO_ICON_SVG,
  heading: "このリンクは期限切れ、または無効です。",
  body: "再度メールに記載された「配信停止リンク」からお手続きしてください。",
  note: "古いメールのリンクや、一度利用済みのリンクでは配信停止できません。",
};

const SUCCESS_RESULT = {
  tone: "success",
  icon: SUCCESS_ICON_SVG,
  heading: "配信停止しました。",
  body: "今後、このメールアドレスには無料版レポートを配信しません。",
  note: "いつでも再登録できます。",
};

/** エントリポイント。?lead=/?token=を読み取り、確認UIを表示する（POSTは行わない）。
 * Phase72 STEP2: パラメータ欠落時も「エラー画面」ではなく、配信停止ページ内の
 * 通常の案内文として表示する（HTTP自体は常に200・内部例外を見せない）。 */
function init() {
  currentLeadId = getLeadParam();
  currentReportToken = getReportTokenParam();

  showState("page", STATE_IDS);

  if (!currentLeadId || !currentReportToken) {
    showResult(INVALID_LINK_RESULT);
    return;
  }

  document.getElementById("confirm-section").hidden = false;
  wireUnsubscribeButton();
}

/** 配信停止ボタンのクリックのみを起点にPOSTを送信する。 */
function wireUnsubscribeButton() {
  const btn = document.getElementById("unsubscribe-btn");
  btn.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    btn.disabled = true;
    hideUnsubscribeError();

    try {
      const res = await fetch(`${LEAD_API_BASE_URL}/api/leads/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: currentLeadId, token: currentReportToken }),
      });

      if (res.ok) {
        showResult(SUCCESS_RESULT);
      } else if (res.status === 429) {
        showUnsubscribeError("送信回数が多すぎます。しばらく時間をおいてから再度お試しください。");
      } else {
        // lead_id/token が不一致・失効等（内部エラー詳細は見せない）。
        showResult(INVALID_LINK_RESULT);
      }
    } catch (err) {
      // Phase75 STEP5: 通信失敗時は見出し/本文の2点セット。confirm-sectionは隠さず
      // 既存の配信停止ボタンをそのまま残す（＝新しい「再試行」ボタンは追加しない）。
      showUnsubscribeError("現在配信停止を完了できません。", "時間をおいてもう一度お試しください。");
    } finally {
      isSubmitting = false;
      btn.disabled = false;
    }
  });
}

/** @param {string} heading @param {string} [body] */
function showUnsubscribeError(heading, body) {
  const el = document.getElementById("unsubscribe-error");
  el.textContent = "";
  el.appendChild(document.createTextNode(heading));
  if (body) {
    el.appendChild(document.createElement("br"));
    el.appendChild(document.createTextNode(body));
  }
  el.hidden = false;
}

function hideUnsubscribeError() {
  const el = document.getElementById("unsubscribe-error");
  el.hidden = true;
  el.textContent = "";
}

/** @param {{tone:string, icon:string, heading:string, body:string, note?:string}} result */
function showResult(result) {
  document.getElementById("confirm-section").hidden = true;
  const resultSection = document.getElementById("result-section");
  resultSection.className = "section result-section result-section--" + result.tone;

  document.getElementById("result-icon").innerHTML = result.icon;
  document.getElementById("result-heading").textContent = result.heading;
  document.getElementById("result-body").textContent = result.body;

  const noteEl = document.getElementById("result-note");
  if (result.note) {
    noteEl.textContent = result.note;
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
    noteEl.textContent = "";
  }

  resultSection.hidden = false;
}
