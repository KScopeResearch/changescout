/**
 * pii-sanitizer.test.js — Phase56 STEP9-D（P4: Privacy / Context Guard）
 *
 * STEP9-B / STEP9-C の回帰: gBizINFO（法人番号公表サイト）の法人ページ本文
 * （本店所在地の番地・法人番号）が company_context → LLM プロンプト → why_company へ
 * 流入し「gBizINFOによれば本店所在地は東京都千代田区外神田…」という記述になった。
 *
 * P4: LLM へ渡す前に、登記・住所・連絡先ボイラープレートを sources[] のテキストから除去する。
 * 会社名・業種・事業内容・都道府県/市区町村レベルの地名は残す（過剰除去しない）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeText,
  sanitizeSources,
  sanitizeContext,
  containsStreetAddress,
} = require("../shared/pii-sanitizer");

// --- sanitizeText: 除去する ------------------------------------------------

test("sanitizeText: gBizINFO 形式の本店所在地（番地まで）を除去する", () => {
  const input =
    "経済産業省が提供する gBizINFO は政府保有の法人情報を提供するサイトです。\n" +
    "本店所在地\n東京都千代田区外神田３丁目６番５号\n代表者名\n代表取締役 幸田雅美\n資本金\n600万円\n" +
    "株式会社イル・レガメは飲食店・美容室の店舗経営を経験している。";
  const out = sanitizeText(input);
  assert.ok(!out.includes("外神田"), out);
  assert.ok(!out.includes("３丁目"), out);
  assert.ok(!out.includes("幸田雅美"), out);
  assert.ok(!/資本金\s*\n?\s*600万円/.test(out), out);
  // 事業内容は残る
  assert.ok(out.includes("飲食店・美容室の店舗経営"), out);
});

test("sanitizeText: 一文中の街区住所を伏せ字化する", () => {
  const out = sanitizeText("株式会社サンプルの本店は東京都千代田区外神田3-6-5にあり、飲食DXを支援している。");
  assert.ok(!out.includes("外神田3-6-5"), out);
  assert.ok(out.includes("飲食DXを支援"), out);
});

test("sanitizeText: 法人番号（13桁）・郵便番号・電話番号を除去する", () => {
  const out = sanitizeText("法人番号 8010001148581 / 〒101-0021 / TEL: 03-1234-5678 のイル・レガメです。");
  assert.ok(!out.includes("8010001148581"), out);
  assert.ok(!out.includes("101-0021"), out);
  assert.ok(!out.includes("03-1234-5678"), out);
  assert.ok(out.includes("イル・レガメ"), out);
});

test("sanitizeText: 代表者の肩書きは残し、続く個人名だけ除去する", () => {
  const out = sanitizeText("代表取締役社長 山田太郎 が新規事業を推進している。");
  assert.ok(!out.includes("山田太郎"), out);
  assert.ok(out.includes("代表取締役社長"), out);
  assert.ok(out.includes("新規事業を推進"), out);
});

// --- sanitizeText: 残す（過剰除去しない） --------------------------------

test("sanitizeText: 都道府県・市区町村レベルの地名は残す（商圏の意味を持ちうる）", () => {
  const out = sanitizeText("千代田区の飲食店では人手不足が深刻で、東京都内でインバウンド需要が回復している。");
  assert.equal(out, "千代田区の飲食店では人手不足が深刻で、東京都内でインバウンド需要が回復している。");
});

test("sanitizeText: 市場規模の金額・年号は住所と誤認しない", () => {
  const out = sanitizeText("外食産業の市場規模は24兆1,512億円で、2026年も回復が続く見込み。");
  assert.equal(out, "外食産業の市場規模は24兆1,512億円で、2026年も回復が続く見込み。");
});

test("sanitizeText: 事業内容の自然文は変更しない", () => {
  const t = "美容室・サロン経営、飲食店運営、WEB新規事業、店舗ブランディング、システム開発を手掛ける。";
  assert.equal(sanitizeText(t), t);
});

test("sanitizeText: 非文字列・空はそのまま返す", () => {
  assert.equal(sanitizeText(null), null);
  assert.equal(sanitizeText(""), "");
  assert.equal(sanitizeText(undefined), undefined);
});

// --- sanitizeSources / sanitizeContext ----------------------------------

test("sanitizeSources: score/source_type/url/id は変更せず、テキストのみ sanitize する", () => {
  const sources = [
    {
      id: "src-11",
      source_type: "government",
      source_role: "company_fact",
      score: 30,
      evidence_strength: "reference",
      url: "https://info.gbiz.go.jp/hojin/ichiran?hojinBango=8010001148581",
      title: "株式会社イル・レガメ | 8010001148581 | Gビズインフォ",
      summary: "本店所在地\n東京都千代田区外神田３丁目６番５号\n株式会社イル・レガメの法人情報。",
      quote: "本店所在地 東京都千代田区外神田３丁目６番５号",
    },
  ];
  const [out] = sanitizeSources(sources);
  assert.equal(out.id, "src-11");
  assert.equal(out.source_type, "government");
  assert.equal(out.score, 30);
  assert.equal(out.url, sources[0].url, "url は変更しない");
  assert.ok(!out.summary.includes("外神田"), out.summary);
  assert.ok(!out.quote.includes("外神田"), out.quote);
  assert.ok(!out.title.includes("8010001148581"), out.title);
  assert.ok(out.title.includes("株式会社イル・レガメ"), out.title);
});

test("sanitizeContext: sources のみ差し替え、他フィールドは保持", () => {
  const ctx = {
    input_url: "https://illegame.com",
    industry_hint: "飲食業",
    opportunity_theme: "飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ",
    sources: [{ id: "src-1", score: 93, summary: "東京都千代田区外神田3-6-5 の会社です。" }],
  };
  const out = sanitizeContext(ctx);
  assert.equal(out.input_url, "https://illegame.com");
  assert.equal(out.industry_hint, "飲食業");
  assert.equal(out.opportunity_theme, ctx.opportunity_theme);
  assert.ok(!out.sources[0].summary.includes("外神田3-6-5"));
  assert.equal(out.sources[0].score, 93);
});

// --- containsStreetAddress（validator バックストップ） -------------------

test("containsStreetAddress: 街区住所は true、都道府県/市区町村のみは false", () => {
  assert.equal(containsStreetAddress("本店所在地は東京都千代田区外神田３丁目６番５号"), true);
  assert.equal(containsStreetAddress("千代田区外神田3-6-5"), true);
  assert.equal(containsStreetAddress("千代田区の飲食店で人手不足"), false);
  assert.equal(containsStreetAddress("東京都内でインバウンド需要が回復"), false);
  assert.equal(containsStreetAddress("市場規模は24兆1,512億円"), false);
  assert.equal(containsStreetAddress(null), false);
  assert.equal(containsStreetAddress(""), false);
});

// --- Phase56 STEP9-F: 市場の年レンジを街区住所と誤検知しない（回帰テスト） -----
// STEP9-E の実 API 検証で、kscope の market_change「AI品質検査市場が2026〜2036年に成長」が
// 街区住所として誤検知され Validator が spurious FAIL していた。原因は separator に `〜`/`~`
// を含み、`市`（市場の一部）+ 年レンジ を「市区町村 + 番地」と誤認していたこと。

test("STEP9-F 回帰: 市場の年レンジ（〜 / ~）は街区住所ではない", () => {
  const marketRanges = [
    "AI品質検査市場が2026〜2036年に成長",
    "日本のアニメ市場は2025〜2030年",
    "市場規模は2026~2036年に拡大",
    "世界市場は2024年に約4.2億米ドル、2025〜2034年に年平均31.2%で成長",
    "日本国内でもAI品質検査市場が2026〜2036年に高い年平均成長率で成長すると見込まれている（src-1）。",
    "市場は2026-2036年に拡大する見込み", // ハイフン2数のみ＝年レンジ
  ];
  for (const t of marketRanges) {
    assert.equal(containsStreetAddress(t), false, `誤検知: ${t}`);
  }
});

test("STEP9-F 回帰: sanitizeText は市場の年レンジ文をそのまま保持する", () => {
  const t = "日本国内でもAI品質検査市場が2026〜2036年に高い年平均成長率で成長すると見込まれている。";
  assert.equal(sanitizeText(t), t);
  const t2 = "製造業におけるAI市場は2024〜2034年に年平均31.2%で成長すると推定されている。";
  assert.equal(sanitizeText(t2), t2);
});

test("STEP9-F 回帰: 実住所の検出能力は維持（丁目/番地/号・ハイフン3連結・全角空白区切り）", () => {
  assert.equal(containsStreetAddress("東京都千代田区外神田3丁目6番5号"), true);
  assert.equal(containsStreetAddress("東京都千代田区外神田３丁目６番５号"), true);
  assert.equal(containsStreetAddress("東京都千代田区外神田3-6-5"), true);
  assert.equal(containsStreetAddress("千代田区外神田3-6-5"), true);
  assert.equal(containsStreetAddress("東京都　千代田区　外神田　３－６－５－８０５"), true); // gBiz 事業所テーブル
  assert.equal(containsStreetAddress("東京都新宿区西新宿1-1-1"), true);
  assert.equal(containsStreetAddress("千代田区外神田３丁目"), true); // 丁目のみでも識別性あり
});

test("STEP9-F 回帰: validate-report checkResidualPii の誤検知が消える（kscope 型 market_change）", () => {
  const { validateReport } = require("../validate-report");
  const { readJson } = require("../shared/json-file");
  const { REPORT_FIXTURES_DIR } = require("../shared/paths");
  const report = readJson(require("path").join(REPORT_FIXTURES_DIR, "good.json"));
  report.free_opportunity.market_change =
    "製造業におけるAIは品質管理などに用途が広がり、日本国内でもAI品質検査市場が2026〜2036年に高い年平均成長率で成長すると見込まれている（src-1）。";
  const result = validateReport(report);
  assert.ok(
    !result.errors.some((e) => e.includes("街区レベルの住所")),
    "市場年レンジで PII error が出てはいけない: " + JSON.stringify(result.errors)
  );
});
