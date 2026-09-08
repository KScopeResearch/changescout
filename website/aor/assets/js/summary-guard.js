/*
 * summary-guard.js — Phase55 P0-1 Hotfix
 *
 * report-preview の header で company_profile.business_summary を描画する前に、
 * 「自然言語の事業概要として明らかに不正な値」を弾くための最小ガード。
 *
 * 背景: Phase54 の会社ページ抽出（extractSummary）が、会社概要ページの
 * Markdown テーブル／見出し断片や、会社名・代表者・所在地・資本金といった
 * プロフィール項目の羅列をそのまま business_summary に取り込んでしまうケースがあり、
 * illegame.com の RC1 preview で
 *   "## | --- | 会社名 株式会社イル・レガメ … 代表者 代表取締役 … 所在地 … 資本金 …"
 * という壊れた文字列がファーストビューに表示されていた。
 *
 * ここでは「新しい会社概要を生成」はしない。不正と判定した場合は summary 段落を
 * 描画しないだけ（fallback は「非表示」）。恒久対応は fetch-company.js 側の抽出修正で行う。
 *
 * ブラウザ（<script> 読み込み）と Node（テスト）の両方で使えるよう UMD 形式。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SummaryGuard = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 会社プロフィール項目のラベル群。群ごとに「1つでも出現すれば 1 カウント」とし、
  // "主な事業内容" と "事業内容" のような重なりで過剰カウントしないようにする。
  var PROFILE_FIELD_GROUPS = [
    ["会社名", "商号", "社名"],
    ["代表者", "代表取締役", "代表社員", "代表者名"],
    ["所在地", "本社所在地", "住所"],
    ["資本金"],
    ["設立", "創業", "設立年月日"],
    ["従業員数", "社員数"],
    ["E-Mail", "Eメール", "e-mail", "メールアドレス"],
    ["電話番号", "TEL", "Tel", "ＴＥＬ"],
    ["FAX", "ＦＡＸ"],
    ["主な事業内容", "事業内容"],
    ["取引銀行"],
    ["許認可", "登録番号", "免許番号"],
  ];

  /**
   * business_summary が「自然言語の事業概要」として使えるか。
   * @param {*} summary
   * @returns {boolean}
   */
  function isUsableBusinessSummary(summary) {
    if (typeof summary !== "string") return false;
    var s = summary.trim();
    if (!s) return false;

    // --- A. Markdown table fragment ---
    if (/\|\s*:?-{2,}:?\s*\|/.test(s)) return false; // | --- | / |:---:|
    if (/(^|\n)\s*\|/.test(s)) return false; // 行頭が |
    if (/\|[^\n|]*\|[^\n|]*\|/.test(s)) return false; // 1行に | が3本以上（表の行）

    // --- B. Markdown heading / 記号混入 ---
    if (/(^|\n)\s{0,3}#{1,6}\s/.test(s)) return false; // 見出し行
    if (/^\s*#{1,6}(\s|\||$)/.test(s)) return false; // 先頭が "##" / "## |"

    // --- C. 会社プロフィール項目の羅列（3群以上） ---
    var groupHits = 0;
    for (var g = 0; g < PROFILE_FIELD_GROUPS.length; g++) {
      var labels = PROFILE_FIELD_GROUPS[g];
      for (var i = 0; i < labels.length; i++) {
        if (s.indexOf(labels[i]) !== -1) {
          groupHits++;
          break;
        }
      }
    }
    if (groupHits >= 3) return false;

    // --- D. HTML / script / nav boilerplate ---
    if (/<\/?(script|style|nav|header|footer|iframe|form|button|ul|ol|li|div|span|table|tbody|tr|td|th)\b/i.test(s)) return false;
    if (/<(a|p|br|hr|img|h[1-6]|section|article|meta|link|main|aside)\b[^>]*>/i.test(s)) return false;
    if (/&(nbsp|amp|lt|gt|quot|#\d+);/.test(s)) return false; // 未デコードの HTML エンティティ
    if (/(スキップして本文へ|本文へ移動|グローバルナビ|メインメニュー|メニューを開く|Toggle navigation|パンくずリスト|サイトマップへ)/.test(s)) return false;

    return true;
  }

  return {
    isUsableBusinessSummary: isUsableBusinessSummary,
    PROFILE_FIELD_GROUPS: PROFILE_FIELD_GROUPS,
  };
});
