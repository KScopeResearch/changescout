// @ts-check
// L46: every backtick-quoted file reference inside docs/strategy/**/*.md
// (e.g. `docs/strategy/research/06_final_report.md`, or a same-directory
// bare filename like `05_hearing_sheet.md`) should point at a file that
// actually exists. Read-only — does not resolve web URLs, only local paths.
const fs = require("fs");
const path = require("path");
const { rootDir, listFiles, relPath, readText, lineAt, finding } = require("./_lib");

const id = "link-references";
const name = "リンク先ファイル存在確認（相互参照パス）";

// Matches backtick-quoted strings ending in a known doc extension, optionally
// with a leading "docs/" or "website/" path, or a bare filename.
const REF_PATTERN = /`((?:docs\/|website\/)?[\w .\-]+\/?[\w .\-]*\.(?:md|html|json|js))`/g;

/** Build an index of every file in the repo, keyed by basename, for fallback lookup. */
function buildBasenameIndex() {
  const index = new Map();
  for (const ext of [".md", ".html", ".json", ".js"]) {
    for (const f of listFiles(".", [ext])) {
      const base = path.basename(f);
      if (!index.has(base)) index.set(base, []);
      index.get(base).push(f);
    }
  }
  return index;
}

/**
 * A reference resolves if either (a) it's a path-qualified reference that
 * exists at that exact repo-root-relative path, or (b) its basename exists
 * *anywhere* in the repo (docs cross-reference website/*.html and
 * docs/validation/*.md by bare filename, not by full relative path, so a
 * strict sibling-directory resolution would false-positive on those).
 */
function referenceExists(refText, basenameIndex) {
  if (refText.includes("/")) {
    if (fs.existsSync(path.join(rootDir, refText))) return true;
  }
  const base = path.basename(refText);
  return (basenameIndex.get(base) || []).length > 0;
}

function run() {
  const findings = [];
  const files = listFiles("docs/strategy", [".md"]);
  const basenameIndex = buildBasenameIndex();
  const seen = new Set();

  for (const f of files) {
    const rel = relPath(f);
    const text = readText(f);
    let match;
    while ((match = REF_PATTERN.exec(text))) {
      const refText = match[1];
      const line = lineAt(text, match.index);
      const key = `${rel}:${line}:${refText}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (referenceExists(refText, basenameIndex)) {
        findings.push(finding("PASS", `参照先を確認: \`${refText}\``, { file: rel, line, match: refText }));
      } else {
        findings.push(
          finding("FAIL", `参照先ファイルが存在しません（リポジトリ全体を検索しても見つかりません）: \`${refText}\``, {
            file: rel,
            line,
            match: refText,
            suggestion: `\`${refText}\` のファイル名/パスの誤字を確認するか、参照先ファイルを作成する。既存の類似ファイル名がないか docs/strategy 配下を確認する`,
          })
        );
      }
    }
  }

  return findings;
}

module.exports = { id, name, run };
