/**
 * log-rotation.js
 *
 * Task43: JSON Linesログ（scripts/generator/logs/配下）のローテーション/整理を行う
 * 共通処理。Task42の設計検討で「ログ種別ごとに性質が異なる」ことが判明したため、
 * 用途に応じて2種類の関数を用意する（単一の画一的な方式にはしない）。
 *
 *   - archiveIfOversize(): サイズ超過時に元ファイルを丸ごと退避し、新規ファイルへ
 *     切り替える。**削除は一切行わない**（admin-audit.jsonl・llm-usage.jsonl・
 *     search-usage.jsonlのような、監査・コスト分析目的で内容を失いたくないログ向け）
 *   - pruneOlderThan(): 行ごとの日時フィールドを見て、保持期間より古い行だけを
 *     取り除く（世代ファイルは作らない、in placeで書き換える）。job-history.jsonlの
 *     ようにDashboard UIが直接読む運用ログ向け。世代を跨ぐ読み込みロジックを
 *     呼び出し側に追加する必要がないよう、常に「今のファイルの中身だけで完結する」
 *     状態を保つ設計にしている
 *
 * 【既存設計との関係】appendJsonLine()（json-file.js）はシンプルな追記のみを行う
 * 設計を維持し、ローテーション判定はここに分離する（責務を過度に混ぜない）。
 * 呼び出し元（auth.js・llm-client.js・search-client.js・job-runner.js）が、
 * 追記の直前にこれらの関数を呼ぶ。
 */

const fs = require("fs");

/**
 * ファイルサイズが閾値以上なら、`<path>.archive-<timestamp>`へリネームして退避する。
 * 元のパスは以降の`appendFileSync`で自動的に新規ファイルとして再作成される
 * （`appendJsonLine()`側の既存動作をそのまま利用、ここではリネームのみ行う）。
 * 過去に作られたアーカイブファイルには一切触れない（削除・上書きしない）。
 * @param {string} filePath
 * @param {number} thresholdBytes
 */
function archiveIfOversize(filePath, thresholdBytes) {
  if (!fs.existsSync(filePath)) return;

  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch (e) {
    return; // 統計取得に失敗した場合はローテーションを諦める（書き込み自体は継続させる）
  }
  if (size < thresholdBytes) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = `${filePath}.archive-${timestamp}`;
  fs.renameSync(filePath, archivePath);
}

/**
 * JSON Linesファイルから、`retentionDays`より古い行を取り除く（in place書き換え）。
 * 各行の`dateField`（例: "created_at"）をISO8601として解釈し、しきい値以降の行のみ残す。
 * 世代ファイルは作らない（呼び出し元が「今のファイルを読めば直近の全履歴が揃っている」と
 * 期待できる状態を維持するため）。
 *
 * 【安全側の方針】JSON解析に失敗した行・日時フィールドが不正な行は削除せず残す
 * （壊れた行を理由にログを失わないため。validate-report.js等、本プロジェクト全体で
 * 「不正な値は安全側に倒す」という一貫した方針を踏襲する）。
 * @param {string} filePath
 * @param {number} retentionDays
 * @param {string} dateField
 */
function pruneOlderThan(filePath, retentionDays, dateField) {
  if (!fs.existsSync(filePath)) return;

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const kept = lines.filter((line) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      return true; // 壊れた行は消さない
    }
    const t = Date.parse(obj[dateField]);
    if (Number.isNaN(t)) return true; // 日時が不正/欠落なら消さない
    return t >= cutoffMs;
  });

  if (kept.length === lines.length) return; // 削除対象が無ければファイルに触れない
  fs.writeFileSync(filePath, kept.length ? kept.join("\n") + "\n" : "", "utf-8");
}

module.exports = { archiveIfOversize, pruneOlderThan };
