/**
 * deliveries.js — AOR Admin v2 Deliveries 画面（Phase52 STEP6）。
 *
 * GET /api/deliveries（website/aor-admin/server.js の handleDeliveries）を取得し、
 *   - Delivery Overview（summary。Dashboard と共通の集計値をそのまま表示）
 *   - Delivery List（1行=1配信イベント。at / email / type / provider / outcome / status / approval）
 *   - 検索（email / lead_id / company）・フィルタ（type / provider / outcome / approval）
 *   - 行クリックで詳細（identity / delivery / event metadata / その Lead の配信タイムライン）
 * を表示する。
 *
 * 【設計方針】dashboard.js / leads.js と同じ「HTML 文字列を組み立てて innerHTML に流す」方式。
 * 値はすべて esc() を通す。UI 側で再集計・状態の再判定はしない
 * （type / provider / outcome / status は Backend が返す値をそのまま表示。
 * summary は collectDeliverySummary の値をそのまま。タイムラインは返却済みの行を
 * lead_id でグループ化して時系列に並べるだけ）。
 * 破壊的操作・送信操作は一切持たない（確認・検索・filter・detail のみ）。
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  var TYPE_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "initial", label: "Initial" },
    { key: "weekly", label: "Weekly" },
  ];
  var PROVIDER_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "ses", label: "SES" },
    { key: "blastengine", label: "blastengine" },
  ];
  var OUTCOME_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "queued", label: "Queued" },
    { key: "sent", label: "Sent" },
    { key: "delivered", label: "Delivered" },
    { key: "opened", label: "Opened" },
    { key: "clicked", label: "Clicked" },
    { key: "bounced", label: "Bounced" },
    { key: "complaint", label: "Complaint" },
    { key: "failed", label: "Failed" },
  ];
  var APPROVAL_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "pending", label: "pending" },
    { key: "approved", label: "approved" },
    { key: "rejected", label: "rejected" },
  ];

  // outcome → status-pill の色クラス（admin.css の既存クラスを再利用）
  var OUTCOME_CLASS = {
    delivered: "status-approved",
    opened: "status-approved",
    clicked: "status-approved",
    sent: "status-pending",
    queued: "status-pending",
    bounced: "status-rejected",
    complaint: "status-rejected",
    failed: "status-rejected",
  };

  // -------------------------------------------------------------------------
  // 純粋関数（レンダリング・フィルタ）
  // -------------------------------------------------------------------------

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** ISO 文字列 → "YYYY-MM-DD HH:mm:ss"（ローカル）。無効値は素通し、null は — 。 */
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
    return !!v && typeof v === "object" && v.status === "error";
  }

  /** SES=blue / blastengine=orange（admin.css の .provider-* / --accent / --warn）。 */
  function providerBadge(provider) {
    if (provider === "ses") return '<span class="delivery-provider provider-ses">SES</span>';
    if (provider === "blastengine") return '<span class="delivery-provider provider-blastengine">blastengine</span>';
    return '<span class="delivery-provider provider-unknown">' + esc(provider || "—") + "</span>";
  }

  function typeLabel(type) {
    if (type === "initial") return "Initial Report";
    if (type === "weekly") return "Weekly Report";
    return "—";
  }

  function outcomeBadge(outcome) {
    var cls = OUTCOME_CLASS[outcome] || "status-pending";
    return '<span class="status-pill ' + cls + '">' + esc(outcome || "—") + "</span>";
  }

  function approvalBadge(approvalStatus) {
    if (!approvalStatus) return '<span class="status-pill status-pending">—（未設定）</span>';
    var cls =
      approvalStatus === "approved" ? "status-approved" : approvalStatus === "rejected" ? "status-rejected" : "status-pending";
    return '<span class="status-pill ' + cls + '">' + esc(approvalStatus) + "</span>";
  }

  function deliveryStatusBadge(deliveryStatus) {
    var s = deliveryStatus || "—";
    var cls =
      s === "active" ? "status-approved" : s === "unsubscribed" ? "status-cancelled" : s === "bounced" || s === "suppressed" ? "status-rejected" : "status-pending";
    return '<span class="status-pill ' + cls + '">' + esc(s) + "</span>";
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

  /** Delivery Overview（Backend の collectDeliverySummary 値をそのまま表示）。 */
  function renderOverview(summary) {
    if (isSectionError(summary)) {
      return '<div class="dash-section-error">⚠ Delivery Summary の取得に失敗しました<span class="dash-error-msg">' + esc(summary.message || "") + "</span></div>";
    }
    var s = summary || {};
    var l24 = s.last_24h || {};
    return (
      metricGrid([
        { label: "Initial Sent", value: num(s.initial_sent) },
        { label: "Initial Failed", value: num(s.initial_failed), tone: s.initial_failed > 0 ? "bad" : undefined },
        { label: "Weekly Sent", value: num(s.weekly_sent) },
        { label: "Weekly Failed", value: num(s.weekly_failed), tone: s.weekly_failed > 0 ? "bad" : undefined },
        { label: "Delivered", value: num(s.delivered), tone: "ok" },
        { label: "Bounced", value: num(s.bounced), tone: s.bounced > 0 ? "bad" : undefined },
        { label: "Complaints", value: num(s.complaints), tone: s.complaints > 0 ? "bad" : undefined },
      ]) +
      "<h3>Last 24 Hours</h3>" +
      metricGrid([
        { label: "Delivered", value: num(l24.delivered), tone: "ok" },
        { label: "Bounced", value: num(l24.bounced), tone: l24.bounced > 0 ? "bad" : undefined },
        { label: "Complaints", value: num(l24.complaints), tone: l24.complaints > 0 ? "bad" : undefined },
      ])
    );
  }

  function num(v) {
    return v === null || v === undefined ? "—" : v;
  }

  function matchesSearch(row, q) {
    var query = String(q || "").trim().toLowerCase();
    if (!query) return true;
    var hay = [row.email, row.lead_id, row.company_slug, row.company_url]
      .map(function (x) {
        return String(x == null ? "" : x).toLowerCase();
      })
      .join(" ");
    return hay.indexOf(query) !== -1;
  }

  function matchesFilters(row, f) {
    f = f || {};
    if (f.type && f.type !== "all" && (row.type || "") !== f.type) return false;
    if (f.provider && f.provider !== "all" && (row.provider || "") !== f.provider) return false;
    if (f.outcome && f.outcome !== "all" && (row.outcome || "") !== f.outcome) return false;
    if (f.approval && f.approval !== "all" && (row.delivery_approval_status || "") !== f.approval) return false;
    return true;
  }

  function rowKey(row) {
    return (row.lead_id || "") + "|" + (row.event || "") + "|" + (row.at || "");
  }

  function deliveryRow(row) {
    var key = esc(rowKey(row));
    return (
      '<tr class="row-link" data-delivery-row="' +
      key +
      '">' +
      "<td>" +
      esc(fmtDateTime(row.at)) +
      "</td>" +
      "<td>" +
      esc(row.email) +
      "</td>" +
      "<td>" +
      esc(typeLabel(row.type)) +
      "</td>" +
      "<td>" +
      providerBadge(row.provider) +
      "</td>" +
      "<td>" +
      outcomeBadge(row.outcome) +
      "</td>" +
      "<td>" +
      deliveryStatusBadge(row.delivery_status) +
      "</td>" +
      "<td>" +
      approvalBadge(row.delivery_approval_status) +
      "</td>" +
      "</tr>"
    );
  }

  function fieldRow(label, valueHtml) {
    return '<div class="field"><div class="label">' + esc(label) + '</div><div class="value">' + valueHtml + "</div></div>";
  }

  function metadataTable(md) {
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

  /** その Lead の配信イベントを時系列（古い順）に並べる。allRows は API 返却済みの全行。 */
  function leadTimeline(row, allRows) {
    var mine = (Array.isArray(allRows) ? allRows : [])
      .filter(function (r) {
        return r.lead_id === row.lead_id;
      })
      .slice()
      .sort(function (a, b) {
        return (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0);
      });
    if (!mine.length) return '<div class="empty-state">配信履歴なし</div>';
    return mine
      .map(function (r) {
        return (
          '<div class="history-entry"><strong>' +
          esc(r.event) +
          "</strong> <span class=\"meta\">" +
          esc(fmtDateTime(r.at)) +
          " · " +
          esc(typeLabel(r.type)) +
          " · " +
          esc(r.provider || "—") +
          "</span></div>"
        );
      })
      .join("");
  }

  function detailHtml(row, allRows) {
    return (
      '<div class="card delivery-detail">' +
      "<h3>Identity</h3>" +
      '<div class="field-row">' +
      fieldRow("email", esc(row.email)) +
      fieldRow("lead_id", "<code>" + esc(row.lead_id) + "</code>") +
      fieldRow("company_slug", esc(row.company_slug || "—")) +
      fieldRow("company_url", esc(row.company_url || "—")) +
      "</div>" +
      "<h3>Delivery</h3>" +
      '<div class="field-row">' +
      fieldRow("type", esc(typeLabel(row.type))) +
      fieldRow("provider", providerBadge(row.provider)) +
      fieldRow("outcome", outcomeBadge(row.outcome)) +
      fieldRow("delivery_status", deliveryStatusBadge(row.delivery_status)) +
      fieldRow("delivery_approval_status", approvalBadge(row.delivery_approval_status)) +
      "</div>" +
      "<h3>Event</h3>" +
      '<div class="field-row">' +
      fieldRow("event", esc(row.event)) +
      fieldRow("at", esc(row.at || "—")) +
      fieldRow("at (local)", esc(fmtDateTime(row.at))) +
      "</div>" +
      '<div class="delivery-metadata">' +
      metadataTable(row.metadata) +
      "</div>" +
      "<h3>この Lead の配信タイムライン</h3>" +
      '<div class="delivery-timeline">' +
      leadTimeline(row, allRows) +
      "</div>" +
      "</div>"
    );
  }

  /**
   * テーブル領域（一覧 + 空状態）の HTML を組み立てる純粋関数。
   * @param {Object[]} deliveries 全配信行（サーバー順 = at 降順）
   * @param {Object} view {search, type, provider, outcome, approval, expandedKey}
   * @returns {{html:string, shown:number, total:number}}
   */
  function renderTableRegion(deliveries, view) {
    var v = view || {};
    var all = Array.isArray(deliveries) ? deliveries : [];
    var visible = all.filter(function (r) {
      return matchesSearch(r, v.search) && matchesFilters(r, v);
    });

    if (!all.length) {
      return { html: '<div class="empty-state">配信履歴がありません。</div>', shown: 0, total: 0 };
    }
    if (!visible.length) {
      return { html: '<div class="empty-state">条件に一致する配信はありません。</div>', shown: 0, total: all.length };
    }

    var body = visible
      .map(function (r) {
        var tr = deliveryRow(r);
        if (v.expandedKey && rowKey(r) === v.expandedKey) {
          tr += '<tr class="delivery-detail-row"><td colspan="7">' + detailHtml(r, all) + "</td></tr>";
        }
        return tr;
      })
      .join("");

    var html =
      "<table><thead><tr>" +
      "<th>日時</th><th>email</th><th>type</th><th>provider</th><th>outcome</th><th>delivery_status</th><th>approval</th>" +
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
      '<input type="text" id="deliveries-search" placeholder="email / lead_id / company で検索" value="' +
      esc(v.search || "") +
      '" />' +
      '<button type="button" class="secondary" data-refresh="1">更新</button>' +
      '<span id="deliveries-count" class="leads-count"></span>' +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Type</span>' +
      filterButtons("data-type", TYPE_FILTERS, v.type) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Provider</span>' +
      filterButtons("data-provider", PROVIDER_FILTERS, v.provider) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Outcome</span>' +
      filterButtons("data-outcome", OUTCOME_FILTERS, v.outcome) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Approval</span>' +
      filterButtons("data-approval", APPROVAL_FILTERS, v.approval) +
      "</div>" +
      "</div>" +
      '<div class="dash-table-wrap" id="deliveries-table-region"></div>'
    );
  }

  function countText(shown, total) {
    if (!total) return "0 件";
    if (shown === total) return total + " 件";
    return shown + " / " + total + " 件表示";
  }

  /** 画面全体（Overview + Controls + Region の枠）。Region は別途 renderTableRegion で埋める。 */
  function renderPage(payload, view) {
    var summary = payload && payload.summary;
    return (
      '<section class="card"><h2>Delivery Overview</h2>' +
      renderOverview(summary) +
      "</section>" +
      '<section class="card"><h2>Delivery List</h2>' +
      renderControls(view) +
      "</section>"
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側
  // -------------------------------------------------------------------------

  var currentDeliveries = [];
  var view = { search: "", type: "all", provider: "all", outcome: "all", approval: "all", expandedKey: null };

  function $(id) {
    return document.getElementById(id);
  }

  function renderRegion() {
    var region = $("deliveries-table-region");
    if (!region) return;
    var r = renderTableRegion(currentDeliveries, view);
    region.innerHTML = r.html;
    var count = $("deliveries-count");
    if (count) count.textContent = countText(r.shown, r.total);
    wireRowActions(region);
  }

  function refreshFilterButtons() {
    ["type", "provider", "outcome", "approval"].forEach(function (g) {
      document.querySelectorAll("button[data-" + g + "]").forEach(function (btn) {
        btn.className = btn.dataset[g] === view[g] ? "" : "secondary";
      });
    });
  }

  function wireControls() {
    var search = $("deliveries-search");
    if (search) {
      search.addEventListener("input", function () {
        view.search = search.value;
        renderRegion();
      });
    }
    var refresh = document.querySelector("button[data-refresh]");
    if (refresh) refresh.addEventListener("click", load);

    ["type", "provider", "outcome", "approval"].forEach(function (g) {
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
    (scope || document).querySelectorAll("tr[data-delivery-row]").forEach(function (rowEl) {
      rowEl.addEventListener("click", function () {
        var key = rowEl.dataset.deliveryRow;
        view.expandedKey = view.expandedKey === key ? null : key;
        renderRegion();
      });
    });
  }

  async function load() {
    var container = $("deliveries-container");
    if (!container) return;
    var btn = $("deliveries-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="empty-state">読み込み中…</div>';

    var payload;
    try {
      payload = await AdminApi.getDeliveries();
    } catch (err) {
      if (/認証/.test(err.message)) {
        container.innerHTML = '<div class="empty-state">セッションの有効期限が切れています。<a href="/deliveries.html">再読み込み</a>してください。</div>';
      } else {
        container.innerHTML = '<div class="empty-state">配信情報を読み込めませんでした: ' + esc(err.message) + "</div>";
      }
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    currentDeliveries = Array.isArray(payload.deliveries) ? payload.deliveries : [];
    container.innerHTML = renderPage(payload, view);
    wireControls();
    renderRegion();
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
    var btn = $("deliveries-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      fmtDateTime: fmtDateTime,
      isSectionError: isSectionError,
      providerBadge: providerBadge,
      typeLabel: typeLabel,
      outcomeBadge: outcomeBadge,
      approvalBadge: approvalBadge,
      deliveryStatusBadge: deliveryStatusBadge,
      renderOverview: renderOverview,
      matchesSearch: matchesSearch,
      matchesFilters: matchesFilters,
      rowKey: rowKey,
      deliveryRow: deliveryRow,
      metadataTable: metadataTable,
      leadTimeline: leadTimeline,
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
