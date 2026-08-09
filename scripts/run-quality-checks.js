// @ts-check
// Runs all scripts/quality-checks/*.js and prints a PASS/WARN/FAIL report.
// Pure filesystem/text analysis — no browser, no server, no mutation of any
// file. Intended as a pre-demo gate distinct from `npm run check`/`npm run
// review` (Playwright, which renders real pages in a browser).
//
// Usage: npm run quality
// Exit code: 1 if any FAIL was found, 0 otherwise (WARN does not fail the run).
const fs = require("fs");
const path = require("path");

const checksDir = path.join(__dirname, "quality-checks");
const checkFiles = fs
  .readdirSync(checksDir)
  .filter((f) => f.endsWith(".js") && !f.startsWith("_"))
  .sort();

const STATUS_LABEL = { PASS: "[PASS]", WARN: "[WARN]", FAIL: "[FAIL]" };
const STATUS_ORDER = { FAIL: 0, WARN: 1, PASS: 2 };
const verbose = process.argv.includes("--verbose");

const totals = { PASS: 0, WARN: 0, FAIL: 0 };
let hadError = false;

console.log("=== ChangeScout Quality Check (npm run quality) ===");
console.log("website仕様・UI・JSON・既存挙動には一切触れない、読み取り専用チェックです。");
console.log(verbose ? "(--verbose: PASSも全件表示)" : "(PASSは件数のみ表示。全件見るには --verbose)");
console.log("");

for (const file of checkFiles) {
  /** @type {{id: string, name: string, run: () => Array<{status: string, message: string, file?: string, line?: number}>}} */
  const check = require(path.join(checksDir, file));

  let results;
  try {
    results = check.run();
  } catch (err) {
    hadError = true;
    console.log(`--- ${check.name} (${check.id}) ---`);
    console.log(`  [FAIL] チェック自体がエラーで停止しました: ${err.message}`);
    totals.FAIL++;
    console.log("");
    continue;
  }

  console.log(`--- ${check.name} (${check.id}) ---`);
  const sorted = [...results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  let passCount = 0;
  for (const r of sorted) {
    totals[r.status] = (totals[r.status] || 0) + 1;
    if (r.status === "PASS" && !verbose) {
      passCount++;
      continue;
    }
    const location = r.file ? `${r.file}${r.line ? ":" + r.line : ""}` : "";
    const label = STATUS_LABEL[r.status] || `[${r.status}]`;
    console.log(`  ${label} ${location ? location + "  " : ""}${r.message}`);
    if (r.status !== "PASS" && r.suggestion) {
      console.log(`         → 修正候補: ${r.suggestion}`);
    }
  }
  if (passCount > 0) {
    console.log(`  [PASS] ...他 ${passCount} 件 PASS（--verbose で表示）`);
  }
  console.log("");
}

console.log("=== Summary ===");
console.log(`PASS: ${totals.PASS}   WARN: ${totals.WARN}   FAIL: ${totals.FAIL}`);

if (hadError || totals.FAIL > 0) {
  console.log("\n結果: FAIL があります。デモ前に内容を確認してください。");
  process.exit(1);
} else if (totals.WARN > 0) {
  console.log("\n結果: FAILはありませんが、WARN があります。人による確認を推奨します。");
  process.exit(0);
} else {
  console.log("\n結果: すべてPASSです。");
  process.exit(0);
}
