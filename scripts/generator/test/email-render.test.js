/**
 * email-render.test.js — Phase55 STEP4
 * scripts/generator/leads/email-render.js（Initial / Weekly メールの組み立て）を検証する。
 * Email ↔ Preview の内容一致・data safety・link 保持・email-safe HTML を重視する。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const T = require(path.join(__dirname, "..", "shared", "report-teaser"));
const R = require(path.join(__dirname, "..", "leads", "email-render"));
const { loadReport: load } = require("./fixtures/aor-reports");

const REPORT_URL = "https://d261eor7y01afd.cloudfront.net/report-preview.html?company=SLUG&lead=LEAD1&token=TOK1";
const UNSUB_URL = "https://d261eor7y01afd.cloudfront.net/unsubscribe.html?lead=LEAD1&token=TOK1";

function emailFor(slug) {
  const r = load(slug);
  const url = REPORT_URL.replace("SLUG", slug);
  const teaser = T.buildTeaser(r, url);
  return { r, url, teaser, em: R.renderInitialReportEmail(teaser, { unsubscribeUrl: UNSUB_URL }) };
}

/* ---------- 3社: 構造・link ---------- */

test("renderInitialReportEmail: subject/preheader/text/html が揃う（3社）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { em } = emailFor(s);
    assert.ok(em.subject && em.subject.length > 5, s + " subject");
    assert.ok(em.preheader && em.preheader.length > 5, s + " preheader");
    assert.ok(em.text.includes("運営事務局"), s + " text");
    assert.match(em.html, /^<!doctype html>/i, s + " html");
  });
});

test("renderInitialReportEmail: reportUrl を text は生・html はエスケープ後で保持する（company/lead/token）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { em, url } = emailFor(s);
    assert.ok(em.text.includes(url), s + " text に reportUrl");
    assert.ok(em.html.includes(url.replace(/&/g, "&amp;")), s + " html に reportUrl（escaped）");
    // token/lead が欠けていない
    assert.match(em.text, /lead=LEAD1/);
    assert.match(em.text, /token=TOK1/);
  });
});

test("renderInitialReportEmail: unsubscribe は URL リンク + 返信案内の両方を残す", () => {
  const { em } = emailFor("ab-i.jp");
  assert.ok(em.text.includes(UNSUB_URL));
  assert.match(em.text, /ご返信/);
  assert.ok(em.html.includes(UNSUB_URL.replace(/&/g, "&amp;")));
});

test("renderInitialReportEmail: unsubscribeUrl 未指定なら返信のみ案内（後方互換）", () => {
  const { teaser } = emailFor("kscope.co.jp");
  const em = R.renderInitialReportEmail(teaser, {});
  assert.match(em.text, /本メールに直接ご返信/);
});

/* ---------- Email ↔ Preview 一致 ---------- */

test("Email ↔ Preview: Opportunity title が report.free_opportunity.title と一致する（メールで別表現にしない）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { em, r } = emailFor(s);
    assert.ok(em.text.includes(r.free_opportunity.title), s + " text");
    assert.ok(em.html.includes(r.free_opportunity.title), s + " html");
  });
});

test("Email ↔ Preview: whyNow は report.why_now の部分文字列（矛盾しない）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { teaser, r } = emailFor(s);
    const rep = r.free_opportunity.why_now.replace(/（src-\d+[^）]*）/g, "").replace(/\s/g, "");
    const tea = teaser.whyNow.replace(/…$/, "").replace(/\s/g, "");
    assert.ok(rep.includes(tea) || rep.startsWith(tea.slice(0, 20)), s + " whyNow ⊂ why_now");
  });
});

/* ---------- email-safe HTML ---------- */

test("renderInitialReportEmail: HTML に外部画像・SVG・script が無い", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { em } = emailFor(s);
    assert.doesNotMatch(em.html, /<img\b/i, s + " <img>");
    assert.doesNotMatch(em.html, /<svg\b/i, s + " <svg>");
    assert.doesNotMatch(em.html, /<script\b/i, s + " <script>");
    assert.doesNotMatch(em.html, /url\(http/i, s + " CSS 外部画像");
  });
});

test("renderInitialReportEmail: HTML は table レイアウト・inline style（外部 CSS 依存なし）", () => {
  const { em } = emailFor("kscope.co.jp");
  assert.match(em.html, /role="presentation"/);
  assert.doesNotMatch(em.html, /<link\b/i);
  assert.doesNotMatch(em.html, /<style\b/i);
});

/* ---------- data safety / privacy ---------- */

test("renderInitialReportEmail: undefined/null/[object Object]/Markdown 断片が出ない", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const { em } = emailFor(s);
    const blob = em.subject + "\n" + em.preheader + "\n" + em.text + "\n" + em.html;
    assert.doesNotMatch(blob, /undefined|null|\[object Object\]|## \||\|\s*-{2,}\s*\|/, s);
  });
});

test("renderInitialReportEmail: illegame — 代表者名・所在地・資本金の断片が混入しない", () => {
  const { em } = emailFor("illegame.com");
  const blob = em.subject + em.preheader + em.text + em.html;
  ["代表者", "外神田", "資本金 600", "幸田雅美", "## |"].forEach((frag) => {
    assert.ok(!blob.includes(frag), "混入: " + frag);
  });
});

test("renderInitialReportEmail: 本文に AWS credential / API key / lambda 内部情報が出ない", () => {
  const { em } = emailFor("ab-i.jp");
  const blob = em.text + em.html;
  assert.doesNotMatch(blob, /AKIA|aws_secret|BLASTENGINE_|X-Amz|lambda-url|arn:aws/i);
});

/* ---------- Weekly ---------- */

test("renderWeeklyReportEmail: 「更新」文言・teaser 継承・「完成しました」を含まない", () => {
  const r = load("ab-i.jp");
  const teaser = T.buildTeaser(r, REPORT_URL.replace("SLUG", "ab-i.jp"));
  const em = R.renderWeeklyReportEmail(teaser, { unsubscribeUrl: UNSUB_URL });
  assert.match(em.subject, /更新/);
  assert.doesNotMatch(em.subject + em.text + em.html, /完成しました/);
  assert.ok(em.text.includes(r.free_opportunity.title), "Weekly も Opportunity を載せる");
  assert.ok(em.text.includes(UNSUB_URL));
});

/* ---------- deterministic ---------- */

test("renderInitialReportEmail: 同じ teaser は同じメール（deterministic）", () => {
  const { teaser } = emailFor("kscope.co.jp");
  assert.deepEqual(
    R.renderInitialReportEmail(teaser, { unsubscribeUrl: UNSUB_URL }),
    R.renderInitialReportEmail(teaser, { unsubscribeUrl: UNSUB_URL })
  );
});
