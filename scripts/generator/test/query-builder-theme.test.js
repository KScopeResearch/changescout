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

const { buildQueries, deriveMarketSubject, extractThemeTerms } = require("../search/query-builder");
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
