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

/** @param {string} html @returns {string|null} meta descriptionまたは本文冒頭の簡易要約 */
function extractSummary(html) {
  const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (metaMatch) return metaMatch[1].trim();

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return bodyText ? bodyText.slice(0, 300) : null;
}

module.exports = { fetchCompany };
