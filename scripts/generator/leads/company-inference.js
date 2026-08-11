/**
 * company-inference.js — PJ2 AOR本来のStep②「メールアドレスを起点に企業・担当者等を
 * 調査する」の実装。
 *
 * 【設計方針】company_urlをユーザー・運営者いずれにも事前入力させない、という
 * PJ2 AORの確定仕様（docs/strategy_v2/01_concept.md「会社ドメイン（メールアドレス）
 * さえ分かれば…自動でレポートを生成する」）を満たす。
 * 「ドメイン＝企業URL」と単純に決め打ちするのではなく、可能な範囲で根拠
 * （evidence）と確度（confidence）を保持し、推定情報と確定情報を区別する。
 *
 * 【既存資産の再利用（今回追加分）】新しい検索クライアントは作らない。
 * 既存の`search/search-client.js`の`search(query, options)`をそのまま呼び出す。
 * このモジュールは`SEARCH_PROVIDER`環境変数（未設定時は自動でmockへフォールバック、
 * Task12の既存方針）に従うため、実APIキーが無い環境でも呼び出し自体は安全に行える
 * （mock-search-provider.jsは完全にオフライン・決定的な合成結果を返すのみで、
 * 実ネットワーク通信もコストも発生しない）。Task30-32で実際にTavilyを使って
 * 検証済みの経路と全く同じ入口を使うため、新しい検証は不要。
 *
 * 【企業推定の確度算出（今回追加）】fetch-company.jsによる直接取得と、
 * search-client.js経由の検索結果という、2つの独立した情報源が一致するかどうかで
 * confidenceを決める。
 *   - 検索結果のいずれかのURLのホスト名が、候補ドメインと完全一致（またはそのサブ
 *     ドメイン）である場合のみ「検索が裏付けた」とみなす（corroborated）。
 *     mock providerの合成結果は常に`source.example.com`配下のURLを返すため、
 *     この厳しい判定基準によって、mockフォールバック時に見かけ上confidenceが
 *     不当に上がることはない（実際のTavily等が候補ドメイン自身をヒットさせた
 *     場合のみhighへ上がる、という健全な設計になっている）
 *   - fetch成功 + 検索が裏付け → high（複数の独立した情報源が一致）
 *   - fetch成功 + 検索が裏付けない/検索なし → medium（直接取得のみ、従来通り）
 *   - fetch失敗 + 検索が裏付け → medium（fetchは失敗したが独立した検索証跡がある）
 *   - fetch失敗 + 検索が裏付けない → low（従来通り）
 * 「根拠が弱いのにhighにしない」という要件を、検索結果の文字列に候補ドメインが
 * 含まれるかどうかのような緩い判定ではなく、URLホスト名の完全一致という
 * 厳しい基準にすることで満たしている。
 *
 * 【フリーメールドメインの扱い】gmail.com等の個人向けメールサービスのドメインは
 * 「企業のドメイン」ではないため、これをそのまま`company_url`候補にすることは
 * 明確な誤り（決め打ち）になる。フリーメールドメインの場合は`ok:false`を返し、
 * 呼び出し元がLeadを作成しない判断をできるようにする（存在しない企業を
 * でっち上げない）。この場合、検索も一切行わない（企業ドメインでないと分かって
 * いるものを検索してもコストの無駄であり、根拠にもならない）。
 *
 * 【担当者情報の扱い（重要な安全策）】メールのローカル部（@より前）が
 * 「名前.苗字」のような2語構成に限り、人名の可能性がある候補として抽出する
 * （confidence常にlow、source明示）。`info@`・`sales@`等の代表窓口アドレスや、
 * 単語1つだけのローカル部からは**一切人名を生成しない**（検索結果から人名らしき
 * 文字列を見つけても、それを自動的にcontact_nameへ確定反映することはしない —
 * 今回は検索結果を企業名・企業URLの裏付けにのみ用い、担当者の裏付けには使わない。
 * LLMによる部署・役職の推測も行わない）。これは、report.jsonのhuman_review
 * チェックリストが既に掲げる「no_logical_leap_in_opportunity」（論理の飛躍を
 * しない）というプロジェクト全体の既存方針と一致させるための意図的な安全策。
 */

const { fetchCompany } = require("../fetch-company");
const { search } = require("../search/search-client");

// 主要な個人向けメールサービスのドメイン（代表的なもののみ。網羅を目指さない）。
// これらのドメインからは特定の1企業を導出できないため、company_url推定の対象外とする。
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.jp",
  "hotmail.com",
  "outlook.com",
  "outlook.jp",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "docomo.ne.jp",
  "ezweb.ne.jp",
  "softbank.ne.jp",
  "au.com",
  "protonmail.com",
]);

// 代表窓口アドレスとしてよく使われるローカル部。これらからは人名を推定しない。
const GENERIC_LOCAL_PARTS = new Set([
  "info",
  "sales",
  "contact",
  "support",
  "inquiry",
  "inquiries",
  "admin",
  "hello",
  "help",
  "office",
  "staff",
  "team",
  "press",
  "media",
  "recruit",
  "jobs",
  "webmaster",
  "postmaster",
  "noreply",
  "no-reply",
]);

/**
 * emailからドメイン部分を取り出す。
 * @param {string} email
 * @returns {string|null} 不正な形式の場合はnull
 */
function extractDomain(email) {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * emailのローカル部（@より前）を取り出す。
 * @param {string} email
 * @returns {string|null}
 */
function extractLocalPart(email) {
  if (typeof email !== "string") return null;
  const at = email.indexOf("@");
  if (at <= 0) return null;
  return email.slice(0, at);
}

/**
 * ドメインがフリーメール（個人向けメールサービス）かどうかを判定する。
 * @param {string} domain
 * @returns {boolean}
 */
function isFreeEmailDomain(domain) {
  return FREE_EMAIL_DOMAINS.has((domain || "").toLowerCase());
}

/** @param {string} s @returns {string} */
function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * ローカル部から人名らしき候補を保守的に抽出する（Pure Function）。
 * 「firstname.lastname」のような英字2語構成のときだけ候補を返す。
 * 代表窓口アドレス（GENERIC_LOCAL_PARTS）・単語1つ・数字混じり等では何も返さない
 * （根拠のない人名を作らない）。
 * @param {string} localPart
 * @returns {{name:string|null, source:string|null}}
 */
function guessContactNameFromLocalPart(localPart) {
  if (!localPart) return { name: null, source: null };
  const lower = localPart.toLowerCase();
  if (GENERIC_LOCAL_PARTS.has(lower)) return { name: null, source: null };

  const parts = lower.split(/[._-]/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^[a-z]{2,}$/.test(p))) {
    return { name: parts.map(capitalize).join(" "), source: "email_localpart_heuristic" };
  }
  return { name: null, source: null };
}

/**
 * @param {string} url
 * @returns {string|null} ホスト名（小文字）。不正なURLの場合はnull
 */
function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

/**
 * 検索結果の中に、候補ドメイン自身（またはそのサブドメイン）を指すURLが
 * 含まれているかを確認する（Pure Function）。文字列の緩い一致ではなく、
 * URLホスト名の厳密な一致のみを「裏付け」とみなす（mock providerの合成結果は
 * 常にsource.example.com配下のため、これによって見かけ上のconfidence上振れを防ぐ）。
 * @param {string} domain
 * @param {Array<{url:string}>} searchResults
 * @returns {{corroborated:boolean, matchedResult:Object|null}}
 */
function findDomainMatchInSearchResults(domain, searchResults) {
  if (!Array.isArray(searchResults)) return { corroborated: false, matchedResult: null };
  for (const result of searchResults) {
    const host = safeHostname(result.url);
    if (host && (host === domain || host.endsWith(`.${domain}`))) {
      return { corroborated: true, matchedResult: result };
    }
  }
  return { corroborated: false, matchedResult: null };
}

/**
 * emailを起点に、企業URL・企業名・担当者候補を調査する（I/O）。
 * 「ドメイン＝企業URL」と決め打ちせず、fetch-company.jsによる直接取得と
 * search-client.js経由の検索結果という2つの独立した情報源の一致状況でconfidenceを決める。
 *
 * @param {string} email
 * @param {{fetchCompany?: (url:string) => Promise<Object>,
 *   search?: (query:string, options:Object) => Promise<{results:Array, usage:Object, provider:string}>}} [options] -
 *   fetchCompany/searchはいずれもテスト時に差し替えるためのDIフック（省略時は
 *   実際のfetch-company.js/search-client.jsを使う。process-validated.jsの
 *   options.generateReportと同じ依存性注入パターン）。`search`に明示的に`null`を
 *   渡すと検索自体をスキップする（検索結果なしのケースの動作確認用）。
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   domain: string|null,
 *   company_url: string|null,
 *   company_name: string|null,
 *   company_url_source: string|null,
 *   company_url_confidence: "high"|"medium"|"low"|null,
 *   contact_name: string|null,
 *   contact_name_source: string|null,
 *   evidence: string,
 *   evidence_sources: Array<{source:string, detail:string}>
 * }>}
 */
async function inferCompanyFromEmail(email, options = {}) {
  const fetchCompanyFn = options.fetchCompany || fetchCompany;
  // searchが未指定(undefined)なら既存search-client.jsを使う。明示的にnullを渡された
  // 場合のみ検索をスキップする（"search: null"とundefinedを区別する）。
  const searchFn = options.search === undefined ? search : options.search;

  const domain = extractDomain(email);
  const localPart = extractLocalPart(email);
  const { name: contactName, source: contactNameSource } = guessContactNameFromLocalPart(localPart);

  if (!domain) {
    return {
      ok: false,
      reason: "invalid_email",
      domain: null,
      company_url: null,
      company_name: null,
      company_url_source: null,
      company_url_confidence: null,
      contact_name: null,
      contact_name_source: null,
      evidence: `emailの形式が不正なためドメインを抽出できませんでした: ${JSON.stringify(email)}`,
      evidence_sources: [],
    };
  }

  if (isFreeEmailDomain(domain)) {
    return {
      ok: false,
      reason: "free_email_domain",
      domain,
      company_url: null,
      company_name: null,
      company_url_source: null,
      company_url_confidence: null,
      contact_name: contactName,
      contact_name_source: contactNameSource,
      evidence: `ドメイン"${domain}"は個人向けメールサービスのドメインのため、特定の企業を一意に推定できません。`,
      evidence_sources: [
        { source: "email_domain", detail: `domain="${domain}" はフリーメールドメイン一覧に一致` },
      ],
    };
  }

  const candidateUrl = `https://${domain}`;
  const evidenceSources = [{ source: "email_domain", detail: `emailからドメイン"${domain}"を抽出` }];

  const fetched = await fetchCompanyFn(candidateUrl);
  const fetchOk = !!(fetched && fetched.ok);
  evidenceSources.push({
    source: "direct_http",
    detail: fetchOk
      ? `${candidateUrl} を実際に取得し、ページタイトル"${fetched.label || "(タイトルなし)"}"を確認`
      : `${candidateUrl} の取得を試みたが失敗（${(fetched && fetched.error) || "不明なエラー"}）`,
  });

  // 検索による裏付け（今回追加）。既存search-client.jsをそのまま再利用する。
  let searchResults = [];
  let searchAttempted = false;
  if (searchFn) {
    searchAttempted = true;
    try {
      const searchResponse = await searchFn(domain, { sourceType: "company", sourceRole: "company_fact" });
      searchResults = (searchResponse && searchResponse.results) || [];
    } catch (err) {
      // 検索自体が失敗しても、fetch-company.jsによる直接取得だけで動作を継続する
      // （検索は裏付けの追加情報であり、必須経路ではないため）。
      evidenceSources.push({ source: "search_result", detail: `検索に失敗（${err.message}）。直接取得の結果のみで判断する` });
    }
  }

  const { corroborated, matchedResult } = findDomainMatchInSearchResults(domain, searchResults);
  if (searchAttempted) {
    evidenceSources.push({
      source: "search_result",
      detail: corroborated
        ? `検索結果中に候補ドメイン"${domain}"自身を指すURL（${matchedResult.url}）を発見し、直接取得の結果と一致`
        : `検索結果は${searchResults.length}件取得したが、候補ドメイン"${domain}"自身を指すURLは含まれず（裏付けなし）`,
    });
  }

  const companyName = (fetchOk && fetched.label) || (corroborated && matchedResult.label) || null;

  let confidence;
  let companyUrlSource;
  if (fetchOk && corroborated) {
    confidence = "high";
    companyUrlSource = "email_domain_verified_and_searched";
  } else if (fetchOk) {
    confidence = "medium";
    companyUrlSource = "email_domain_verified";
  } else if (corroborated) {
    confidence = "medium";
    companyUrlSource = "email_domain_search_verified";
  } else {
    confidence = "low";
    companyUrlSource = "email_domain_unverified";
  }

  const evidence = evidenceSources.map((e) => e.detail).join(" / ");

  return {
    ok: true,
    domain,
    company_url: candidateUrl,
    company_name: companyName,
    company_url_source: companyUrlSource,
    company_url_confidence: confidence,
    contact_name: contactName,
    contact_name_source: contactNameSource,
    evidence,
    evidence_sources: evidenceSources,
  };
}

module.exports = {
  extractDomain,
  extractLocalPart,
  isFreeEmailDomain,
  guessContactNameFromLocalPart,
  findDomainMatchInSearchResults,
  inferCompanyFromEmail,
  FREE_EMAIL_DOMAINS,
  GENERIC_LOCAL_PARTS,
};
