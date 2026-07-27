// @ts-check
// A1/A3/C14/G30/K-ish: flags AI-capability overclaims banned by
// docs/strategy/sales/13_sales_talk_guidelines.md (section 3) and the two
// wording-review rounds earlier in this project's history.
//
// Zones:
//   FAIL zone  - customer/demo-facing text: docs/strategy/sales/{01..12}*.md, website/**/*.html
//   WARN zone  - internal charter/roadmap/research docs: docs/strategy/*.md (top-level), docs/strategy/research/**/*.md
//   skipped    - meta documents that intentionally *quote* the banned phrases as examples
//                (the guideline itself, the two audit reports, the checklist/matrix)
const path = require("path");
const { listFiles, relPath, readText, finding } = require("./_lib");

const id = "banned-ai-phrases";
const name = "禁止表現検査（AI表現・過大表現）";

// Exact strings from docs/strategy/sales/13_sales_talk_guidelines.md section 3.
const EXACT_PHRASES = [
  { text: "AIが監視しています", suggestion: "市場変化を整理して表示しています" },
  { text: "AIが毎週チェックしています", suggestion: "更新頻度は今後の実装課題です（現状はサンプルデータ）" },
  { text: "AIが自動収集しています", suggestion: "情報の自動収集は今後実装予定です" },
  { text: "AIが自動で見つけます", suggestion: "関連する可能性が高い情報を整理して表示します" },
  { text: "AIが判断します", suggestion: "AI推定で重要度の参考情報を表示します" },
  { text: "AIが営業してくれます", suggestion: "営業アクションの判断材料を提示します" },
  { text: "AIが最適解を出します", suggestion: "判断の参考になる情報を提示します（最終判断はお客様）" },
  { text: "AIが分析しました", suggestion: "分析結果（AI推定）をご用意しました" },
  { text: "AIが作成しました", suggestion: "整理した情報をレポート形式でご用意しました" },
  { text: "AIが選び出します", suggestion: "関連度が高いと推定される情報を表示します" },
  { text: "AIが要約します", suggestion: "情報を要約して参考情報として表示します" },
  { text: "自動通知します", suggestion: "通知機能は今後の実装候補です（現状は画面で確認いただく形）" },
  { text: "リアルタイム監視しています", suggestion: "市場変化を随時整理する仕組みを検討しています" },
];

// Broader net for "AIが <object phrase> <verb>" (Japanese SOV word order means
// the verb often sits well after "AIが", e.g. "AIが法改正・補助金…を分析し").
// Scoped to a single line and capped at 40 chars so it can't jump across
// unrelated sentences/attributes; each stem carries its own suggested rewrite.
const STEM_SUGGESTIONS = [
  { stem: "見張", suggestion: "市場変化を整理して表示しています" },
  { stem: "監視", suggestion: "市場変化を整理して表示しています" },
  { stem: "毎週", suggestion: "更新頻度は今後の実装課題です（現状はサンプルデータ）" },
  { stem: "収集", suggestion: "情報の自動収集は今後実装予定です" },
  { stem: "見つけ", suggestion: "関連する可能性が高い情報を整理して表示します" },
  { stem: "届け", suggestion: "参考情報として画面に表示します" },
  { stem: "判断", suggestion: "AI推定で重要度の参考情報を表示します" },
  { stem: "作成", suggestion: "整理した情報をレポート形式でご用意しました" },
  { stem: "選び出", suggestion: "関連度が高いと推定される情報を表示します" },
  { stem: "営業", suggestion: "営業アクションの判断材料を提示します" },
  { stem: "提案", suggestion: "判断の参考になる情報を提示します（最終判断はお客様）" },
  { stem: "分析", suggestion: "分析結果（AI推定）をご用意しました" },
  { stem: "教えて", suggestion: "参考情報として表示します" },
  { stem: "要約", suggestion: "情報を要約して参考情報として表示します" },
  { stem: "自動", suggestion: "自動化されている範囲を実態通りに言い換える（例:「今後実装予定」）" },
];
const STEM_PATTERN = new RegExp(`AIが[^。\\n]{0,40}?(${STEM_SUGGESTIONS.map((s) => s.stem).join("|")})`);

// FAQ question headers quote hypothetical customer phrasing (e.g.
// "**Q. AIが全部自動でやってくれるんですか？**") — left as-is by project
// convention (see 04_faq_sales.md), so they're excluded from the line scan.
const QUESTION_HEADER = /^\s*\*{0,2}Q[\d.．:：]/;

const SKIP_BASENAMES = new Set([
  "13_sales_talk_guidelines.md",
  "sales_review.md",
  "consistency_review.md",
  "CONSISTENCY_MATRIX.md",
  "QUALITY_CHECKLIST.md",
]);

function scanFile(absPath, severity) {
  const text = readText(absPath);
  const lines = text.split("\n");
  const findings = [];

  lines.forEach((lineText, i) => {
    const lineNo = i + 1;
    if (QUESTION_HEADER.test(lineText)) return;

    for (const { text: phrase, suggestion } of EXACT_PHRASES) {
      if (lineText.includes(phrase)) {
        findings.push(
          finding(severity, `禁止表現「${phrase}」を検出`, { file: relPath(absPath), line: lineNo, match: phrase, suggestion })
        );
      }
    }

    const m = lineText.match(STEM_PATTERN);
    if (m) {
      // Skip if this exact span was already reported via EXACT_PHRASES on this line.
      const alreadyExact = EXACT_PHRASES.some((p) => lineText.includes(p.text) && m[0].includes(p.text.slice(0, 4)));
      if (!alreadyExact) {
        const stemHit = STEM_SUGGESTIONS.find((s) => m[1].includes(s.stem));
        findings.push(
          finding(severity, `「AIが○○します」型の過大表現の疑い: 「${m[0]}」`, {
            file: relPath(absPath),
            line: lineNo,
            match: m[0],
            suggestion: stemHit ? stemHit.suggestion : "docs/strategy/sales/13_sales_talk_guidelines.mdの言い換え集を参照",
          })
        );
      }
    }
  });

  return findings;
}

function run() {
  const findings = [];
  let checked = 0;

  const strategyMdFiles = listFiles("docs/strategy", [".md"]).filter(
    (f) => !SKIP_BASENAMES.has(path.basename(f))
  );
  const websiteHtmlFiles = listFiles("website", [".html"]);

  for (const f of [...strategyMdFiles, ...websiteHtmlFiles]) {
    const rel = relPath(f);
    // docs/strategy/sales/ (minus the skipped meta files above) and every
    // website/*.html page are customer/demo-facing: a hit there is a FAIL.
    // Everything else under docs/strategy/ (charter, roadmap, research) is
    // internal-facing: a hit there is a WARN.
    const severity = rel.startsWith("docs/strategy/sales/") || rel.startsWith("website/") ? "FAIL" : "WARN";
    checked++;
    findings.push(...scanFile(f, severity));
  }

  if (!findings.length) {
    findings.push(finding("PASS", `禁止表現なし（${checked}ファイル走査、website/**/*.htmlとdocs/strategy/**/*.mdを含む）`));
  }
  return findings;
}

module.exports = { id, name, run };
