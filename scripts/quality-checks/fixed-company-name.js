// @ts-check
// Regression guard for the "Week 1.5 Must Fix" documented in
// docs/strategy/FINAL_MVP_PLAN.md: the demo placeholder company name
// ("サンプル株式会社") must never render to a real user without being
// swapped for their entered company name. The actual swap is done client-side
// via `profile.companyName` + `.replace("サンプル株式会社", ...)`. This
// check doesn't render the page (no browser) — it only confirms that any file
// still containing the placeholder text also still contains the replace
// wiring, so a future edit can't silently delete the personalization logic
// while leaving the placeholder text in place.
//
// Renamed from "株式会社フィールドDX" (2026-07-29): a "◯◯DX"-style name reads
// like a real, specific company rather than an obvious placeholder, which
// risked being mistaken for a mistake rather than sample data.
const { listFiles, relPath, readText, finding } = require("./_lib");

const id = "fixed-company-name";
const name = "固定企業名残存検査（サンプル株式会社）";

const PLACEHOLDER = "サンプル株式会社";

function run() {
  const findings = [];
  const files = listFiles("website", [".html"]);
  let filesWithPlaceholder = 0;

  for (const f of files) {
    const text = readText(f);
    if (!text.includes(PLACEHOLDER)) continue;
    filesWithPlaceholder++;
    const rel = relPath(f);
    const hasCompanyNameGuard = text.includes("profile.companyName");
    const hasReplaceCall = text.includes(".replace(") && text.includes(PLACEHOLDER);

    if (hasCompanyNameGuard && hasReplaceCall) {
      findings.push(
        finding("PASS", `プレースホルダー企業名を検出。personalizeロジック（profile.companyName + replace）を確認`, {
          file: rel,
          match: PLACEHOLDER,
        })
      );
    } else {
      findings.push(
        finding(
          "FAIL",
          `プレースホルダー企業名「${PLACEHOLDER}」があるが、入力企業名への置換ロジックが見つかりません（Week1.5 Must Fixの再発の可能性）`,
          {
            file: rel,
            match: PLACEHOLDER,
            suggestion: `if (profile.companyName) { ... .textContent.replace("${PLACEHOLDER}", profile.companyName); } という置換ロジックを追加する（他の生成テンプレート箇所を参照）`,
          }
        )
      );
    }
  }

  if (!filesWithPlaceholder) {
    findings.push(finding("WARN", "プレースホルダー企業名がどのファイルにも見つかりませんでした（走査対象や文言が変わった可能性）"));
  }

  return findings;
}

module.exports = { id, name, run };
