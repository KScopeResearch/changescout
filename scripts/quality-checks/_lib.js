// @ts-check
// Shared helpers for scripts/quality-checks/*.js. Pure filesystem/text checks —
// no browser, no network, no mutation of any file. See scripts/run-quality-checks.js.
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..", "..");

/** Recursively list files under `dir` whose extension is in `extensions` (e.g. [".md", ".html"]). */
function listFiles(dir, extensions) {
  const absDir = path.isAbsolute(dir) ? dir : path.join(rootDir, dir);
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  const stack = [absDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "test-results" || entry.name === "playwright-report") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/** Path relative to repo root, forward-slashed for stable output across OSes. */
function relPath(absPath) {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

function readText(absPath) {
  return fs.readFileSync(absPath, "utf-8");
}

/** 1-based line number of the first match of `index` (character offset) in `text`. */
function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * @param {"PASS"|"WARN"|"FAIL"} status
 * @param {string} message
 * @param {{file?: string, line?: number, match?: string, suggestion?: string}} [where]
 */
function finding(status, message, where) {
  return {
    status,
    message,
    file: where && where.file,
    line: where && where.line,
    match: where && where.match,
    suggestion: where && where.suggestion,
  };
}

module.exports = { rootDir, listFiles, relPath, readText, lineAt, finding };
