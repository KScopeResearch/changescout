/*
 * AOR Phase5.1 - paid-preview.html（有料版）
 * 仕様: docs/mockups_v2/04_paid_report.md / docs/strategy_v2/08_paid_report.md
 * 使用フィールド: paid_analysis.decision_summary / additional_opportunities /
 *   priority_matrix（opportunity_ids方式。additional_opportunitiesからMapを構築して解決する） /
 *   roadmap / execution_support / monitoring
 * 旧paid_preview_opportunity・旧opportunities_open/locked・priority_matrix.items[]は一切参照しない。
 * API・決済連携なし。CTAはすべて人的対応（mailto）への導線。
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
    if (!data.paid_analysis) throw new Error("paid_analysis がデータに含まれていません");
    render(data);
    showState("page", STATE_IDS);
  } catch (err) {
    console.error("[AOR] 有料版データの読み込みに失敗しました:", err);
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
 */
function render(data) {
  const opportunityMap = getOpportunityMap(data.paid_analysis.additional_opportunities);

  renderHeader(data);
  renderDecisionSummary(data.paid_analysis.decision_summary);
  renderAdditionalOpportunities(data.paid_analysis.additional_opportunities);
  renderPriorityMatrix(data.paid_analysis.priority_matrix, opportunityMap);
  renderRoadmap(data.paid_analysis.roadmap);
  renderExecutionSupport(data.paid_analysis.execution_support);
  renderMonitoring(data.paid_analysis.monitoring);
  wireCtas(data);
  renderFooter();
}

/* ---------- ヘッダー ---------- */

/** @param {Object} data - 会社データ */
function renderHeader(data) {
  const el = document.getElementById("report-header");
  el.innerHTML = "";

  const eyebrow = document.createElement("p");
  eyebrow.className = "report-header__eyebrow";
  eyebrow.textContent = "AI Opportunity Report（詳細版）";
  el.appendChild(eyebrow);

  const company = document.createElement("h1");
  company.className = "report-header__company";
  company.textContent = `${data.company_profile.name} 様 向け 詳細レポート`;
  el.appendChild(company);

  const generated = document.createElement("p");
  generated.className = "report-header__generated";
  generated.textContent = `更新日時: ${formatDate(data.meta && data.meta.generated_at)}`;
  el.appendChild(generated);
}

/* ---------- 意思決定サマリー（最上部・最重要） ---------- */

/** @param {Object} summary - paid_analysis.decision_summary */
function renderDecisionSummary(summary) {
  const el = document.getElementById("decision-summary");
  el.innerHTML = "";
  if (!summary) return;

  const box = document.createElement("div");
  box.className = "decision-summary";

  const eyebrow = document.createElement("p");
  eyebrow.className = "decision-summary__eyebrow";
  eyebrow.textContent = "意思決定サマリー";
  box.appendChild(eyebrow);

  if (summary.recommendation) {
    const rec = document.createElement("p");
    rec.className = "decision-summary__recommendation";
    rec.textContent = summary.recommendation;
    box.appendChild(rec);
  }

  const meta = document.createElement("div");
  meta.className = "decision-summary__meta";
  [
    ["推奨時期", summary.recommended_timing],
    ["期待効果", summary.expected_impact],
    ["投資規模", summary.investment_level],
  ].forEach(([label, value]) => {
    if (!value) return;
    const item = document.createElement("div");
    item.className = "decision-summary__meta-item";
    const l = document.createElement("span");
    l.className = "decision-summary__meta-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "decision-summary__meta-value";
    v.textContent = value;
    item.append(l, v);
    meta.appendChild(item);
  });
  box.appendChild(meta);

  if (Array.isArray(summary.reason) && summary.reason.length) {
    const list = document.createElement("ul");
    list.className = "decision-summary__reasons";
    summary.reason.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  el.appendChild(box);
}

/* ---------- 追加Opportunity一覧 ---------- */

/** @param {Array<Object>} items - paid_analysis.additional_opportunities */
function renderAdditionalOpportunities(items) {
  const listEl = document.getElementById("additional-opportunities-list");
  listEl.innerHTML = "";
  (items || []).forEach((opp) => {
    listEl.appendChild(createOpportunityCard(opp, { variant: "light" }));
  });
}

/* ---------- 優先順位マトリクス ---------- */

/**
 * 優先順位マトリクスを描画する。各象限は opportunity_ids（id配列）のみを持つため、
 * opportunityMap で解決してからタイトル・期待効果を表示する（idの再検索は行わない）。
 * @param {Object} matrix - paid_analysis.priority_matrix
 * @param {Map<string, Object>} opportunityMap - getOpportunityMap() の結果
 */
function renderPriorityMatrix(matrix, opportunityMap) {
  const el = document.getElementById("priority-matrix-grid");
  el.innerHTML = "";
  if (!matrix || !matrix.quadrants) return;

  const order = [
    ["high_impact_low_effort", "matrix__quadrant--high-low"],
    ["high_impact_high_effort", "matrix__quadrant--high-high"],
    ["low_impact_low_effort", "matrix__quadrant--low-low"],
    ["low_impact_high_effort", "matrix__quadrant--low-high"],
  ];

  order.forEach(([key, cls]) => {
    const quadrant = matrix.quadrants[key];
    if (!quadrant) return;

    const cell = document.createElement("div");
    cell.className = "matrix__quadrant " + cls;

    const label = document.createElement("p");
    label.className = "matrix__label";
    label.textContent = quadrant.label || key;
    cell.appendChild(label);

    const ids = quadrant.opportunity_ids || [];
    const opportunities = ids.map((id) => opportunityMap.get(id)).filter(Boolean);

    if (!opportunities.length) {
      const empty = document.createElement("p");
      empty.className = "matrix__empty";
      empty.textContent = "該当なし";
      cell.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "matrix__items";
      opportunities.forEach((opp) => {
        const li = document.createElement("li");
        li.className = "matrix__item";
        const title = document.createElement("span");
        title.className = "matrix__item-title";
        title.textContent = opp.title;
        li.appendChild(title);
        if (opp.expected_effect) {
          const effect = document.createElement("span");
          effect.className = "matrix__item-effect";
          effect.textContent = opp.expected_effect;
          li.appendChild(effect);
        }
        list.appendChild(li);
      });
      cell.appendChild(list);
    }

    el.appendChild(cell);
  });
}

/* ---------- 90日ロードマップ（横タイムライン） ---------- */

/** @param {Object} roadmap - paid_analysis.roadmap */
function renderRoadmap(roadmap) {
  const el = document.getElementById("roadmap-timeline");
  el.innerHTML = "";
  if (!roadmap) return;

  const blocks = [
    ["day_30", "Day 30"],
    ["day_60", "Day 60"],
    ["day_90", "Day 90"],
  ];

  blocks.forEach(([key, label]) => {
    const block = roadmap[key];
    if (!block) return;

    const el2 = document.createElement("div");
    el2.className = "timeline__block";

    const day = document.createElement("span");
    day.className = "timeline__day";
    day.textContent = label;
    el2.appendChild(day);

    if (Array.isArray(block.actions) && block.actions.length) {
      const list = document.createElement("ul");
      list.className = "timeline__actions";
      block.actions.forEach((a) => {
        const li = document.createElement("li");
        li.textContent = a;
        list.appendChild(li);
      });
      el2.appendChild(list);
    }

    if (block.expected_outcome) {
      const outcome = document.createElement("p");
      outcome.className = "timeline__outcome";
      outcome.textContent = block.expected_outcome;
      el2.appendChild(outcome);
    }

    el.appendChild(el2);
  });
}

/* ---------- 実行支援メニュー ---------- */

/** @param {Array<{label: string, description: string}>} items - paid_analysis.execution_support */
function renderExecutionSupport(items) {
  const el = document.getElementById("execution-support-list");
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const card = document.createElement("div");
    card.className = "support-card";
    const title = document.createElement("p");
    title.className = "support-card__title";
    title.textContent = item.label;
    card.appendChild(title);
    if (item.description) {
      const desc = document.createElement("p");
      desc.className = "support-card__desc";
      desc.textContent = item.description;
      card.appendChild(desc);
    }
    el.appendChild(card);
  });
}

/* ---------- 継続監視テーマ ---------- */

/** @param {Array<{theme: string, description: string}>} items - paid_analysis.monitoring */
function renderMonitoring(items) {
  const el = document.getElementById("monitoring-list");
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.className = "monitor-item";
    const theme = document.createElement("span");
    theme.className = "monitor-item__theme";
    theme.textContent = item.theme;
    const desc = document.createElement("span");
    desc.className = "monitor-item__desc";
    desc.textContent = item.description || "";
    li.append(theme, desc);
    el.appendChild(li);
  });
}

/* ---------- フッター ---------- */

function renderFooter() {
  const el = document.getElementById("report-footer");
  el.innerHTML = "";
  const rows = [
    "AI Opportunity Report 運営事務局",
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

/* ---------- CTA（人的対応への誘導。決済は実装しない） ---------- */

/**
 * 有料プラン申込み・相談CTAのmailtoリンクを組み立てる。
 * @param {Object} data - 会社データ（company_profile.nameを本文に差し込む）
 */
function wireCtas(data) {
  const companyName = data.company_profile.name;

  document.getElementById("upgrade-cta").setAttribute(
    "href",
    mailtoLink(
      "有料プラン申し込み希望",
      `${companyName} 様\n\nAI Opportunity Reportの有料プラン（Standard）の申し込みを希望します。\n\n（ご希望のプラン・部署名などご記入ください）\n`
    )
  );

  document.getElementById("consult-cta").setAttribute(
    "href",
    mailtoLink(
      "ご相談",
      `${companyName} 様\n\nAI Opportunity Reportの詳細レポートを拝見し、ご相談したく連絡いたしました。\n\n（ご相談内容をご記入ください）\n`
    )
  );
}
