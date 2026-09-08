/**
 * summary-guard.test.js — Phase55 P0-1 Hotfix
 *
 * website/aor/assets/js/summary-guard.js の isUsableBusinessSummary() を検証する。
 * UMD なので Node から直接 require できる（ブラウザ実行・jsdom は不要）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { isUsableBusinessSummary } = require(
  path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "summary-guard.js")
);

// --- reject（不正 → false） -------------------------------------------------

test("reject 1: Markdown table（区切り線）", () => {
  assert.equal(isUsableBusinessSummary("| 会社名 | 株式会社テスト |\n| --- | --- |\n| 資本金 | 1000万円 |"), false);
});

test("reject 2: Markdown heading + table 混在（illegame RC1 の実値パターン）", () => {
  const s =
    "## | --- | 会社名 株式会社イル・レガメ Illegame Inc. | 代表者 代表取締役 幸田雅美 | " +
    "所在地 東京都千代田区外神田３－６－５ | E-Mail | 資本金 600万円 | 主な事業内容 1. １．経営コンサルティング";
  assert.equal(isUsableBusinessSummary(s), false);
});

test("reject 3: company profile dump（3群以上のプロフィール項目）", () => {
  assert.equal(
    isUsableBusinessSummary("会社名 株式会社テスト 設立 2010年 従業員数 50名 主な事業内容 ソフトウェア開発"),
    false
  );
});

test("reject 4: 代表者・所在地・資本金 の構造化ダンプ", () => {
  assert.equal(
    isUsableBusinessSummary("代表者：山田太郎　所在地：東京都新宿区西新宿1-1-1　資本金：3,000万円"),
    false
  );
});

test("reject 5: nav / boilerplate dump（HTML タグ）", () => {
  assert.equal(
    isUsableBusinessSummary('<nav class="global"><ul><li><a href="/">ホーム</a></li></ul></nav> 当社について'),
    false
  );
});

test("reject 5b: nav テキスト断片", () => {
  assert.equal(isUsableBusinessSummary("スキップして本文へ グローバルナビ 会社概要 サービス 採用情報 お問い合わせ"), false);
});

test("reject 5c: 未デコードの HTML エンティティ", () => {
  assert.equal(isUsableBusinessSummary("株式会社テスト &#8211; 未来をつくる &amp; つなぐ"), false);
});

test("reject: 空文字 / null / 非文字列", () => {
  assert.equal(isUsableBusinessSummary(""), false);
  assert.equal(isUsableBusinessSummary("   \n  "), false);
  assert.equal(isUsableBusinessSummary(null), false);
  assert.equal(isUsableBusinessSummary(undefined), false);
  assert.equal(isUsableBusinessSummary(123), false);
});

// --- accept（正常な自然言語 → true） -------------------------------------

test("accept 6: 通常の日本語事業概要", () => {
  assert.equal(
    isUsableBusinessSummary(
      "当社は、中小企業の新規事業開発を、戦略立案から実行まで一貫して支援するコンサルティング会社です。"
    ),
    true
  );
});

test("accept 7: 短い正常な概要（ab-i RC1 の実値）", () => {
  assert.equal(isUsableBusinessSummary("日本と中国のアニメ番組や実写番組の企画・制作・プロデュース。ABI"), true);
});

test("accept 8: 社名を含む正常な概要", () => {
  assert.equal(
    isUsableBusinessSummary("株式会社カレイドスコープは、企業戦略の立案・実行支援、新規事業立ち上げ支援、M&A支援を行っています。"),
    true
  );
});

test("accept 9: 事業キーワードを含む正常な概要（プロフィール項目が1群のみ）", () => {
  assert.equal(
    isUsableBusinessSummary("美容室・飲食店の店舗経営支援と、ITサービスの企画・開発を主な事業内容としています。"),
    true
  );
});

test("accept 10: 改行を含む自然言語の複数文", () => {
  const s =
    "私たちは現場を知るコンサルタントです。\n" +
    "美容室・飲食店の店舗経営を自ら経験し、消費者と向き合い続けてきました。\n" +
    "その知見を、システム開発から運営人材の手配まで一貫してご提供します。";
  assert.equal(isUsableBusinessSummary(s), true);
});

test("accept: kscope RC1 の実値（煽り文だが自然言語）", () => {
  const s =
    "株式会社カレイドスコープ – インキュベーションパートナー：カレイドスコープ 新しいものを作っていく " +
    "やりたい！と思ったときが始めるとき 「いつか新しいことをやりたい」と思っていても何も始まりません。";
  assert.equal(isUsableBusinessSummary(s), true);
});

test("accept: 資本金 に1回だけ自然文中で触れる概要は消さない（過剰除外の防止）", () => {
  assert.equal(
    isUsableBusinessSummary("2015年設立、資本金1,000万円で、地域の飲食店向けにDX支援を提供しています。"),
    true // 設立 + 資本金 = 2群のみ → 3群未満
  );
});
