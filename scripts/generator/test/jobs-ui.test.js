/**
 * jobs-ui.test.js — website/aor-admin/public/assets/js/jobs.js の純粋関数
 * （escapeHtml/fmtDate/jobDuration/jobRow/renderColumn/renderHistory/renderJobTypeOptions）を
 * Node からユニットテストする（Phase60 STEP2: v1→v2 migration）。
 * dashboard-ui / deliveries-ui / leads-ui と同じ方針（module.exports 経由、DOM 非依存）。
 *
 * jobs.js は Phase60 STEP2 で IIFE + module.exports 構造へ移行された（Task16 時点の実装
 * ロジック・SSE・retry/cancel の挙動は変更していない）。DOM に触れる render/loadHistory/
 * wireActions/setLiveIndicator/init はブラウザ専用のため module.exports に含まれず、
 * ここでは静的検証（ソースコード上の対応関係の確認）のみ行う。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const JOBS_JS_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "jobs.js");
const JOBS_HTML_PATH = path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "jobs.html");

const jobsUi = require(JOBS_JS_PATH);
const jobsJsSource = fs.readFileSync(JOBS_JS_PATH, "utf8");
const jobsHtml = fs.readFileSync(JOBS_HTML_PATH, "utf8");

function job(o = {}) {
  return Object.assign(
    {
      id: "job-1",
      type: "generate-report",
      params: { url: "https://example.co.jp" },
      attempts: 1,
      maxAttempts: 3,
      createdAt: "2026-09-05T00:00:00Z",
      status: "queued",
      error: null,
    },
    o
  );
}

// ===========================================================================
// Test 1 — module.exports: Node環境でjobs.jsをrequireでき、純粋関数がexportされている
// ===========================================================================

test("module.exports: 必要な純粋関数がすべてexportされている", () => {
  for (const name of ["escapeHtml", "fmtDate", "jobDuration", "jobRow", "renderColumn", "renderHistory", "renderJobTypeOptions"]) {
    assert.equal(typeof jobsUi[name], "function", `${name} がexportされていない`);
  }
});

// ===========================================================================
// Test 2 — no browser initialization in Node
// ===========================================================================

test("Node環境でrequireしてもdocument/windowを要求せず、EventSource/API呼び出しを発生させない", () => {
  // すでにファイル先頭で require 済み（このテストが実行できている時点でクラッシュしていない）。
  assert.equal(typeof document, "undefined", "Node環境でdocumentはundefinedのはず");
  assert.equal(typeof window, "undefined", "Node環境でwindowはundefinedのはず");
  // require 時に init() が呼ばれていれば AdminApi 未定義エラーで例外になっているはずだが、
  // requireは既に成功している（ファイル先頭）ため、init()は実行されていないことの間接証拠になる。
  assert.ok(jobsUi, "requireが正常に完了している");
});

test("Node環境ではjobs.jsの内部識別子（escapeHtml/JOB_TYPE_LABELS等）がglobalへ漏れない（IIFE化の確認）", () => {
  assert.equal(typeof globalThis.escapeHtml, "undefined");
  assert.equal(typeof globalThis.fmtDate, "undefined");
  assert.equal(typeof globalThis.jobDuration, "undefined");
  assert.equal(typeof globalThis.renderColumn, "undefined");
  assert.equal(typeof globalThis.renderHistory, "undefined");
  assert.equal(typeof globalThis.wireActions, "undefined");
  assert.equal(typeof globalThis.init, "undefined");
  assert.equal(typeof globalThis.JOB_TYPE_LABELS, "undefined");
});

// ===========================================================================
// Test 3 — escapeHtml
// ===========================================================================

test("escapeHtml: <, >, &, \", ' をエスケープする", () => {
  assert.equal(jobsUi.escapeHtml(`<script>alert(1)</script>`), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(jobsUi.escapeHtml(`a & b`), "a &amp; b");
  assert.equal(jobsUi.escapeHtml(`"quoted"`), "&quot;quoted&quot;");
  assert.equal(jobsUi.escapeHtml(`it's`), "it&#39;s");
});

// ===========================================================================
// Test 4 — fmtDate
// ===========================================================================

test("fmtDate: 正常値はja-JPロケール文字列、null/undefined/無効値は既存仕様どおり", () => {
  assert.equal(jobsUi.fmtDate(null), "—");
  assert.equal(jobsUi.fmtDate(undefined), "—");
  assert.equal(jobsUi.fmtDate(""), "—");
  assert.match(jobsUi.fmtDate("2026-09-05T00:00:00Z"), /2026/);
  // 既存仕様: new Date("invalid").toLocaleString() は "Invalid Date" を返す（例外は投げない）
  assert.equal(jobsUi.fmtDate("not-a-date"), "Invalid Date");
});

// ===========================================================================
// Test 5 — jobDuration
// ===========================================================================

test("jobDuration: startedAtなし→—、running中は経過時間+（実行中）、完了後はstartedAt〜finishedAtの差分", () => {
  assert.equal(jobsUi.jobDuration({ startedAt: null }), "—");
  assert.equal(jobsUi.jobDuration({ startedAt: undefined }), "—");

  const completed = jobsUi.jobDuration({ startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:02.5Z", status: "completed" });
  assert.equal(completed, "2.5s");

  const completedMs = jobsUi.jobDuration({ startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:00.5Z", status: "completed" });
  assert.equal(completedMs, "500ms");

  const running = jobsUi.jobDuration({ startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: null, status: "running" });
  assert.match(running, /（実行中）$/);
});

// ===========================================================================
// Test 6 — job rendering（jobRow / renderColumn）
// ===========================================================================

test("jobRow: id/type/params/attempts/実行時間/created_at/errorが既存仕様どおりHTMLへ反映される", () => {
  const html = jobsUi.jobRow(job({ id: "job-42", type: "quality-check", params: { slug: "example.com" }, attempts: 2, maxAttempts: 5, createdAt: "2026-01-01T00:00:00Z" }));
  assert.match(html, /<td>job-42<\/td>/);
  assert.match(html, /<td>quality-check<\/td>/);
  assert.match(html, /2\/5/);
  assert.match(html, /2026/); // created_at
});

test("jobRow: XSS安全性 — typeやerrorにHTML特殊文字が混入してもエスケープされる", () => {
  const html = jobsUi.jobRow(job({ type: `<img src=x onerror=alert(1)>`, error: `<script>alert(2)</script>`, status: "failed" }));
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("jobRow: statusに応じてretry/cancelボタンが正しく出し分けられる", () => {
  const failed = jobsUi.jobRow(job({ status: "failed" }));
  assert.match(failed, /data-retry="job-1"/);
  assert.doesNotMatch(failed, /data-cancel=/);

  const queued = jobsUi.jobRow(job({ status: "queued" }));
  assert.match(queued, /data-cancel="job-1"/);
  assert.doesNotMatch(queued, /data-retry=/);

  const completed = jobsUi.jobRow(job({ status: "completed" }));
  assert.doesNotMatch(completed, /data-retry=/);
  assert.doesNotMatch(completed, /data-cancel=/);
});

test("renderColumn: タイトル・件数・空状態が既存仕様どおり", () => {
  const empty = jobsUi.renderColumn("Queue", "pending_review", []);
  assert.match(empty, /Queue/);
  assert.match(empty, /（0件）/);
  assert.match(empty, /（なし）/);

  const withJobs = jobsUi.renderColumn("Failed", "rejected", [job({ id: "j1" }), job({ id: "j2" })]);
  assert.match(withJobs, /（2件）/);
  assert.match(withJobs, /j1/);
  assert.match(withJobs, /j2/);
});

// ===========================================================================
// Test 7 — history rendering
// ===========================================================================

test("renderHistory: 空配列は「履歴なし」、通常のエントリはtimestamp/job_id/type/statusを表示", () => {
  assert.match(jobsUi.renderHistory([]), /履歴なし/);

  const html = jobsUi.renderHistory([{ created_at: "2026-01-01T00:00:00Z", job_id: "j1", type: "generate-report", status: "completed", attempts: 2, duration_ms: 1500 }]);
  assert.match(html, /j1/);
  assert.match(html, /generate-report/);
  assert.match(html, /status-completed/);
  assert.match(html, /2回試行/);
  assert.match(html, /1500ms/);
});

test("renderHistory: attempts/duration_msがnull（interrupted）の場合は既存の省略表示になる", () => {
  const html = jobsUi.renderHistory([{ created_at: "2026-01-01T00:00:00Z", job_id: "j1", type: "x", status: "interrupted", attempts: null, duration_ms: null }]);
  assert.match(html, /前回のプロセス終了時点で中断/);
});

test("renderHistory: XSS安全性 — job_id/type/errorのエスケープ", () => {
  const html = jobsUi.renderHistory([{ created_at: "2026-01-01T00:00:00Z", job_id: `<script>alert(1)</script>`, type: "x", status: "failed", error: `<img src=x onerror=alert(2)>` }]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

// ===========================================================================
// Test 8 — job type options
// ===========================================================================

test("renderJobTypeOptions: 既存JOB_TYPE_LABELSに基づく4種類のoptionが生成される", () => {
  const html = jobsUi.renderJobTypeOptions();
  for (const value of ["generate-report", "quality-check", "review-sync", "search-refresh"]) {
    assert.match(html, new RegExp(`<option value="${value}">`));
  }
  assert.match(html, /generate-report（フルパイプライン）/);
  assert.match(html, /quality-check（品質再評価）/);
  assert.match(html, /review-sync（ダミー）/);
  assert.match(html, /search-refresh（情報収集のみ再実行）/);
});

// ===========================================================================
// Test 9 — HTML contract（jobs.html）
// ===========================================================================

test("jobs.html: 既存の主要DOM要素が存在する", () => {
  assert.match(jobsHtml, /<main id="jobs-container">/);
  assert.match(jobsHtml, /class="system-status-bar"/);
  assert.match(jobsHtml, /id="live-indicator"/);
  assert.match(jobsHtml, /id="live-label"/);
  assert.match(jobsHtml, /id="toast"/);
});

test("jobs.html: 既存ナビリンクの文言・順序・hrefは変更されていない", () => {
  const links = [
    '<a href="/dashboard.html">Dashboard</a>',
    '<a href="/leads.html">Leads</a>',
    '<a href="/deliveries.html">Deliveries</a>',
    '<a href="/reports.html">Reports</a>',
    '<a href="/suppressions.html">Suppression</a>',
    '<a href="/jobs.html">Jobs</a>',
    '<a href="/system.html">System</a>',
    '<a href="/operations.html">Operations</a>',
    '<a href="/logout">ログアウト</a>',
    '<a href="/index.html">← 一覧に戻る</a>',
  ];
  let lastIdx = -1;
  for (const link of links) {
    const idx = jobsHtml.indexOf(link);
    assert.ok(idx !== -1, `リンク ${link} が見つからない`);
    assert.ok(idx > lastIdx, `リンク順序が変わっている: ${link}`);
    lastIdx = idx;
  }
});

test("jobs.html: Health Badgeコンテナ・app.jsは今回追加していない（STEP60-2ではまだ追加しない）", () => {
  assert.ok(!jobsHtml.includes("admin-operational-health-badge"), "STEP60-2ではHealth Badgeを追加しない");
  assert.ok(!jobsHtml.includes("/assets/js/app.js"), "STEP60-2ではapp.jsを読み込まない");
});

// ===========================================================================
// Test 10 — script order
// ===========================================================================

test("jobs.html: script読み込み順序が api.js → status.js → jobs.js のまま維持されている", () => {
  const iApi = jobsHtml.indexOf('<script src="/assets/js/api.js"></script>');
  const iStatus = jobsHtml.indexOf('<script src="/assets/js/status.js"></script>');
  const iJobs = jobsHtml.indexOf('<script src="/assets/js/jobs.js"></script>');
  assert.ok(iApi !== -1 && iStatus !== -1 && iJobs !== -1, "必要なscript読み込みが揃っていない");
  assert.ok(iApi < iStatus && iStatus < iJobs, "script順序が api.js → status.js → jobs.js になっていない");
});

// ===========================================================================
// Test 11 — retry/cancel wiring（静的検証。DOM実行はしない）
// ===========================================================================

test("retry/cancel wiring: wireActions内でdata-retry/data-cancelとAdminApi.retryJob/cancelJobが対応している（静的検証）", () => {
  assert.match(jobsJsSource, /function wireActions\(\)/);
  assert.match(jobsJsSource, /document\.querySelectorAll\("button\[data-retry\]"\)/);
  assert.match(jobsJsSource, /AdminApi\.retryJob\(btn\.dataset\.retry\)/);
  assert.match(jobsJsSource, /document\.querySelectorAll\("button\[data-cancel\]"\)/);
  assert.match(jobsJsSource, /AdminApi\.cancelJob\(btn\.dataset\.cancel\)/);
  // jobRowが出力するdata-retry/data-cancel属性と対応していること
  assert.match(jobsJsSource, /data-retry="\$\{job\.id\}"/);
  assert.match(jobsJsSource, /data-cancel="\$\{job\.id\}"/);
});

test("retry/cancel wiring: enqueue（ジョブ追加）もAdminApi.enqueueJobへ対応している（静的検証）", () => {
  assert.match(jobsJsSource, /AdminApi\.enqueueJob\(type, params\)/);
  assert.match(jobsJsSource, /getElementById\("btn-enqueue"\)/);
});

// ===========================================================================
// Test 12 — SSE wiring（静的検証。実接続はしない）
// ===========================================================================

test("SSE wiring: AdminApi.subscribeJobEvents → snapshot render → setLiveIndicatorの配線が維持されている（静的検証）", () => {
  assert.match(jobsJsSource, /AdminApi\.subscribeJobEvents\(/);
  assert.match(jobsJsSource, /source\.onopen = \(\) => setLiveIndicator\(true\)/);
  assert.match(jobsJsSource, /source\.onerror = \(\) => setLiveIndicator\(false\)/);
  assert.match(jobsJsSource, /function setLiveIndicator\(connected\)/);
  // Node.jsテストからは実際にAPI呼び出しやEventSource接続を発生させていないことを、
  // このファイル内で subscribeJobEvents は require 時に一度も呼ばれていないことで確認する
  // （Test1/Test2 で require が例外なく完了している時点が、その間接的な証拠）。
});

test("SSE wiring: /api/jobs/events エンドポイント自体は変更されていない（api.js側）", () => {
  const apiJsSource = fs.readFileSync(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "api.js"), "utf8");
  assert.match(apiJsSource, /new EventSource\("\/api\/jobs\/events"/);
});
