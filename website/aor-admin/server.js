#!/usr/bin/env node
/**
 * server.js — Review Dashboard バックエンド（Task14、Task15で認証・セッション・
 * CSRF・監査ログを追加）
 *
 * Node.js標準の http モジュールのみで実装（新規npm依存なし）。
 * UIとAPIを分離している（静的ファイル配信とAPIハンドラは別々の関数）ため、
 * 将来UI側をReact等へ置き換える場合もAPIはそのまま流用できる。
 *
 * 【重要】レビュー状態遷移のロジックは一切ここに書かない。すべて
 * scripts/generator/review/review-engine.js のPure Functionをそのまま呼び出す
 * （承認・却下・差し戻し・コメント・修正指示・publishable判定、いずれも重複実装しない）。
 *
 * 【Task15】認証はauth.js（同ディレクトリ）に分離している。HTML/CSS/JS/API/SSEの
 * すべてのルートが認証必須（Basic認証 → セッションCookie）。reviewer/actorは
 * クライアントからの入力を信用せず、必ず認証済みセッションのusernameを使う
 * （なりすまし防止のため、UIからreviewer欄を削除しただけでなく、サーバー側でも
 * クライアント指定のreviewer/actorは一切参照しない）。
 *
 * 使い方:
 *   ADMIN_USER=admin ADMIN_PASSWORD=xxxx node website/aor-admin/server.js
 *   （ADMIN_USER/ADMIN_PASSWORD未設定の場合は起動を拒否する。理由はREADME参照）
 *   （ADMIN_PORT環境変数でポート変更可、既定4600）
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const engine = require("../../scripts/generator/review/review-engine");
const reviewStore = require("../../scripts/generator/review/review-store"); // PJ2 AOR: review backend接続PoC
const { validateReport, validateReview } = require("../../scripts/generator/validate-report");
const auth = require("./auth");
const jobRunner = require("../../scripts/generator/jobs/job-runner");
const jobStore = require("../../scripts/generator/jobs/job-store");
const { createLogger } = require("../../scripts/generator/shared/logger");
const { checkLlmConfig, checkSearchConfig, formatReport } = require("../../scripts/generator/shared/config-validator"); // Task21
const { LOGS_DIR } = require("../../scripts/generator/shared/paths"); // Task23: Health API拡張用
const { publishReport, isPublished } = require("../../scripts/generator/publish-report"); // Task24
const { unpublishReport } = require("../../scripts/generator/unpublish-report"); // Task38
const { validateSlug, isWithinDir } = require("../../scripts/generator/shared/path-safety"); // Task25
const { listCompanySlugs } = require("../../scripts/generator/company-index"); // PJ2 AOR: company_slug一覧backend接続PoC
const reportStore = require("../../scripts/generator/report-store"); // PJ2 AOR: report backend接続（Phase B-5）

const logger = createLogger("aor-admin-server");
const { JOB_TYPES } = require("../../scripts/generator/jobs/job-engine");

const PORT = Number(process.env.ADMIN_PORT) || 4600;
const OUTPUT_DIR = path.join(__dirname, "..", "..", "scripts", "generator", "output");
const PUBLIC_DIR = path.join(__dirname, "public");

// Task21: package.jsonが存在しない設計のため、バージョンはここで手動管理する定数とする
// （child_process経由でgit情報を読む方式は、gitが無い実行環境での失敗リスクがあるため避けた）。
const APP_VERSION = "aor-admin/phase1-task21";
const SERVER_STARTED_AT = Date.now();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// ---------------------------------------------------------------------------
// データアクセス（scripts/generator/output/<slug>/ を読む。書き込みはreview.jsonのみ）
// ---------------------------------------------------------------------------

/**
 * 会社ディレクトリ（slug）の一覧を返す（report.jsonが存在するものだけ）。
 * PJ2 AOR: 一覧取得はcompany-index.jsのlistCompanySlugs({source:"report"})へ委譲した
 * （report.json基準というこの関数の意味自体は変えていない。従来のfilesystem直接走査と
 * 完全に等価であることをtest/company-index.test.jsで確認済み）。
 * @returns {Promise<string[]>}
 */
function listSlugs() {
  return listCompanySlugs({ source: "report" });
}

/**
 * 1社分のreport.json・review.jsonを読み込む。review.jsonが存在しない場合は
 * review-engine.jsのcreateEmptyReview()相当の初期状態を返す（ファイルは作らない、読み取り専用）。
 *
 * 【PJ2 AOR: report/review backend接続（Phase B-5）】report.jsonの読み込みを
 * `reportStore.loadReport(slug)`へ、review.jsonの読み込みを
 * `reviewStore.loadReview(slug, report.id)`へ、それぞれ移行した。いずれもfilesystem
 * backend使用時はOUTPUT_DIR/<slug>/report.json・review.jsonという、このファイルが
 * 従来使っていた`reportPath`/`reviewPath`と全く同じ物理パスを指すため、既存データとの
 * 互換性は完全に維持される。
 *
 * 【不正JSON時の挙動維持】従来は`readJsonSafe()`を使い、report.json・review.jsonの
 * どちらも「存在しない」と「不正JSON」を区別せず、いずれもnull（reviewの場合は
 * createEmptyReview()）に丸めていた。report-store.js・review-store.jsのfilesystem
 * backendはいずれも`readJson()`を使う設計のため不正JSON時は例外を投げる（Phase B-3・
 * review-store PoC双方の既存設計）。ここでtry/catchして従来と同じ「丸める」挙動を
 * 再現している（report-store.js・review-store.js自体は変更しない。publish-report.js
 * Phase B-4と同じ対処パターン）。
 * @param {string} slug
 * @returns {Promise<{slug:string, reportPath:string, reviewPath:string, report:Object|null, review:Object}|null>}
 */
async function loadCompany(slug) {
  // Task25: パストラバーサル対策（多層防御）。listSlugs()経由の呼び出し
  // （実際のディレクトリ名のみ）は常にvalidateSlug()を通過するため影響しない。
  if (!validateSlug(slug).ok) return null;

  const dir = path.join(OUTPUT_DIR, slug);
  const reportPath = path.join(dir, "report.json");
  const reviewPath = path.join(dir, "review.json");
  if (!isWithinDir(reportPath, OUTPUT_DIR) || !isWithinDir(reviewPath, OUTPUT_DIR)) return null;

  let report;
  try {
    report = await reportStore.loadReport(slug);
  } catch (err) {
    report = null;
  }
  if (!report) return null;

  let review;
  try {
    review = await reviewStore.loadReview(slug, report.id);
  } catch (err) {
    review = engine.createEmptyReview(report.id);
  }

  return { slug, reportPath, reviewPath, report, review };
}

/**
 * 一覧画面用のサマリーを1社分組み立てる。
 * publishableの値は必ずengine.isPublishable()から得る（Task14要件④: 独自判定は禁止）。
 * 【PJ2 AOR Phase 3-D-1】isPublished()がpublished-store.js経由でPromiseを返すように
 * なったため、本関数もasyncへ変更した。
 * @param {{slug:string, report:Object, review:Object}} company
 * @returns {Promise<Object>}
 */
async function toSummary(company) {
  const { slug, report, review } = company;
  const evaluation = report.evaluation || null;
  const { publishable } = engine.isPublishable(review, evaluation, report);

  return {
    id: slug,
    company_name: (report.company_profile && report.company_profile.name) || slug,
    review_status: review.status,
    evaluation_status: evaluation ? evaluation.status : null,
    evaluation_score: evaluation ? evaluation.score : null,
    evaluation_grade: evaluation ? evaluation.grade : null,
    publishable,
    published: await isPublished(slug), // Task24: 公開済みかどうか（PJ2 AOR: published-store.js経由）
    reviewer: review.reviewer,
    reviewed_at: review.reviewed_at,
  };
}

/** @returns {Promise<Object[]>} */
async function listCompanySummaries() {
  const slugs = await listSlugs();
  // PJ2 AOR: loadCompany()がasync化された（Phase B-5）ため、Promise.all()でまとめてawaitする。
  // Promise.all()は入力配列の順序を保ったまま結果を返すため、従来の同期.map()と
  // 順序の意味は変わらない。toSummary()自体もPhase 3-D-1でasync化されたため、
  // .map(toSummary)の結果もPromiseの配列になり、2段階目のPromise.all()でまとめてawaitする。
  const companies = await Promise.all(slugs.map((slug) => loadCompany(slug)));
  return Promise.all(companies.filter(Boolean).map(toSummary));
}

// ---------------------------------------------------------------------------
// Health Check（Task21要件3: GET /api/health。運用監視向けのため認証は要求しない）
// ---------------------------------------------------------------------------

/**
 * サーバーの簡易的な稼働状況を返す。secret値・内部パス等の機微情報は一切含めない
 * （Task23で`output_dir`/`logs_dir`/`config`を追加。APIキーの値そのものは決して含めず、
 * 真偽値のみを返す。判定ルールの詳細はwebsite/aor-admin/README.md「Health Check API」参照）。
 * @returns {{status:string, uptime:number, version:string, checks:{auth:boolean, jobs:boolean, output_dir:boolean, logs_dir:boolean, config:boolean}}}
 */
function buildHealthStatus() {
  const checks = {
    auth: auth.checkRequiredEnv().ok,
    jobs: true,
    output_dir: true,
    logs_dir: true,
    config: true,
  };

  try {
    jobStore.snapshot();
  } catch (e) {
    checks.jobs = false;
  }

  try {
    fs.accessSync(OUTPUT_DIR, fs.constants.R_OK);
  } catch (e) {
    checks.output_dir = false;
  }

  try {
    fs.accessSync(LOGS_DIR, fs.constants.R_OK);
  } catch (e) {
    checks.logs_dir = false;
  }

  // Task23: LLM_PROVIDER/SEARCH_PROVIDERの設定不備（非mock providerでAPIキー未設定）を反映する。
  // checkLlmConfig()/checkSearchConfig()はTask21から一貫してAPIキーの値そのものは返さず、
  // provider名と真偽値のみを返す設計のため、ここでもsecret値が混入する余地はない。
  if (checkLlmConfig().level === "error" || checkSearchConfig().level === "error") {
    checks.config = false;
  }

  const status = Object.values(checks).every(Boolean) ? "ok" : "degraded";
  return { status, uptime: Math.floor(process.uptime()), version: APP_VERSION, checks };
}

// ---------------------------------------------------------------------------
// SSE（Task14要件⑦: 一覧の自動更新。WebSocketは使わない）
// ---------------------------------------------------------------------------

const sseClients = new Set();
let watchDebounceTimer = null;

// Task46: listCompanySummaries()は全社のreport.json/review.jsonを読み込むため、
// 会社数が増えるとリクエストのたびに毎回フルスキャンするコストが無視できなくなる
// （Task45で実測: 5,000社で約1秒、10,000社で約2秒）。GET /api/reports・SSE接続の
// たびに再計算するのではなく、結果をreportsCacheへ保持し、既存のfs.watchデバウンス
// 機構（下記）が発火した時だけ再計算する。
// PJ2 AOR: listCompanySummaries()がcompany-index.js経由でasync化された（S3 backend対応の
// ため）。そのため起動時の初回計算はもうここで同期実行できない。ここでは空配列で
// 初期化するだけにし、実際の初回計算とawaitは「サーバー起動」セクション（envCheck.ok
// 判定後）で行い、その完了を待ってからserver.listen()する（意味は変えていない。
// 「fs.watchが発火する前のGET /api/reportsでも従来と同じ内容を返す」という保証は
// 維持される。詳細は起動セクションのコメント参照）。
let reportsCache = [];

/** 接続中の全SSEクライアントへ最新の一覧を送る（reportsCacheを更新し、そのまま使う。二重計算しない）。 */
async function broadcastReportsUpdate() {
  try {
    reportsCache = await listCompanySummaries();
  } catch (err) {
    // PJ2 AOR: 一覧再計算に失敗しても、既存のreportsCache（直前の正常な一覧）は
    // 保持したまま維持する（中途半端な一覧でSSEクライアントを更新しない）。
    logger.error(`reportsCacheの更新に失敗しました（直前の一覧を維持します）: ${err.stack || err.message}`);
    return;
  }
  const payload = `data: ${JSON.stringify(reportsCache)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

// scripts/generator/output/ 配下の変更（review-cli.jsによる更新・新規レポート生成等）を検知して
// 自動的にSSEで一覧を再送する。デバウンスして、連続書き込みで何度も送らないようにする。
try {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.watch(OUTPUT_DIR, { recursive: true }, () => {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(broadcastReportsUpdate, 300);
  });
} catch (e) {
  logger.warn(`output/ の監視を開始できませんでした（SSEの自動更新は無効）: ${e.message}`);
}

// ---------------------------------------------------------------------------
// Jobs SSE（Task16要件⑦: Jobs画面の自動更新。/api/eventsとは別チャンネル）
// ---------------------------------------------------------------------------

const jobSseClients = new Set();

jobRunner.onChange((snapshot) => {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  jobSseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      jobSseClients.delete(res);
    }
  });
});

// ---------------------------------------------------------------------------
// HTTPユーティリティ
// ---------------------------------------------------------------------------

/** @param {http.ServerResponse} res @param {number} status @param {Object} obj */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/** @param {http.IncomingMessage} req @returns {Promise<Object>} */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(); // 簡易的な上限（1MB）
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("リクエストボディが不正なJSONです"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * 静的ファイルを配信する。ディレクトリトラバーサル対策として、解決後のパスが
 * PUBLIC_DIR配下であることを必ず確認する。
 * @param {http.ServerResponse} res
 * @param {string} pathname
 */
function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath);
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  res.end(content);
}

// ---------------------------------------------------------------------------
// APIハンドラ
// ---------------------------------------------------------------------------

/**
 * レビュー操作系エンドポイントの共通処理: company読み込み → engineのPure Function実行 →
 * review.json保存 → 監査ログ記録 → 更新後の状態を返す。承認・却下・差し戻し・コメント・
 * 修正指示すべてこのヘルパーを通す（重複実装を避けるため）。
 *
 * 【Task15】reviewer/actorはbody（クライアント入力）からは取らず、必ず認証済み
 * session.usernameを使う。クライアントがbodyに別人の名前を仕込んでも無視される。
 *
 * 【PJ2 AOR: review backend接続PoC】review.jsonの保存は、従来の
 * `engine.saveReview(company.reviewPath, ...)`から`reviewStore.saveReview(slug, ...)`
 * （company_slugを安定したidentifierとするbackend抽象化層）へ切り替えた。
 * REVIEW_STORE_BACKEND未設定時は既定でfilesystem backendが使われ、
 * `OUTPUT_DIR/<slug>/review.json`という`company.reviewPath`と全く同じ物理パスへ
 * 書き込むため、既存の読み込み側とのデータ互換性は維持される。読み込み側
 * （loadCompany()）はPhase B-5でreportStore.loadReport()/reviewStore.loadReview()
 * 経由へ移行し、async関数になった（詳細はloadCompany()自身のコメント参照）。
 *
 * @param {http.ServerResponse} res
 * @param {string} slug
 * @param {"comment"|"fix"|"approve"|"reject"|"revise"} action
 * @param {Object} body
 * @param {{username:string}} session
 * @param {string} ip
 */
async function handleReviewAction(res, slug, action, body, session, ip) {
  const company = await loadCompany(slug);
  if (!company) {
    auth.logAudit({ user: session.username, ip, action, target: slug, success: false, detail: "company not found" });
    sendJson(res, 404, { error: `company not found: ${slug}` });
    return;
  }

  const appliers = {
    comment: (review) => engine.addComment(review, { actor: session.username, text: body.text }),
    fix: (review) => engine.addFix(review, { actor: session.username, description: body.description }),
    approve: (review) => engine.approve(review, { reviewer: session.username, comment: body.comment }),
    reject: (review) => engine.reject(review, { reviewer: session.username, comment: body.comment }),
    revise: (review) =>
      engine.requestRevision(review, { reviewer: session.username, comment: body.comment, fixes: body.fixes }),
  };

  let nextReview;
  try {
    nextReview = appliers[action](company.review);
  } catch (err) {
    auth.logAudit({ user: session.username, ip, action, target: slug, success: false, detail: err.message });
    sendJson(res, 400, { error: err.message });
    return;
  }

  await reviewStore.saveReview(slug, nextReview);
  auth.logAudit({ user: session.username, ip, action, target: slug, success: true });

  const evaluation = company.report.evaluation || null;
  const { publishable, reasons } = engine.isPublishable(nextReview, evaluation, company.report);
  sendJson(res, 200, { review: nextReview, publishable, publishable_reasons: reasons });
  broadcastReportsUpdate();
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {URL} url
 * @param {{username:string, csrfToken:string}} session
 * @param {string} ip
 * @returns {Promise<boolean>} このハンドラで処理した場合true
 */
async function handleApi(req, res, url, session, ip) {
  const { pathname } = url;

  if (pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, { username: session.username, csrf_token: session.csrfToken });
    return true;
  }

  if (pathname === "/api/reports" && req.method === "GET") {
    sendJson(res, 200, reportsCache); // Task46: 毎回フルスキャンせず、reportsCacheを返す
    return true;
  }

  if (pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(reportsCache)}\n\n`); // Task46: 同上
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return true;
  }

  let m;

  if ((m = pathname.match(/^\/api\/report\/([^/]+)$/)) && req.method === "GET") {
    const company = await loadCompany(m[1]);
    if (!company) return sendJson(res, 404, { error: `company not found: ${m[1]}` }), true;
    const evaluation = company.report.evaluation || null;
    const publishableResult = engine.isPublishable(company.review, evaluation, company.report);
    sendJson(res, 200, {
      id: company.slug,
      report: company.report,
      review: company.review,
      publishable: publishableResult.publishable,
      publishable_reasons: publishableResult.reasons,
      published: await isPublished(company.slug), // Task24 / PJ2 AOR: published-store.js経由
      validation: {
        report: validateReport(company.report),
        review: validateReview(company.review),
      },
    });
    return true;
  }

  if ((m = pathname.match(/^\/api\/status\/([^/]+)$/)) && req.method === "GET") {
    const company = await loadCompany(m[1]);
    if (!company) return sendJson(res, 404, { error: `company not found: ${m[1]}` }), true;
    const evaluation = company.report.evaluation || null;
    const { publishable, reasons } = engine.isPublishable(company.review, evaluation, company.report);
    sendJson(res, 200, { review: company.review, publishable, publishable_reasons: reasons });
    return true;
  }

  if ((m = pathname.match(/^\/api\/(comment|fix|approve|reject|revise)\/([^/]+)$/)) && req.method === "POST") {
    const [, action, slug] = m;
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    await handleReviewAction(res, slug, action, body, session, ip);
    return true;
  }

  // --- 公開API（Task24） ---
  // ロジックはすべてscripts/generator/publish-report.jsに委譲する（重複実装しない。
  // CLI（node scripts/generator/publish-report.js <slug>）と同じ関数を呼ぶ）。

  if ((m = pathname.match(/^\/api\/publish\/([^/]+)$/)) && req.method === "POST") {
    const slug = m[1];
    const result = await publishReport(slug); // PJ2 AOR: publishReport()がreview-store経由になりasync化されたため
    if (!result.ok) {
      auth.logAudit({ user: session.username, ip, action: "publish", target: slug, success: false, detail: result.error });
      sendJson(res, 400, { error: result.error, reasons: result.reasons || [] });
      return true;
    }
    auth.logAudit({ user: session.username, ip, action: "publish", target: slug, success: true });
    sendJson(res, 200, { ok: true, slug, published: true });
    broadcastReportsUpdate(); // 一覧のpublished表示をSSEで即座に反映する
    return true;
  }

  // --- 公開取り消しAPI（Task38） ---
  // ロジックはすべてscripts/generator/unpublish-report.jsに委譲する（重複実装しない。
  // CLI（node scripts/generator/unpublish-report.js <slug>）と同じ関数を呼ぶ）。

  if ((m = pathname.match(/^\/api\/unpublish\/([^/]+)$/)) && req.method === "POST") {
    const slug = m[1];
    const result = await unpublishReport(slug); // PJ2 AOR Phase 3-D-1: published-store.js経由でasync化
    if (!result.ok) {
      auth.logAudit({ user: session.username, ip, action: "unpublish", target: slug, success: false, detail: result.error });
      sendJson(res, 400, { error: result.error });
      return true;
    }
    auth.logAudit({
      user: session.username,
      ip,
      action: "unpublish",
      target: slug,
      success: true,
      detail: result.alreadyUnpublished ? "already_unpublished" : null,
    });
    sendJson(res, 200, { ok: true, slug, published: false, already_unpublished: !!result.alreadyUnpublished });
    broadcastReportsUpdate(); // 一覧のpublished表示をSSEで即座に反映する
    return true;
  }

  // --- Jobs API（Task16） ---
  // ロジックはすべてscripts/generator/jobs/job-runner.jsに委譲する（重複実装しない）。

  if (pathname === "/api/jobs" && req.method === "GET") {
    sendJson(res, 200, { snapshot: jobStore.snapshot(), job_types: JOB_TYPES });
    return true;
  }

  if (pathname === "/api/jobs/history" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit")) || 50;
    sendJson(res, 200, jobRunner.readHistory(limit));
    return true;
  }

  if (pathname === "/api/jobs/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(jobStore.snapshot())}\n\n`);
    jobSseClients.add(res);
    req.on("close", () => jobSseClients.delete(res));
    return true;
  }

  if (pathname === "/api/jobs/enqueue" && req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }
    try {
      const job = jobRunner.enqueue(body.type, body.params || {}, { maxAttempts: body.maxAttempts });
      auth.logAudit({ user: session.username, ip, action: "job_enqueue", target: `${body.type}:${job.id}`, success: true });
      sendJson(res, 200, job);
    } catch (err) {
      auth.logAudit({ user: session.username, ip, action: "job_enqueue", target: body.type, success: false, detail: err.message });
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  if ((m = pathname.match(/^\/api\/jobs\/([^/]+)$/)) && req.method === "GET") {
    const job = jobStore.getJob(m[1]);
    if (!job) return sendJson(res, 404, { error: `job not found: ${m[1]}` }), true;
    sendJson(res, 200, job);
    return true;
  }

  if ((m = pathname.match(/^\/api\/jobs\/([^/]+)\/(retry|cancel)$/)) && req.method === "POST") {
    const [, id, action] = m;
    try {
      const job = action === "retry" ? jobRunner.retry(id) : jobRunner.cancel(id);
      auth.logAudit({ user: session.username, ip, action: `job_${action}`, target: id, success: true });
      sendJson(res, 200, job);
    } catch (err) {
      auth.logAudit({ user: session.username, ip, action: `job_${action}`, target: id, success: false, detail: err.message });
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// サーバー起動
// ---------------------------------------------------------------------------

const envCheck = auth.checkRequiredEnv();
if (!envCheck.ok) {
  logger.error(`起動を中止しました: ${envCheck.message}`);
  process.exitCode = 1;
} else {
  // PJ2 AOR: reportsCache初期化（listCompanySummaries()）がcompany-index.js経由でasync化
  // されたため、module top-levelで同期実行できなくなった。ここでIIFEにしてawaitし、
  // 「cache初期化完了前にserverをlistenさせない・初期化失敗時に中途半端なserverを
  // 起動しない」を満たす。GET /api/reports・SSEのレスポンス形式・reportsCacheの意味は
  // 一切変更していない（従来通り「事前計算済みの一覧をそのまま返す」）。
  startServer().catch((err) => {
    logger.error(`起動を中止しました: reportsCacheの初期化に失敗しました: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
}

async function startServer() {
  reportsCache = await listCompanySummaries();

  // Task23: 起動時復旧。前回プロセスが「実行中」のまま終了したジョブがあれば、
  // job-history.jsonlへstatus:"interrupted"の記録を残す（job構造・キューの状態遷移は
  // 変更しない。詳細はjob-runner.js「起動時復旧（Task23）」参照）。
  const recoveredCount = jobRunner.recoverInterruptedJobs();
  if (recoveredCount > 0) {
    logger.warn(`前回終了時に実行中だったジョブ ${recoveredCount} 件をinterrupted扱いにしました`);
  }

  const server = http.createServer(async (req, res) => {
    auth.applySecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ip = auth.clientIp(req);

    // Task21: /api/health は外部の監視ツール（ロードバランサのヘルスチェック等）が
    // Basic認証なしで叩けるよう、authenticate()を経由させない（他の/api/*は全て認証必須のまま）。
    // secret値は返さないため、認証なしで公開しても情報漏洩にはならない。
    if (url.pathname === "/api/health" && req.method === "GET") {
      const health = buildHealthStatus();
      sendJson(res, health.status === "ok" ? 200 : 503, health);
      return;
    }

    // /logout はauthenticate()（401チャレンジを出しうる）を経由せず直接処理する
    // （未ログイン状態でアクセスされても単にCookieを消して/へ戻すだけでよいため）。
    if (url.pathname === "/logout") {
      const existing = auth.getSessionFromRequest(req);
      if (existing) {
        auth.destroySession(existing.sid);
        auth.logAudit({ user: existing.session.username, ip, action: "logout", target: null, success: true });
      }
      auth.clearSessionCookie(res);
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    const authResult = auth.authenticate(req, res, { ip });
    if (!authResult) return; // 401（WWW-Authenticate）は authenticate() が送信済み
    const { session } = authResult;

    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST" && !auth.verifyCsrf(req, session)) {
        auth.logAudit({ user: session.username, ip, action: "csrf_failed", target: url.pathname, success: false });
        sendJson(res, 403, { error: "CSRFトークンが不正です（X-CSRF-Tokenヘッダーを確認してください）" });
        return;
      }

      handleApi(req, res, url, session, ip)
        .then((handled) => {
          if (!handled) sendJson(res, 404, { error: `unknown API endpoint: ${url.pathname}` });
        })
        .catch((err) => {
          // Task23: ここは各APIハンドラの想定内バリデーションエラー（400、err.messageをそのまま
          // 返す。review-engine.js/job-runner.js等が投げる安全なメッセージのみ）とは異なり、
          // fsエラー等の「想定外」の例外を拾う場所。Node標準のfsエラーメッセージには絶対パスが
          // 含まれるため、詳細はサーバー側ログにのみ残し、レスポンスには汎用メッセージのみ返す
          // （内部パスを露出しないため）。
          logger.error(`APIエラー: ${err.stack || err.message}`);
          sendJson(res, 500, { error: "サーバー内部でエラーが発生しました" });
        });
      return;
    }

    try {
      serveStatic(res, url.pathname);
    } catch (err) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.listen(PORT, () => {
    console.log(`Review Dashboard: http://localhost:${PORT}`);
    console.log(`  データソース: ${OUTPUT_DIR}`);
    console.log(`  監査ログ: ${auth.AUDIT_LOG_PATH}`);
    console.log(`  ジョブ履歴: ${jobRunner.HISTORY_PATH}`);
    console.log(`  Health Check: http://localhost:${PORT}/api/health`);

    // Task21: LLM_PROVIDER/SEARCH_PROVIDERの設定状況を起動時に案内表示する（あくまで情報提供）。
    // ADMIN_USER/ADMIN_PASSWORD（envCheck、上記）とは異なりここでは起動をブロックしない。
    // 理由: Review DashboardはJob RunnerでAI分析ジョブを実行しない限りLLM/検索providerを
    // 呼ばないため（既存レポートの閲覧・承認/却下だけならLLM/検索の設定は不要）、設定不備を
    // 理由に閲覧すらできなくするのは過剰。ジョブ実行時にはllm-client.js/search-client.js
    // 自身が既存の実行時チェック（エラー/mockフォールバック）を行う。
    // 完全な設定確認には `node scripts/generator/check-config.js` を使う。
    console.log("  設定チェック（LLM/検索、参考情報。ジョブ実行時に改めて検証されます）:");
    console.log(formatReport([checkLlmConfig(), checkSearchConfig()]));
  });

  // Task16要件④: 一定間隔でのジョブ自動投入（スケジューラ）。
  // 【安全のための既定値】JOB_SCHEDULER_ENABLED=true を明示しない限り自動起動しない
  // （Review Dashboardを単に立ち上げただけで、意図せず全社のレポートが再生成され始める
  // ことを避けるため）。間隔はJOB_SCHEDULER_INTERVAL_MS（既定: 24時間）。
  if (process.env.JOB_SCHEDULER_ENABLED === "true") {
    const intervalMs = Number(process.env.JOB_SCHEDULER_INTERVAL_MS) || 24 * 60 * 60 * 1000;
    jobRunner.startScheduler(intervalMs);
    console.log(`  スケジューラ: 有効（${intervalMs}ms間隔でgenerate-reportを自動投入）`);
  } else {
    console.log("  スケジューラ: 無効（JOB_SCHEDULER_ENABLED=true で有効化）");
  }

  module.exports = { server, listCompanySummaries, loadCompany };
}

