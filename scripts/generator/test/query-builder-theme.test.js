/**
 * query-builder-theme.test.js — Phase56 STEP9-D（P2: Theme-aware Query Builder）
 *
 * STEP9-B の最大の問題: --opportunity-theme が LLM プロンプトにしか届かず、検索クエリは
 * 会社の現業種ヒント + 会社ページのキーワードだけから作られていた。現業≠テーマの
 * kscope（コンサル→製造業AI検査）・illegame（→飲食DX）は市場クエリが全部「新規事業開発」
 * 系になり、テーマ関連の権威ソースを1件も検索していなかった。
 *
 * P2: profile.opportunityTheme があれば市場クエリの主語をテーマ側へ寄せる。
 * 未指定なら従来挙動を byte 単位で維持する。会社固有テーマの if 文ハードコードはしない。
 *
 * LLM・ネットワークは使わない。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQueries,
  deriveMarketSubject,
  extractThemeTerms,
  expandThemeKeywords,
  preferredDomainsForTheme,
  COMPANY_QUERY_EXCLUDE_TERMS,
} = require("../search/query-builder");
const { buildQueryProfile } = require("../company-context");

// --- extractThemeTerms ---------------------------------------------------

test("extractThemeTerms: 定型接尾語を落として意味要素を抽出する（3テーマ）", () => {
  assert.deepEqual(
    extractThemeTerms("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ"),
    ["中小製造業", "AI", "品質検査"]
  );
  const illegame = extractThemeTerms("飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ");
  assert.ok(illegame.includes("飲食店"));
  assert.ok(illegame.includes("LINE"));
  assert.ok(illegame.includes("予約"));
  assert.ok(illegame.includes("顧客管理"));
  const abi = extractThemeTerms("アニメ制作会社のIP保有・収益分配モデル構築支援サービスの立ち上げ");
  assert.ok(abi.includes("アニメ"));
  assert.ok(abi.includes("IP"));
  assert.ok(abi.some((t) => /収益分配|保有|制作会社/.test(t)));
});

test("extractThemeTerms: 空・null は空配列", () => {
  assert.deepEqual(extractThemeTerms(""), []);
  assert.deepEqual(extractThemeTerms(null), []);
  assert.deepEqual(extractThemeTerms(undefined), []);
});

test("extractThemeTerms: 一般語（支援・サービス・立ち上げ・向け）は主語にしない", () => {
  const terms = extractThemeTerms("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ");
  for (const noise of ["向け", "支援", "サービス", "立ち上げ", "導入"]) {
    assert.ok(!terms.includes(noise), `${noise} が残っている: ${JSON.stringify(terms)}`);
  }
});

// --- deriveMarketSubject: テーマ主導 -----------------------------------

test("deriveMarketSubject: テーマと業種が噛み合わない場合は業種ヒントを落としテーマを主語にする（kscope 型）", () => {
  const subject = deriveMarketSubject({
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション", "新規事業成功"],
    opportunityTheme: "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ",
  });
  assert.ok(/製造業/.test(subject), subject);
  assert.ok(/品質検査/.test(subject), subject);
  assert.ok(!/新規事業・事業開発支援/.test(subject), `噛み合わない業種ヒントが残っている: ${subject}`);
});

test("deriveMarketSubject: テーマと業種が噛み合う場合は業種ヒントを残す（ab-i 型）", () => {
  const subject = deriveMarketSubject({
    industry: "コンテンツ・アニメ産業",
    keywords: ["制作", "プロデュース"],
    opportunityTheme: "アニメ制作会社のIP保有・収益分配モデル構築支援サービスの立ち上げ",
  });
  assert.ok(/アニメ/.test(subject), subject);
  assert.ok(/IP|収益分配|制作会社/.test(subject), subject);
});

test("deriveMarketSubject: opportunityTheme なしは従来挙動（業種 + キーワード）", () => {
  const withTheme = deriveMarketSubject({ industry: "アニメ産業", keywords: ["制作", "配信", "IP"] });
  const noKey = "opportunityTheme" in { industry: "アニメ産業" };
  assert.equal(noKey, false);
  assert.match(withTheme, /^アニメ産業/);
});

// --- buildQueries: テーマがクエリへ伝播する -----------------------------

test("buildQueries: opportunityTheme があると市場クエリにテーマ要素が反映される（kscope）", () => {
  const qs = buildQueries({
    companyName: "株式会社カレイドスコープ",
    cityWard: "千代田区",
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション", "新規事業成功"],
    opportunityTheme: "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ",
  });
  const market = qs.filter((q) => q.sourceRole !== "company_fact");
  const joined = market.map((q) => q.query).join(" | ");
  assert.ok(/製造業/.test(joined), joined);
  assert.ok(/品質検査/.test(joined), joined);
  // 会社固有クエリは従来どおり社名 + 所在地
  const identity = qs.find((q) => q.sourceRole === "company_fact");
  assert.match(identity.query, /株式会社カレイドスコープ/);
  assert.match(identity.query, /千代田区/);
  // 市場クエリに会社名は入らない（従来ルール維持）
  for (const q of market) {
    assert.ok(!q.query.includes("株式会社カレイドスコープ"), q.query);
  }
});

test("buildQueries: opportunityTheme があると市場クエリにテーマ要素が反映される（illegame）", () => {
  const qs = buildQueries({
    companyName: "株式会社イル・レガメ",
    industry: "新規事業・事業開発支援",
    keywords: ["ブランディング", "飲食店運営"],
    opportunityTheme: "飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ",
  });
  const joined = qs
    .filter((q) => q.sourceRole !== "company_fact")
    .map((q) => q.query)
    .join(" | ");
  assert.ok(/飲食店/.test(joined), joined);
  assert.ok(/予約|LINE|顧客管理/.test(joined), joined);
});

test("buildQueries: 市場クエリの観点（補助金/統計/業界動向/トレンド/最新動向）はテーマ指定時も維持", () => {
  const qs = buildQueries({
    companyName: "テスト社",
    industry: "新規事業・事業開発支援",
    keywords: ["支援"],
    opportunityTheme: "飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ",
  });
  const joined = qs.map((q) => q.query).join(" | ");
  assert.match(joined, /補助金|支援制度/);
  assert.match(joined, /市場規模|統計/);
  assert.match(joined, /業界動向/);
  assert.match(joined, /トレンド|課題/);
  assert.match(joined, /最新動向/);
});

// --- 後方互換: opportunityTheme なしは従来クエリと一致 -------------------

test("buildQueries: opportunityTheme なし（normal mode）は従来のクエリ列と完全一致する", () => {
  const profile = {
    companyName: "株式会社カレイドスコープ",
    cityWard: "千代田区",
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション", "新規事業成功"],
  };
  const before = buildQueries(profile).map((q) => q.query);
  // 期待値（STEP9-D 前の deriveMarketSubject 挙動）: 実業種 + キーワード最大2件、末尾に観点。
  assert.deepEqual(before, [
    "株式会社カレイドスコープ 千代田区 会社概要",
    "新規事業・事業開発支援 インキュベーション 新規事業成功 補助金 支援制度 2026",
    "新規事業・事業開発支援 インキュベーション 新規事業成功 市場規模 統計 2026",
    "新規事業・事業開発支援 インキュベーション 新規事業成功 業界動向 2026",
    "新規事業・事業開発支援 インキュベーション 新規事業成功 市場 トレンド 課題",
    "新規事業・事業開発支援 インキュベーション 新規事業成功 最新動向 2026",
  ]);
});

// --- 配線: buildQueryProfile が opportunityTheme を受け渡す --------------

test("buildQueryProfile: known.opportunityTheme を profile.opportunityTheme へ渡す（trim / 空は null）", () => {
  const companyResult = {
    ok: true,
    label: "株式会社カレイドスコープ",
    content: "新規事業立ち上げ支援、企業再生支援を行うコンサルティング会社です。",
  };
  const withTheme = buildQueryProfile(companyResult, "https://kscope.co.jp", {
    companyName: "株式会社カレイドスコープ",
    industryHint: "新規事業・事業開発支援",
    opportunityTheme: "  中小製造業向け「AI品質検査」導入支援サービスの立ち上げ  ",
  });
  assert.equal(withTheme.opportunityTheme, "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ");

  const noTheme = buildQueryProfile(companyResult, "https://kscope.co.jp", {
    companyName: "株式会社カレイドスコープ",
    industryHint: "新規事業・事業開発支援",
  });
  assert.equal(noTheme.opportunityTheme, null);
});

test("buildQueries: opportunityTheme = null / 空文字は normal mode 扱い", () => {
  const base = { companyName: "テスト社", industry: "アニメ産業", keywords: ["配信"] };
  const normal = buildQueries(base).map((q) => q.query);
  assert.deepEqual(buildQueries({ ...base, opportunityTheme: null }).map((q) => q.query), normal);
  assert.deepEqual(buildQueries({ ...base, opportunityTheme: "" }).map((q) => q.query), normal);
  assert.deepEqual(buildQueries({ ...base, opportunityTheme: "   " }).map((q) => q.query), normal);
});

// ---------------------------------------------------------------------------
// Phase57 STEP1 — Source Discovery Improvement
// ---------------------------------------------------------------------------
// STEP9-H で、テーマ語を市場クエリに入れても Tavily が SEO「完全ガイド」記事を返していた。
// テーマ関連語の拡張・観点語の一次情報寄せ・会社クエリのドメイン化・preferred domains 候補。

test("STEP57-1 expandThemeKeywords: テーマ語 + 関連語辞書でサブ市場語を追加する", () => {
  const q = expandThemeKeywords("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ");
  assert.ok(q.includes("AI品質検査") || q.includes("品質検査"));
  assert.ok(q.includes("AI外観検査"));
  assert.ok(q.includes("画像検査"));
  assert.ok(q.includes("製造業AI"));
  const l = expandThemeKeywords("飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ");
  assert.ok(l.includes("ネット予約システム"));
  assert.ok(l.includes("CRM"));
  assert.ok(l.includes("外食産業"));
  const ip = expandThemeKeywords("アニメ制作会社のIP保有・収益分配モデル構築支援サービスの立ち上げ");
  assert.ok(ip.includes("知的財産"));
  assert.ok(ip.includes("製作委員会"));
  assert.ok(ip.includes("アニメ産業"));
});

test("STEP57-1 expandThemeKeywords: 空・null は空配列 / 既存 extractThemeTerms を先頭に含む", () => {
  assert.deepEqual(expandThemeKeywords(""), []);
  assert.deepEqual(expandThemeKeywords(null), []);
  const q = expandThemeKeywords("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ");
  assert.deepEqual(q.slice(0, 3), extractThemeTerms("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ"));
});

test("STEP57-1 expandThemeKeywords: 重複語を出さない", () => {
  const q = expandThemeKeywords("製造業向け「AI品質検査」導入支援サービスの立ち上げ");
  assert.equal(q.length, new Set(q).size);
});

test("STEP57-1 preferredDomainsForTheme: テーマ別に政府・業界団体ドメインを返す", () => {
  const mfg = preferredDomainsForTheme("中小製造業向け「AI品質検査」導入支援サービスの立ち上げ");
  assert.ok(mfg.includes("meti.go.jp"));
  assert.ok(mfg.includes("ipa.go.jp"));
  const food = preferredDomainsForTheme("飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ");
  assert.ok(food.includes("maff.go.jp"));
  const ip = preferredDomainsForTheme("アニメ制作会社のIP保有・収益分配モデル構築支援サービスの立ち上げ");
  assert.ok(ip.includes("bunka.go.jp") || ip.includes("vipo.or.jp"));
  assert.deepEqual(preferredDomainsForTheme(""), []);
  assert.deepEqual(preferredDomainsForTheme("これはどの辞書にも当たらない一般テーマ"), []);
});

test("STEP57-1 buildQueries theme mode: 市場クエリにサブ市場語・調査寄せ語が入る（kscope）", () => {
  const qs = buildQueries({
    companyName: "株式会社カレイドスコープ",
    domain: "kscope.co.jp",
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション"],
    opportunityTheme: "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ",
  });
  const joined = qs.map((q) => q.query).join(" | ");
  assert.match(joined, /AI外観検査|画像検査/); // サブ市場語
  assert.match(joined, /実態調査|市場調査レポート|出荷額|プレスリリース/); // 一次情報寄せ
  assert.match(joined, /経済産業省/);
  // 既存の観点キーワード族は維持
  assert.match(joined, /補助金|支援制度/);
  assert.match(joined, /市場規模|統計/);
  assert.match(joined, /業界動向/);
  assert.match(joined, /トレンド|課題/);
  assert.match(joined, /最新動向/);
});

test("STEP57-1 buildQueries theme mode: 会社固有クエリにドメイン・事業内容が入り、excludeTerms 候補が付く", () => {
  const qs = buildQueries({
    companyName: "株式会社ABI",
    domain: "ab-i.jp",
    industry: "コンテンツ・アニメ産業",
    keywords: ["制作"],
    opportunityTheme: "アニメ制作会社のIP保有・収益分配モデル構築支援サービスの立ち上げ",
  });
  const company = qs.find((q) => q.sourceRole === "company_fact");
  assert.match(company.query, /株式会社ABI/);
  assert.match(company.query, /ab-i\.jp/);
  assert.match(company.query, /事業内容/);
  assert.ok(Array.isArray(company.excludeTerms));
  assert.ok(company.excludeTerms.includes("求人"));
  assert.ok(company.excludeTerms.includes("評判"));
  assert.ok(company.excludeTerms.includes("ランキング"));
  // preferredDomains 候補は government / industry_association クエリに付く（Phase57 STEP2）
  const gov = qs.find((q) => q.sourceType === "government");
  const ind = qs.find((q) => q.sourceType === "industry_association");
  assert.ok(Array.isArray(gov.preferredDomains) && gov.preferredDomains.length > 0);
  assert.ok(Array.isArray(ind.preferredDomains) && ind.preferredDomains.length > 0);
  // statistics / technology / news には付けない（調査会社・業界メディアを取り逃さないため）
  assert.equal(qs.find((q) => q.sourceType === "statistics").preferredDomains, undefined);
  assert.equal(qs.find((q) => q.sourceType === "technology").preferredDomains, undefined);
});

test("STEP57-1 buildQueries theme mode: カテゴリ多様性（company / government / statistics / industry / news）", () => {
  const qs = buildQueries({
    companyName: "株式会社イル・レガメ",
    domain: "illegame.com",
    industry: "新規事業・事業開発支援",
    keywords: ["ブランディング"],
    opportunityTheme: "飲食店向けLINE予約・顧客管理DX支援サービスの立ち上げ",
  });
  const roles = new Set(qs.map((q) => q.sourceRole));
  const types = new Set(qs.map((q) => q.sourceType));
  assert.ok(qs.length >= 6);
  assert.ok(types.has("government"));
  assert.ok(types.has("statistics"));
  assert.ok(types.has("industry_association"));
  assert.ok(types.has("technology"));
  assert.ok(types.has("news"));
  assert.ok(roles.has("company_fact"));
  assert.ok(roles.has("market_change"));
  // 市場クエリに会社名は入らない（従来ルール維持）
  for (const q of qs.filter((x) => x.sourceRole !== "company_fact")) {
    assert.ok(!q.query.includes("株式会社イル・レガメ"), q.query);
  }
});

test("STEP57-1 buildQueries normal mode（テーマなし）は preferredDomains / excludeTerms を付けない・従来クエリと一致", () => {
  const base = { companyName: "テスト社", cityWard: "港区", industry: "アニメ産業", keywords: ["配信"] };
  const qs = buildQueries(base);
  for (const q of qs) {
    assert.equal(q.preferredDomains, undefined);
    assert.equal(q.excludeTerms, undefined);
  }
  assert.deepEqual(qs.map((q) => q.query), [
    "テスト社 港区 会社概要",
    "アニメ産業 配信 補助金 支援制度 2026",
    "アニメ産業 配信 市場規模 統計 2026",
    "アニメ産業 配信 業界動向 2026",
    "アニメ産業 配信 市場 トレンド 課題",
    "アニメ産業 配信 最新動向 2026",
  ]);
});

test("STEP57-1 COMPANY_QUERY_EXCLUDE_TERMS: 求人・評判・比較系を含む", () => {
  for (const t of ["求人", "採用", "転職", "就活", "評判", "口コミ", "ランキング", "比較"]) {
    assert.ok(COMPANY_QUERY_EXCLUDE_TERMS.includes(t), t);
  }
});

// ---------------------------------------------------------------------------
// Phase57 STEP3 — Industry Association Source Recovery（query 側）
// ---------------------------------------------------------------------------

test("STEP57-3 preferredDomainsForTheme(kind): government と industry で別配列・重複なし", () => {
  const th = "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ";
  const gov = preferredDomainsForTheme(th, "government");
  const ind = preferredDomainsForTheme(th, "industry");
  assert.ok(gov.every((d) => /\.go\.jp$/.test(d)), JSON.stringify(gov));
  assert.ok(ind.some((d) => /\.(or|gr)\.jp$/.test(d) || /jri\.co\.jp|nri\.com|murc\.jp/.test(d)), JSON.stringify(ind));
  assert.equal(gov.filter((d) => ind.includes(d)).length, 0, "gov と industry のドメインは重複しない");
  // kind 省略時は和集合
  const all = preferredDomainsForTheme(th);
  assert.ok(gov.every((d) => all.includes(d)) && ind.every((d) => all.includes(d)));
});

test("STEP57-3 buildQueries theme mode: government と industry_association で include_domains が別", () => {
  const qs = buildQueries({
    companyName: "株式会社カレイドスコープ",
    domain: "kscope.co.jp",
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション"],
    opportunityTheme: "中小製造業向け「AI品質検査」導入支援サービスの立ち上げ",
  });
  const gov = qs.find((q) => q.sourceType === "government");
  const ind = qs.find((q) => q.sourceType === "industry_association");
  assert.ok(gov.preferredDomains.length > 0 && ind.preferredDomains.length > 0);
  assert.equal(gov.preferredDomains.filter((d) => ind.preferredDomains.includes(d)).length, 0);
  assert.ok(gov.preferredDomains.every((d) => /\.go\.jp$/.test(d)));
  // industry query の語に「協会・連盟・工業会・学会」が入る
  assert.match(ind.query, /協会/);
  assert.match(ind.query, /工業会|連盟|学会/);
  // 既存の観点キーワード族は維持
  assert.match(ind.query, /業界動向/);
});

test("STEP57-3 buildQueries normal mode（テーマなし）は従来のクエリ列と完全一致（byte 互換）", () => {
  const profile = {
    companyName: "株式会社カレイドスコープ",
    cityWard: "千代田区",
    industry: "新規事業・事業開発支援",
    keywords: ["インキュベーション", "新規事業成功"],
  };
  assert.deepEqual(
    buildQueries(profile).map((q) => q.query),
    [
      "株式会社カレイドスコープ 千代田区 会社概要",
      "新規事業・事業開発支援 インキュベーション 新規事業成功 補助金 支援制度 2026",
      "新規事業・事業開発支援 インキュベーション 新規事業成功 市場規模 統計 2026",
      "新規事業・事業開発支援 インキュベーション 新規事業成功 業界動向 2026",
      "新規事業・事業開発支援 インキュベーション 新規事業成功 市場 トレンド 課題",
      "新規事業・事業開発支援 インキュベーション 新規事業成功 最新動向 2026",
    ]
  );
  for (const q of buildQueries(profile)) {
    assert.equal(q.preferredDomains, undefined);
    assert.equal(q.excludeTerms, undefined);
  }
});
