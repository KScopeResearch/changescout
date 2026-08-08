/**
 * detail.js — 詳細画面（Task14 要件②③④）。
 *
 * report.json / evaluation / review.json を横断表示し、review-engine.jsのPure Functionを
 * サーバー経由で呼び出すapprove/reject/revise/comment/fixの操作フォームを提供する。
 * publishableの真偽値はサーバーが返す値（= isPublishable()の戻り値そのもの）をそのまま表示する。
 */

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("ja-JP");
  } catch (e) {
    return v;
  }
}

function getCompanyId() {
  return new URLSearchParams(window.location.search).get("company");
}

function showToast(message, isError) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.borderColor = isError ? "var(--bad)" : "var(--border)";
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 3500);
}

function listItems(arr, cls) {
  if (!arr || !arr.length) return '<div class="empty-state" style="padding:8px 0;">（なし）</div>';
  return `<ul class="plain-list ${cls || ""}">${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
}

function renderEvidence(evidence, sourcePages) {
  if (!evidence || !evidence.length) return "（なし）";
  const sourceMap = new Map((sourcePages || []).map((s) => [s.id, s]));
  return `<ul class="plain-list">${evidence
    .map((e) => {
      const src = sourceMap.get(e.source_id);
      const label = src ? escapeHtml(src.label) : e.source_id;
      return `<li><strong>[${escapeHtml(e.source_id)}] ${label}</strong>: ${escapeHtml(e.quote)}</li>`;
    })
    .join("")}</ul>`;
}

function renderHistory(history) {
  if (!history || !history.length) return '<div class="empty-state" style="padding:8px 0;">（履歴なし）</div>';
  return history
    .slice()
    .reverse()
    .map(
      (h) => `
      <div class="history-entry">
        <div class="meta">${fmtDate(h.at)} ・ ${escapeHtml(h.actor)} ・ <strong>${escapeHtml(h.action)}</strong>${
          h.from_status ? ` （${escapeHtml(h.from_status)} → ${escapeHtml(h.to_status)}）` : ""
        }</div>
        ${h.comment ? `<div>${escapeHtml(h.comment)}</div>` : ""}
      </div>`
    )
    .join("");
}

function renderComments(comments) {
  if (!comments || !comments.length) return '<div class="empty-state" style="padding:8px 0;">（コメントなし）</div>';
  return comments
    .map((c) => `<div class="history-entry"><div class="meta">${fmtDate(c.at)} ・ ${escapeHtml(c.actor)}</div><div>${escapeHtml(c.text)}</div></div>`)
    .join("");
}

function renderFixes(fixes) {
  if (!fixes || !fixes.length) return '<div class="empty-state" style="padding:8px 0;">（修正指示なし）</div>';
  return fixes
    .map(
      (f) =>
        `<div class="history-entry"><div class="meta">${fmtDate(f.at)} ・ ${escapeHtml(f.actor)} ・ ${
          f.resolved ? "解決済み" : "未解決"
        }</div><div>${escapeHtml(f.description)}</div></div>`
    )
    .join("");
}

/**
 * Task23: review.jsonの各種タイムスタンプ（reviewed_at・history/comments/fixesの各at）の
 * うち最も新しいものを返す。「最終更新」＝このレコードに最後に何らかの操作（コメント追加のみ
 * でもよい）が行われた日時。reviewed_atだけだとapprove/reject/revise以外の操作
 * （コメント・修正指示の追加）が反映されないため、より実態に近い「最終更新」を別途計算する。
 * @param {Object} review
 * @returns {string|null} ISO8601文字列、何もなければnull
 */
function computeLastUpdatedAt(review) {
  const timestamps = [review.reviewed_at]
    .concat((review.history || []).map((h) => h.at))
    .concat((review.comments || []).map((c) => c.at))
    .concat((review.fixes || []).map((f) => f.at))
    .filter(Boolean);
  if (!timestamps.length) return null;
  return timestamps.reduce((latest, t) => (new Date(t) > new Date(latest) ? t : latest));
}

function publishableBlock(publishable, reasons) {
  const icon = publishable ? "○" : "×";
  const cls = publishable ? "publishable-true" : "publishable-false";
  const reasonsHtml = !publishable && reasons && reasons.length ? listItems(reasons, "list-warn") : "";
  return `
    <div class="field">
      <div class="label">publishable（isPublishable()の判定）</div>
      <div class="value publishable-icon ${cls}">${icon} ${publishable ? "配信可能" : "配信不可"}</div>
      ${reasonsHtml}
    </div>`;
}

/**
 * Task24: website/aor/data/への公開状態と操作ボタンを表示する。
 * publishable===falseの間は「公開する」ボタンを無効化する（未承認レポートを誤って公開できない
 * ようにする、サーバー側のpublishReport()自体もisPublishable()===falseなら拒否するため
 * 二重の防御になる）。
 * （Task38で追加）公開済みの場合のみ「公開を取り消す」ボタンを表示する。取り消し操作は
 * publishableの状態に関わらず常に押せる（承認状態を問わず、既に公開してしまったものを
 * 取り下げたい、という運用ニーズに応えるため）。
 * @param {boolean} publishable
 * @param {boolean} published
 */
function publishBlock(publishable, published) {
  const statusText = published ? "公開済み（website/aor/data/に反映済み）" : "未公開";
  const statusCls = published ? "publishable-true" : "publishable-false";
  const buttonLabel = published ? "再公開する（最新内容で上書き）" : "公開する";
  const disabledAttr = publishable ? "" : "disabled";
  const hint = publishable
    ? ""
    : '<p class="sub" style="color:var(--text-dim);font-size:12px;">承認済み（publishable=○）にならないと公開できません。</p>';
  const unpublishButton = published
    ? '<button type="button" id="btn-unpublish" class="secondary">公開を取り消す</button>'
    : "";
  return `
    <div class="field">
      <div class="label">website/aorへの公開</div>
      <div class="value publishable-icon ${statusCls}">${statusText}</div>
      <div class="action-panel" style="margin-top:8px;">
        <button type="button" id="btn-publish" ${disabledAttr}>${buttonLabel}</button>
        ${unpublishButton}
      </div>
      ${hint}
    </div>`;
}

async function render() {
  const id = getCompanyId();
  const container = document.getElementById("detail-container");
  if (!id) {
    container.innerHTML = '<div class="empty-state">?company=&lt;id&gt; を指定してください。</div>';
    return;
  }

  let sessionUsername = "-";
  try {
    const session = await AdminApi.getSession();
    sessionUsername = session.username;
    document.getElementById("user-label").textContent = `${session.username} でログイン中`;
  } catch (e) {
    // セッション表示に失敗しても詳細表示自体は続行する
  }

  let data;
  try {
    data = await AdminApi.getReport(id);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">読み込みに失敗しました: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const { report, review, publishable, publishable_reasons, published, validation } = data;
  const fo = report.free_opportunity || {};

  container.innerHTML = `
    <div class="card">
      <h2>${escapeHtml((report.company_profile && report.company_profile.name) || id)}</h2>
      <div class="field-row">
        <div class="field"><div class="label">review.status</div><div class="value"><span class="status-pill status-${review.status}">${review.status}</span></div></div>
        <div class="field"><div class="label">evaluation.status</div><div class="value"><span class="status-pill status-${report.evaluation ? report.evaluation.status : ""}">${report.evaluation ? report.evaluation.status : "—"}</span></div></div>
        <div class="field"><div class="label">score / grade</div><div class="value">${report.evaluation ? `${report.evaluation.score} / 100（${report.evaluation.grade}）` : "—"}</div></div>
        <div class="field"><div class="label">reviewer</div><div class="value">${escapeHtml(review.reviewer || "—")}</div></div>
        <div class="field"><div class="label">reviewed_at</div><div class="value">${fmtDate(review.reviewed_at)}</div></div>
        <div class="field"><div class="label">最終更新（コメント・修正指示を含む）</div><div class="value">${fmtDate(computeLastUpdatedAt(review))}</div></div>
        ${publishableBlock(publishable, publishable_reasons)}
        ${publishBlock(publishable, published)}
      </div>
    </div>

    <div class="card">
      <h2>free_opportunity</h2>
      <h3>title</h3>
      <div>${escapeHtml(fo.title)}</div>
      <h3>why_now</h3>
      <div>${escapeHtml(fo.why_now)}</div>
      <h3>why_company</h3>
      <div>${escapeHtml(fo.why_company)}</div>
      <h3>market_change</h3>
      <div>${escapeHtml(fo.market_change)}</div>
      <h3>first_action</h3>
      <div>${escapeHtml(fo.first_action)}</div>
      <h3>evidence</h3>
      ${renderEvidence(fo.evidence, report.source_pages)}
    </div>

    <div class="card">
      <h2>quality-evaluator</h2>
      <p class="sub" style="color:var(--text-dim);font-size:12px;margin-top:-6px;">
        ※ evaluationはreport.json生成時点の内容（report.jsonに埋め込まれたhuman_review.statusを
        参照して作られる）。review.json（下のカード）とは非同期のため、improvementsが
        「human_reviewが未着手です」と表示されていても、実際のreview.status（上のカード）が
        既にapprovedになっている場合がある（Task13/14の既知の制約。README参照）。
      </p>
      <h3>reasons（良かった点）</h3>
      ${listItems(report.evaluation && report.evaluation.reasons)}
      <h3>warnings（注意点）</h3>
      ${listItems(report.evaluation && report.evaluation.warnings, "list-warn")}
      <h3>improvements（改善提案）</h3>
      ${listItems(report.evaluation && report.evaluation.improvements, "list-improve")}
    </div>

    <div class="card">
      <h2>review.json</h2>
      <h3>comments（${(review.comments || []).length}件）</h3>
      ${renderComments(review.comments)}
      <h3>fixes（${(review.fixes || []).length}件、うち未解決${(review.fixes || []).filter((f) => !f.resolved).length}件）</h3>
      ${renderFixes(review.fixes)}
      <h3>history（${(review.history || []).length}件）</h3>
      ${renderHistory(review.history)}
      <div class="field-row" style="margin-top:10px;">
        <div class="field"><div class="label">review.json検証</div><div class="value">${validation.review.ok ? "PASS" : "FAIL: " + escapeHtml(validation.review.errors.join(" / "))}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>レビュー操作</h2>
      <p class="sub" style="color:var(--text-dim);font-size:12px;margin-top:-6px;">
        操作者名はログイン中のユーザー（${escapeHtml(sessionUsername)}）が自動的に使われます
        （Task15でreviewer/actorの手入力欄を廃止し、認証済みユーザー名をサーバー側で使う設計に変更）。
      </p>
      <form id="form-approve" class="action-form">
        <strong>承認 / 却下 / 差し戻し</strong>
        <label class="form-label">comment</label>
        <textarea name="comment" placeholder="コメント（任意）"></textarea>
        <label class="form-label">fix（差し戻し時のみ・複数可、改行区切り）</label>
        <textarea name="fixes" placeholder="修正指示1&#10;修正指示2"></textarea>
        <div class="action-panel">
          <button type="button" data-action="approve">承認する</button>
          <button type="button" class="danger" data-action="reject">却下する</button>
          <button type="button" class="warn-btn" data-action="revise">差し戻す</button>
        </div>
      </form>

      <form id="form-comment" class="action-form">
        <strong>コメント追加（statusは変更しない）</strong>
        <label class="form-label">text（必須）</label>
        <textarea name="text" placeholder="コメント内容"></textarea>
        <div class="action-panel">
          <button type="button" class="secondary" data-action="comment">コメントを追加</button>
        </div>
      </form>

      <form id="form-fix" class="action-form">
        <strong>修正指示のみ追加（statusは変更しない）</strong>
        <label class="form-label">description（必須）</label>
        <textarea name="description" placeholder="修正指示の内容"></textarea>
        <div class="action-panel">
          <button type="button" class="secondary" data-action="fix">修正指示を追加</button>
        </div>
      </form>
    </div>
  `;

  wireActions(id);
}

function wireActions(id) {
  const publishBtn = document.getElementById("btn-publish");
  if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
      try {
        await AdminApi.publish(id);
        showToast("website/aorへ公開しました");
        render();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const unpublishBtn = document.getElementById("btn-unpublish");
  if (unpublishBtn) {
    unpublishBtn.addEventListener("click", async () => {
      try {
        await AdminApi.unpublish(id);
        showToast("website/aorへの公開を取り消しました");
        render();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const approveForm = document.getElementById("form-approve");
  approveForm.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const comment = approveForm.comment.value.trim();
      const fixesRaw = approveForm.fixes.value.trim();

      const action = btn.dataset.action;
      try {
        if (action === "approve") await AdminApi.approve(id, { comment });
        else if (action === "reject") await AdminApi.reject(id, { comment });
        else if (action === "revise")
          await AdminApi.revise(id, { comment, fixes: fixesRaw ? fixesRaw.split("\n").filter(Boolean) : [] });
        showToast(`${action} しました`);
        render();
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  const commentForm = document.getElementById("form-comment");
  commentForm.querySelector('button[data-action="comment"]').addEventListener("click", async () => {
    const text = commentForm.text.value.trim();
    if (!text) return showToast("textを入力してください", true);
    try {
      await AdminApi.comment(id, { text });
      showToast("コメントを追加しました");
      render();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  const fixForm = document.getElementById("form-fix");
  fixForm.querySelector('button[data-action="fix"]').addEventListener("click", async () => {
    const description = fixForm.description.value.trim();
    if (!description) return showToast("descriptionを入力してください", true);
    try {
      await AdminApi.fix(id, { description });
      showToast("修正指示を追加しました");
      render();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

render();
