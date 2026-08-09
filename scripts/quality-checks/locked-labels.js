// @ts-check
// D16/D17: "判断理由" and "推奨アクション" are locked UI terminology (see
// CLAUDE.md "ChangeScout UI terminology") that oscillated across several
// review rounds (理由 → 重要理由 → 理由 → 重要理由 → 判断理由) before being
// confirmed final. This check guards against silent regression to an older
// label, and confirms the current label is still present verbatim.
const { listFiles, relPath, readText, finding } = require("./_lib");

const id = "locked-labels";
const name = "ロック済みラベル検査（判断理由・推奨アクション）";

const REQUIRED_LABELS = ["判断理由", "推奨アクション"];
// Rejected historical variant for "判断理由" (see CLAUDE.md history note).
// Flagged only as a suspicious near-miss, not a hard failure, since the
// substring could theoretically appear in unrelated prose.
const REJECTED_VARIANTS = ["重要理由"];

const TARGET_HTML = ["website/mock-dashboard.html", "website/opportunity-detail.html"];

function run() {
  const findings = [];
  const files = listFiles("website", [".html"]).filter((f) => TARGET_HTML.includes(relPath(f)));

  if (files.length !== TARGET_HTML.length) {
    findings.push(
      finding("WARN", `対象ファイルの一部が見つかりません（期待: ${TARGET_HTML.join(", ")}）`)
    );
  }

  for (const f of files) {
    const rel = relPath(f);
    const text = readText(f);

    for (const label of REQUIRED_LABELS) {
      if (text.includes(label)) {
        findings.push(finding("PASS", `ロック済みラベル「${label}」を確認`, { file: rel, match: label }));
      } else {
        findings.push(
          finding("FAIL", `ロック済みラベル「${label}」が見つかりません（リネーム/削除された可能性）`, {
            file: rel,
            suggestion: `CLAUDE.mdの"ChangeScout UI terminology"表に従い、「${label}」という文字列をこのファイルに戻す（判断理由・推奨アクションは変更前に必ずユーザーへ確認するロック済み用語）`,
          })
        );
      }
    }

    for (const variant of REJECTED_VARIANTS) {
      if (text.includes(variant)) {
        findings.push(
          finding("WARN", `過去に却下された表記ゆれ「${variant}」を検出（「判断理由」への統一を確認）`, {
            file: rel,
            match: variant,
            suggestion: `「${variant}」を「判断理由」に置き換える（CLAUDE.md記載の通り、理由→重要理由→理由→重要理由→判断理由と揺れた末に確定した表記）`,
          })
        );
      }
    }
  }

  return findings;
}

module.exports = { id, name, run };
