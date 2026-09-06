/**
 * system-ui.test.js — website/aor-admin/public/assets/js/system.js（Phase52 STEP9）。
 * dashboard-ui / reports-ui 等と同じ方針（module.exports 経由、DOM 非依存）。
 * secret masking（§34）と partial failure（§23）を重点的に確認する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ui = require(path.join(__dirname, "..", "..", "..", "website", "aor-admin", "public", "assets", "js", "system.js"));

// GET /api/health の実測形状
const HEALTH = {
  status: "ok",
  uptime: 93784,
  version: "aor-admin/phase1-task21",
  checks: { auth: true, jobs: true, output_dir: true, logs_dir: true, config: true },
};
// GET /api/dashboard/health の実測形状
const DASH_HEALTH = {
  generated_at: "2026-09-06T00:00:00Z",
  ses: {
    production_access_enabled: true,
    review_status: "GRANTED",
    sending_enabled: true,
    enforcement_status: "HEALTHY",
    dkim_status: "SUCCESS",
    configuration_set: "pj2-aor-delivery",
    sent_last_24_hours: 3,
    max_24_hour_send: 50000,
    max_send_rate: 14,
  },
  lambda: { functions: [{ name: "pj2-aor-weekly-report-delivery", runtime: "nodejs24.x", state: "Active", last_modified: "2026-08-29T00:35:13.000+0000" }] },
  cloudfront: { distribution_id: "E1TGUCT9CYALRK", status: "Deployed", domain_name: "d261eor7y01afd.cloudfront.net", web_bucket: "changescout-pj2-aor-web-179127602551", last_invalidation: { id: "I2NZ", status: "Completed", create_time: "2026-09-05T13:52:36.903Z" } },
  blastengine: { credentials_configured: true, webhook_credentials_configured: true, webhook_endpoint_exists: true, enabled: true, spec_document: "docs/external-provider-confirmations.md" },
};
const REPORTS = { generated_at: "2026-09-06T00:00:00Z", generated: 5, approved: 4, published_backend: 3, web_deployed: 7, deploy_pending: 0, pending_slugs: [] };

test("isSecretKey: token/secret/credential/api_key/authorization/password/access_key 系（snake/camel/大小）を検出", () => {
  for (const k of ["api_key", "apiKey", "API_KEY", "access_token", "accessToken", "secret", "secretKey", "private_key", "session_token", "authorization", "password", "passwd", "AWS_SECRET_ACCESS_KEY", "bearerToken", "cookie"]) {
    assert.equal(ui.isSecretKey(k), true, `${k} は secret 判定されるべき`);
  }
  for (const k of ["status", "version", "uptime", "region", "domain_name", "configuration_set", "generated_at"]) {
    assert.equal(ui.isSecretKey(k), false, `${k} は secret ではない`);
  }
});

test("redact: secret 系キーの値を伏せる（§34 fixture — SUPER_SECRET が一切残らない）", () => {
  const fixture = {
    api_key: "SUPER_SECRET",
    apiKey: "SUPER_SECRET",
    secret: "SUPER_SECRET",
    password: "SUPER_SECRET",
    authorization: "Bearer SUPER_SECRET",
    access_token: "SUPER_SECRET",
    nested: { credentials: { secret_key: "SUPER_SECRET" }, list: [{ private_key: "SUPER_SECRET" }] },
    safe_value: "ok-to-show",
  };
  const out = ui.redact(fixture);
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, /SUPER_SECRET/);
  assert.match(json, /ok-to-show/); // 非 secret はそのまま
});

test("redactString: error message 中の Bearer / api_key=... を伏せる（§26）", () => {
  assert.doesNotMatch(ui.redactString("failed: Authorization: Bearer abcdef123456"), /abcdef123456/);
  assert.doesNotMatch(ui.redactString("error api_key=SUPERSECRETVALUE at line 3"), /SUPERSECRETVALUE/);
  assert.equal(ui.redactString("plain error, no secrets"), "plain error, no secrets");
});

test("fmtUptime: 秒 → d/h/m、異常値は —", () => {
  assert.equal(ui.fmtUptime(0), "0m");
  assert.equal(ui.fmtUptime(93784), "1d 2h 3m");
  assert.equal(ui.fmtUptime(-1), "—");
  assert.equal(ui.fmtUptime("x"), "—");
});

test("statePill: Backend の status 文字列をそのまま（healthy/ok→緑, degraded→橙, unknown→中立）", () => {
  assert.match(ui.statePill("ok"), /status-approved/);
  assert.match(ui.statePill("healthy"), /status-approved/);
  assert.match(ui.statePill("degraded"), /status-needs_revision/);
  assert.match(ui.statePill("unhealthy"), /status-rejected/);
  assert.match(ui.statePill("weird-value"), /status-pending_review/);
  assert.match(ui.statePill("weird-value"), />weird-value</);
});

test("renderApplication: /api/health の値をそのまま（Frontend で再判定しない）", () => {
  const html = ui.renderApplication(HEALTH, { username: "admin" });
  assert.match(html, /aor-admin\/phase1-task21/);
  assert.match(html, /1d 2h 3m/);
  assert.match(html, /admin/);
  assert.match(html, /Overall Status/);
});

test("renderApplication: health が error セクションなら sectionError", () => {
  assert.match(ui.renderApplication({ status: "error", message: "server down" }, {}), /dash-section-error/);
  assert.match(ui.renderApplication({ status: "error", message: "server down" }, {}), /server down/);
});

test("renderHealthChecks: checks を ● OK / ○ NG のテーブルで", () => {
  const html = ui.renderHealthChecks({ ...HEALTH, checks: { auth: true, jobs: false, output_dir: true, logs_dir: true, config: false } });
  assert.match(html, /Job Store/);
  assert.match(html, /LLM\/Search Config/);
  assert.match(html, /OK/);
  assert.match(html, /NG/);
});

test("renderDelivery: SES/blastengine/Lambda を表示、Configured/Not configured で状態のみ", () => {
  const html = ui.renderDelivery(DASH_HEALTH);
  assert.match(html, /GRANTED/);
  assert.match(html, /pj2-aor-delivery/);
  assert.match(html, /Configured/); // blastengine API Credentials
  assert.match(html, /pj2-aor-weekly-report-delivery/);
  assert.match(html, /nodejs24\.x/);
});

test("renderDelivery: partial failure — ses だけ error でも他は表示（§23）", () => {
  const html = ui.renderDelivery({ ...DASH_HEALTH, ses: { status: "error", message: "AccessDenied" } });
  assert.match(html, /dash-section-error/);
  assert.match(html, /AccessDenied/);
  assert.match(html, /pj2-aor-weekly-report-delivery/); // lambda は生きている
  assert.match(html, /external-provider-confirmations\.md/); // blastengine も生きている
});

test("renderStorage: CloudFront + S3 一覧の成否（reports の注記から）", () => {
  const ok = ui.renderStorage(DASH_HEALTH, REPORTS);
  assert.match(ok, /E1TGUCT9CYALRK/);
  assert.match(ok, /changescout-pj2-aor-web-179127602551/);

  const s3fail = ui.renderStorage(DASH_HEALTH, { ...REPORTS, published_backend_source: "reportsCache (S3 published/ 一覧取得失敗)" });
  assert.match(s3fail, /取得失敗/);
  assert.match(s3fail, /一覧取得失敗/);
});

test("renderConfiguration: 値は出さず Configured/要確認/unknown のみ、注記を添える", () => {
  assert.match(ui.renderConfiguration(HEALTH), /OK/);
  assert.match(ui.renderConfiguration({ ...HEALTH, checks: { ...HEALTH.checks, config: false } }), /要確認/);
  assert.match(ui.renderConfiguration({ status: "error", message: "x" }), /unknown/i);
  assert.match(ui.renderConfiguration(HEALTH), /APIキーの有無を個別には返しません/);
});

test("renderPipeline: /api/dashboard/reports の値をそのまま、deploy_pending>0 で警告", () => {
  assert.doesNotMatch(ui.renderPipeline(REPORTS), /dash-alert/);
  const pending = ui.renderPipeline({ ...REPORTS, deploy_pending: 2, pending_slugs: ["a", "b"] });
  assert.match(pending, /dash-alert/);
  assert.match(pending, />a</);
  assert.match(pending, />b</);
});

test("renderSystem: 全セクションを描画。1 API の失敗で他を healthy 扱いしない（§23）", () => {
  const html = ui.renderSystem({
    health: HEALTH,
    dashHealth: { status: "error", message: "AWS unreachable" },
    reports: REPORTS,
    session: { username: "admin" },
  });
  for (const h of ["Application", "Health Checks", "Report Pipeline", "Delivery / Provider", "AWS / Storage", "Configuration"]) {
    assert.ok(html.includes(h), `${h} セクションがない`);
  }
  assert.match(html, /AWS unreachable/); // dashHealth は error として表示
  assert.match(html, /aor-admin\/phase1-task21/); // health は生きている
});

test("renderSystem: redact 済みでも SUPER_SECRET が混じったペイロードから漏れない（DOM 相当の HTML 文字列で確認）", () => {
  const evil = {
    status: "degraded",
    version: "v1",
    checks: { auth: true },
    api_key: "SUPER_SECRET",
    error: "boom: Bearer SUPER_SECRET_TOKEN",
  };
  const html = ui.renderSystem({
    health: ui.redact(evil),
    dashHealth: ui.redact({ ses: { status: "error", message: "denied: aws_secret_access_key=SUPER_SECRET" }, lambda: {}, cloudfront: {}, blastengine: {} }),
    reports: { status: "error", message: "x" },
    session: {},
  });
  assert.doesNotMatch(html, /SUPER_SECRET/);
});

test("XSS: version / status / provider / error message の悪性文字列をエスケープ", () => {
  const evil = "<script>alert(1)</script>";
  const html = ui.renderSystem({
    health: { status: evil, version: evil, uptime: 1, checks: { auth: true } },
    dashHealth: {
      ses: { status: "error", message: '"><img src=x onerror=alert(1)>' },
      blastengine: { enabled: true, spec_document: evil },
      lambda: { functions: [{ name: evil, runtime: evil, state: evil, last_modified: null }] },
      cloudfront: { distribution_id: evil, status: evil, domain_name: evil, web_bucket: evil },
    },
    reports: { generated: evil, published_backend_source: evil },
    session: { username: evil },
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
});
