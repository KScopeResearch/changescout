#!/usr/bin/env node
/**
 * unsubscribe-lead.js — PJ2 AOR Phase 42: 受信者からの返信による配信停止(unsubscribe)希望を
 * 運営者が手動で反映するCLI。
 *
 * 【背景】現時点ではSES Receipt Rule等による返信メールの自動処理は行っていない
 * （本Phaseのスコープ外。将来課題）。運営者が返信メールを目視確認した上で、対象の
 * emailを指定してこのCLIを実行し、該当Leadのdelivery_statusを"unsubscribed"へ変更する、
 * という運用を最低限成立させる。lead-store.jsの既存API（updateLead/appendHistory）の
 * みを使い、独自のLead保存ロジック・新しいhistory機構は一切追加しない
 * （import-leads.jsと同じ設計方針）。
 *
 * 使い方:
 *   node scripts/generator/leads/unsubscribe-lead.js <email>
 *
 * 【安全機構】
 *   - 対象Leadが存在しない場合は何も変更せずエラー終了する（新規Leadは作らない）
 *   - 同一emailで複数Leadが見つかった場合は一意に特定できないため、いずれも変更せず
 *     停止する（findLeadByEmail()は先頭1件のみを返し複数存在を隠してしまうため、
 *     本CLIはlistLeads()を自前でemail正規化フィルタし、件数を明示的に検査する。
 *     「Leadは重複を許容する」確定仕様（lead-store.js P0-1）により、同一emailで
 *     company_urlが異なる複数Leadが実在しうる）
 *   - 既にdelivery_status:"unsubscribed"の場合は冪等に扱い、状態変更・history追記の
 *     いずれも行わず、成功として終了する
 */

const { runCli } = require("../shared/cli-utils");
const { readLead, listLeads, updateLead, appendHistory, normalizeEmail } = require("./lead-store");

// import-leads.jsのEMAIL_PATTERNと同じ簡易チェック（@とドメインのドットの存在のみ）。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * emailに一致する全Leadを返す（前後空白除去・大文字小文字を正規化して比較）。
 * findLeadByEmail()は先頭1件のみを返し複数存在を隠すため、複数存在の検知には
 * listLeads()を自前でフィルタする。
 * @param {string} email
 * @returns {Promise<Object[]>}
 */
async function findAllLeadsByEmail(email) {
  const target = normalizeEmail(email);
  const leads = await listLeads();
  return leads.filter((lead) => normalizeEmail(lead.email) === target);
}

/**
 * 対象Lead（呼び出し元が既に特定・検証済み）をunsubscribed状態へ変更する共通処理（冪等）。
 * PJ2 AOR Phase45 STEP3A（共通Unsubscribe基盤）: reply-based（unsubscribeLead）・
 * URL経由（unsubscribeLeadByToken）の両エントリポイントから呼ばれる、Provider非依存の
 * 共通ロジック。呼び出し元ごとの「対象Leadの特定方法」の違いだけを分離し、実際の状態変更
 * ロジック自体は重複させない。
 * @param {Object} lead - 変更前のLead（存在確認済みのものを渡すこと）
 * @param {{trigger:string, applied_by:string}} meta - historyへ記録するmetadata
 * @returns {Promise<{ok:boolean, code:string, message:string, leadBefore:Object, leadAfter:Object}>}
 */
async function applyUnsubscribe(lead, { trigger, applied_by }) {
  if (lead.delivery_status === "unsubscribed") {
    return {
      ok: true,
      code: "already_unsubscribed",
      message: "既にdelivery_status: \"unsubscribed\"です（変更していません）",
      leadBefore: lead,
      leadAfter: lead,
    };
  }

  await updateLead(lead.lead_id, { delivery_status: "unsubscribed" });
  const leadAfter = await appendHistory(lead.lead_id, "unsubscribed", { trigger, applied_by });

  return {
    ok: true,
    code: "unsubscribed",
    message: "delivery_statusを\"unsubscribed\"へ変更しました",
    leadBefore: lead,
    leadAfter,
  };
}

/**
 * 対象emailのLeadをunsubscribedへ変更する（存在チェック・複数候補チェックを経た上でのみ、
 * applyUnsubscribe()による実際の変更を行う）。返信ベースのCLIから呼ばれる想定。
 * @param {string} email
 * @returns {Promise<{ok:boolean, code:string, message:string, leadBefore?:Object, leadAfter?:Object, candidates?:Object[]}>}
 */
async function unsubscribeLead(email) {
  const matches = await findAllLeadsByEmail(email);

  if (matches.length === 0) {
    return { ok: false, code: "not_found", message: `該当するLeadが見つかりません: ${email}` };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      code: "ambiguous",
      message: `同一emailで複数のLeadが見つかったため一意に特定できません（何も変更していません）: ${email}`,
      candidates: matches,
    };
  }

  return applyUnsubscribe(matches[0], { trigger: "reply_opt_out", applied_by: "unsubscribe-lead-cli" });
}

/**
 * lead_id・report_tokenの組み合わせを検証したうえで、対象Leadをunsubscribedへ変更する。
 * PJ2 AOR Phase45 STEP3A: 配信停止URL（`unsubscribe-url.js`の`buildUnsubscribeUrl()`が
 * 生成する形式）経由での利用を想定した共通関数。実際にこの関数を呼び出すHTTPエンドポイント
 * の実装（website/aor-lead-api等）は本Phaseの対象外——ここでは呼び出し可能な関数として
 * 用意するところまでを行う。
 *
 * report_tokenは`buildNewLead()`が発番する既存フィールドをそのまま流用し、新規のLead
 * スキーマ追加は行わない（report-preview.htmlの認可トークンと同じ設計を踏襲）。
 * @param {string} leadId
 * @param {string} token - lead.report_tokenと一致することを要求する
 * @returns {Promise<{ok:boolean, code:string, message:string, leadBefore?:Object, leadAfter?:Object}>}
 */
async function unsubscribeLeadByToken(leadId, token) {
  let lead;
  try {
    lead = await readLead(leadId);
  } catch (e) {
    // 不正な形式のlead_id（validateSlug()検証失敗）も、実在しないlead_idと区別せず
    // 「見つからない」として扱う（process-ses-event.jsのprocessSesEvent()と同じ既存パターン）。
    lead = null;
  }
  if (!lead) {
    return { ok: false, code: "not_found", message: `該当するLeadが見つかりません: ${leadId}` };
  }

  if (typeof token !== "string" || !token || lead.report_token !== token) {
    return { ok: false, code: "invalid_token", message: "指定されたtokenがLeadのreport_tokenと一致しません" };
  }

  return applyUnsubscribe(lead, { trigger: "url_opt_out", applied_by: "unsubscribe-url" });
}

/** @param {Object} lead */
function printLeadIdentity(lead) {
  console.log(`  lead_id: ${lead.lead_id}`);
  console.log(`  email: ${lead.email}`);
  console.log(`  company_slug: ${lead.company_slug || "(未設定)"}`);
  console.log(`  status: ${lead.status}`);
  console.log(`  delivery_status: ${lead.delivery_status}`);
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("使い方: node scripts/generator/leads/unsubscribe-lead.js <email>");
    process.exitCode = 2;
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    console.error(`emailの形式が不正です: ${email}`);
    process.exitCode = 2;
    return;
  }

  const result = await unsubscribeLead(email);

  if (result.code === "not_found") {
    console.error(result.message);
    process.exitCode = 1;
    return;
  }

  if (result.code === "ambiguous") {
    console.error(result.message);
    result.candidates.forEach((lead) => {
      console.error(
        `  - lead_id: ${lead.lead_id}, company_slug: ${lead.company_slug || "(未設定)"}, status: ${lead.status}, delivery_status: ${lead.delivery_status}`
      );
    });
    process.exitCode = 1;
    return;
  }

  console.log("対象Lead:");
  printLeadIdentity(result.leadBefore);
  console.log(`\n${result.message}`);
  if (result.code === "unsubscribed") {
    console.log(`  delivery_status(変更後): ${result.leadAfter.delivery_status}`);
  }
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  unsubscribeLead,
  findAllLeadsByEmail,
  EMAIL_PATTERN,
  applyUnsubscribe,
  unsubscribeLeadByToken,
};
