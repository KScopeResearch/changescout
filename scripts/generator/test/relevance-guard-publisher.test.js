/**
 * relevance-guard-publisher.test.js — Phase56 STEP9-D（P1: Relevance Guard calibration）
 *
 * STEP9-C で確認した回帰: 市場調査レポート（帝国データバンク「アニメ制作市場」動向調査、
 * IMARC Group のアニメ市場規模予測 等）が、本文に発行元の法人名が出るだけで
 * looksLikeUnrelatedCompany() ルール(4) に該当し score 95→30/reference へ降格していた。
 *
 * P1: 発行元（調査会社・シンクタンク・業界メディア・大手コンサル）の法人名は
 * 「別企業を説明している」ことの証拠にしない。ただし発行元でない別法人
 * （別の総合商社・競合の製品ページ等）は従来どおり降格する。
 *
 * LLM・ネットワークは使わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  applyRelevanceGuard,
  looksLikeUnrelatedCompany,
  isResearchPublisherName,
} = require("../search/relevance-guard");

// --- isResearchPublisherName -----------------------------------------------

test("isResearchPublisherName: 調査会社・シンクタンク・海外調査会社を発行元として認識する", () => {
  for (const name of [
    "株式会社 帝国データバンク",
    "株式会社帝国データバンク",
    "東京商工リサーチ",
    "矢野経済研究所",
    "IMARC Group",
    "IMARC",
    "Grand View Research",
    "株式会社日本総研",
    "MM総研",
    "ガートナー",
  ]) {
    assert.equal(isResearchPublisherName(name), true, `${name} は発行元として認識されるべき`);
  }
});

test("isResearchPublisherName: 発行元でない一般法人は false", () => {
  for (const name of [
    "興和株式会社",
    "株式会社タカハシ工業",
    "Kowa Group",
    "株式会社サンライズ",
    "ミラレソ株式会社",
  ]) {
    assert.equal(isResearchPublisherName(name), false, `${name} は発行元ではない`);
  }
});

// --- P1: 市場調査ソースが誤って無関係扱いされない -------------------------

test("P1: 帝国データバンクの市場動向調査は unrelated 扱いにならない（発行元名の言及のみ）", () => {
  const item = {
    source_type: "statistics",
    title: "「アニメ制作市場」動向調査2026｜株式会社 帝国データバンク[TDB]",
    content:
      "株式会社帝国データバンクは、アニメ制作市場の動向調査を実施した。2025年の市場規模は前年比9.9％増の4065億8600万円で初の4千億円突破。2026年は人手不足を背景に5年ぶりの減少が見込まれる。",
    organization: null,
    score: 95,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["株式会社ABI"]), false);
  const [result] = applyRelevanceGuard([item], ["株式会社ABI"], "株式会社ABIは日中のアニメ制作・配信事業を営む。", {
    targetUrl: "https://ab-i.jp",
  });
  assert.equal(result.score, 95, "score は据え置き");
  assert.equal(result.evidence_strength, "secondary", "evidence_strength は据え置き");
});

test("P1: IMARC Group のアニメ市場規模レポートは unrelated 扱いにならない", () => {
  const item = {
    source_type: "statistics",
    title: "日本のアニメ市場規模、2034年までに41億2,000万米ドルに到達へ（年平均成長率7.28%） | IMARC Group",
    content: "IMARC Group によると、日本のアニメ市場は2034年までに大きく成長する見込み。",
    organization: null,
    score: 95,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["株式会社ABI"]), false);
  const [result] = applyRelevanceGuard([item], ["株式会社ABI"], "株式会社ABIは日中アニメ事業。", {
    targetUrl: "https://ab-i.jp",
  });
  assert.equal(result.score, 95);
});

test("P1: 政府統計（法人名の言及なし）は従来どおり据え置き（過剰排除の非回帰）", () => {
  const items = [
    {
      source_type: "government",
      title: "コンテンツ産業の海外展開に関する政策動向",
      content: "経済産業省は、コンテンツ産業を戦略分野に位置づけ、海外売上高の目標を掲げている。",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社ABI"], "株式会社ABIは日中アニメ事業。");
  assert.deepEqual(result, items);
});

// --- P1: 発行元でない別企業は従来どおり降格する（非回帰） -----------------

test("P1 非回帰: 無関係な別企業（興和株式会社）を説明する statistics ソースは従来どおり降格", () => {
  const items = [
    {
      source_type: "statistics",
      title: "興和 - Wikipedia",
      content:
        "興和株式会社（こうわ、英: KOWA COMPANY LTD.）は、愛知県名古屋市中区に本社を置く日本の大手総合商社である。",
      score: 95,
      evidence_strength: "secondary",
    },
  ];
  const [result] = applyRelevanceGuard(items, ["弘和印刷株式会社"]);
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("P1 非回帰: Kowa Group（英語・発行元でない別法人）も従来どおり降格", () => {
  const item = {
    source_type: "industry_association",
    title: "Our history – Kowa corporate",
    content: "The Kowa Group continues to grow, with more than 8000 employees and 100 major subsidiaries worldwide.",
    score: 90,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["弘和印刷株式会社"]), true);
});

test("P1: 発行元名 + 別の主体企業名が両方出る場合は、別主体で判定される（降格されうる）", () => {
  const item = {
    source_type: "news",
    title: "帝国データバンク調査：株式会社サンプル商事が新工場を建設",
    content: "帝国データバンクの調査によると、株式会社サンプル商事は新工場を建設する。",
    score: 75,
    evidence_strength: "reference",
  };
  // 帝国データバンク は除外されるが、株式会社サンプル商事 が残るため unrelated 判定は生きる
  assert.equal(looksLikeUnrelatedCompany(item, ["株式会社ABI"]), true);
});
