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

const INVALID_LINK_MESSAGE = "このリンクは期限切れ、または無効です。再度メールから配信停止してください。";

/** エントリポイント。?lead=/?token=を読み取り、確認UIを表示する（POSTは行わない）。
 * Phase72 STEP2: パラメータ欠落時も「エラー画面」ではなく、配信停止ページ内の
 * 通常の案内文として表示する（HTTP自体は常に200・内部例外を見せない）。 */
function init() {
  currentLeadId = getLeadParam();
  currentReportToken = getReportTokenParam();

  showState("page", STATE_IDS);

  if (!currentLeadId || !currentReportToken) {
    showResult(INVALID_LINK_MESSAGE);
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
        showResult("配信停止しました。また登録できます。");
      } else if (res.status === 429) {
        showUnsubscribeError("送信回数が多すぎます。しばらく時間をおいてから再度お試しください。");
      } else {
        // lead_id/token が不一致・失効等（内部エラー詳細は見せない）。
        showResult(INVALID_LINK_MESSAGE);
      }
    } catch (err) {
      showUnsubscribeError("通信エラーが発生しました。ネットワーク接続をご確認のうえ、再度お試しください。");
    } finally {
      isSubmitting = false;
      btn.disabled = false;
    }
  });
}

/** @param {string} message */
function showUnsubscribeError(message) {
  const el = document.getElementById("unsubscribe-error");
  el.textContent = message;
  el.hidden = false;
}

function hideUnsubscribeError() {
  const el = document.getElementById("unsubscribe-error");
  el.hidden = true;
  el.textContent = "";
}

/** @param {string} message */
function showResult(message) {
  document.getElementById("confirm-section").hidden = true;
  const resultSection = document.getElementById("result-section");
  document.getElementById("result-message").textContent = message;
  resultSection.hidden = false;
}
