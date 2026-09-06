/**
 * suppressions.js — AOR Admin v2 Suppression 画面（Phase52 STEP7）。
 *
 * GET /api/suppressions（website/aor-admin/server.js の handleSuppressions）を取得し、
 *   - Suppression Summary（Dashboard と共通の集計値をそのまま表示）
 *   - Suppression List（1行=1Lead。email / company / reason / provider / delivery_status /
 *     approval / blocked_at / source_event）
 *   - 検索（email / company / company_slug / lead_id）・フィルタ（reason / provider /
 *     approval / delivery_status）
 *   - 行クリックで詳細（identity / suppression / metadata / suppression タイムライン）
 * を表示する。
 *
 * 【設計方針】dashboard.js / leads.js / deliveries.js と同じ「HTML 文字列 → innerHTML」方式。
 * 値はすべて esc() を通す。UI 側で再集計・状態の再判定はしない
 * （reason / provider / source_event / summary は Backend が返す値をそのまま表示。
 * タイムラインは返却済みの timeline を時系列で並べるだけ）。
 * 送信停止の追加・解除・再送・unsubscribe 実行などの操作は一切持たない（閲覧専用）。
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  var REASON_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "unsubscribe", label: "unsubscribe" },
    { key: "bounce", label: "bounce" },
    { key: "complaint", label: "complaint" },
    { key: "harderror", label: "harderror" },
    { key: "drop", label: "drop" },
    { key: "manual", label: "manual" },
  ];
  var PROVIDER_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "ses", label: "SES" },
    { key: "blastengine", label: "blastengine" },
    { key: "user", label: "User" },
    { key: "manual", label: "Manual" },
  ];
  var APPROVAL_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "pending", label: "pending" },
    { key: "approved", label: "approved" },
    { key: "rejected", label: "rejected" },
  ];
  var DELIVERY_STATUS_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "active", label: "active" },
    { key: "unsubscribed", label: "unsubscribed" },
    { key: "bounced", label: "bounced" },
    { key: "suppressed", label: "suppressed" },
  ];

  var REASON_CLASS = {
    unsubscribe: "status-cancelled",
    bounce: "status-rejected",
    complaint: "status-rejected",
    harderror: "status-rejected",
    drop: "status-needs_revision",
    manual: "status-pending",
  };

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
    return !!v && typeof v === "object" && v.status === "error";
  }

  function num(v) {
    return v === null || v === undefined ? "—" : v;
  }

  function reasonBadge(reason) {
    var cls = REASON_CLASS[reason] || "status-pending";
    return '<span class="status-pill ' + cls + '">' + esc(reason || "—") + "</span>";
  }

  /** SES=blue / blastengine=orange / User / Manual / Unknown。判定は Backend、ここは表示のみ。 */
  function providerBadge(provider) {
    var map = { ses: "provider-ses", blastengine: "provider-blastengine", user: "provider-user", manual: "provider-manual" };
    var cls = map[provider] || "provider-unknown";
    var label = provider === "ses" ? "SES" : provider === "blastengine" ? "blastengine" : provider === "user" ? "User" : provider === "manual" ? "Manual" : provider || "—";
    return '<span class="delivery-provider ' + cls + '">' + esc(label) + "</span>";
  }

  function approvalBadge(approvalStatus) {
    if (!approvalStatus) return '<span class="status-pill status-pending">—（未設定）</span>';
    var cls = approvalStatus === "approved" ? "status-approved" : approvalStatus === "rejected" ? "status-rejected" : "status-pending";
    return '<span class="status-pill ' + cls + '">' + esc(approvalStatus) + "</span>";
  }

  function deliveryStatusBadge(deliveryStatus) {
    var s = deliveryStatus || "—";
    var cls = s === "active" ? "status-approved" : s === "unsubscribed" ? "status-cancelled" : s === "bounced" || s === "suppressed" ? "status-rejected" : "status-pending";
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

  /** Suppression Summary（Backend の collectSuppressionSummary + total をそのまま表示）。 */
  function renderSummary(summary) {
    if (isSectionError(summary)) {
      return '<div class="dash-section-error">⚠ Suppression Summary の取得に失敗しました<span class="dash-error-msg">' + esc(summary.message || "") + "</span></div>";
    }
    var s = summary || {};
    return metricGrid([
      { label: "Total", value: num(s.total) },
      { label: "Unsubscribe", value: num(s.unsubscribe) },
      { label: "Bounce", value: num(s.bounce), tone: s.bounce > 0 ? "bad" : undefined },
      { label: "Complaint", value: num(s.complaint), tone: s.complaint > 0 ? "bad" : undefined },
      { label: "Hard Error", value: num(s.harderror), tone: s.harderror > 0 ? "bad" : undefined },
      { label: "Drop", value: num(s.drop), tone: s.drop > 0 ? "warn" : undefined },
      { label: "Manual", value: num(s.manual) },
    ]);
  }

  function matchesSearch(row, q) {
    var query = String(q || "").trim().toLowerCase();
    if (!query) return true;
    var hay = [row.email, row.company_slug, row.company_url, row.lead_id]
      .map(function (x) {
        return String(x == null ? "" : x).toLowerCase();
      })
      .join(" ");
    return hay.indexOf(query) !== -1;
  }

  function matchesFilters(row, f) {
    f = f || {};
    if (f.reason && f.reason !== "all" && (row.reason || "") !== f.reason) return false;
    if (f.provider && f.provider !== "all" && (row.provider || "") !== f.provider) return false;
    if (f.approval && f.approval !== "all" && (row.delivery_approval_status || "") !== f.approval) return false;
    if (f.delivery_status && f.delivery_status !== "all" && (row.delivery_status || "") !== f.delivery_status) return false;
    return true;
  }

  function rowKey(row) {
    return (row.lead_id || "") + "|" + (row.blocked_at || "");
  }

  function suppressionRow(row) {
    return (
      '<tr class="row-link" data-suppression-row="' +
      esc(rowKey(row)) +
      '">' +
      "<td>" +
      esc(row.email) +
      "</td>" +
      "<td>" +
      esc(row.company_slug || row.company_url || "—") +
      "</td>" +
      "<td>" +
      reasonBadge(row.reason) +
      "</td>" +
      "<td>" +
      providerBadge(row.provider) +
      "</td>" +
      "<td>" +
      deliveryStatusBadge(row.delivery_status) +
      "</td>" +
      "<td>" +
      approvalBadge(row.delivery_approval_status) +
      "</td>" +
      "<td>" +
      esc(fmtDateTime(row.blocked_at)) +
      "</td>" +
      "<td>" +
      esc(row.source_event) +
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

  function timelineHtml(timeline) {
    var items = Array.isArray(timeline) ? timeline : [];
    if (!items.length) return '<div class="empty-state">配信停止関連のイベントはありません</div>';
    return items
      .map(function (e) {
        var meta = e.metadata && Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "";
        return (
          '<div class="history-entry"><strong>' +
          esc(e.event) +
          "</strong> <span class=\"meta\">" +
          esc(e.at || "—") +
          " · " +
          esc(fmtDateTime(e.at)) +
          (meta ? " · " + esc(meta) : "") +
          "</span></div>"
        );
      })
      .join("");
  }

  function detailHtml(row) {
    return (
      '<div class="card suppression-detail">' +
      "<h3>Identity</h3>" +
      '<div class="field-row">' +
      fieldRow("email", esc(row.email)) +
      fieldRow("company_slug", esc(row.company_slug || "—")) +
      fieldRow("company_url", esc(row.company_url || "—")) +
      fieldRow("lead_id", "<code>" + esc(row.lead_id) + "</code>") +
      "</div>" +
      "<h3>Suppression</h3>" +
      '<div class="field-row">' +
      fieldRow("reason", reasonBadge(row.reason)) +
      fieldRow("provider", providerBadge(row.provider)) +
      fieldRow("source_event", esc(row.source_event)) +
      fieldRow("delivery_status", deliveryStatusBadge(row.delivery_status)) +
      fieldRow("delivery_approval_status", approvalBadge(row.delivery_approval_status)) +
      fieldRow("blocked_at", esc(row.blocked_at || "—")) +
      fieldRow("blocked_at (local)", esc(fmtDateTime(row.blocked_at))) +
      "</div>" +
      '<div class="suppression-metadata">' +
      metadataTable(row.metadata) +
      "</div>" +
      "<h3>Suppression Timeline</h3>" +
      '<div class="suppression-timeline">' +
      timelineHtml(row.timeline) +
      "</div>" +
      "</div>"
    );
  }

  /**
   * テーブル領域（一覧 + 空状態）を組み立てる純粋関数。
   * @param {Object[]} suppressions 全行（サーバー順 = blocked_at 降順）
   * @param {Object} view {search, reason, provider, approval, delivery_status, expandedKey}
   * @returns {{html:string, shown:number, total:number}}
   */
  function renderTableRegion(suppressions, view) {
    var v = view || {};
    var all = Array.isArray(suppressions) ? suppressions : [];
    var visible = all.filter(function (r) {
      return matchesSearch(r, v.search) && matchesFilters(r, v);
    });

    if (!all.length) {
      return { html: '<div class="empty-state">送信停止対象はありません。</div>', shown: 0, total: 0 };
    }
    if (!visible.length) {
      return { html: '<div class="empty-state">条件に一致する送信停止対象はありません。</div>', shown: 0, total: all.length };
    }

    var body = visible
      .map(function (r) {
        var tr = suppressionRow(r);
        if (v.expandedKey && rowKey(r) === v.expandedKey) {
          tr += '<tr class="suppression-detail-row"><td colspan="8">' + detailHtml(r) + "</td></tr>";
        }
        return tr;
      })
      .join("");

    var html =
      "<table><thead><tr>" +
      "<th>email</th><th>company</th><th>reason</th><th>provider</th><th>delivery_status</th><th>approval</th><th>blocked at</th><th>source event</th>" +
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
      '<input type="text" id="suppressions-search" placeholder="email / company / lead_id で検索" value="' +
      esc(v.search || "") +
      '" />' +
      '<button type="button" class="secondary" data-refresh="1">更新</button>' +
      '<span id="suppressions-count" class="leads-count"></span>' +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Reason</span>' +
      filterButtons("data-reason", REASON_FILTERS, v.reason) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Provider</span>' +
      filterButtons("data-provider", PROVIDER_FILTERS, v.provider) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Approval</span>' +
      filterButtons("data-approval", APPROVAL_FILTERS, v.approval) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">Delivery</span>' +
      filterButtons("data-delivery_status", DELIVERY_STATUS_FILTERS, v.delivery_status) +
      "</div>" +
      "</div>" +
      '<div class="dash-table-wrap" id="suppressions-table-region"></div>'
    );
  }

  function countText(shown, total) {
    if (!total) return "0 件";
    if (shown === total) return total + " 件";
    return shown + " / " + total + " 件表示";
  }

  function renderPage(payload, view) {
    var summary = payload && payload.summary;
    return (
      '<section class="card"><h2>Suppression Summary</h2>' +
      renderSummary(summary) +
      "</section>" +
      '<section class="card"><h2>Suppression List</h2>' +
      renderControls(view) +
      "</section>"
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側
  // -------------------------------------------------------------------------

  var currentRows = [];
  var view = { search: "", reason: "all", provider: "all", approval: "all", delivery_status: "all", expandedKey: null };

  function $(id) {
    return document.getElementById(id);
  }

  function renderRegion() {
    var region = $("suppressions-table-region");
    if (!region) return;
    var r = renderTableRegion(currentRows, view);
    region.innerHTML = r.html;
    var count = $("suppressions-count");
    if (count) count.textContent = countText(r.shown, r.total);
    wireRowActions(region);
  }

  function refreshFilterButtons() {
    ["reason", "provider", "approval", "delivery_status"].forEach(function (g) {
      document.querySelectorAll("button[data-" + g + "]").forEach(function (btn) {
        btn.className = btn.dataset[g] === view[g] ? "" : "secondary";
      });
    });
  }

  function wireControls() {
    var search = $("suppressions-search");
    if (search) {
      search.addEventListener("input", function () {
        view.search = search.value;
        renderRegion();
      });
    }
    var refresh = document.querySelector("button[data-refresh]");
    if (refresh) refresh.addEventListener("click", load);

    ["reason", "provider", "approval", "delivery_status"].forEach(function (g) {
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
    (scope || document).querySelectorAll("tr[data-suppression-row]").forEach(function (rowEl) {
      rowEl.addEventListener("click", function () {
        var key = rowEl.dataset.suppressionRow;
        view.expandedKey = view.expandedKey === key ? null : key;
        renderRegion();
      });
    });
  }

  async function load() {
    var container = $("suppressions-container");
    if (!container) return;
    var btn = $("suppressions-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="empty-state">読み込み中…</div>';

    var payload;
    try {
      payload = await AdminApi.getSuppressions();
    } catch (err) {
      if (/認証/.test(err.message)) {
        container.innerHTML = '<div class="empty-state">セッションの有効期限が切れています。<a href="/suppressions.html">再読み込み</a>してください。</div>';
      } else {
        container.innerHTML = '<div class="empty-state">Suppression情報を読み込めませんでした: ' + esc(err.message) + "</div>";
      }
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    currentRows = Array.isArray(payload.suppressions) ? payload.suppressions : [];
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
    var btn = $("suppressions-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      fmtDateTime: fmtDateTime,
      isSectionError: isSectionError,
      reasonBadge: reasonBadge,
      providerBadge: providerBadge,
      approvalBadge: approvalBadge,
      deliveryStatusBadge: deliveryStatusBadge,
      renderSummary: renderSummary,
      matchesSearch: matchesSearch,
      matchesFilters: matchesFilters,
      rowKey: rowKey,
      suppressionRow: suppressionRow,
      metadataTable: metadataTable,
      timelineHtml: timelineHtml,
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
