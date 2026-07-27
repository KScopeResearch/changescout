// @ts-check
// JSON構文チェック: validates every website/**/*.json file, plus every fenced
// ```json code block embedded in docs/strategy/**/*.md (e.g. the market-change
// candidate lists in docs/strategy/research/02_market_change_candidates.md).
// Read-only: JSON.parse only, nothing is rewritten.
const { listFiles, relPath, readText, lineAt, finding } = require("./_lib");

const id = "json-syntax";
const name = "JSON構文チェック";

function checkJsonFiles() {
  const findings = [];
  for (const f of listFiles("website", [".json"])) {
    const rel = relPath(f);
    try {
      JSON.parse(readText(f));
      findings.push(finding("PASS", "JSONとして正しくパースできました", { file: rel }));
    } catch (err) {
      findings.push(
        finding("FAIL", `JSON構文エラー: ${err.message}`, {
          file: rel,
          suggestion: "エラーメッセージが示す位置付近のカンマ・括弧・クォートの対応を確認する（末尾カンマ、閉じ忘れが典型例）",
        })
      );
    }
  }
  return findings;
}

function checkEmbeddedJsonBlocks() {
  const findings = [];
  const fence = /```json\n([\s\S]*?)```/g;
  for (const f of listFiles("docs/strategy", [".md"])) {
    const rel = relPath(f);
    const text = readText(f);
    let match;
    let blockIndex = 0;
    while ((match = fence.exec(text))) {
      blockIndex++;
      const line = lineAt(text, match.index);
      try {
        JSON.parse(match[1]);
        findings.push(finding("PASS", `埋め込みJSONブロック #${blockIndex} は正しくパースできました`, { file: rel, line }));
      } catch (err) {
        findings.push(
          finding("FAIL", `埋め込みJSONブロック #${blockIndex} が壊れています: ${err.message}`, {
            file: rel,
            line,
            suggestion: `\`\`\`json フェンス内(${blockIndex}番目のブロック、${line}行目付近)を、JSON.parseで単体パースして構文エラー箇所を特定する`,
          })
        );
      }
    }
  }
  return findings;
}

function run() {
  return [...checkJsonFiles(), ...checkEmbeddedJsonBlocks()];
}

module.exports = { id, name, run };
