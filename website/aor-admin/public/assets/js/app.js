/**
 * app.js — Admin 共通ナビゲーション用ユーティリティ（Phase59 STEP10）。
 *
 * 【現状（重要）】Admin の各画面（dashboard.html / operations.html / reports.html /
 * system.html 等）には現時点で共有ナビゲーション JS が存在せず、ヘッダーは各 HTML に
 * 静的な <a> リンクとして個別に書かれている。本ファイルは Phase59 STEP10 の時点では
 * 純粋関数（Operational Health バッジ / Tooltip / Navigation Health Summary の HTML 組み立て）
 * のみを提供する **読み取り専用ユーティリティ** であり、まだどの HTML ページからも
 * <script> 読み込みされておらず、DOM への配線（各ページのヘッダーへの実際の挿入）は
 * このファイルのスコープ外（別 STEP で判断・実施する）。
 *
 * 【設計方針】dashboard.js / operations.js / reports.js / system.js と同じ「値をそのまま
 * 表示・独自判定なし」の方針。ここでも Deploy Ready / published_stale / published_orphan の
 * 再計算は一切行わない（すべて AdminApi.getDashboardOperationalHealth() の生レスポンスを
 * 転記するのみ）。バッジの表示テキスト（🟢 Healthy 等）・Tooltip 文言は固定の静的マッピングで、
 * ブラウザ側で status を再判定するロジックは書かない。
 *
 * ブラウザでは window.NavigationHealth、Node（テスト）では module.exports で公開する
 * （report-status.js / status.js と同じ公開パターン）。
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

  // STEP1: status → バッジ表示（絵文字 + ラベル）の固定マッピング。判定ロジックはこれだけ
  // （AdminApi.getDashboardOperationalHealth().status の値をキーに引くのみで、
  // stale/orphan/deploy_ready 等からの再判定は一切行わない）。
  var STATUS_BADGE_LABEL = { success: "🟢 Healthy", warning: "🟡 Attention", danger: "🔴 Blocked" };

  // STEP2: status → Tooltip 静的文言の固定マッピング。
  var STATUS_TOOLTIP = {
    success: "Published artifacts are synchronized and deployment is not blocked.",
    warning: "Published artifacts require remediation before deployment.",
    danger: "Deployment is blocked due to orphan published artifacts.",
  };

  /**
   * §4 legacy 判定: summary が無い／status が文字列でない／summary.generated_reports が
   * 無い（Phase59 STEP5 の additive フィールド）のいずれかに該当すれば legacy とみなす。
   * STEP6〜9 の Published Artifact Audit 系セクションと同じ legacy ガード規約を踏襲する。
   * @param {Object} operationalHealth - GET /api/dashboard/operational-health の生レスポンス
   * @returns {boolean}
   */
  function isLegacy(operationalHealth) {
    if (!operationalHealth || typeof operationalHealth !== "object") return true;
    if (isSectionError(operationalHealth)) return true;
    if (typeof operationalHealth.status !== "string") return true;
    var summary = operationalHealth.summary;
    if (!summary || typeof summary !== "object") return true;
    if (summary.generated_reports === undefined) return true;
    return false;
  }

  /**
   * STEP1 + STEP2: Operational Health ナビゲーションバッジ（Tooltip 付き）。
   * status のみを使い、値はそのまま表示する（ブラウザ側で判定ロジックを書かない）。
   * legacy の場合は "" を返し、バッジ自体を出さない（§4）。
   * @param {Object} operationalHealth - GET /api/dashboard/operational-health の生レスポンス
   * @returns {string}
   */
  function renderHealthBadge(operationalHealth) {
    if (isLegacy(operationalHealth)) return "";
    var status = operationalHealth.status;
    var label = STATUS_BADGE_LABEL[status];
    if (!label) return ""; // 未知の status（success/warning/danger 以外）も非表示
    var tooltip = STATUS_TOOLTIP[status] || "";
    return '<span class="nav-health-badge" title="' + esc(tooltip) + '">' + esc(label) + "</span>";
  }

  /**
   * STEP3: Navigation Health Summary（Deploy Ready / Published Stale / Published Orphan）。
   * summary の値をそのまま表示する（再計算禁止）。legacy の場合は "" を返す（§4）。
   * @param {Object} operationalHealth - GET /api/dashboard/operational-health の生レスポンス
   * @returns {string}
   */
  function renderNavigationHealthSummary(operationalHealth) {
    if (isLegacy(operationalHealth)) return "";
    var summary = operationalHealth.summary || {};
    var deployReadyText = summary.deploy_ready === true ? "Yes" : "No";
    var stale = summary.published_stale == null ? 0 : summary.published_stale;
    var orphan = summary.published_orphan == null ? 0 : summary.published_orphan;
    return (
      '<span class="nav-health-summary">' +
      '<span class="nav-health-item">Deploy Ready: ' + esc(deployReadyText) + "</span>" +
      '<span class="nav-health-item">Published Stale: ' + esc(stale) + "</span>" +
      '<span class="nav-health-item">Published Orphan: ' + esc(orphan) + "</span>" +
      "</span>"
    );
  }

  /**
   * STEP1〜STEP3 をまとめた Navigation Health 要素（バッジ + Tooltip + Summary）。
   * §5: Admin 共通ナビゲーションでは Dashboard/Reports/Operations/System の後に置く想定
   * （この関数自体は他ナビ項目の順序を持たない。実際の HTML への配線は別 STEP で行う）。
   * legacy の場合は "" を返し、何も追加しない（§4: バッジ・サマリー・Tooltip とも非表示）。
   * @param {Object} operationalHealth - GET /api/dashboard/operational-health の生レスポンス
   * @returns {string}
   */
  function renderNavigationHealth(operationalHealth) {
    var badge = renderHealthBadge(operationalHealth);
    if (!badge) return "";
    return '<span class="nav-health">' + badge + renderNavigationHealthSummary(operationalHealth) + "</span>";
  }

  var api = {
    esc: esc,
    isSectionError: isSectionError,
    isLegacy: isLegacy,
    STATUS_BADGE_LABEL: STATUS_BADGE_LABEL,
    STATUS_TOOLTIP: STATUS_TOOLTIP,
    renderHealthBadge: renderHealthBadge,
    renderNavigationHealthSummary: renderNavigationHealthSummary,
    renderNavigationHealth: renderNavigationHealth,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.NavigationHealth = api;
  }
})();
