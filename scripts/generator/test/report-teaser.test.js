/**
 * report-teaser.test.js — Phase55 STEP4
 * scripts/generator/shared/report-teaser.js（メール teaser の pure な派生）を検証する。
 * LLM/API/乱数なし・deterministic。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const T = require(path.join(__dirname, "..", "shared", "report-teaser"));
const { loadReport: load } = require("./fixtures/aor-reports");

/* ---------- buildTeaser: 3社 ---------- */

test("buildTeaser: 3社で必須フィールドが揃い、Opportunity title は report と一致する", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = load(s);
    const tz = T.buildTeaser(r, "https://x/report-preview.html?company=" + s + "&lead=L&token=TK");
    assert.equal(tz.opportunityTitle, r.free_opportunity.title, s + " opportunity title");
    assert.ok(tz.hasCompanyName && tz.companyName.length > 0, s + " companyName");
    assert.ok(tz.whyNow.length > 0, s + " whyNow");
    assert.ok(tz.whyCompany.length > 0, s + " whyCompany");
    assert.ok(Array.isArray(tz.marketStats), s + " stats");
    assert.equal(tz.reportUrl, "https://x/report-preview.html?company=" + s + "&lead=L&token=TK");
    assert.ok(T.KNOWN_THEMES.includes(tz.theme), s + " theme");
    assert.ok(["A", "B"].includes(tz.heroVariant), s + " heroVariant");
  });
});

test("buildTeaser: whyNow は report.why_now の冒頭の抜粋（要約でなく切り取り・src-N を落とす）", () => {
  const r = load("kscope.co.jp");
  const tz = T.buildTeaser(r, "u");
  const cleanReport = r.free_opportunity.why_now.replace(/（src-\d+[^）]*）/g, "").replace(/\s/g, "");
  const cleanTeaser = tz.whyNow.replace(/…$/, "").replace(/\s/g, "");
  assert.ok(cleanReport.startsWith(cleanTeaser.slice(0, 25)), "teaser は why_now の冒頭");
  assert.doesNotMatch(tz.whyNow, /src-\d+/);
});

test("buildTeaser: deterministic（同じ report は同じ teaser）", () => {
  const r = load("ab-i.jp");
  assert.deepEqual(T.buildTeaser(r, "u"), T.buildTeaser(r, "u"));
});

test("buildTeaser: 米ドル建ての巨大数値は email stat に採用しない（他に候補があれば）", () => {
  const r = load("illegame.com");
  const tz = T.buildTeaser(r, "u");
  tz.marketStats.forEach((s) => {
    assert.ok(s.value.length <= 12 || !/ドル/.test(s.value), "email stat: " + s.value);
  });
});

test("buildTeaser: 会社名が無ければ hasCompanyName=false（[object Object] 等を出さない）", () => {
  const tz = T.buildTeaser({ company_profile: {}, free_opportunity: { title: "t" } }, "u");
  assert.equal(tz.hasCompanyName, false);
  assert.equal(tz.companyName, "");
});

test("buildTeaser: 数字が無い report では marketStats は空（捏造しない）", () => {
  const tz = T.buildTeaser(
    { company_profile: { name: "X" }, free_opportunity: { title: "t", why_now: "変化が起きています。", market_change: "動きがあります。" } },
    "u"
  );
  assert.deepEqual(tz.marketStats, []);
});

/* ---------- subject / preheader ---------- */

test("subject: 会社名を含み、煽り・AI 生成の誇示・保証表現を含まない", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const tz = T.buildTeaser(load(s), "u");
    const subj = T.subject(tz);
    assert.match(subj, new RegExp(tz.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(subj, /AI が分析|必ず|今すぐ|期間限定|保証|絶対/);
    assert.ok(subj.length <= 44, s + " subject 長さ: " + subj.length);
  });
});

test("subject: weekly は「完成」でなく「更新」", () => {
  const tz = T.buildTeaser(load("kscope.co.jp"), "u");
  assert.doesNotMatch(T.subject(tz, { kind: "weekly" }), /完成/);
  assert.match(T.subject(tz, { kind: "weekly" }), /更新/);
});

test("subject: Opportunity が無ければ『レポートが完成しました』系へフォールバック", () => {
  const tz = T.buildTeaser({ company_profile: { name: "X" }, free_opportunity: {} }, "u");
  assert.match(T.subject(tz), /レポートが完成しました/);
});

test("preheader: 空でない・Subject と完全一致しない", () => {
  const tz = T.buildTeaser(load("ab-i.jp"), "u");
  assert.ok(T.preheader(tz).length > 5);
  assert.notEqual(T.preheader(tz), T.subject(tz));
});

/* ---------- excerpt ---------- */

test("excerpt: maxLen 以内の完全な文で切る（句点優先）／src-N を落とす", () => {
  const e = T.excerpt("市場が拡大しています（src-1）。制度も変わりました（src-2）。さらに需要も増えています。", 30);
  assert.doesNotMatch(e, /src-\d+/);
  assert.ok(e.length <= 32);
  assert.ok(e.endsWith("。") || e.endsWith("…"));
});

test("excerpt: 短文はそのまま", () => {
  assert.equal(T.excerpt("短い文です。", 100), "短い文です。");
});

test("excerpt: 空・null で空文字", () => {
  assert.equal(T.excerpt(""), "");
  assert.equal(T.excerpt(null), "");
});

/* ---------- data safety ---------- */

test("buildTeaser: illegame の壊れた business_summary はどのフィールドにも出ない", () => {
  const r = load("illegame.com");
  const tz = T.buildTeaser(r, "u");
  const all = JSON.stringify(tz);
  ["代表者", "外神田", "## |", "資本金 600", "幸田雅美"].forEach((frag) => {
    assert.ok(!all.includes(frag), "teaser に " + frag + " が混入");
  });
});
