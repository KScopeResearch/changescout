// @ts-check
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const fragmentDir = path.join(rootDir, "test-results", "review-fragments");
const outputPath = path.join(rootDir, "website", "review", "report.json");

if (!fs.existsSync(fragmentDir)) {
  console.error(`No test results found at ${fragmentDir}. Run "npm run check" first.`);
  process.exit(1);
}

const fragments = fs
  .readdirSync(fragmentDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(fragmentDir, file), "utf-8")))
  .sort((a, b) => a.label.localeCompare(b.label));

const commit = execSync("git rev-parse HEAD", { cwd: rootDir }).toString().trim();

const report = {
  commit,
  commitShort: commit.slice(0, 7),
  generatedAt: new Date().toISOString(),
  summary: {
    total: fragments.length,
    passed: fragments.filter((f) => f.passed).length,
    failed: fragments.filter((f) => !f.passed).length,
  },
  results: fragments,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

console.log(`Wrote ${outputPath}`);
console.log(`${report.summary.passed}/${report.summary.total} passed`);
