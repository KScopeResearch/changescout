/**
 * retry.js
 *
 * Task18: retry + timeout の共通化。llm-client.js（Task11）とsearch-client.js（Task12）に
 * ほぼ同一のロジック（Promiseベースのハードタイムアウト + 指数バックオフでのリトライ）が
 * それぞれ個別に実装されていたため、ここへ統合した。両モジュールとも本モジュールを
 * 使うようリファクタリングし、エラーメッセージ・挙動は変更していない
 * （ハードタイムアウトの二重保証という設計意図もそのまま維持）。
 */

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fn(signal)を1回実行し、必ずtimeoutMsで確定させる。fnの実装がAbortSignalを尊重するかに
 * 関わらず、Promiseの決着を先着1回のみ有効にすることでハードタイムアウトを保証する
 * （fnがAbortSignalを尊重すれば実リクエストも中断され、無駄なコストを避けられる）。
 * @param {(signal:AbortSignal) => Promise<*>} fn
 * @param {number} timeoutMs
 * @returns {Promise<*>}
 */
function callOnceWithTimeout(fn, timeoutMs) {
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(Object.assign(new Error(`タイムアウト（${timeoutMs}ms）`), { name: "AbortError" }));
    }, timeoutMs);

    Promise.resolve()
      .then(() => fn(controller.signal))
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * fn(signal)を、timeout + 指数バックオフでのリトライ付きで実行する。
 * @param {(signal:AbortSignal) => Promise<*>} fn
 * @param {Object} options
 * @param {number} options.timeoutMs
 * @param {number} options.maxRetries
 * @param {number|((attempt:number)=>number)} [options.backoffMs] - 既定: 500 * 2^attempt
 * @param {(info:{attempt:number, maxRetries:number, message:string, delayMs:number})=>void} [options.onRetry]
 * @param {string} [options.label] - エラーメッセージに使う処理名
 * @returns {Promise<*>}
 */
async function withRetryAndTimeout(fn, options) {
  const { timeoutMs, maxRetries, backoffMs, onRetry, label } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOnceWithTimeout(fn, timeoutMs);
    } catch (err) {
      const isAbort = err && (err.name === "AbortError" || err.code === "ABORT_ERR");
      const message = isAbort ? `タイムアウト（${timeoutMs}ms）` : (err && err.message) || String(err);
      lastError = new Error(message);

      if (attempt < maxRetries) {
        const delayMs = typeof backoffMs === "function" ? backoffMs(attempt) : backoffMs || 500 * Math.pow(2, attempt);
        if (onRetry) onRetry({ attempt, maxRetries, message, delayMs });
        await sleep(delayMs);
        continue;
      }
    }
  }

  throw new Error(`${label || "処理"}が${maxRetries + 1}回とも失敗しました: ${lastError.message}`);
}

module.exports = { sleep, callOnceWithTimeout, withRetryAndTimeout };
