#!/usr/bin/env node
/**
 * import-leads.js — PJ2 Phase1: CSVから企業メールアドレスを取り込み、Leadを作成する。
 *
 * 「PJ2 Leadライフサイクル 実装仕様 最終確定」のPhase1（企業メールアドレス収集）に
 * 対応するCLI。leads/lead-store.jsの既存API（createLead/readLead/updateLead/
 * appendHistory/findLeadByEmail/isDeliveryBlocked）をそのまま利用し、独自の
 * Lead保存ロジックはここには持たない。
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
const { createLead, updateLead, appendHistory, findLeadByEmail, isDeliveryBlocked } = require("./lead-store");

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
 * @param {string} csvPath
 * @returns {{summary:Object, rows:Array<Object>}}
 */
function importLeadsFromCsv(csvPath) {
  const text = fs.readFileSync(csvPath, "utf-8");
  const records = parseCsv(text);

  const summary = { total: 0, created: 0, validated: 0, rejected: 0, duplicate: 0, blocked: 0, errors: 0 };
  const rows = [];

  const record0 = (idx) => idx + 2; // ヘッダーが1行目、最初のデータ行は2行目

  records.forEach((record, idx) => {
    const line = record0(idx);
    summary.total += 1;

    try {
      const email = record.email;

      // emailが空の場合は、既存Leadの検索キーすら持てないため無条件にerrorsとする。
      if (!email) {
        summary.errors += 1;
        rows.push({ line, category: "error", reason: "emailが空です" });
        return;
      }

      const presence = checkRequiredPresence(record);
      const existing = findLeadByEmail(email);

      if (existing) {
        if (isDeliveryBlocked(existing)) {
          summary.blocked += 1;
          rows.push({
            line,
            category: "blocked",
            lead_id: existing.lead_id,
            reason: `既存Leadのdelivery_statusが"${existing.delivery_status}"のため送信対象外です`,
          });
          return;
        }

        if (existing.status === "rejected") {
          if (!presence.ok) {
            appendHistory(existing.lead_id, "rejected", { reasons: [`必須項目が不足しています: ${presence.missing.join(", ")}`] });
            summary.rejected += 1;
            rows.push({ line, category: "rejected", lead_id: existing.lead_id, reason: `必須項目が不足しています: ${presence.missing.join(", ")}` });
            return;
          }
          const formatCheck = validateFormats(record);
          if (formatCheck.ok) {
            updateLead(existing.lead_id, { status: "validated" });
            appendHistory(existing.lead_id, "validated");
            summary.validated += 1;
            rows.push({ line, category: "validated", lead_id: existing.lead_id, reason: "rejectedから再検証に成功しました（同一lead_idを維持）" });
          } else {
            appendHistory(existing.lead_id, "rejected", { reasons: formatCheck.reasons });
            summary.rejected += 1;
            rows.push({ line, category: "rejected", lead_id: existing.lead_id, reason: formatCheck.reasons.join("; ") });
          }
          return;
        }

        // blockedでもrejectedでもない既存Lead（validated以降）は重複として新規作成しない。
        summary.duplicate += 1;
        rows.push({ line, category: "duplicate", lead_id: existing.lead_id, reason: `既に登録済みのLeadです（status: "${existing.status}"）` });
        return;
      }

      // 既存Leadが無い場合。
      if (!presence.ok) {
        // company_url等が無いとLeadとして作成できない（lead-store.jsの構造上の制約）ため、
        // rejectedとしてすら記録できない。errorsとして扱う。
        summary.errors += 1;
        rows.push({ line, category: "error", reason: `必須項目が不足しているためLeadを作成できません: ${presence.missing.join(", ")}` });
        return;
      }

      const created = createLead({
        email,
        company_url: record.company_url,
        source: record.source,
        collection_method: record.collection_method,
        now: record.collected_at,
        ...pickOptionalFields(record),
      });
      summary.created += 1;

      const formatCheck = validateFormats(record);
      if (formatCheck.ok) {
        updateLead(created.lead_id, { status: "validated" });
        appendHistory(created.lead_id, "validated");
        summary.validated += 1;
        rows.push({ line, category: "created", lead_id: created.lead_id });
      } else {
        updateLead(created.lead_id, { status: "rejected" });
        appendHistory(created.lead_id, "rejected", { reasons: formatCheck.reasons });
        summary.rejected += 1;
        rows.push({ line, category: "rejected", lead_id: created.lead_id, reason: formatCheck.reasons.join("; ") });
      }
    } catch (err) {
      summary.errors += 1;
      rows.push({ line, category: "error", reason: err.message });
    }
  });

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
  console.log(`duplicate: ${summary.duplicate}`);
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

function main() {
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

  const result = importLeadsFromCsv(csvPath);
  printResult(result, csvPath);

  if (result.summary.errors > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli(async () => main());
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
