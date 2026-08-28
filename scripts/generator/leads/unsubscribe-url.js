/**
 * unsubscribe-url.js — PJ2 AOR Phase45 STEP3A: 共通Unsubscribe基盤（URL・ヘッダー生成）。
 *
 * 【目的】Initial AOR（blastengine予定）・Weekly AOR（Amazon SES）のどちらのメールからも
 * 共通で使える、配信停止URLとList-Unsubscribe関連ヘッダーの組み立てロジックをここに集約する
 * （`docs/strategy_v2/13_architecture.md`「メール送信アーキテクチャ v1.0」3節・4節の
 * 「Provider非依存の共通Suppression/オプトアウト仕様」に対応する実装）。
 *
 * 【今回のスコープ】URL・ヘッダーの生成（Pure Function）のみ。以下は今回の対象外：
 *   - メール送信側（ses-client.js／将来のblastengine client）でこれらの関数を実際に呼び出す配線
 *   - unsubscribe.htmlページ自体の実装（website/aor配下）
 *   - 生成したURLを受け取って実際に配信停止処理を行うHTTPエンドポイント
 *     （配信停止処理そのものは unsubscribe-lead.js の unsubscribeLeadByToken() を参照）
 *
 * 【report_tokenの再利用】新しいLeadスキーマフィールドは追加しない。既存の`report_token`
 * （`lead-store.js`の`buildNewLead()`が`crypto.randomBytes(32).toString("hex")`で発番する、
 * report-preview.htmlの認可トークンと同じフィールド）をそのまま配信停止URLのトークンとしても
 * 流用する。これは`send-initial-report.js`の`buildReportUrl()`と同一の設計方針。
 */

/**
 * 配信停止ページへの一意なURLを組み立てる（Pure Function）。`send-initial-report.js`の
 * `buildReportUrl()`と同じ「baseUrlの末尾スラッシュ有無を吸収し、URLSearchParamsで
 * クエリを組み立てる」方式を踏襲する。emailはいかなる形でもURLへ含めない。
 *
 * 【将来の拡張】現状はreport_token（32byte hexの既存フィールド、既に十分に推測困難）を
 * そのままトークンとして使う。将来、有効期限付きの署名URLへ拡張する場合も、本関数の
 * 引数はオブジェクト形式のため、`signature`等のフィールドを追加するだけで済む構造にしている。
 *
 * @param {string} baseUrl - AOR_SITE_BASE_URL
 * @param {{leadId:string, reportToken:string}} params
 * @returns {string}
 */
function buildUnsubscribeUrl(baseUrl, { leadId, reportToken }) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("unsubscribe.html", normalizedBase);
  url.searchParams.set("lead", leadId);
  url.searchParams.set("token", reportToken);
  return url.toString();
}

/**
 * List-Unsubscribe / List-Unsubscribe-Post ヘッダーを組み立てる（Pure Function）。
 * mailtoAddressを省略した場合はURLのみのList-Unsubscribe値になる。
 *
 * 【oneClick（PJ2 AOR Phase49 STEP5で追加）】`List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 * （RFC 8058のワンクリック）を付けるかどうか。**このヘッダーを付けると、対応MUA（Gmail等）は
 * unsubscribeUrlへ直接POSTし、その応答だけで「配信停止完了」と表示する。** したがって
 * unsubscribeUrlがPOSTを受けてその場で配信停止を実行できる場合のみ`true`にすること。
 * 現状のunsubscribeUrl（`<base>/unsubscribe.html?...`、静的な確認ページ）はPOSTを処理しない
 * ため、静的サイト構成では`false`（＝`List-Unsubscribe`のみ。MUAは確認ページを開くだけ）を
 * 指定する。将来、POSTを受けてその場で配信停止するエンドポイントを用意したら`true`へ戻す。
 * 既定は`true`（既存呼び出し元の挙動を変えない）。
 * @param {{unsubscribeUrl:string, mailtoAddress?:string, oneClick?:boolean}} params
 * @returns {{"List-Unsubscribe":string, "List-Unsubscribe-Post"?:string}}
 */
function buildListUnsubscribeHeaders({ unsubscribeUrl, mailtoAddress, oneClick = true }) {
  const parts = [];
  if (mailtoAddress) parts.push(`<mailto:${mailtoAddress}>`);
  parts.push(`<${unsubscribeUrl}>`);
  const headers = { "List-Unsubscribe": parts.join(", ") };
  if (oneClick) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  return headers;
}

module.exports = {
  buildUnsubscribeUrl,
  buildListUnsubscribeHeaders,
};
