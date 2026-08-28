/**
 * blastengine-webhook-handler.js — PJ2 AOR Phase48 STEP2A: blastengine Webhook受信
 * Lambdaのエントリポイント。AWS Lambda Handlerを既存Lambda群と同じ `lambda/` 配下・
 * 同じ命名規約（`lambda/<name>-handler.handler`）へ揃えるための薄いラッパー。
 *
 * 【設計方針】ロジック・トランスポート層の実装は一切ここに持たない。本体は既に
 * `scripts/generator/leads/lambda-blastengine-webhook-handler.js`（Phase47 STEP1で
 * 実装済み。メソッド確認・Basic認証・JSON parse・HTTPステータス組み立て）にあり、
 * そのモジュールをそのまま再エクスポートするだけ。本ファイル追加に伴い、既存の
 * `leads/lambda-blastengine-webhook-handler.js` の本体ロジックは一切変更していない。
 *
 * 【AWS Lambda設定】
 *   - Handler: lambda/blastengine-webhook-handler.handler
 *   - 想定イベント形式・Webhook Security（HTTPS / Basic認証 / IPホワイトリスト）・
 *     必要な環境変数は本体モジュール
 *     （leads/lambda-blastengine-webhook-handler.js）の冒頭コメントを参照。
 */

module.exports = require("../leads/lambda-blastengine-webhook-handler");
