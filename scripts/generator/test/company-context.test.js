/**
 * company-context.test.js — scripts/generator/company-context.js の guessCompanyName()、
 * および scripts/generator/search/relevance-guard.js の自動テスト。
 *
 * PJ2 AOR: 企業同一性バグ（弘和印刷株式会社→"KOWA"→無関係な興和株式会社の情報混入）の
 * 再発防止のための回帰テスト。実HTTP取得・実検索APIへは一切接続しない
 * （固定のtitle文字列・固定のmock sourceデータのみを使用する）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  guessCompanyName,
  normalizeCompanyName,
  extractLegalEntityName,
  containsLegalEntityKeyword,
  isTooAmbiguousAsCompanyName,
} = require("../company-context");
const {
  applyRelevanceGuard,
  looksLikeUnrelatedCompany,
  looksLikeDifferentCompanySameName,
  registrableDomain,
  sameRegistrableDomain,
  isSameCompanyName,
  extractCoreIdentity,
  extractAddressHint,
  extractIndustryKeywords,
  buildTargetProfile,
  looksLikeDifferentCompanyDespiteSameName,
} = require("../search/relevance-guard");

function companyResultWithLabel(label) {
  return { ok: true, label, organization: label };
}

// ---------------------------------------------------------------------------
// guessCompanyName()
// ---------------------------------------------------------------------------

test("guessCompanyName: 弘和印刷株式会社（KOWA-１色・2色印刷専門の「弘和印刷株式会社」）は「弘和印刷株式会社」を含む候補を返す（実際の事故ケースの回帰テスト）", () => {
  const label = "KOWA-１色・2色印刷専門の「弘和印刷株式会社」";
  const result = guessCompanyName(companyResultWithLabel(label), "http://www.kowax.jp/");
  assert.ok(result.includes("弘和印刷株式会社"), `期待: "弘和印刷株式会社"を含む。実際: "${result}"`);
  assert.notEqual(result, "KOWA");
});

test("guessCompanyName: 村山プロセス（製版　文京区｜アナログ製版は村山プロセス）は「村山プロセス」を含む候補を返す", () => {
  const label = "製版　文京区｜アナログ製版は村山プロセス";
  const result = guessCompanyName(companyResultWithLabel(label), "http://www.murayama-p.com/");
  assert.ok(result.includes("村山プロセス"), `期待: "村山プロセス"を含む。実際: "${result}"`);
  assert.notEqual(result, "製版　文京区");
});

test("guessCompanyName: 法人格を含むセグメントを優先する（ABC｜株式会社サンプル）", () => {
  const result = guessCompanyName(companyResultWithLabel("ABC｜株式会社サンプル"), "https://sample.example.jp/");
  assert.equal(result, "株式会社サンプル");
});

test("guessCompanyName: 法人格・括弧のいずれもない短い英字候補（KOWA - Home）はそのまま採用せずホスト名へフォールバックする", () => {
  const result = guessCompanyName(companyResultWithLabel("KOWA - Home"), "http://www.kowax.jp/");
  assert.notEqual(result, "KOWA");
  assert.equal(result, "www.kowax.jp");
});

test("guessCompanyName: companyResultが取得失敗の場合はホスト名を返す（既存挙動の回帰確認）", () => {
  const result = guessCompanyName({ ok: false, label: null }, "https://example.co.jp/");
  assert.equal(result, "example.co.jp");
});

test("containsLegalEntityKeyword: 株式会社/有限会社/合同会社を検出する", () => {
  assert.equal(containsLegalEntityKeyword("弘和印刷株式会社"), true);
  assert.equal(containsLegalEntityKeyword("有限会社村山プロセス"), true);
  assert.equal(containsLegalEntityKeyword("KOWA"), false);
});

test("isTooAmbiguousAsCompanyName: 短い/英数字のみの候補を曖昧と判定する", () => {
  assert.equal(isTooAmbiguousAsCompanyName("KOWA"), true);
  assert.equal(isTooAmbiguousAsCompanyName("ABC123"), true);
  assert.equal(isTooAmbiguousAsCompanyName("弘和印刷株式会社"), false);
  assert.equal(isTooAmbiguousAsCompanyName("アナログ製版は村山プロセス"), false);
});

// ---------------------------------------------------------------------------
// normalizeCompanyName() — company_profile.name 表示用の社名正規化（Phase53 STEP10.11）
// 実バグ: illegame.com のレポートで company_profile.name が <title> 生値
// 「イル・レガメのホームページへようこそ」になっていた（会社名は "IL LEGAME" / "イル・レガメ"）。
// ---------------------------------------------------------------------------

test("normalizeCompanyName: 挨拶文つき<title>から挨拶文を除いた社名候補を返す（Test C — illegame.com 実ケース）", () => {
  const result = normalizeCompanyName("イル・レガメのホームページへようこそ", {
    bodyText: "イル・レガメのホームページへようこそ IL LEGAME 私たちについて サービス 実績",
  });
  assert.notEqual(result, "イル・レガメのホームページへようこそ", "<title> 生値をそのまま返さない");
  assert.equal(result, "イル・レガメ");
});

test("normalizeCompanyName: 文中に法人格つき社名があれば抽出する（ab-i.jp 実ケース：full title / 検索スニペットの truncated title）", () => {
  assert.equal(
    normalizeCompanyName("アニメ制作から日本や中国での放映・コンテンツ配信なら株式会社ABI"),
    "株式会社ABI"
  );
  // 検索スニペット由来で <title> が途中で切れていても、会社ページ本文から拾える
  assert.equal(
    normalizeCompanyName("アニメ制作から日本や中国での放映・コンテンツ配信なら株式 ...", {
      bodyText: "本文の開始\n\n# 株式会社ABI\n\n日本国内と中国での映像コンテンツの配信",
    }),
    "株式会社ABI"
  );
});

test("normalizeCompanyName: 正規の社名を含む<title>は過剰に削らない（Test D）", () => {
  assert.equal(normalizeCompanyName("KOWA-１色・2色印刷専門の「弘和印刷株式会社」"), "弘和印刷株式会社");
  assert.equal(normalizeCompanyName("ABC｜株式会社サンプル"), "株式会社サンプル");
  assert.equal(normalizeCompanyName("有限会社さくら不動産"), "有限会社さくら不動産");
  assert.equal(normalizeCompanyName("○○工務店 公式サイト"), "○○工務店");
});

test("normalizeCompanyName: 社名候補が得られない<title>は null を返す（呼び出し元がフォールバック）", () => {
  assert.equal(normalizeCompanyName("Example Domain", { bodyText: "This domain is for use in illustrative examples." }), null);
  assert.equal(normalizeCompanyName("Welcome to Acme Corp"), null);
  assert.equal(normalizeCompanyName(""), null);
  assert.equal(normalizeCompanyName(null), null);
});

test("extractLegalEntityName: 前株・後株どちらの法人名も1件抽出でき、助詞を巻き込まない", () => {
  assert.equal(extractLegalEntityName("株式会社ABIを設立しました"), "株式会社ABI");
  assert.equal(extractLegalEntityName("…専門の弘和印刷株式会社です"), "弘和印刷株式会社");
  assert.equal(extractLegalEntityName("法人格の言及がない一般的な文章"), null);
});

// ---------------------------------------------------------------------------
// search/relevance-guard.js
// ---------------------------------------------------------------------------

test("relevance-guard: company sourceは対象外（無関係な言及があっても変更されない）", () => {
  const items = [
    {
      source_type: "company",
      title: "興和 - Wikipedia風の紛らわしいタイトル",
      content: "興和株式会社について",
      organization: null,
      score: 83,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"]);
  assert.deepEqual(result[0], items[0]);
});

test("relevance-guard: 無関係な別企業（興和株式会社）を主体的に説明するsourceはreferenceへ格下げ・scoreを引き下げる（実際の事故ケースの回帰テスト）", () => {
  const items = [
    {
      source_type: "statistics",
      title: "興和 - Wikipedia",
      content:
        "興和株式会社（こうわ、英: KOWA COMPANY LTD.）は、愛知県名古屋市中区に本社を置く日本の大手総合商社である。興和株式会社は、興和グループの統括会社である。",
      organization: null,
      score: 95,
      evidence_strength: "secondary",
    },
    {
      source_type: "industry_association",
      title: "Our history – Kowa corporate",
      content: "The Kowa Group continues to grow, with more than 8000 employees and 100 major subsidiaries worldwide.",
      organization: null,
      score: 90,
      evidence_strength: "secondary",
    },
  ];
  // 実運用の配線（company-context.js）に合わせ、guessCompanyName()修正後のクリーンな
  // 会社名のみを識別トークンとして渡す（生の<title>文字列は渡さない。生文字列を渡すと
  // ガード自身が同じ曖昧さに引きずられてしまうことが判明したため）。
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"]);

  result.forEach((item) => {
    assert.equal(item.evidence_strength, "reference");
    assert.ok(item.score <= 30, `score should be capped low, got ${item.score}`);
  });
});

test("relevance-guard: 対象企業名を含まないが法人名の言及もない一般市場情報は変更されない（過剰排除しないことの確認）", () => {
  const items = [
    {
      source_type: "government",
      title: "【超大型補助金】2025年住宅省エネキャンペーンスタート！",
      content:
        "2050年のカーボンニュートラルの実現に向けて、一般家庭でも省エネを推進しやすくするため、国（国土交通省、経済産業省、環境省）が補助金を提供し、その取り組みを支援しています。",
      organization: null,
      score: 100,
      evidence_strength: "primary",
    },
    {
      source_type: "statistics",
      title: "住宅リフォーム市場規模の推移",
      content: "住宅リフォーム市場は2025年に拡大傾向が続く見込みである。",
      organization: null,
      score: 90,
      evidence_strength: "secondary",
    },
  ];
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"]);
  assert.deepEqual(result, items, "法人名の言及がない一般情報は変更されるべきではない");
});

test("relevance-guard: 対象企業自身への言及がある場合は格下げしない（false positiveを避ける）", () => {
  const items = [
    {
      source_type: "news",
      title: "弘和印刷株式会社、モノクロ印刷技術で受賞",
      content: "弘和印刷株式会社（東京都足立区）が高精細モノクロ印刷技術のコンテストで表彰された。",
      organization: null,
      score: 75,
      evidence_strength: "reference",
    },
  ];
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"]);
  assert.deepEqual(result, items);
});

test("relevance-guard: companyIdentityTokensが空の場合はガードを適用しない（安全側フォールバック）", () => {
  const items = [
    { source_type: "statistics", title: "興和 - Wikipedia", content: "興和株式会社は...", score: 95, evidence_strength: "secondary" },
  ];
  const result = applyRelevanceGuard(items, []);
  assert.deepEqual(result, items);
});

test("isSameCompanyName: 弘和印刷と興和は同一ではない、弘和印刷と弘和印刷株式会社は同一", () => {
  assert.equal(isSameCompanyName("弘和印刷", "興和"), false);
  assert.equal(isSameCompanyName("弘和印刷", "弘和印刷株式会社"), true);
});

test("isSameCompanyName（PJ2 AOR「タカハシ」問題の回帰テスト）: 対象企業名が別企業名の一部に含まれているだけでは同一と判定しない", () => {
  // 旧実装は部分文字列の重なりだけで「同一企業」と誤判定していた
  // （"タカハシ"が"タカハシ工業"に含まれているだけで一致とみなしていた）。
  assert.equal(isSameCompanyName("株式会社タカハシ", "株式会社タカハシ工業"), false);
  assert.equal(isSameCompanyName("株式会社タカハシ", "株式会社タカハシテクノ"), false);
  // 完全一致（法人格の有無・空白の違いのみ）は引き続き同一と判定する
  assert.equal(isSameCompanyName("株式会社タカハシ", "株式会社 タカハシ"), true);
  assert.equal(isSameCompanyName("株式会社タカハシ", "タカハシ"), true);
});

test("extractCoreIdentity: 区切り文字のないtitleから来るノイズ入りトークンでも法人名の核を抜き出せる", () => {
  // guessCompanyName()が区切り文字を見つけられない場合、末尾に説明文が残ったままの
  // トークンになることがある（実際のタカハシのケース）。
  const noisyToken = "株式会社タカハシ　打ち抜きプレス加工屋";
  assert.equal(extractCoreIdentity(noisyToken), "株式会社タカハシ");
});

test("looksLikeUnrelatedCompany: 法人名の言及が一切ない場合はfalse（一般情報を誤検出しない）", () => {
  const item = { title: "住宅省エネ補助金について", content: "国が補助金を提供しています。" };
  assert.equal(looksLikeUnrelatedCompany(item, ["弘和印刷株式会社"]), false);
});

// ---------------------------------------------------------------------------
// PJ2 AOR「タカハシ」問題 追加検証（Test 1〜8）
// ---------------------------------------------------------------------------
// 対象企業「株式会社タカハシ」は、guessCompanyName()が区切り文字を見つけられない
// タイトル（"株式会社タカハシ　打ち抜きプレス加工屋"、実際の事故ケース）から来る、
// ノイズ入りの識別トークンをそのまま使う想定でテストする。

const TAKAHASHI_TOKEN = "株式会社タカハシ　打ち抜きプレス加工屋";

test("Test 1: 株式会社タカハシ工業は対象企業（株式会社タカハシ）とは別企業として検出される", () => {
  const item = {
    source_type: "technology",
    title: "株式会社タカハシ工業 | ホーム｜大手メーカー自動車部品の製造",
    content: "株式会社タカハシ工業は、プレス加工・溶接組立を主体とした自動車部品メーカーです。",
    score: 87,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, [TAKAHASHI_TOKEN]), true);
  const [result] = applyRelevanceGuard([item], [TAKAHASHI_TOKEN]);
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("Test 2: 株式会社タカハシテクノは対象企業とは別企業として検出される", () => {
  const item = {
    source_type: "technology",
    title: "株式会社タカハシテクノ｜金属プレス加工・空調ダクト部品",
    content: "株式会社タカハシテクノは金属プレス加工・空調ダクト部品を手がけています。",
    score: 87,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, [TAKAHASHI_TOKEN]), true);
});

test("Test 3: 株式会社タカハシ自身への言及は対象企業情報として正当に扱われる（格下げされない）", () => {
  const item = {
    source_type: "industry_association",
    title: "株式会社 タカハシ 東京都 荒川区",
    content: "株式会社タカハシは、打ち抜きプレスをしている加工屋です。ゴムパッキン、シールを製作しています。",
    score: 90,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, [TAKAHASHI_TOKEN]), false);
  const [result] = applyRelevanceGuard([item], [TAKAHASHI_TOKEN]);
  assert.deepEqual(result, item);
});

test("Test 4: 弘和印刷株式会社に対して興和株式会社は別企業として検出される", () => {
  const item = {
    source_type: "statistics",
    title: "興和 - Wikipedia",
    content: "興和株式会社は、愛知県名古屋市中区に本社を置く日本の大手総合商社である。",
    score: 95,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["弘和印刷株式会社"]), true);
});

test("Test 5: 弘和印刷株式会社に対してKowa Group（Kowa Pharmaceuticals配下）は別企業として検出される", () => {
  // 実際の事故ケース（kowapharmaceuticals.euのOur historyページ）を再現した内容。
  const item = {
    source_type: "industry_association",
    title: "Our history – Kowa corporate (Kowa Pharmaceuticals)",
    content: "The Kowa Group continues to grow, with more than 8000 employees and 100 major subsidiaries worldwide.",
    score: 90,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["弘和印刷株式会社"]), true);
});

test("Test 6: 株式会社ヨシズミプレス自身の情報は格下げされない（敬称「様」を含むタイトルの回帰テスト）", () => {
  // 実際にテスト中に発見した回帰: 前株パターンの名前部分が敬称「様」まで
  // 取り込んでしまい、正当な自社情報を誤って「別企業」と判定していた。
  const item = {
    source_type: "industry_association",
    title: "株式会社ヨシズミプレス様 | ソディックユーザレポート | インタビュー",
    content: "株式会社ヨシズミプレス様に、導入の経緯についてインタビューしました。",
    score: 90,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, ["株式会社ヨシズミプレス"]), false);
  const [result] = applyRelevanceGuard([item], ["株式会社ヨシズミプレス"]);
  assert.deepEqual(result, item);
});

test("Test 7: 企業名を直接含まない一般的な政府・市場情報は過剰排除されない", () => {
  const items = [
    {
      source_type: "government",
      title: "住宅省エネ2025キャンペーン",
      content: "国が補助金を提供し、一般家庭の省エネ改修を支援しています。",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社ヨシズミプレス"]);
  assert.deepEqual(result, items);
});

test("Test 8: 法人格を伴わない「タカハシ」という短い文字列だけの一般記事は、同一企業とも別企業とも断定しない", () => {
  const item = {
    source_type: "news",
    title: "タカハシという地名の由来について",
    content: "全国各地に「タカハシ」という地名や店舗名が見られます。",
    score: 80,
    evidence_strength: "reference",
  };
  // 法人格を伴わないため「別企業の明示的な言及」としては検出されない（過剰な誤検出を避ける）。
  assert.equal(looksLikeUnrelatedCompany(item, [TAKAHASHI_TOKEN]), false);
  // ただし、これは「対象企業の情報として積極的に採用してよい」という意味ではなく、
  // 単にガードが「無関係だと断定できない」として素通りさせているだけである。
});

// ---------------------------------------------------------------------------
// PJ2 AOR: 完全同名企業の識別（住所・業種による企業identity判定）
// ---------------------------------------------------------------------------
// 「株式会社タカハシ」という会社名だけでは、東京の対象企業と大阪の無関係な同名企業を
// 区別できない問題への対応。buildTargetProfile()で対象企業自身のページ本文から
// 住所・業種を抽出し、名前が完全一致したsourceについてのみ追加で照合する。

test("extractAddressHint: 都道府県・市区町村を抽出できる", () => {
  assert.deepEqual(extractAddressHint("東京都墨田区にある町工場です。"), {
    prefecture: "東京都",
    cityWard: "墨田区",
  });
  assert.deepEqual(extractAddressHint("特に所在地の記載はありません。"), {
    prefecture: null,
    cityWard: null,
  });
});

test("extractIndustryKeywords: 業種キーワードの集合を抽出できる", () => {
  assert.deepEqual(extractIndustryKeywords("当社はプレス加工を専門としています。"), new Set(["プレス加工"]));
  assert.deepEqual(extractIndustryKeywords("非鉄金属材料の販売・加工を行っています。"), new Set(["非鉄金属"]));
  assert.deepEqual(extractIndustryKeywords("特にキーワードを含まない文章です。"), new Set());
});

test("Identity Test 1: 完全同名・住所違い（東京 vs 大阪）は別企業と判定する", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシは東京都でプレス加工業を営んでいます。");
  const candidateText = "株式会社タカハシ（大阪府）は非鉄金属材料の販売・加工を行う会社です。";
  assert.equal(looksLikeDifferentCompanyDespiteSameName(targetProfile, candidateText), true);
});

test("Identity Test 2: 完全同名・住所一致（東京都墨田区）は同一企業候補として扱う", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシは東京都墨田区にあるプレス加工の会社です。");
  const candidateText = "株式会社タカハシ（東京都墨田区）のインタビュー記事です。";
  assert.equal(looksLikeDifferentCompanyDespiteSameName(targetProfile, candidateText), false);
});

test("Identity Test 3: 完全同名・業種違い（住所情報なし）は別企業方向へ強く傾ける", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシはプレス加工を専門とする会社です。");
  const candidateText = "株式会社タカハシは非鉄金属材料の販売を手がけています。";
  assert.equal(looksLikeDifferentCompanyDespiteSameName(targetProfile, candidateText), true);
});

test("Identity Test 4: 完全同名・住所情報なしは別企業と断定しない（安全側フォールバック）", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシは東京都にある会社です。");
  const candidateText = "株式会社タカハシについて紹介します。"; // 住所・業種いずれの手がかりもない
  assert.equal(looksLikeDifferentCompanyDespiteSameName(targetProfile, candidateText), false);
});

test("Identity Test 5〜6: タカハシ工業・タカハシテクノは名前の時点で別企業と判定される（住所・業種チェック以前の問題）", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシは東京都でプレス加工業を営んでいます。");
  const kogyoItem = {
    source_type: "technology",
    title: "株式会社タカハシ工業 | 大手メーカー自動車部品の製造",
    content: "株式会社タカハシ工業はプレス加工・溶接組立を行っています。",
    score: 87,
    evidence_strength: "secondary",
  };
  const technoItem = {
    source_type: "technology",
    title: "株式会社タカハシテクノ｜金属プレス加工・空調ダクト部品",
    content: "株式会社タカハシテクノは金属プレス加工を手がけています。",
    score: 87,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(kogyoItem, [TAKAHASHI_TOKEN], targetProfile), true);
  assert.equal(looksLikeUnrelatedCompany(technoItem, [TAKAHASHI_TOKEN], targetProfile), true);
});

test("Identity Test 7: 対象企業自身（住所・業種一致）はtargetProfileを渡しても格下げされない", () => {
  const targetProfile = buildTargetProfile("株式会社タカハシは東京都荒川区でゴムパッキン加工を営んでいます。");
  const item = {
    source_type: "industry_association",
    title: "株式会社タカハシ 東京都荒川区",
    content: "株式会社タカハシはゴムパッキン加工を専門とする加工屋です。",
    score: 90,
    evidence_strength: "secondary",
  };
  assert.equal(looksLikeUnrelatedCompany(item, [TAKAHASHI_TOKEN], targetProfile), false);
  const [result] = applyRelevanceGuard([item], [TAKAHASHI_TOKEN], "株式会社タカハシは東京都荒川区でゴムパッキン加工を営んでいます。");
  assert.deepEqual(result, item);
});

test("Identity Test 8: 弘和印刷回帰（targetProfileを渡しても興和株式会社・Kowa Group・幸和建設は引き続き格下げされる）", () => {
  const targetProfileText = "弘和印刷株式会社は東京都足立区にある印刷会社です。";
  const items = [
    {
      source_type: "statistics",
      title: "興和 - Wikipedia",
      content: "興和株式会社は、愛知県名古屋市中区に本社を置く日本の大手総合商社である。",
      score: 95,
      evidence_strength: "secondary",
    },
    {
      source_type: "industry_association",
      title: "Our history – Kowa corporate",
      content: "The Kowa Group continues to grow, with more than 8000 employees worldwide.",
      score: 90,
      evidence_strength: "secondary",
    },
    {
      // 実際の事故データを再現: 幸和建設は自社ページ上で英語表記"KOWA KENSETSU Co.,Ltd."を
      // 併記しており、日本語の「幸和建設」単体には法人格キーワードが付いていない
      // （このためJP側パターンでは検出できず、EN側パターンでの検出に依存する）。
      source_type: "government",
      title: "【超大型補助金】2025年住宅省エネキャンペーン | 幸和建設",
      content: "KOWA KENSETSU Co.,Ltd. 幸和建設は住宅省エネ補助金について解説しています。",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"], targetProfileText);
  result.forEach((item) => {
    assert.equal(item.evidence_strength, "reference");
    assert.ok(item.score <= 30);
  });
});

test("Identity Test 9: ヨシズミプレス回帰（targetProfileを渡しても自社sourceは格下げされない）", () => {
  const targetProfileText = "株式会社ヨシズミプレスは東京都墨田区でプレス加工業を営んでいます。";
  const items = [
    {
      source_type: "industry_association",
      title: "株式会社ヨシズミプレス様 | ソディックユーザレポート | インタビュー",
      content: "株式会社ヨシズミプレス様に導入の経緯についてインタビューしました。",
      score: 90,
      evidence_strength: "secondary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社ヨシズミプレス"], targetProfileText);
  assert.deepEqual(result, items);
});

test("Identity Test 10: 共同印刷回帰（targetProfileを渡しても引き続きreference/score<=30）", () => {
  const targetProfileText = "弘和印刷株式会社は東京都足立区にある印刷会社です。";
  const items = [
    {
      source_type: "news",
      title: "ニュースリリース | 共同印刷西日本株式会社",
      content: "共同印刷西日本株式会社の最新ニュースです。",
      score: 30,
      evidence_strength: "reference",
    },
    {
      source_type: "news",
      title: "ニュースリリース｜TOMOWEL 共同印刷株式会社",
      content: "TOMOWEL 共同印刷株式会社のプレスリリースです。",
      score: 30,
      evidence_strength: "reference",
    },
  ];
  const result = applyRelevanceGuard(items, ["弘和印刷株式会社"], targetProfileText);
  result.forEach((item) => {
    assert.equal(item.evidence_strength, "reference");
    assert.ok(item.score <= 30);
  });
});

// ---------------------------------------------------------------------------
// PJ2 AOR: 新潟・長岡ケース対応（ground-truth-only設計への刷新、Test A〜H）
// ---------------------------------------------------------------------------
// leave-one-out投票方式で発生した回帰（対象企業自身の唯一の住所証拠を誤って
// 別企業判定してしまう）を受け、対象企業自身のページ本文（ground truth）のみを
// 住所・業種の情報源とする設計へ変更した際の回帰・新規ケーステスト。

test("Test A: 完全同名・住所違い（東京 vs 新潟、精密板金加工）は別企業として検出される", () => {
  const targetProfileText = "株式会社タカハシは東京都でゴム加工・プレス加工を営んでいます。";
  const item = {
    source_type: "news",
    title: "株式会社タカハシ – 中越・長岡の総合精密板金加工",
    content: "新潟県長岡市の総合精密板金加工の(株)タカハシです。中薄金属鋼板の精密板金加工を中心に各種溶接を行っています。",
    score: 80,
    evidence_strength: "reference",
  };
  const [result] = applyRelevanceGuard([item], ["株式会社タカハシ"], targetProfileText);
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("Test B: 完全同名・住所違い（東京 vs 大阪、非鉄金属）は別企業として検出される", () => {
  const targetProfileText = "株式会社タカハシは東京都でゴム加工・プレス加工を営んでいます。";
  const item = {
    source_type: "news",
    title: "大阪市東成区の株式会社タカハシ｜非鉄金属材料の販売・加工のプロフェッショナル",
    content: "大阪府大阪市東成区の株式会社タカハシは非鉄金属材料の販売・加工を行っています。",
    score: 80,
    evidence_strength: "reference",
  };
  const [result] = applyRelevanceGuard([item], ["株式会社タカハシ"], targetProfileText);
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("Test C: 対象企業の住所が不明でも、業種の不一致（精密板金 vs ゴム/プレス）で別企業と判定できる", () => {
  // 対象企業のページ本文には住所が一切含まれない（実際の事故ケースの再現）。
  const targetProfileText = "株式会社タカハシはゴムスポンジ加工・打ち抜きプレス加工を主体とした業務展開をしております。";
  const item = {
    source_type: "news",
    title: "株式会社タカハシ – 中越・長岡の総合精密板金加工",
    content: "新潟県長岡市の総合精密板金加工の(株)タカハシです。",
    score: 80,
    evidence_strength: "reference",
  };
  const [result] = applyRelevanceGuard([item], ["株式会社タカハシ"], targetProfileText);
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("Test D: 候補に住所情報がなく業種が一致する場合は、同一企業候補として維持される", () => {
  const targetProfileText = "株式会社タカハシは東京都でゴム加工・プレス加工を営んでいます。";
  const item = {
    source_type: "industry_association",
    title: "株式会社タカハシ | 企業情報",
    content: "株式会社タカハシはプレス加工を専門とする加工屋です。", // 住所情報なし
    score: 90,
    evidence_strength: "secondary",
  };
  const [result] = applyRelevanceGuard([item], ["株式会社タカハシ"], targetProfileText);
  assert.deepEqual(result, item);
});

test("Test E: 対象企業の住所情報が、ある1つの自社sourceにしか存在しない場合でも、そのsource自身は誤って格下げされない（leave-one-out回帰の再発防止）", () => {
  // 対象企業自身のページ本文には住所がない。この1件だけが住所を持つ自社source。
  const targetProfileText = "株式会社タカハシはゴムスポンジ加工・打ち抜きプレス加工を主体とした業務展開をしております。";
  const items = [
    {
      source_type: "industry_association",
      title: "株式会社 タカハシ 東京都 荒川区",
      content: "株式会社タカハシは、打ち抜きプレスをしている加工屋です。",
      score: 90,
      evidence_strength: "secondary",
    },
    {
      // 無関係な別企業（同名）。この存在によってTest Eのsourceが巻き込まれて
      // 誤格下げされないことを確認する（leave-one-out回帰の再発防止）。
      source_type: "news",
      title: "株式会社タカハシ – 中越・長岡の総合精密板金加工",
      content: "新潟県長岡市の総合精密板金加工の(株)タカハシです。",
      score: 80,
      evidence_strength: "reference",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社タカハシ"], targetProfileText);
  assert.deepEqual(result[0], items[0], "対象企業自身の唯一の住所証拠sourceが誤って格下げされてはならない");
  assert.equal(result[1].evidence_strength, "reference");
});

test("Test F: 対象企業の業種情報が、ある1つの自社sourceにしか存在しない場合でも、そのsource自身は誤って格下げされない", () => {
  // 対象企業自身のページ本文には業種情報がない（一般的な説明のみ）。
  const targetProfileText = "株式会社タカハシは東京都にある会社です。";
  const item = {
    source_type: "industry_association",
    title: "株式会社タカハシ",
    content: "株式会社タカハシは打ち抜きプレス加工を専門としています。", // この1件だけが業種情報を持つ
    score: 90,
    evidence_strength: "secondary",
  };
  const [result] = applyRelevanceGuard([item], ["株式会社タカハシ"], targetProfileText);
  assert.deepEqual(result, item);
});

test("Test G: 対象企業自身の住所（東京都）が明示されている場合、複数の同名別企業（新潟県）が存在しても自社sourceは格下げされず、別企業側は強く格下げされる", () => {
  const targetProfileText = "株式会社タカハシは東京都荒川区でゴム加工・プレス加工を営んでいます。";
  const items = [
    {
      source_type: "industry_association",
      title: "株式会社タカハシ 東京都",
      content: "株式会社タカハシはプレス加工を専門としています。",
      score: 90,
      evidence_strength: "secondary",
    },
    {
      source_type: "news",
      title: "株式会社タカハシ – 中越・長岡の総合精密板金加工（1）",
      content: "新潟県長岡市の(株)タカハシは精密板金加工を行っています。",
      score: 80,
      evidence_strength: "reference",
    },
    {
      source_type: "news",
      title: "株式会社タカハシ – 中越・長岡の総合精密板金加工（2）",
      content: "新潟県長岡市の(株)タカハシは精密板金加工を行っています。",
      score: 80,
      evidence_strength: "reference",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社タカハシ"], targetProfileText);
  assert.deepEqual(result[0], items[0], "対象企業自身のsourceは、無関係な同名別企業が複数あっても格下げされてはならない");
  assert.equal(result[1].evidence_strength, "reference");
  assert.equal(result[2].evidence_strength, "reference");
});

test("Test H: 対象企業自身の複数source（東京都・ゴム加工／東京都・プレス加工）はすべて正当な自社sourceとして維持される", () => {
  const targetProfileText = "株式会社タカハシは東京都荒川区にある会社です。";
  const items = [
    {
      source_type: "industry_association",
      title: "株式会社タカハシ 東京都",
      content: "株式会社タカハシはゴムパッキン加工を行っています。",
      score: 90,
      evidence_strength: "secondary",
    },
    {
      source_type: "industry_association",
      title: "株式会社タカハシ 東京都荒川区",
      content: "株式会社タカハシは打ち抜きプレス加工を専門としています。",
      score: 87,
      evidence_strength: "secondary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社タカハシ"], targetProfileText);
  assert.deepEqual(result, items);
});

// ---------------------------------------------------------------------------
// Phase53 STEP10.12 — Source Relevance / name-collision / geographic guard
// ---------------------------------------------------------------------------

test("registrableDomain / sameRegistrableDomain: co.jp 等の2階層TLDを考慮する", () => {
  assert.equal(registrableDomain("https://www.ab-i.jp/company"), "ab-i.jp");
  assert.equal(registrableDomain("https://abi-inc.co.jp/"), "abi-inc.co.jp");
  assert.equal(sameRegistrableDomain("https://ab-i.jp", "https://www.ab-i.jp/x"), true);
  assert.equal(sameRegistrableDomain("https://ab-i.jp", "https://abi-inc.co.jp"), false);
});

test("STEP10.12 Test A: company source は targetUrl を渡してもガード対象外（STEP10.11 preservation 回帰）", () => {
  const items = [
    {
      source_type: "company",
      title: "株式会社ABI｜アニメ制作から日中配信まで",
      summary: "株式会社ABIは日中のコンテンツ事業を展開しています。",
      url: "https://www.ab-i.jp",
      score: 93,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社ABI"], "株式会社ABIは日中のアニメ事業を営む。", {
    targetUrl: "https://ab-i.jp",
  });
  assert.deepEqual(result[0], items[0]);
});

test("STEP10.12 Test B: 別ドメインで対象企業と同名を名乗る別法人の公式ページは reference / score<=30 へ降格（abi-inc.co.jp）", () => {
  const items = [
    {
      source_type: "technology",
      title: "株式会社ABI｜世の中の笑顔をつくるコネクト上流カンパニー",
      content: "富山市主催の官民共創交流会に弊社代表が登壇。イベント企画運営を行っています。",
      url: "https://abi-inc.co.jp",
      score: 87,
      evidence_strength: "secondary",
    },
  ];
  const [result] = applyRelevanceGuard(items, ["株式会社ABI"], "株式会社ABIは日中のアニメ制作・配信事業を営む。", {
    targetUrl: "https://ab-i.jp",
  });
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30, `score should be capped, got ${result.score}`);
});

test("STEP10.12 Test B2: 同名でも第三者コンテンツ（導入事例・別ドメイン）は誤って降格しない", () => {
  const items = [
    {
      source_type: "industry_association",
      title: "株式会社ヨシズミプレス様 | ソディックユーザレポート",
      content: "株式会社ヨシズミプレス様に導入の経緯についてインタビューしました。",
      url: "https://www.sodick.co.jp/case/yoshizumi",
      score: 90,
      evidence_strength: "secondary",
    },
  ];
  const [result] = applyRelevanceGuard(items, ["株式会社ヨシズミプレス"], "株式会社ヨシズミプレスは東京都墨田区のプレス加工会社。", {
    targetUrl: "https://yoshizumi-press.co.jp",
  });
  assert.deepEqual(result, items[0]);
});

test("STEP10.12 Test C: 別地域の自治体の移住・定住プログラムページは company evidence 級に扱わない（reference へ降格）", () => {
  const items = [
    {
      source_type: "government",
      title: "きりゅう暮らし応援事業（移住者住宅取得助成）補助金 - 桐生市",
      content: "桐生市への移住者に住宅取得費用を助成します。",
      url: "https://www.city.kiryu.lg.jp/kurashi/1001137.html",
      score: 100,
      evidence_strength: "primary",
    },
    {
      source_type: "government",
      title: "日高市移住・定住促進事業／日高市ホームページ",
      content: "日高市では移住・定住を促進しています。",
      url: "https://www.city.hidaka.lg.jp/22838.html",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  // 対象企業は事業開発コンサル（移住・住宅とは無関係、所在地はページから不明）
  const result = applyRelevanceGuard(items, ["イル・レガメ"], "イル・レガメは事業開発コンサルティングを行う。", {
    targetUrl: "https://illegame.com",
  });
  result.forEach((r) => {
    assert.equal(r.evidence_strength, "reference");
    assert.ok(r.score <= 30);
  });
});

test("STEP10.12 Test C2: 市区町村名を含んでも移住・定住系キーワードが無い一般情報は降格しない（過剰排除防止）", () => {
  const items = [
    {
      source_type: "government",
      title: "東京都 中小企業向けDX推進補助金のご案内",
      content: "都内の中小企業のデジタル化を支援します。",
      url: "https://www.tokyo.example/dx",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  const result = applyRelevanceGuard(items, ["イル・レガメ"], "イル・レガメは事業開発コンサル。", {
    targetUrl: "https://illegame.com",
  });
  assert.deepEqual(result, items);
});

test("STEP10.12 Test D: 対象企業の所在都道府県が判明していれば、別都道府県の補助金情報を降格する", () => {
  const items = [
    {
      source_type: "government",
      title: "新潟県 空き家改修補助金",
      content: "新潟県内の空き家改修に補助金を交付します。",
      url: "https://www.pref.niigata.example/akiya",
      score: 100,
      evidence_strength: "primary",
    },
  ];
  const [result] = applyRelevanceGuard(
    items,
    ["株式会社サンプル"],
    "株式会社サンプルは東京都渋谷区のIT企業です。",
    { targetUrl: "https://sample.example" }
  );
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("STEP10.12 Test I: 弘和印刷回帰（既存の別企業降格は STEP10.12 変更後も維持される）", () => {
  const items = [
    {
      source_type: "statistics",
      title: "興和 - Wikipedia",
      content: "興和株式会社は、愛知県名古屋市中区に本社を置く大手総合商社である。",
      score: 95,
      evidence_strength: "secondary",
    },
  ];
  const [result] = applyRelevanceGuard(items, ["弘和印刷株式会社"], "弘和印刷株式会社は東京都足立区の印刷会社。");
  assert.equal(result.evidence_strength, "reference");
  assert.ok(result.score <= 30);
});

test("STEP10.12 Test J: 一般的な市場・業界情報（企業名・地域プログラムの言及なし）は従来どおり不変", () => {
  const items = [
    {
      source_type: "statistics",
      title: "アニメ産業市場、初の2兆円突破",
      content: "アニメ産業の市場規模が拡大し、海外売上が成長を牽引している。",
      url: "https://japan-forward.example/anime",
      score: 95,
      evidence_strength: "secondary",
    },
  ];
  const result = applyRelevanceGuard(items, ["株式会社ABI"], "株式会社ABIは日中アニメ事業を営む。", {
    targetUrl: "https://ab-i.jp",
  });
  assert.deepEqual(result, items);
});
