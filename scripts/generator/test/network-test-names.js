/**
 * network-test-names.js
 *
 * Task19: 実ネットワークI/Oを伴うテストの名前を、テスト本体（generator.test.js）とは
 * 独立したファイルとして定義する。
 *
 * 【重要】generator.test.js を直接 require() すると、node:testの test() 呼び出しが
 * その場で実行登録されてしまう（node --test 経由の実行とは別に、requireした側の
 * プロセスでも動いてしまう）。run-all-tests.js は「ネットワーク依存テストの名前」だけを
 * 参照したいので、実行副作用のないこの小さな定数ファイルを間に挟んでいる。
 */

const NETWORK_TEST_NAME = "generateCompanyReport: https://example.com に対してschema準拠のreport.jsonを生成する";

module.exports = { NETWORK_TEST_NAME };
