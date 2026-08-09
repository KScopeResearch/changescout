/**
 * filesystem-backend.js — lead-store.jsの既定バックエンド（LEAD_STORE_BACKEND未設定、
 * または"filesystem"時）。scripts/generator/logs/leads/<lead_id>.json への読み書きという、
 * 元々lead-store.jsに直接書かれていたI/Oロジックをそのまま切り出したもの。
 *
 * 【async化について】fsの同期API（readFileSync/writeFileSync/readdirSync）自体は
 * 変更していない（同期のまま、挙動もタイミングも従来と同一）。S3バックエンドが
 * 本質的に非同期（ネットワークI/O）にならざるを得ないため、lead-store.jsの公開APIを
 * バックエンドに依らず統一的にPromiseベースにする必要があり、そのために各関数を
 * `async function`でラップしている（内部の同期fs呼び出し自体はそのまま）。
 */

const fs = require("fs");
const path = require("path");

const { readJson, writeJson } = require("../../shared/json-file");
const { validateSlug, isWithinDir } = require("../../shared/path-safety");
const { LEADS_DIR } = require("../../shared/paths");

/**
 * lead_idからLead本体のファイルパスを安全に組み立てる（lead-store.jsの既存
 * leadFilePath()をそのまま移設。ロジック変更なし）。
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
 * @param {string} leadId
 * @returns {Promise<Object|null>} 存在しない場合はnull
 */
async function readLead(leadId) {
  const filePath = leadFilePath(leadId);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

/**
 * @param {string} leadId
 * @param {Object} lead
 * @returns {Promise<void>}
 */
async function writeLead(leadId, lead) {
  writeJson(leadFilePath(leadId), lead);
}

/**
 * 登録済みの全Leadを読み込む（lead-store.jsの既存listLeads()をそのまま移設。
 * ロジック変更なし。並行テスト実行時に他ファイルとの競合で読み込み前に削除された
 * エントリを安全側にスキップする挙動も維持する）。
 * @returns {Promise<Object[]>}
 */
async function listLeads() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  return fs
    .readdirSync(LEADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      try {
        return readJson(path.join(LEADS_DIR, entry.name));
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { readLead, writeLead, listLeads, leadFilePath };
