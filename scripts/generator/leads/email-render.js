/*
 * email-render.js — Phase55 STEP4
 *
 * report-teaser.js の teaser view model から、Initial / Weekly の AOR メール
 * （subject / preheader / text / html）を組み立てる。
 *
 * 【方針】
 *  - published JSON から派生した teaser の値だけを使う。LLM/API を呼ばない・数字を作らない。
 *  - メールで全文を見せない（"入口"）。詳細は reportUrl（既存の Preview URL）へ。
 *  - HTML は email-safe: table レイアウト / inline style / 外部画像なし / SVG なし
 *    （Outlook の Word エンジンでも崩れにくい構成）。
 *  - reportUrl / unsubscribe は呼び出し側から受け取り、本モジュールでは生成しない。
 */
"use strict";

// blastengine-client.js の escapeHtml と同等（依存を持ち込まず self-contained に）
function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// テーマごとのアクセント色（Preview の Visual Theme と対応。SVG は使わず色だけ引き継ぐ）
var THEME_ACCENT = {
  ai_dx: "#2f5fa8",
  new_business: "#1f7a4d",
  overseas: "#0d6b8a",
  subsidy_policy: "#8a5a1f",
  hr: "#6a3fa0",
  restaurant: "#b5482f",
  retail: "#1f7a4d",
  manufacturing: "#555b66",
  saas: "#2f5fa8",
  marketing: "#a03f7a",
  content_media: "#4c3fa0",
  generic_insight: "#2f5fa8",
};

function accentFor(theme) {
  return THEME_ACCENT[theme] || THEME_ACCENT.generic_insight;
}

/* ---------- text 版（プレーンテキスト） ---------- */

function renderText(t, opts) {
  var o = opts || {};
  var kind = o.kind || "initial";
  const greet = t.hasCompanyName ? t.companyName + " 様" : "ご担当者様";
  const lines = [greet, ""];

  if (kind === "weekly") {
    lines.push("御社向けの市場機会レポートを、最新の内容に更新しました。");
  } else {
    lines.push(
      "御社の公開情報と市場データをもとに、今回特に注目したい市場機会を1件に絞って整理しました。"
    );
  }
  lines.push("");

  if (t.hasOpportunity) {
    lines.push("― 今回の機会 ―");
    lines.push(t.opportunityTitle);
    lines.push("");
    if (t.whyNow) {
      lines.push("【なぜ今か】");
      lines.push(t.whyNow);
      lines.push("");
    }
    if (t.whyCompany) {
      lines.push("【なぜ御社か】");
      lines.push(t.whyCompany);
      lines.push("");
    }
    if (t.marketStats && t.marketStats.length) {
      lines.push("【市場の動き】");
      t.marketStats.forEach(function (s) {
        lines.push("  " + s.value + (s.label ? "（" + s.label + "）" : ""));
      });
      lines.push("");
    }
  } else {
    lines.push("今回の市場分析で確認できた主なポイントを、レポートに整理しています。");
    lines.push("");
  }

  lines.push("このレポートでは、以下まで整理しています。");
  lines.push("  ・なぜ今この機会なのか");
  lines.push("  ・なぜ御社に関係するのか");
  lines.push("  ・市場で何が起きているのか");
  lines.push("  ・まず何を確認すべきか");
  lines.push("");
  lines.push("▼ " + (kind === "weekly" ? "更新版レポートを見る" : "このOpportunityの詳細を見る"));
  lines.push(t.reportUrl);
  lines.push("");
  if (t.reviewApproved) lines.push("※ " + t.reviewLine);
  lines.push("");
  lines.push("―――――――――――");
  if (o.unsubscribeUrl) {
    lines.push("配信停止をご希望の場合は、次のリンクから手続きいただけます:");
    lines.push(o.unsubscribeUrl);
    lines.push("（本メールへの直接のご返信でも承ります。）");
  } else {
    lines.push("配信停止をご希望の場合は、本メールに直接ご返信ください。");
  }
  lines.push("");
  lines.push("AI Opportunity Report 運営事務局");
  return lines.join("\n");
}

/* ---------- HTML 版（email-safe） ---------- */

function statCellsHtml(stats, accent) {
  if (!stats || !stats.length) return "";
  var cells = stats
    .map(function (s) {
      return (
        '<td style="padding:6px 10px 6px 0;vertical-align:top;">' +
        '<div style="font-size:18px;font-weight:700;color:' +
        accent +
        ';line-height:1.2;">' +
        esc(s.value) +
        "</div>" +
        (s.label
          ? '<div style="font-size:11px;color:#5b6472;">' + esc(s.label) + "</div>"
          : "") +
        "</td>"
      );
    })
    .join("");
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 4px;"><tr>' +
    cells +
    "</tr></table>"
  );
}

function renderHtml(t, opts) {
  var o = opts || {};
  var kind = o.kind || "initial";
  var accent = accentFor(t.theme);
  var greet = t.hasCompanyName ? esc(t.companyName) + " 様" : "ご担当者様";
  var intro =
    kind === "weekly"
      ? "御社向けの市場機会レポートを、最新の内容に更新しました。"
      : "御社の公開情報と市場データをもとに、今回特に注目したい市場機会を1件に絞って整理しました。";
  var ctaLabel = kind === "weekly" ? "更新版レポートを見る" : "このOpportunityの詳細を見る";

  var oppBlock = "";
  if (t.hasOpportunity) {
    oppBlock =
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
      'style="border:1px solid #e1e6ee;border-left:4px solid ' +
      accent +
      ';border-radius:8px;margin:16px 0;">' +
      '<tr><td style="padding:16px 18px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;color:' +
      accent +
      ';">今回の機会</div>' +
      '<div style="font-size:17px;font-weight:800;color:#1f2430;line-height:1.5;margin:6px 0 4px;">' +
      esc(t.opportunityTitle) +
      "</div>" +
      (t.whyNow
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">なぜ今か</div>' +
          '<div style="font-size:13px;line-height:1.8;color:#1f2430;">' +
          esc(t.whyNow) +
          "</div>"
        : "") +
      (t.whyCompany
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">なぜ御社か</div>' +
          '<div style="font-size:13px;line-height:1.8;color:#1f2430;">' +
          esc(t.whyCompany) +
          "</div>"
        : "") +
      (t.marketStats && t.marketStats.length
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">市場の動き</div>' +
          statCellsHtml(t.marketStats, accent)
        : "") +
      "</td></tr></table>";
  } else {
    oppBlock =
      '<p style="font-size:13px;line-height:1.8;color:#1f2430;">今回の市場分析で確認できた主なポイントを、レポートに整理しています。</p>';
  }

  var button =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto;"><tr>' +
    '<td align="center" bgcolor="' +
    accent +
    '" style="border-radius:8px;">' +
    '<a href="' +
    esc(t.reportUrl) +
    '" target="_blank" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:700;' +
    'color:#ffffff;text-decoration:none;border-radius:8px;background:' +
    accent +
    ';">' +
    esc(ctaLabel) +
    " ›</a></td></tr></table>";

  var unsubHtml = o.unsubscribeUrl
    ? '配信停止をご希望の場合は<a href="' +
      esc(o.unsubscribeUrl) +
      '" style="color:#5b6472;">こちら</a>から手続きいただけます（本メールへの直接のご返信でも承ります）。'
    : "配信停止をご希望の場合は、本メールに直接ご返信ください。";

  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fb;">' +
    '<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">' +
    esc(o.preheader || "") +
    "</span>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f7fb;">' +
    '<tr><td align="center" style="padding:20px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ' +
    'style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e1e6ee;border-radius:10px;' +
    'font-family:-apple-system,BlinkMacSystemFont,\'Hiragino Sans\',\'Yu Gothic\',\'Segoe UI\',sans-serif;">' +
    '<tr><td style="padding:24px 22px;">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:' +
    accent +
    ';">御社向け 市場機会レポート</div>' +
    '<p style="font-size:15px;font-weight:700;color:#1f2430;margin:10px 0 6px;">' +
    greet +
    "</p>" +
    '<p style="font-size:13px;line-height:1.8;color:#1f2430;margin:0;">' +
    intro +
    "</p>" +
    oppBlock +
    '<p style="font-size:12px;line-height:1.8;color:#5b6472;margin:14px 0 4px;">このレポートでは、' +
    "<br>・なぜ今この機会なのか<br>・なぜ御社に関係するのか<br>・市場で何が起きているのか<br>・まず何を確認すべきか<br>" +
    "まで整理しています。</p>" +
    '<div style="text-align:center;margin:18px 0 8px;">' +
    button +
    "</div>" +
    (t.reviewApproved
      ? '<p style="font-size:11px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;' +
        'border-radius:6px;padding:8px 10px;margin:12px 0 0;">✓ ' +
        esc(t.reviewLine) +
        "</p>"
      : "") +
    '<hr style="border:none;border-top:1px solid #e1e6ee;margin:18px 0 12px;">' +
    '<p style="font-size:11px;line-height:1.7;color:#5b6472;margin:0;">' +
    unsubHtml +
    "</p>" +
    '<p style="font-size:11px;color:#5b6472;margin:8px 0 0;">AI Opportunity Report 運営事務局</p>' +
    "</td></tr></table>" +
    "</td></tr></table></body></html>"
  );
}

/* ---------- public ---------- */

const teaserMod = require("../shared/report-teaser");

function renderInitialReportEmail(teaser, opts) {
  const o = opts || {};
  return {
    subject: teaserMod.subject(teaser, { kind: "initial" }),
    preheader: teaserMod.preheader(teaser),
    text: renderText(teaser, { kind: "initial", unsubscribeUrl: o.unsubscribeUrl }),
    html: renderHtml(teaser, {
      kind: "initial",
      unsubscribeUrl: o.unsubscribeUrl,
      preheader: teaserMod.preheader(teaser),
    }),
  };
}

function renderWeeklyReportEmail(teaser, opts) {
  const o = opts || {};
  const pre = "前回から内容を見直し、御社向けの市場機会を最新化しました。";
  return {
    subject: teaserMod.subject(teaser, { kind: "weekly" }),
    preheader: pre,
    text: renderText(teaser, { kind: "weekly", unsubscribeUrl: o.unsubscribeUrl }),
    html: renderHtml(teaser, { kind: "weekly", unsubscribeUrl: o.unsubscribeUrl, preheader: pre }),
  };
}

module.exports = { renderInitialReportEmail, renderWeeklyReportEmail, accentFor, esc };
