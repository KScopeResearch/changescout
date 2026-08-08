/**
 * status.js — Task21: GET /api/health をポーリングし、Server Status / Job Runner Status /
 * Last Check Time を画面上部のステータスバーに表示する。
 *
 * /api/healthは認証不要で叩けるエンドポイントだが、Dashboard自体は認証済みでしか
 * 表示されないため、ここではセッションの有無に関わらず単純にfetchするだけでよい
 * （api.jsのAdminApi経由にしない。401時の特別扱いが不要なため）。
 *
 * index.html・jobs.html両方から読み込む共通スクリプト（api.js/list.js/jobs.jsと同様、
 * 重複実装を避けるため1ファイルに集約している）。
 */

const SystemStatus = (() => {
  const POLL_INTERVAL_MS = 15000;

  function pillClass(ok) {
    return ok ? "status-ok" : "status-bad";
  }

  function render(health, error) {
    const serverEl = document.getElementById("status-server");
    const jobsEl = document.getElementById("status-jobs");
    const checkedEl = document.getElementById("status-checked");
    if (!serverEl || !jobsEl || !checkedEl) return;

    if (error) {
      serverEl.textContent = "Server: 応答なし";
      serverEl.className = "status-pill-mini status-bad";
      jobsEl.textContent = "Job Runner: 不明";
      jobsEl.className = "status-pill-mini status-bad";
    } else {
      const serverOk = health.status === "ok";
      serverEl.textContent = `Server: ${serverOk ? "OK" : "Degraded"}`;
      serverEl.className = `status-pill-mini ${pillClass(serverOk)}`;

      const jobsOk = !!(health.checks && health.checks.jobs);
      jobsEl.textContent = `Job Runner: ${jobsOk ? "OK" : "Degraded"}`;
      jobsEl.className = `status-pill-mini ${pillClass(jobsOk)}`;
    }

    checkedEl.textContent = `最終確認: ${new Date().toLocaleTimeString("ja-JP")}`;
  }

  async function poll() {
    try {
      const res = await fetch("/api/health", { credentials: "same-origin" });
      const health = await res.json();
      render(health, false);
    } catch (e) {
      render(null, true);
    }
  }

  function start() {
    if (!document.getElementById("status-server")) return; // ステータスバーが無いページでは何もしない
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }

  return { start };
})();

SystemStatus.start();
