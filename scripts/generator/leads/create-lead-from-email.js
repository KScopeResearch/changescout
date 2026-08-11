#!/usr/bin/env node
/**
 * create-lead-from-email.js — PJ2 AOR本来のStep①→②の接続点。
 *
 * 【背景】PJ2 AORの確定仕様（本来のユーザーフロー）は、
 *   ①運営側がメールアドレスを収集しシステムへ投入する
 *   ②システムがメールアドレスを起点に企業・担当者等を調査し、その結果でLeadを組み立てる
 * であり、company_urlをユーザー・運営者いずれにも事前入力させない。
 *
 * 既存の`import-leads.js`はCSVの必須列に`company_url`を要求しており、これは
 * 「company_urlが既に分かっている」経路（例: 企業公式サイトの公開連絡先を収集した場合、
 * 収集と同時にURLも判明している）には合致するが、本来のStep②（メールアドレスだけを
 * 起点に企業を推定する）には対応していなかった。本ファイルはそのギャップを埋める
 * 最小実装であり、`import-leads.js`のCSV形式・`createLead()`本体は一切変更していない
 * （company-inference.jsで求めたcompany_url等を、既存のcreateLead()へそのまま渡すだけ）。
 *
 * 【スコープ】今回は「収集済みメールアドレス1件」を入力に、company_url等を
 * 推定してLeadを作成するところまで。CSV一括取込には対応しない（運営側が
 * 自動収集の仕組みを持つようになった場合、そちらから1件ずつ本CLIまたは
 * 同等の関数を呼ぶ想定）。
 *
 * 使い方:
 *   node scripts/generator/leads/create-lead-from-email.js <email> [--source=NAME] [--collection-method=NAME]
 *
 * company_urlを企業ドメインから推定できない場合（フリーメールドメイン等）は、
 * Leadを作成せずエラー終了する（存在しない企業をでっち上げない）。
 *
 * 【P1-1で変更: 重複判定をlead-store.jsへ一本化】従来は企業推定より前に
 * `findLeadByEmail()`でemail単独のduplicate判定を行っていたが、これはPJ2 AOR確定仕様
 * 「Leadの一意性はemail×company_slugで決定する」（P0-1、lead-store.jsのcreateLead()）と
 * 矛盾していた（company_urlが異なっていてもemailが一致するだけでLead作成を拒否していた）。
 * P1-1では事前判定を廃止し、企業推定で得たcompany_urlを添えてcreateLead()を呼ぶだけにし、
 * 重複判定（新規作成 or 既存Leadへの"resubmitted"記録）はcreateLead()に完全委譲する。
 * lead-store.jsは内部関数（buildNewLead等）を公開していないため、新規/resubmittedの
 * 判定はcreateLead()の戻り値そのもの（史実として、新規時のhistory最終イベントは常に
 * "collected"、resubmitted時は常に"resubmitted"）を見て行う（下記wasResubmitted()）。
 * resubmitted時は既存Leadのstatus/historyをvalidation処理で一切変更しない（P0-2の
 * 公開フォームと同じ「重複時も既存Leadを変更しない」原則）。
 *
 * delivery_status起因のblock判定（isDeliveryBlocked）は重複判定とは別概念のため、
 * email単独判定の廃止後もcreateLead()の結果（新規/resubmittedいずれも）に対して
 * 引き続き行う（新規Leadは常にdelivery_status:"active"のため実質的にresubmitted時のみ
 * 意味を持つ）。
 */

const { createLead, updateLead, appendHistory, isDeliveryBlocked } = require("./lead-store");
const { inferCompanyFromEmail } = require("./company-inference");
const { validateFormats } = require("./import-leads");
const { runCli } = require("../shared/cli-utils");

/**
 * createLead()が既存Leadへの再投入（resubmitted）を返したかどうかを判定する
 * （Pure Function）。lead-store.jsの内部関数は使わず、公開されているhistory配列の
 * 並び（新規時の最終イベントは常に"collected"、resubmitted時は常に"resubmitted"）
 * だけを見て判定する（P1-1実装前監査で確認済みの仕様）。
 * @param {Object} lead
 * @returns {boolean}
 */
function wasResubmitted(lead) {
  const history = (lead && lead.history) || [];
  const last = history[history.length - 1];
  return !!last && last.event === "resubmitted";
}

/**
 * emailを起点にLeadを1件作成する（本来のStep①→②の接続点）。
 * @param {string} email
 * @param {{source?:string, collection_method?:string, fetchCompany?:Function}} [options] -
 *   fetchCompanyはinferCompanyFromEmail()と同じDIフック（テスト時に実HTTP取得を
 *   ダミー関数へ差し替えるため）。
 * @returns {Promise<{ok:boolean, lead?:Object, inference?:Object, reason?:string, error?:string, resubmitted?:boolean}>}
 */
async function createLeadFromEmail(email, options = {}) {
  const source = options.source || "email_inference";
  const collectionMethod = options.collection_method || "manual";

  const inference = await inferCompanyFromEmail(email, { fetchCompany: options.fetchCompany });
  if (!inference.ok) {
    return {
      ok: false,
      reason: inference.reason,
      inference,
      error: `emailから企業を推定できませんでした（${inference.reason}）: ${inference.evidence}`,
    };
  }

  const now = new Date().toISOString();
  const created = await createLead({
    email,
    company_url: inference.company_url,
    source,
    collection_method: collectionMethod,
    contact_name: inference.contact_name || undefined,
    notes: inference.evidence,
    now,
    company_url_source: inference.company_url_source,
    company_url_confidence: inference.company_url_confidence,
    contact_name_source: inference.contact_name_source,
  });

  if (isDeliveryBlocked(created)) {
    return { ok: false, reason: "blocked", error: `既存Leadのdelivery_statusが"${created.delivery_status}"のため対象外です`, lead: created };
  }

  if (wasResubmitted(created)) {
    // 確定仕様: 同一email×同一company_slug（company_url比較）の再投入は、
    // lead-store.js側がresubmitted historyを記録済み。それ以外（status等）は
    // 一切変更しない（validation処理は新規作成時のみ行う）。
    return { ok: true, lead: created, inference, resubmitted: true };
  }

  const formatCheck = validateFormats({ email, company_url: inference.company_url, collected_at: now });
  if (formatCheck.ok) {
    await updateLead(created.lead_id, { status: "validated" });
    await appendHistory(created.lead_id, "validated");
  } else {
    await updateLead(created.lead_id, { status: "rejected" });
    await appendHistory(created.lead_id, "rejected", { reasons: formatCheck.reasons });
  }

  const finalLead = await require("./lead-store").readLead(created.lead_id);
  return { ok: true, lead: finalLead, inference };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("使い方: node create-lead-from-email.js <email> [--source=NAME] [--collection-method=NAME]");
    process.exitCode = 2;
    return;
  }

  const flags = {};
  process.argv.slice(3).forEach((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/s);
    if (m) flags[m[1]] = m[2];
  });

  const result = await createLeadFromEmail(email, {
    source: flags.source,
    collection_method: flags["collection-method"],
  });

  if (!result.ok) {
    console.error(`Leadを作成できませんでした: ${result.error}`);
    if (result.inference) {
      console.error(`  domain: ${result.inference.domain}`);
      console.error(`  evidence: ${result.inference.evidence}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("=== Lead作成結果（email起点の企業推定） ===");
  console.log(`lead_id: ${result.lead.lead_id}`);
  console.log(`email: ${result.lead.email}`);
  console.log(`company_url: ${result.lead.company_url}（source: ${result.lead.company_url_source}, confidence: ${result.lead.company_url_confidence}）`);
  console.log(`contact_name: ${result.lead.contact_name || "(推定できず)"}${result.lead.contact_name_source ? `（source: ${result.lead.contact_name_source}）` : ""}`);
  console.log(`status: ${result.lead.status}`);
  console.log(`evidence: ${result.inference.evidence}`);
}

if (require.main === module) {
  runCli(main);
}

module.exports = { createLeadFromEmail };
