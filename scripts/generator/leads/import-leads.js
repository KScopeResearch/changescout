#!/usr/bin/env node
/**
 * import-leads.js — PJ2 Phase1: CSVから企業メールアドレスを取り込み、Leadを作成する。
 *
 * 「PJ2 Leadライフサイクル 実装仕様 最終確定」のPhase1（企業メールアドレス収集）に
 * 対応するCLI。leads/lead-store.jsの既存API（createLead/readLead/updateLead/
 * appendHistory/findLeadByEmailAndCompanyUrl/isDeliveryBlocked）をそのまま利用し、
 * 独自のLead保存ロジックはここには持たない。
 *
 * 【P1-2で変更: 重複判定をemail×company_url（company_slug相当）へ一本化】従来は
 * `findLeadByEmail()`によるemail単独の事前判定で新規/duplicate/blockedを振り分けて
 * いたが、これはPJ2 AOR確定仕様「Leadの一意性はemail×company_slugで決定する」
 * （P0-1、lead-store.jsのcreateLead()）と矛盾していた（company_urlが異なっていても
 * emailが一致するだけでLead作成を拒否していた。P1-1のcreate-lead-from-email.jsと
 * 同型の問題）。P1-2では`findLeadByEmail()`は使わず、`findLeadByEmailAndCompanyUrl()`
 * （P0-1の既存公開APIそのもの。新しい比較ロジックは実装しない）でP0-1と同じ正規キーの
 * 事前確認だけを行い、通常の新規/resubmitted判定自体は`createLead()`へ完全委譲する。
 *
 * 【rejected再検証機能との分離】本ファイル独自の既存機能「rejectedになったLeadへ、
 * 修正済みCSVを再投入し、同一lead_idのまま再検証してvalidatedへ進める」は、
 * lead-store.jsの確定仕様（resubmitted＝既存Leadを一切変更しない）とは別物であるため、
 * `createLead()`を呼ばない明示的な特別分岐として維持する（`existingMatch`が
 * `status:"rejected"`かつblockedでない場合のみ入る）。company_url自体を訂正した結果
 * company_slugが変わるケース（例: 不正なURL文字列の訂正）は、この特別分岐の対象外
 * （＝別companyとして扱われ、新規Leadになる）。これはcompany_slugを唯一の同一性キーと
 * する確定仕様どおりの正しい挙動であり、rejected再検証機能はあくまで「同一company内での
 * 再検証」に限定される。
 *
 * 【CSVパーサーについて】package.jsonが存在しない（npm非依存）プロジェクト方針のため、
 * 外部ライブラリは使わず、RFC4180の基本的な範囲（ダブルクォート囲み・カンマ/改行を
 * 含むフィールド・""によるクォートのエスケープ）に対応した最小限のパーサーを
 * このファイル内に実装する。
 *
 * 【必須項目の「存在チェック」と「形式チェック」を分離する設計判断】
 *   lead-store.jsのcreateLead()（buildNewLead()）は、email/company_url/source/
 *   collection_methodが1つでも空だと例外を投げる（Leadとして構造的に成立しない
 *   ため）。そのため、必須項目が1つでも欠けている行は、そもそもLeadレコードを
 *   作成できない（rejectedとしてすら記録できない）ため「errors」として扱う。
 *   一方、必須項目は全て存在するが値の形式が不正（emailの書式・company_urlが
 *   URLとして不正・collected_atがISO8601でない）な行は、Leadとして作成した上で
 *   status:"rejected"として記録する（「収集を試みたが検証に失敗した」という
 *   事実自体に監査上の価値があるため）。
 *
 * 使い方:
 *   node scripts/generator/leads/import-leads.js <csv-path>
 *
 * CSV必須列: email, source, collection_method, collected_at, company_url
 * CSV任意列: contact_name, department, notes, source_url
 */

const fs = require("fs");

const { isValidIso8601 } = require("../shared/date-utils");
const { runCli } = require("../shared/cli-utils");
const { createLead, updateLead, appendHistory, findLeadByEmailAndCompanyUrl, isDeliveryBlocked } = require("./lead-store");

const REQUIRED_FIELDS = ["email", "source", "collection_method", "collected_at", "company_url"];
const OPTIONAL_FIELDS = ["contact_name", "department", "notes", "source_url"];

// website/aor-lead-api/server.jsのvalidateEmail()と同趣旨の簡易チェック（@とドメインの
// ドットの存在を見るのみ）。website側から直接requireすると依存の向きが逆転する
// （website/ → scripts/generator/ が既存の依存方向であり、その逆は避ける）ため、
// このCLI専用に同等の最小限のチェックを個別に持つ。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// CSVパーサー（最小限の自前実装、外部ライブラリ非依存）
// ---------------------------------------------------------------------------

/**
 * CSVテキストを行×列の生データ（文字列の二次元配列）にパースする。
 * ダブルクォート囲み・カンマ/改行を含むフィールド・""エスケープに対応する。
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1; // \r\n の \r は読み飛ばす（\n側で改行を確定する）
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * ヘッダー行を使って、CSVをオブジェクト配列に変換する。各値は前後の空白を除去する。
 * @param {string} text
 * @returns {Object[]}
 */
function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = (row[idx] !== undefined ? row[idx] : "").trim();
    });
    return record;
  });
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

/** @param {string} value @returns {boolean} */
function isValidUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 必須項目が全て存在するか（値の形式は見ない）。
 * @param {Object} record
 * @returns {{ok:boolean, missing:string[]}}
 */
function checkRequiredPresence(record) {
  const missing = REQUIRED_FIELDS.filter((field) => !record[field]);
  return { ok: missing.length === 0, missing };
}

/**
 * 必須項目が全て存在する前提で、値の形式を検証する。
 * @param {Object} record
 * @returns {{ok:boolean, reasons:string[]}}
 */
function validateFormats(record) {
  const reasons = [];
  if (!EMAIL_PATTERN.test(record.email)) reasons.push("emailの形式が不正です");
  if (!isValidUrl(record.company_url)) reasons.push("company_urlの形式が不正です");
  if (!isValidIso8601(record.collected_at)) reasons.push("collected_atがISO8601形式ではありません");
  return { ok: reasons.length === 0, reasons };
}

/** @param {Object} record @returns {Object} */
function pickOptionalFields(record) {
  const fields = {};
  OPTIONAL_FIELDS.forEach((field) => {
    if (record[field]) fields[field] = record[field];
  });
  return fields;
}

// ---------------------------------------------------------------------------
// 取り込み本体
// ---------------------------------------------------------------------------

/**
 * CSVファイルを読み込み、各行についてLeadの作成・再検証・重複/ブロック判定を行う。
 * 【PJ2次工程】lead-store.jsのバックエンド抽象化（filesystem/S3）に伴いI/Oが非同期に
 * なったため、本関数もasyncにし、forEach()をfor...ofへ置き換えた（1行ずつ直列処理する
 * という既存の処理順序・挙動自体は変更していない）。
 * @param {string} csvPath
 * @returns {Promise<{summary:Object, rows:Array<Object>}>}
 */
async function importLeadsFromCsv(csvPath) {
  const text = fs.readFileSync(csvPath, "utf-8");
  const records = parseCsv(text);

  const summary = { total: 0, created: 0, validated: 0, rejected: 0, resubmitted: 0, blocked: 0, errors: 0 };
  const rows = [];

  const record0 = (idx) => idx + 2; // ヘッダーが1行目、最初のデータ行は2行目

  for (let idx = 0; idx < records.length; idx += 1) {
    const record = records[idx];
    const line = record0(idx);
    summary.total += 1;

    try {
      const email = record.email;

      // emailが空の場合は、既存Leadの検索キーすら持てないため無条件にerrorsとする。
      if (!email) {
        summary.errors += 1;
        rows.push({ line, category: "error", reason: "emailが空です" });
        continue;
      }

      // ①必須項目の存在チェック。company_url等が無いと、company一致判定
      // （findLeadByEmailAndCompanyUrl）もcreateLead()も意味のある形で実行できない
      // （lead-store.jsの構造上の制約）ため、rejected再検証の対象にもせず
      // 無条件にerrorsとして終了する。
      const presence = checkRequiredPresence(record);
      if (!presence.ok) {
        summary.errors += 1;
        rows.push({ line, category: "error", reason: `必須項目が不足しているためLeadを作成できません: ${presence.missing.join(", ")}` });
        continue;
      }

      // ②company一致（email×company_slug相当）の既存Lead検索。P0-1の既存公開API
      // findLeadByEmailAndCompanyUrl()をそのまま使い、独自の比較ロジックは実装しない。
      // email単独では検索しない。この結果は③のrejected再検証分岐が必要かどうかの
      // 判定にのみ使い、通常の新規/resubmitted判定自体はcreateLead()に委譲する。
      const existingMatch = await findLeadByEmailAndCompanyUrl(email, record.company_url);

      // ③rejected再検証の特別分岐（既存機能の維持）。lead-store.jsのresubmitted仕様
      // （既存Leadを一切変更しない）とは別物のため、createLead()を呼ばずresubmitted
      // イベントも追加しない。同一lead_idのままCSVの修正内容で再検証する。
      // blockedなrejected Leadはこの分岐に入れず、④の通常経路（createLead()経由）へ流す。
      if (existingMatch && existingMatch.status === "rejected" && !isDeliveryBlocked(existingMatch)) {
        const formatCheck = validateFormats(record);
        if (formatCheck.ok) {
          await updateLead(existingMatch.lead_id, { status: "validated" });
          await appendHistory(existingMatch.lead_id, "validated");
          summary.validated += 1;
          rows.push({ line, category: "validated", lead_id: existingMatch.lead_id, reason: "rejectedから再検証に成功しました（同一lead_idを維持）" });
        } else {
          await appendHistory(existingMatch.lead_id, "rejected", { reasons: formatCheck.reasons });
          summary.rejected += 1;
          rows.push({ line, category: "rejected", lead_id: existingMatch.lead_id, reason: formatCheck.reasons.join("; ") });
        }
        continue;
      }

      // ④通常経路。新規作成・resubmittedいずれの判定もcreateLead()に完全委譲する
      // （import-leads.js側で重複判定を再実装しない）。
      const created = await createLead({
        email,
        company_url: record.company_url,
        source: record.source,
        collection_method: record.collection_method,
        now: record.collected_at,
        ...pickOptionalFields(record),
      });

      // ⑤createLead()後のblocked判定。existingMatchの有無に関わらず、常に戻り値
      // そのもので判定する（lead-store.jsの仕様上、blocked既存Leadへの再投入でも
      // resubmittedイベントは記録済みだが、delivery_status/statusは変更されない）。
      if (isDeliveryBlocked(created)) {
        summary.blocked += 1;
        rows.push({
          line,
          category: "blocked",
          lead_id: created.lead_id,
          reason: `既存Leadのdelivery_statusが"${created.delivery_status}"のため送信対象外です`,
        });
        continue;
      }

      if (existingMatch) {
        // ⑥resubmitted判定。existingMatchが見つかっていた時点でcreateLead()は
        // 必ず同一Leadをresubmittedとして返す（新規作成にはならない）ため、
        // history末尾を検査する方式は使わず、②で取得済みのexistingMatchの
        // 真偽値だけで判定できる。
        summary.resubmitted += 1;
        rows.push({ line, category: "resubmitted", lead_id: created.lead_id, reason: `既存Leadへ再投入されました（status: "${created.status}"）` });
        continue;
      }

      // ⑦新規Lead。
      summary.created += 1;

      const formatCheck = validateFormats(record);
      if (formatCheck.ok) {
        await updateLead(created.lead_id, { status: "validated" });
        await appendHistory(created.lead_id, "validated");
        summary.validated += 1;
        rows.push({ line, category: "created", lead_id: created.lead_id });
      } else {
        await updateLead(created.lead_id, { status: "rejected" });
        await appendHistory(created.lead_id, "rejected", { reasons: formatCheck.reasons });
        summary.rejected += 1;
        rows.push({ line, category: "rejected", lead_id: created.lead_id, reason: formatCheck.reasons.join("; ") });
      }
    } catch (err) {
      summary.errors += 1;
      rows.push({ line, category: "error", reason: err.message });
    }
  }

  return { summary, rows };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** @param {{summary:Object, rows:Array<Object>}} result @param {string} csvPath */
function printResult(result, csvPath) {
  const { summary, rows } = result;
  console.log(`\n=== Lead取り込み結果: ${csvPath} ===`);
  console.log(`total: ${summary.total}`);
  console.log(`created: ${summary.created}`);
  console.log(`validated: ${summary.validated}`);
  console.log(`rejected: ${summary.rejected}`);
  console.log(`resubmitted: ${summary.resubmitted}`);
  console.log(`blocked: ${summary.blocked}`);
  console.log(`errors: ${summary.errors}`);

  const notable = rows.filter((r) => r.category !== "created" && r.category !== "validated");
  if (notable.length > 0) {
    console.log("\n--- 詳細（作成・検証成功以外） ---");
    notable.forEach((r) => {
      console.log(`行${r.line}: ${r.category}${r.lead_id ? ` (lead_id: ${r.lead_id})` : ""} - ${r.reason || ""}`);
    });
  }
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("使い方: node scripts/generator/leads/import-leads.js <csv-path>");
    process.exitCode = 2;
    return;
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`CSVファイルが見つかりません: ${csvPath}`);
    process.exitCode = 1;
    return;
  }

  const result = await importLeadsFromCsv(csvPath);
  printResult(result, csvPath);

  if (result.summary.errors > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli(main);
}

module.exports = {
  importLeadsFromCsv,
  parseCsv,
  parseCsvRows,
  checkRequiredPresence,
  validateFormats,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
};
