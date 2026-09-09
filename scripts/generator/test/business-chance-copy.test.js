/**
 * business-chance-copy.test.js — Phase56 STEP2
 * 「Opportunity / 市場機会」表記を排し「ビジネスチャンス」へ統一。宛名を会社名 + 経営者様に。
 * Email V3（無料・登録不要）。世界市場を Hero の主語にしない。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const previewJs = fs.readFileSync(path.join(WEB, "assets", "js", "report-preview.js"), "utf-8");
const previewHtml = fs.readFileSync(path.join(WEB, "report-preview.html"), "utf-8");

const T = require(path.join(__dirname, "..", "shared", "report-teaser"));
const R = require(path.join(__dirname, "..", "leads", "email-render"));
const P = require(path.join(WEB, "assets", "js", "preview-ui.js"));
const { loadReport } = require("./fixtures/aor-reports");

/* 表示コピーだけを対象にする（内部識別子 renderOpportunity / #sec-opportunity 等は除外）。 */
function displayStrings(js) {
  return (js.match(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g) || [])
    .map((s) => s.slice(1, -1))
    .filter((s) => /[ぁ-んァ-ヶ一-龠]/.test(s)); // 日本語を含む文字列 = ほぼ表示コピー
}

/* ---------- Copy: Opportunity / 市場機会 ゼロ・ビジネスチャンス表示 ---------- */

test("Preview: 日本語表示コピーに『Opportunity』『市場機会』が出ない", () => {
  const bad = displayStrings(previewJs).filter((s) => /Opportunity|市場機会/.test(s));
  assert.deepEqual(bad, [], "残存: " + JSON.stringify(bad));
});

test("Preview: 『ビジネスチャンス』表記が使われている", () => {
  assert.match(previewJs, /今回見つけたビジネスチャンス/);
  assert.match(previewJs, /ビジネスチャンス候補/);
  assert.match(previewHtml, /ビジネスチャンスレポート/);
  assert.doesNotMatch(previewHtml, /<title>[^<]*Opportunity/);
});

test("Email: subject / body に『Opportunity』『市場機会』が出ず『ビジネスチャンス』が出る", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const em = R.renderInitialReportEmail(T.buildTeaser(loadReport(s), "https://x/r?company=" + s + "&lead=L&token=T"), {
      unsubscribeUrl: "https://x/u",
    });
    const blob = em.subject + "\n" + em.preheader + "\n" + em.text + "\n" + em.html;
    assert.doesNotMatch(blob, /Opportunity|市場機会/, s);
    assert.match(blob, /ビジネスチャンス/, s);
  });
});

/* ---------- Salutation: company.name → 経営者様 ---------- */

test("salutation: 会社名があれば『<会社名> 経営者様』（parity: teaser == preview-ui）", () => {
  [
    ["株式会社カレイドスコープ", "株式会社カレイドスコープ 経営者様"],
    ["有限会社サンプル", "有限会社サンプル 経営者様"],
    ["合同会社テスト", "合同会社テスト 経営者様"],
    ["株式会社ABI", "株式会社ABI 経営者様"],
  ].forEach(([name, want]) => {
    assert.equal(T.salutation(name), want);
    assert.equal(P.salutation(name), want);
  });
});

test("salutation: name 無し / ドメインらしき文字列は『ご担当者様』", () => {
  ["", null, undefined, "kscope.co.jp", "example.com", "  "].forEach((n) => {
    assert.equal(T.salutation(n), "ご担当者様", JSON.stringify(n));
    assert.equal(P.salutation(n), "ご担当者様", JSON.stringify(n));
  });
});

test("Email subject: 3社とも『【<会社名> 経営者様】…ビジネスチャンスを見つけました』", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = loadReport(s);
    const subj = T.subject(T.buildTeaser(r, "u"));
    assert.match(subj, new RegExp("^【" + r.company_profile.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " 経営者様】"));
    assert.match(subj, /新しいビジネスチャンスを見つけました/);
  });
});

/* ---------- Email V3: 無料・登録不要・CTA ---------- */

test("Email V3: 『無料』『登録不要（メールアドレス以外の登録は不要）』を明記", () => {
  const em = R.renderInitialReportEmail(T.buildTeaser(loadReport("ab-i.jp"), "https://x/r"), { unsubscribeUrl: "https://x/u" });
  assert.match(em.text, /無料で閲覧できます/);
  assert.match(em.text, /メールアドレス以外の登録は不要/);
  assert.match(em.html, /このレポートは無料です/);
  assert.match(em.html, /メールアドレス以外の登録は不要/);
});

test("Email V3: CTA 文言は『無料でレポートを見る』／ reportUrl 保持", () => {
  const url = "https://d/report-preview.html?company=ab-i.jp&lead=L1&token=T1";
  const em = R.renderInitialReportEmail(T.buildTeaser(loadReport("ab-i.jp"), url), { unsubscribeUrl: "https://d/u" });
  assert.match(em.text, /▼ 無料でレポートを見る/);
  assert.ok(em.text.includes(url));
  assert.ok(em.html.includes(url.replace(/&/g, "&amp;")));
});

test("Email V3: 運営名は『無料ビジネスチャンスレポート 運営事務局』", () => {
  const em = R.renderInitialReportEmail(T.buildTeaser(loadReport("kscope.co.jp"), "u"), {});
  assert.match(em.text, /無料ビジネスチャンスレポート 運営事務局/);
  assert.match(em.html, /無料ビジネスチャンスレポート 運営事務局/);
});

/* ---------- Theme / Market: 世界市場を Hero の主語にしない ---------- */

test("rerankMarketStats: 世界市場（米ドル / 世界）を末尾に回し isWorld を立てる（parity）", () => {
  const input = [
    { value: "17兆3,777億米ドル", kind: "size", label: "サービス市場" },
    { value: "約6兆円", kind: "size", label: "国内の介護市場" },
    { value: "CAGR8%", kind: "cagr", label: "業界の需要" },
  ];
  [T.rerankMarketStats, P.rerankMarketStats].forEach((fn) => {
    const out = fn(input);
    assert.equal(out[out.length - 1].isWorld, true, "世界市場が末尾");
    assert.equal(out[0].isWorld, false);
  });
});

test("marketSnapshot: illegame は米ドル巨大値を Hero/Snapshot の主役にしない（近い数字を優先）", () => {
  const snap = P.marketSnapshot(loadReport("illegame.com"));
  // 近い数字（CAGR / 割合 / 節目の年）が採用され、世界市場（米ドル）は主役にならない
  assert.ok(snap.stats.length > 0);
  assert.equal(snap.stats[0].isWorld, false, "先頭は世界市場でない");
  assert.equal(snap.worldOnly, false, "近い数字があるので worldOnly ではない");
});

test("rerankMarketStats: 米ドル建て size を非世界の数字より後ろへ回す", () => {
  const input = [
    { value: "17兆3,777億9,000万米ドル", kind: "size", label: "サービス市場" },
    { value: "CAGR8.0%", kind: "cagr", label: "サービス需要" },
    { value: "18兆7,758億5,000万米ドル", kind: "size", label: "サービス市場" },
  ];
  const out = P.rerankMarketStats(input);
  assert.equal(out[0].isWorld, false, "非世界の CAGR が先頭");
  assert.equal(out[out.length - 1].isWorld, true);
});

test("Hero: renderHero は snapshot.stats から isWorld を除いた数字をバッジに使う", () => {
  assert.match(previewJs, /snapshot\.stats\.filter\(\(s\) => !s\.isWorld\)/);
  assert.match(previewJs, /worldOnly \? "参考データ"/);
});

test("Snapshot: worldOnly のとき『参考データ（広域市場）』の注記を出す", () => {
  assert.match(previewJs, /market-stats__note/);
  assert.match(previewJs, /参考データ（広域市場）/);
});

/* ---------- one-line summary / expected benefit ---------- */

test("oneLineSummary: 『◯◯の立ち上げ』→『◯◯を始めるチャンスがあります。』（20〜44字目安・parity）", () => {
  const cases = ["AI活用型・新規事業開発支援サービスの立ち上げ", "中小企業向けAI活用型・業務効率化コンサルティングサービスの立ち上げ"];
  cases.forEach((title) => {
    const a = T.oneLineSummary(title);
    const b = P.oneLineSummary(title);
    assert.equal(a, b);
    assert.match(a, /チャンスがあります。$/);
    assert.ok(a.length >= 12 && a.length <= 60, a.length + ": " + a);
  });
  assert.equal(T.oneLineSummary(""), "");
});

test("expectedBenefit: 売上/集客/リピート/採用・定着/利益率/業務効率 のいずれか1〜2（parity・空なら業務効率）", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const r = loadReport(s);
    const a = T.expectedBenefit(r);
    const b = P.expectedBenefit(r);
    assert.deepEqual(a, b, s);
    assert.ok(a.length >= 1 && a.length <= 2, s + " -> " + JSON.stringify(a));
  });
});

/* ---------- Illustration: 20 テーマすべて SVG ---------- */

test("Illustrations: 全 THEMES で glyph が SVG・hero が具体シーン SVG", () => {
  const I = require(path.join(WEB, "assets", "js", "illustrations.js"));
  assert.ok(I.THEMES.length >= 20, "20 テーマ以上: " + I.THEMES.length);
  I.THEMES.forEach((th) => {
    assert.match(I.glyph(th), /^<svg[\s\S]*<\/svg>$/, th + " glyph");
    const h = I.hero(th);
    assert.ok(h.startsWith("<svg") && h.trim().endsWith("</svg>"), th + " hero");
    assert.match(h, /aria-hidden="true"/, th + " aria-hidden");
    // 具体パーツ（店舗/人物/スマホ/チャート等）の translate 配置が含まれる
    assert.match(h, /translate\(/, th + " scene parts");
  });
});

test("Illustrations: hero は外部画像を読み込まない（<image> / url(http) なし）", () => {
  const I = require(path.join(WEB, "assets", "js", "illustrations.js"));
  I.THEMES.forEach((th) => {
    assert.doesNotMatch(I.hero(th), /<image\b|url\(\s*['"]?http/i, th);
  });
});
