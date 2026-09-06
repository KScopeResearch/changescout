/**
 * deepseek-provider.test.js — scripts/generator/llm/deepseek-provider.js の自動テスト。
 *
 * 実DeepSeek APIへは一切接続しない（global.fetchを一時的にモック化し、リクエスト内容
 * だけを検証する）。PJ2 AOR Test B用に追加した`DEEPSEEK_THINKING_DISABLED`環境変数が、
 * 生HTTP JSON bodyのトップレベルに正しい形（`thinking: { type: "disabled" }`）で
 * 反映されること、および誤実装だった`extra_body`ラッパーが残っていないことを確認する
 * （DeepSeek公式Chat Completion APIリファレンスで`thinking`がmodel/messages等と同列の
 * トップレベルパラメータであることを確認した上での修正）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const FAKE_API_KEY = "sk-test-fake-deepseek-key-do-not-use";

function withFakeApiKey(t) {
  const original = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = FAKE_API_KEY;
  t.after(() => {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = original;
  });
}

function withThinkingDisabledEnv(t, value) {
  const original = process.env.DEEPSEEK_THINKING_DISABLED;
  if (value === undefined) delete process.env.DEEPSEEK_THINKING_DISABLED;
  else process.env.DEEPSEEK_THINKING_DISABLED = value;
  t.after(() => {
    if (original === undefined) delete process.env.DEEPSEEK_THINKING_DISABLED;
    else process.env.DEEPSEEK_THINKING_DISABLED = original;
  });
}

function mockFetchOnce(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

function freshDeepseekProvider() {
  delete require.cache[require.resolve("../llm/deepseek-provider")];
  return require("../llm/deepseek-provider");
}

function fakeSuccessResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "chatcmpl-fake",
      model: "deepseek-v4-flash",
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  };
}

test("deepseek-provider: 環境変数未設定時、request bodyにthinkingフィールドが存在しない（Case A）", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, undefined);
  const calls = mockFetchOnce(t, async () => fakeSuccessResponse());

  const provider = freshDeepseekProvider();
  await provider.callRaw({ systemPrompt: "sys", userPrompt: "user" });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.thinking, undefined, "thinkingフィールドが存在してはならない（DeepSeek既定に委ねる）");
  assert.equal(body.extra_body, undefined, "extra_bodyフィールドは常に存在してはならない");
});

test("deepseek-provider: DEEPSEEK_THINKING_DISABLED=trueの時、thinkingがトップレベルに正しい形で入る（Case B）", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, "true");
  const calls = mockFetchOnce(t, async () => fakeSuccessResponse());

  const provider = freshDeepseekProvider();
  await provider.callRaw({ systemPrompt: "sys", userPrompt: "user" });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.thinking, { type: "disabled" }, "thinkingはトップレベルに{type:\"disabled\"}で入るべき");
  assert.equal(body.extra_body, undefined, "extra_bodyという不要なSDK用ラッパーが残っていてはならない");
  // 他のパラメータが変更されていないことも確認（modelはDEEPSEEK_MODEL環境変数依存のため、
  // ハードコードせずprovider.model（同じrequireで読み込まれた値）と比較する）
  assert.equal(body.model, provider.model);
  assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0.3);
});

test("deepseek-provider: DEEPSEEK_THINKING_DISABLED=1の時もthinking:disabledが入る（真値のバリエーション）", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, "1");
  const calls = mockFetchOnce(t, async () => fakeSuccessResponse());

  const provider = freshDeepseekProvider();
  await provider.callRaw({ systemPrompt: "sys", userPrompt: "user" });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.thinking, { type: "disabled" });
});

test("deepseek-provider: DEEPSEEK_THINKING_DISABLED=falseの時、thinkingフィールドが存在しない（Case C）", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, "false");
  const calls = mockFetchOnce(t, async () => fakeSuccessResponse());

  const provider = freshDeepseekProvider();
  await provider.callRaw({ systemPrompt: "sys", userPrompt: "user" });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.thinking, undefined, "\"false\"文字列はtrue系値ではないため、thinkingフィールドを追加してはならない");
  assert.equal(body.extra_body, undefined);
});

test("deepseek-provider: APIキーの値がエラーメッセージへ露出しない", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, undefined);
  mockFetchOnce(t, async () => ({
    ok: false,
    status: 401,
    text: async () => "Unauthorized",
  }));

  const provider = freshDeepseekProvider();
  await assert.rejects(
    () => provider.callRaw({ systemPrompt: "sys", userPrompt: "user" }),
    (err) => {
      assert.ok(!err.message.includes(FAKE_API_KEY), "エラーメッセージにAPIキーの値が含まれてはならない");
      assert.ok(err.message.includes("401"));
      return true;
    }
  );
});

test("deepseek-provider: 既存のcallRaw()戻り値の形（content/usage）が変わっていない", async (t) => {
  withFakeApiKey(t);
  withThinkingDisabledEnv(t, undefined);
  mockFetchOnce(t, async () => fakeSuccessResponse());

  const provider = freshDeepseekProvider();
  const result = await provider.callRaw({ systemPrompt: "sys", userPrompt: "user" });

  assert.equal(result.content, '{"ok":true}');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 5 });
});

test("deepseek-provider: module.exportsの形（provider interface）が変わっていない", () => {
  const provider = freshDeepseekProvider();
  assert.equal(provider.id, "deepseek");
  assert.equal(provider.displayName, "DeepSeek");
  assert.equal(provider.requiresApiKey, true);
  assert.equal(typeof provider.isConfigured, "function");
  assert.equal(typeof provider.callRaw, "function");
});
