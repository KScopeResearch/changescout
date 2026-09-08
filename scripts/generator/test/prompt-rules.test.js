/**
 * prompt-rules.test.js — Phase54 STEP1/STEP3: AI分析プロンプト（品質ルール）の軽量 text assertion。
 *
 * LLM は一切呼ばない。prompts/quality-rules.md / opportunity-generation.md に、Phase54 で
 * 追加した品質ルールの要点が文言として存在することだけを確認する（プロンプトが将来
 * 意図せず削られる回帰を検知するため）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PROMPTS_DIR = path.join(__dirname, "..", "prompts");
const qualityRules = fs.readFileSync(path.join(PROMPTS_DIR, "quality-rules.md"), "utf-8");
const oppGen = fs.readFileSync(path.join(PROMPTS_DIR, "opportunity-generation.md"), "utf-8");

test("quality-rules.md: 「既存事業の単純な強化を Opportunity にしない」ルールが存在する", () => {
  assert.match(qualityRules, /既存事業の説明をOpportunityにしない/);
  assert.match(qualityRules, /まだ\s*やっていない|前向きな一手/);
});

test("quality-rules.md: AI活用・新規事業・市場拡張・業務変革の優先方向が列挙されている", () => {
  assert.match(qualityRules, /AI\s*\/?\s*生成AIの活用/);
  assert.match(qualityRules, /新規事業・新サービス/);
  assert.match(qualityRules, /新しい市場・顧客セグメント/);
  assert.match(qualityRules, /業務プロセスの変革/);
});

test("quality-rules.md: evidence 要件（2件以上・非companyの関連source）が明記されている", () => {
  assert.match(qualityRules, /evidenceは2件以上/);
  assert.match(qualityRules, /1件以上は非companyの関連source/);
});

test("quality-rules.md: company source と external source の役割分離が記述されている", () => {
  assert.match(qualityRules, /why_company.*土台/s);
  assert.match(qualityRules, /why_now.*変化/s);
  assert.match(qualityRules, /market_change.*外部の変化/s);
});

test("quality-rules.md: market_change が外部市場source を最低1件引用するルールが存在する", () => {
  assert.match(qualityRules, /最低1件は外部市場source/);
  assert.match(qualityRules, /source_type:"company".*だけ.*構成してはならない/s);
});

test("quality-rules.md: 同名・別住所の企業を競合扱いしないルールが存在する", () => {
  assert.match(qualityRules, /同名・別住所の企業を「同業他社」「競合」として扱わない/);
});

test("quality-rules.md: 主体取り違え（日本政府 vs 中国政府）を避けるルールが存在する（Phase53 STEP10.12 回帰）", () => {
  assert.match(qualityRules, /日本政府の施策と中国政府の施策を取り違えない/);
  assert.match(qualityRules, /JLOX\+.*クールジャパン戦略.*JETRO/);
});

test("opportunity-generation.md: free_opportunity の各フィールド定義に Phase54 の要点が反映されている", () => {
  assert.match(oppGen, /既存事業の言い換え.*不可/);
  assert.match(oppGen, /market_change.*会社の説明にしない/s);
  assert.match(oppGen, /最低4件.*非companyの関連source/s);
});

test("Phase54 STEP8: 他社の製品名を Opportunity title にしないルールが存在する", () => {
  assert.match(qualityRules, /他社の製品名・サービス名をそのまま Opportunity のタイトルにしない/);
});

test("Phase54 STEP8: market_change を低score 1件で組み立てないルールが存在する", () => {
  assert.match(qualityRules, /score が低い1件の source だけで組み立てない/);
  assert.match(qualityRules, /低score source を「唯一の根拠」に[\s\S]{0,10}しない/);
});

test("Phase54 STEP8: 中国の動画配信プラットフォームを「政府系」と書かないルールが存在する", () => {
  assert.match(qualityRules, /中国の動画配信プラットフォームを「政府系」「国営」と記述しない/);
  assert.match(qualityRules, /bilibili/);
  assert.match(qualityRules, /愛奇芸/);
  assert.match(qualityRules, /騰訊視頻/);
});

test("Phase54 STEP5: priority_matrix の内部参照整合性ルールが存在する（free-1 を作らない）", () => {
  assert.match(oppGen, /存在しないidを作らない/);
  assert.match(oppGen, /free-1/);
  assert.match(oppGen, /free-N/);
  assert.match(oppGen, /priority_matrix.{0,40}対象外/s);
  assert.match(qualityRules, /priority_matrix.{0,60}存在しないidを書いてはならない/s);
});
