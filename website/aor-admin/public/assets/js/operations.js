/**
 * operations.js — AOR Admin v2 Operations 画面（Phase52 STEP10）。
 *
 * 【方針】「操作できること」ではなく「誤操作・二重操作・意図しない再公開を防ぐこと」が最優先。
 *
 * 実在する mutation API のうち、Operations UI が担うのは Report の Publish / Unpublish のみ
 * （POST /api/publish/:slug, POST /api/unpublish/:slug。既存 api.js の AdminApi.publish/unpublish、
 *  CSRF は postJson が X-CSRF-Token ヘッダーで付与）。理由:
 *   - もっとも副作用が大きい操作で、確認ダイアログ + 409/stale 対応 + 実行後の Backend 再取得を
 *     きちんと備える価値が高い（既存 detail.js は確認ダイアログを持たない）。
 *   - 横断的に「公開可能だが未公開」「公開済み」のレポートを一覧で扱える。
 * それ以外の操作は既存 UI に導線を出すだけ（重複実装しない）:
 *   - Review Approve/Reject/Revise → Reviews（/index.html → 詳細）
 *   - Lead delivery approval        → Leads（/leads.html）
 *   - Job retry/cancel/enqueue      → Jobs（/jobs.html）
 * Deploy / Resend / Regenerate / Unsuppress / Delete は Backend mutation API が存在しないため未対応。
 *
 * 操作可否は Backend の値のみで判定する（§12）:
 *   - Publish 可能   = report.publishable === true かつ published !== true
 *     （publishable は server の engine.isPublishable() の戻り値そのもの。Frontend で
 *      approved+validation+deployed 等を組み合わせて独自判定しない）
 *   - Unpublish 可能 = published === true
 * 実行後は必ず /api/reports・/api/dashboard/reports を再取得して Backend 値で再描画する（§22）。
 *
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isSectionError(v) {
    return !!v && typeof v === "object" && v.status === "error";
  }

  /** HTTP status → 表示メッセージ（§20）。err は api.js の postJson が投げる Error（err.status 付き）。 */
  function mutationErrorMessage(err) {
    var status = err && err.status;
    var base = (err && err.message) || "不明なエラー";
    if (status === 401) return "セッションの有効期限が切れています。再読み込みしてください。";
    if (status === 403) return "この操作を行う権限がありません。";
    if (status === 404) return "対象が見つかりません。すでに削除・変更された可能性があります。";
    if (status === 409) return "状態が変更されています。最新情報を再取得してください（" + esc(base) + "）";
    if (status === 429) return "リクエストが多すぎます。しばらく待って再試行してください。";
    if (status === 400) return "操作できませんでした: " + esc(base);
    if (status >= 500) return "サーバーエラーが発生しました。時間をおいて再試行してください。";
    return "操作できませんでした: " + esc(base);
  }

  /** Backend 値だけで Publish/Unpublish の可否を出す（§12。独自の業務ルールを作らない）。 */
  function publishability(rep) {
    var r = rep || {};
    return {
      canPublish: r.publishable === true && r.published !== true,
      canUnpublish: r.published === true,
      // publishable=false の理由を UI に出すため（server が返す publishable の判定を尊重）
      blockedByReview: r.publishable !== true && r.published !== true,
    };
  }

  // ---- System status サマリ（read-only。既存 GET を再利用）----
  function renderSystemStatus(payload) {
    var health = payload && payload.health;
    var dashboard = payload && payload.dashboard;
    var reports = Array.isArray(payload && payload.reports) ? payload.reports : [];

    var serverState = isSectionError(health) ? "unknown" : (health && health.status) || "unknown";
    var leadSummary = !isSectionError(dashboard) && dashboard ? dashboard.lead_summary || {} : {};
    var reportSummary = !isSectionError(dashboard) && dashboard ? dashboard.report_summary || {} : {};
    var pendingReview = reports.filter(function (r) {
      return r && r.review_status !== "approved";
    }).length;

    return (
      '<section class="card"><h2>System Status</h2>' +
      '<div class="field-row">' +
      '<div class="field"><div class="label">Server</div><div class="value">' + esc(serverState) + "</div></div>" +
      '<div class="field"><div class="label">Reports (total)</div><div class="value">' + esc(reports.length) + "</div></div>" +
      '<div class="field"><div class="label">Pending Review</div><div class="value">' + esc(pendingReview) + "</div></div>" +
      '<div class="field"><div class="label">Pending Lead Approval</div><div class="value">' + esc(leadSummary.pending_approval == null ? "—" : leadSummary.pending_approval) + "</div></div>" +
      '<div class="field"><div class="label">Deploy Pending</div><div class="value">' + esc(reportSummary.deploy_pending == null ? "—" : reportSummary.deploy_pending) + "</div></div>" +
      "</div></section>"
    );
  }

  // ---- 他 UI への導線（重複実装しない）----
  function renderActionableLinks(payload) {
    var reports = Array.isArray(payload && payload.reports) ? payload.reports : [];
    var dashboard = payload && payload.dashboard;
    var leadSummary = !isSectionError(dashboard) && dashboard ? dashboard.lead_summary || {} : {};
    var reportSummary = !isSectionError(dashboard) && dashboard ? dashboard.report_summary || {} : {};
    var pendingReview = reports.filter(function (r) {
      return r && r.review_status !== "approved";
    }).length;

    var items = [
      { label: "Review 待ち Report", count: pendingReview, href: "/index.html", op: "Approve / Reject / Revise は Reviews 画面で行います" },
      { label: "承認待ち Lead", count: leadSummary.pending_approval, href: "/leads.html", op: "delivery approval は Leads 画面で行います" },
      { label: "Deploy Pending Report", count: reportSummary.deploy_pending, href: "/reports.html", op: "Deploy API は存在しません（CLI 運用）。状態確認は Reports 画面" },
      { label: "Jobs", count: null, href: "/jobs.html", op: "retry / cancel / enqueue は Jobs 画面で行います" },
    ];

    return (
      '<section class="card"><h2>他の操作（既存画面へ）</h2>' +
      '<table class="dash-table"><thead><tr><th>対象</th><th>件数</th><th>操作場所</th></tr></thead><tbody>' +
      items
        .map(function (it) {
          return (
            "<tr><td><a href=\"" + esc(it.href) + "\">" + esc(it.label) + "</a></td>" +
            "<td>" + esc(it.count == null ? "—" : it.count) + "</td>" +
            "<td>" + esc(it.op) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>" +
      '<div class="dash-note">Operations 画面で直接実行できるのは Report の Publish / Unpublish のみです。' +
      "その他は誤操作防止のため、対象を特定できる既存画面へ誘導します。</div></section>"
    );
  }

  // ---- Publish / Unpublish 操作テーブル ----
  function opButton(rep, submittingKey) {
    var p = publishability(rep);
    var slug = esc(rep.id);
    var busy = submittingKey === rep.id;
    if (p.canPublish) {
      return '<button type="button" class="" data-op="publish" data-slug="' + slug + '"' + (busy ? " disabled" : "") + ">" + (busy ? "Publishing…" : "Publish") + "</button>";
    }
    if (p.canUnpublish) {
      return '<button type="button" class="danger" data-op="unpublish" data-slug="' + slug + '"' + (busy ? " disabled" : "") + ">" + (busy ? "Unpublishing…" : "Unpublish") + "</button>";
    }
    if (p.blockedByReview) {
      return '<span class="dash-note">publishable=false（承認前）</span>';
    }
    return '<span class="dash-note">—</span>';
  }

  function renderPublishTable(reports, submittingKey) {
    var all = Array.isArray(reports) ? reports : [];
    if (!all.length) {
      return '<section class="card"><h2>Report Publish / Unpublish</h2><div class="empty-state">レポートはありません。</div></section>';
    }
    var rows = all
      .map(function (r) {
        return (
          "<tr>" +
          "<td>" + esc(r.company_name || r.id) + "</td>" +
          "<td>" + esc(r.id) + "</td>" +
          "<td>" + esc(r.review_status) + "</td>" +
          "<td>" + (r.publishable === true ? "yes" : "no") + "</td>" +
          "<td>" + (r.published === true ? "published" : "—") + "</td>" +
          "<td>" + opButton(r, submittingKey) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<section class="card"><h2>Report Publish / Unpublish</h2>' +
      '<div class="dash-note">操作可否は Backend の <code>publishable</code>（server の isPublishable() の値）と <code>published</code> のみで判定しています。</div>' +
      '<div class="dash-table-wrap"><table class="dash-table"><thead><tr>' +
      "<th>company</th><th>slug</th><th>review</th><th>publishable</th><th>published</th><th>operation</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></section>"
    );
  }

  /** 確認ダイアログ（modal）の HTML。対象・操作・副作用をすべて esc して埋め込む（§38）。 */
  function renderConfirmDialog(op) {
    if (!op) return "";
    var isPublish = op.action === "publish";
    var title = isPublish ? "このレポートを公開します" : "このレポートの公開を取り消します";
    var effect = isPublish
      ? "website/aor/data/&lt;slug&gt;.json（CloudFront 配信元）へ反映され、受信者がレポートを閲覧できる状態になります。"
      : "公開済みレポートを非公開に戻します。既にメールで配信済みのリンクは閲覧できなくなる可能性があります。";
    return (
      '<div class="ops-modal-overlay" data-modal-overlay>' +
      '<div class="ops-modal" role="dialog" aria-modal="true">' +
      "<h3>" + esc(title) + "</h3>" +
      '<div class="field-row">' +
      '<div class="field"><div class="label">対象 (company)</div><div class="value">' + esc(op.company || "—") + "</div></div>" +
      '<div class="field"><div class="label">対象 (slug)</div><div class="value">' + esc(op.slug) + "</div></div>" +
      '<div class="field"><div class="label">操作</div><div class="value">' + esc(isPublish ? "Publish" : "Unpublish") + "</div></div>" +
      "</div>" +
      '<p class="ops-modal-effect">' + effect + "</p>" +
      '<div class="ops-modal-actions">' +
      '<button type="button" class="secondary" data-modal-cancel>キャンセル</button>' +
      '<button type="button" class="' + (isPublish ? "" : "danger") + '" data-modal-confirm>実行する</button>' +
      "</div></div></div>"
    );
  }

  /**
   * 画面全体（純粋関数）。
   * @param {{health:Object, dashboard:Object, reports:(Object[]|Object)}} payload
   * @param {{submittingKey?:string, modalOp?:Object}} [uiState]
   */
  function renderOperations(payload, uiState) {
    var st = uiState || {};
    var reports = Array.isArray(payload && payload.reports) ? payload.reports : [];
    return (
      renderSystemStatus(payload) +
      renderPublishTable(reports, st.submittingKey) +
      renderActionableLinks(payload)
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側（mutation フロー）
  // -------------------------------------------------------------------------

  var state = { reports: [], health: {}, dashboard: {}, submittingKey: null, modalOp: null };

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, isError) {
    var toast = $("toast");
    if (!toast) return;
    toast.textContent = message; // textContent（§39: response message を HTML 挿入しない）
    toast.style.borderColor = isError ? "var(--bad)" : "var(--border)";
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.classList.remove("show");
    }, 4000);
  }

  function renderAll() {
    var container = $("operations-container");
    if (container) {
      container.innerHTML = renderOperations({ health: state.health, dashboard: state.dashboard, reports: state.reports }, { submittingKey: state.submittingKey });
      wireOpButtons(container);
    }
    renderModal();
  }

  function renderModal() {
    var root = $("ops-modal-root");
    if (!root) return;
    root.innerHTML = renderConfirmDialog(state.modalOp);
    if (!state.modalOp) return;
    var overlay = root.querySelector("[data-modal-overlay]");
    var cancel = root.querySelector("[data-modal-cancel]");
    var confirm = root.querySelector("[data-modal-confirm]");
    if (cancel) cancel.addEventListener("click", closeModal);
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    if (confirm) {
      confirm.addEventListener("click", function () {
        confirm.disabled = true; // §15/§47: 二重クリックで request が2回飛ばない
        submitOp(state.modalOp);
      });
    }
  }

  function closeModal() {
    state.modalOp = null;
    renderModal();
  }

  function wireOpButtons(scope) {
    (scope || document).querySelectorAll("button[data-op]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.submittingKey) return;
        var slug = btn.dataset.slug;
        var rep = state.reports.find(function (r) { return r.id === slug; });
        state.modalOp = { action: btn.dataset.op, slug: slug, company: rep && rep.company_name };
        renderModal();
      });
    });
  }

  async function submitOp(op) {
    if (!op || state.submittingKey) return;
    state.submittingKey = op.slug;
    state.modalOp = null;
    renderAll();

    try {
      if (op.action === "publish") await AdminApi.publish(op.slug);
      else await AdminApi.unpublish(op.slug);
      showToast((op.action === "publish" ? "Publish しました: " : "Unpublish しました: ") + op.slug);
    } catch (err) {
      if (err && err.status === 401) {
        showToast(mutationErrorMessage(err), true);
        state.submittingKey = null;
        renderAll();
        return;
      }
      showToast(mutationErrorMessage(err), true);
    }

    // §22: 成否にかかわらず Backend から再取得して Backend 値で再描画する
    state.submittingKey = null;
    await load();
  }

  async function load() {
    var container = $("operations-container");
    if (!container) return;
    var btn = $("operations-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    if (!state.reports.length) container.innerHTML = '<div class="empty-state">読み込み中…</div>';

    var settled = await Promise.allSettled([AdminApi.listReports(), AdminApi.getDashboard(), AdminApi.getHealth()]);

    var authFailed = settled.some(function (r) {
      return r.status === "rejected" && /認証/.test((r.reason && r.reason.message) || "");
    });
    if (authFailed) {
      container.innerHTML = '<div class="empty-state">セッションの有効期限が切れています。<a href="/operations.html">再読み込み</a>してください。</div>';
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }
    if (settled[0].status === "rejected") {
      container.innerHTML = '<div class="empty-state">Operations 情報を読み込めませんでした: ' + esc((settled[0].reason && settled[0].reason.message) || String(settled[0].reason)) + "</div>";
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    state.reports = Array.isArray(settled[0].value) ? settled[0].value : [];
    state.dashboard = settled[1].status === "fulfilled" ? settled[1].value : { status: "error", message: (settled[1].reason && settled[1].reason.message) || String(settled[1].reason) };
    state.health = settled[2].status === "fulfilled" ? settled[2].value : { status: "error", message: (settled[2].reason && settled[2].reason.message) || String(settled[2].reason) };

    renderAll();
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
    var btn = $("operations-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      esc: esc,
      isSectionError: isSectionError,
      mutationErrorMessage: mutationErrorMessage,
      publishability: publishability,
      opButton: opButton,
      renderSystemStatus: renderSystemStatus,
      renderActionableLinks: renderActionableLinks,
      renderPublishTable: renderPublishTable,
      renderConfirmDialog: renderConfirmDialog,
      renderOperations: renderOperations,
    };
  } else {
    init();
  }
})();
