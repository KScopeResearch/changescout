/*
 * AOR Phase5.1 - 共通ユーティリティ / 共通コンポーネント
 * 対応スキーマ: docs/mock_data (schema_version 2.4)
 * 3画面（report-preview / email-capture / paid-preview）から共有する。
 * 旧スキーマ（opportunities_open, opportunities_locked(旧構造), paid_preview_opportunity,
 * registration_bonus, priority_matrix.items）には一切対応しない。
 *
 * データの正規化方針（v2.4）:
 *   - 出典情報（source_type/source_role/evidence_strength/label/url）の唯一の正は source_pages。
 *     free_opportunity.evidence は { source_id, quote } のみを持ち、resolveEvidence() で結合する。
 *   - Opportunity情報の唯一の正は paid_analysis.additional_opportunities。
 *     priority_matrix の各象限は opportunity_ids（id配列）のみを持ち、getOpportunityMap() で解決する。
 */

const OPERATOR_EMAIL = "support@aor.example.jp";

// PJ2 第2実装: website/aor-lead-api/（メール回収API）のベースURL。
// website/aorはビルドステップを持たない純粋な静的サイトのため、OPERATOR_EMAILと同じ
// 「配置ごとにこの定数を書き換える」という既存方針を踏襲する。
// PJ2 AOR Phase49 STEP10: aor-lead-api を Lambda + Function URL（pj2-aor-lead-api、
// AuthType=NONE、公開ルートは unsubscribe / weekly-report-consent / paid-report-request のみ）
// として本番構築したため、本番の Function URL を設定する。末尾スラッシュは付けない
// （unsubscribe.js 等が `${LEAD_API_BASE_URL}/api/leads/...` と連結するため）。
// ローカル動作確認時は `http://localhost:4700` へ一時的に戻すこと。
const LEAD_API_BASE_URL = "https://6nvmhes7wgy6h3keiiqqsoij4y0wegss.lambda-url.ap-northeast-1.on.aws";

const SOURCE_TYPE_LABELS = {
  company: "企業",
  government: "政府",
  industry_association: "業界団体",
  statistics: "統計",
  news: "ニュース",
  technology: "技術",
};

const SOURCE_ROLE_LABELS = {
  company_fact: "企業情報",
  market_change: "市場変化",
  industry_trend: "業界動向",
  evidence: "補足情報",
};

const EVIDENCE_STRENGTH_LABELS = {
  primary: "PRIMARY",
  secondary: "SECONDARY",
  reference: "REFERENCE",
};

/* ==================== データ取得 ==================== */

/**
 * URLクエリ文字列から ?company=<slug> を取り出す。
 * @returns {string|null} 会社スラッグ。指定がない場合は null。
 */
function getCompanyParam() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("company");
  return slug && slug.trim() ? slug.trim() : null;
}

/**
 * URLクエリ文字列から ?lead=<lead_id> を取り出す（PJ2 Phase3前段: メールURL・
 * report_token連携）。company=単体の既存URL（デモ閲覧等）との後方互換のため必須とはせず、
 * 指定が無い場合は null を返す。lead_idはPhase4-A/B（詳細レポート希望/週次配信同意）への
 * 引き渡し用の低リスクな追跡識別子であり、この値単体でレポート内容の取得には使わない
 * （report_generated済みLeadのcompany_slugはメール本文側で別途company=として渡す想定。
 * 詳細はdocs/email-capture-design.md参照）。
 * @returns {string|null}
 */
function getLeadParam() {
  const params = new URLSearchParams(window.location.search);
  const lead = params.get("lead");
  return lead && lead.trim() ? lead.trim() : null;
}

/**
 * URLクエリ文字列から ?token=<report_token> を取り出す（PJ2 Phase3前段）。
 * report_tokenはPhase4-A/B（状態変更API、POST /api/leads/:lead_id/paid-report-request等）
 * にのみ必要な値。report-preview.html・paid-preview.html自身はこの値を検証・消費せず、
 * email-capture.htmlへの遷移リンクを組み立てる際に素通りさせるだけにとどめる。
 * @returns {string|null}
 */
function getReportTokenParam() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  return token && token.trim() ? token.trim() : null;
}

/**
 * data/<slug>.json を取得してパースする。
 * @param {string} slug - 会社スラッグ（例: "company-01-manufacturing"）
 * @returns {Promise<Object>} 会社データ（docs/mock_data スキーマ準拠）
 * @throws {Error} HTTPエラー、またはJSONパースエラー時
 */
async function fetchCompanyData(slug) {
  const res = await fetch(`data/${slug}.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/* ==================== 正規化データの解決 ==================== */

/**
 * additional_opportunities から id → Opportunity の Map を構築する。
 * priority_matrix.quadrants.*.opportunity_ids はこの Map を介して解決し、
 * id による都度の配列検索やデータの重複埋め込みを避ける。
 * @param {Array<Object>} additionalOpportunities - paid_analysis.additional_opportunities
 * @returns {Map<string, Object>} id をキーとした Opportunity の Map
 */
function getOpportunityMap(additionalOpportunities) {
  return new Map((additionalOpportunities || []).map((o) => [o.id, o]));
}

/**
 * source_pages から id → 出典情報 の Map を構築する。
 * free_opportunity.evidence[].source_id はこの Map を介して解決する。
 * @param {Array<Object>} sourcePages - 会社データの source_pages
 * @returns {Map<string, Object>} id をキーとした出典情報の Map
 */
function getSourceMap(sourcePages) {
  return new Map((sourcePages || []).map((s) => [s.id, s]));
}

/**
 * evidence 1件（{source_id, quote}）を、sourceMap から出典情報と結合し、
 * 表示に必要な全項目を持つオブジェクトへ解決する。
 * @param {{source_id: string, quote: string}} evidenceRef - free_opportunity.evidence の1要素
 * @param {Map<string, Object>} sourceMap - getSourceMap() で構築した Map
 * @returns {Object} { quote, source_type, source_role, evidence_strength, source_name, source_url }
 */
function resolveEvidence(evidenceRef, sourceMap) {
  const source = sourceMap.get(evidenceRef.source_id) || {};
  return {
    quote: evidenceRef.quote,
    source_type: source.source_type,
    source_role: source.source_role,
    evidence_strength: source.evidence_strength,
    source_name: source.label,
    source_url: source.url,
  };
}

/* ==================== 画面状態の切り替え（loading / error / page） ==================== */

/**
 * 指定した1つの状態要素のみを表示し、それ以外を hidden にする。
 * @param {string} idToShow - 表示する要素のid
 * @param {string[]} stateIds - 状態を切り替える対象の要素idの一覧
 */
function showState(idToShow, stateIds) {
  stateIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = id !== idToShow;
  });
}

/**
 * 画面内にエラーメッセージを表示する（console.errorのみに頼らない）。
 * @param {HTMLElement} container - エラー表示を差し込む要素
 * @param {string} title - エラーの見出し
 * @param {string} [detail] - 補足説明（任意）
 */
function showError(container, title, detail) {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "fatal-error";

  const h = document.createElement("p");
  h.className = "fatal-error__title";
  h.textContent = title;
  box.appendChild(h);

  if (detail) {
    const p = document.createElement("p");
    p.className = "fatal-error__detail";
    p.textContent = detail;
    box.appendChild(p);
  }

  container.appendChild(box);
}

/* ==================== 汎用バッジ ==================== */

/**
 * 汎用バッジ（span要素）を1つ生成する。
 * @param {string} text - バッジに表示するテキスト
 * @param {string} className - 付与する追加クラス（"badge "の後に結合される）
 * @returns {HTMLSpanElement}
 */
function createBadge(text, className) {
  const span = document.createElement("span");
  span.className = "badge " + className;
  span.textContent = text;
  return span;
}

/** @param {string} type - source_type の値 @returns {HTMLSpanElement} */
function sourceTypeBadge(type) {
  return createBadge(SOURCE_TYPE_LABELS[type] || type, "badge-source-type badge-source-type--" + type);
}

/** @param {string} role - source_role の値 @returns {HTMLSpanElement} */
function sourceRoleBadge(role) {
  return createBadge(SOURCE_ROLE_LABELS[role] || role, "badge-source-role");
}

/** @param {string} strength - evidence_strength の値（primary/secondary/reference） @returns {HTMLSpanElement} */
function strengthBadge(strength) {
  return createBadge(EVIDENCE_STRENGTH_LABELS[strength] || strength, "badge-strength badge-strength--" + strength);
}

/** @param {string} relevance - 関連度（"高"/"中"） @returns {HTMLSpanElement} */
function relevanceBadge(relevance) {
  const cls = relevance === "高" ? "badge-relevance-high" : "badge-relevance-medium";
  return createBadge(`関連度: ${relevance}`, cls);
}

/* ==================== 根拠（evidence）1件の描画 ==================== */

/**
 * 根拠（evidence）1件をリスト項目として描画する。source_type / source_role /
 * evidence_strength をすべてバッジ表示し、ニュースだけで結論を導いているように
 * 見えないようにする。
 * @param {Object} resolvedEvidence - resolveEvidence() で解決済みのevidence
 *   （quote, source_type, source_role, evidence_strength, source_name, source_url）
 * @returns {HTMLLIElement}
 */
function createEvidenceItem(resolvedEvidence) {
  const ev = resolvedEvidence;
  const li = document.createElement("li");
  li.className = "evidence-item evidence-item--" + (ev.evidence_strength || "reference");

  const badges = document.createElement("div");
  badges.className = "evidence-item__badges";
  if (ev.source_type) badges.appendChild(sourceTypeBadge(ev.source_type));
  if (ev.source_role) badges.appendChild(sourceRoleBadge(ev.source_role));
  if (ev.evidence_strength) badges.appendChild(strengthBadge(ev.evidence_strength));
  li.appendChild(badges);

  if (ev.quote) {
    const quote = document.createElement("blockquote");
    quote.className = "evidence-item__quote";
    quote.textContent = ev.quote;
    li.appendChild(quote);
  }

  if (ev.source_name) {
    const source = document.createElement("p");
    source.className = "evidence-item__source";
    source.append("出典: ");
    if (ev.source_url) {
      const link = document.createElement("a");
      link.href = ev.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = ev.source_name;
      source.appendChild(link);
    } else {
      source.append(ev.source_name);
    }
    li.appendChild(source);
  }

  return li;
}

/* ==================== Opportunityカード（共通コンポーネント） ==================== */

/**
 * Opportunityカードを描画する共通コンポーネント。3画面すべてでこの関数を使い、
 * カードのHTML生成を重複させない。
 * @param {Object} opp - Opportunityデータ（variantにより必要なフィールドが異なる）
 * @param {Object} [options]
 * @param {"deep"|"light"|"locked"} [options.variant="light"] - 表示バリアント。
 *   'deep': free_opportunity（title/why_now/why_company/market_change/evidence[]/first_action）。
 *   evidence[] は resolveEvidence() 済みの配列を渡すこと（source_pagesとの結合は呼び出し側で行う）。
 *   'light': additional_opportunities（title/summary/expected_effect/relevance）。
 *   'locked': locked_opportunities（titleのみ）。
 * @param {string} [options.eyebrow] - カード見出し上に添える小ラベル（任意）
 * @param {string} [options.extraClass] - 追加クラス（任意）
 * @returns {HTMLElement}
 */
function createOpportunityCard(opp, options) {
  options = options || {};
  const variant = options.variant || "light";
  const card = document.createElement("article");
  card.className = "opp-card opp-card--" + variant + (options.extraClass ? " " + options.extraClass : "");

  if (variant === "locked") {
    const icon = document.createElement("span");
    icon.className = "opp-card__lock-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🔒";
    card.appendChild(icon);

    const title = document.createElement("span");
    title.className = "opp-card__title";
    title.textContent = opp.title;
    card.appendChild(title);
    return card;
  }

  const head = document.createElement("div");
  head.className = "opp-card__head";
  if (options.eyebrow) {
    const eyebrow = document.createElement("span");
    eyebrow.className = "opp-card__eyebrow";
    eyebrow.textContent = options.eyebrow;
    head.appendChild(eyebrow);
  }
  if (opp.relevance) {
    head.appendChild(relevanceBadge(opp.relevance));
  }
  if (head.childNodes.length) card.appendChild(head);

  const title = document.createElement("h3");
  title.className = "opp-card__title";
  title.textContent = opp.title;
  card.appendChild(title);

  if (variant === "light") {
    if (opp.summary) {
      const summary = document.createElement("p");
      summary.className = "opp-card__summary";
      summary.textContent = opp.summary;
      card.appendChild(summary);
    }
    if (opp.expected_effect) {
      const effect = document.createElement("p");
      effect.className = "opp-card__effect";
      const label = document.createElement("strong");
      label.textContent = "期待効果: ";
      effect.appendChild(label);
      effect.append(opp.expected_effect);
      card.appendChild(effect);
    }
    return card;
  }

  if (variant === "deep") {
    const blocks = [
      ["Why Now", opp.why_now],
      ["なぜ御社なのか", opp.why_company],
      ["市場変化", opp.market_change],
    ];
    blocks.forEach(([label, text]) => {
      if (!text) return;
      const section = document.createElement("section");
      section.className = "opp-card__block";
      const h = document.createElement("h4");
      h.textContent = label;
      section.appendChild(h);
      const p = document.createElement("p");
      p.textContent = text;
      section.appendChild(p);
      card.appendChild(section);
    });

    if (Array.isArray(opp.evidence) && opp.evidence.length) {
      const section = document.createElement("section");
      section.className = "opp-card__block";
      const h = document.createElement("h4");
      h.textContent = "根拠";
      section.appendChild(h);
      const list = document.createElement("ul");
      list.className = "evidence-list";
      opp.evidence.forEach((ev) => list.appendChild(createEvidenceItem(ev)));
      section.appendChild(list);
      card.appendChild(section);
    }

    if (opp.first_action) {
      const action = document.createElement("div");
      action.className = "opp-card__action";
      const label = document.createElement("span");
      label.className = "opp-card__action-label";
      label.textContent = "最初の一歩";
      action.appendChild(label);
      const text = document.createElement("p");
      text.textContent = opp.first_action;
      action.appendChild(text);
      card.appendChild(action);
    }
  }

  return card;
}

/* ==================== その他の共通コンポーネント ==================== */

/**
 * フッター等で使う「リンク＋任意の補足テキスト」の1行を生成する。
 * @param {string} text - リンクテキスト
 * @param {string} href - リンク先
 * @param {string} [note] - リンクの後に添える補足テキスト（任意）
 * @returns {HTMLSpanElement}
 */
function linkRow(text, href, note) {
  const span = document.createElement("span");
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  span.appendChild(a);
  if (note) span.append(" " + note);
  return span;
}

/* ==================== 日付フォーマット（共通Util） ==================== */

/**
 * ISO 8601形式の日時文字列を "2026年8月1日" のような日本語表記に変換する。
 * @param {string} isoString - ISO 8601形式の日時文字列
 * @returns {string} 日本語表記の日付。変換できない場合は入力をそのまま返す。
 */
function formatDate(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  } catch (e) {
    return isoString;
  }
}

/* ==================== mailto導線（人的対応への誘導。決済は実装しない） ==================== */

/**
 * mailto: リンクのURLを組み立てる（件名・本文をエンコード済み）。
 * @param {string} subject - メール件名
 * @param {string} [body] - メール本文（任意）
 * @returns {string} mailto: URL
 */
function mailtoLink(subject, body) {
  return `mailto:${OPERATOR_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body || "")}`;
}
