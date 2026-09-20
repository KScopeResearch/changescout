/*
 * email-render.js — Phase56 STEP2（Business Chance メール V3）
 *
 * report-teaser.js の teaser view model から、Initial / Weekly の AOR メール
 * （subject / preheader / text / html）を組み立てる。
 *
 * 【方針】
 *  - published JSON から派生した teaser の値だけを使う。LLM/API を呼ばない・数字を作らない。
 *  - メールは "LP 入口"。無料であること・登録不要であることを明記し、詳細は reportUrl へ。
 *  - HTML は email-safe: table レイアウト / inline style / 外部画像なし / SVG なし。
 *  - reportUrl / unsubscribe は呼び出し側から受け取り、本モジュールでは生成しない。
 */
"use strict";

function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

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

function statLine(s) {
  var scope = s.worldOnly ? "参考データ: " : "";
  return "  " + scope + s.value + (s.label ? "（" + s.label + "）" : "");
}

/* ---------- text 版 ---------- */

function renderText(t, opts) {
  var o = opts || {};
  var kind = o.kind || "initial";
  var greet = t.salutation || (t.hasCompanyName ? t.companyName + " 経営者様" : "ご担当者様");
  var lines = [greet, ""];

  if (kind === "weekly") {
    lines.push("御社向けのビジネスチャンスレポートを、最新の内容に更新しました。");
  } else if (t.hasOpportunity) {
    lines.push(
      "御社について公開情報を分析した結果、次の新しいビジネスチャンスが見つかりました。"
    );
  } else {
    lines.push("御社について公開情報を分析し、レポートにまとめました。");
  }
  lines.push("");

  if (t.hasOpportunity) {
    lines.push("― 今回見つけたビジネスチャンス ―");
    lines.push(t.opportunityTitle);
    if (t.chanceSummary) {
      lines.push("");
      lines.push("一言でいうと: " + t.chanceSummary);
    }
    lines.push("");
    if (t.whyNow) {
      lines.push("【なぜ今なのか】");
      lines.push(t.whyNow);
      lines.push("");
    }
    if (t.whyCompany) {
      lines.push("【なぜ御社なのか】");
      lines.push(t.whyCompany);
      lines.push("");
    }
    if (t.marketStats && t.marketStats.length) {
      lines.push("【新しい市場の動き】");
      t.marketStats.forEach(function (s) {
        lines.push(statLine(s));
      });
      lines.push("");
    }
  }

  lines.push("今回のレポートでは");
  lines.push("  ・なぜ今なのか");
  lines.push("  ・なぜ御社なのか");
  lines.push("  ・今日からできる一歩");
  lines.push("を5分で読める形で整理しています。");
  lines.push("");
  lines.push("無料で閲覧できます。");
  lines.push("");
  lines.push("▼ " + (kind === "weekly" ? "更新版レポートを見る" : "無料でレポートを見る"));
  lines.push(t.reportUrl);
  lines.push("");
  lines.push("※ このレポートは無料です。メールアドレス以外の登録は不要です。");
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
  lines.push("無料ビジネスチャンスレポート 運営事務局");
  return lines.join("\n");
}

/* ---------- HTML 版（email-safe） ---------- */

function statCellsHtml(stats, accent) {
  if (!stats || !stats.length) return "";
  var cells = stats
    .map(function (s) {
      var scope = s.worldOnly
        ? '<div style="font-size:10px;color:#8a94a3;">参考データ</div>'
        : "";
      return (
        '<td style="padding:6px 10px 6px 0;vertical-align:top;">' +
        scope +
        '<div style="font-size:18px;font-weight:700;color:' +
        accent +
        ';line-height:1.2;">' +
        esc(s.value) +
        "</div>" +
        (s.label ? '<div style="font-size:11px;color:#5b6472;">' + esc(s.label) + "</div>" : "") +
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

// ---------- Phase71 STEP1: Premium Initial Email（HTML のみ・kind==="initial" 限定） ----------
// Constitution 準拠のトークン（preview-conversion.css の :root と同値。メールは CSS変数を
// 使えないため、email-safe な inline style としてリテラルで固定する）。
var AOR_NAVY = "#0b1c33";
var AOR_GOLD = "#c9a24b";
var AOR_EMERALD = "#059669";
var AOR_EMERALD_DARK = "#047857";
var AOR_BORDER = "#e7ecf3";
var AOR_GRAY_BG = "#f4f6f9";
var AOR_INK = "#1f2430";
var AOR_MUTED = "#5b6472";

function pmCard(kicker, body) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
    'style="background:#ffffff;border:1px solid ' +
    AOR_BORDER +
    ';border-radius:12px;"><tr><td style="padding:14px;">' +
    '<div style="font-size:10px;font-weight:800;letter-spacing:0.05em;color:' +
    AOR_GOLD +
    ';">' +
    kicker +
    "</div>" +
    '<div style="font-size:12px;color:' +
    AOR_INK +
    ';line-height:1.7;margin-top:6px;">' +
    body +
    "</div></td></tr></table>"
  );
}

function pmRow(cellsHtml, count) {
  var width = Math.floor(100 / count);
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
    cellsHtml
      .map(function (c, i) {
        var pad = i === 0 ? "0 6px 0 0" : i === count - 1 ? "0 0 0 6px" : "0 6px";
        return '<td width="' + width + '%" valign="top" style="padding:' + pad + ';">' + c + "</td>";
      })
      .join("") +
    "</tr></table>"
  );
}

function pmGoldButton(href, label) {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td bgcolor="' +
    AOR_GOLD +
    '" style="border-radius:8px;">' +
    '<a href="' +
    href +
    '" target="_blank" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:800;' +
    "color:" +
    AOR_NAVY +
    ';text-decoration:none;border-radius:8px;">' +
    label +
    " ›</a></td></tr></table>"
  );
}

function renderPremiumInitialHtml(t, o) {
  var greet = esc(t.salutation || (t.hasCompanyName ? t.companyName + " 経営者様" : "ご担当者様"));
  var reviewBadge = t.reviewApproved ? "専門家監修" : "運営がレビュー中";
  var ctaHref = esc(t.reportUrl);
  var reassure =
    '<p style="font-size:12px;line-height:1.7;color:' +
    AOR_MUTED +
    ';background:' +
    AOR_GRAY_BG +
    ';border-radius:6px;padding:10px 12px;margin:14px 0 0;">このレポートは無料です。<br>メールアドレス以外の登録は不要です。</p>';
  var unsubHtml = o.unsubscribeUrl
    ? '配信停止をご希望の場合は<a href="' +
      esc(o.unsubscribeUrl) +
      '" style="color:' +
      AOR_MUTED +
      ';">こちら</a>から手続きいただけます（本メールへの直接のご返信でも承ります）。'
    : "配信停止をご希望の場合は、本メールに直接ご返信ください。";

  var hero =
    '<tr><td bgcolor="' +
    AOR_NAVY +
    '" style="background:' +
    AOR_NAVY +
    ';padding:0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="height:4px;line-height:4px;font-size:0;background:' +
    AOR_GOLD +
    ';">&nbsp;</td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:32px 28px 28px;">' +
    '<div style="font-size:13px;font-weight:800;letter-spacing:0.16em;color:' +
    AOR_GOLD +
    ';">AOR</div>' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#ffffff;opacity:0.85;margin-top:2px;">BUSINESS OPPORTUNITY REPORT</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr>' +
    '<td style="padding:4px 10px;border:1px solid rgba(201,162,75,0.5);border-radius:20px;font-size:10px;font-weight:700;color:' +
    AOR_GOLD +
    ';">FREE EDITION</td><td style="width:8px;font-size:0;">&nbsp;</td>' +
    '<td style="padding:4px 10px;border:1px solid rgba(255,255,255,0.25);border-radius:20px;font-size:10px;font-weight:700;color:#ffffff;">CONFIDENTIAL</td><td style="width:8px;font-size:0;">&nbsp;</td>' +
    '<td bgcolor="#0d3b2e" style="padding:4px 10px;background:rgba(5,150,105,0.18);border-radius:20px;font-size:10px;font-weight:700;color:#34d399;">' +
    reviewBadge +
    "</td></tr></table>" +
    '<p style="font-size:13px;color:rgba(255,255,255,0.75);margin:22px 0 6px;">' +
    greet +
    "</p>" +
    (t.hasOpportunity
      ? '<p style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.5;margin:0 0 6px;">御社向けのビジネスチャンスがあります！</p>' +
        '<p style="font-size:19px;font-weight:800;color:' +
        AOR_GOLD +
        ';line-height:1.6;margin:0;">' +
        esc(t.opportunityTitle) +
        "</p>"
      : '<p style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.5;margin:0;">御社について公開情報を分析し、レポートにまとめました。</p>') +
    '<p style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.8;margin:16px 0 0;">公開情報をもとに専門家監修で整理した御社専用ビジネスチャンスレポートです。</p>' +
    '<div style="margin:22px 0 4px;">' +
    pmGoldButton(ctaHref, "無料でレポートを見る") +
    "</div>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="height:4px;line-height:4px;font-size:0;background:' +
    AOR_GOLD +
    ';">&nbsp;</td></tr></table>' +
    "</td></tr>";

  var execSummary = "";
  var dashboard = "";
  var highlight = "";
  var firstStepBlock = "";
  if (t.hasOpportunity) {
    var execCells = [];
    if (t.whyNow) execCells.push(pmCard("WHY NOW", esc(t.whyNow)));
    if (t.whyCompany) execCells.push(pmCard("WHY YOU", esc(t.whyCompany)));
    if (t.firstStep) execCells.push(pmCard("今日からできる一歩", esc(t.firstStep)));
    if (execCells.length) {
      execSummary =
        '<tr><td style="padding:26px 24px 4px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:0 0 12px;">EXECUTIVE SUMMARY</div>' +
        pmRow(execCells, execCells.length) +
        "</td></tr>";
    }

    var kpiCells = [];
    if (t.marketStats && t.marketStats.length) {
      var m0 = t.marketStats[0];
      kpiCells.push(
        pmCard(
          "市場の追い風" + (m0.worldOnly ? "（参考）" : ""),
          '<span style="font-size:16px;font-weight:800;color:' +
            AOR_NAVY +
            ';">' +
            esc(m0.value) +
            "</span>" +
            (m0.label ? '<div style="font-size:11px;color:' + AOR_MUTED + ';margin-top:2px;">' + esc(m0.label) + "</div>" : "")
        )
      );
    }
    if (t.expectedBenefit && t.expectedBenefit.length) {
      kpiCells.push(
        pmCard(
          "期待できる効果",
          '<span style="font-size:16px;font-weight:800;color:' + AOR_NAVY + ';">' + esc(t.expectedBenefit.join("・")) + "</span>"
        )
      );
    }
    if (kpiCells.length) {
      dashboard =
        '<tr><td style="padding:8px 24px 4px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:12px 0;">MARKET INTELLIGENCE</div>' +
        pmRow(kpiCells, kpiCells.length) +
        "</td></tr>";
    }

    highlight =
      '<tr><td style="padding:8px 24px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border:1px solid ' +
      AOR_BORDER +
      ";border-left:4px solid " +
      AOR_GOLD +
      ';border-radius:12px;"><tr><td style="padding:18px;">' +
      '<div style="font-size:10px;font-weight:800;letter-spacing:0.05em;color:' +
      AOR_GOLD +
      ';">今回見つけたビジネスチャンス</div>' +
      '<div style="font-size:17px;font-weight:800;color:' +
      AOR_NAVY +
      ';margin:8px 0 6px;line-height:1.5;">' +
      esc(t.opportunityTitle) +
      "</div>" +
      (t.chanceSummary
        ? '<div style="font-size:13px;font-weight:700;color:' +
          AOR_GOLD +
          ';">一言でいうと: ' +
          esc(t.chanceSummary) +
          "</div>"
        : "") +
      "</td></tr></table></td></tr>";

    if (t.firstStep) {
      firstStepBlock =
        '<tr><td style="padding:8px 24px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:12px 0;">FIRST STEP</div>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
        '<td width="30" valign="top">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td width="22" height="22" bgcolor="' +
        AOR_EMERALD +
        '" style="border-radius:11px;text-align:center;font-size:11px;font-weight:800;color:#ffffff;line-height:22px;">1</td>' +
        "</tr></table></td>" +
        '<td style="padding-left:10px;">' +
        '<span style="display:inline-block;padding:2px 8px;background:#ecfdf5;color:' +
        AOR_EMERALD_DARK +
        ';font-size:9px;font-weight:800;border-radius:10px;">TODAY</span>' +
        '<div style="font-size:13px;color:' +
        AOR_INK +
        ';line-height:1.7;margin-top:6px;">' +
        esc(t.firstStep) +
        "</div></td>" +
        "</tr></table></td></tr>";
    }
  }

  var trust =
    '<tr><td style="padding:18px 24px 4px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' +
    AOR_GRAY_BG +
    ';border-radius:12px;"><tr><td style="padding:14px 16px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
    ["メールアドレス登録だけで無料版を毎週配信", reviewBadge, "無料版を毎週配信", "配信はいつでも停止可"]
      .map(function (line) {
        return (
          '<tr><td style="padding:3px 0;font-size:11px;color:' +
          AOR_MUTED +
          ';">✓ ' +
          esc(line) +
          "</td></tr>"
        );
      })
      .join("") +
    "</table></td></tr></table></td></tr>";

  var bottomCta =
    '<tr><td align="center" style="padding:22px 24px 8px;">' +
    '<p style="font-size:14px;font-weight:800;color:' +
    AOR_NAVY +
    ';margin:0 0 6px;">無料版を毎週メールで受け取る</p>' +
    '<p style="font-size:11px;color:' +
    AOR_MUTED +
    ';margin:0 0 14px;">営業電話はいたしません。気になる企業だけ無料で継続配信します。</p>' +
    pmGoldButton(ctaHref, "無料でレポートを見る") +
    reassure +
    (t.reviewApproved
      ? '<p style="font-size:11px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;' +
        'border-radius:6px;padding:8px 10px;margin:10px 0 0;">✓ ' +
        esc(t.reviewLine) +
        "</p>"
      : "") +
    "</td></tr>";

  var footer =
    '<tr><td style="padding:20px 24px 26px;border-top:1px solid ' +
    AOR_BORDER +
    ';">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:' +
    AOR_NAVY +
    ';">AOR</div>' +
    '<div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:' +
    AOR_MUTED +
    ';margin-top:2px;">BUSINESS OPPORTUNITY REPORT</div>' +
    '<div style="font-size:10px;color:' +
    AOR_MUTED +
    ';margin-top:8px;">専門家監修・公開情報分析レポート</div>' +
    '<p style="font-size:11px;line-height:1.7;color:' +
    AOR_MUTED +
    ';margin:14px 0 0;">' +
    unsubHtml +
    "</p>" +
    '<p style="font-size:11px;color:' +
    AOR_MUTED +
    ';margin:8px 0 0;">無料ビジネスチャンスレポート 運営事務局</p>' +
    "</td></tr>";

  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:' +
    AOR_GRAY_BG +
    ';">' +
    '<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">' +
    esc(o.preheader || "") +
    "</span>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:' +
    AOR_GRAY_BG +
    ';"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" ' +
    'style="max-width:640px;width:100%;background:#ffffff;border:1px solid ' +
    AOR_BORDER +
    ';border-radius:16px;overflow:hidden;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic','Segoe UI',sans-serif;\">" +
    hero +
    execSummary +
    dashboard +
    highlight +
    firstStepBlock +
    trust +
    bottomCta +
    footer +
    "</table>" +
    "</td></tr></table></body></html>"
  );
}

// ---------- Phase71 STEP3: Premium Weekly Email（HTML のみ・kind==="weekly" 限定） ----------
// Initial（renderPremiumInitialHtml）と同じトークン・同じ pmCard/pmRow/pmGoldButton を再利用する。
// Weekly 固有の違いは「FREE EDITION / CONFIDENTIAL」→「WEEKLY UPDATE」、
// 「無料版を毎週メールで受け取る」→「毎週、新しいビジネスチャンスを確認する」等の文言のみ。
function renderPremiumWeeklyHtml(t, o) {
  var greet = esc(t.salutation || (t.hasCompanyName ? t.companyName + " 経営者様" : "ご担当者様"));
  var reviewBadge = t.reviewApproved ? "専門家監修" : "運営がレビュー中";
  var ctaHref = esc(t.reportUrl);
  var reassure =
    '<p style="font-size:12px;line-height:1.7;color:' +
    AOR_MUTED +
    ";background:" +
    AOR_GRAY_BG +
    ';border-radius:6px;padding:10px 12px;margin:14px 0 0;">このレポートは無料です。<br>メールアドレス以外の登録は不要です。</p>';
  var unsubHtml = o.unsubscribeUrl
    ? '配信停止をご希望の場合は<a href="' +
      esc(o.unsubscribeUrl) +
      '" style="color:' +
      AOR_MUTED +
      ';">こちら</a>から手続きいただけます（本メールへの直接のご返信でも承ります）。'
    : "配信停止をご希望の場合は、本メールに直接ご返信ください。";

  var hero =
    '<tr><td bgcolor="' +
    AOR_NAVY +
    '" style="background:' +
    AOR_NAVY +
    ';padding:0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="height:4px;line-height:4px;font-size:0;background:' +
    AOR_GOLD +
    ';">&nbsp;</td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:32px 28px 28px;">' +
    '<div style="font-size:13px;font-weight:800;letter-spacing:0.16em;color:' +
    AOR_GOLD +
    ';">AOR</div>' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#ffffff;opacity:0.85;margin-top:2px;">BUSINESS OPPORTUNITY REPORT</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr>' +
    '<td style="padding:4px 10px;border:1px solid rgba(201,162,75,0.5);border-radius:20px;font-size:10px;font-weight:700;color:' +
    AOR_GOLD +
    ';">WEEKLY UPDATE</td><td style="width:8px;font-size:0;">&nbsp;</td>' +
    '<td bgcolor="#0d3b2e" style="padding:4px 10px;background:rgba(5,150,105,0.18);border-radius:20px;font-size:10px;font-weight:700;color:#34d399;">' +
    reviewBadge +
    "</td></tr></table>" +
    '<p style="font-size:13px;color:rgba(255,255,255,0.75);margin:22px 0 6px;">' +
    greet +
    "</p>" +
    (t.hasOpportunity
      ? '<p style="font-size:22px;font-weight:800;color:#ffffff;line-height:1.5;margin:0 0 6px;">御社向けのビジネスチャンスがあります！</p>' +
        '<p style="font-size:19px;font-weight:800;color:' +
        AOR_GOLD +
        ';line-height:1.6;margin:0;">' +
        esc(t.opportunityTitle) +
        "</p>"
      : '<p style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.5;margin:0;">御社向けのビジネスチャンスレポートを、最新の内容に更新しました。</p>') +
    '<p style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.8;margin:16px 0 0;">公開情報をもとに専門家監修で整理し、最新の内容に更新した御社専用ビジネスチャンスレポートです。</p>' +
    '<div style="margin:22px 0 4px;">' +
    pmGoldButton(ctaHref, "レポートを見る") +
    "</div>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="height:4px;line-height:4px;font-size:0;background:' +
    AOR_GOLD +
    ';">&nbsp;</td></tr></table>' +
    "</td></tr>";

  var execSummary = "";
  var dashboard = "";
  var thisWeek = "";
  var firstStepBlock = "";
  if (t.hasOpportunity) {
    var execCells = [];
    if (t.whyNow) execCells.push(pmCard("WHY NOW", esc(t.whyNow)));
    if (t.whyCompany) execCells.push(pmCard("WHY YOU", esc(t.whyCompany)));
    if (t.firstStep) execCells.push(pmCard("今週のポイント", esc(t.firstStep)));
    if (execCells.length) {
      execSummary =
        '<tr><td style="padding:26px 24px 4px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:0 0 12px;">EXECUTIVE SUMMARY</div>' +
        pmRow(execCells, execCells.length) +
        "</td></tr>";
    }

    var kpiCells = [];
    if (t.marketStats && t.marketStats.length) {
      var m0 = t.marketStats[0];
      kpiCells.push(
        pmCard(
          "市場の追い風" + (m0.worldOnly ? "（参考）" : ""),
          '<span style="font-size:16px;font-weight:800;color:' +
            AOR_NAVY +
            ';">' +
            esc(m0.value) +
            "</span>" +
            (m0.label ? '<div style="font-size:11px;color:' + AOR_MUTED + ';margin-top:2px;">' + esc(m0.label) + "</div>" : "")
        )
      );
    }
    if (t.expectedBenefit && t.expectedBenefit.length) {
      kpiCells.push(
        pmCard(
          "期待できる効果",
          '<span style="font-size:16px;font-weight:800;color:' + AOR_NAVY + ';">' + esc(t.expectedBenefit.join("・")) + "</span>"
        )
      );
    }
    if (kpiCells.length) {
      dashboard =
        '<tr><td style="padding:8px 24px 4px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:12px 0;">MARKET INTELLIGENCE</div>' +
        pmRow(kpiCells, kpiCells.length) +
        "</td></tr>";
    }

    thisWeek =
      '<tr><td style="padding:8px 24px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="border:1px solid ' +
      AOR_BORDER +
      ";border-left:4px solid " +
      AOR_GOLD +
      ';border-radius:12px;"><tr><td style="padding:18px;">' +
      '<div style="font-size:10px;font-weight:800;letter-spacing:0.05em;color:' +
      AOR_GOLD +
      ';">THIS WEEK\'S OPPORTUNITY</div>' +
      '<div style="font-size:17px;font-weight:800;color:' +
      AOR_NAVY +
      ';margin:8px 0 6px;line-height:1.5;">' +
      esc(t.opportunityTitle) +
      "</div>" +
      (t.chanceSummary
        ? '<div style="font-size:13px;font-weight:700;color:' +
          AOR_GOLD +
          ';margin:0 0 8px;">一言でいうと: ' +
          esc(t.chanceSummary) +
          "</div>"
        : "") +
      (t.whyNow
        ? '<div style="font-size:11px;font-weight:800;color:' +
          AOR_NAVY +
          ';margin-top:10px;">WHY NOW</div>' +
          '<div style="font-size:12px;color:' +
          AOR_INK +
          ';line-height:1.7;">' +
          esc(t.whyNow) +
          "</div>"
        : "") +
      (t.whyCompany
        ? '<div style="font-size:11px;font-weight:800;color:' +
          AOR_NAVY +
          ';margin-top:10px;">WHY YOU</div>' +
          '<div style="font-size:12px;color:' +
          AOR_INK +
          ';line-height:1.7;">' +
          esc(t.whyCompany) +
          "</div>"
        : "") +
      "</td></tr></table></td></tr>";

    if (t.firstStep) {
      firstStepBlock =
        '<tr><td style="padding:8px 24px;">' +
        '<div style="font-size:11px;font-weight:800;letter-spacing:0.08em;color:' +
        AOR_NAVY +
        ';margin:12px 0;">FIRST STEP</div>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
        '<td width="30" valign="top">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td width="22" height="22" bgcolor="' +
        AOR_EMERALD +
        '" style="border-radius:11px;text-align:center;font-size:11px;font-weight:800;color:#ffffff;line-height:22px;">1</td>' +
        "</tr></table></td>" +
        '<td style="padding-left:10px;">' +
        '<span style="display:inline-block;padding:2px 8px;background:#ecfdf5;color:' +
        AOR_EMERALD_DARK +
        ';font-size:9px;font-weight:800;border-radius:10px;">TODAY</span>' +
        '<div style="font-size:13px;color:' +
        AOR_INK +
        ';line-height:1.7;margin-top:6px;">' +
        esc(t.firstStep) +
        "</div></td>" +
        "</tr></table></td></tr>";
    }
  }

  var trust =
    '<tr><td style="padding:18px 24px 4px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' +
    AOR_GRAY_BG +
    ';border-radius:12px;"><tr><td style="padding:14px 16px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
    ["メールアドレス登録だけで無料版を毎週配信", reviewBadge, "無料版を毎週配信", "配信はいつでも停止可"]
      .map(function (line) {
        return (
          '<tr><td style="padding:3px 0;font-size:11px;color:' +
          AOR_MUTED +
          ';">✓ ' +
          esc(line) +
          "</td></tr>"
        );
      })
      .join("") +
    "</table></td></tr></table></td></tr>";

  var bottomCta =
    '<tr><td align="center" style="padding:22px 24px 8px;">' +
    '<p style="font-size:14px;font-weight:800;color:' +
    AOR_NAVY +
    ';margin:0 0 6px;">毎週、新しいビジネスチャンスを確認する</p>' +
    reassure +
    '<div style="margin:14px 0 0;">' +
    pmGoldButton(ctaHref, "レポートを見る") +
    "</div>" +
    (t.reviewApproved
      ? '<p style="font-size:11px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;' +
        'border-radius:6px;padding:8px 10px;margin:10px 0 0;">✓ ' +
        esc(t.reviewLine) +
        "</p>"
      : "") +
    '<p style="font-size:11px;color:' +
    AOR_MUTED +
    ';margin:14px 0 0;">' +
    unsubHtml +
    "</p>" +
    "</td></tr>";

  var footer =
    '<tr><td style="padding:20px 24px 26px;border-top:1px solid ' +
    AOR_BORDER +
    ';">' +
    '<div style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:' +
    AOR_NAVY +
    ';">AOR</div>' +
    '<div style="font-size:9px;font-weight:700;letter-spacing:0.08em;color:' +
    AOR_MUTED +
    ';margin-top:2px;">BUSINESS OPPORTUNITY REPORT</div>' +
    '<div style="font-size:10px;color:' +
    AOR_MUTED +
    ';margin-top:8px;">専門家監修・公開情報分析レポート</div>' +
    '<p style="font-size:11px;color:' +
    AOR_MUTED +
    ';margin:8px 0 0;">無料ビジネスチャンスレポート 運営事務局</p>' +
    "</td></tr>";

  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:' +
    AOR_GRAY_BG +
    ';">' +
    '<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">' +
    esc(o.preheader || "") +
    "</span>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:' +
    AOR_GRAY_BG +
    ';"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" ' +
    'style="max-width:640px;width:100%;background:#ffffff;border:1px solid ' +
    AOR_BORDER +
    ';border-radius:16px;overflow:hidden;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic','Segoe UI',sans-serif;\">" +
    hero +
    execSummary +
    dashboard +
    thisWeek +
    firstStepBlock +
    trust +
    bottomCta +
    footer +
    "</table>" +
    "</td></tr></table></body></html>"
  );
}

function renderHtml(t, opts) {
  var o = opts || {};
  var kind = o.kind || "initial";
  if (kind === "initial") return renderPremiumInitialHtml(t, o);
  if (kind === "weekly") return renderPremiumWeeklyHtml(t, o);
  var accent = accentFor(t.theme);
  var greet = esc(t.salutation || (t.hasCompanyName ? t.companyName + " 経営者様" : "ご担当者様"));
  var intro =
    kind === "weekly"
      ? "御社向けのビジネスチャンスレポートを、最新の内容に更新しました。"
      : t.hasOpportunity
        ? "御社について公開情報を分析した結果、次の新しいビジネスチャンスが見つかりました。"
        : "御社について公開情報を分析し、レポートにまとめました。";
  var ctaLabel = kind === "weekly" ? "更新版レポートを見る" : "無料でレポートを見る";

  var chanceBlock = "";
  if (t.hasOpportunity) {
    chanceBlock =
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ' +
      'style="border:1px solid #e1e6ee;border-left:4px solid ' +
      accent +
      ';border-radius:8px;margin:16px 0;">' +
      '<tr><td style="padding:16px 18px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;color:' +
      accent +
      ';">今回見つけたビジネスチャンス</div>' +
      '<div style="font-size:17px;font-weight:800;color:#1f2430;line-height:1.5;margin:6px 0 4px;">' +
      esc(t.opportunityTitle) +
      "</div>" +
      (t.chanceSummary
        ? '<div style="font-size:13px;font-weight:700;color:' + accent + ';margin:0 0 2px;">一言でいうと: ' + esc(t.chanceSummary) + "</div>"
        : "") +
      (t.whyNow
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">なぜ今なのか</div>' +
          '<div style="font-size:13px;line-height:1.8;color:#1f2430;">' +
          esc(t.whyNow) +
          "</div>"
        : "") +
      (t.whyCompany
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">なぜ御社なのか</div>' +
          '<div style="font-size:13px;line-height:1.8;color:#1f2430;">' +
          esc(t.whyCompany) +
          "</div>"
        : "") +
      (t.marketStats && t.marketStats.length
        ? '<div style="font-size:12px;font-weight:700;color:' +
          accent +
          ';margin-top:12px;">新しい市場の動き</div>' +
          statCellsHtml(t.marketStats, accent)
        : "") +
      "</td></tr></table>";
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

  var reassure =
    '<p style="font-size:12px;line-height:1.7;color:#5b6472;background:#f5f7fb;border-radius:6px;' +
    'padding:10px 12px;margin:12px 0 0;">このレポートは無料です。<br>メールアドレス以外の登録は不要です。</p>';

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
    "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic','Segoe UI',sans-serif;\">" +
    '<tr><td style="padding:24px 22px;">' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.04em;color:' +
    accent +
    ';">無料ビジネスチャンスレポート</div>' +
    '<p style="font-size:15px;font-weight:700;color:#1f2430;margin:10px 0 6px;">' +
    greet +
    "</p>" +
    '<p style="font-size:13px;line-height:1.8;color:#1f2430;margin:0;">' +
    intro +
    "</p>" +
    chanceBlock +
    '<p style="font-size:12px;line-height:1.8;color:#5b6472;margin:14px 0 4px;">今回のレポートでは、' +
    "<br>・なぜ今なのか<br>・なぜ御社なのか<br>・今日からできる一歩<br>" +
    "を5分で読める形で整理しています。</p>" +
    '<p style="font-size:13px;font-weight:700;color:#1f2430;margin:8px 0 0;">無料で閲覧できます。</p>' +
    '<div style="text-align:center;margin:14px 0 8px;">' +
    button +
    "</div>" +
    reassure +
    (t.reviewApproved
      ? '<p style="font-size:11px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;' +
        'border-radius:6px;padding:8px 10px;margin:10px 0 0;">✓ ' +
        esc(t.reviewLine) +
        "</p>"
      : "") +
    '<hr style="border:none;border-top:1px solid #e1e6ee;margin:18px 0 12px;">' +
    '<p style="font-size:11px;line-height:1.7;color:#5b6472;margin:0;">' +
    unsubHtml +
    "</p>" +
    '<p style="font-size:11px;color:#5b6472;margin:8px 0 0;">無料ビジネスチャンスレポート 運営事務局</p>' +
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
  const pre = "無料で読めるレポートです。前回から内容を見直し、御社向けのビジネスチャンスを最新化しました。";
  return {
    subject: teaserMod.subject(teaser, { kind: "weekly" }),
    preheader: pre,
    text: renderText(teaser, { kind: "weekly", unsubscribeUrl: o.unsubscribeUrl }),
    html: renderHtml(teaser, { kind: "weekly", unsubscribeUrl: o.unsubscribeUrl, preheader: pre }),
  };
}

module.exports = { renderInitialReportEmail, renderWeeklyReportEmail, accentFor, esc };
