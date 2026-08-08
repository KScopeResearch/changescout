/**
 * score-sources.js
 *
 * 正規化・重複除去済みのアイテムに、0〜100の品質スコアを付与する。
 *
 * 【注意】ここで分類する「政府/企業IR/企業公式/業界団体/技術団体/大手ニュース/専門誌/
 * ブログ/SNS」等は、スコア計算のためだけの内部分類である。docs/mock_data・website/aorが
 * 使う source_type（company/government/industry_association/statistics/news/technology）
 * という公式の6分類（列挙型）は一切変更しない（設計変更を避けるため）。
 */

const BASE_SCORE_BY_CATEGORY = {
  政府: 95,
  統計: 90,
  企業IR: 90,
  企業公式: 88,
  業界団体: 85,
  技術団体: 82,
  大手ニュース: 75,
  専門誌: 70,
  ブログ: 40,
  SNS: 20,
  その他: 50,
};

const RECENT_MONTHS_THRESHOLD = 12; // これ以内なら「新しい情報」+10
const OLD_MONTHS_THRESHOLD = 24; // これ以上なら「古い情報」-10

/**
 * source_type・タイトル・URLから、スコア計算用の内部カテゴリを推定する。
 * @param {Object} item - 正規化済みアイテム
 * @returns {string} BASE_SCORE_BY_CATEGORY のキーのいずれか
 */
function classifyCategory(item) {
  const type = item.source_type;
  const haystack = `${item.title || ""} ${item.url || ""} ${item.organization || ""}`;

  if (type === "government") return "政府";
  if (type === "statistics") return "統計";

  if (type === "company") {
    if (/IR|決算|有価証券報告書|investor/i.test(haystack)) return "企業IR";
    return "企業公式";
  }

  if (type === "industry_association") return "業界団体";
  if (type === "technology") return "技術団体";

  if (type === "news") {
    if (/twitter\.com|x\.com|facebook\.com|instagram\.com|note\.com/i.test(item.url || "")) return "SNS";
    if (/blog|ブログ/i.test(haystack)) return "ブログ";
    if (/専門誌|業界紙|trade/i.test(haystack)) return "専門誌";
    return "大手ニュース";
  }

  return "その他";
}

/**
 * ISO8601日時文字列から、現在までの経過月数を計算する。
 * @param {string} isoString
 * @returns {number|null} 経過月数。不正な日時の場合はnull。
 */
function monthsSince(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

/**
 * 1件のアイテムにスコアを付与する。
 * @param {Object} item - 正規化済みアイテム（scoreはnullの状態）
 * @returns {Object} scoreと_category（内部分類、デバッグ用）を追加したアイテムのコピー
 */
function scoreSource(item) {
  const category = classifyCategory(item);
  let score = BASE_SCORE_BY_CATEGORY[category] ?? 50;

  const age = item.published_at ? monthsSince(item.published_at) : null;
  if (age !== null) {
    if (age <= RECENT_MONTHS_THRESHOLD) score += 10; // 新しい情報
    else if (age >= OLD_MONTHS_THRESHOLD) score -= 10; // 古い情報
  }

  if (item.quote) score += 5; // 引用あり
  if (item.author) score += 5; // 著者あり（現状の正規化データには author は含まれないため、将来拡張用）

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { ...item, score, _category: category };
}

/**
 * 配列全体にスコアを付与し、スコア降順に並び替える。
 * @param {Array<Object>} items - 重複除去済みアイテムの配列
 * @returns {Array<Object>} スコア付与・降順ソート済みの配列
 */
function scoreSources(items) {
  return (items || []).map(scoreSource).sort((a, b) => b.score - a.score);
}

module.exports = { scoreSource, scoreSources, classifyCategory, monthsSince, BASE_SCORE_BY_CATEGORY };
