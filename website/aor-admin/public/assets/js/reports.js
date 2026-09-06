/**
 * reports.js — AOR Admin v2 Reports 画面（Phase52 STEP8）。完全 read-only。
 *
 * 既存 API のみを利用する（新 API は追加していない）：
 *   GET /api/reports          … reportsCache（1社1行のサマリー。review_status / evaluation /
 *                                publishable / published(backend)）
 *   GET /api/dashboard/reports … generated / approved / published_backend / web_deployed /
 *                                deploy_pending / pending_slugs（すべて Backend 算出値）
 *   GET /api/report/:id        … 行を開いたときだけ取得する詳細（report / review / validation）
 *
 * 【設計方針】dashboard.js / leads.js / deliveries.js / suppressions.js と同じ
 * 「HTML 文字列 → innerHTML」方式。値はすべて esc() を通す。
 *   - Report status 判定は report-status.js（Dashboard と共通の唯一の実装）に委譲。
 *   - deploy_pending / pending_slugs は Backend 値をそのまま表示。差集合の再計算はしない。
 *   - Preview / Published URL は API が返さないため、URL を frontend で生成しない（§15）。
 *   - Approve / Reject / Publish / Deploy 等の mutation は一切持たない（閲覧専用）。
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  var ReportStatus =
    typeof module !== "undefined" && module.exports
      ? require("./report-status")
      : (typeof window !== "undefined" && window.ReportStatus) || null;

  var REVIEW_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "pending_review", label: "pending_review" },
    { key: "approved", label: "approved" },
    { key: "needs_revision", label: "needs_revision" },
    { key: "rejected", label: "rejected" },
  ];
  var PUBLISHABLE_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "yes", label: "publishable" },
    { key: "no", label: "not publishable" },
  ];
  var PUBLISHED_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "yes", label: "published" },
    { key: "no", label: "unpublished" },
  ];
  var DEPLOY_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "deployed", label: "deployed" },
    { key: "pending", label: "deploy pending" },
    { key: "unknown", label: "unknown" },
  ];

  // -------------------------------------------------------------------------
  // 純粋関数
  // -------------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function isSectionError(v) {
    return ReportStatus.isSectionError(v);
  }

  function num(v) {
    return v === null || v === undefined ? "—" : v;
  }

  function reviewBadge(status) {
    return '<span class="status-pill ' + ReportStatus.reviewStatusClass(status) + '">' + esc(status || "—") + "</span>";
  }

  function boolPill(value, yes, no) {
    var ok = value === true;
    return '<span class="status-pill ' + (ok ? "status-approved" : "status-pending_review") + '">' + esc(ok ? yes : no) + "</span>";
  }

  function evalPill(status) {
    if (!status) return '<span class="status-pill status-pending_review">—</span>';
    return '<span class="status-pill status-' + esc(status) + '">' + esc(status) + "</span>";
  }

  function deployPill(state) {
    var d = ReportStatus.deployStateLabel(state);
    return '<span class="status-pill ' + (d.tone === "warn" ? "status-rejected" : d.tone === "ok" ? "status-approved" : "status-pending_review") + '">' + esc(d.label) + "</span>";
  }

  function metricGrid(metrics) {
    return (
      '<div class="dash-metrics">' +
      metrics
        .map(function (m) {
          return (
            '<div class="dash-metric' +
            (m.tone ? " tone-" + esc(m.tone) : "") +
            '"><div class="dash-metric-value">' +
            esc(m.value) +
            '</div><div class="dash-metric-label">' +
            esc(m.label) +
            "</div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  /** Overview（GET /api/dashboard/reports の Backend 値をそのまま表示）。 */
  function renderOverview(summary) {
    if (isSectionError(summary)) {
      return '<div class="dash-section-error">⚠ Report Summary の取得に失敗しました<span class="dash-error-msg">' + esc(summary.message || "") + "</span></div>";
    }
    var s = summary || {};
    var webVal = s.web_deployed === null || s.web_deployed === undefined ? "—" : s.web_deployed;
    var pendVal = s.deploy_pending === null || s.deploy_pending === undefined ? "—" : s.deploy_pending;
    var html = metricGrid([
      { label: "Generated", value: num(s.generated) },
      { label: "Approved", value: num(s.approved) },
      { label: "Published (Backend)", value: num(s.published_backend) },
      { label: "Web Deployed", value: webVal },
      { label: "Deploy Pending", value: pendVal, tone: ReportStatus.deployPendingTone(s.deploy_pending) },
    ]);

    if (s.deploy_pending && s.deploy_pending > 0) {
      var slugs = Array.isArray(s.pending_slugs) ? s.pending_slugs : [];
      html +=
        '<div class="dash-alert tone-warn"><strong>⚠ Web 未反映のレポートが ' +
        esc(s.deploy_pending) +
        " 件あります。</strong> backend には公開済みですが CloudFront 配信元へデプロイされていません。" +
        (slugs.length ? '<ul class="plain-list">' + slugs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : " (slug 一覧は取得できませんでした)") +
        "</div>";
    }
    if (s.web_deployed_note) html += '<div class="dash-note">Web Deployed 情報: ' + esc(s.web_deployed_note) + "</div>";
    if (s.published_backend_source) html += '<div class="dash-note">Published (Backend) 情報: ' + esc(s.published_backend_source) + "</div>";
    return html;
  }

  function matchesSearch(rep, q) {
    var query = String(q || "").trim().toLowerCase();
    if (!query) return true;
    var hay = [rep.id, rep.company_name].map(function (x) { return String(x == null ? "" : x).toLowerCase(); }).join(" ");
    return hay.indexOf(query) !== -1;
  }

  function matchesFilters(rep, view, summary) {
    var v = view || {};
    if (v.review && v.review !== "all" && (rep.review_status || "") !== v.review) return false;
    if (v.publishable && v.publishable !== "all") {
      if (v.publishable === "yes" && rep.publishable !== true) return false;
      if (v.publishable === "no" && rep.publishable === true) return false;
    }
    if (v.published && v.published !== "all") {
      if (v.published === "yes" && rep.published !== true) return false;
      if (v.published === "no" && rep.published === true) return false;
    }
    if (v.deploy && v.deploy !== "all") {
      if (deployStateOf(rep, summary) !== v.deploy) return false;
    }
    return true;
  }

  /** Backend の pending_slugs / web_deployed から、この1行の deploy 状態を出す（membership check のみ）。
   *  backend 未公開（published !== true）のレポートは Web デプロイ対象外なので not_published とする。 */
  function deployStateOf(rep, summary) {
    if (rep.published !== true) return "not_published";
    var s = isSectionError(summary) ? {} : summary || {};
    return ReportStatus.reportDeployState(rep.id, s.pending_slugs, s.web_deployed);
  }

  function reportRow(rep, summary) {
    return (
      '<tr class="row-link" data-report-row="' +
      esc(rep.id) +
      '">' +
      "<td>" + esc(rep.company_name || rep.id) + "</td>" +
      "<td>" + esc(rep.id) + "</td>" +
      "<td>" + reviewBadge(rep.review_status) + "</td>" +
      "<td>" + evalPill(rep.evaluation_status) + (rep.evaluation_score != null ? ' <span class="meta">' + esc(rep.evaluation_score) + (rep.evaluation_grade ? "/" + esc(rep.evaluation_grade) : "") + "</span>" : "") + "</td>" +
      "<td>" + boolPill(rep.publishable, "yes", "no") + "</td>" +
      "<td>" + boolPill(rep.published, "published", "—") + "</td>" +
      "<td>" + deployPill(deployStateOf(rep, summary)) + "</td>" +
      "</tr>"
    );
  }

  function fieldRow(label, valueHtml) {
    return '<div class="field"><div class="label">' + esc(label) + '</div><div class="value">' + valueHtml + "</div></div>";
  }

  function metaTable(md) {
    var keys = md && typeof md === "object" ? Object.keys(md) : [];
    if (!keys.length) return '<div class="empty-state">metadata なし</div>';
    return (
      '<table class="dash-table"><tbody>' +
      keys
        .map(function (k) {
          var v = md[k];
          var text = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
          return "<tr><td>" + esc(k) + "</td><td>" + esc(text) + "</td></tr>";
        })
        .join("") +
      "</tbody></table>"
    );
  }

  /**
   * 詳細（GET /api/report/:id の結果）。summaryRow は一覧側の1行、detail は詳細レスポンス。
   * detail が null なら loading、{error} ならエラー表示。
   */
  function detailHtml(summaryRow, detail, summary) {
    if (detail && detail.error) {
      return '<div class="card"><div class="empty-state">詳細を読み込めませんでした: ' + esc(detail.error) + "</div></div>";
    }
    if (!detail) {
      return '<div class="card"><div class="empty-state">詳細を読み込み中…</div></div>';
    }

    var report = detail.report || {};
    var review = detail.review || {};
    var meta = report.meta || {};
    var profile = report.company_profile || {};
    var evaluation = report.evaluation || {};
    var fixes = Array.isArray(review.fixes) ? review.fixes : [];
    var unresolvedFixes = fixes.filter(function (f) { return f && f.resolved === false; }).length;
    var comments = Array.isArray(review.comments) ? review.comments.length : 0;
    var history = Array.isArray(review.history) ? review.history.slice(-5) : [];
    var deployState = deployStateOf(summaryRow, summary);

    return (
      '<div class="card report-detail">' +
      "<h3>Identity</h3>" +
      '<div class="field-row">' +
      fieldRow("report id", "<code>" + esc(detail.id || summaryRow.id) + "</code>") +
      fieldRow("company", esc(profile.name || summaryRow.company_name || "—")) +
      fieldRow("domain", esc(profile.domain || "—")) +
      fieldRow("industry", esc(profile.industry_label || "—")) +
      "</div>" +
      "<h3>Report</h3>" +
      '<div class="field-row">' +
      fieldRow("generated_at", esc(meta.generated_at || "—") + (meta.generated_at ? ' <span class="meta">' + esc(fmtDateTime(meta.generated_at)) + "</span>" : "")) +
      fieldRow("schema_version", esc(meta.schema_version || "—")) +
      fieldRow("pipeline_version", esc(meta.pipeline_version || "—")) +
      fieldRow("evaluation", esc(evaluation.status || "—") + (evaluation.score != null ? " · " + esc(evaluation.score) + (evaluation.grade ? "/" + esc(evaluation.grade) : "") : "")) +
      "</div>" +
      (Array.isArray(evaluation.improvements) && evaluation.improvements.length
        ? '<div class="report-eval-list"><div class="label">evaluation.improvements</div><ul class="plain-list">' + evaluation.improvements.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>"
        : "") +
      "<h3>Review</h3>" +
      '<div class="field-row">' +
      fieldRow("review status", reviewBadge(review.status)) +
      fieldRow("reviewer", esc(review.reviewer || "—")) +
      fieldRow("reviewed_at", esc(review.reviewed_at || "—")) +
      fieldRow("comments", esc(comments)) +
      fieldRow("unresolved fixes", esc(unresolvedFixes) + " / " + esc(fixes.length)) +
      fieldRow("publishable", boolPill(detail.publishable, "yes", "no")) +
      "</div>" +
      (Array.isArray(detail.publishable_reasons) && detail.publishable_reasons.length
        ? '<div class="report-eval-list"><div class="label">publishable_reasons</div><ul class="plain-list">' + detail.publishable_reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>"
        : "") +
      (history.length
        ? '<div class="report-history">' + history.map(function (h) {
            return '<div class="history-entry"><strong>' + esc(h.action || "—") + "</strong> <span class=\"meta\">" + esc(h.at || "") + " · " + esc(h.actor || "—") + (h.to_status ? " · → " + esc(h.to_status) : "") + "</span></div>";
          }).join("") + "</div>"
        : "") +
      "<h3>Publish / Deployment</h3>" +
      '<div class="field-row">' +
      fieldRow("published (backend)", boolPill(detail.published, "published", "—")) +
      fieldRow("web deploy state", deployPill(deployState)) +
      "</div>" +
      (deployState === "pending" ? '<div class="dash-note tone-warn">この slug は Backend の pending_slugs に含まれています（Web 未反映）。</div>' : "") +
      "<h3>Preview / Published URL</h3>" +
      '<div class="dash-note">現行 API（/api/report/:id）は Preview / Published URL を返しません。URL は frontend で生成しません。</div>' +
      "<h3>report.meta</h3>" +
      metaTable(meta) +
      "</div>"
    );
  }

  /**
   * テーブル領域を組み立てる純粋関数。
   * @param {Object[]} reports  GET /api/reports
   * @param {Object} summary    GET /api/dashboard/reports（または {status:"error"}）
   * @param {Object} view       {search, review, publishable, published, deploy, expandedId}
   * @param {Object} detailCache {id: detailResponse|{error}}
   * @returns {{html:string, shown:number, total:number}}
   */
  function renderTableRegion(reports, summary, view, detailCache) {
    var v = view || {};
    var cache = detailCache || {};
    var all = Array.isArray(reports) ? reports : [];
    var visible = all.filter(function (r) {
      return matchesSearch(r, v.search) && matchesFilters(r, v, summary);
    });

    if (!all.length) {
      return { html: '<div class="empty-state">レポートはありません。</div>', shown: 0, total: 0 };
    }
    if (!visible.length) {
      return { html: '<div class="empty-state">条件に一致するレポートはありません。</div>', shown: 0, total: all.length };
    }

    var body = visible
      .map(function (r) {
        var tr = reportRow(r, summary);
        if (v.expandedId && r.id === v.expandedId) {
          tr += '<tr class="report-detail-row"><td colspan="7">' + detailHtml(r, cache[r.id] || null, summary) + "</td></tr>";
        }
        return tr;
      })
      .join("");

    var html =
      "<table><thead><tr>" +
      "<th>company</th><th>slug</th><th>review</th><th>evaluation</th><th>publishable</th><th>published</th><th>web deploy</th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table>";
    return { html: html, shown: visible.length, total: all.length };
  }

  function filterButtons(groupAttr, options, current) {
    return options
      .map(function (o) {
        var active = (current || "all") === o.key;
        return '<button type="button" class="' + (active ? "" : "secondary") + '" ' + groupAttr + '="' + o.key + '">' + esc(o.label) + "</button>";
      })
      .join("");
  }

  function renderControls(view) {
    var v = view || {};
    return (
      '<div class="leads-controls">' +
      '<div class="leads-search-row">' +
      '<input type="text" id="reports-search" placeholder="company / slug で検索" value="' + esc(v.search || "") + '" />' +
      '<button type="button" class="secondary" data-refresh="1">更新</button>' +
      '<span id="reports-count" class="leads-count"></span>' +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Review</span>' + filterButtons("data-review", REVIEW_FILTERS, v.review) + "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Publishable</span>' + filterButtons("data-publishable", PUBLISHABLE_FILTERS, v.publishable) + "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Published</span>' + filterButtons("data-published", PUBLISHED_FILTERS, v.published) + "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Deploy</span>' + filterButtons("data-deploy", DEPLOY_FILTERS, v.deploy) + "</div>" +
      "</div>" +
      '<div class="dash-table-wrap" id="reports-table-region"></div>'
    );
  }

  function countText(shown, total) {
    if (!total) return "0 件";
    if (shown === total) return total + " 件";
    return shown + " / " + total + " 件表示";
  }

  function renderPage(payload, view) {
    return (
      '<section class="card"><h2>Report Summary</h2>' + renderOverview(payload && payload.summary) + "</section>" +
      '<section class="card"><h2>Reports</h2>' + renderControls(view) + "</section>"
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側
  // -------------------------------------------------------------------------

  var currentReports = [];
  var currentSummary = {};
  var detailCache = {};
  var view = { search: "", review: "all", publishable: "all", published: "all", deploy: "all", expandedId: null };

  function $(id) {
    return document.getElementById(id);
  }

  function renderRegion() {
    var region = $("reports-table-region");
    if (!region) return;
    var r = renderTableRegion(currentReports, currentSummary, view, detailCache);
    region.innerHTML = r.html;
    var count = $("reports-count");
    if (count) count.textContent = countText(r.shown, r.total);
    wireRowActions(region);
  }

  function refreshFilterButtons() {
    ["review", "publishable", "published", "deploy"].forEach(function (g) {
      document.querySelectorAll("button[data-" + g + "]").forEach(function (btn) {
        btn.className = btn.dataset[g] === view[g] ? "" : "secondary";
      });
    });
  }

  function wireControls() {
    var search = $("reports-search");
    if (search) {
      search.addEventListener("input", function () {
        view.search = search.value;
        renderRegion();
      });
    }
    var refresh = document.querySelector("button[data-refresh]");
    if (refresh) refresh.addEventListener("click", load);
    ["review", "publishable", "published", "deploy"].forEach(function (g) {
      document.querySelectorAll("button[data-" + g + "]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          view[g] = btn.dataset[g];
          refreshFilterButtons();
          renderRegion();
        });
      });
    });
  }

  function wireRowActions(scope) {
    (scope || document).querySelectorAll("tr[data-report-row]").forEach(function (rowEl) {
      rowEl.addEventListener("click", function () {
        var id = rowEl.dataset.reportRow;
        view.expandedId = view.expandedId === id ? null : id;
        renderRegion();
        if (view.expandedId && !detailCache[id]) loadDetail(id);
      });
    });
  }

  async function loadDetail(id) {
    try {
      detailCache[id] = await AdminApi.getReport(id);
    } catch (err) {
      detailCache[id] = { error: err.message };
    }
    if (view.expandedId === id) renderRegion();
  }

  async function load() {
    var container = $("reports-container");
    if (!container) return;
    var btn = $("reports-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="empty-state">読み込み中…</div>';
    detailCache = {};

    var listR = await Promise.allSettled([AdminApi.listReports(), AdminApi.getDashboardReports()]);
    var authFailed = listR.some(function (r) {
      return r.status === "rejected" && /認証/.test((r.reason && r.reason.message) || "");
    });
    if (authFailed) {
      container.innerHTML = '<div class="empty-state">セッションの有効期限が切れています。<a href="/reports.html">再読み込み</a>してください。</div>';
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }
    if (listR[0].status === "rejected") {
      container.innerHTML = '<div class="empty-state">レポート情報を読み込めませんでした: ' + esc((listR[0].reason && listR[0].reason.message) || String(listR[0].reason)) + "</div>";
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    currentReports = Array.isArray(listR[0].value) ? listR[0].value : [];
    currentSummary = listR[1].status === "fulfilled" ? listR[1].value : { status: "error", message: (listR[1].reason && listR[1].reason.message) || String(listR[1].reason) };

    container.innerHTML = renderPage({ summary: currentSummary }, view);
    wireControls();
    renderRegion();
    if (view.expandedId && !detailCache[view.expandedId]) loadDetail(view.expandedId);
    container.removeAttribute("aria-busy");
    if (btn) btn.disabled = false;
  }

  async function init() {
    try {
      var session = await AdminApi.getSession();
      var el = $("user-label");
      if (el) el.textContent = session.username + " でログイン中";
    } catch (e) {
      // 表示上の情報。致命的ではない
    }
    var btn = $("reports-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      fmtDateTime: fmtDateTime,
      reviewBadge: reviewBadge,
      evalPill: evalPill,
      deployPill: deployPill,
      renderOverview: renderOverview,
      matchesSearch: matchesSearch,
      matchesFilters: matchesFilters,
      deployStateOf: deployStateOf,
      reportRow: reportRow,
      metaTable: metaTable,
      detailHtml: detailHtml,
      renderTableRegion: renderTableRegion,
      renderControls: renderControls,
      renderPage: renderPage,
      countText: countText,
    };
  } else {
    init();
  }
})();
