/**
 * benefit-card.test.js — Phase56 STEP1
 * Hero 直下の Benefit カード3枚（なぜ今 / なぜ御社 / 今日できること）の view model。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const P = require(path.join(__dirname, "..", "..", "..", "website", "aor", "assets", "js", "preview-ui.js"));
const { loadReport } = require("./fixtures/aor-reports");

test("benefitCards: 3社で 3 枚（なぜ今 / なぜ御社 / 今日できること）が揃う", () => {
  ["kscope.co.jp", "ab-i.jp", "illegame.com"].forEach((s) => {
    const cards = P.benefitCards(loadReport(s));
    assert.equal(cards.length, 3, s);
    assert.deepEqual(cards.map((c) => c.key), ["why_now", "why_company", "first_action"]);
    assert.deepEqual(cards.map((c) => c.label), ["なぜ今か", "なぜ御社か", "今日できること"]);
    cards.forEach((c) => {
      assert.ok(c.text.length > 0, s + " " + c.key + " 空");
      assert.doesNotMatch(c.text, /src-\d+/, s + " src-N 残り");
      assert.doesNotMatch(c.text, /undefined|null|\[object Object\]/);
    });
  });
});

test("benefitCards: text は 1 文に切り詰め（長文は「…」）", () => {
  const cards = P.benefitCards({
    free_opportunity: {
      why_now: "あ".repeat(300) + "。",
      why_company: "短い。",
      first_action: "やる。",
    },
  });
  assert.ok(cards[0].text.length <= 125);
  assert.ok(cards[0].text.endsWith("…"));
  assert.equal(cards[1].text, "短い。");
});

test("benefitCards: 該当フィールドが無ければそのカードは出さない（捏造しない）", () => {
  const cards = P.benefitCards({ free_opportunity: { why_now: "変化がある。" } });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, "why_now");
});

test("benefitCards: 空 report で空配列", () => {
  assert.deepEqual(P.benefitCards({}), []);
  assert.deepEqual(P.benefitCards({ free_opportunity: {} }), []);
});

test("benefitCards: illegame の壊れた business_summary はどのカードにも出ない", () => {
  const cards = P.benefitCards(loadReport("illegame.com"));
  const blob = JSON.stringify(cards);
  ["代表者", "外神田", "## |", "資本金 100", "サンプル 太郎"].forEach((f) => {
    assert.ok(!blob.includes(f), "混入: " + f);
  });
});
