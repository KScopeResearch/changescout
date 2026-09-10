/**
 * company-evidence-isolation.test.js — Phase56 STEP9-G（why_company evidence isolation）
 *
 * STEP9-E で ab-i.jp のレポート `why_company` が、同名の別法人（abi-inc.co.jp、IT/SaaS 系）の
 * 事業内容を対象企業の強みとして取り込んだ。relevance guard で score 30/reference へ降格済み
 * だったが LLM が採用した。score 降格だけでは不十分なため、source metadata に
 * `same_name_other_company` / `disqualified_for_company_claim` を付け、prompt（quality-rules.md
 * ルール7）で会社固有主張の根拠から除外させる。
 *
 * LLM・ネットワークは使わない（pure function）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { looksLikeSameNameOtherCompany } = require("../search/relevance-guard");
const { annotateCompanyClaimEligibility } = require("../company-context");

// --- looksLikeSameNameOtherCompany --------------------------------------

test("looksLikeSameNameOtherCompany: 同名の別法人（自社ブランド型タイトル / 会社概要パス）を検出", () => {
  // STEP9-E の実ケース: ab-i.jp に対する abi-inc.co.jp
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "会社情報｜株式会社ABI｜世の中の笑顔をつくるコネクト上流カンパニー", url: "https://abi-inc.co.jp/company" },
      ["株式会社ABI"],
      { targetUrl: "https://ab-i.jp" }
    ),
    true
  );
  // 株式会社カレイドスコープ に対する 声優事務所カレイドスコープ（klsp.jp/company）
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "声優事務所カレイドスコープ", url: "https://klsp.jp/company" },
      ["株式会社カレイドスコープ"],
      { targetUrl: "https://kscope.co.jp" }
    ),
    true
  );
});

test("looksLikeSameNameOtherCompany: 対象企業自身・調査会社・ディレクトリ・導入事例は false（誤検出しない）", () => {
  // 対象企業自身のページ（同一ドメイン）
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "…なら株式会社ABI", url: "https://ab-i.jp/" },
      ["株式会社ABI"],
      { targetUrl: "https://ab-i.jp" }
    ),
    false
  );
  // 市場調査ソース（タイトルに対象企業名の核なし）
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "「アニメ制作市場」動向調査2026｜株式会社 帝国データバンク[TDB]", url: "https://www.tdb.co.jp/report/industry/20260819-animation25y" },
      ["株式会社ABI"],
      { targetUrl: "https://ab-i.jp" }
    ),
    false
  );
  // 転職ディレクトリの会社ページ（/company/438814 = ID 付きパス・対象企業について）
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "株式会社ABIの会社概要|転職・求人・中途採用情報サイトのマイナビ転職", url: "https://tenshoku.mynavi.jp/company/438814" },
      ["株式会社ABI"],
      { targetUrl: "https://ab-i.jp" }
    ),
    false
  );
  // 他社サービスの導入事例（対象企業が顧客として登場）
  assert.equal(
    looksLikeSameNameOtherCompany(
      { title: "株式会社ABI 様の導入事例 | あるSaaS", url: "https://somesaas.com/case/abi" },
      ["株式会社ABI"],
      { targetUrl: "https://ab-i.jp" }
    ),
    false
  );
  // targetUrl 未指定 / url 未指定 → false
  assert.equal(looksLikeSameNameOtherCompany({ title: "株式会社ABI", url: "https://x.com" }, ["株式会社ABI"], {}), false);
  assert.equal(looksLikeSameNameOtherCompany({ title: "株式会社ABI" }, ["株式会社ABI"], { targetUrl: "https://ab-i.jp" }), false);
});

// --- annotateCompanyClaimEligibility -----------------------------------

test("annotateCompanyClaimEligibility: 同名の別法人 source に disqualified_for_company_claim=true を付ける", () => {
  const sources = [
    { id: "src-1", source_type: "company", url: "https://ab-i.jp", title: "…なら株式会社ABI", score: 93 },
    { id: "src-2", source_type: "statistics", url: "https://www.tdb.co.jp/report/industry/x", title: "アニメ制作市場 動向調査｜帝国データバンク", score: 95 },
    { id: "src-3", source_type: "news", url: "https://abi-inc.co.jp/company", title: "会社情報｜株式会社ABI｜コネクト上流カンパニー", score: 30, evidence_strength: "reference" },
  ];
  const out = annotateCompanyClaimEligibility(sources, {
    companyIdentityTokens: ["株式会社ABI"],
    targetUrl: "https://ab-i.jp",
  });
  // 対象企業自身
  assert.equal(out[0].disqualified_for_company_claim, false);
  assert.equal(out[0].same_name_other_company, false);
  // 市場調査ソースは維持（会社固有主張には使わないが、フラグは false = market_change 等で使える）
  assert.equal(out[1].disqualified_for_company_claim, false);
  // 同名の別法人 → 除外フラグ
  assert.equal(out[2].disqualified_for_company_claim, true);
  assert.equal(out[2].same_name_other_company, true);
  // score / source_type / url は不変
  assert.equal(out[2].score, 30);
  assert.equal(out[2].source_type, "news");
  assert.equal(out[2].url, "https://abi-inc.co.jp/company");
});

test("annotateCompanyClaimEligibility: source_type company（対象企業ドメイン一致）は常に適格", () => {
  const out = annotateCompanyClaimEligibility(
    [{ id: "src-1", source_type: "company", url: "https://ab-i.jp/company", title: "会社概要｜株式会社ABI", score: 93 }],
    { companyIdentityTokens: ["株式会社ABI"], targetUrl: "https://ab-i.jp" }
  );
  assert.equal(out[0].disqualified_for_company_claim, false);
});

test("annotateCompanyClaimEligibility: 空配列・欠損でクラッシュしない", () => {
  assert.deepEqual(annotateCompanyClaimEligibility([], {}), []);
  assert.deepEqual(annotateCompanyClaimEligibility(undefined, {}), []);
});
