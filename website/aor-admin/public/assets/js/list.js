/**
 * list.js — 一覧画面（Task14 要件①）。
 *
 * publishableのアイコン（○/△/×）は表示上の分類であり、判定値そのものは
 * サーバー側がreview-engine.jsのisPublishable()から返した`publishable`（真偽値）をそのまま使う。
 * ○=publishable true、△=publishable false かつ review_status===needs_revision（対応中）、
 * ×=publishable false かつそれ以外（未着手/却下）。isPublishable()の判定ロジックを
 * ここで再実装することはしない（Task14要件④）。
 */

/** @param {Object} summary - GET /api/reports の1要素 */
function publishableIcon(summary) {
  if (summary.publishable) return { icon: "○", cls: "publishable-true", label: "配信可能" };
  if (summary.review_status === "needs_revision") return { icon: "△", cls: "publishable-partial", label: "対応中" };
  return { icon: "×", cls: "publishable-false", label: "配信不可" };
}

/** @param {string|null} v */
function fmtDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("ja-JP");
  } catch (e) {
    return v;
  }
}

/** @param {string} label @param {string} statusValue */
function statusPill(label, statusValue) {
  return `<span class="status-pill status-${statusValue || "unknown"}">${label || "—"}</span>`;
}

/** @param {Object[]} summaries */
function renderList(summaries) {
  const container = document.getElementById("list-container");

  if (!summaries.length) {
    container.innerHTML = '<div class="empty-state">scripts/generator/output/ にレポートがまだありません。</div>';
    return;
  }

  const rows = summaries
    .map((s) => {
      const pub = publishableIcon(s);
      // Task23: evaluation.status===FAILの行は、一覧をざっと見ただけで気づけるよう背景色を付ける
      // （status-pillの色だけでは行数が多いと見落としやすいため）。
      const rowCls = s.evaluation_status === "FAIL" ? " row-eval-fail" : "";
      return `
        <tr class="row-link${rowCls}" data-id="${s.id}">
          <td>${escapeHtml(s.company_name)}</td>
          <td>${statusPill(s.review_status, s.review_status)}</td>
          <td>${statusPill(s.evaluation_status, s.evaluation_status)}</td>
          <td>${s.evaluation_score != null ? s.evaluation_score : "—"} / 100（${s.evaluation_grade || "—"}）</td>
          <td class="publishable-icon ${pub.cls}" title="${pub.label}">${pub.icon}</td>
          <td class="publishable-icon ${s.published ? "publishable-true" : ""}" title="${s.published ? "公開済み" : "未公開"}">${s.published ? "●" : "—"}</td>
          <td>${escapeHtml(s.reviewer || "—")}</td>
          <td>${fmtDate(s.reviewed_at)}</td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>会社名</th>
          <th>review.status</th>
          <th>evaluation.status</th>
          <th>score / grade</th>
          <th>publishable</th>
          <th>公開</th>
          <th>reviewer</th>
          <th>review日時</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.querySelectorAll("tr.row-link").forEach((tr) => {
    tr.addEventListener("click", () => {
      window.location.href = `/detail.html?company=${encodeURIComponent(tr.dataset.id)}`;
    });
  });
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setLiveIndicator(connected) {
  const dot = document.getElementById("live-indicator");
  const label = document.getElementById("live-label");
  dot.classList.toggle("off", !connected);
  label.textContent = connected ? "自動更新中（SSE）" : "接続なし";
}

async function init() {
  try {
    const session = await AdminApi.getSession();
    document.getElementById("user-label").textContent = `${session.username} でログイン中`;
  } catch (e) {
    // セッション取得に失敗してもリスト表示自体は続行する（表示上の情報のため致命的ではない）
  }

  try {
    const summaries = await AdminApi.listReports();
    renderList(summaries);
  } catch (err) {
    document.getElementById("list-container").innerHTML = `<div class="empty-state">読み込みに失敗しました: ${escapeHtml(err.message)}</div>`;
  }

  // Task14要件⑦: SSEで一覧を自動更新する（WebSocketは使わない）
  const source = AdminApi.subscribeEvents((summaries) => {
    renderList(summaries);
    setLiveIndicator(true);
  });
  source.onopen = () => setLiveIndicator(true);
  source.onerror = () => setLiveIndicator(false);
}

init();
