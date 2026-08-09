// @ts-check
// 必須ファイルチェック: confirms the files every other check (and every human
// demo-prep workflow) assumes exist are actually present. Catches the case
// where a file was renamed/moved/deleted and every other check silently
// "passes" simply because it never found anything to scan.
const fs = require("fs");
const path = require("path");
const { rootDir, relPath, finding } = require("./_lib");

const id = "required-files";
const name = "必須ファイルチェック";

const REQUIRED_FILES = [
  // website/ - the actual demo surface
  "website/index.html",
  "website/company-profile.html",
  "website/profile-complete.html",
  "website/mock-dashboard.html",
  "website/opportunity-detail.html",
  "website/data/market-changes.json",
  "website/js/market-data.js",
  "website/css/style.css",

  // docs/strategy/sales/ - the 13 numbered sales assets + review
  "docs/strategy/sales/01_pitch_30sec.md",
  "docs/strategy/sales/02_demo_script_3min.md",
  "docs/strategy/sales/03_demo_script_10min.md",
  "docs/strategy/sales/04_faq_sales.md",
  "docs/strategy/sales/05_hearing_sheet.md",
  "docs/strategy/sales/06_feedback_aggregation_template.md",
  "docs/strategy/sales/07_mvp_evaluation_sheet.md",
  "docs/strategy/sales/08_closing_examples.md",
  "docs/strategy/sales/09_followup_email_templates.md",
  "docs/strategy/sales/10_operations_manual.md",
  "docs/strategy/sales/11_pre_demo_invitation_email.md",
  "docs/strategy/sales/12_objection_handling.md",
  "docs/strategy/sales/13_sales_talk_guidelines.md",
  "docs/strategy/sales/sales_review.md",

  // docs/strategy/research/ - the 6 research deliverables
  "docs/strategy/research/01_competitive_analysis.md",
  "docs/strategy/research/02_market_change_candidates.md",
  "docs/strategy/research/03_demo_company_candidates.md",
  "docs/strategy/research/04_faq.md",
  "docs/strategy/research/05_phase4_candidates.md",
  "docs/strategy/research/06_final_report.md",

  // docs/strategy/ - charter + quality-gate docs
  "docs/strategy/PROJECT.md",
  "docs/strategy/ROADMAP.md",
  "docs/strategy/FINAL_MVP_PLAN.md",
  "docs/strategy/QUALITY_CHECKLIST.md",
  "docs/strategy/CONSISTENCY_MATRIX.md",
  "docs/strategy/consistency_review.md",

  // docs/validation/ - public Phase 3 validation kit
  "docs/validation/DEMO_SCENARIO.md",
  "docs/validation/USER_INTERVIEW_GUIDE.md",
  "docs/validation/FEEDBACK_TEMPLATE.md",
  "docs/validation/VALIDATION_CRITERIA.md",
];

function run() {
  const findings = [];
  for (const rel of REQUIRED_FILES) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) {
      findings.push(finding("PASS", "存在を確認", { file: relPath(abs) }));
    } else {
      findings.push(
        finding("FAIL", "必須ファイルが見つかりません", {
          file: rel,
          suggestion: "リネーム/移動されていないか確認する。意図的に廃止した場合はscripts/quality-checks/required-files.jsのREQUIRED_FILESからも削除する",
        })
      );
    }
  }
  return findings;
}

module.exports = { id, name, run };
