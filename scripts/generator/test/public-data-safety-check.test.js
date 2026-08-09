/**
 * public-data-safety-check.test.js — scripts/generator/shared/public-data-safety-check.js の自動テスト。
 *
 * 実際に検出すべきもの（Lead識別子・AWS credential等）を一時ディレクトリに合成して配置し、
 * 正しく検出・拒否されることを確認する。既存のwebsite/aor/実データは変更しない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { checkPublicDataSafety, checkJsonStructure } = require("../shared/public-data-safety-check");

/** @returns {string} 一時ディレクトリの絶対パス */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aor-safety-check-test-"));
}

/** @param {string} dir */
function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test("checkPublicDataSafety: 安全なJSON/HTML/JSのみの場合はok:trueを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "report-preview.html"), "<html><body>ok</body></html>");
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ company_profile: { name: "Example" } }));

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, true);
  assert.equal(result.checkedFiles, 2);
  assert.deepEqual(result.problems, []);
});

test("checkPublicDataSafety: lead_idキーを含むJSONを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "leaked.json"), JSON.stringify({ lead_id: "abc123", company_profile: {} }));

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].file, "leaked.json");
  assert.ok(result.problems[0].violations.some((v) => v.includes("lead_id")));
});

test("checkPublicDataSafety: report_tokenキーを含むJSONを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "leaked.json"), JSON.stringify({ report_token: "xyz789" }));

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("report_token")));
});

test("checkPublicDataSafety: AWSアクセスキーIDパターンを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "config.js"), `const key = "AKIAABCDEFGHIJKLMNOP";`);

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("AWS access key")));
});

test("checkPublicDataSafety: .envという名前のファイルはブロックリストで検出される（中身に関わらず）", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, ".env"), "SOME_VAR=value");

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("ファイル名がブロックリスト")));
});

test("checkPublicDataSafety: 正当なsend_target.emailプレースホルダー（info@ドメイン）は誤検知しない", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(
    path.join(dir, "data.json"),
    JSON.stringify({ send_target: { email: "info@example.com" }, company_profile: { name: "Example" } })
  );

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, true, "正規のsend_targetプレースホルダーemailはブロック対象ではないはず");
});

test("checkPublicDataSafety: 既存の実際のwebsite/aor/を検査してok:trueを返す（回帰確認、既存データ非破壊）", () => {
  const result = checkPublicDataSafety(path.join(__dirname, "..", "..", "..", "website", "aor"));
  assert.equal(result.ok, true, `既存の公開データに問題が検出されました: ${JSON.stringify(result.problems)}`);
});

test("checkPublicDataSafety: send_target.email以外の箇所にemailキーがあれば検出する（実受信者emailの混入を想定）", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(
    path.join(dir, "leaked.json"),
    JSON.stringify({ contact: { email: "tanaka.taro@example.co.jp" }, company_profile: { name: "Example" } })
  );

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("email")));
});

test("checkPublicDataSafety: send_target.emailでも個人名らしきローカルパートは検出する（実受信者emailの誤混入を想定）", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "leaked.json"), JSON.stringify({ send_target: { email: "tanaka.taro@example.co.jp" } }));

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("email")));
});

test("checkPublicDataSafety: human_review.notes以外の箇所にnotesキーがあれば検出する（Lead調査メモの混入を想定）", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(
    path.join(dir, "leaked.json"),
    JSON.stringify({ lead: { notes: "emailからドメインを抽出し推測した内部調査メモ" } })
  );

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("notes")));
});

test("checkPublicDataSafety: human_review.notesの定型メッセージは誤検知しない", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(
    path.join(dir, "data.json"),
    JSON.stringify({ human_review: { notes: "AI生成直後の状態。人間によるレビュー・承認が完了するまで配信不可。" } })
  );

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, true);
});

test("checkPublicDataSafety: API key風文字列を含むJSONを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ api_key: "sk_live_abcdef1234567890xyz" }));

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => /api|key/i.test(v)));
});

test("checkPublicDataSafety: PEM秘密鍵ヘッダを含むファイルを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "notes.txt"), "-----BEGIN RSA PRIVATE KEY-----\nMIIB...\n-----END RSA PRIVATE KEY-----");

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("PRIVATE KEY") || v.includes("private key")));
});

test("checkPublicDataSafety: passwordが値を伴って出現するテキストを検出してok:falseを返す", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));

  fs.writeFileSync(path.join(dir, "config.js"), `const password = "hunter2ExtraLong";`);

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((v) => v.includes("password")));
});

test("checkJsonStructure: 不正なJSON文字列に対しては例外を投げず空配列を返す（内容ベースの検出に委ねる）", () => {
  assert.deepEqual(checkJsonStructure("{not valid json"), []);
});

test("checkPublicDataSafety: 列挙後に内容を読む前にファイルが消失（ENOENT）していても検査全体を失敗させず、skippedFilesに計上する", (t) => {
  // deploy-aor-web.jsの実行と、他のテストが同じディレクトリを同時に読み書きする際に
  // 実際に発生することを確認したレース（PJ2 AOP Step③-Aレビューで発覚）。
  // fs.readFileSyncを一時的にモック化して再現する。
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));
  fs.writeFileSync(path.join(dir, "vanishing.json"), JSON.stringify({ company_profile: { name: "Example" } }));

  const targetPath = path.join(dir, "vanishing.json");
  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
  fs.readFileSync = (...args) => {
    if (args[0] === targetPath) {
      const err = new Error("ENOENT: no such file or directory");
      err.code = "ENOENT";
      throw err;
    }
    return originalReadFileSync(...args);
  };

  const result = checkPublicDataSafety(dir);
  assert.equal(result.ok, true, "消失したファイルだけでは検査全体を失敗させないはず");
  assert.deepEqual(result.skippedFiles, ["vanishing.json"]);
});

test("checkPublicDataSafety: ENOENT以外のファイル読み込みエラーは握りつぶさずそのまま伝播する", (t) => {
  const dir = makeTempDir();
  t.after(() => cleanupTempDir(dir));
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({}));

  const originalReadFileSync = fs.readFileSync;
  t.after(() => {
    fs.readFileSync = originalReadFileSync;
  });
  fs.readFileSync = () => {
    throw new Error("EACCES: permission denied");
  };

  assert.throws(() => checkPublicDataSafety(dir), /EACCES/);
});

test("checkPublicDataSafety: 存在しないディレクトリはエラーを投げる", () => {
  assert.throws(() => checkPublicDataSafety("/nonexistent/path/xyz"));
});
