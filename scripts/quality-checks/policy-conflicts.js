// @ts-check
// Semi-automated regression checks for specific, previously-documented
// findings in docs/strategy/consistency_review.md and
// docs/strategy/sales/sales_review.md. These are "known conflict" detectors:
// the script can reliably tell whether the *symptom text* is still present,
// but only a human can decide whether the underlying policy has actually
// been reconciled — so every hit here is WARN, never FAIL/PASS-only.
const { listFiles, relPath, readText, finding } = require("./_lib");

const id = "policy-conflicts";
const name = "既知の方針矛盾・古い記述の再検査（consistency_review.md連動）";

function readIfExists(relFilePath) {
  const ext = "." + relFilePath.split(".").pop();
  const dir = relFilePath.split("/")[0]; // "docs" or "website"
  const files = listFiles(dir, [ext]).filter((f) => relPath(f) === relFilePath);
  return files.length ? readText(files[0]) : null;
}

// M1: docs/validation/USER_INTERVIEW_GUIDE.md forbids price-commitment
// questions during Phase 3, while docs/strategy/sales/{05,07} treat
// price/WTP as a core thing to ask about.
function checkPriceQuestionConflict(findings) {
  const guide = readIfExists("docs/validation/USER_INTERVIEW_GUIDE.md");
  const hearingSheet = readIfExists("docs/strategy/sales/05_hearing_sheet.md");
  const evalSheet = readIfExists("docs/strategy/sales/07_mvp_evaluation_sheet.md");

  const guideForbidsPricing = guide && /価格コミット|いくらなら払います/.test(guide);
  const salesAsksPricing =
    (hearingSheet && /価格感/.test(hearingSheet)) || (evalSheet && /支払意思/.test(evalSheet));

  if (guideForbidsPricing && salesAsksPricing) {
    findings.push(
      finding(
        "WARN",
        "未解決: docs/validation/USER_INTERVIEW_GUIDE.mdは価格質問を禁止する一方、docs/strategy/sales/05・07は価格感/支払意思を主要項目としている（consistency_review.md M1参照）",
        {
          suggestion:
            "どちらの方針で実際のヒアリングに臨むか意思決定し、決定した方に他方を合わせる（USER_INTERVIEW_GUIDE.mdの禁止を撤回するか、sales/05・07の価格質問を「Phase4以降」に変更するか）",
        }
      )
    );
  } else if (guide && hearingSheet) {
    findings.push(finding("PASS", "価格質問の方針コンフリクトは検出されませんでした（文言が変更された可能性）"));
  }
}

// M4: ROADMAP.md / docs/validation/* still describing only 3 fully-connected
// industries, when website/data/market-changes.json shows 4 (manufacturing,
// construction, professional, it-dx) as of the 2026-07-27 audit.
function checkStaleIndustryCount(findings) {
  const staleNeedles = [
    "対象業種（製造業・建設業・士業）",
    "製造業・建設業・士業の3業種のみ",
    "3業種（製造業・建設業・士業）",
  ];
  const targets = [
    "docs/strategy/ROADMAP.md",
    "docs/validation/DEMO_SCENARIO.md",
    "docs/validation/USER_INTERVIEW_GUIDE.md",
  ];
  for (const t of targets) {
    const raw = readIfExists(t);
    if (!raw) continue;
    // Strip markdown bold markers so a needle isn't missed just because the
    // source happens to bold part of the phrase (e.g. "**製造業・建設業・士業**の3業種のみ").
    const text = raw.replace(/\*\*/g, "");
    for (const needle of staleNeedles) {
      if (text.includes(needle)) {
        findings.push(
          finding(
            "WARN",
            `古い可能性のある記述「${needle}」を検出。IT・DX支援は2026-07-26のWeek1 Must Fixで4業種目としてフル対応済み（consistency_review.md M4参照）`,
            {
              file: t,
              match: needle,
              suggestion: `「${needle}」を「製造業・建設業・士業・IT・DX支援の4業種」に更新する（website/data/market-changes.jsonのmc-007がフル対応済みであることを裏付けとして確認可能）`,
            }
          )
        );
      }
    }
  }
}

// R3: opportunity-detail.html has real 生成 buttons (mail/talk/proposal) but
// the new 10-minute demo script never mentions them.
function checkGenerationButtonsCoverage(findings) {
  const detailHtml = readIfExists("website/opportunity-detail.html");
  const demoScript = readIfExists("docs/strategy/sales/03_demo_script_10min.md");
  if (!detailHtml || !demoScript) return;

  const hasButtons = /メール生成|営業トーク生成|提案資料生成/.test(detailHtml);
  const scriptMentionsButtons = /メール生成|営業トーク生成|提案資料生成/.test(demoScript);

  if (hasButtons && !scriptMentionsButtons) {
    findings.push(
      finding(
        "WARN",
        "website/opportunity-detail.htmlのメール/トーク/提案資料生成ボタンが、docs/strategy/sales/03_demo_script_10min.mdで一度も説明されていません（sales_review.md R3参照）",
        {
          suggestion:
            "03_demo_script_10min.mdの「7:00〜9:00 画面4」に、メール生成/営業トーク生成/提案資料生成ボタンの解説（テンプレート参照であることの開示含む）を追加する",
        }
      )
    );
  } else if (hasButtons && scriptMentionsButtons) {
    findings.push(finding("PASS", "生成ボタン（メール/トーク/提案資料）はデモ台本でカバーされています"));
  }
}

function run() {
  const findings = [];
  checkPriceQuestionConflict(findings);
  checkStaleIndustryCount(findings);
  checkGenerationButtonsCoverage(findings);
  if (!findings.length) {
    findings.push(finding("WARN", "対象ファイルが見つからず、既知の矛盾チェックをスキップしました"));
  }
  return findings;
}

module.exports = { id, name, run };
