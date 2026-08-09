/*
 * AOR Phase5.1 - report-preview.html（無料版）
 * 仕様: docs/mockups_v2/02_report_preview.md / docs/strategy_v2/07_free_report.md
 * データ: docs/mock_data (schema_version 2.4) 準拠の固定JSON。API連携なし。
 * 使用フィールド: company_profile, human_review, free_opportunity, locked_opportunities, source_pages
 * free_opportunity.evidence は {source_id, quote} のみを保持するため、
 * source_pages と resolveEvidence() で結合してから描画する（common.js参照）。
 */

const STATE_IDS = ["state-loading", "state-error", "page"];

document.addEventListener("DOMContentLoaded", init);

/**
 * エントリポイント。?company= を読み取り、データ取得→描画、またはエラー表示を行う。
 * @returns {Promise<void>}
 */
async function init() {
  const slug = getCompanyParam();

  if (!slug) {
    showError(
      document.getElementById("state-error-content"),
      "対象データが見つかりません。",
      "URLに ?company=<会社ID> を指定してアクセスしてください。"
    );
    showState("state-error", STATE_IDS);
    return;
  }

  try {
    const data = await fetchCompanyData(slug);
    render(data, slug);
    showState("page", STATE_IDS);
  } catch (err) {
    console.error("[AOR] レポートデータの読み込みに失敗しました:", err);
    showError(
      document.getElementById("state-error-content"),
      "レポートを読み込めませんでした。",
      "ブラウザのセキュリティ制限により、file:// で直接開いた場合はデータ（JSON）の読み込みがブロックされることがあります。簡易サーバーを起動してからアクセスしてください（例: python -m http.server）。"
    );
    showState("state-error", STATE_IDS);
  }
}

/**
 * 画面全体を描画する。
 * @param {Object} data - 会社データ（docs/mock_data スキーマ準拠）
 * @param {string} slug - 会社スラッグ（CTAのリンク先組み立てに使用）
 */
function render(data, slug) {
  const sourceMap = getSourceMap(data.source_pages);
  renderHeader(data);
  renderSourcePages(data.source_pages);
  renderMainOpportunity(data.free_opportunity, sourceMap);
  renderLockedThemes(data.locked_opportunities);
  wireCtas(slug);
  renderFooter();
}

/* ---------- ヘッダー帯 ---------- */

/** @param {Object} data - 会社データ */
function renderHeader(data) {
  const el = document.getElementById("report-header");
  el.innerHTML = "";

  const eyebrow = document.createElement("p");
  eyebrow.className = "report-header__eyebrow";
  eyebrow.textContent = "AI Opportunity Report（無料版）";
  el.appendChild(eyebrow);

  const company = document.createElement("h1");
  company.className = "report-header__company";
  company.textContent = `${data.company_profile.name} 様 向けレポート`;
  el.appendChild(company);

  const generated = document.createElement("p");
  generated.className = "report-header__generated";
  generated.textContent = `生成日: ${formatDate(data.meta && data.meta.generated_at)}`;
  el.appendChild(generated);

  const industry = document.createElement("p");
  industry.className = "report-header__summary";
  industry.append(data.company_profile.industry_label);
  if (data.company_profile.industry_is_ai_estimated) {
    industry.appendChild(createBadge("AI推定", "badge-estimated"));
  }
  el.appendChild(industry);

  if (data.company_profile.business_summary) {
    const summary = document.createElement("p");
    summary.className = "report-header__summary";
    summary.textContent = data.company_profile.business_summary;
    el.appendChild(summary);
  }

  el.appendChild(renderReviewStatus(data.human_review));
  el.appendChild(renderCorrectionLink());
}

/**
 * 人間確認済み表示を生成する。approved以外はすべて「レビュー中」として扱う。
 * @param {Object} humanReview - data.human_review
 * @returns {HTMLParagraphElement}
 */
function renderReviewStatus(humanReview) {
  const p = document.createElement("p");
  const approved = humanReview && humanReview.status === "approved";
  p.className = "review-status " + (approved ? "review-status--approved" : "review-status--pending");
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = approved ? "✓" : "⚠";
  const text = document.createElement("span");
  text.textContent = approved ? "人間による確認済み" : "レビュー中";
  p.append(icon, " ", text);
  return p;
}

/** @returns {HTMLParagraphElement} 会社情報の訂正依頼導線（mailto） */
function renderCorrectionLink() {
  const p = document.createElement("p");
  p.className = "report-header__correction";
  const a = document.createElement("a");
  a.href = mailtoLink("レポート内容の訂正について");
  a.textContent = "情報が異なる場合はこちら";
  p.appendChild(a);
  return p;
}

/* ---------- 参照元の開示 ---------- */

/** @param {Array<Object>} sourcePages - data.source_pages */
function renderSourcePages(sourcePages) {
  const el = document.getElementById("source-pages");
  el.innerHTML = "";

  const title = document.createElement("p");
  title.className = "source-pages__title";
  title.textContent = "この分析は、貴社の公開ページに加え、以下の情報源を参照して作成しました";
  el.appendChild(title);

  const list = document.createElement("ul");
  list.className = "source-pages__list";
  (sourcePages || []).forEach((sp) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = sp.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = sp.label || sp.url;
    li.appendChild(a);
    list.appendChild(li);
  });
  el.appendChild(list);
}

/* ---------- 無料版Opportunity（1件のみ） ---------- */

/**
 * 無料版Opportunity（1件）を描画する。evidenceはsource_idのみを持つため、
 * sourceMapで結合してからカードに渡す。
 * @param {Object} freeOpportunity - data.free_opportunity
 * @param {Map<string, Object>} sourceMap - getSourceMap(data.source_pages) の結果
 */
function renderMainOpportunity(freeOpportunity, sourceMap) {
  const el = document.getElementById("main-opportunity-card");
  el.innerHTML = "";
  if (!freeOpportunity) return;

  const resolved = Object.assign({}, freeOpportunity, {
    evidence: (freeOpportunity.evidence || []).map((ev) => resolveEvidence(ev, sourceMap)),
  });

  el.appendChild(createOpportunityCard(resolved, { variant: "deep" }));
}

/* ---------- さらに検討可能なテーマ（タイトルのみ） ---------- */

/** @param {Array<{id: string, title: string}>} lockedOpportunities - data.locked_opportunities */
function renderLockedThemes(lockedOpportunities) {
  const el = document.getElementById("locked-themes");
  el.innerHTML = "";
  const items = lockedOpportunities || [];
  if (!items.length) return;

  const panel = document.createElement("div");
  panel.className = "locked-panel";

  const title = document.createElement("p");
  title.className = "locked-panel__title";
  title.textContent = `ほか${items.length}件のOpportunityがあります`;
  panel.appendChild(title);

  const lede = document.createElement("p");
  lede.className = "locked-panel__lede";
  lede.textContent = "詳細分析版で確認できます。";
  panel.appendChild(lede);

  const cards = document.createElement("div");
  cards.className = "cards";
  items.forEach((opp) => {
    cards.appendChild(createOpportunityCard(opp, { variant: "locked" }));
  });
  panel.appendChild(cards);

  el.appendChild(panel);
}

/* ---------- フッター ---------- */

function renderFooter() {
  const el = document.getElementById("report-footer");
  el.innerHTML = "";

  const rows = [
    "AI Opportunity Report 運営事務局",
    linkRow("このレポートについて詳しく知る", "#", "（サービスLPは本パスでは未実装のためプレースホルダーです）"),
    linkRow("配信停止はこちら", mailtoLink("配信停止のご連絡", "配信停止を希望します。\n")),
  ];

  rows.forEach((content) => {
    const p = document.createElement("p");
    p.className = "report-footer__row";
    if (typeof content === "string") {
      p.textContent = content;
    } else {
      p.appendChild(content);
    }
    el.appendChild(p);
  });
}

/* ---------- CTA ---------- */

/**
 * CTAリンクのhrefを email-capture.html?company=<slug>[&lead=<lead_id>&token=<report_token>]
 * に設定する。lead/tokenはPJ2 Phase3前段: このページ自身のURLに ?lead=/?token= が
 * 付与されている場合（Phase3のメールリンク経由でのアクセス）のみ、そのままemail-capture.html
 * へ引き継ぐ（値の検証・利用はこのページでは行わない、単純な素通し）。
 * どちらも付与されていない場合は company=<slug> のみの既存URL形式のままとなり、
 * 既存のデモ閲覧・直接アクセス経路は変更しない。
 * @param {string} slug - 会社スラッグ
 */
function wireCtas(slug) {
  const params = new URLSearchParams();
  params.set("company", slug);
  const leadId = getLeadParam();
  const reportToken = getReportTokenParam();
  if (leadId) params.set("lead", leadId);
  if (reportToken) params.set("token", reportToken);

  const target = `email-capture.html?${params.toString()}`;
  document.querySelectorAll("[data-cta]").forEach((el) => {
    el.setAttribute("href", target);
  });
}
