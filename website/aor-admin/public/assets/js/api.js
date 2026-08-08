/**
 * api.js — Review Dashboard バックエンドAPIへの薄いfetchラッパー（Task14、Task15でCSRF対応）。
 * UIコード（list.js/detail.js）はこのモジュール経由でのみサーバーと通信する
 * （UIとAPIの分離を保つため、fetch呼び出しをここに集約する）。
 *
 * 【Task15】POSTリクエストにはX-CSRF-Tokenヘッダーが必須（サーバー側のverifyCsrf()参照）。
 * トークンは/api/sessionから取得してキャッシュする。username・reviewer名の入力欄は
 * UI側から削除し、サーバー側が認証済みセッションのusernameを使う設計にしたため、
 * ここでは名前をbodyに含めない（サーバーがbodyのreviewer/actorを一切参照しない）。
 */

const AdminApi = (() => {
  let cachedSession = null;

  async function getJson(path) {
    const res = await fetch(path, { credentials: "same-origin" });
    if (res.status === 401) throw new Error("認証が必要です。ページを再読み込みしてください。");
    if (!res.ok) throw new Error(`${path} が失敗しました（HTTP ${res.status}）`);
    return res.json();
  }

  async function ensureSession() {
    if (cachedSession) return cachedSession;
    cachedSession = await getJson("/api/session");
    return cachedSession;
  }

  async function postJson(path, body) {
    const session = await ensureSession();
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${path} が失敗しました（HTTP ${res.status}）`);
    return data;
  }

  return {
    getSession: ensureSession,
    listReports: () => getJson("/api/reports"),
    getReport: (id) => getJson(`/api/report/${encodeURIComponent(id)}`),
    getStatus: (id) => getJson(`/api/status/${encodeURIComponent(id)}`),
    approve: (id, body) => postJson(`/api/approve/${encodeURIComponent(id)}`, body),
    reject: (id, body) => postJson(`/api/reject/${encodeURIComponent(id)}`, body),
    revise: (id, body) => postJson(`/api/revise/${encodeURIComponent(id)}`, body),
    comment: (id, body) => postJson(`/api/comment/${encodeURIComponent(id)}`, body),
    fix: (id, body) => postJson(`/api/fix/${encodeURIComponent(id)}`, body),
    publish: (id) => postJson(`/api/publish/${encodeURIComponent(id)}`, {}), // Task24
    unpublish: (id) => postJson(`/api/unpublish/${encodeURIComponent(id)}`, {}), // Task38
    subscribeEvents: (onData) => {
      const source = new EventSource("/api/events", { withCredentials: true });
      source.onmessage = (ev) => {
        try {
          onData(JSON.parse(ev.data));
        } catch (e) {
          // 不正なイベントは無視する
        }
      };
      return source;
    },

    // --- Jobs（Task16） ---
    listJobs: () => getJson("/api/jobs"),
    getJob: (id) => getJson(`/api/jobs/${encodeURIComponent(id)}`),
    getJobHistory: (limit) => getJson(`/api/jobs/history?limit=${encodeURIComponent(limit || 50)}`),
    enqueueJob: (type, params) => postJson("/api/jobs/enqueue", { type, params }),
    retryJob: (id) => postJson(`/api/jobs/${encodeURIComponent(id)}/retry`, {}),
    cancelJob: (id) => postJson(`/api/jobs/${encodeURIComponent(id)}/cancel`, {}),
    subscribeJobEvents: (onData) => {
      const source = new EventSource("/api/jobs/events", { withCredentials: true });
      source.onmessage = (ev) => {
        try {
          onData(JSON.parse(ev.data));
        } catch (e) {
          // 不正なイベントは無視する
        }
      };
      return source;
    },
  };
})();
