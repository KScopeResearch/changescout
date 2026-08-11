#!/usr/bin/env node
/**
 * server.js — AORメール回収API（PJ2 第1実装: 安全なリード保存基盤／第2実装: 公開フォーム接続／
 * P0-2: 正式なLeadライフサイクル（lead-store.js）への接続）
 *
 * website/aor（受信者向け静的LP）のメール登録フォームから将来送信される想定の
 * リード情報を、最小限の4フィールド（email, company_slug, captured_at, consent）
 * だけ保存する、独立した最小限のHTTPサーバー。Node.js標準モジュールのみで実装する
 * （npm依存なし）。今回のスコープは「保存」までであり、メール送信・営業フォロー・
 * Adminでの一覧閲覧UI・実フロントエンド配線は含まない。
 *
 * 【重要】website/aor-admin（Review Dashboard）とは完全に独立したアプリケーションである
 * （website/aor/README.mdの「website/aor-adminとwebsite/aorは完全に別アプリケーション」
 * という既存の設計方針を踏襲し、三つ目の独立コンポーネントとして追加する）。認証・
 * セッション・CSRF等、aor-adminの仕組みは一切参照・共有しない（本APIは匿名の公開
 * エンドポイントのため、そもそもログインという概念が無い）。レート制限も専用の
 * ./rate-limit.js を使い、auth.jsのログイン試行レート制限とは独立させている。
 *
 * 【最重要】メールアドレスの生ログ非出力（構造的な保証）:
 *   このファイル内でリクエストボディの`email`・生ボディ文字列を
 *   logger.*() / console.*() へ渡す処理は一切書かない。エラーメッセージは常に
 *   固定文言のみを使い、ユーザー入力を含めない。emailが書き込まれる先は
 *   lead-store.js管理下のLead本体（scripts/generator/logs/leads/<lead_id>.json）
 *   だけであり、admin-audit.jsonlやleads-audit.jsonl（イベントログ、
 *   timestamp/action/company_slug/successのみ）を含め、他のいかなるログにも
 *   出力しない。shared/redact.jsはAPIキー等の秘密情報専用（emailは非対応）のため、
 *   redactに頼るのではなく「そもそも渡さない」という構造で保証する。
 *
 * 保存先（P0-2で変更）: Lead本体はscripts/generator/leads/lead-store.jsの
 * createLead()経由でLEADS_DIR（scripts/generator/logs/leads/）へ保存する
 * （import-leads.js・create-lead-from-email.js等、他のLead作成経路と同じ正式な
 * ライフサイクル管理下に置く）。leads.jsonl（LOGS_DIR直下）は、POST /api/leadsの
 * 保存先としては廃止した（過去データはそのまま残置、新規追記のみ停止）。
 * leads-audit.jsonl（API操作イベントログ）は従来どおりLOGS_DIR配下に置き続ける。
 * LEADS_DIRもLOGS_DIR配下にあるため、backup.jsのTARGETS（label:"logs",
 * required:true）はP0-2でも変更不要のまま引き続きバックアップ対象になる。
 *
 * 【未実装・今回のスコープ外（意図的な見送り）】
 *   - Lead本体（leads.jsonl時代からの積み残し）の自動アーカイブ・保持期間ポリシー:
 *     docs/email-capture-design.md（Task27）で「削除/エクスポートAPI未実装」として
 *     保留されている個人情報の保持方針そのものに関わるため、今回も決めず現状維持
 *     とする。leads-audit.jsonl（PIIを含まない）側はadmin-audit.jsonlと同じく
 *     Task43のarchiveIfOversize()を適用する。
 *
 * 【PJ2 第2実装で追加】
 *   - website/aor/email-capture.jsから実際にPOST /api/leadsを呼ぶよう配線した
 *     （送信するのはemail/company_slug/consentのみ、captured_atはサーバー生成のまま）
 *   - ハニーポット（HONEYPOT_FIELD = "hp_website"）: website/aor/email-capture.htmlの
 *     非表示フィールドが埋まっていればbotとみなし、保存せず本物の成功と同じ201を返す
 *   - CORSは許可リスト方式（ALLOWED_ORIGINS、環境変数LEAD_API_ALLOWED_ORIGINSで設定）。
 *     認証機構としては扱わない（詳細はapplyCorsHeaders()のコメント参照）
 *
 * 【PJ2 Phase4-A/B API（今回追加）】
 *   - POST /api/leads/:lead_id/paid-report-request（Phase4-A: 詳しい有料レポートが欲しい）
 *   - POST /api/leads/:lead_id/weekly-report-consent（Phase4-B: 毎週無料レポートに同意する）
 *   いずれもbody {report_token} を要求し、scripts/generator/leads/lead-store.js（PJ2
 *   Leadライフサイクル管理のコア、既存モジュール）のreadLead/updateLead/appendHistoryを
 *   そのまま利用する（新しいLead永続化ロジックはここに実装しない）。ルーティングは
 *   website/aor-admin/server.jsの既存のパスパラメータ方式
 *   （`pathname.match(/^\/api\/(comment|fix|...)\/([^/]+)$/)`）と同じ正規表現マッチの
 *   スタイルを踏襲する。詳細な確定仕様は「PJ2 Leadライフサイクル 実装仕様 最終確定」
 *   （lead_id不明→404、report_token不一致→403、成功→201）を参照。
 *   このAPIの責務はPhase4-A/Bの属性（paid_report_requested/weekly_report_consent）の
 *   更新のみであり、Leadのstatus・delivery_statusは一切変更しない（別概念のため）。
 *
 * 【P0-2で変更: POST /api/leadsを正式なLeadライフサイクルへ接続】
 *   - 保存経路をappendJsonLine(leads.jsonl)からlead-store.jsのcreateLead()へ変更した。
 *     重複判定（同一email×同一company_slugは同一Lead、再投入はhistoryへ"resubmitted"を
 *     追記するのみ）はcreateLead()の既存ロジックにそのまま委譲し、本ファイルでは
 *     独自実装しない。
 *   - createLead()はcompany_url（company_slugではない）を要求するため、
 *     company-context-store.jsのloadCompanyContext(company_slug)で、そのslugに対応する
 *     company_context.json（generate-company-report.jsがcompany_url確定時に生成する既存
 *     データ）を読み、その`input_url`をcompany_urlとして使う。company_context.jsonが
 *     存在しないcompany_slug（実在しないcompany_slug・report未生成の企業等）は、既存の
 *     company_slug形式検証（validateSlug）と同じ400として扱う（合成URLは作らない）。
 *   - consent: 受信条件（consent===trueを必須とするバリデーション）はそのまま維持するが、
 *     lead-store.jsのLead schemaにconsent相当のフィールド・自然な保存先が無いため、
 *     Lead本体には保存しない（schemaを不用意に拡張しない）。
 *   - source/collection_methodは固定値（LEAD_SOURCE/LEAD_COLLECTION_METHOD、下記定数）。
 *     collection_methodは既存の全Lead生成経路（import-leads.js等）で使われている
 *     "public_website"をそのまま踏襲し、新しい値を増やさない。
 *   - レスポンスは新規作成・resubmittedのいずれも201 { ok: true }のみ（lead_id・
 *     report_token・emailは一切含めない）。
 *
 * 使い方:
 *   node website/aor-lead-api/server.js
 *   （LEAD_API_PORT環境変数でポート変更可、既定4700。
 *   　LEAD_API_ALLOWED_ORIGINS環境変数でCORS許可Originをカンマ区切りで設定可、
 *   　未設定時はローカル動作確認用の既定値のみ許可。詳細はREADME.md参照）
 */

const http = require("http");
const path = require("path");
const { URL } = require("url");

const { validateSlug } = require("../../scripts/generator/shared/path-safety");
const { appendJsonLine } = require("../../scripts/generator/shared/json-file");
const { nowIso } = require("../../scripts/generator/shared/date-utils");
const { createLogger } = require("../../scripts/generator/shared/logger");
const { LOGS_DIR } = require("../../scripts/generator/shared/paths");
const { archiveIfOversize } = require("../../scripts/generator/shared/log-rotation");
const { readLead, updateLead, appendHistory, createLead, LEADS_DIR } = require("../../scripts/generator/leads/lead-store");
const { loadCompanyContext } = require("../../scripts/generator/company-context-store");
const rateLimit = require("./rate-limit");

const logger = createLogger("aor-lead-api");

const PORT = Number(process.env.LEAD_API_PORT) || 4700;

// P0-2以降、新規Leadの保存先ではない（lead-store.jsのLEADS_DIRへ移行済み）。
// 過去データの残置確認・回帰テスト（「新規追記されないこと」の検証）用に定数のみ残す。
const LEADS_PATH = path.join(LOGS_DIR, "leads.jsonl");
const LEADS_AUDIT_PATH = path.join(LOGS_DIR, "leads-audit.jsonl");

// P0-2: 公開フォーム由来Leadのsource/collection_method固定値。collection_methodは
// 既存の全Lead生成経路（import-leads.js等）が使っている"public_website"を再利用する
// （lead-store.jsに正式なenumは無いが、事実上の標準値のため新しい値を増やさない）。
const LEAD_SOURCE = "AOR公開フォーム";
const LEAD_COLLECTION_METHOD = "public_website";
const AUDIT_ARCHIVE_SIZE_BYTES = 10 * 1024 * 1024; // admin-audit.jsonlと同じ閾値（Task43踏襲）

// このAPIは4フィールドの小さなJSONのみを受け付けるため、aor-admin/server.jsの
// readJsonBody()（1MB上限、添付データ等も想定）よりも厳しい上限にする。
const MAX_BODY_BYTES = 10_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321の実用上の上限

// PJ2 第2実装: ハニーポットのJSONフィールド名（website/aor/email-capture.htmlの
// #hp-website、name="hp_website"と対応）。人間には見えない欄で、値が入っていれば
// bot扱いとする。保存する4フィールドには含まれない（server.js側でも許可リストに
// 含めていないため、そもそも保存されない構造になっている）。
const HONEYPOT_FIELD = "hp_website";

// PJ2 第2実装: CORSで許可するOrigin（許可リスト方式）。本番のAOR公開URLは未確定のため
// 決め打ちせず、環境変数LEAD_API_ALLOWED_ORIGINS（カンマ区切り）で設定する。未設定時は
// website/aor/README.mdのローカル動作確認手順（`python -m http.server 8123`）に合わせた
// ローカル開発用の既定値のみを許可する。詳細はREADME.md参照。
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:8123"];
const ALLOWED_ORIGINS = process.env.LEAD_API_ALLOWED_ORIGINS
  ? process.env.LEAD_API_ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

/**
 * @param {*} email
 * @returns {{ok:boolean, error?:string}}
 */
function validateEmail(email) {
  if (typeof email !== "string" || email.length === 0) {
    return { ok: false, error: "emailは必須です" };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, error: "emailが長すぎます" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "emailの形式が不正です" };
  }
  return { ok: true };
}

/**
 * consentは厳密なboolean trueのみを許可する（文字列"true"やtruthyな値は拒否する）。
 * 明示的な同意の記録という意味を持つフィールドのため、型の緩さを許さない。
 * @param {*} consent
 * @returns {{ok:boolean, error?:string}}
 */
function validateConsent(consent) {
  if (consent !== true) {
    return { ok: false, error: "consentはtrueである必要があります" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// HTTPユーティリティ（aor-admin/server.jsと同じパターン）
// ---------------------------------------------------------------------------

/** @param {import("http").ServerResponse} res @param {number} status @param {Object} obj */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * リクエストボディをJSONとして読み込む。上限超過・不正JSONはrejectする。
 * トップレベルがオブジェクトでない場合（null/配列/プリミティブ）は空オブジェクトとして扱う
 * （後続のバリデーションが自然に「必須項目が無い」エラーとして処理できるようにするため）。
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Object>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(new Error("too_large"));
      if (!data) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        return reject(new Error("invalid_json"));
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return resolve({});
      }
      resolve(parsed);
    });
    req.on("error", reject);
  });
}

/** @param {import("http").IncomingMessage} req @returns {string} */
function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/**
 * CORSヘッダーを付与する。許可リスト（ALLOWED_ORIGINS）に含まれるOriginのみへ
 * `Access-Control-Allow-Origin`を返す（含まれない場合はヘッダー自体を付与せず、
 * ブラウザ側でレスポンス読み取りをブロックさせる）。
 *
 * 【重要】本APIは匿名・Cookie非使用（credentialless）のエンドポイントであり、CORS/Origin
 * チェックは認証機構として扱わない（Originヘッダーはブラウザ以外からは自由に詐称できるため、
 * 非ブラウザ経由のリクエスト自体は許可リストに関わらず処理を継続する）。あくまで
 * 「正規のブラウザ利用を成立させ、意図しないブラウザからの呼び出しを減らす」ための補助的な
 * 措置であり、主たる防御はレート制限・入力検証・consent必須化・ハニーポットである。
 * @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res
 */
function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------------------------------------
// リードイベントログ（emailを含まない。admin-audit.jsonlとは別ファイル）
// ---------------------------------------------------------------------------

/**
 * leads-audit.jsonlへ1件追記する。
 * 【構造的な保証】この関数の引数にemailを渡してはならない（呼び出し側の責任）。
 * この関数自体もemailフィールドを一切扱わない実装にしている。
 * @param {{action:string, company_slug:?string, success:boolean}} entry
 */
function logLeadEvent(entry) {
  const record = {
    timestamp: nowIso(),
    action: entry.action,
    company_slug: entry.company_slug || null,
    success: !!entry.success,
  };
  try {
    archiveIfOversize(LEADS_AUDIT_PATH, AUDIT_ARCHIVE_SIZE_BYTES); // Task43のパターンを踏襲
    appendJsonLine(LEADS_AUDIT_PATH, record);
  } catch (e) {
    logger.error(`リードイベントログの書き込みに失敗しました: ${e.message}`); // emailを含まない固定文言
  }
}

// ---------------------------------------------------------------------------
// POST /api/leads 本体
// ---------------------------------------------------------------------------

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
async function handleCreateLead(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    logLeadEvent({ action: "lead_rejected", company_slug: null, success: false });
    if (e.message === "too_large") {
      sendJson(res, 413, { ok: false, error: "リクエストボディが大きすぎます" });
    } else {
      sendJson(res, 400, { ok: false, error: "リクエストボディが不正なJSONです" });
    }
    return;
  }

  // ハニーポット検知（PJ2 第2実装）。値が入っていればbotとみなし、本物の成功と区別できない
  // 201を返す（bot側に検知されたことを悟らせないため）が、保存もcompany_slug付きの
  // イベント記録も行わない。他のバリデーションより先に判定し、bot起因の入力内容に応じて
  // 応答が変わらないようにする。
  if (typeof body[HONEYPOT_FIELD] === "string" && body[HONEYPOT_FIELD].trim() !== "") {
    logLeadEvent({ action: "lead_honeypot_triggered", company_slug: null, success: false });
    sendJson(res, 201, { ok: true });
    return;
  }

  // company_slugの検証はshared/path-safety.jsのvalidateSlug()を再利用する（重複実装しない）。
  const slugCheck = validateSlug(body.company_slug);
  const emailCheck = validateEmail(body.email);
  const consentCheck = validateConsent(body.consent);

  if (!slugCheck.ok || !emailCheck.ok || !consentCheck.ok) {
    logLeadEvent({
      action: "lead_rejected",
      company_slug: slugCheck.ok ? body.company_slug : null,
      success: false,
    });
    const error = !emailCheck.ok ? emailCheck.error : !slugCheck.ok ? slugCheck.error : consentCheck.error;
    sendJson(res, 400, { ok: false, error });
    return;
  }

  // company_slug → company_url解決（P0-2）。company_context.jsonが存在しない
  // company_slug（実在しない・report未生成の企業等）は、合成URLを作らず400として扱う
  // （既存のcompany_slug形式検証と同じ「不正なcompany_slug」の延長として扱い、
  // leads-audit.jsonlのaction種別も新設せずlead_rejectedを再利用する）。
  let companyContext;
  try {
    companyContext = await loadCompanyContext(body.company_slug);
  } catch (e) {
    logger.error(`company_context読み込みに失敗しました: ${e.message}`); // emailを含まない固定文言
    logLeadEvent({ action: "lead_capture_failed", company_slug: body.company_slug, success: false });
    sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
    return;
  }
  if (!companyContext || !companyContext.input_url) {
    logLeadEvent({ action: "lead_rejected", company_slug: body.company_slug, success: false });
    sendJson(res, 400, { ok: false, error: "company_slugが不正です" });
    return;
  }

  // Lead本体の保存はlead-store.jsのcreateLead()に委譲する（email×company_slugの
  // 重複判定＝resubmitted記録もcreateLead()側の既存ロジックがそのまま行う。
  // 本ファイルでは重複判定を独自実装しない）。consentはここまでのバリデーションで
  // trueであることを確認済みだが、Lead schemaには保存しない（P0-2設計確認事項）。
  try {
    await createLead({
      email: body.email,
      company_url: companyContext.input_url,
      source: LEAD_SOURCE,
      collection_method: LEAD_COLLECTION_METHOD,
    });
  } catch (e) {
    logger.error(`リード保存に失敗しました: ${e.message}`); // emailを含まない固定文言
    logLeadEvent({ action: "lead_capture_failed", company_slug: body.company_slug, success: false });
    sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
    return;
  }

  // 新規作成・resubmitted（重複再投入）のいずれも正常処理として201を返す
  // （確定仕様: 重複時も正常処理）。lead_id/report_token/emailはレスポンスに含めない。
  logLeadEvent({ action: "lead_captured", company_slug: body.company_slug, success: true });
  sendJson(res, 201, { ok: true });
}

// ---------------------------------------------------------------------------
// Phase4-A/B: POST /api/leads/:lead_id/paid-report-request ・
//             POST /api/leads/:lead_id/weekly-report-consent（PJ2 Phase4-A/B API）
// ---------------------------------------------------------------------------

// action（URLパスの末尾セグメント）ごとに、更新するLeadの属性名・historyイベント名を
// 対応付ける。A/Bで処理ロジック（handlePhase4Action）自体を完全に共有することで、
// report_token検証やstatus/delivery_status非変更の扱いがA/B間でずれないようにする。
const PHASE4_ACTIONS = {
  "paid-report-request": {
    field: "paid_report_requested",
    atField: "paid_report_requested_at",
    event: "paid_report_requested",
  },
  "weekly-report-consent": {
    field: "weekly_report_consent",
    atField: "weekly_report_consent_at",
    event: "weekly_report_consent",
  },
};

/**
 * Phase4-A/B共通処理。「PJ2 Leadライフサイクル 実装仕様 最終確定」の確定仕様どおり、
 * lead_id不明→404、report_token不一致→403、成功→201を返す。
 *
 * 【status/delivery_statusとの関係】paid_report_requested/weekly_report_consentは
 * status/delivery_statusとは独立した属性であり、この関数はLeadのstatus・
 * delivery_statusを一切変更しない（呼び出し元のLeadがどのstatus・delivery_statusで
 * あっても、この2属性の更新だけを行う。例えばstatus:"rejected"のLeadに対しても、
 * このAPIがstatusをvalidated等へ勝手に戻すことはない）。
 *
 * 【重複クリック・再送への対応】対象属性が既にtrueの場合は、書き込み（updateLead/
 * appendHistory）を一切行わずそのまま201を返す（べき等）。理由: VALID_EVENTSの各
 * historyイベントは「実際に発生した状態遷移」を記録するものであり
 * （lead-store.jsの既存コメント、および process-validated.js が
 * 「report_generated済みLeadは再処理対象にならない＝重複イベントを記録しない」を
 * 徹底しているのと同じ設計思想）、既にtrueの属性に対する再送はボタンの多重クリック等に
 * よる同一イベントの再送であり、新たな状態遷移ではないため、historyへの重複追記も
 * paid_report_requested_at/weekly_report_consent_atの上書きも行わない
 * （_atは「最初にtrueになった時刻」を保持し続ける。collected_atが作成時刻から
 * 不変であるのと同じ扱い）。
 *
 * 【report_tokenの扱い】致し方なくボディで受け取るが、レスポンス・エラー応答・
 * ログ・historyのいずれにも一切含めない（比較にのみ使う）。
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {string} leadId - URLパスの:lead_id部分
 * @param {"paid-report-request"|"weekly-report-consent"} action
 */
async function handlePhase4Action(req, res, leadId, action) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e.message === "too_large") {
      sendJson(res, 413, { ok: false, error: "リクエストボディが大きすぎます" });
    } else {
      sendJson(res, 400, { ok: false, error: "リクエストボディが不正なJSONです" });
    }
    return;
  }

  let lead;
  try {
    lead = await readLead(leadId);
  } catch (e) {
    // lead_idが不正な形式（lead-store.jsのvalidateSlug()検証に失敗）の場合もreadLead()は
    // 例外を投げるが、実在しないlead_idと区別せず404として扱う（形式検証の内部詳細を
    // レスポンスへ露出しない）。
    lead = null;
  }
  if (!lead) {
    sendJson(res, 404, { ok: false, error: "lead not found" });
    return;
  }

  // report_token不一致（未指定・空文字・型不正を含む）は一律403とする。「PJ2
  // Leadライフサイクル 実装仕様 最終確定」で確定しているステータスコードは
  // 404/403/201の3種のみのため、report_token関連の不備をまとめて403として扱い、
  // 仕様にない400等を新設しない。
  if (typeof body.report_token !== "string" || body.report_token.length === 0 || body.report_token !== lead.report_token) {
    sendJson(res, 403, { ok: false, error: "report_tokenが一致しません" });
    return;
  }

  const config = PHASE4_ACTIONS[action];
  if (lead[config.field] !== true) {
    await updateLead(leadId, { [config.field]: true, [config.atField]: nowIso() });
    await appendHistory(leadId, config.event);
  }

  sendJson(res, 201, { ok: true });
}

// ---------------------------------------------------------------------------
// サーバー起動
// ---------------------------------------------------------------------------

function startServer() {
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host}`);
    } catch (e) {
      sendJson(res, 400, { ok: false, error: "不正なリクエストです" });
      return;
    }
    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/leads") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }

      const ip = clientIp(req);
      if (rateLimit.isBlocked(ip)) {
        logLeadEvent({ action: "lead_rate_limited", company_slug: null, success: false });
        sendJson(res, 429, { ok: false, error: "リクエストが多すぎます。しばらく待ってから再試行してください。" });
        return;
      }
      rateLimit.recordRequest(ip);

      try {
        await handleCreateLead(req, res);
      } catch (e) {
        logger.error(`予期しないエラー: ${e.message}`); // emailを含まない固定文言
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
      }
      return;
    }

    // PJ2 Phase4-A/B API。website/aor-admin/server.jsの既存のパスパラメータ方式
    // （正規表現マッチ）を踏襲する。
    const phase4Match = url.pathname.match(/^\/api\/leads\/([^/]+)\/(paid-report-request|weekly-report-consent)$/);
    if (phase4Match) {
      const [, leadId, action] = phase4Match;

      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }

      const ip = clientIp(req);
      if (rateLimit.isBlocked(ip)) {
        sendJson(res, 429, { ok: false, error: "リクエストが多すぎます。しばらく待ってから再試行してください。" });
        return;
      }
      rateLimit.recordRequest(ip);

      try {
        await handlePhase4Action(req, res, leadId, action);
      } catch (e) {
        logger.error(`予期しないエラー: ${e.message}`); // emailを含まない固定文言
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "サーバー内部でエラーが発生しました" });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  });

  server.listen(PORT, () => {
    console.log(`AOR Lead API: http://localhost:${PORT}`);
    console.log(`  保存先: ${LEADS_DIR}`);
    console.log(`  イベントログ: ${LEADS_AUDIT_PATH}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  validateEmail,
  validateConsent,
  PORT,
  LEADS_PATH,
  LEADS_AUDIT_PATH,
  HONEYPOT_FIELD,
  ALLOWED_ORIGINS,
  LEAD_SOURCE,
  LEAD_COLLECTION_METHOD,
};
