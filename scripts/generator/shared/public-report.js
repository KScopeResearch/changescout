/**
 * public-report.js — 内部 report.json から「受信者へ公開してよい情報だけ」を
 * allowlist 方式で射影（projection）した Public Report を組み立てる。
 *
 * 【背景 / Phase58 STEP1】publish-report.js は従来、承認済み report.json の内容を
 * ほぼそのまま website/aor/data/<slug>.json へコピーしていた（human_review.status の
 * 同期のみ）。その結果、
 *   - evaluation（社内レビュー優先度用の品質スコア。docs/strategy_v2/05_ai_pipeline.md
 *     「対外表示との使い分け」で外部非表示と明記）
 *   - ai_pipeline（LLM provider / model 等の内部実装情報）
 *   - human_review.reviewer / notes / checklist / review_history（内部レビュー運用情報）
 *   - send_target（配信先・取得経路・opt-in 記録という内部 delivery metadata）
 *   - meta.note / meta.pipeline_version（内部生成メモ・実装バージョン）
 * が公開 JSON に同梱され、website/aor/assets/js/common.js が JSON 全体をブラウザへ
 * fetch するため、renderer が非表示にしていても URL を直接叩けば取得できる状態だった
 * （Phase57 STEP6 監査 I-1 / I-2 / I-4）。
 *
 * 【方針】「renderer で隠す」ではなく「公開 payload そのものに存在しない」へ移行する。
 *   - 公開対象フィールドを明示的に allowlist する（ブラックリスト方式に依存しない）。
 *     将来 report に新しい内部フィールドが追加されても、allowlist に載っていない限り
 *     公開 JSON へは一切漏れない。
 *   - meta / human_review は sub-projection でさらに絞る。
 *   - 実際に公開 renderer（report-preview.js / preview-ui.js / paid-preview.js）と
 *     メール teaser（shared/report-teaser.js）が参照するフィールドは維持する。
 *
 * 【このモジュールは純粋関数のみ】I/O は行わない。publish-report.js から呼ばれる。
 * Lambda bundle からも読めるよう website/ には依存しない（report-teaser.js と同じ方針）。
 */

/**
 * 公開 JSON に残すトップレベルフィールド（allowlist）。
 * ここに無いフィールド（evaluation / ai_pipeline / send_target / 将来の内部フィールド）は
 * 公開 JSON へ一切含めない。
 *
 * - meta / human_review はさらに sub-projection する（下記 PUBLIC_META_FIELDS /
 *   PUBLIC_HUMAN_REVIEW_FIELDS 参照）。
 * - それ以外は参照ごとコピーする（company_profile / free_opportunity / source_pages /
 *   paid_analysis 等は「公開コンテンツ」そのものであり、公開が設計意図。混入する PII は
 *   別途 shared/pii-sanitizer.js（生成時）と shared/public-data-safety-check.js
 *   （デプロイ時）が担保する）。
 */
const PUBLIC_TOP_LEVEL_FIELDS = Object.freeze([
  "id",
  "meta",
  "company_profile",
  "source_pages",
  "top_sources",
  "hidden_sources_count",
  "free_opportunity",
  "locked_opportunities",
  "paid_analysis",
  "human_review",
]);

/**
 * meta のうち公開してよいサブフィールド。
 * - schema_version: renderer / 将来の互換判定用
 * - generated_at: renderer フッター・有料プレビューヘッダーが「作成日」として表示
 * - published_at: Phase58 STEP1 で追加。実際に publish projection を生成した時刻
 * - industry_category: 業種カテゴリ（company_profile.industry_label 相当。PII ではない）
 * - opportunity_theme_fixed / opportunity_theme_search_applied: 採用テーマの説明的メタ情報
 *
 * 除外: note（"LLM_PROVIDER=deepseek"・内部 Task 番号・"シミュレーションデータ" 等の
 * 内部生成メモ）、pipeline_version（内部実装バージョン）。
 */
const PUBLIC_META_FIELDS = Object.freeze([
  "schema_version",
  "generated_at",
  "published_at",
  "industry_category",
  "opportunity_theme_fixed",
  "opportunity_theme_search_applied",
]);

/**
 * human_review のうち公開してよいサブフィールド。
 * status と reviewed_at のみ（preview-ui.js / report-teaser.js の humanReviewLine が
 * 「運営がこのレポートの内容と出典を確認しました」＋日付表示に使う）。
 *
 * 除外: reviewer（レビュー担当者名）、review_duration_minutes、checklist、notes、
 * review_history（いずれも内部レビュー運用情報）。
 */
const PUBLIC_HUMAN_REVIEW_FIELDS = Object.freeze(["status", "reviewed_at"]);

/**
 * 公開 JSON に絶対に出現してはいけない、明白に内部専用のキー名（多層防御）。
 * allowlist projection が主たる防御だが、company_profile / free_opportunity 等の
 * 「公開コンテナ」の内側に将来内部データがネストされた場合の保険として、
 * 射影後オブジェクトを再帰的に走査してこれらのキーが無いことを検査する
 * （findInternalFieldLeaks）。
 *
 * 汎用的すぎて誤検知しうる "note" / "notes" 等は入れない（confidence_note 等の
 * 正当なネストフィールドがあるため）。
 */
const INTERNAL_ONLY_KEYS = Object.freeze([
  "evaluation",
  "ai_pipeline",
  "send_target",
  "reviewer",
  "review_history",
  "review_duration_minutes",
]);

/**
 * published_at をISO 8601文字列へ正規化する。
 * @param {string|Date|undefined} value
 * @returns {string} ISO 8601（例: "2026-09-10T12:37:06.000Z"）
 */
function normalizePublishedAt(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * meta を公開サブフィールドだけへ射影する。published_at は必ずセットする。
 * @param {Object} meta - 元 report.meta（省略時は {}）
 * @param {{publishedAt?: string|Date}} options
 * @returns {Object}
 */
function projectMeta(meta, options = {}) {
  const src = meta && typeof meta === "object" ? meta : {};
  const out = {};
  for (const key of PUBLIC_META_FIELDS) {
    if (key === "published_at") continue; // 下で必ずセットする
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  out.published_at = normalizePublishedAt(options.publishedAt);
  return out;
}

/**
 * human_review を公開サブフィールドだけへ射影する。
 * @param {Object} humanReview - 元 report.human_review（省略時は {}）
 * @returns {Object}
 */
function projectHumanReview(humanReview) {
  const src = humanReview && typeof humanReview === "object" ? humanReview : {};
  const out = {};
  for (const key of PUBLIC_HUMAN_REVIEW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

/**
 * 内部 report から Public Report（公開 JSON の中身）を組み立てる。
 *
 * @param {Object} report - 承認済み report（publish-report.js の syncPublishedHumanReview 適用後）
 * @param {{publishedAt?: string|Date}} [options] - publishedAt 省略時は現在時刻
 * @returns {Object} 公開してよいフィールドだけを含む新しいオブジェクト（入力は変更しない）
 */
function buildPublicReport(report, options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("buildPublicReport: report オブジェクトが必要です");
  }

  const out = {};
  for (const key of PUBLIC_TOP_LEVEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(report, key)) continue;
    if (key === "meta") {
      out.meta = projectMeta(report.meta, options);
    } else if (key === "human_review") {
      out.human_review = projectHumanReview(report.human_review);
    } else {
      out[key] = report[key];
    }
  }

  // 元 report に meta が無くても published_at を載せるため最低限の meta を用意する。
  if (!out.meta) out.meta = projectMeta({}, options);

  return out;
}

/**
 * 射影後オブジェクトを再帰的に走査し、内部専用キー（INTERNAL_ONLY_KEYS）や
 * allowlist 外のトップレベル / meta / human_review キーが残っていないか検査する。
 *
 * publish-report.js が書き込み直前に呼び、1件でも見つかったら公開を中止する
 * （projection のリグレッションを本番反映前に止める多層防御）。
 *
 * @param {Object} publicReport - buildPublicReport() の戻り値
 * @returns {string[]} 検出した違反の説明（空配列なら安全）
 */
function findInternalFieldLeaks(publicReport) {
  const violations = [];
  if (!publicReport || typeof publicReport !== "object") {
    return ["public report がオブジェクトではありません"];
  }

  for (const key of Object.keys(publicReport)) {
    if (!PUBLIC_TOP_LEVEL_FIELDS.includes(key)) {
      violations.push(`allowlist 外のトップレベルフィールド: "${key}"`);
    }
  }
  if (publicReport.meta && typeof publicReport.meta === "object") {
    for (const key of Object.keys(publicReport.meta)) {
      if (!PUBLIC_META_FIELDS.includes(key)) {
        violations.push(`allowlist 外の meta フィールド: "meta.${key}"`);
      }
    }
  }
  if (publicReport.human_review && typeof publicReport.human_review === "object") {
    for (const key of Object.keys(publicReport.human_review)) {
      if (!PUBLIC_HUMAN_REVIEW_FIELDS.includes(key)) {
        violations.push(`allowlist 外の human_review フィールド: "human_review.${key}"`);
      }
    }
  }

  // 多層防御: 公開コンテナの内側に内部専用キーがネストされていないか再帰確認する。
  const seen = new Set();
  const walk = (value, pathParts) => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...pathParts, `[${i}]`]));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const currentPath = [...pathParts, key].join(".");
      if (INTERNAL_ONLY_KEYS.includes(key)) {
        violations.push(`内部専用キーを検出: "${currentPath}"`);
      }
      walk(child, [...pathParts, key]);
    }
  };
  walk(publicReport, []);

  return violations;
}

module.exports = {
  buildPublicReport,
  findInternalFieldLeaks,
  normalizePublishedAt,
  PUBLIC_TOP_LEVEL_FIELDS,
  PUBLIC_META_FIELDS,
  PUBLIC_HUMAN_REVIEW_FIELDS,
  INTERNAL_ONLY_KEYS,
};
