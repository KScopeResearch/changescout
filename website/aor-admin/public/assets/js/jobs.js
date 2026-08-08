/**
 * jobs.js — Jobs画面（Task16 要件⑦）。
 *
 * Queue/Running/Completed/Failed/Cancelledの一覧と最新履歴を表示し、ジョブの追加・
 * retry・cancelを行える。ロジックはすべてサーバー側（scripts/generator/jobs/job-runner.js）
 * に委譲し、ここでは表示と操作の橋渡しのみを行う。SSE（/api/jobs/events）で自動更新する。
 */

const JOB_TYPE_LABELS = {
  "generate-report": "generate-report（フルパイプライン）",
  "quality-check": "quality-check（品質再評価）",
  "review-sync": "review-sync（ダミー）",
  "search-refresh": "search-refresh（情報収集のみ再実行）",
};

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

function showToast(message, isError) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.borderColor = isError ? "var(--bad)" : "var(--border)";
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 3500);
}

/**
 * Task23: 実行時間表示。完了/失敗済みならstartedAt〜finishedAtの差分、実行中ならstartedAt〜現在の
 * 経過時間を表示する（queuedでまだ開始していないジョブはstartedAtがnullなので"—"）。
 * @param {Object} job
 * @returns {string}
 */
function jobDuration(job) {
  if (!job.startedAt) return "—";
  const end = job.finishedAt ? new Date(job.finishedAt) : new Date();
  const ms = end - new Date(job.startedAt);
  const label = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  return job.status === "running" ? `${label}（実行中）` : label;
}

function jobRow(job) {
  const actions = [];
  if (job.status === "failed") actions.push(`<button type="button" class="secondary" data-retry="${job.id}">retry</button>`);
  if (job.status === "queued" || job.status === "running")
    actions.push(`<button type="button" class="danger" data-cancel="${job.id}">cancel</button>`);

  return `
    <tr>
      <td>${job.id}</td>
      <td>${escapeHtml(job.type)}</td>
      <td>${escapeHtml(JSON.stringify(job.params))}</td>
      <td>${job.attempts}/${job.maxAttempts}</td>
      <td>${jobDuration(job)}</td>
      <td>${fmtDate(job.createdAt)}</td>
      <td>${job.error ? `<span style="color:var(--bad)">${escapeHtml(job.error)}</span>` : "—"}</td>
      <td>${actions.join(" ")}</td>
    </tr>`;
}

function renderColumn(title, statusClass, jobs) {
  const rows = jobs.length
    ? jobs.map(jobRow).join("")
    : `<tr><td colspan="8" class="empty-state">（なし）</td></tr>`;
  return `
    <div class="card">
      <h2><span class="status-pill status-${statusClass}">${title}</span>（${jobs.length}件）</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>id</th><th>type</th><th>params</th><th>attempts</th><th>実行時間</th><th>created_at</th><th>error</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderHistory(history) {
  if (!history.length) return '<div class="empty-state">（履歴なし）</div>';
  return history
    .map((h) => {
      // Task23: status:"interrupted"（起動時復旧、job-runner.js参照）はattempts/duration_msを
      // 記録しない（実行が中断された時点の試行回数・所要時間が意味を持たないため）。
      // その場合は"N回試行・Nms"の代わりに省略表示にする。
      const attemptsAndDuration =
        h.attempts != null && h.duration_ms != null ? `${h.attempts}回試行 ・ ${h.duration_ms}ms` : "（前回のプロセス終了時点で中断）";
      return `
      <div class="history-entry">
        <div class="meta">${fmtDate(h.created_at)} ・ ${escapeHtml(h.job_id)} ・ ${escapeHtml(h.type)} ・
          <span class="status-pill status-${h.status}">${h.status}</span> ・ ${attemptsAndDuration}</div>
        ${h.error ? `<div style="color:var(--bad)">${escapeHtml(h.error)}</div>` : ""}
      </div>`;
    })
    .join("");
}

function renderJobTypeOptions() {
  return Object.keys(JOB_TYPE_LABELS)
    .map((t) => `<option value="${t}">${escapeHtml(JOB_TYPE_LABELS[t])}</option>`)
    .join("");
}

async function render(snapshot) {
  const container = document.getElementById("jobs-container");

  container.innerHTML = `
    <div class="card">
      <h2>ジョブを追加</h2>
      <form id="form-enqueue" class="action-form" style="border-top:none;padding-top:0;margin-top:0;">
        <label class="form-label">type</label>
        <select name="type" id="job-type-select">${renderJobTypeOptions()}</select>
        <label class="form-label">url（generate-report / search-refresh用）</label>
        <input type="text" name="url" placeholder="https://company.jp" />
        <label class="form-label">slug（quality-check / review-sync用。例: example.com）</label>
        <input type="text" name="slug" placeholder="example.com" />
        <div class="action-panel">
          <button type="button" id="btn-enqueue">追加して実行</button>
        </div>
      </form>
    </div>

    ${renderColumn("Queue", "pending_review", snapshot.queued)}
    ${renderColumn("Running", "needs_revision", snapshot.running)}
    ${renderColumn("Completed", "approved", snapshot.completed)}
    ${renderColumn("Failed", "rejected", snapshot.failed)}
    ${snapshot.cancelled.length ? renderColumn("Cancelled", "pending_review", snapshot.cancelled) : ""}

    <div class="card">
      <h2>最新ログ（job-history.jsonl）</h2>
      <div id="history-container"><div class="empty-state">読み込み中…</div></div>
    </div>
  `;

  wireActions();
  loadHistory();
}

async function loadHistory() {
  try {
    const history = await AdminApi.getJobHistory(20);
    document.getElementById("history-container").innerHTML = renderHistory(history);
  } catch (err) {
    document.getElementById("history-container").innerHTML = `<div class="empty-state">読み込み失敗: ${escapeHtml(err.message)}</div>`;
  }
}

function wireActions() {
  document.getElementById("btn-enqueue").addEventListener("click", async () => {
    const form = document.getElementById("form-enqueue");
    const type = form.type.value;
    const url = form.url.value.trim();
    const slug = form.slug.value.trim();
    const params = {};
    if (url) params.url = url;
    if (slug) params.slug = slug;

    try {
      const job = await AdminApi.enqueueJob(type, params);
      showToast(`ジョブを追加しました: ${job.id}`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelectorAll("button[data-retry]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await AdminApi.retryJob(btn.dataset.retry);
        showToast(`retryしました: ${btn.dataset.retry}`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  document.querySelectorAll("button[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await AdminApi.cancelJob(btn.dataset.cancel);
        showToast(`cancelしました: ${btn.dataset.cancel}`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
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
    // 表示上の情報のため失敗しても続行
  }

  try {
    const { snapshot } = await AdminApi.listJobs();
    render(snapshot);
  } catch (err) {
    document.getElementById("jobs-container").innerHTML = `<div class="empty-state">読み込みに失敗しました: ${escapeHtml(err.message)}</div>`;
  }

  const source = AdminApi.subscribeJobEvents((snapshot) => {
    render(snapshot);
    setLiveIndicator(true);
  });
  source.onopen = () => setLiveIndicator(true);
  source.onerror = () => setLiveIndicator(false);
}

init();
