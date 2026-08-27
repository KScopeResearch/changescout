/**
 * unsubscribe-url.test.js — scripts/generator/leads/unsubscribe-url.js の自動テスト。
 * すべてPure Functionのため、ネットワーク接続・ファイルI/O・外部サービス接続は一切行わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildUnsubscribeUrl, buildListUnsubscribeHeaders } = require("../leads/unsubscribe-url");

// ---------------------------------------------------------------------------
// buildUnsubscribeUrl
// ---------------------------------------------------------------------------

test("buildUnsubscribeUrl: baseUrl・leadId・reportTokenからunsubscribe.htmlへのURLを組み立てる", () => {
  const url = buildUnsubscribeUrl("https://aor.example.jp", {
    leadId: "lead-abc123",
    reportToken: "token-xyz789",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://aor.example.jp/unsubscribe.html");
  assert.equal(parsed.searchParams.get("lead"), "lead-abc123");
  assert.equal(parsed.searchParams.get("token"), "token-xyz789");
});

test("buildUnsubscribeUrl: baseUrlの末尾スラッシュ有無どちらでも同じ結果になる", () => {
  const withSlash = buildUnsubscribeUrl("https://aor.example.jp/", { leadId: "l1", reportToken: "t1" });
  const withoutSlash = buildUnsubscribeUrl("https://aor.example.jp", { leadId: "l1", reportToken: "t1" });
  assert.equal(withSlash, withoutSlash);
});

test("buildUnsubscribeUrl: emailをURLへ一切含めない", () => {
  const url = buildUnsubscribeUrl("https://aor.example.jp", { leadId: "l1", reportToken: "t1" });
  assert.equal(url.includes("@"), false);
});

// ---------------------------------------------------------------------------
// buildListUnsubscribeHeaders
// ---------------------------------------------------------------------------

test("buildListUnsubscribeHeaders: mailtoAddress指定時はmailtoとURLの両方を含む（RFC 8058形式）", () => {
  const headers = buildListUnsubscribeHeaders({
    unsubscribeUrl: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1",
    mailtoAddress: "aor-report@changescout.jp",
  });
  assert.equal(
    headers["List-Unsubscribe"],
    "<mailto:aor-report@changescout.jp>, <https://aor.example.jp/unsubscribe.html?lead=l1&token=t1>"
  );
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("buildListUnsubscribeHeaders: mailtoAddress省略時はURLのみになる", () => {
  const headers = buildListUnsubscribeHeaders({
    unsubscribeUrl: "https://aor.example.jp/unsubscribe.html?lead=l1&token=t1",
  });
  assert.equal(headers["List-Unsubscribe"], "<https://aor.example.jp/unsubscribe.html?lead=l1&token=t1>");
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});
