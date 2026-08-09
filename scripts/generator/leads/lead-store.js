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
 *   contact_name?:string, department?:string, notes?:string, source_url?:string, now?:string}} params
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
    company_slug: null, // Phase2でreport_generated時に確定する
    source,
    collection_method,
    contact_name: contact_name || null,
    department: department || null,
    notes: notes || null,
    source_url: source_url || null,
    collected_at: timestamp,
    status: "collected",
    paid_report_requested: false,
    paid_report_requested_at: null,
    weekly_report_consent: false,
    weekly_report_consent_at: null,
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
 * @param {{email:string, company_url:string, source:string, collection_method:string,
 *   contact_name?:string, department?:string, notes?:string, source_url?:string}} params
 * @returns {Promise<Object>} 作成したlead
 */
async function createLead(params) {
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
  // I/O
  createLead,
  readLead,
  updateLead,
  appendHistory,
  listLeads,
  findLeadByEmail,
};
