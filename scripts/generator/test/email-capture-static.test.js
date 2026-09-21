/**
 * email-capture-static.test.js — Phase76 STEP5
 * website/aor/email-capture.html・assets/js/email-capture.js の文言統一を静的に固定する
 * （jsdomは使わず文字列アサーション。既存の report-preview-static.test.js /
 * unsubscribe.test.js と同じ方式）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const html = fs.readFileSync(path.join(WEB, "email-capture.html"), "utf-8");
const js = fs.readFileSync(path.join(WEB, "assets", "js", "email-capture.js"), "utf-8");

test("email-capture.html: 残存禁止文言（さらに詳しい分析を見る/無料レポートを受け取る/無料で閲覧/登録不要/すぐ読めます）が無い", () => {
  ["さらに詳しい分析を見る", "無料レポートを受け取る", "無料で閲覧", "登録不要", "すぐ読めます"].forEach((phrase) => {
    assert.ok(!html.includes(phrase), `残存: ${phrase}`);
  });
});

test("email-capture.html: 「さらに詳しい分析を見る」は「詳細分析サンプルを見る」に統一されている（リンク先・IDは変更なし）", () => {
  assert.match(html, /id="paid-preview-link"[^>]*>詳細分析サンプルを見る</);
});

test("email-capture.html: 「毎週無料レポートを受け取ることに同意する」は「毎週無料版レポートを受け取ることに同意する」に統一されている（IDは変更なし）", () => {
  assert.match(html, /id="phase4-weekly-btn"[^>]*>毎週無料版レポートを受け取ることに同意する</);
});

test("email-capture.html: 登録コピーが統一されている（メールアドレス登録だけで無料版レポートを毎週配信します。/詳細分析サンプルも確認できます。）", () => {
  assert.match(html, /メールアドレス登録だけで無料版レポートを毎週配信します。/);
  assert.match(html, /詳細分析サンプルも確認できます。/);
});

test("email-capture.js: paid-preview-link の href 配線ロジックは変更していない（company遷移のみ）", () => {
  assert.match(js, /getElementById\("paid-preview-link"\)/);
  assert.match(js, /paid-preview\.html\?company=/);
});
