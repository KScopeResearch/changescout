// @ts-check
// HTML構文チェック: a lightweight, dependency-free sanity check (not a full
// HTML parser). Read-only, no browser involved.
//   - duplicate `id="..."` attributes (FAIL): a real bug, since
//     getElementById() silently returns only the first match, which several
//     of the JSON-driven render paths in mock-dashboard.html /
//     opportunity-detail.html rely on being unique.
//   - missing <!DOCTYPE html> / </html> (FAIL): signals a truncated/corrupted file.
//   - rough open/close count for <script>/<div>/<section> (WARN): a heuristic,
//     not a real parser, so it can false-positive on tags inside string
//     literals or comments — treated as WARN rather than FAIL for that reason.
const { listFiles, relPath, readText, finding } = require("./_lib");

const id = "html-syntax";
const name = "HTML構文チェック（重複ID・タグ対応の簡易検査）";

function checkDuplicateIds(text) {
  const ids = new Map();
  for (const m of text.matchAll(/\bid="([^"]+)"/g)) {
    const value = m[1];
    ids.set(value, (ids.get(value) || 0) + 1);
  }
  return [...ids.entries()].filter(([, count]) => count > 1);
}

function countTag(text, tag) {
  const openRe = new RegExp(`<${tag}(\\s|>)`, "g");
  const closeRe = new RegExp(`</${tag}>`, "g");
  const opens = (text.match(openRe) || []).length;
  const closes = (text.match(closeRe) || []).length;
  return { opens, closes };
}

function run() {
  const findings = [];
  const files = listFiles("website", [".html"]);

  for (const f of files) {
    const rel = relPath(f);
    const text = readText(f);

    if (!/<!DOCTYPE html>/i.test(text) || !/<\/html>/i.test(text)) {
      findings.push(
        finding("FAIL", "<!DOCTYPE html> または </html> が見つかりません（ファイルが途中で切れている可能性）", {
          file: rel,
          suggestion: "ファイルの先頭に<!DOCTYPE html>、末尾に</html>があるか確認し、保存が途中で切れていないか確認する",
        })
      );
    } else {
      findings.push(finding("PASS", "DOCTYPE/</html> を確認", { file: rel }));
    }

    const dupes = checkDuplicateIds(text);
    if (dupes.length) {
      for (const [value, count] of dupes) {
        findings.push(
          finding("FAIL", `id="${value}" が${count}回重複しています（getElementByIdは最初の1件しか拾わないため実バグの可能性）`, {
            file: rel,
            match: `id="${value}"`,
            suggestion: `重複している${count}箇所のうち、後発のid="${value}"を別名にリネームする（例: ${value}2, ${value}Alt 等）`,
          })
        );
      }
    } else {
      findings.push(finding("PASS", "id属性の重複なし", { file: rel }));
    }

    for (const tag of ["script", "div", "section", "button"]) {
      const { opens, closes } = countTag(text, tag);
      if (opens !== closes) {
        findings.push(
          finding("WARN", `<${tag}>の開始(${opens})と終了(${closes})の数が一致しません（簡易カウントのため誤検知の可能性あり、目視推奨）`, {
            file: rel,
            suggestion: `<${tag}>タグをエディタの対応括弧ジャンプ機能等で目視確認する（文字列リテラル内の"<${tag}"を誤検知している可能性もあり）`,
          })
        );
      }
    }
  }

  return findings;
}

module.exports = { id, name, run };
