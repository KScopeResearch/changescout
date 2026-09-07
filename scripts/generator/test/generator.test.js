/**
 * generator.test.js — Task18: generate-company-report.jsのエンドツーエンド統合テスト。
 * 実際にhttps://example.com（IANA予約の安全な公開テストドメイン）へHTTP取得を行うため、
 * ネットワーク環境によっては失敗しうる（実ネットワークI/Oを伴う唯一のテスト）。
 *
 * 【Task19】このファイル内の他のテストは、実ネットワークテストの成否に依存しないよう
 * 意図的に分離している（以前は3件目のテストが1件目の副作用＝生成されたreport.jsonを
 * 読み直す設計だったため、1件目がスキップ・失敗すると3件目も道連れで失敗していた。
 * 3件目はfixtures/good.jsonを使う形に変更し、独立して実行できるようにした）。
 *
 * テスト名は network-test-names.js の NETWORK_TEST_NAME と一致させている
 * （run-all-tests.jsがCI環境でこのテストのみ非ブロッキング扱いにするための対応表）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  generateCompanyReport,
  slugFromUrl,
  buildCompanyProfile,
  summarizeBusinessText,
  buildTopSources,
} = require("../generate-company-report");
const { validateReport } = require("../validate-report");
const { readJson } = require("../shared/json-file");
const { REPORT_FIXTURES_DIR } = require("../shared/paths");
const { NETWORK_TEST_NAME } = require("./network-test-names");

test(NETWORK_TEST_NAME, { timeout: 30000 }, async () => {
  // 【PJ2 AOR Phase47 STEP4】generateCompanyReport()は内部でfetch-government.js等（company-inference.js
  // 経由ではなく直接）を通じてsearch/search-client.jsのsearch()を呼ぶが、これらの呼び出しは
  // providerIdを指定していないため、実行環境のSEARCH_PROVIDER環境変数に従う（search-client.jsの
  // 既存設計、未設定時は"mock"）。本テストの目的はhttps://example.comへの実HTTP取得を含む
  // エンドツーエンド生成フローの検証であり、Tavily検索結果の内容自体を検証する意図はない
  // （Tavily providerの実装自体はtavily-provider.test.jsが別途、実ネットワーク接続なしで検証済み）。
  // ローカル開発環境でSEARCH_PROVIDER=tavily・TAVILY_API_KEYが実際に設定されている場合（実レポート
  // 生成用）に本テストが意図せず実Tavily APIを複数回呼び出してしまう（費用・レート制限・
  // このテスト自体の30秒タイムアウトを圧迫する要因になりうる）ことを防ぐため、本テストの
  // 実行中のみSEARCH_PROVIDER=mockへ固定する。
  //
  // 【重要: t.after()で元に戻さない理由（実際に検証・確認した事象）】node:testはファイル単位で
  // 別プロセスに分離される（実験で確認済み: 同一node --test実行でも各test fileは異なるpidを
  // 持ち、process.envは共有されない）ため、他ファイルへの影響は無い。一方、このテスト自身が
  // {timeout: 30000}に達した場合、node:testはタイムアウト時点でt.after()フックを実行するが、
  // generateCompanyReport()のPromiseチェイン自体はキャンセルされず、そのままバックグラウンドで
  // 実行が続く。もしt.after()でSEARCH_PROVIDERを元の値（開発者のシェルで実際に設定されている
  // 場合は"tavily"）へ戻していると、タイムアウト後もなお実行中のgenerateCompanyReport()内部の
  // search()呼び出しが、その「元に戻った」値を読み取ってしまい、結果的に実Tavily APIを呼び出す
  // という事象が実際に発生することを確認した（重い並行実行下でこのテスト自体がタイムアウトした
  // 際に、search-usage.jsonlに実際のtavily呼び出しが記録された）。このファイルには他に
  // env非依存のテストしか無いため、SEARCH_PROVIDER=mockを本ファイルのプロセス終了まで
  // 元に戻さないままにしても副作用は無い。
  //
  // 【多層防御: TAVILY_API_KEYも削除する】上記のSEARCH_PROVIDER=mock固定に加え、
  // TAVILY_API_KEY自体も削除する。search-client.jsのsearch()は
  // 「provider.requiresApiKey && !provider.isConfigured()」の場合に必ずmockへフォールバック
  // する設計であり（tavily-provider.jsのisConfigured()は`!!process.env.TAVILY_API_KEY`のみを
  // 見る）、これはSEARCH_PROVIDERの値に関わらず働く独立した防御層である。これにより、たとえ
  // 何らかの理由でSEARCH_PROVIDERが"tavily"を指す状態でsearch()が呼ばれたとしても、
  // isConfigured()がfalseとなり必ずmockへフォールバックするため、実Tavily API呼び出しは
  // 構造的に不可能になる。
  process.env.SEARCH_PROVIDER = "mock";
  delete process.env.TAVILY_API_KEY;

  // 【PJ2 AOR Phase47 STEP5: LLM（DeepSeek）側にも全く同じ問題が存在することを確認・修正】
  // buildReport()（generate-company-report.js）は`generateAnalysis(context)`をproviderId省略で
  // 呼んでおり、llm-client.jsのresolveProviderId()経由でLLM_PROVIDER環境変数に従う
  // （search-client.jsと同じ設計）。ローカル開発環境でLLM_PROVIDER=deepseek・
  // DEEPSEEK_API_KEYが実際に設定されている場合、本テストは実DeepSeek APIを呼び出す。
  // 【実際に確認した事象】TAVILY_API_KEYを外部から明示的にunsetした状態で本テストを実行した
  // ところ、Tavily呼び出しは発生しなかった（search-usage.jsonl増加なし）一方、
  // llm-usage.jsonl相当のログに"deepseek 呼び出し失敗（1/3回目): タイムアウト（30000ms） —
  // 500ms後に再試行"という実DeepSeek呼び出しのリトライログが、本テスト自身の
  // {timeout: 30000}到達後（テストがFAILとして記録された後）のタイムスタンプで記録された。
  // これは上記のTAVILY_API_KEY欄で理論として説明した「タイムアウト後もgenerateCompanyReport()の
  // Promiseチェインがバックグラウンドで実行を継続し、その時点のprocess.env値を読む」という
  // 機序を、DeepSeek側で実証的に確認できたことを意味する（Tavily側でも同一の機序が働いている
  // 可能性が高いことの裏付けにもなる）。llm-client.jsの設計はsearch-client.jsと異なり
  // API未設定時に自動フォールバックせず明確なエラーで停止する（llm-client.jsヘッダコメント
  // 参照）が、それでも「実際にHTTPリクエストを送ってから30秒待ってタイムアウトする」という
  // 実接続自体は発生してしまうため、TAVILY_API_KEYと同様にDEEPSEEK_API_KEYも削除しておく
  // （こちらは「未設定なら自動フォールバック」ではなく「未設定なら即エラー」という違いはあるが、
  // どちらにしても実HTTP接続自体を発生させない点で有効な防御になる）。この対処もSEARCH_PROVIDER
  // と同じ理由でt.after()による復元は行わない（本ファイルの他のテストはLLM_PROVIDERに依存しない）。
  process.env.LLM_PROVIDER = "mock";
  delete process.env.DEEPSEEK_API_KEY;

  const { report, evaluation, validation, slug, paths } = await generateCompanyReport("https://example.com");

  assert.equal(slug, "example.com");
  assert.equal(report.meta.schema_version, "2.4");
  assert.ok(report.company_profile.name);
  assert.ok(Array.isArray(report.source_pages) && report.source_pages.length > 0);
  assert.ok(report.free_opportunity.title);
  assert.ok(report.evaluation, "report.evaluationがトップレベルに存在するはず");
  assert.equal(evaluation.score, report.evaluation.score);
  assert.equal(validation.ok, true, `Validatorはpassするはず: ${JSON.stringify(validation.errors)}`);

  assert.ok(fs.existsSync(paths.contextPath));
  assert.ok(fs.existsSync(paths.reportPath));
  assert.ok(fs.existsSync(paths.evaluationMdPath));
});

test("slugFromUrl: ホスト名からファイルシステム安全な文字列を作る（ネットワーク不要）", () => {
  assert.equal(slugFromUrl("https://example.com"), "example.com");
  assert.equal(slugFromUrl("https://example.com/path?query=1"), "example.com");
  assert.equal(slugFromUrl("not-a-valid-url"), "unknown-company");
});

test("validateReport: fixtures/good.jsonがPASSする（ネットワーク不要、上記の実HTTPテストとは独立）", () => {
  const report = readJson(path.join(REPORT_FIXTURES_DIR, "good.json"));
  const result = validateReport(report);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// buildCompanyProfile — 会社ページ保持 + 社名正規化 + placeholder 出し分け
// （Phase53 STEP10.11、ネットワーク不要）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase54 STEP1 — summarizeBusinessText / buildTopSources（ネットワーク不要）
// ---------------------------------------------------------------------------

test("summarizeBusinessText: 最大3文・最大400字に切り詰める", () => {
  const long = Array.from({ length: 10 }, (_, i) => `これは${i + 1}番目の文です。`).join("");
  const out = summarizeBusinessText(long);
  assert.equal(out, "これは1番目の文です。これは2番目の文です。これは3番目の文です。");
  const wall = "あ".repeat(1000) + "。";
  assert.ok(summarizeBusinessText(wall).length <= 400);
});

test("summarizeBusinessText: 空文字・null でクラッシュしない / 既存の短い summary は維持", () => {
  assert.equal(summarizeBusinessText(""), "");
  assert.equal(summarizeBusinessText(null), "");
  assert.equal(
    summarizeBusinessText("日本と中国のアニメ番組や実写番組の企画・制作・プロデュース。ABI"),
    "日本と中国のアニメ番組や実写番組の企画・制作・プロデュース。ABI"
  );
});

test("summarizeBusinessText: 文途中で不自然に壊さない（句点で区切る）", () => {
  const out = summarizeBusinessText("当社は建設業を営みます。 地域密着で施工します。 安全第一です。 品質にこだわります。");
  assert.ok(out.endsWith("。"), out);
  assert.ok(!out.includes("品質にこだわります"), "4文目は含めない");
});

test("buildTopSources Case A/C: company source が先頭・最大5件・hidden_sources_count", () => {
  const sourcePages = [
    { id: "src-1", source_type: "government", score: 100, evidence_strength: "primary" },
    { id: "src-2", source_type: "company", score: 90, evidence_strength: "primary" },
    { id: "src-3", source_type: "statistics", score: 95, evidence_strength: "secondary" },
    { id: "src-4", source_type: "industry_association", score: 88, evidence_strength: "secondary" },
    { id: "src-5", source_type: "technology", score: 85, evidence_strength: "secondary" },
    { id: "src-6", source_type: "news", score: 30, evidence_strength: "reference" },
    { id: "src-7", source_type: "news", score: 25, evidence_strength: "reference" },
    { id: "src-8", source_type: "government", score: 30, evidence_strength: "reference" },
    { id: "src-9", source_type: "technology", score: 30, evidence_strength: "reference" },
    { id: "src-10", source_type: "industry_association", score: 30, evidence_strength: "reference" },
  ];
  const { top_sources, hidden_sources_count } = buildTopSources(sourcePages);
  assert.equal(top_sources.length, 5);
  assert.equal(hidden_sources_count, 5);
  assert.equal(top_sources[0].source_type, "company", "company source が先頭");
});

test("buildTopSources Case B: source が5件以下なら hidden_sources_count = 0", () => {
  const { top_sources, hidden_sources_count } = buildTopSources([
    { id: "src-1", source_type: "company", score: 90 },
    { id: "src-2", source_type: "government", score: 100 },
  ]);
  assert.equal(top_sources.length, 2);
  assert.equal(hidden_sources_count, 0);
});

test("buildTopSources Case D: 低関連 source（reference/score<=30）を上位に入れない", () => {
  const sourcePages = [
    { id: "noise-1", source_type: "government", score: 30, evidence_strength: "reference" },
    { id: "noise-2", source_type: "news", score: 25, evidence_strength: "reference" },
    { id: "good-1", source_type: "statistics", score: 95, evidence_strength: "secondary" },
    { id: "good-2", source_type: "industry_association", score: 90, evidence_strength: "secondary" },
  ];
  const { top_sources } = buildTopSources(sourcePages, 2);
  assert.deepEqual(
    top_sources.map((s) => s.id),
    ["good-1", "good-2"]
  );
});

test("buildTopSources Case E: source_pages が空 / undefined でもクラッシュしない", () => {
  assert.deepEqual(buildTopSources([]), { top_sources: [], hidden_sources_count: 0 });
  assert.deepEqual(buildTopSources(undefined), { top_sources: [], hidden_sources_count: 0 });
});

test("buildCompanyProfile: Phase54 — business_summary は 2〜3文・最大400字に整形される", () => {
  const context = {
    input_url: "https://ex.example",
    company_fetch_ok: true,
    industry_hint: "中小企業",
    sources: [
      {
        id: "src-1",
        source_type: "company",
        title: "株式会社サンプル",
        summary:
          "コンテンツへスキップ ホーム 会社概要 お問い合わせ info@ex.example " +
          "当社はソフトウェア開発を行います。 工場向けのIoTシステムを提供します。 " +
          "全国に導入実績があります。 サポートも充実しています。 採用も積極的です。",
        url: "https://ex.example",
      },
    ],
  };
  const profile = buildCompanyProfile(context);
  assert.ok(!profile.business_summary.includes("info@ex.example"), profile.business_summary);
  assert.ok(!profile.business_summary.includes("コンテンツへスキップ"), profile.business_summary);
  assert.ok(profile.business_summary.length <= 400);
  assert.ok(profile.business_summary.includes("ソフトウェア開発"), profile.business_summary);
});

test("buildCompanyProfile: company source があれば <title> を正規化して name にする（Test C 相当・E2E）", () => {
  const context = {
    input_url: "https://illegame.com",
    company_fetch_ok: true,
    industry_hint: "中小企業",
    sources: [
      {
        id: "src-5",
        source_type: "company",
        title: "イル・レガメのホームページへようこそ",
        summary: "イル・レガメのホームページへようこそ IL LEGAME 私たちについて サービス 実績",
        url: "https://illegame.com",
      },
    ],
  };
  const profile = buildCompanyProfile(context);
  assert.equal(profile.name, "イル・レガメ");
  assert.notEqual(profile.name, "イル・レガメのホームページへようこそ");
  assert.ok(profile.business_summary && !profile.business_summary.startsWith("（"));
});

test("buildCompanyProfile: company source（法人格つき）は name に法人名を採用する（ab-i.jp 相当）", () => {
  const context = {
    input_url: "https://ab-i.jp",
    company_fetch_ok: true,
    industry_hint: "中小企業",
    sources: [
      {
        id: "src-1",
        source_type: "company",
        title: "アニメ制作から日本や中国での放映・コンテンツ配信なら株式会社ABI",
        summary: "本文の開始 # 株式会社ABI 日本国内と中国での映像コンテンツの配信からライブ・コンサート展開まで。",
        url: "https://www.ab-i.jp",
      },
    ],
  };
  const profile = buildCompanyProfile(context);
  assert.equal(profile.name, "株式会社ABI");
  assert.notEqual(profile.name, "（会社名未取得: ab-i.jp）");
  assert.notEqual(profile.business_summary, "（会社ページの取得に失敗したため未取得）");
});

test("buildCompanyProfile: company source が無く company_fetch_ok=true のとき「取得に失敗」placeholder を出さない（Test E）", () => {
  const context = {
    input_url: "https://foo.example",
    company_fetch_ok: true,
    industry_hint: "中小企業",
    sources: [{ id: "src-1", source_type: "government", title: "一般的な補助金情報", url: "https://gov.example" }],
  };
  const profile = buildCompanyProfile(context);
  assert.ok(profile.name, "name は空でない");
  assert.notEqual(profile.business_summary, "（会社ページの取得に失敗したため未取得）");
});

test("buildCompanyProfile: company_fetch_ok=false は従来どおり未取得 placeholder（Test F 相当・回帰）", () => {
  const context = {
    input_url: "https://down.example",
    company_fetch_ok: false,
    industry_hint: "中小企業",
    sources: [],
  };
  const profile = buildCompanyProfile(context);
  assert.equal(profile.name, "（会社名未取得: down.example）");
  assert.equal(profile.business_summary, "（会社ページの取得に失敗したため未取得）");
});
