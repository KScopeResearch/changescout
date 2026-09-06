/**
 * system.js — AOR Admin v2 System 画面（Phase52 STEP9）。完全 read-only。
 *
 * 既存 API のみを利用する（新 API は追加していない）：
 *   GET /api/health           … status / uptime / version / checks{auth,jobs,output_dir,logs_dir,config}
 *   GET /api/dashboard/health  … ses / lambda / cloudfront / blastengine（各セクション独立、
 *                                失敗時は {status:"error"}）
 *   GET /api/dashboard/reports … generated / approved / published_backend / web_deployed /
 *                                deploy_pending / pending_slugs（Report pipeline / storage の手掛かり）
 *   GET /api/session           … username
 *
 * 【設計方針】dashboard.js / reports.js 等と同じ「HTML 文字列 → innerHTML」方式。
 *   - Backend が返した status をそのまま表示（Frontend で healthy/degraded を再判定しない）。
 *   - secret / credential は表示しない。全ペイロードを redact() でマスクしてから描画する
 *     （API 側も secret を返さない設計だが、多層防御。§8 / §14 / §26 / §34）。
 *   - Configuration は「値」ではなく Configured / Not configured の状態のみ。
 *   - 操作ボタン・設定変更・Job 実行・Deploy・Publish・Retry は一切持たない（§31）。
 *   - 手動 Refresh のみ。自動 polling なし（§20。ステータスバーの status.js とは別物）。
 * レンダリング関数は module.exports へ公開し Node からユニットテストする（ブラウザでは無視）。
 */

(function () {
  "use strict";

  // §8 の secret 系キー（大小・snake/camel を吸収するため、比較時に [_-] を除去して小文字化）。
  var SECRET_TOKENS = [
    "token",
    "secret",
    "credential",
    "credentials",
    "apikey",
    "authorization",
    "password",
    "passwd",
    "accesskey",
    "secretkey",
    "privatekey",
    "sessiontoken",
    "cookie",
    "bearer",
    "accesstoken",
  ];
  var MASK = "••••••• (masked)";

  function isSecretKey(key) {
    var k = String(key || "").toLowerCase().replace(/[_\-\s]/g, "");
    for (var i = 0; i < SECRET_TOKENS.length; i++) {
      if (k.indexOf(SECRET_TOKENS[i]) !== -1) return true;
    }
    return false;
  }

  /** 文字列中に混入した secret らしき断片を伏せる（error message 対策。§26）。 */
  function redactString(s) {
    return String(s)
      .replace(/Bearer\s+[A-Za-z0-9._\-/+]+/gi, "Bearer " + MASK)
      // `xxx_secret_access_key=...` / `api_key: ...` / `SESSION_TOKEN=...` など、secret 系語を含むキー = 値
      .replace(
        /([A-Za-z0-9_-]*(?:key|token|secret|password|passwd|credential|authorization)[A-Za-z0-9_-]*)\s*[:=]\s*["']?[^\s"',;)}\]]{4,}["']?/gi,
        "$1=" + MASK
      );
  }

  /**
   * 任意の値を再帰的に走査し、secret 系キーの値をマスクする（純粋関数）。
   * @param {*} value
   * @returns {*} マスク済みのコピー
   */
  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) {
        out[k] = isSecretKey(k) ? MASK : redact(value[k]);
      });
      return out;
    }
    if (typeof value === "string") return redactString(value);
    return value;
  }

  // -------------------------------------------------------------------------
  // 純粋関数（レンダリング）
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

  function fmtUptime(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec < 0) return "—";
    var s = Math.floor(sec);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var out = [];
    if (d) out.push(d + "d");
    if (h || d) out.push(h + "h");
    out.push(m + "m");
    return out.join(" ");
  }

  function isSectionError(v) {
    return !!v && typeof v === "object" && v.status === "error";
  }

  /** 未取得・null・undefined・空文字を "—" に、そうでなければ値をそのまま（Backend の unknown は保持）。 */
  function show(v) {
    if (v === null || v === undefined || v === "") return "—";
    return v;
  }

  function sectionError(title, section) {
    return '<div class="dash-section-error">⚠ ' + esc(title) + " の取得に失敗しました<span class=\"dash-error-msg\">" + esc((section && section.message) || "") + "</span></div>";
  }

  function boolPill(value, okLabel, ngLabel) {
    var ok = value === true;
    return '<span class="status-pill ' + (ok ? "status-approved" : "status-pending_review") + '">' + esc(ok ? okLabel || "yes" : ngLabel || "no") + "</span>";
  }

  /** Backend の status 文字列をそのまま色付きで（healthy/ok→緑、degraded→橙、それ以外→グレー）。 */
  function statePill(state) {
    var s = String(state == null ? "" : state).toLowerCase();
    var cls = s === "ok" || s === "healthy" ? "status-approved" : s === "degraded" || s === "warn" ? "status-needs_revision" : s === "unhealthy" || s === "error" || s === "bad" ? "status-rejected" : "status-pending_review";
    return '<span class="status-pill ' + cls + '">' + esc(show(state)) + "</span>";
  }

  function fieldRows(pairs) {
    return (
      '<div class="field-row">' +
      pairs
        .map(function (p) {
          return '<div class="field"><div class="label">' + esc(p.label) + '</div><div class="value">' + (p.html ? p.html : esc(show(p.value))) + "</div></div>";
        })
        .join("") +
      "</div>"
    );
  }

  function kvTable(obj) {
    var keys = obj && typeof obj === "object" ? Object.keys(obj) : [];
    if (!keys.length) return '<div class="empty-state">情報なし</div>';
    return (
      '<table class="dash-table"><tbody>' +
      keys
        .map(function (k) {
          var v = obj[k];
          var text = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
          return "<tr><td>" + esc(k) + "</td><td>" + esc(text) + "</td></tr>";
        })
        .join("") +
      "</tbody></table>"
    );
  }

  // ---- Application / Health（GET /api/health）----
  function renderApplication(health, session) {
    if (isSectionError(health)) return '<section class="card"><h2>Application</h2>' + sectionError("Application / Health", health) + "</section>";
    var h = health || {};
    return (
      '<section class="card"><h2>Application</h2>' +
      fieldRows([
        { label: "Application", value: "AOR Admin" },
        { label: "Version", value: show(h.version) },
        { label: "Overall Status", html: statePill(h.status) },
        { label: "Uptime", value: fmtUptime(h.uptime) },
        { label: "Signed in as", value: show(session && session.username) },
      ]) +
      "</section>"
    );
  }

  function renderHealthChecks(health) {
    if (isSectionError(health)) return "";
    var checks = (health && health.checks) || null;
    if (!checks) return '<section class="card"><h2>Health Checks</h2><div class="empty-state">checks 情報なし</div></section>';
    var labels = { auth: "Auth (ADMIN_USER/PASSWORD)", jobs: "Job Store", output_dir: "Output Dir", logs_dir: "Logs Dir", config: "LLM/Search Config" };
    var rows = Object.keys(checks)
      .map(function (k) {
        return "<tr><td>" + esc(labels[k] || k) + "</td><td>" + boolPill(checks[k] === true, "OK", "NG") + "</td></tr>";
      })
      .join("");
    return '<section class="card"><h2>Health Checks</h2><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Check</th><th>State</th></tr></thead><tbody>' + rows + "</tbody></table></div></section>";
  }

  // ---- Report Pipeline（GET /api/dashboard/reports）----
  function renderPipeline(reports) {
    if (isSectionError(reports)) return '<section class="card"><h2>Report Pipeline</h2>' + sectionError("Report Pipeline", reports) + "</section>";
    var r = reports || {};
    var webVal = r.web_deployed === null || r.web_deployed === undefined ? "—" : r.web_deployed;
    var pendVal = r.deploy_pending === null || r.deploy_pending === undefined ? "—" : r.deploy_pending;
    var html =
      '<section class="card"><h2>Report Pipeline</h2>' +
      fieldRows([
        { label: "Generated", value: show(r.generated) },
        { label: "Approved", value: show(r.approved) },
        { label: "Published (Backend)", value: show(r.published_backend) },
        { label: "Web Deployed", value: webVal },
        { label: "Deploy Pending", value: pendVal },
      ]);
    if (r.deploy_pending && r.deploy_pending > 0) {
      var slugs = Array.isArray(r.pending_slugs) ? r.pending_slugs : [];
      html += '<div class="dash-alert tone-warn"><strong>⚠ Web 未反映のレポートが ' + esc(r.deploy_pending) + " 件あります。</strong>" + (slugs.length ? '<ul class="plain-list">' + slugs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") + "</div>";
    }
    if (r.published_backend_source) html += '<div class="dash-note">Published (Backend) 情報: ' + esc(r.published_backend_source) + "</div>";
    if (r.web_deployed_note) html += '<div class="dash-note">Web Deployed 情報: ' + esc(r.web_deployed_note) + "</div>";
    html += "</section>";
    return html;
  }

  // ---- Delivery / Provider（GET /api/dashboard/health）----
  function renderSes(ses) {
    if (isSectionError(ses)) return "<h3>SES</h3>" + sectionError("SES", ses);
    var s = ses || {};
    return (
      "<h3>SES</h3>" +
      fieldRows([
        { label: "Production Access", value: s.production_access_enabled === true ? "GRANTED" : show(s.review_status) },
        { label: "Sending", html: boolPill(s.sending_enabled, "Enabled", "Disabled") },
        { label: "Enforcement", html: statePill(s.enforcement_status) },
        { label: "DKIM", value: show(s.dkim_status) },
        { label: "Configuration Set", value: show(s.configuration_set) },
        { label: "24h Send / Quota", value: show(s.sent_last_24_hours) + " / " + show(s.max_24_hour_send) },
        { label: "Send Rate", value: s.max_send_rate == null ? "—" : s.max_send_rate + "/s" },
      ])
    );
  }

  function renderBlastengine(be) {
    if (isSectionError(be)) return "<h3>blastengine</h3>" + sectionError("blastengine", be);
    var b = be || {};
    return (
      "<h3>blastengine</h3>" +
      fieldRows([
        { label: "Enabled", html: boolPill(b.enabled, "enabled", "disabled") },
        { label: "API Credentials", html: boolPill(b.credentials_configured, "Configured", "Not configured") },
        { label: "Webhook Endpoint", html: boolPill(b.webhook_endpoint_exists, "exists", "missing") },
        { label: "Webhook Credentials", html: boolPill(b.webhook_credentials_configured, "Configured", "Not configured") },
      ]) +
      (b.spec_document ? '<div class="dash-note">外部仕様の正本: <code>' + esc(b.spec_document) + "</code></div>" : "")
    );
  }

  function renderLambda(lambda) {
    if (isSectionError(lambda)) return "<h3>Lambda</h3>" + sectionError("Lambda", lambda);
    var fns = lambda && Array.isArray(lambda.functions) ? lambda.functions : [];
    var rows = fns
      .map(function (f) {
        if (isSectionError(f)) return "<tr><td>" + esc(show(f.name)) + '</td><td colspan="3" class="tone-bad">取得失敗: ' + esc(f.message) + "</td></tr>";
        return "<tr><td>" + esc(show(f.name)) + "</td><td>" + esc(show(f.runtime)) + "</td><td>" + statePill(f.state) + "</td><td>" + esc(fmtDateTime(f.last_modified)) + "</td></tr>";
      })
      .join("");
    return (
      "<h3>Lambda</h3><div class=\"dash-table-wrap\"><table class=\"dash-table\"><thead><tr><th>Name</th><th>Runtime</th><th>State</th><th>Last Modified</th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="4" class="empty-state">関数なし</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderDelivery(health) {
    if (isSectionError(health)) return '<section class="card"><h2>Delivery / Provider</h2>' + sectionError("Delivery / Provider", health) + "</section>";
    var h = health || {};
    return '<section class="card"><h2>Delivery / Provider</h2>' + renderSes(h.ses) + renderBlastengine(h.blastengine) + renderLambda(h.lambda) + "</section>";
  }

  // ---- AWS / Storage（GET /api/dashboard/health.cloudfront + reports notes）----
  function renderStorage(health, reports) {
    var cf = isSectionError(health) ? health : health && health.cloudfront;
    var html = '<section class="card"><h2>AWS / Storage</h2>';
    if (isSectionError(cf)) {
      html += "<h3>CloudFront</h3>" + sectionError("CloudFront", cf);
    } else {
      var c = cf || {};
      var li = c.last_invalidation;
      var invText = isSectionError(li) ? "取得失敗: " + (li.message || "") : li ? show(li.id) + " / " + show(li.status) + " / " + fmtDateTime(li.create_time) : "—";
      html +=
        "<h3>CloudFront</h3>" +
        fieldRows([
          { label: "Distribution", value: show(c.distribution_id) },
          { label: "Status", html: statePill(c.status) },
          { label: "Domain", value: show(c.domain_name) },
          { label: "Web Bucket", value: show(c.web_bucket) },
          { label: "Last Invalidation", value: invText },
        ]);
    }
    // S3 一覧の成否は /api/dashboard/reports の注記から分かる
    var r = isSectionError(reports) ? {} : reports || {};
    html +=
      "<h3>S3 (Report stores)</h3>" +
      fieldRows([
        { label: "published/ 一覧", html: boolPill(!r.published_backend_source, "OK", "取得失敗") },
        { label: "web data/ 一覧", html: boolPill(!r.web_deployed_note, "OK", "取得失敗") },
      ]) +
      (r.published_backend_source ? '<div class="dash-note">' + esc(r.published_backend_source) + "</div>" : "") +
      (r.web_deployed_note ? '<div class="dash-note">' + esc(r.web_deployed_note) + "</div>" : "");
    html += "</section>";
    return html;
  }

  // ---- Configuration（GET /api/health.checks.config のみ。値は表示しない）----
  function renderConfiguration(health) {
    var configOk = !isSectionError(health) && health && health.checks ? health.checks.config === true : null;
    return (
      '<section class="card"><h2>Configuration</h2>' +
      fieldRows([{ label: "LLM / Search provider 設定", html: configOk === null ? statePill("unknown") : boolPill(configOk, "OK", "要確認") }]) +
      '<div class="dash-note">現行 API は provider 名・APIキーの有無を個別には返しません（/api/health は checks.config の真偽値のみ）。値そのものは一切表示しません。</div>' +
      "</section>"
    );
  }

  /**
   * System 画面全体（純粋関数）。
   * @param {{health:Object, dashHealth:Object, reports:Object, session:Object}} payload
   *   各値は API レスポンス、または {status:"error", message} 。redact 済みが渡る前提。
   * @returns {string}
   */
  function renderSystem(payload) {
    var p = payload || {};
    var health = p.health || {};
    var dashHealth = p.dashHealth || {};
    var reports = p.reports || {};
    var session = p.session || {};

    return (
      renderApplication(health, session) +
      renderHealthChecks(health) +
      renderPipeline(reports) +
      renderDelivery(dashHealth) +
      renderStorage(dashHealth, reports) +
      renderConfiguration(health) +
      '<section class="card"><h2>Fetched</h2>' +
      fieldRows([
        { label: "/api/health generated", value: !isSectionError(dashHealth) && dashHealth.generated_at ? fmtDateTime(dashHealth.generated_at) : "—" },
        { label: "client fetch time", value: fmtDateTime((p.fetchedAt) || new Date().toISOString()) },
      ]) +
      "</section>"
    );
  }

  // -------------------------------------------------------------------------
  // ブラウザ側
  // -------------------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  async function load() {
    var container = $("system-container");
    if (!container) return;
    var btn = $("system-refresh");
    if (btn) btn.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.innerHTML = '<div class="empty-state">読み込み中…</div>';

    var settled = await Promise.allSettled([
      AdminApi.getHealth(),
      AdminApi.getDashboardHealth(),
      AdminApi.getDashboardReports(),
      AdminApi.getSession(),
    ]);

    var authFailed = settled.some(function (r) {
      return r.status === "rejected" && /認証/.test((r.reason && r.reason.message) || "");
    });
    if (authFailed) {
      container.innerHTML = '<div class="empty-state">セッションの有効期限が切れています。<a href="/system.html">再読み込み</a>してください。</div>';
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    var toSection = function (r) {
      return r.status === "fulfilled" ? redact(r.value) : { status: "error", message: (r.reason && r.reason.message) || String(r.reason) };
    };

    // /api/health も dashboard/health も両方失敗した場合だけ全体エラー
    if (settled[0].status === "rejected" && settled[1].status === "rejected" && settled[2].status === "rejected") {
      container.innerHTML = '<div class="empty-state">システム情報を読み込めませんでした: ' + esc((settled[0].reason && settled[0].reason.message) || String(settled[0].reason)) + "</div>";
      container.removeAttribute("aria-busy");
      if (btn) btn.disabled = false;
      return;
    }

    container.innerHTML = renderSystem({
      health: toSection(settled[0]),
      dashHealth: toSection(settled[1]),
      reports: toSection(settled[2]),
      session: settled[3].status === "fulfilled" ? redact(settled[3].value) : {},
      fetchedAt: new Date().toISOString(),
    });
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
    var btn = $("system-refresh");
    if (btn) btn.addEventListener("click", load);
    await load();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isSecretKey: isSecretKey,
      redact: redact,
      redactString: redactString,
      fmtDateTime: fmtDateTime,
      fmtUptime: fmtUptime,
      isSectionError: isSectionError,
      statePill: statePill,
      boolPill: boolPill,
      renderApplication: renderApplication,
      renderHealthChecks: renderHealthChecks,
      renderPipeline: renderPipeline,
      renderDelivery: renderDelivery,
      renderStorage: renderStorage,
      renderConfiguration: renderConfiguration,
      renderSystem: renderSystem,
    };
  } else {
    init();
  }
})();
