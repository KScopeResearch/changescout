/**
 * fetch-company.js
 *
 * 会社自身の公開ページ（一次情報）を取得する。
 * Task8時点では「与えられたURLをそのまま1ページだけ取得する」実装とし、
 * 採用ページ・会社概要ページ等の追加URLを推測して取得することはしない
 * （存在しないURLを勝手に生成しないため。深いクロールはTask9以降で検討）。
 *
 * 依存パッケージなし（Node.js 18+ の組み込み fetch のみ使用）。
 */

const FETCH_TIMEOUT_MS = 8000;

/**
 * 会社の公開ページを1件取得する。
 * @param {string} companyUrl - 会社のURL（CLI引数でそのまま渡された値）
 * @returns {Promise<Object>} 正規化前の生データ1件
 *   { source_type: "company", source_role: "company_fact", label, url, content, fetched_at, ok, error }
 */
async function fetchCompany(companyUrl) {
  const result = {
    source_type: "company",
    source_role: "company_fact",
    label: null,
    url: companyUrl,
    content: null,
    organization: null,
    published_at: null,
    fetched_at: new Date().toISOString(),
    ok: false,
    error: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(companyUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "AOR-ReportGenerator/0.1 (+company-report-mvp)" },
    });

    if (!res.ok) {
      result.error = `HTTP ${res.status}`;
      return result;
    }

    const html = await res.text();
    result.label = extractTitle(html) || companyUrl;
    result.content = extractSummary(html);
    result.organization = result.label; // 会社自身のページなので、タイトルをそのまま組織名の手がかりとする
    // Last-Modified ヘッダーがあれば published_at として採用する（ベストエフォート、なくてもnullのまま）
    const lastModified = res.headers.get("last-modified");
    if (lastModified) {
      const d = new Date(lastModified);
      if (!isNaN(d.getTime())) result.published_at = d.toISOString();
    }
    result.ok = true;
    return result;
  } catch (err) {
    result.error = err.name === "AbortError" ? "timeout" : String(err.message || err);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} html @returns {string|null} */
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

// 【Phase54 STEP1】HTMLエンティティのデコード表。company_profile.business_summary に
// "&#8211;" のような未デコード文字列が出ていた（kscope.co.jp）ため、summary抽出時に解く。
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
  mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  copy: "©", reg: "®", trade: "™", middot: "·", bull: "・", yen: "¥",
};

/** @param {string} text @returns {string} HTMLエンティティ（数値・名前付き）をデコードする */
function decodeHtmlEntities(text) {
  return (text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+\d*);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
    });
}

/** @param {number} cp @returns {string} */
function safeFromCodePoint(cp) {
  try {
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  } catch (e) {
    return "";
  }
}

// メニュー・スキップリンク・フッター等の定型ナビ文言（summaryの本文ではない）。
const NAV_NOISE_PATTERNS = [
  /コンテンツへ(スキップ|移動)/g,
  /skip to (main )?content/gi,
  /メニュー(を開く|を閉じる)?/g,
  /(ページ)?トップへ(戻る)?/g,
  /©[^。]*?all rights reserved\.?/gi,
  /copyright\s*©?[^。]*?\d{4}[^。]*/gi,
  /メールで(すぐに)?(お)?問い?合(わ)?せ/g,
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, // メールアドレス
  /(TEL|FAX|電話)[：:\s]*[\d(){}+\- ]{8,}/gi, // 電話番号
];

// ヘッダ/フッタのメニュー項目（空白で区切られた単独トークンとして現れる場合のみ除去する）。
const MENU_TOKENS =
  /(?:^|\s)(ホーム|トップ(ページ)?|会社概要|企業情報|会社案内|事業内容|事業案内|サービス(案内)?|製品情報|実績(紹介)?|導入事例|お客様の声|よくある質問|FAQ|ブログ|コラム|お知らせ|新着情報|ニュース|プレスリリース|IR情報|採用情報|採用|リクルート|お問い?合(わ)?せ|お問合せ|アクセス|地図|プライバシー(ポリシー)?|個人情報保護方針|サイトマップ|利用規約|運営会社|MENU|HOME|TOP|ABOUT( US)?|COMPANY|SERVICES?|PRODUCTS?|WORKS|CASE|NEWS|BLOG|CONTACT( US)?|RECRUIT|CAREERS?|ACCESS|SITEMAP|PRIVACY)(?=\s|$)/gi;

/**
 * HTMLから会社ページの説明文（2〜3文相当）を抽出する。
 * 優先順位: <meta name="description"> → <meta property="og:description"> →
 *          <nav>/<header>/<footer>/aside 等を除いた本文の最初のまとまった段落。
 * いずれもHTMLエンティティをデコードし、ナビ定型文を除去する（Phase54 STEP1）。
 * @param {string} html
 * @returns {string|null}
 */
function extractSummary(html) {
  const src = html || "";

  const metaDesc =
    src.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
    src.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (metaDesc && metaDesc[1].trim()) return cleanSummaryText(metaDesc[1]);

  const ogDesc =
    src.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ||
    src.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  if (ogDesc && ogDesc[1].trim()) return cleanSummaryText(ogDesc[1]);

  // 本文: script/style/nav/header/footer/aside/form を落としてからタグ除去
  const bodyText = src
    .replace(/<(script|style|nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!bodyText) return null;

  return cleanSummaryText(bodyText, { fallbackSlice: 600 });
}

/**
 * 抽出テキストを表示可能な会社説明へ整える（entity decode → ナビ除去 → 空白正規化）。
 * @param {string} text
 * @param {{fallbackSlice?:number}} [options]
 * @returns {string}
 */
function cleanSummaryText(text, options = {}) {
  let out = decodeHtmlEntities(text || "");
  NAV_NOISE_PATTERNS.forEach((re) => (out = out.replace(re, " ")));
  // メニュー項目の連続を畳む（2回適用で「ホーム 会社概要 事業内容」のような連なりも落とす）。
  out = out.replace(MENU_TOKENS, " ").replace(MENU_TOKENS, " ");
  out = out
    .replace(/\s+[|｜»]\s+/g, " ") // 「A ｜ B」型のメニュー区切りだけを畳む（・/等の社名内文字は触らない）
    .replace(/(\S{4,})(?:\s+\1)+/g, "$1") // ロゴ/見出しで連続する同一トークンの繰り返しを1つに
    .replace(/\s+/g, " ")
    .trim();
  if (options.fallbackSlice && out.length > options.fallbackSlice) {
    out = out.slice(0, options.fallbackSlice).trim();
  }
  return out;
}

module.exports = { fetchCompany, extractSummary, decodeHtmlEntities, cleanSummaryText };
