/**
 * shared.test.js — Task18: scripts/generator/shared/配下の自動テスト。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readJson, readJsonSafe, writeJson, appendJsonLine, readJsonLines } = require("../shared/json-file");
const { withRetryAndTimeout, callOnceWithTimeout } = require("../shared/retry");
const { nowIso, isValidIso8601, ISO_8601_PATTERN } = require("../shared/date-utils");
const { createLogger, isDebugEnabled } = require("../shared/logger");
const { archiveIfOversize, pruneOlderThan } = require("../shared/log-rotation"); // Task43
const paths = require("../shared/paths");

function tmpFile(name) {
  return path.join(os.tmpdir(), `aor-shared-test-${process.pid}-${name}`);
}

test("json-file: writeJson→readJsonの往復で内容が一致する", () => {
  const file = tmpFile("roundtrip.json");
  writeJson(file, { a: 1, b: "テスト" });
  const result = readJson(file);
  assert.deepEqual(result, { a: 1, b: "テスト" });
  fs.unlinkSync(file);
});

test("json-file: readJsonSafeは存在しないファイルでfallbackを返す（例外を投げない）", () => {
  const result = readJsonSafe(tmpFile("does-not-exist.json"), { fallback: true });
  assert.deepEqual(result, { fallback: true });
});

test("json-file: appendJsonLine/readJsonLinesの往復", () => {
  const file = tmpFile("lines.jsonl");
  if (fs.existsSync(file)) fs.unlinkSync(file);
  appendJsonLine(file, { n: 1 });
  appendJsonLine(file, { n: 2 });
  const lines = readJsonLines(file);
  assert.deepEqual(lines, [{ n: 1 }, { n: 2 }]);
  fs.unlinkSync(file);
});

test("json-file: readJsonLinesは壊れた行をスキップする", () => {
  const file = tmpFile("broken-lines.jsonl");
  fs.writeFileSync(file, '{"ok":true}\nnot-json\n{"ok":2}\n', "utf-8");
  const lines = readJsonLines(file);
  assert.deepEqual(lines, [{ ok: true }, { ok: 2 }]);
  fs.unlinkSync(file);
});

test("retry: 成功時はそのまま結果を返す", async () => {
  const result = await withRetryAndTimeout(async () => "ok", { timeoutMs: 1000, maxRetries: 2 });
  assert.equal(result, "ok");
});

test("retry: タイムアウトすると必ずtimeoutMsで確定する（fnがハングしても）", async () => {
  const start = Date.now();
  await assert.rejects(
    () => withRetryAndTimeout(() => new Promise(() => {}), { timeoutMs: 150, maxRetries: 0 }),
    /タイムアウト/
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `タイムアウトが即座に効くはず（実測${elapsed}ms）`);
});

test("retry: 指定回数リトライしてから成功した場合は結果を返す", async () => {
  let attempts = 0;
  const result = await withRetryAndTimeout(
    async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail once");
      return "recovered";
    },
    { timeoutMs: 1000, maxRetries: 2, backoffMs: 10 }
  );
  assert.equal(result, "recovered");
  assert.equal(attempts, 2);
});

test("callOnceWithTimeout: 正常終了時はresultを返す", async () => {
  const result = await callOnceWithTimeout(async () => 42, 1000);
  assert.equal(result, 42);
});

// --- 現行仕様の明文化（Phase48 STEP8 read-only調査） -------------------------
// withRetryAndTimeout() は err.retryable を参照しない。timeout以外のあらゆるエラーを
// maxRetries 回まで再試行し、最終的に "(maxRetries+1)回とも失敗しました" を投げる。
// blastengine-client / ses-client が付与する err.retryable / err.statusCode / err.code は
// この最終エラーには引き継がれない（呼び出し側の job history 記録用途のみ）。
test("retry: retryableでないエラー（HTTP 400相当）でもmaxRetries回まで再試行される（現行仕様）", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetryAndTimeout(
        async () => {
          attempts++;
          throw Object.assign(new Error("HTTP 400 bad request"), {
            retryable: false,
            statusCode: 400,
            code: null,
          });
        },
        { timeoutMs: 1000, maxRetries: 2, backoffMs: 5, label: "テストAPI" }
      ),
    (err) => {
      assert.match(err.message, /テストAPIが3回とも失敗しました/);
      assert.match(err.message, /HTTP 400 bad request/);
      // 最終エラーは素の Error。retryable/statusCode は失われる。
      assert.equal(err.retryable, undefined);
      assert.equal(err.statusCode, undefined);
      return true;
    }
  );
  assert.equal(attempts, 3, "maxRetries:2 → 合計3回試行される");
});

test("retry: maxRetries:0 なら1回のみ試行して即座に失敗する", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetryAndTimeout(
        async () => {
          attempts++;
          throw new Error("即時失敗");
        },
        { timeoutMs: 1000, maxRetries: 0, label: "テストAPI" }
      ),
    /テストAPIが1回とも失敗しました/
  );
  assert.equal(attempts, 1);
});

test("date-utils: nowIso()はISO_8601_PATTERNにマッチする", () => {
  const value = nowIso();
  assert.ok(ISO_8601_PATTERN.test(value));
  assert.equal(isValidIso8601(value), true);
});

test("date-utils: isValidIso8601は不正な値をfalseと判定する", () => {
  assert.equal(isValidIso8601("not-a-date"), false);
  assert.equal(isValidIso8601(""), false);
  assert.equal(isValidIso8601(null), false);
});

test("logger: createLoggerはdebug/info/warn/errorを持つ", () => {
  const logger = createLogger("test-scope");
  assert.equal(typeof logger.debug, "function");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
});

test("logger: AOR_DEBUG未設定時はisDebugEnabled()がfalse", () => {
  const original = process.env.AOR_DEBUG;
  delete process.env.AOR_DEBUG;
  try {
    assert.equal(isDebugEnabled(), false);
  } finally {
    if (original !== undefined) process.env.AOR_DEBUG = original;
  }
});

test("logger: AOR_DEBUG=trueでisDebugEnabled()がtrueになる", () => {
  const original = process.env.AOR_DEBUG;
  process.env.AOR_DEBUG = "true";
  try {
    assert.equal(isDebugEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.AOR_DEBUG;
    else process.env.AOR_DEBUG = original;
  }
});

test("paths: OUTPUT_DIR/LOGS_DIR/PROMPTS_DIRがscripts/generator/配下を指す", () => {
  assert.ok(paths.OUTPUT_DIR.endsWith(path.join("generator", "output")));
  assert.ok(paths.LOGS_DIR.endsWith(path.join("generator", "logs")));
  assert.ok(paths.PROMPTS_DIR.endsWith(path.join("generator", "prompts")));
  assert.ok(fs.existsSync(paths.GENERATOR_DIR));
});

// ---------------------------------------------------------------------------
// log-rotation（Task43）: archiveIfOversize() / pruneOlderThan()
// 実際のscripts/generator/logs/配下のファイルには一切触れず、os.tmpdir()配下の
// 一時ファイルのみを対象にする。
// ---------------------------------------------------------------------------

test("log-rotation: archiveIfOversizeはサイズが閾値未満なら何もしない", () => {
  const file = tmpFile("archive-under-threshold.jsonl");
  fs.writeFileSync(file, '{"n":1}\n', "utf-8");
  archiveIfOversize(file, 1024 * 1024); // 十分大きい閾値
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.readFileSync(file, "utf-8"), '{"n":1}\n');
  fs.unlinkSync(file);
});

test("log-rotation: archiveIfOversizeはサイズが閾値以上ならアーカイブへ退避し、内容を保持する", () => {
  const file = tmpFile("archive-over-threshold.jsonl");
  const content = '{"n":1}\n{"n":2}\n';
  fs.writeFileSync(file, content, "utf-8");

  archiveIfOversize(file, content.length); // ちょうど閾値以上になるよう設定

  assert.equal(fs.existsSync(file), false, "元のパスはリネームで消えるはず（次の追記で新規作成される）");
  const archived = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(path.basename(file) + ".archive-"));
  assert.equal(archived.length, 1, "アーカイブファイルが1つ作られるはず");
  const archivedPath = path.join(path.dirname(file), archived[0]);
  assert.equal(fs.readFileSync(archivedPath, "utf-8"), content, "アーカイブ内容は元の内容と完全に一致するはず");
  fs.unlinkSync(archivedPath);
});

test("log-rotation: archiveIfOversizeは存在しないファイルに対しては何もしない（例外を投げない）", () => {
  assert.doesNotThrow(() => archiveIfOversize(tmpFile("does-not-exist.jsonl"), 100));
});

test("log-rotation: pruneOlderThanは保持期間より古い行を削除し、新しい行は残す", () => {
  const file = tmpFile("prune-basic.jsonl");
  const now = Date.now();
  const old = new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100日前
  const recent = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1日前
  fs.writeFileSync(file, `${JSON.stringify({ id: "old", created_at: old })}\n${JSON.stringify({ id: "recent", created_at: recent })}\n`, "utf-8");

  pruneOlderThan(file, 90, "created_at");

  const remaining = readJsonLines(file);
  assert.deepEqual(remaining.map((r) => r.id), ["recent"], "90日より古い行のみ削除されるはず");
  fs.unlinkSync(file);
});

test("log-rotation: pruneOlderThanは不正/欠落した日時フィールドの行を安全側で残す", () => {
  const file = tmpFile("prune-invalid-date.jsonl");
  fs.writeFileSync(
    file,
    `${JSON.stringify({ id: "invalid-date", created_at: "not-a-date" })}\n${JSON.stringify({ id: "no-field" })}\n`,
    "utf-8"
  );

  pruneOlderThan(file, 1, "created_at"); // 1日という短い保持期間でも、日時が不正なら消えないはず

  const remaining = readJsonLines(file);
  assert.deepEqual(remaining.map((r) => r.id).sort(), ["invalid-date", "no-field"]);
  fs.unlinkSync(file);
});

test("log-rotation: pruneOlderThanは壊れたJSON行を安全側で残す", () => {
  const file = tmpFile("prune-broken-json.jsonl");
  fs.writeFileSync(file, `not-valid-json\n${JSON.stringify({ id: "ok", created_at: new Date().toISOString() })}\n`, "utf-8");

  pruneOlderThan(file, 90, "created_at");

  const raw = fs.readFileSync(file, "utf-8");
  assert.ok(raw.includes("not-valid-json"), "壊れた行も削除されずに残るはず");
  fs.unlinkSync(file);
});

test("log-rotation: pruneOlderThanは削除対象が無ければファイルに触れない", () => {
  const file = tmpFile("prune-noop.jsonl");
  const content = `${JSON.stringify({ id: "recent", created_at: new Date().toISOString() })}\n`;
  fs.writeFileSync(file, content, "utf-8");

  pruneOlderThan(file, 90, "created_at");

  assert.equal(fs.readFileSync(file, "utf-8"), content);
  fs.unlinkSync(file);
});
