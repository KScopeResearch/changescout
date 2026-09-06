/**
 * leads.js — AOR Admin v2 Leads 画面（Phase52 STEP5）。
 *
 * GET /api/leads（website/aor-admin/server.js の listLeadSummaries → toLeadSummary。
 * report_token を除く Lead 全フィールド + history[] を collected_at 降順で返す）を取得し、
 *   - 一覧（収集日時 / email / company / status / delivery_status / 承認 / 操作）
 *   - email・company 部分一致検索
 *   - delivery_status / delivery_approval_status によるフィルタ
 *   - 行クリックで詳細（全フィールド + 配信履歴タイムライン）
 * を表示する。
 *
 * 【設計方針】list.js / jobs.js / dashboard.js と同じ「HTML 文字列を組み立てて innerHTML
 * に流す」方式。値はすべて escapeHtml() を通す。UI 側で状態の再判定・再集計はしない
 * （status / delivery_status / delivery_approval_status はサーバーの値をそのまま表示。
 * 「最新の初回配信」等は history 配列の該当エントリを字面どおり見せているだけで、
 * 新しい状態を計算してはいない）。存在しないフィールド（updated_at 等）は捏造しない。
 *
 * 破壊的操作は追加しない。唯一の書き込みは既存の delivery-approval（Approve / Reject）で、
 * これは Candidate/Approved 分離仕様として元から存在する非破壊の承認操作。
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  // history の event 分類（表示用。判定ロジックではなく「どの履歴を拾って見せるか」の対応表）。
  var INITIAL_EVENTS = ["initial_report_sent", "initial_report_failed", "initial_report_queued"];
  var WEEKLY_EVENTS = ["weekly_report_sent", "weekly_report_failed"];
  var SUPPRESSION_EVENTS = ["unsubscribed", "email_bounced", "email_complaint"];

  var APPROVAL_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "pending", label: "pending" },
    { key: "approved", label: "approved" },
    { key: "rejected", label: "rejected" },
  ];
  var DELIVERY_FILTERS = [
    { key: "all", label: "すべて" },
    { key: "active", label: "active" },
    { key: "unsubscribed", label: "unsubscribed" },
    { key: "bounced", label: "bounced" },
    { key: "suppressed", label: "suppressed" },
  ];

  // -------------------------------------------------------------------------
  // 純粋関数（レンダリング・フィルタ）
  // -------------------------------------------------------------------------

  /** @param {*} s */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** @param {string|null|undefined} v */
  function fmtDate(v) {
    if (!v) return "—";
    try {
      var d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString("ja-JP");
    } catch (e) {
      return String(v);
    }
  }

  /** delivery_approval_status バッジ。undefined（旧 Lead）は値が無い旨をそのまま示す。 */
  function approvalBadge(approvalStatus) {
    if (!approvalStatus) return '<span class="status-pill status-pending">—（未設定）</span>';
    var cls =
      approvalStatus === "approved"
        ? "status-approved"
        : approvalStatus === "rejected"
        ? "status-rejected"
        : "status-pending";
    return '<span class="status-pill ' + cls + '">' + escapeHtml(approvalStatus) + "</span>";
  }

  /** delivery_status バッジ（サーバーの値をそのまま。色分けのみ付与）。 */
  function deliveryBadge(deliveryStatus) {
    var s = deliveryStatus || "—";
    var cls =
      s === "active"
        ? "status-approved"
        : s === "unsubscribed"
        ? "status-cancelled"
        : s === "bounced" || s === "suppressed"
        ? "status-rejected"
        : "status-pending";
    return '<span class="status-pill ' + cls + '">' + escapeHtml(s) + "</span>";
  }

  /** history を後ろから走査し、events のいずれかに一致する最初のエントリを返す（無ければ null）。 */
  function latestHistory(lead, events) {
    var h = (lead && lead.history) || [];
    for (var i = h.length - 1; i >= 0; i--) {
      if (h[i] && events.indexOf(h[i].event) !== -1) return h[i];
    }
    return null;
  }

  /** email / company_url / company_slug の部分一致（大文字小文字無視）。空クエリは全件一致。 */
  function matchesSearch(lead, q) {
    var query = String(q || "").trim().toLowerCase();
    if (!query) return true;
    var hay = [lead.email, lead.company_url, lead.company_slug]
      .map(function (x) {
        return String(x == null ? "" : x).toLowerCase();
      })
      .join(" ");
    return hay.indexOf(query) !== -1;
  }

  /** approval / delivery フィルタ（"all" は無条件一致。値はサーバーの生値と厳密一致）。 */
  function matchesFilters(lead, filters) {
    var f = filters || {};
    if (f.approval && f.approval !== "all") {
      if ((lead.delivery_approval_status || "") !== f.approval) return false;
    }
    if (f.delivery && f.delivery !== "all") {
      if ((lead.delivery_status || "") !== f.delivery) return false;
    }
    return true;
  }

  /** 一覧の1行（詳細行は別途 detailRow で付く）。 */
  function leadRow(lead) {
    var id = escapeHtml(lead.lead_id);
    return (
      '<tr class="row-link" data-lead-row="' +
      id +
      '">' +
      "<td>" +
      escapeHtml(fmtDate(lead.collected_at)) +
      "</td>" +
      "<td>" +
      escapeHtml(lead.email) +
      "</td>" +
      "<td>" +
      escapeHtml(lead.company_url || "—") +
      "</td>" +
      "<td>" +
      escapeHtml(lead.company_slug || "—") +
      "</td>" +
      "<td>" +
      escapeHtml(lead.status) +
      "</td>" +
      "<td>" +
      deliveryBadge(lead.delivery_status) +
      "</td>" +
      "<td data-approval-cell>" +
      approvalBadge(lead.delivery_approval_status) +
      "</td>" +
      '<td data-approval-actions>' +
      actionButtons(lead) +
      "</td>" +
      "</tr>"
    );
  }

  /** Approve / Reject ボタン（既存の delivery-approval 承認操作。破壊的操作ではない）。 */
  function actionButtons(lead) {
    var id = escapeHtml(lead.lead_id);
    var buttons = [];
    if (lead.delivery_approval_status !== "approved") {
      buttons.push('<button type="button" class="secondary" data-approve="' + id + '">Approve</button>');
    }
    if (lead.delivery_approval_status !== "rejected") {
      buttons.push('<button type="button" class="danger" data-reject="' + id + '">Reject</button>');
    }
    return buttons.join(" ");
  }

  function fieldRow(label, valueHtml) {
    return (
      '<div class="field"><div class="label">' +
      escapeHtml(label) +
      '</div><div class="value">' +
      valueHtml +
      "</div></div>"
    );
  }

  function historyTimeline(lead) {
    var h = (lead && lead.history) || [];
    if (!h.length) return '<div class="empty-state">履歴なし</div>';
    return h
      .map(function (e) {
        var meta = e && e.metadata && Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : "";
        return (
          '<div class="history-entry"><strong>' +
          escapeHtml((e && e.event) || "—") +
          "</strong> <span class=\"meta\">" +
          escapeHtml(fmtDate(e && e.at)) +
          (meta ? " · " + escapeHtml(meta) : "") +
          "</span></div>"
        );
      })
      .join("");
  }

  /** 詳細セル（全フィールド + history から拾った直近の配信イベント + タイムライン）。 */
  function detailHtml(lead) {
    var initial = latestHistory(lead, INITIAL_EVENTS);
    var weekly = latestHistory(lead, WEEKLY_EVENTS);
    var suppression = latestHistory(lead, SUPPRESSION_EVENTS);
    var describe = function (entry) {
      if (!entry) return "—";
      return escapeHtml(entry.event) + " · " + escapeHtml(fmtDate(entry.at));
    };

    return (
      '<div class="card lead-detail">' +
      "<h3>Lead</h3>" +
      '<div class="field-row">' +
      fieldRow("lead_id", "<code>" + escapeHtml(lead.lead_id) + "</code>") +
      fieldRow("source", escapeHtml(lead.source || "—")) +
      fieldRow("collection_method", escapeHtml(lead.collection_method || "—")) +
      fieldRow("contact_name", escapeHtml(lead.contact_name || "—")) +
      fieldRow("department", escapeHtml(lead.department || "—")) +
      fieldRow("source_url", escapeHtml(lead.source_url || "—")) +
      fieldRow(
        "company_url",
        escapeHtml(lead.company_url || "—") +
          (lead.company_url_source ? " <span class=\"meta\">(" + escapeHtml(lead.company_url_source) + ")</span>" : "")
      ) +
      fieldRow("company_url_confidence", escapeHtml(lead.company_url_confidence == null ? "—" : lead.company_url_confidence)) +
      fieldRow("notes", escapeHtml(lead.notes || "—")) +
      "</div>" +
      "<h3>Status</h3>" +
      '<div class="field-row">' +
      fieldRow("status", escapeHtml(lead.status)) +
      fieldRow("delivery_status", deliveryBadge(lead.delivery_status)) +
      fieldRow("delivery_approval_status", approvalBadge(lead.delivery_approval_status)) +
      fieldRow("collected_at", escapeHtml(fmtDate(lead.collected_at))) +
      "</div>" +
      "<h3>Consent / Requests</h3>" +
      '<div class="field-row">' +
      fieldRow(
        "weekly_report_consent",
        escapeHtml(String(lead.weekly_report_consent === true)) +
          (lead.weekly_report_consent_at ? " <span class=\"meta\">" + escapeHtml(fmtDate(lead.weekly_report_consent_at)) + "</span>" : "")
      ) +
      fieldRow(
        "paid_report_requested",
        escapeHtml(String(lead.paid_report_requested === true)) +
          (lead.paid_report_requested_at ? " <span class=\"meta\">" + escapeHtml(fmtDate(lead.paid_report_requested_at)) + "</span>" : "")
      ) +
      fieldRow("last_weekly_sent_report_generated_at", escapeHtml(fmtDate(lead.last_weekly_sent_report_generated_at))) +
      "</div>" +
      "<h3>配信履歴（history より）</h3>" +
      '<div class="field-row">' +
      fieldRow("最新の初回配信", describe(initial)) +
      fieldRow("最新の週次配信", describe(weekly)) +
      fieldRow("最新の配信停止イベント", describe(suppression)) +
      "</div>" +
      '<div class="lead-history">' +
      historyTimeline(lead) +
      "</div>" +
      "</div>"
    );
  }

  /**
   * テーブル領域（一覧 + 空状態）の HTML を組み立てる純粋関数。
   * @param {Object[]} leads       全 Lead（サーバー順）
   * @param {Object} view          {search, approval, delivery, expandedId}
   * @returns {{html:string, shown:number, total:number}}
   */
  function renderTableRegion(leads, view) {
    var v = view || {};
    var all = Array.isArray(leads) ? leads : [];
    var visible = all.filter(function (l) {
      return matchesSearch(l, v.search) && matchesFilters(l, v);
    });

    if (!all.length) {
      return { html: '<div class="empty-state">Leadがまだ収集されていません。</div>', shown: 0, total: 0 };
    }
    if (!visible.length) {
      return {
        html: '<div class="empty-state">条件に一致するLeadはありません。</div>',
        shown: 0,
        total: all.length,
      };
    }

    var body = visible
      .map(function (l) {
        var row = leadRow(l);
        if (v.expandedId && l.lead_id === v.expandedId) {
          row += '<tr class="lead-detail-row"><td colspan="8">' + detailHtml(l) + "</td></tr>";
        }
        return row;
      })
      .join("");

    var html =
      '<table>' +
      "<thead><tr>" +
      "<th>収集日時</th><th>email</th><th>company_url</th><th>company_slug</th>" +
      "<th>status</th><th>delivery_status</th><th>delivery_approval_status</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table>";

    return { html: html, shown: visible.length, total: all.length };
  }

  function filterButtons(groupAttr, options, current) {
    return options
      .map(function (o) {
        var active = (current || "all") === o.key;
        return (
          '<button type="button" class="' +
          (active ? "" : "secondary") +
          '" ' +
          groupAttr +
          '="' +
          o.key +
          '">' +
          escapeHtml(o.label) +
          "</button>"
        );
      })
      .join("");
  }

  /** 検索欄 + フィルタ + 件数（純粋関数。ブラウザ側で1度だけ描画し、以後は部分更新する）。 */
  function renderControls(view) {
    var v = view || {};
    return (
      '<div class="leads-controls">' +
      '<div class="leads-search-row">' +
      '<input type="text" id="leads-search" placeholder="email / company で検索" value="' +
      escapeHtml(v.search || "") +
      '" />' +
      '<button type="button" class="secondary" data-refresh="1">更新</button>' +
      '<span id="leads-count" class="leads-count"></span>' +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">承認</span>' +
      filterButtons("data-approval", APPROVAL_FILTERS, v.approval) +
      "</div>" +
      '<div class="leads-filter-row"><span class="leads-filter-label">配信</span>' +
      filterButtons("data-delivery", DELIVERY_FILTERS, v.delivery) +
      "</div>" +
      "</div>" +
      '<div class="dash-table-wrap" id="leads-table-region"></div>'
    );
  }

  function countText(shown, total) {
    if (!total) return "0 件";
    if (shown === total) return total + " 件";
    return shown + " / " + total + " 件表示";
  }

  // -------------------------------------------------------------------------
  // ブラウザ側（fetch → render → 検索・フィルタ・詳細開閉）
  // -------------------------------------------------------------------------

  var currentLeads = [];
  var view = { search: "", approval: "all", delivery: "all", expandedId: null };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, isError) {
    var toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = isError ? "var(--bad)" : "var(--border)";
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.classList.remove("show");
    }, 3500);
  }

  /** テーブル領域と件数だけを再描画する（検索入力欄はそのまま＝フォーカスを失わない）。 */
  function renderRegion() {
    var region = $("leads-table-region");
    if (!region) return;
    var r = renderTableRegion(currentLeads, view);
    region.innerHTML = r.html;
    var count = $("leads-count");
    if (count) count.textContent = countText(r.shown, r.total);
    wireRowActions(region);
    wireApprovalActions(region);
  }

  function refreshFilterButtons() {
    document.querySelectorAll("button[data-approval]").forEach(function (btn) {
      btn.className = btn.dataset.approval === view.approval ? "" : "secondary";
    });
    document.querySelectorAll("button[data-delivery]").forEach(function (btn) {
      btn.className = btn.dataset.delivery === view.delivery ? "" : "secondary";
    });
  }

  function renderAll() {
    var container = $("leads-container");
    if (!container) return;
    container.innerHTML = renderControls(view);
    wireControls();
    renderRegion();
  }

  function wireControls() {
    var search = $("leads-search");
    if (search) {
      search.addEventListener("input", function () {
        view.search = search.value;
        renderRegion();
      });
    }
    var refresh = document.querySelector("button[data-refresh]");
    if (refresh) refresh.addEventListener("click", loadLeads);

    document.querySelectorAll("button[data-approval]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        view.approval = btn.dataset.approval;
        refreshFilterButtons();
        renderRegion();
      });
    });
    document.querySelectorAll("button[data-delivery]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        view.delivery = btn.dataset.delivery;
        refreshFilterButtons();
        renderRegion();
      });
    });
  }

  function wireRowActions(scope) {
    (scope || document).querySelectorAll("tr[data-lead-row]").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        // 操作ボタン（Approve/Reject）クリックは行展開に伝播させない
        if (ev.target.closest("button")) return;
        var id = row.dataset.leadRow;
        view.expandedId = view.expandedId === id ? null : id;
        renderRegion();
      });
    });
  }

  function wireApprovalActions(scope) {
    var root = scope || document;

    root.querySelectorAll("button[data-approve]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setApproval(btn, btn.dataset.approve, "approved", "承認しました");
      });
    });
    root.querySelectorAll("button[data-reject]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setApproval(btn, btn.dataset.reject, "rejected", "却下しました");
      });
    });
  }

  async function setApproval(btn, leadId, status, okMessage) {
    btn.disabled = true;
    try {
      var res = await AdminApi.setLeadDeliveryApproval(leadId, status);
      var updated = res && res.lead;
      if (updated) {
        var idx = currentLeads.findIndex(function (l) {
          return l.lead_id === updated.lead_id;
        });
        if (idx !== -1) currentLeads[idx] = updated;
      }
      renderRegion();
      showToast(okMessage + ": " + leadId);
    } catch (err) {
      showToast(err.message, true);
      btn.disabled = false;
    }
  }

  async function loadLeads() {
    var container = $("leads-container");
    if (container) container.innerHTML = '<div class="empty-state">読み込み中…</div>';
    try {
      currentLeads = await AdminApi.listLeads();
      renderAll();
    } catch (err) {
      if (container) {
        container.innerHTML =
          '<div class="empty-state">Leadを読み込めませんでした: ' + escapeHtml(err.message) + "</div>";
      }
    }
  }

  async function init() {
    try {
      var session = await AdminApi.getSession();
      var el = $("user-label");
      if (el) el.textContent = session.username + " でログイン中";
    } catch (e) {
      // 表示上の情報のため失敗しても続行
    }
    await loadLeads();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      escapeHtml: escapeHtml,
      fmtDate: fmtDate,
      approvalBadge: approvalBadge,
      deliveryBadge: deliveryBadge,
      latestHistory: latestHistory,
      matchesSearch: matchesSearch,
      matchesFilters: matchesFilters,
      leadRow: leadRow,
      actionButtons: actionButtons,
      detailHtml: detailHtml,
      historyTimeline: historyTimeline,
      renderTableRegion: renderTableRegion,
      renderControls: renderControls,
      countText: countText,
    };
  } else {
    init();
  }
})();
