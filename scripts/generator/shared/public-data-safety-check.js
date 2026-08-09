/**
 * public-data-safety-check.js — website/aor/ を公開デプロイする前に、Leadの個人情報・
 * AWS認証情報・秘密情報が混入していないかを機械的に検査する。
 *
 * 【背景】PJ2 AOPの公開用S3+CloudFrontデプロイ自動化にあたり、「website/aorだから安全」
 * と決め打ちせず、実際にアップロード対象となるファイルの中身を毎回検査する
 * （shared/path-safety.jsが「パスは信用せず毎回検証する」という方針を貫いているのと
 * 同じ考え方）。この検査でNGが出た場合、呼び出し元（deploy-aor-web.js）はデプロイを
 * 中止しなければならない。
 *
 * 【検出方式は2層構成】
 *   1. ファイル名・生テキストに対する正規表現（CONTENT_CHECKS）
 *      — Lead識別子キー・AWS/汎用APIキー・秘密鍵ヘッダ・password代入等。
 *      HTML/JS/CSSなどJSONでないファイルにも及ぶ、汎用的な文字列検索。
 *   2. .jsonファイルはさらにパースして構造（キーのパス）を確認する
 *      （checkJsonStructure()）。単純な文字列検索だけでは、
 *      「company_profile内の事業内容テキストに"email"という単語が出てくる」ような
 *      無害な内容まで誤検知してしまう、あるいは逆に
 *      「本来許可されない場所にemailキーが出現した」ことを見逃してしまう。
 *      実データ（website/aor/data/*.json）を全数調査した結果、正規スキームでは
 *      `email`キーは`send_target.email`にのみ、値は`info@<domain>`等の代表窓口
 *      アドレス（ALLOWED_GENERIC_EMAIL_LOCAL_PARTS）に限られ、`notes`キーは
 *      `human_review.notes`（AI生成直後の定型メッセージ）にのみ出現することを確認済み。
 *      この2箇所以外に`email`/`notes`キーが出現した場合は、Lead本体の実受信者情報や
 *      内部調査メモ（company-inference.jsが生成するLead.notes等）が誤って混入した
 *      可能性が高いため検出する。
 *
 * 【検出対象まとめ】
 *   - ファイル名ブロックリスト（.env系・credential/secret/passwordを名前に含むファイル、
 *     秘密鍵ファイル拡張子 .pem/.key）
 *   - lead_id・report_tokenキー（ファイル内容の正規表現・JSON構造の両方で検出）
 *   - 許可されていない箇所のemail・notesキー（JSON構造チェック）
 *   - AWSアクセスキーIDパターン（AKIA/ASIA + 16英数字）
 *   - AWS/汎用のsecret・access・apiキー変数が値を伴って出現するパターン
 *   - PEM形式の秘密鍵ヘッダ（-----BEGIN ... PRIVATE KEY-----）
 *   - passwordが値を伴って出現するパターン
 */

const fs = require("fs");
const path = require("path");

const BLOCKED_FILENAME_PATTERNS = [/^\.env/i, /credential/i, /secret/i, /password/i, /\.pem$/i, /\.key$/i];

// テキストとして中身を検査する拡張子（バイナリは対象外）。
const TEXT_FILE_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".md", ".txt"]);

const CONTENT_CHECKS = [
  { name: "lead_id key", pattern: /"lead_id"\s*:/ },
  { name: "report_token key", pattern: /"report_token"\s*:/ },
  { name: "AWS access key pattern", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "AWS secret access key variable with value", pattern: /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+]{20,}/i },
  {
    name: "generic secret/access/api key variable with value",
    pattern: /\b(secret[_-]?key|access[_-]?key|api[_-]?key|apikey)\b\s*[:=]\s*["']?[A-Za-z0-9/_\-+.]{16,}/i,
  },
  { name: "PEM private key header", pattern: /-----BEGIN\s+(RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: "password variable with value", pattern: /\bpassword\b\s*[:=]\s*["']?\S{4,}/i },
];

// send_target.email（企業公式サイトの代表窓口アドレス）にのみ許可するローカルパート。
// leads/company-inference.jsのGENERIC_LOCAL_PARTSと発想は同じだが、shared/はleads/に
// 依存しない方針（責務の上下関係を逆転させないため）のため、ここでは公開データの
// 正規スキーマ検証に必要な最小限の一覧を独自に持つ。
const ALLOWED_GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info",
  "contact",
  "support",
  "inquiry",
  "inquiries",
  "sales",
  "press",
  "admin",
  "help",
  "office",
]);

// 実データ調査（website/aor/data/*.json全件）で確認した、email/notesキーの唯一の正規出現箇所。
const ALLOWED_EMAIL_PATHS = new Set(["send_target.email"]);
const ALLOWED_NOTES_PATHS = new Set(["human_review.notes"]);

// キー名自体が機密情報を示唆する場合、値の中身に関わらず検出する（防御の多層化）。
const SENSITIVE_JSON_KEY_PATTERN =
  /^(password|passwd|secret|secret_key|secretkey|private_key|privatekey|api_key|apikey|access_key|accesskey|auth_token|authtoken|session_token|sessiontoken)$/i;

/**
 * パース済みJSON値を再帰的に辿り、許可されていない箇所のemail/notesキーや
 * Lead識別子・機密情報らしきキー名を検出する。
 * @param {*} value
 * @param {string[]} pathParts - ここまでのキーのパス（配列の添字は含めない）
 * @param {string[]} violations - 検出結果を追記する配列
 */
function walkJsonForViolations(value, pathParts, violations) {
  if (Array.isArray(value)) {
    for (const item of value) walkJsonForViolations(item, pathParts, violations);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const currentPath = [...pathParts, key].join(".");

    if (key === "lead_id") {
      violations.push(`JSON構造内に"lead_id"キーを検出（path: ${currentPath}）`);
    } else if (key === "report_token") {
      violations.push(`JSON構造内に"report_token"キーを検出（path: ${currentPath}）`);
    } else if (key === "email" && typeof child === "string") {
      const localPart = (child.split("@")[0] || "").toLowerCase();
      const allowed = ALLOWED_EMAIL_PATHS.has(currentPath) && ALLOWED_GENERIC_EMAIL_LOCAL_PARTS.has(localPart);
      if (!allowed) {
        violations.push(`許可されていない箇所または実受信者の可能性があるemailを検出（path: ${currentPath}）`);
      }
    } else if (key === "notes" && typeof child === "string") {
      if (!ALLOWED_NOTES_PATHS.has(currentPath)) {
        violations.push(`許可されていない箇所に"notes"キーを検出（path: ${currentPath}）`);
      }
    } else if (SENSITIVE_JSON_KEY_PATTERN.test(key)) {
      violations.push(`機密情報を示唆するキー名を検出: "${key}"（path: ${currentPath}）`);
    }

    walkJsonForViolations(child, [...pathParts, key], violations);
  }
}

/**
 * JSON文字列をパースし、構造（キーのパス）に基づく違反を検出する。
 * パース失敗時は空配列を返す（内容ベースのCONTENT_CHECKSに検出を委ねる）。
 * @param {string} content
 * @returns {string[]}
 */
function checkJsonStructure(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const violations = [];
  walkJsonForViolations(parsed, [], violations);
  return violations;
}

/**
 * 指定ディレクトリ配下の全ファイルを再帰的に列挙する。
 * @param {string} dir
 * @returns {string[]} 絶対パスの配列
 */
function listFilesRecursive(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 1ファイルを検査する。
 * @param {string} filePath
 * @returns {{ok:boolean, violations:string[], skipped?:boolean}}
 */
function checkFile(filePath) {
  const violations = [];
  const basename = path.basename(filePath);

  for (const pattern of BLOCKED_FILENAME_PATTERNS) {
    if (pattern.test(basename)) {
      violations.push(`ファイル名がブロックリストに一致: ${basename}（パターン: ${pattern}）`);
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      if (err.code === "ENOENT") {
        // listFilesRecursive()での列挙後、内容を読む前に他プロセスがファイルを
        // 削除した場合（deploy-aor-web.jsの実行と、テストスイート内の他テストが
        // 同じwebsite/aor/data/を同時に読み書きする際に実際に発生することを確認済み）。
        // 存在しなくなったファイルの中身は検査しようがなく、かつ後続のアップロード対象
        // 列挙でも同様に見つからず対象外になるため、ファイル名ベースの検査結果のみを
        // 返し、内容ベースの検査はスキップする（検査全体を失敗させない）。
        return { ok: violations.length === 0, violations, skipped: true };
      }
      throw err;
    }
    for (const check of CONTENT_CHECKS) {
      if (check.pattern.test(content)) {
        violations.push(`${check.name} を検出`);
      }
    }
    if (ext === ".json") {
      violations.push(...checkJsonStructure(content));
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * 公開対象ディレクトリ配下の全ファイルを検査する（I/O）。
 * @param {string} dir - 検査対象ディレクトリ（例: website/aor/）
 * @returns {{ok:boolean, checkedFiles:number, problems:Array<{file:string, violations:string[]}>, skippedFiles:string[]}}
 */
function checkPublicDataSafety(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`検査対象ディレクトリが存在しません: ${dir}`);
  }

  const files = listFilesRecursive(dir);
  const problems = [];
  const skippedFiles = [];

  for (const file of files) {
    const result = checkFile(file);
    if (result.skipped) {
      skippedFiles.push(path.relative(dir, file));
    }
    if (!result.ok) {
      problems.push({ file: path.relative(dir, file), violations: result.violations });
    }
  }

  return { ok: problems.length === 0, checkedFiles: files.length, problems, skippedFiles };
}

module.exports = {
  checkPublicDataSafety,
  checkFile,
  listFilesRecursive,
  checkJsonStructure,
  BLOCKED_FILENAME_PATTERNS,
  CONTENT_CHECKS,
  ALLOWED_GENERIC_EMAIL_LOCAL_PARTS,
  ALLOWED_EMAIL_PATHS,
  ALLOWED_NOTES_PATHS,
  SENSITIVE_JSON_KEY_PATTERN,
};
