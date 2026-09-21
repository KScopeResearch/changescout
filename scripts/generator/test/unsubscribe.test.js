/**
 * unsubscribe.test.js — Phase75 STEP5
 * website/aor/assets/js/unsubscribe.js・unsubscribe.html・assets/css/unsubscribe.css の
 * UX文言・構造を静的に固定する（jsdomは使わず文字列アサーション。既存の
 * report-preview-static.test.js / hero-layout.test.js と同じ方式）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "..", "..", "website", "aor");
const js = fs.readFileSync(path.join(WEB, "assets", "js", "unsubscribe.js"), "utf-8");
const html = fs.readFileSync(path.join(WEB, "unsubscribe.html"), "utf-8");
const css = fs.readFileSync(path.join(WEB, "assets", "css", "unsubscribe.css"), "utf-8");

test("unsubscribe.js: 無効リンク（token/lead欠落・期限切れ・不正）は見出し/本文/補足の3点セットを表示する（Phase76 STEP1: 文言更新）", () => {
  assert.match(js, /このリンクは期限切れ、または無効です。/);
  assert.match(js, /メール本文からもう一度配信停止をお試しください。/);
  assert.match(js, /新しいメールのリンクのみ有効です。/);
});

test("unsubscribe.js: 成功時は見出し/本文/補足を表示し、CTA・営業コピーを追加しない", () => {
  assert.match(js, /配信停止しました。/);
  assert.match(js, /今後、このメールアドレスには無料版レポートを配信しません。/);
  assert.match(js, /いつでも再登録できます。/);
  // 営業コピーで使われがちな語が混入していないこと
  ["キャンペーン", "お得", "今すぐ登録", "特典"].forEach((word) => {
    assert.doesNotMatch(js, new RegExp(word));
  });
});

test("unsubscribe.js: 通信失敗時は見出し/本文を表示し、再試行ボタンを新設しない", () => {
  assert.match(js, /現在配信停止を完了できません。/);
  assert.match(js, /時間をおいてもう一度お試しください。/);
  // 新しいbutton要素を作っていない（createElement("button")が増えていない）
  assert.doesNotMatch(js, /createElement\(\s*["']button["']\s*\)/);
});

test("unsubscribe.js: 赤いエラー画面を使わない（旧・警告絵文字を使わない）", () => {
  assert.doesNotMatch(js, /⚠/);
  // showResult/showUnsubscribeError（無効リンク・通信失敗の表示経路）自体は、
  // 赤いfatal-error用のstate-error要素を一切参照しない
  // （STATE_IDSの定義自体はページ初期状態管理用の既存コードで対象外）。
  const showResultBody = js.slice(js.indexOf("function showResult("));
  const showErrorBody = js.slice(js.indexOf("function showUnsubscribeError("), js.indexOf("function hideUnsubscribeError("));
  assert.doesNotMatch(showResultBody, /state-error/);
  assert.doesNotMatch(showErrorBody, /state-error/);
});

test("unsubscribe.js: ページ読み込み時のfetch/POSTは行わない（既存の安全要件を維持）", () => {
  const initBody = js.slice(js.indexOf("function init("), js.indexOf("function init(") + js.slice(js.indexOf("function init(")).indexOf("\n}\n") + 3);
  assert.doesNotMatch(initBody, /fetch\(/);
});

test("unsubscribe.js: GET時はtoken/leadの有無だけで判定する（token/lead両方ありならConfirm、どちらか欠落ならInfo）（Phase76 STEP1）", () => {
  const initBody = js.slice(js.indexOf("function init("), js.indexOf("function init(") + js.slice(js.indexOf("function init(")).indexOf("\n}\n") + 3);
  assert.match(initBody, /!currentLeadId\s*\|\|\s*!currentReportToken/);
  assert.match(initBody, /showResult\(INVALID_LINK_RESULT\)/);
  assert.match(initBody, /confirm-section/);
});

test("unsubscribe.html: result-sectionにheading/body/note用の要素がある", () => {
  const resultSection = html.slice(html.indexOf('id="result-section"'), html.indexOf('id="result-section"') + 400);
  assert.match(resultSection, /result-heading/);
  assert.match(resultSection, /result-body/);
  assert.match(resultSection, /result-note/);
  assert.match(resultSection, /result-icon/);
});

test("unsubscribe.html: 警告絵文字（⚠️）を使わない", () => {
  assert.doesNotMatch(html, /⚠/);
});

test("unsubscribe.css: result-sectionに赤系エラー色（--color-error-*）を使わない", () => {
  const idx = css.indexOf(".result-section");
  assert.ok(idx !== -1, "result-section用のスタイルが無い");
  const block = css.slice(idx, css.length);
  assert.doesNotMatch(block, /--color-error/);
});
