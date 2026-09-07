/**
 * fetch-company.test.js — Phase54 STEP1/STEP3: fetch-company.js の summary 抽出・整形の自動テスト。
 * 実HTTP取得は行わない（HTML文字列を直接 extractSummary へ渡す）。
 *
 * 固定する仕様（Phase54 RC-1）:
 *   - decodeHtmlEntities: 数値/名前付き HTMLエンティティを実文字へ
 *   - extractSummary: <meta description> → <meta og:description> → 本文段落 の優先順位、
 *     script/style/nav/header/footer 等のテキストを summary に混入させない
 *   - cleanSummaryText: スキップリンク・メニュー項目・メール・電話番号の除去（本文語は残す）
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { decodeHtmlEntities, extractSummary, cleanSummaryText } = require("../fetch-company");

// ---------------------------------------------------------------------------
// decodeHtmlEntities
// ---------------------------------------------------------------------------

test("decodeHtmlEntities: 数値・16進・名前付きエンティティを実文字へ変換する", () => {
  assert.equal(decodeHtmlEntities("株式会社A &#8211; B"), "株式会社A – B");
  assert.equal(decodeHtmlEntities("X &#x2014; Y"), "X — Y");
  assert.equal(decodeHtmlEntities("A &amp; B"), "A & B");
  assert.equal(decodeHtmlEntities("前 &mdash; 後"), "前 — 後");
});

test("decodeHtmlEntities: 未知エンティティは破壊しない / 通常文字列は不変", () => {
  assert.equal(decodeHtmlEntities("&unknownentity; はそのまま"), "&unknownentity; はそのまま");
  assert.equal(decodeHtmlEntities("エンティティを含まない普通の文。"), "エンティティを含まない普通の文。");
  assert.equal(decodeHtmlEntities(""), "");
  assert.equal(decodeHtmlEntities(null), "");
});

// ---------------------------------------------------------------------------
// extractSummary — 優先順位
// ---------------------------------------------------------------------------

test("extractSummary Case A: <meta name=description> があればそれを採用（entity decode 込み）", () => {
  const html = `<html><head>
    <meta name="description" content="当社は新規事業の立ち上げ支援 &amp; M&amp;A支援を行います。">
    <meta property="og:description" content="OG説明文">
  </head><body><nav>ホーム 会社概要</nav><p>本文段落テキスト</p></body></html>`;
  assert.equal(extractSummary(html), "当社は新規事業の立ち上げ支援 & M&A支援を行います。");
});

test("extractSummary Case B: description が無く og:description があればそれを採用", () => {
  const html = `<html><head>
    <meta property="og:description" content="OGの会社説明です。">
  </head><body><p>本文</p></body></html>`;
  assert.equal(extractSummary(html), "OGの会社説明です。");
});

test("extractSummary Case C: description/og が無ければ本文段落から取得", () => {
  const html = `<html><head><title>会社</title></head><body>
    <p>当社はコンテンツ制作を主力事業とし、国内外へ展開しています。</p>
  </body></html>`;
  const s = extractSummary(html);
  assert.ok(s.includes("当社はコンテンツ制作を主力事業"), s);
});

test("extractSummary Case D: script/style/nav/header/footer のテキストを summary に混入させない", () => {
  const html = `<html><head><style>.x{color:red}</style></head><body>
    <header>メールですぐに問い合わせ info@ex.co.jp</header>
    <nav>ホーム 会社概要 事業内容 実績紹介 お問い合わせ</nav>
    <script>var secretConfig = "SHOULD_NOT_APPEAR";</script>
    <main><p>当社は建設業を営む会社です。</p></main>
    <footer>© 2026 Example All rights reserved.</footer>
  </body></html>`;
  const s = extractSummary(html);
  assert.ok(s.includes("当社は建設業を営む会社です"), s);
  assert.ok(!s.includes("SHOULD_NOT_APPEAR"), "script のテキストが混入してはならない");
  assert.ok(!s.includes("info@ex.co.jp"), "header のメールアドレスが混入してはならない");
  assert.ok(!s.includes("会社概要 事業内容 実績紹介"), "nav メニューが混入してはならない");
  assert.ok(!/All rights reserved/i.test(s), "footer の著作権表記が混入してはならない");
});

// ---------------------------------------------------------------------------
// cleanSummaryText
// ---------------------------------------------------------------------------

test("cleanSummaryText: スキップリンク・メニュー・メール・電話を除去する", () => {
  const raw =
    "コンテンツへスキップ ホーム 会社概要 事業内容 お問い合わせ 採用情報 " +
    "メールですぐに問い合わせ info@kscope.co.jp TEL: 03-1234-5678 " +
    "当社は中小企業の新規事業開発を支援しています。";
  const out = cleanSummaryText(raw);
  assert.ok(out.includes("当社は中小企業の新規事業開発を支援しています"), out);
  assert.ok(!out.includes("コンテンツへスキップ"), out);
  assert.ok(!out.includes("info@kscope.co.jp"), out);
  assert.ok(!/03-1234-5678/.test(out), out);
  assert.ok(!/会社概要 事業内容 お問い合わせ 採用情報/.test(out), "メニュー連なりが除去される");
});

test("cleanSummaryText: 本文中の正当な語を過剰に削除しない（社名内の・を壊さない）", () => {
  const out = cleanSummaryText("イル・レガメは事業開発コンサルティングを提供する会社です。");
  assert.equal(out, "イル・レガメは事業開発コンサルティングを提供する会社です。");
});

test("cleanSummaryText: HOME/ABOUT/CONTACT 等の英語メニューも単独トークンなら除去", () => {
  const out = cleanSummaryText("HOME ABOUT SERVICES CONTACT We build software for factories.");
  assert.ok(out.includes("We build software for factories"), out);
  assert.ok(!/HOME ABOUT SERVICES CONTACT/.test(out), out);
});

test("cleanSummaryText: 空 / null を安全に扱う", () => {
  assert.equal(cleanSummaryText(""), "");
  assert.equal(cleanSummaryText(null), "");
});
