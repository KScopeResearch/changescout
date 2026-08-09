/**
 * error-handling.test.js — Task23: エラーハンドリング統一の対象となった挙動の自動テスト。
 *
 * 【スコープ】不正JSON・存在しないfile・不正status・API異常レスポンスは、既存の
 * validator.test.js/review.test.js/search.test.js/llm.test.js等ですでに広くカバーされている
 * （例: validateReview()の不正status検出、search-clientの不正なresults形状の検出）。
 * ここでは重複を避け、Task23で新設・変更した部分（config-validator.js・redact.js・
 * shared/cli-utils.jsのDEBUG時stack表示・job-runner.jsの起動時復旧）を対象にする。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { readJson } = require("../shared/json-file");
const { redactSecrets } = require("../shared/redact");
const {
  checkRequiredVars,
  checkAdminConfig,
  checkLlmConfig,
  checkSearchConfig,
  checkAll,
} = require("../shared/config-validator");

// ---------------------------------------------------------------------------
// 不正JSON・存在しないfile（json-file.js: readJson）
// ---------------------------------------------------------------------------

test("readJson: 存在しないファイルは例外を投げる", () => {
  const missingPath = path.join(os.tmpdir(), `aor-error-handling-test-missing-${Date.now()}.json`);
  assert.throws(() => readJson(missingPath));
});

test("readJson: 不正なJSON内容の場合は例外を投げる（壊れた内容のまま読み込ませない）", () => {
  const badPath = path.join(os.tmpdir(), `aor-error-handling-test-bad-${Date.now()}.json`);
  fs.writeFileSync(badPath, "{ this is not valid json ", "utf-8");
  try {
    assert.throws(() => readJson(badPath), /SyntaxError|Unexpected/);
  } finally {
    fs.unlinkSync(badPath);
  }
});

// ---------------------------------------------------------------------------
// config-validator.js（Task21で追加、Task23まで専用テストが無かった）
// ---------------------------------------------------------------------------

test("checkRequiredVars: 環境変数が全て設定されていればok:true", () => {
  const original = { A: process.env.AOR_TEST_VAR_A, B: process.env.AOR_TEST_VAR_B };
  process.env.AOR_TEST_VAR_A = "x";
  process.env.AOR_TEST_VAR_B = "y";
  try {
    const result = checkRequiredVars(["AOR_TEST_VAR_A", "AOR_TEST_VAR_B"]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
  } finally {
    if (original.A === undefined) delete process.env.AOR_TEST_VAR_A;
    else process.env.AOR_TEST_VAR_A = original.A;
    if (original.B === undefined) delete process.env.AOR_TEST_VAR_B;
    else process.env.AOR_TEST_VAR_B = original.B;
  }
});

test("checkRequiredVars: 未設定の変数をmissingとして返す", () => {
  const original = process.env.AOR_TEST_VAR_MISSING;
  delete process.env.AOR_TEST_VAR_MISSING;
  try {
    const result = checkRequiredVars(["AOR_TEST_VAR_MISSING"]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["AOR_TEST_VAR_MISSING"]);
  } finally {
    if (original !== undefined) process.env.AOR_TEST_VAR_MISSING = original;
  }
});

test("checkAdminConfig: ADMIN_USER/ADMIN_PASSWORD未設定はlevel:error", () => {
  const original = { user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASSWORD };
  delete process.env.ADMIN_USER;
  delete process.env.ADMIN_PASSWORD;
  try {
    const result = checkAdminConfig();
    assert.equal(result.ok, false);
    assert.equal(result.level, "error");
  } finally {
    if (original.user !== undefined) process.env.ADMIN_USER = original.user;
    if (original.pass !== undefined) process.env.ADMIN_PASSWORD = original.pass;
  }
});

test("checkLlmConfig: LLM_PROVIDER未設定（既定mock）は常にok", () => {
  const original = process.env.LLM_PROVIDER;
  delete process.env.LLM_PROVIDER;
  try {
    const result = checkLlmConfig();
    assert.equal(result.ok, true);
    assert.equal(result.providerId, "mock");
  } finally {
    if (original !== undefined) process.env.LLM_PROVIDER = original;
  }
});

test("checkLlmConfig: 非mock providerでAPIキー未設定はlevel:error（llm-client.jsの実行時エラーと整合）", () => {
  const original = { provider: process.env.LLM_PROVIDER, key: process.env.DEEPSEEK_API_KEY };
  process.env.LLM_PROVIDER = "deepseek";
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = checkLlmConfig();
    assert.equal(result.ok, false);
    assert.equal(result.level, "error");
    assert.equal(result.providerId, "deepseek");
  } finally {
    if (original.provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = original.provider;
    if (original.key !== undefined) process.env.DEEPSEEK_API_KEY = original.key;
  }
});

test("checkSearchConfig: 非mock providerでAPIキー未設定はlevel:warn（search-clientの自動フォールバックと整合、ブロッキングにしない）", () => {
  const original = { provider: process.env.SEARCH_PROVIDER, key: process.env.TAVILY_API_KEY };
  process.env.SEARCH_PROVIDER = "tavily";
  delete process.env.TAVILY_API_KEY;
  try {
    const result = checkSearchConfig();
    assert.equal(result.ok, false);
    assert.equal(result.level, "warn");
  } finally {
    if (original.provider === undefined) delete process.env.SEARCH_PROVIDER;
    else process.env.SEARCH_PROVIDER = original.provider;
    if (original.key !== undefined) process.env.TAVILY_API_KEY = original.key;
  }
});

test("checkAll: warnのみ（LLM/SEARCHがmockでADMIN設定済み）ならok:true", () => {
  const original = { user: process.env.ADMIN_USER, pass: process.env.ADMIN_PASSWORD };
  process.env.ADMIN_USER = "test";
  process.env.ADMIN_PASSWORD = "test";
  try {
    const { ok, results } = checkAll();
    assert.equal(ok, true);
    assert.equal(results.length, 3);
  } finally {
    if (original.user === undefined) delete process.env.ADMIN_USER;
    else process.env.ADMIN_USER = original.user;
    if (original.pass === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = original.pass;
  }
});

// ---------------------------------------------------------------------------
// redact.js（Task23で追加）
// ---------------------------------------------------------------------------

test("redactSecrets: OpenAI/DeepSeek/Qwen系のsk-キーを伏せ字にする", () => {
  const out = redactSecrets("Incorrect API key provided: sk-proj-abc123XYZ456789");
  assert.ok(!out.includes("abc123XYZ456789"));
  assert.ok(out.includes("[REDACTED]"));
});

test("redactSecrets: Tavily系のtvly-キーを伏せ字にする", () => {
  const out = redactSecrets("TAVILY_API_KEY=tvly-abcdef123456 が不正です");
  assert.ok(!out.includes("abcdef123456"));
  assert.ok(out.includes("[REDACTED]"));
});

test("redactSecrets: Authorization: Bearer ヘッダーを伏せ字にする", () => {
  const out = redactSecrets("Authorization: Bearer sk-abcdefghij1234567890");
  assert.ok(!out.includes("1234567890"));
});

test("redactSecrets: AWS_SECRET_ACCESS_KEY/AWS_ACCESS_KEY_ID系の代入パターンを伏せ字にする（PJ2 Phase3で追加）", () => {
  const out1 = redactSecrets("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY が不正です");
  assert.ok(!out1.includes("wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"));
  assert.ok(out1.includes("[REDACTED]"));

  const out2 = redactSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE が不正です");
  assert.ok(!out2.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(out2.includes("[REDACTED]"));
});

test("redactSecrets: 秘密情報を含まない通常のエラーメッセージは変更しない", () => {
  const msg = "quality-check job には params.slug が必須です";
  assert.equal(redactSecrets(msg), msg);
});

test("redactSecrets: ファイルパスを誤って伏せ字にしない（過剰検出を避ける）", () => {
  const msg = "report.jsonが見つかりません: C:\\Users\\kouda.LEVEL\\changescout\\scripts\\generator\\output\\example.com\\report.json";
  assert.equal(redactSecrets(msg), msg);
});

test("redactSecrets: null/undefined/空文字はそのまま返す", () => {
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  assert.equal(redactSecrets(""), "");
});

// ---------------------------------------------------------------------------
// job-runner.js: 起動時復旧（Task23で追加）
// ---------------------------------------------------------------------------

test("job-runner: recoverInterruptedJobs()は実行中マークが残っていればinterrupted履歴を残し、マークを消す", () => {
  const runner = require("../jobs/job-runner");
  const { readJsonLines } = require("../shared/json-file");

  const fakeId = `job-test-recovery-${Date.now()}`;
  const state = {};
  state[fakeId] = { type: "quality-check", params: { slug: "example.com" }, started_at: new Date().toISOString() };
  fs.writeFileSync(runner.RUNTIME_STATE_PATH, JSON.stringify(state));

  const recoveredCount = runner.recoverInterruptedJobs();
  assert.equal(recoveredCount, 1);

  const stateAfter = JSON.parse(fs.readFileSync(runner.RUNTIME_STATE_PATH, "utf-8"));
  assert.deepEqual(stateAfter, {});

  const lastEntry = readJsonLines(runner.HISTORY_PATH).slice(-1)[0];
  assert.equal(lastEntry.job_id, fakeId);
  assert.equal(lastEntry.status, "interrupted");
  assert.ok(lastEntry.error);

  // 2回目は復旧対象なし
  assert.equal(runner.recoverInterruptedJobs(), 0);
});

// ---------------------------------------------------------------------------
// shared/cli-utils.js: runCli()のDEBUG時stack表示（Task23で追加）
// ---------------------------------------------------------------------------

test("runCli: 例外を捕捉してprocess.exitCode=1を設定する（process.exit()は呼ばない）", async () => {
  const { runCli } = require("../shared/cli-utils");
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCli(async () => {
      throw new Error("テスト用の意図的な例外");
    });
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test("runCli: 正常終了時はexitCodeを変更しない", async () => {
  const { runCli } = require("../shared/cli-utils");
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCli(async () => {
      /* 何もしない（正常終了） */
    });
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = originalExitCode;
  }
});
