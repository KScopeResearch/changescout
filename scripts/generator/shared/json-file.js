/**
 * json-file.js
 *
 * Task18: JSON読み書きの共通化。リファクタリング前は`JSON.parse(fs.readFileSync(...))`と
 * `fs.writeFileSync(path, JSON.stringify(obj, null, 2))`が6ファイル以上に個別に
 * 書かれていた（末尾改行の有無・ディレクトリ自動作成の有無等が微妙に異なっていた）。
 */

const fs = require("fs");
const path = require("path");

/**
 * JSONファイルを読み込む（失敗時は例外を投げる）。
 * @param {string} filePath
 * @returns {Object}
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * JSONファイルを読み込む。存在しない・パース失敗時はfallbackを返す（例外を投げない）。
 * @param {string} filePath
 * @param {*} [fallback]
 * @returns {Object|*}
 */
function readJsonSafe(filePath, fallback = null) {
  try {
    return readJson(filePath);
  } catch (e) {
    return fallback;
  }
}

/**
 * JSONファイルを書き込む（2スペースインデント + 末尾改行、ディレクトリは自動作成）。
 * @param {string} filePath
 * @param {Object} obj
 */
function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

/**
 * JSON Lines形式（1行1オブジェクト）で追記する。ログファイル（llm-usage.jsonl等）用。
 * @param {string} filePath
 * @param {Object} obj
 */
function appendJsonLine(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf-8");
}

/**
 * JSON Linesファイルを配列として読み込む。存在しなければ空配列。壊れた行はスキップする。
 * @param {string} filePath
 * @returns {Object[]}
 */
function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { readJson, readJsonSafe, writeJson, appendJsonLine, readJsonLines };
