/**
 * report-status.js — Report の状態表示に関する共通ユーティリティ（Phase52 STEP8）。
 *
 * Dashboard（dashboard.js の Report Summary）と Reports UI（reports.js）が、同じ Backend
 * 値から同じ意味の status を表示できるよう、両者が参照する唯一の実装をここへ集約する。
 *
 * 【重要】ここでも業務判定は行わない：
 *   - deploy_pending / pending_slugs は Backend（scripts/generator/shared/dashboard-aggregates.js
 *     の collectReportSummary）が算出した値。ここでは差集合の再計算をしない。
 *   - reportDeployState() は「Backend が返した pending_slugs 配列に、その report.id が
 *     含まれるか」を見るだけ（membership check）。pending_slugs 自体を組み立て直さない。
 *
 * ブラウザでは window.ReportStatus、Node（テスト）では module.exports で公開する。
 */

(function () {
  "use strict";

  /** セクションが {status:"error"} 形状か（dashboard.js の isSectionError と同一）。 */
  function isSectionError(v) {
    return !!v && typeof v === "object" && v.status === "error";
  }

  /**
   * deploy_pending 件数の表示トーン。
   *   null/undefined（Web 一覧の取得失敗）→ "dim"
   *   > 0（Web 未反映あり）              → "warn"
   *   0                                  → "ok"
   */
  function deployPendingTone(n) {
    if (n === null || n === undefined) return "dim";
    return n > 0 ? "warn" : "ok";
  }

  /** review.status → status-pill の色クラス（admin.css の既存クラス）。 */
  function reviewStatusClass(status) {
    switch (status) {
      case "approved":
        return "status-approved";
      case "rejected":
        return "status-rejected";
      case "needs_revision":
        return "status-needs_revision";
      case "pending_review":
        return "status-pending_review";
      default:
        return "status-pending_review";
    }
  }

  /**
   * 1 レポートの Web デプロイ状態を、Backend が返した pending_slugs 配列から判定する。
   * @param {string} reportId          レポート識別子（= company_slug）
   * @param {(string[]|null|undefined)} pendingSlugs  GET /api/dashboard/reports の pending_slugs
   * @param {(number|null|undefined)} webDeployed     同 web_deployed（null なら Web 一覧が取れていない）
   * @returns {"deployed"|"pending"|"unknown"}
   */
  function reportDeployState(reportId, pendingSlugs, webDeployed) {
    if (webDeployed === null || webDeployed === undefined) return "unknown";
    if (Array.isArray(pendingSlugs) && pendingSlugs.indexOf(reportId) !== -1) return "pending";
    return "deployed";
  }

  /** reportDeployState の値 → 表示ラベルと色トーン。 */
  function deployStateLabel(state) {
    if (state === "pending") return { label: "Deploy Pending", tone: "warn" };
    if (state === "deployed") return { label: "Deployed", tone: "ok" };
    if (state === "not_published") return { label: "Not Published", tone: "dim" };
    return { label: "Unknown", tone: "dim" };
  }

  var api = {
    isSectionError: isSectionError,
    deployPendingTone: deployPendingTone,
    reviewStatusClass: reviewStatusClass,
    reportDeployState: reportDeployState,
    deployStateLabel: deployStateLabel,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    window.ReportStatus = api;
  }
})();
