/**
 * lead-store.js
 *
 * PJ2 Leadライフサイクル管理のコアロジック（「PJ2 Leadライフサイクル 実装仕様
 * 最終確定」に基づく実装、第1弾）。
 *
 * 【設計方針】review-engine.jsと同じ方針を踏襲する。状態を組み立てる関数
 * （buildNewLead/applyPatch/withHistoryEvent）はPure Function（同じ入力に対して
 * 常に同じ出力を返し、副作用を持たない）とし、実際のI/Oとは明確に分離する。`now`は
 * 各Pure Functionが引数として受け取れるようにし、テスト時に固定できるようにしている
 * （省略時は呼び出し時点の時刻を使う）。
 *
 * 【保存方式】Lead 1件につき1オブジェクト（既定: scripts/generator/logs/leads/
 * <lead_id>.json）。review.jsonが会社1件につき1ファイルであるのと同じ設計をLeadにも
 * そのまま適用する。emailはファイル名/キーに使わない（lead_idのみを使う）。
 *
 * 【PJ2次工程で追加: バックエンド抽象化】I/Oの実体（読み書き先）を
 * `./backends/filesystem-backend.js`（既定）と`./backends/s3-backend.js`
 * （AWS Lambda等のステートレス実行環境向け）の2種類に切り替え可能にした
 * （環境変数LEAD_STORE_BACKEND、既定"filesystem"）。この抽象化に伴い、
 * createLead/readLead/updateLead/appendHistory/listLeads/findLeadByEmailは
 * すべて非同期（Promiseを返す）になった——S3バックエンドが本質的にネットワークI/O
 * であり同期化できないため、バックエンドに依らず呼び出し側が同じ書き方（await）で
 * 使える統一インタフェースにする必要があった。関数名・引数・戻り値の形・Pure Function
 * 部分（buildNewLead等）は一切変更していない。
 *
 * バックエンドが公開すべき最小インタフェース（backends/*.js参照）:
 *   readLead(leadId) => Promise<Object|null>
 *   writeLead(leadId, lead) => Promise<void>
 *   listLeads() => Promise<Object[]>
 *
 * 【今回のスコープ】Lead管理モジュールの基盤のみ。以下は含まない（呼び出し元が
 * 別途実装する）:
 *   - Phase1 CSV取り込みCLI
 *   - Phase1→Phase2（レポート生成）への接続
 *   - SES送信・イベント受信
 *   - Phase4-A/B API（report_tokenの検証はこのモジュールの責務ではなく、
 *     呼び出し元のAPIハンドラが行う）
 *   - 各historyイベントを実際に発生させる業務処理そのもの
 *     （appendHistory()は汎用的な記録手段のみを提供する）
 */

const crypto = require("crypto");

const { nowIso } = require("../shared/date-utils");
const { slugFromUrl } = require("../generate-company-report"); // PJ2 AOR: email×company_slug重複判定PoC（下記コメント参照）

/**
 * 環境変数LEAD_STORE_BACKENDに応じたバックエンドモジュールを返す
 * （既定"filesystem"）。過剰な抽象化を避けるため、llm-client.jsのような
 * provider登録機構は設けず、2択の単純な切り替えのみとする。
 * @returns {{readLead:Function, writeLead:Function, listLeads:Function}}
 */
function getBackend() {
  const backendId = (process.env.LEAD_STORE_BACKEND || "filesystem").toLowerCase();
  if (backendId === "filesystem") return require("./backends/filesystem-backend");
  if (backendId === "s3") return require("./backends/s3-backend");
  throw new Error(`未知のLEAD_STORE_BACKENDです: "${backendId}"（"filesystem" または "s3" を指定してください）`);
}

const VALID_STATUSES = [
  "collected",
  "validated",
  "rejected",
  "report_generated",
  "initial_report_queued",
  "initial_report_sent",
  "initial_report_failed",
];

const VALID_DELIVERY_STATUSES = ["active", "unsubscribed", "bounced", "suppressed"];

// 「PJ2 Leadライフサイクル 実装仕様 最終確定」で固定したhistoryイベント名。
const VALID_EVENTS = [
  "collected",
  "validated",
  "rejected",
  "report_generated",
  "initial_report_queued",
  "initial_report_sent",
  "initial_report_failed", // PJ2 Phase3本体で発見: VALID_STATUSESには元々含まれていたが、
  // 対応するhistoryイベント名がここに未登録だった（他の全statusには同名のイベントが
  // 存在するのに、initial_report_failedのみ抜けていた）。SES送信失敗時にhistoryへ
  // 記録できないと今回の確定仕様（失敗理由の記録）を満たせないため追加する。
  "email_delivered",
  "email_opened",
  "email_clicked",
  "email_bounced",
  "email_complaint",
  "paid_report_requested",
  "weekly_report_consent",
  "unsubscribed",
  "weekly_report_sent",
  "weekly_report_failed", // PJ2 AOR Phase 18: initial_report_failedと同じ理由（上記コメント参照）で、
  // weekly_report_sentにはSES失敗時の対になるイベント名がここに未登録だった。
  "resubmitted", // PJ2 AOR: 「Leadは重複を許容する」確定仕様（P0-1）で追加。
  // 既存のLeadライフサイクル系イベント（collected/validated/report_generated等）は
  // いずれもLeadが前進する遷移を表すが、これは唯一「同じ入力が再び届いた」という
  // 事実だけを表す、性質の異なるイベント。既存のVALID_EVENTSにも一度だけ前例がある
  // 追加パターン（"initial_report_failed"、上記コメント参照）を踏襲し、
  // {at, event, metadata}という既存のhistory形式はそのまま、イベント名を1つ
  // 追加するだけにとどめている（新しいhistory構造は発明していない）。
];

// delivery_statusのうち、配信をブロックすべき値。status:"rejected"はここに含めない
// （rejectedは再検証可能であり、単独では配信ブロックの理由にならない。
// 「PJ2 Leadライフサイクル 実装仕様 最終確定」10参照）。
const BLOCKED_DELIVERY_STATUSES = ["unsubscribed", "bounced", "suppressed"];

// ---------------------------------------------------------------------------
// ID発番
// ---------------------------------------------------------------------------

/**
 * lead_id・report_tokenの発番に使う汎用のランダムトークン生成。
 * auth.jsのセッションID発番（crypto.randomBytes(32).toString("hex")）と同じ方式。
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Pure Functions（状態の組み立て。I/Oを行わない）
// ---------------------------------------------------------------------------

/**
 * historyへ1件追加した「新しい」history配列を返す（Pure Function、既存配列は変更しない）。
 * @param {Array<Object>} history
 * @param {{at:string, event:string, metadata:?Object}} entry
 * @returns {Array<Object>}
 */
function appendHistoryEntry(history, entry) {
  return [...(history || []), entry];
}

/**
 * 新規Leadオブジェクトを組み立てる（Pure Function、I/Oなし）。
 * @param {{email:string, company_url:string, source:string, collection_method:string,
 *   contact_name?:string, department?:string, notes?:string, source_url?:string, now?:string,
 *   company_url_source?:string, company_url_confidence?:string, contact_name_source?:string}} params -
 *   company_url_source/company_url_confidence/contact_name_sourceはPJ2 AOR本来のStep②
 *   （company-inference.jsによるemail起点の企業・担当者調査）で使う、推定の根拠・確度を
 *   保持するための任意フィールド（CSV取込等、company_urlを直接指定する既存経路では未設定＝
 *   nullのままでよい。既存フィールドに混ぜず独立させることで、推定情報と確定情報を
 *   区別する）
 * @returns {Object} lead
 */
function buildNewLead({
  email,
  company_url,
  source,
  collection_method,
  contact_name,
  department,
  notes,
  source_url,
  now,
  company_url_source,
  company_url_confidence,
  contact_name_source,
} = {}) {
  if (!email) throw new Error("Leadの作成にはemailが必須です");
  if (!company_url) throw new Error("Leadの作成にはcompany_urlが必須です");
  if (!source) throw new Error("Leadの作成にはsourceが必須です");
  if (!collection_method) throw new Error("Leadの作成にはcollection_methodが必須です");

  const timestamp = now || nowIso();

  const lead = {
    lead_id: generateToken(),
    report_token: generateToken(),
    email,
    company_url,
    company_url_source: company_url_source || null,
    company_url_confidence: company_url_confidence || null,
    company_slug: null, // Phase2でreport_generated時に確定する
    source,
    collection_method,
    contact_name: contact_name || null,
    contact_name_source: contact_name_source || null,
    department: department || null,
    notes: notes || null,
    source_url: source_url || null,
    collected_at: timestamp,
    status: "collected",
    paid_report_requested: false,
    paid_report_requested_at: null,
    weekly_report_consent: false,
    weekly_report_consent_at: null,
    last_weekly_sent_report_generated_at: null, // PJ2 AOR Phase 18: Weekly配信の二重送信防止
    // （publishedの現在のmeta.generated_atと比較し、同じreportを同じLeadへ再送しないための判定に使う）。
    delivery_status: "active",
    history: [],
  };

  lead.history = appendHistoryEntry(lead.history, { at: timestamp, event: "collected", metadata: null });
  return lead;
}

/**
 * Leadの一部フィールドを更新した「新しい」Leadオブジェクトを返す（Pure Function）。
 * status/delivery_statusは許可された値のみを受け付ける。historyへの追記はこの関数の
 * 責務ではない（呼び出し元がwithHistoryEvent()と組み合わせて使う）。
 * @param {Object} lead
 * @param {Object} patch
 * @returns {Object}
 */
function applyPatch(lead, patch) {
  if (patch.status !== undefined && !VALID_STATUSES.includes(patch.status)) {
    throw new Error(`不正なstatusです: ${patch.status}`);
  }
  if (patch.delivery_status !== undefined && !VALID_DELIVERY_STATUSES.includes(patch.delivery_status)) {
    throw new Error(`不正なdelivery_statusです: ${patch.delivery_status}`);
  }
  return { ...lead, ...patch };
}

/**
 * historyへイベントを1件追加した「新しい」Leadオブジェクトを返す（Pure Function）。
 * @param {Object} lead
 * @param {string} event
 * @param {Object} [metadata]
 * @param {string} [now]
 * @returns {Object}
 */
function withHistoryEvent(lead, event, metadata, now) {
  if (!VALID_EVENTS.includes(event)) {
    throw new Error(`未知のhistoryイベントです: ${event}`);
  }
  const timestamp = now || nowIso();
  return {
    ...lead,
    history: appendHistoryEntry(lead.history, { at: timestamp, event, metadata: metadata || null }),
  };
}

/**
 * emailの比較用正規化（前後空白除去・大文字小文字統一のみ。過度な正規化はしない）。
 * @param {*} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : email;
}

/**
 * company_urlから、重複判定「比較専用」のcompany_slugを導出する（Pure Function）。
 *
 * 【PJ2 AOR: email×company_slug重複判定（P0-1）】「Leadは重複を許容する」確定仕様は、
 * Leadの一意性をemail×company_slugの組で決定する。しかし既存のLead schemaでは
 * company_slugはPhase2（process-validated.jsがgenerateCompanyReport()の結果を
 * 反映するタイミング）まで一貫してnullのまま（buildNewLead()参照）であり、
 * この既存の「Phase2で確定する」という意味を変えるとsend-initial-report.jsの
 * 送信前ゲート（`!lead.company_slug`）等、既存の状態ルールに影響する可能性がある。
 *
 * そのため、Leadオブジェクト自体のcompany_slugフィールドには一切手を加えず、
 * 重複判定の「比較」にだけ、generate-company-report.jsのslugFromUrl()
 * （company_urlのhostnameから決定的に導出する既存の純粋関数、Phase2でも
 * 同じcompany_urlに対して同じ値を返す）をその場で適用する。この関数の戻り値は
 * どこにも保存しない。
 * @param {string} companyUrl
 * @returns {string}
 */
function companySlugForComparison(companyUrl) {
  return slugFromUrl(companyUrl);
}

/**
 * Leadの配信が現在ブロックされているかを判定する（Pure Function）。
 * status:"rejected"だけでは配信ブロックと判定しない（rejectedは再検証可能なため）。
 * @param {Object} lead
 * @returns {boolean}
 */
function isDeliveryBlocked(lead) {
  return !!lead && BLOCKED_DELIVERY_STATUSES.includes(lead.delivery_status);
}

// ---------------------------------------------------------------------------
// I/O（バックエンド委譲。PJ2次工程でfilesystem/S3のいずれかへ切り替え可能にした）
// ---------------------------------------------------------------------------

/**
 * 新規Leadを作成し保存する（I/O）。
 *
 * 【PJ2 AOR: email×company_slug重複判定（P0-1）】確定仕様「Leadは重複を許容する」＝
 * 「同一email×同一company_slugの再投入をエラーにも新規Lead作成にもしない」を
 * ここで実装する。email×company_urlが一致する既存Leadが見つかった場合、新規Leadは
 * 作らず、既存Leadを一切変更（company_slug・lead_id・created_at相当のcollected_at・
 * 既存historyのいずれも）せず、"resubmitted"イベントをhistoryへ追記するだけに留めて
 * 既存Leadを返す。呼び出し側から見た戻り値の形（Leadオブジェクト、lead_id等を
 * そのまま利用できる）は、新規作成時・既存Lead時のいずれでも変わらない。
 *
 * email×company_urlが一致しない（company_urlが異なる、または初めてのemail）場合は、
 * 従来どおり新規Leadを作成する。
 * @param {{email:string, company_url:string, source:string, collection_method:string,
 *   contact_name?:string, department?:string, notes?:string, source_url?:string}} params
 * @returns {Promise<Object>} 既存Lead、または新規作成したlead
 */
async function createLead(params) {
  const existing = await findLeadByEmailAndCompanyUrl(params && params.email, params && params.company_url);
  if (existing) {
    return appendHistory(existing.lead_id, "resubmitted", {
      source: (params && params.source) || null,
      collection_method: (params && params.collection_method) || null,
    });
  }
  const lead = buildNewLead(params);
  await getBackend().writeLead(lead.lead_id, lead);
  return lead;
}

/**
 * lead_idからLeadを読み込む（I/O）。
 * @param {string} leadId
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readLead(leadId) {
  return getBackend().readLead(leadId);
}

/**
 * Leadを更新する（I/O）。read → validation → update → 単一のwriteLead呼び出し、
 * という一連の処理を1関数内で行うことで、statusの変更と保存先への反映が
 * 分離した2回の書き込みにならないようにする（整合性の確保。この方針自体は
 * バックエンドを問わず維持する）。
 * @param {string} leadId
 * @param {Object} patch
 * @returns {Promise<Object>} 更新後のlead
 */
async function updateLead(leadId, patch) {
  const backend = getBackend();
  const lead = await backend.readLead(leadId);
  if (!lead) throw new Error(`存在しないlead_idです: ${leadId}`);
  const updated = applyPatch(lead, patch);
  await backend.writeLead(leadId, updated);
  return updated;
}

/**
 * Leadのhistoryへイベントを1件追加して保存する（I/O）。updateLead()と同様、
 * read→append→単一writeLeadの一連処理として行う。
 * @param {string} leadId
 * @param {string} event
 * @param {Object} [metadata]
 * @returns {Promise<Object>} 更新後のlead
 */
async function appendHistory(leadId, event, metadata) {
  const backend = getBackend();
  const lead = await backend.readLead(leadId);
  if (!lead) throw new Error(`存在しないlead_idです: ${leadId}`);
  const updated = withHistoryEvent(lead, event, metadata);
  await backend.writeLead(leadId, updated);
  return updated;
}

/**
 * 登録済みの全Leadを読み込む（I/O）。
 * @returns {Promise<Object[]>}
 */
async function listLeads() {
  return getBackend().listLeads();
}

/**
 * emailからLeadを検索する（I/O、全件走査）。「同一email＝同一Lead」の原則に基づき、
 * 一致する最初の1件を返す。emailはファイル名やインデックスとして使わず、
 * 都度全件を走査して比較する（今回のMVP規模ではTask44〜46の実測実績のとおり
 * 十分な性能が見込める。S3バックエンドでも同じ方針を踏襲し、GSI相当の仕組みは
 * トライアル規模では導入しない——PJ2次工程のAWS設計調査で確認済みの判断）。
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
async function findLeadByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const leads = await getBackend().listLeads();
  return leads.find((lead) => normalizeEmail(lead.email) === target) || null;
}

/**
 * email×company_urlからLeadを検索する（I/O、全件走査）。PJ2 AOR確定仕様「Leadの一意性は
 * email×company_slugで決定する」の実体。company_slug自体ではなく、companySlugForComparison()
 * によるcompany_urlからの導出値どうしを比較する（上記コメント参照。company_slugフィールドは
 * 一切参照・変更しない）。
 * @param {string} email
 * @param {string} companyUrl
 * @returns {Promise<Object|null>}
 */
async function findLeadByEmailAndCompanyUrl(email, companyUrl) {
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) return null;
  const targetSlug = companySlugForComparison(companyUrl);
  const leads = await getBackend().listLeads();
  return (
    leads.find(
      (lead) => normalizeEmail(lead.email) === targetEmail && companySlugForComparison(lead.company_url) === targetSlug
    ) || null
  );
}

module.exports = {
  VALID_STATUSES,
  VALID_DELIVERY_STATUSES,
  VALID_EVENTS,
  LEADS_DIR: require("../shared/paths").LEADS_DIR, // 既存呼び出し元（テストのクリーンアップ等）との互換のため再エクスポート
  // Pure Functions（テスト・呼び出し元での組み立てに利用可能）
  buildNewLead,
  applyPatch,
  withHistoryEvent,
  normalizeEmail,
  isDeliveryBlocked,
  companySlugForComparison,
  // I/O
  createLead,
  readLead,
  updateLead,
  appendHistory,
  listLeads,
  findLeadByEmail,
  findLeadByEmailAndCompanyUrl,
};
