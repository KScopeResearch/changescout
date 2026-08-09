/**
 * deduplicate-sources.js
 *
 * 正規化済みアイテム（normalize-sources.jsの出力）から重複を検出し、統合する。
 *
 * 重複とみなす条件:
 *   - URL完全一致
 *   - タイトル完全一致
 *   - URL末尾違い（末尾スラッシュ・クエリ文字列・フラグメントのみが異なる）
 *   - PDF違い（拡張子だけが異なる同一ドキュメント、例: report.pdf と report.html）
 *   - 同記事（正規化タイトルが一致、またはどちらかがもう一方を包含する近似一致）
 *
 * 重複と判定された場合は、情報量（published_at・organization・summaryの充実度）が
 * より多い方を残す。
 */

/**
 * URLを比較用に正規化する（末尾スラッシュ・クエリ・フラグメントを除去、拡張子を除去）。
 * @param {string} url
 * @returns {string}
 */
function normalizeUrlForComparison(url) {
  if (!url) return "";
  let u = url.trim();
  try {
    const parsed = new URL(u);
    u = parsed.origin + parsed.pathname;
  } catch (e) {
    // URLとして解釈できない場合はそのまま使う
  }
  u = u.replace(/\/+$/, ""); // 末尾スラッシュ除去
  u = u.replace(/\.(pdf|html?|php)$/i, ""); // PDF違い・拡張子違いを吸収
  return u.toLowerCase();
}

/**
 * タイトルを比較用に正規化する（空白・句読点を除去し小文字化）。
 * @param {string} title
 * @returns {string}
 */
function normalizeTitleForComparison(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .replace(/[\s　、。，．・「」『』（）()［］\[\]【】]/g, "")
    .trim();
}

/**
 * 2件が重複とみなせるかを判定する。
 * @param {Object} a - 正規化済みアイテム
 * @param {Object} b - 正規化済みアイテム
 * @returns {boolean}
 */
function isDuplicate(a, b) {
  if (a.url && b.url && a.url === b.url) return true;
  if (a.title && b.title && a.title === b.title) return true;

  const normUrlA = normalizeUrlForComparison(a.url);
  const normUrlB = normalizeUrlForComparison(b.url);
  if (normUrlA && normUrlB && normUrlA === normUrlB) return true;

  const normTitleA = normalizeTitleForComparison(a.title);
  const normTitleB = normalizeTitleForComparison(b.title);
  if (normTitleA && normTitleB) {
    if (normTitleA === normTitleB) return true;
    // 「同記事」の近似判定: 一定以上の長さがあり、一方がもう一方を包含する場合のみ。
    // 【Task12で修正】単純な包含チェックだけだと、会社名のような短い文字列が
    // 「会社名 + サフィックス」形式の検索結果タイトル全てに偶然含まれてしまい、
    // 無関係な記事同士を誤って同一記事とみなす問題があった（例: 会社ページの
    // タイトル「Example Domain」が「Example Domain 補助金に関する情報」等、
    // 無関係な複数カテゴリのタイトルすべてに包含されてしまう）。
    // 短い方の文字列が長い方に対して十分な割合を占める場合のみ「同記事」とみなす
    // ことで、単なる企業名の偶然の包含を「同記事」判定から除外する。
    if (normTitleA.length >= 6 && normTitleB.length >= 6) {
      const shorter = normTitleA.length <= normTitleB.length ? normTitleA : normTitleB;
      const longer = normTitleA.length <= normTitleB.length ? normTitleB : normTitleA;
      const containmentRatio = shorter.length / longer.length;
      if (longer.includes(shorter) && containmentRatio >= 0.6) return true;
    }
  }

  return false;
}

/**
 * アイテムの「情報量の多さ」を比較可能な数値にする。
 * @param {Object} item - 正規化済みアイテム
 * @returns {number}
 */
function richnessScore(item) {
  let score = 0;
  if (item.published_at) score += 2;
  if (item.organization) score += 1;
  if (item.summary) score += Math.min(item.summary.length / 50, 5);
  if (item.quote) score += 1;
  return score;
}

/**
 * 正規化済み配列から重複を除去する。重複グループの中では情報量が最も多いものを残す。
 * @param {Array<Object>} items - normalizeSources() の出力
 * @returns {{ deduplicated: Array<Object>, removedCount: number }}
 */
function deduplicateSources(items) {
  const groups = [];

  (items || []).forEach((item) => {
    const group = groups.find((g) => g.some((existing) => isDuplicate(existing, item)));
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  });

  const deduplicated = groups.map((group) => {
    if (group.length === 1) return group[0];
    return group.reduce((best, current) => (richnessScore(current) > richnessScore(best) ? current : best));
  });

  const removedCount = (items || []).length - deduplicated.length;
  return { deduplicated, removedCount };
}

module.exports = { deduplicateSources, isDuplicate, normalizeUrlForComparison, normalizeTitleForComparison, richnessScore };
