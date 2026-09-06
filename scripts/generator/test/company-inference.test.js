/**
 * company-inference.test.js — scripts/generator/leads/company-inference.js の自動テスト。
 *
 * PJ2 AOR本来のStep②（emailを起点とした企業・担当者調査）の最小実装を検証する。
 * 実HTTP取得は一切行わない（fetchCompanyをDIでダミー関数に差し替える）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractDomain,
  extractLocalPart,
  isFreeEmailDomain,
  guessContactNameFromLocalPart,
  findDomainMatchInSearchResults,
  inferCompanyFromEmail,
} = require("../leads/company-inference");

// ---------------------------------------------------------------------------
// extractDomain / extractLocalPart
// ---------------------------------------------------------------------------

test("extractDomain: 正しくドメイン部分を抽出する", () => {
  assert.equal(extractDomain("taro@example.co.jp"), "example.co.jp");
  assert.equal(extractDomain("INFO@EXAMPLE.COM"), "example.com");
});

test("extractDomain: 不正な形式はnullを返す", () => {
  assert.equal(extractDomain("not-an-email"), null);
  assert.equal(extractDomain("trailing-at@"), null);
  assert.equal(extractDomain(""), null);
  assert.equal(extractDomain(null), null);
});

test("extractLocalPart: 正しくローカル部を抽出する", () => {
  assert.equal(extractLocalPart("taro.yamada@example.co.jp"), "taro.yamada");
});

// ---------------------------------------------------------------------------
// isFreeEmailDomain
// ---------------------------------------------------------------------------

test("isFreeEmailDomain: 主要な個人向けメールドメインを検出する", () => {
  assert.equal(isFreeEmailDomain("gmail.com"), true);
  assert.equal(isFreeEmailDomain("yahoo.co.jp"), true);
  assert.equal(isFreeEmailDomain("example.co.jp"), false);
});

// ---------------------------------------------------------------------------
// guessContactNameFromLocalPart（安全策の検証）
// ---------------------------------------------------------------------------

test("guessContactNameFromLocalPart: firstname.lastname形式は候補として抽出する（confidence lowの前提）", () => {
  const result = guessContactNameFromLocalPart("taro.yamada");
  assert.equal(result.name, "Taro Yamada");
  assert.equal(result.source, "email_localpart_heuristic");
});

test("guessContactNameFromLocalPart: 代表窓口アドレス（info等）からは人名を生成しない", () => {
  ["info", "sales", "contact", "support", "admin", "noreply"].forEach((local) => {
    const result = guessContactNameFromLocalPart(local);
    assert.equal(result.name, null, `"${local}"からは人名を生成しないはず`);
    assert.equal(result.source, null);
  });
});

test("guessContactNameFromLocalPart: 単語1つ・数字混じり等の曖昧なローカル部からは何も生成しない", () => {
  assert.deepEqual(guessContactNameFromLocalPart("yamada"), { name: null, source: null });
  assert.deepEqual(guessContactNameFromLocalPart("t.yamada123"), { name: null, source: null });
  assert.deepEqual(guessContactNameFromLocalPart("sales2024"), { name: null, source: null });
});

// ---------------------------------------------------------------------------
// inferCompanyFromEmail（実HTTP取得なし、fetchCompanyをDI）
// ---------------------------------------------------------------------------

test("inferCompanyFromEmail: フリーメールドメインはok:falseを返し、company_urlを決め打ちしない（検索も行わない）", async () => {
  const result = await inferCompanyFromEmail("taro.yamada@gmail.com", {
    fetchCompany: async () => {
      throw new Error("フリーメールドメインの場合、fetchCompanyは呼ばれてはならない");
    },
    search: async () => {
      throw new Error("フリーメールドメインの場合、searchは呼ばれてはならない");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "free_email_domain");
  assert.equal(result.company_url, null);
  assert.equal(result.contact_name, "Taro Yamada", "フリーメールでも人名候補自体は返してよい（企業とは無関係のため）");
});

// ---------------------------------------------------------------------------
// ケース1: fetch成功・検索結果あり（裏付けなし）→ confidence=medium（従来通り）
// ---------------------------------------------------------------------------

test("【ケース1/4】inferCompanyFromEmail: fetch成功・検索結果なしはconfidence=mediumで確定候補を返す（検索なしでも動作する）", async () => {
  const fakeFetch = async (url) => ({
    ok: true,
    url,
    label: "Example Corporation",
    content: "Example Corporationの公式サイトです。",
    error: null,
  });

  const result = await inferCompanyFromEmail("taro.yamada@example.co.jp", {
    fetchCompany: fakeFetch,
    search: null, // 検索結果なしのケース（ケース4）を明示的に再現
  });
  assert.equal(result.ok, true);
  assert.equal(result.domain, "example.co.jp");
  assert.equal(result.company_url, "https://example.co.jp");
  assert.equal(result.company_name, "Example Corporation");
  assert.equal(result.company_url_source, "email_domain_verified");
  assert.equal(result.company_url_confidence, "medium");
  assert.equal(result.contact_name, "Taro Yamada");
  assert.equal(result.contact_name_source, "email_localpart_heuristic");
  assert.ok(result.evidence.includes("example.co.jp"), "evidenceに根拠となったドメインが含まれるはず");
  assert.ok(Array.isArray(result.evidence_sources) && result.evidence_sources.length >= 2, "evidence_sourcesに複数の根拠が構造化されて保持されるはず");
});

test("inferCompanyFromEmail: 企業ドメインだがfetch失敗・検索結果なしはconfidence=lowの未検証候補として返す（Leadは作れるが低確度と分かる）", async () => {
  const fakeFetch = async (url) => ({ ok: false, url, label: null, content: null, error: "HTTP 404" });

  const result = await inferCompanyFromEmail("info@example-unreachable.jp", {
    fetchCompany: fakeFetch,
    search: null,
  });
  assert.equal(result.ok, true, "fetch失敗でも企業ドメインの可能性自体は否定しない");
  assert.equal(result.company_url, "https://example-unreachable.jp");
  assert.equal(result.company_url_source, "email_domain_unverified");
  assert.equal(result.company_url_confidence, "low");
  assert.equal(result.company_name, null);
  assert.equal(result.contact_name, null, "infoアドレスからは人名を生成しない");
});

test("inferCompanyFromEmail: 不正なemailはok:falseを返す", async () => {
  const result = await inferCompanyFromEmail("not-an-email", {
    fetchCompany: async () => {
      throw new Error("呼ばれてはならない");
    },
    search: async () => {
      throw new Error("呼ばれてはならない");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_email");
});

// ---------------------------------------------------------------------------
// findDomainMatchInSearchResults（裏付け判定の単体テスト）
// ---------------------------------------------------------------------------

test("findDomainMatchInSearchResults: 候補ドメイン自身を指すURLがあれば裏付けありと判定する", () => {
  const result = findDomainMatchInSearchResults("example.co.jp", [
    { url: "https://source.example.com/mock-search/foo-1" },
    { url: "https://example.co.jp/about" },
  ]);
  assert.equal(result.corroborated, true);
  assert.equal(result.matchedResult.url, "https://example.co.jp/about");
});

test("findDomainMatchInSearchResults: サブドメインも裏付けとみなす", () => {
  const result = findDomainMatchInSearchResults("example.co.jp", [{ url: "https://www.example.co.jp/company" }]);
  assert.equal(result.corroborated, true);
});

test("findDomainMatchInSearchResults: 候補ドメインを指すURLが無ければ裏付けなしと判定する（mockの合成URL等）", () => {
  const result = findDomainMatchInSearchResults("example.co.jp", [
    { url: "https://source.example.com/mock-search/foo-1" },
    { url: "https://unrelated-company.jp/" },
  ]);
  assert.equal(result.corroborated, false);
  assert.equal(result.matchedResult, null);
});

// ---------------------------------------------------------------------------
// ケース2・3: 検索結果とfetch結果の一致/不一致によるconfidenceの変化
// ---------------------------------------------------------------------------

test("【ケース2】inferCompanyFromEmail: 検索結果がfetch結果と一致（候補ドメイン自身を発見）するとconfidence=highへ上がる", async () => {
  const fakeFetch = async (url) => ({ ok: true, url, label: "Example Corporation", content: null, error: null });
  const fakeSearch = async () => ({
    results: [
      { label: "Example Corporation 公式サイト", url: "https://example.co.jp/", content: "会社概要", organization: null },
    ],
    usage: {},
    provider: "fake",
  });

  const result = await inferCompanyFromEmail("taro.yamada@example.co.jp", {
    fetchCompany: fakeFetch,
    search: fakeSearch,
  });
  assert.equal(result.company_url_confidence, "high");
  assert.equal(result.company_url_source, "email_domain_verified_and_searched");
  assert.ok(result.evidence.includes("一致"), "evidenceに検索結果との一致が記録されるはず");
});

test("【ケース3】inferCompanyFromEmail: 検索結果がfetch結果と食い違う（候補ドメインを含まない）場合、無理にhighにせずmediumのままにする", async () => {
  const fakeFetch = async (url) => ({ ok: true, url, label: "Example Corporation", content: null, error: null });
  const fakeSearch = async () => ({
    results: [
      { label: "全く無関係な検索結果", url: "https://unrelated-site.example.net/", content: "無関係", organization: null },
    ],
    usage: {},
    provider: "fake",
  });

  const result = await inferCompanyFromEmail("taro.yamada@example.co.jp", {
    fetchCompany: fakeFetch,
    search: fakeSearch,
  });
  assert.equal(result.company_url_confidence, "medium", "裏付けが得られない場合はhighへ昇格させない（安全側）");
  assert.equal(result.company_url_source, "email_domain_verified");
});

test("【ケース5】inferCompanyFromEmail: fetch失敗でも検索結果が候補ドメインを裏付ければconfidence=mediumへ改善し、企業名も検索結果から得られる", async () => {
  const fakeFetch = async (url) => ({ ok: false, url, label: null, content: null, error: "HTTP 403" });
  const fakeSearch = async () => ({
    results: [
      { label: "Example Corporation（検索結果由来）", url: "https://example.co.jp/company", content: null, organization: null },
    ],
    usage: {},
    provider: "fake",
  });

  const result = await inferCompanyFromEmail("info@example.co.jp", {
    fetchCompany: fakeFetch,
    search: fakeSearch,
  });
  assert.equal(result.ok, true);
  assert.equal(result.company_url, "https://example.co.jp", "company_urlはドメイン由来のまま");
  assert.equal(result.company_url_confidence, "medium", "fetch失敗でも検索の裏付けがあればlowより改善する");
  assert.equal(result.company_url_source, "email_domain_search_verified");
  assert.equal(result.company_name, "Example Corporation（検索結果由来）", "fetchが失敗しても検索結果から企業名候補を得られる");
});

test("【ケース6】inferCompanyFromEmail: フリーメールドメインの安全策は今回の変更後も維持されている", async () => {
  const result = await inferCompanyFromEmail("info@yahoo.co.jp", {
    fetchCompany: async () => { throw new Error("呼ばれてはならない"); },
    search: async () => { throw new Error("呼ばれてはならない"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "free_email_domain");
});
