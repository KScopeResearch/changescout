/**
 * dashboard.js — AOR Admin v2 Dashboard 画面（Phase52 STEP4）。
 *
 * Phase52 STEP3 で実装した read-only 集計 API を GET して表示するだけ。書き込み API は
 * 一切呼ばない。UI 側で再集計しない（deploy_pending 等は API の値をそのまま使う）。
 *
 * 【設計】list.js / detail.js と同じ「HTML 文字列を組み立てて innerHTML に流す」方式。
 * レンダリング関数はすべて純粋関数（API の JSON → HTML 文字列）にして、Node からも
 * ユニットテストできるよう module.exports へも公開する（ブラウザでは無視される）。
 *
 * 使う API:
 *   GET /api/dashboard         … lead_summary / delivery_summary / suppression_summary
 *   GET /api/dashboard/reports … Report 公開状態（generated/approved/published_backend/web_deployed/deploy_pending/pending_slugs）
 *   GET /api/dashboard/health  … SES / Lambda / CloudFront / blastengine
 */

(function () {
  "use strict";

  // Phase52 STEP8: Report status 判定は report-status.js（共通ユーティリティ）へ一本化した。
  // ブラウザでは dashboard.html が report-status.js を先に読み込む → window.ReportStatus。
  const ReportStatus =
    typeof module !== "undefined" && module.exports
      ? require("./report-status")
      : (typeof window !== "undefined" && window.ReportStatus) || null;

  // -------------------------------------------------------------------------
  // 純粋関数（レンダリング）
  // -------------------------------------------------------------------------

  /** @param {string} s @returns {string} */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** @param {string|null|undefined} iso @returns {string} "YYYY-MM-DD HH:mm:ss"（ローカル） */
  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** セクションが {status:"error"} 形状か（report-status.js に一本化）。 */
  function isSectionError(v) {
    return ReportStatus.isSectionError(v);
  }

  /** @param {string} title @param {*} section @returns {string} エラー時の HTML（そうでなければ ""） */
  function sectionErrorHtml(title, section) {
    if (!isSectionError(section)) return "";
    return `<div class="dash-section-error">⚠ ${esc(title)} の取得に失敗しました<span class="dash-error-msg">${esc(section.message || "")}</span></div>`;
  }

  /**
   * メトリクスのグリッド（label / value / tone）。
   * @param {Array<{label:string, value:(string|number), tone?:string}>} metrics
   * @returns {string}
   */
  function metricGrid(metrics) {
    return (
      `<div class="dash-metrics">` +
      metrics
        .map(
          (m) =>
            `<div class="dash-metric${m.tone ? " tone-" + esc(m.tone) : ""}">` +
            `<div class="dash-metric-value">${esc(m.value)}</div>` +
            `<div class="dash-metric-label">${esc(m.label)}</div>` +
            `</div>`
        )
        .join("") +
      `</div>`
    );
  }

  /** @param {Object} v key/value のフィールド行。 */
  function fieldRows(pairs) {
    return (
      `<div class="field-row">` +
      pairs
        .map(
          (p) =>
            `<div class="field"><div class="label">${esc(p.label)}</div>` +
            `<div class="value${p.tone ? " tone-" + esc(p.tone) : ""}">${p.html ? p.html : esc(p.value)}</div></div>`
        )
        .join("") +
      `</div>`
    );
  }

  /** 真偽値を ● / ○ + ラベルで表示。 */
  function boolPill(value, okLabel, ngLabel) {
    const ok = value === true;
    return `<span class="dash-bool ${ok ? "tone-ok" : "tone-bad"}">${ok ? "●" : "○"} ${esc(ok ? okLabel || "yes" : ngLabel || "no")}</span>`;
  }

  function renderLeadSummary(data) {
    if (isSectionError(data)) return sectionErrorHtml("Lead Summary", data);
    return metricGrid([
      { label: "Total Leads", value: data.total },
      { label: "Active", value: data.active, tone: "ok" },
      { label: "Unsubscribed", value: data.unsubscribed, tone: data.unsubscribed > 0 ? "dim" : undefined },
      { label: "Bounced", value: data.bounced, tone: data.bounced > 0 ? "bad" : undefined },
      { label: "Suppressed", value: data.suppressed, tone: data.suppressed > 0 ? "bad" : undefined },
      { label: "Pending Approval", value: data.pending_approval, tone: data.pending_approval > 0 ? "warn" : undefined },
    ]);
  }

  function renderDeliverySummary(data) {
    if (isSectionError(data)) return sectionErrorHtml("Delivery Summary", data);
    const l24 = data.last_24h || { delivered: 0, bounced: 0, complaints: 0 };
    return (
      metricGrid([
        { label: "Initial Sent", value: data.initial_sent },
        { label: "Initial Failed", value: data.initial_failed, tone: data.initial_failed > 0 ? "bad" : undefined },
        { label: "Weekly Sent", value: data.weekly_sent },
        { label: "Weekly Failed", value: data.weekly_failed, tone: data.weekly_failed > 0 ? "bad" : undefined },
        { label: "Delivered", value: data.delivered, tone: "ok" },
        { label: "Bounced", value: data.bounced, tone: data.bounced > 0 ? "bad" : undefined },
        { label: "Complaints", value: data.complaints, tone: data.complaints > 0 ? "bad" : undefined },
        { label: "Paid Requested", value: data.paid_requested },
      ]) +
      `<h3>Last 24 Hours</h3>` +
      metricGrid([
        { label: "Delivered", value: l24.delivered, tone: "ok" },
        { label: "Bounced", value: l24.bounced, tone: l24.bounced > 0 ? "bad" : undefined },
        { label: "Complaints", value: l24.complaints, tone: l24.complaints > 0 ? "bad" : undefined },
      ])
    );
  }

  function renderSuppressionSummary(data) {
    if (isSectionError(data)) return sectionErrorHtml("Suppression Summary", data);
    return metricGrid([
      { label: "Unsubscribe", value: data.unsubscribe },
      { label: "Bounce", value: data.bounce },
      { label: "Complaint", value: data.complaint },
      { label: "Hard Error", value: data.harderror },
      { label: "Drop", value: data.drop },
      { label: "Manual", value: data.manual },
    ]);
  }

  /** deploy_pending 件数の表示トーン（report-status.js に一本化）。 */
  function deployPendingTone(n) {
    return ReportStatus.deployPendingTone(n);
  }

  function renderReportSummary(data) {
    if (isSectionError(data)) return sectionErrorHtml("Report Summary", data);
    const webVal = data.web_deployed === null || data.web_deployed === undefined ? "—" : data.web_deployed;
    const pendVal = data.deploy_pending === null || data.deploy_pending === undefined ? "—" : data.deploy_pending;
    let html = metricGrid([
      { label: "Generated", value: data.generated },
      { label: "Approved", value: data.approved },
      { label: "Published (Backend)", value: data.published_backend },
      { label: "Web Deployed", value: webVal },
      { label: "Deploy Pending", value: pendVal, tone: deployPendingTone(data.deploy_pending) },
    ]);

    if (data.deploy_pending && data.deploy_pending > 0) {
      const slugs = Array.isArray(data.pending_slugs) ? data.pending_slugs : [];
      html +=
        `<div class="dash-alert tone-warn">` +
        `<strong>⚠ Web 未反映のレポートが ${esc(data.deploy_pending)} 件あります。</strong>` +
        ` backend には公開済みですが CloudFront 配信元にデプロイされていません。` +
        (slugs.length
          ? `<ul class="plain-list">` + slugs.map((s) => `<li>${esc(s)}</li>`).join("") + `</ul>`
          : ` (slug 一覧は取得できませんでした)`) +
        `</div>`;
    }
    if (data.web_deployed_note) {
      html += `<div class="dash-note">Web Deployed 情報: ${esc(data.web_deployed_note)}</div>`;
    }
    return html;
  }

  function renderSesHealth(ses) {
    if (isSectionError(ses)) return sectionErrorHtml("SES", ses);
    const acctErr = isSectionError(ses.account) ? ` <span class="dash-inline-err">(account: ${esc(ses.account.message)})</span>` : "";
    const enfTone = ses.enforcement_status === "HEALTHY" ? "ok" : ses.enforcement_status ? "bad" : "dim";
    const dkimTone = ses.dkim_status === "SUCCESS" ? "ok" : ses.dkim_status ? "warn" : "dim";
    return (
      `<h3>SES${acctErr}</h3>` +
      fieldRows([
        { label: "Production Access", value: ses.production_access_enabled === true ? "GRANTED" : ses.review_status || "—", tone: ses.production_access_enabled ? "ok" : "warn" },
        { label: "Sending", value: ses.sending_enabled === true ? "Enabled" : "Disabled", tone: ses.sending_enabled ? "ok" : "bad" },
        { label: "Enforcement", value: ses.enforcement_status || "—", tone: enfTone },
        { label: "24h Send", value: ses.sent_last_24_hours == null ? "—" : ses.sent_last_24_hours },
        { label: "24h Quota", value: ses.max_24_hour_send == null ? "—" : ses.max_24_hour_send },
        { label: "Send Rate", value: ses.max_send_rate == null ? "—" : `${ses.max_send_rate}/s` },
        { label: "DKIM", value: ses.dkim_status || "—", tone: dkimTone },
        { label: "Configuration Set", value: ses.configuration_set || "—" },
      ])
    );
  }

  function renderLambdaHealth(lambda) {
    if (isSectionError(lambda)) return sectionErrorHtml("Lambda", lambda);
    const fns = Array.isArray(lambda.functions) ? lambda.functions : [];
    const rows = fns
      .map((f) => {
        if (isSectionError(f)) {
          return `<tr><td>${esc(f.name)}</td><td colspan="3" class="tone-bad">取得失敗: ${esc(f.message)}</td></tr>`;
        }
        const stateTone = f.state === "Active" ? "ok" : "bad";
        return (
          `<tr><td>${esc(f.name)}</td>` +
          `<td>${esc(f.runtime || "—")}</td>` +
          `<td class="tone-${stateTone}">${esc(f.state || "—")}</td>` +
          `<td>${esc(fmtDateTime(f.last_modified))}</td></tr>`
        );
      })
      .join("");
    return (
      `<h3>Lambda</h3>` +
      `<div class="dash-table-wrap"><table class="dash-table">` +
      `<thead><tr><th>Name</th><th>Runtime</th><th>State</th><th>Last Modified</th></tr></thead>` +
      `<tbody>${rows || `<tr><td colspan="4" class="empty-state">関数なし</td></tr>`}</tbody></table></div>`
    );
  }

  function renderCloudFrontHealth(cf) {
    if (isSectionError(cf)) return sectionErrorHtml("CloudFront", cf);
    const li = cf.last_invalidation;
    let invText = "—";
    if (isSectionError(li)) invText = `取得失敗: ${esc(li.message)}`;
    else if (li) invText = `${esc(li.id)} / ${esc(li.status)} / ${esc(fmtDateTime(li.create_time))}`;
    return (
      `<h3>CloudFront</h3>` +
      fieldRows([
        { label: "Distribution", value: cf.distribution_id || "—" },
        { label: "Status", value: cf.status || "—", tone: cf.status === "Deployed" ? "ok" : "warn" },
        { label: "Domain", value: cf.domain_name || "—" },
        { label: "Web Bucket", value: cf.web_bucket || "—" },
        { label: "Last Invalidation", value: invText },
      ])
    );
  }

  function renderBlastengineHealth(be) {
    if (isSectionError(be)) return sectionErrorHtml("blastengine", be);
    return (
      `<h3>blastengine</h3>` +
      fieldRows([
        { label: "Enabled", html: boolPill(be.enabled, "enabled", "disabled") },
        { label: "Webhook Endpoint", html: boolPill(be.webhook_endpoint_exists, "exists", "missing") },
        { label: "Webhook Credentials", html: boolPill(be.webhook_credentials_configured, "configured", "missing") },
        { label: "API Credentials", html: boolPill(be.credentials_configured, "configured", "missing") },
      ]) +
      (be.spec_document ? `<div class="dash-note">外部仕様の正本: <code>${esc(be.spec_document)}</code></div>` : "")
    );
  }

  /**
   * Dashboard 全体の HTML を組み立てる（純粋関数）。
   * @param {{summary:Object, reports:Object, health:Object}} payload
   *   - summary: GET /api/dashboard の結果（または {status:"error"}）
   *   - reports: GET /api/dashboard/reports の結果
   *   - health:  GET /api/dashboard/health の結果
   * @returns {string}
   */
  function renderDashboard(payload) {
    const summary = payload.summary || {};
    const reports = payload.reports || {};
    const health = payload.health || {};

    const summaryErr = isSectionError(summary);
    const lead = summaryErr ? summary : summary.lead_summary;
    const delivery = summaryErr ? summary : summary.delivery_summary;
    const suppression = summaryErr ? summary : summary.suppression_summary;

    const healthErr = isSectionError(health);
    const ses = healthErr ? health : health.ses;
    const lambda = healthErr ? health : health.lambda;
    const cloudfront = healthErr ? health : health.cloudfront;
    const blastengine = healthErr ? health : health.blastengine;

    const updatedAt =
      (!summaryErr && summary.generated_at) ||
      (!isSectionError(reports) && reports.generated_at) ||
      (!healthErr && health.generated_at) ||
      null;

    return (
      `<div class="dash-overview">` +
      `<div class="dash-updated">Last updated: <strong>${esc(fmtDateTime(updatedAt))}</strong>` +
      (updatedAt ? "" : ` <span class="dash-inline-err">(API 未取得)</span>`) +
      `</div>` +
      `</div>` +
      `<section class="card"><h2>Lead Summary</h2>${renderLeadSummary(lead)}</section>` +
      `<section class="card"><h2>Delivery Summary</h2>${renderDeliverySummary(delivery)}</section>` +
      `<section class="card"><h2>Suppression Summary</h2>${renderSuppressionSummary(suppression)}</section>` +
      `<section class="card"><h2>Report Summary</h2>${renderReportSummary(reports)}</section>` +
      `<section class="card"><h2>System Health</h2>` +
      renderSesHealth(ses) +
      renderLambdaHealth(lambda) +
      renderCloudFrontHealth(cloudfront) +
      renderBlastengineHealth(blastengine) +
      `</section>`
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側（fetch → render → refresh）
  // -------------------------------------------------------------------------

  async function load() {
    const container = document.getElementById("dashboard-container");
    if (!container) return;
    const btn = document.getElementById("dash-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.innerHTML = `<div class="empty-state">Loading dashboard…</div>`;

    // 3 API を並行取得。1 つ失敗しても他は表示する（Promise.allSettled）。
    const [summaryR, reportsR, healthR] = await Promise.allSettled([
      AdminApi.getDashboard(),
      AdminApi.getDashboardReports(),
      AdminApi.getDashboardHealth(),
    ]);

    const toSection = (r) =>
      r.status === "fulfilled" ? r.value : { status: "error", message: (r.reason && r.reason.message) || String(r.reason) };

    // 認証切れは分かりやすく全体で示す
    const authFailed = [summaryR, reportsR, healthR].some(
      (r) => r.status === "rejected" && /認証/.test((r.reason && r.reason.message) || "")
    );
    if (authFailed) {
      container.innerHTML = `<div class="empty-state">セッションの有効期限が切れています。<a href="/dashboard.html">再読み込み</a>してください。</div>`;
      if (btn) btn.disabled = false;
      container.removeAttribute("aria-busy");
      return;
    }

    container.innerHTML = renderDashboard({
      summary: toSection(summaryR),
      reports: toSection(reportsR),
      health: toSection(healthR),
    });
    container.removeAttribute("aria-busy");
    if (btn) btn.disabled = false;
  }

  async function init() {
    try {
      const session = await AdminApi.getSession();
      const el = document.getElementById("user-label");
      if (el) el.textContent = `${session.username} でログイン中`;
    } catch (e) {
      // 表示上の情報。致命的ではない
    }
    const btn = document.getElementById("dash-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    // Node（テスト）用
    module.exports = {
      fmtDateTime,
      isSectionError,
      metricGrid,
      renderLeadSummary,
      renderDeliverySummary,
      renderSuppressionSummary,
      renderReportSummary,
      renderSesHealth,
      renderLambdaHealth,
      renderCloudFrontHealth,
      renderBlastengineHealth,
      renderDashboard,
      deployPendingTone,
    };
  } else {
    // ブラウザ
    init();
  }
})();
