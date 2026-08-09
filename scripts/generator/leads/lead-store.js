/**
 * lead-store.js
 *
 * PJ2 Leadライフサイクル管理のコアロジック（「PJ2 Leadライフサイクル 実装仕様
 * 最終確定」に基づく実装、第1弾）。
 *
 * 【設計方針】review-engine.jsと同じ方針を踏襲する。状態を組み立てる関数
 * （buildNewLead/applyPatch/withHistoryEvent）はPure Function（同じ入力に対して
 * 常に同じ出力を返し、副作用を持たない）とし、ファイルI/O（readLead/saveLead等）とは
 * 明確に分離する。`now`は各Pure Functionが引数として受け取れるようにし、テスト時に
 * 固定できるようにしている（省略時は呼び出し時点の時刻を使う）。
 *
 * 【保存方式】Lead 1件につき1ファイル（scripts/generator/logs/leads/<lead_id>.json）。
 * review.jsonが会社1件につき1ファイルであるのと同じ設計をLeadにもそのまま適用する。
 * emailはファイル名に使わない（lead_idのみを使う。path-safety.jsのvalidateSlug()で
 * lead_id自体のパス検証も行う）。
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

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { readJson, writeJson } = require("../shared/json-file");
const { nowIso } = require("../shared/date-utils");
const { validateSlug, isWithinDir } = require("../shared/path-safety");
const { LEADS_DIR } = require("../shared/paths");

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
// I/O（ファイルの読み書き）
// ---------------------------------------------------------------------------

/**
 * lead_idからLead本体のファイルパスを安全に組み立てる。
 * shared/path-safety.jsのvalidateSlug()・isWithinDir()をそのまま再利用する
 * （独自のパス検証ロジックは実装しない）。
 * @param {string} leadId
 * @returns {string}
 */
function leadFilePath(leadId) {
  const check = validateSlug(leadId);
  if (!check.ok) throw new Error(`不正なlead_idです: ${check.error}`);
  const filePath = path.join(LEADS_DIR, `${leadId}.json`);
  if (!isWithinDir(filePath, LEADS_DIR)) throw new Error("不正なlead_idです（パス検証に失敗しました）");
  return filePath;
}

/**
 * 新規Leadを作成し保存する（I/O）。
 * @param {{email:string, company_url:string, source:string, collection_method:string,
 *   contact_name?:string, department?:string, notes?:string, source_url?:string}} params
 * @returns {Object} 作成したlead
 */
function createLead(params) {
  const lead = buildNewLead(params);
  writeJson(leadFilePath(lead.lead_id), lead);
  return lead;
}

/**
 * lead_idからLeadを読み込む（I/O）。
 * @param {string} leadId
 * @returns {Object|null} 存在しない場合はnull
 */
function readLead(leadId) {
  const filePath = leadFilePath(leadId);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * Leadを更新する（I/O）。read → validation → update → 単一のwriteJson呼び出し、
 * という一連の処理を1関数内で行うことで、statusの変更とファイルへの反映が
 * 分離した2回の書き込みにならないようにする（整合性の確保）。
 * @param {string} leadId
 * @param {Object} patch
 * @returns {Object} 更新後のlead
 */
function updateLead(leadId, patch) {
  const lead = readLead(leadId);
  if (!lead) throw new Error(`存在しないlead_idです: ${leadId}`);
  const updated = applyPatch(lead, patch);
  writeJson(leadFilePath(leadId), updated);
  return updated;
}

/**
 * Leadのhistoryへイベントを1件追加して保存する（I/O）。updateLead()と同様、
 * read→append→単一writeJsonの一連処理として行う。
 * @param {string} leadId
 * @param {string} event
 * @param {Object} [metadata]
 * @returns {Object} 更新後のlead
 */
function appendHistory(leadId, event, metadata) {
  const lead = readLead(leadId);
  if (!lead) throw new Error(`存在しないlead_idです: ${leadId}`);
  const updated = withHistoryEvent(lead, event, metadata);
  writeJson(leadFilePath(leadId), updated);
  return updated;
}

/**
 * 登録済みの全Leadを読み込む（I/O）。scripts/generator/logs/leads/配下を列挙する。
 * @returns {Object[]}
 */
function listLeads() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  return fs
    .readdirSync(LEADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(path.join(LEADS_DIR, entry.name)))
    .filter(Boolean);
}

/**
 * emailからLeadを検索する（I/O、全件走査）。「同一email＝同一Lead」の原則に基づき、
 * 一致する最初の1件を返す。emailはファイル名やインデックスとして使わず、
 * 都度全件を走査して比較する（今回のMVP規模ではTask44〜46の実測実績のとおり
 * 十分な性能が見込める）。
 * @param {string} email
 * @returns {Object|null}
 */
function findLeadByEmail(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const leads = listLeads();
  return leads.find((lead) => normalizeEmail(lead.email) === target) || null;
}

module.exports = {
  VALID_STATUSES,
  VALID_DELIVERY_STATUSES,
  VALID_EVENTS,
  LEADS_DIR,
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
