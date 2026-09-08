/**
 * classify-source.js — Phase54 STEP8A.1（Source Classification Root Cause Fix）
 *
 * 【背景】従来のパイプラインは、検索クエリのテンプレート（query-builder.js）が付けた
 * source_type をそのまま信頼していた。"<会社名> 補助金" というクエリで返ってきた結果は
 * 中身に関わらず government になり、score-sources.js がそれを見て 95〜100 点を付ける。
 * この結果、Retty のバー紹介ページ・EV補助金の交付額PDF・民間の補助金まとめサイト・
 * 別会社の会社概要が government / score 100 として Opportunity・Market Change・Top Sources に
 * 流れ込む事故が発生した（Phase54 STEP8 で判明）。
 *
 * 本モジュールは正規化済み source 1件を「ドメイン・タイトル・本文・組織名」から
 * 内容ベースで再分類する。テンプレ由来の source_type は信頼しない。
 *
 * 出力の source_type は AOR 公式の列挙型に、新たに directory / review を加えたもの:
 *   company / government / industry_association / statistics / news / technology /
 *   directory（企業DB・店舗/求人/見積ディレクトリ）/ review（口コミ・評判サイト）
 *
 * directory / review / 百科事典・SNS・他社サイト・民間補助金まとめ には
 * evidence_strength="reference" と低い score 上限を割り当て、後段の
 * 「低関連 source」判定（relevance-guard.js / quality-evaluator.js / validate-report.js /
 * generate-company-report.js の buildTopSources）と整合させる。
 *
 * mock provider（SEARCH_PROVIDER 未設定時の既定・テスト）由来の合成結果は
 * simulated=true で来る。これらはドメインが source.example.com 等の非実在ホストで
 * 内容判定ができないため、再分類せずテンプレ由来の型をそのまま維持する。
 */

const { registrableDomain, sameRegistrableDomain } = require("./search/relevance-guard");

const DIRECTORY_MAX_SCORE = 30; // STEP3: Local Directory Guard は score<=30
const REVIEW_MAX_SCORE = 30;
const REFERENCE_MAX_SCORE = 30; // 百科事典・他社サイト・民間補助金まとめ等
const SNS_MAX_SCORE = 25;
const UNKNOWN_MAX_SCORE = 55; // 素性が確認できないもの

/** @param {string} url @returns {string} www を除いた小文字ホスト（取得不能なら ""） */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

// --- 公的機関（RC-A2）-------------------------------------------------------
// go.jp / lg.jp、都道府県・市区町村の自治体ドメイン。
const GOV_HOST = /(^|\.)go\.jp$|(^|\.)lg\.jp$|(^|\.)(pref|city|town|vill|metro)\.[a-z0-9-]+\.jp$/;
// RC-A2 が government 扱いを明示している準公的機関。
const GOV_HOST_ALLOW = /(^|\.)(vipo\.or\.jp|jetro\.go\.jp)$/;
const GOV_ORG = new RegExp(
  [
    "金融庁", "国税庁", "財務省", "経済産業省", "経産省", "中小企業庁", "特許庁",
    "資源エネルギー庁", "総務省", "デジタル庁", "内閣府", "内閣官房", "厚生労働省", "厚労省",
    "農林水産省", "農水省", "林野庁", "水産庁", "国土交通省", "国交省", "観光庁", "環境省",
    "文部科学省", "文科省", "文化庁", "外務省", "法務省", "防衛省", "消費者庁", "こども家庭庁",
    "復興庁", "公正取引委員会", "会計検査院", "日本貿易振興機構", "ジェトロ", "JETRO",
    "中小企業基盤整備機構", "中小機構", "NEDO", "新エネルギー・産業技術総合開発機構",
    "情報処理推進機構", "経済産業局", "地方整備局", "映像産業振興機構", "VIPO",
  ].join("|")
);
// 民間の補助金まとめ／申請代行／エージェント。go.jp でなければ government ではない（RC-A2）。
const SUBSIDY_AGGREGATOR_HOST = /(hojokin|hojyokin|hozyokin|jyoseikin|josei-kin|subsidy|hojo-)/i;
const SUBSIDY_AGGREGATOR_TITLE = /(補助金|助成金)(まとめ|一覧|ガイド|辞典|ポータル|検索|情報|比較|エージェント)|使える(補助金|助成金)|申請代行|補助金コンサル/;

// --- 統計・調査機関（RC-A3）-----------------------------------------------
const STATS_HOST = /(^|\.)(e-stat\.go\.jp|stat\.go\.jp|boj\.or\.jp|yano\.co\.jp|tdb\.co\.jp|tsr-net\.co\.jp|nikkei-r\.co\.jp|gartner\.com|idc\.com|statista\.com|fcr\.co\.jp|m2ri\.jp|mm-research\.co\.jp)$/;
const STATS_ORG = /(矢野経済研究所|帝国データバンク|東京商工リサーチ|日経リサーチ|富士キメラ総研|富士経済|MM総研|エムエム総研|IDC\s*Japan|ガートナー|Gartner|総務省統計局|統計局|政府統計|e-Stat)/;
const STATS_TITLE = /(市場規模|市場調査|市場動向|市場予測|市場分析レポート|動向調査|実態調査|市場レポート|白書|統計(データ|表|調査|年報)|シェア調査|需要予測)/;

// --- 業界団体・シンクタンク --------------------------------------------------
const INDUSTRY_HOST = /\.or\.jp$/;
const INDUSTRY_ORG = /(工業会|工業協会|事業者団体|振興会|振興協会|協会|連合会|協議会|組合連合|事業協同組合|経済団体連合会|経団連|商工会議所|商工会|中小企業家同友会|日本総研|日本総合研究所|みずほリサーチ|大和総研|ニッセイ基礎研究所|三菱総合研究所|野村総合研究所)/;

// --- 報道・プレスリリース --------------------------------------------------
const NEWS_HOST = /(^|\.)(nikkei\.com|asahi\.com|yomiuri\.co\.jp|mainichi\.jp|sankei\.com|nhk\.or\.jp|jiji\.com|kyodo\.co\.jp|reuters\.com|bloomberg\.co\.jp|itmedia\.co\.jp|techcrunch\.com|toyokeizai\.net|diamond\.jp|president\.jp|newspicks\.com|prtimes\.jp|atpress\.ne\.jp|value-press\.com|impress\.co\.jp|ascii\.jp|cnet\.com|engadget\.com|ledge\.ai|ainow\.ai|businessinsider\.jp|forbesjapan\.com|japan-forward\.com|screens-lab\.jp|zdnet\.com)$/;
const NEWS_TITLE = /(ニュースリリース|プレスリリース|報道発表|記者会見|を発表しました|が発表)/;

// --- 企業DB・店舗/求人/見積ディレクトリ（STEP3: Local Directory Guard）-------
const DIRECTORY_HOST = /(^|\.)(retty\.me|tabelog\.com|gnavi\.co\.jp|hotpepper\.jp|ekiten\.jp|itp\.ne\.jp|mapion\.co\.jp|navitime\.co\.jp|its-mo\.com|baseconnect\.in|musubu\.in|houjin\.jp|houjin-bangou\.nta\.go\.jp|salesnow\.jp|biz-maps\.com|alarmbox\.jp|compalyze\.co\.jp|buffett-code\.com|ullet\.com|zehitomo\.com|imitsu\.jp|meetsmore\.com|creema\.jp|minne\.com|goope\.jp|jimdofree\.com|jimdo\.com|wixsite\.com|amebaownd\.com|indeed\.com|rikunabi\.com|mynavi\.jp|doda\.jp|wantedly\.com|green-japan\.com|type\.jp|townwork\.net|baitoru\.com|job-medley\.com|en-japan\.com|hatalike\.jp|handcrafted\.jp|jbplt\.jp|goo\.gl|g\.page)$/;
const DIRECTORY_HOST_CONTAINS = /(maps\.google\.|google\.[a-z.]+\/maps)/;
const DIRECTORY_TITLE = /(企業詳細|企業情報（電話番号|の会社概要・役員|法人リスト|全国法人|の求人|求人情報|中途採用|アルバイト情報|の店舗一覧|ショップ一覧|クーポン|ネット予約|への地図|の地図|アクセス・地図|ハンドメイド通販|通販・販売|フリマ|オンラインショップ|見積(もり)?(依頼|比較|の依頼)|発注先(探し)?|ビジネスマッチング|の電話番号・住所|インボイス登録番号・会社概要)/;

// --- 口コミ・評判サイト --------------------------------------------------
const REVIEW_HOST = /(^|\.)(openwork\.jp|jobtalk\.jp|en-hyouban\.com|kaisha-hyouban\.com|minhyo\.jp|lighthouse\.jp)$/;
const REVIEW_TITLE = /(口コミ|クチコミ|評判・口コミ|レビュー｜|の評判|体験談)/;

// --- SNS ---------------------------------------------------------------
const SNS_HOST = /(^|\.)(twitter\.com|x\.com|facebook\.com|instagram\.com|note\.com|ameblo\.jp|hatenablog\.com|hatenablog\.jp|hateblo\.jp|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|threads\.net|pinterest\.jp|pinterest\.com)$/;

// --- 百科事典・まとめ・Q&A ------------------------------------------------
const REFERENCE_HOST = /(^|\.)(wikipedia\.org|wikiwand\.com|weblio\.jp|kotobank\.jp|okwave\.jp|chiebukuro\.yahoo\.co\.jp)$/;

const EXTERNAL_ENUM = ["government", "statistics", "industry_association", "technology", "news"];

/**
 * 正規化済み source 1件を内容ベースで再分類する。
 * @param {{url?:string, title?:string, label?:string, organization?:string, summary?:string, content?:string, source_type?:string, simulated?:boolean}} item
 * @param {{targetUrl?:string}} [options]
 * @returns {{source_type:string, category:string, scoreCap:(number|null), evidenceStrength:(string|null), reason:string}}
 */
function classifySource(item, options = {}) {
  const url = (item && item.url) || "";
  const host = hostOf(url);
  const title = (item && (item.title || item.label)) || "";
  const org = (item && item.organization) || "";
  const body = (item && (item.summary || item.content || item.quote)) || "";
  const hay = `${title} ${org} ${body}`;
  const targetUrl = options.targetUrl || "";

  const out = (source_type, category, scoreCap, evidenceStrength, reason) => ({
    source_type,
    category,
    scoreCap: scoreCap == null ? null : scoreCap,
    evidenceStrength: evidenceStrength || null,
    reason,
  });

  // 1. company: 対象企業と同一 registrable domain のときだけ（RC-A4。サブドメインは許容）
  if (targetUrl && host && sameRegistrableDomain(url, targetUrl)) {
    return out("company", "company", null, null, "対象企業ドメイン一致");
  }

  // simulated（mock）由来はホスト・本文で内容判定できないため、テンプレ由来の型を維持する
  if (item && item.simulated === true) {
    const t = EXTERNAL_ENUM.includes(item.source_type) || item.source_type === "company"
      ? item.source_type
      : "news";
    return out(t === "company" ? "news" : t, "simulated", null, null, "mock由来（再分類しない）");
  }

  // 2. SNS / 百科事典・Q&A → reference
  if (SNS_HOST.test(host)) return out("news", "reference", SNS_MAX_SCORE, "reference", "SNS");
  if (REFERENCE_HOST.test(host)) {
    return out("news", "reference", REFERENCE_MAX_SCORE, "reference", "百科事典・まとめ・Q&A");
  }

  // 3. 口コミ・評判サイト → review
  if (
    REVIEW_HOST.test(host) ||
    (REVIEW_TITLE.test(title) && (DIRECTORY_HOST.test(host) || DIRECTORY_TITLE.test(title)))
  ) {
    return out("review", "review", REVIEW_MAX_SCORE, "reference", "口コミ・評判サイト");
  }

  // 4. 企業DB・店舗/求人/見積ディレクトリ → directory（STEP3: Local Directory Guard）
  if (DIRECTORY_HOST.test(host) || DIRECTORY_HOST_CONTAINS.test(url) || DIRECTORY_TITLE.test(title)) {
    return out("directory", "directory", DIRECTORY_MAX_SCORE, "reference", "企業DB・店舗/求人/見積ディレクトリ");
  }

  // 5. 民間の補助金まとめ／エージェント（go.jp でない）→ reference（RC-A2）
  if (
    !GOV_HOST.test(host) &&
    (SUBSIDY_AGGREGATOR_HOST.test(host) || SUBSIDY_AGGREGATOR_TITLE.test(title))
  ) {
    return out("news", "reference", REFERENCE_MAX_SCORE, "reference", "民間の補助金まとめ/エージェント（政府機関ではない）");
  }

  // 6. government（RC-A2）
  if (GOV_HOST.test(host) || GOV_HOST_ALLOW.test(host) || GOV_ORG.test(hay)) {
    return out("government", "government", null, null, "公的機関ドメイン/省庁名");
  }

  // 7. statistics（RC-A3）
  if (
    STATS_HOST.test(host) ||
    STATS_ORG.test(hay) ||
    (STATS_TITLE.test(title) && !/ブログ|まとめ|比較|おすすめ|ランキング記事/.test(title))
  ) {
    return out("statistics", "statistics", null, null, "統計・調査機関");
  }

  // 8. industry_association（業界団体・シンクタンク）
  if (INDUSTRY_HOST.test(host) || INDUSTRY_ORG.test(hay)) {
    return out("industry_association", "industry_association", null, null, "業界団体・シンクタンク");
  }

  // 9. news（報道・プレスリリース）
  if (NEWS_HOST.test(host) || NEWS_TITLE.test(title)) {
    return out("news", "news", null, null, "報道・プレスリリース");
  }

  // 10. テンプレが company と言っているが対象企業と別ドメイン → 他社サイト（reference）
  if (item && item.source_type === "company") {
    return out("news", "reference", REFERENCE_MAX_SCORE, "reference", "別ドメインの他社サイト（対象企業ではない）");
  }

  // 11. 素性が確認できない。テンプレ由来の型（government 等）は信頼せず news 上限55 に倒す
  return out("news", "other", UNKNOWN_MAX_SCORE, null, "分類不能（テンプレ由来の型は信頼せず news・上限55）");
}

/**
 * 「対象企業ドメインと一致しない企業DB・店舗ディレクトリ」かどうか（STEP3 の単独判定・テスト用）。
 * @param {Object} item
 * @param {string} targetUrl
 * @returns {boolean}
 */
function isLocalDirectory(item, targetUrl) {
  if (item && targetUrl && item.url && sameRegistrableDomain(item.url, targetUrl)) return false;
  const c = classifySource(item, { targetUrl });
  return c.category === "directory" || c.category === "review";
}

/**
 * 正規化済み source 配列を内容ベースで再分類する。source_type / evidence_strength を
 * 上書きし、score 上限を _score_cap に記録する（実際の cap 適用は company-context.js が
 * scoreSources() の後に行う）。
 * @param {Array<Object>} items - normalizeSources() の出力
 * @param {{targetUrl?:string}} [options]
 * @returns {Array<Object>}
 */
function reclassifySources(items, options = {}) {
  return (items || []).map((item) => {
    const c = classifySource(item, options);
    const next = { ...item, source_type: c.source_type, _classification: c.category, _classification_reason: c.reason };
    if (c.evidenceStrength) next.evidence_strength = c.evidenceStrength;
    if (c.scoreCap != null) next._score_cap = c.scoreCap;
    return next;
  });
}

/**
 * _score_cap が付いた item の score を上限でクランプする（scoreSources() の後に呼ぶ）。
 * @param {Array<Object>} scored
 * @returns {Array<Object>}
 */
function applyScoreCaps(scored) {
  return (scored || []).map((s) =>
    s && typeof s._score_cap === "number" && typeof s.score === "number" && s.score > s._score_cap
      ? { ...s, score: s._score_cap }
      : s
  );
}

module.exports = {
  classifySource,
  isLocalDirectory,
  reclassifySources,
  applyScoreCaps,
  DIRECTORY_MAX_SCORE,
  REVIEW_MAX_SCORE,
  REFERENCE_MAX_SCORE,
};
