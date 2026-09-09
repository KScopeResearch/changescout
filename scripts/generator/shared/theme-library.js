/*
 * theme-library.js — Phase56 STEP5（Business Chance Engine V3.1）
 *
 * Business Chance のテーマ選定を「経営者に近いか」で採点するための、
 * 機械可読なキーワード辞書。pure data + pure helpers（副作用・外部依存なし）。
 *
 * ここに載る語は「近接テーマ Library V2」。プロンプト（quality-rules.md）の
 * 文章版と対応し、shared/business-chance-ranking.js の scorer が参照する。
 */
"use strict";

// 業界別・近接テーマ Library V2（プロンプトの Theme Library と一致）
const THEME_LIBRARY = {
  ai_dx: ["AI議事録", "AI営業", "AI問い合わせ", "AI見積り", "AI社内検索", "業務棚卸し", "RPA", "AI電話"],
  retail: ["Google口コミ", "LINE会員", "キャッシュレス", "リピート購入", "EC連携", "会員制度", "定期購入"],
  restaurant: ["モバイルオーダー", "セルフオーダー", "配膳ロボット", "多言語メニュー", "訪日客導線", "予約導線", "自動精算"],
  manufacturing: ["ベテラン退職", "技能承継", "作業標準化", "AI品質管理", "生産管理", "省人化", "IoT"],
  consulting: ["AI業務棚卸し", "補助金伴走", "営業DX診断", "現状診断", "業務可視化"],
  construction: ["2024年問題", "働き方改革関連法", "施工管理", "積算", "職人不足", "BIM"],
  healthcare: ["介護報酬改定", "オンライン診療", "処遇改善", "記録のデジタル化", "人材確保"],
  overseas: ["越境EC", "インバウンド", "多言語対応", "海外展開支援", "ローカライズ"],
  content_media: ["制作現場", "アニメーター不足", "IP企画", "共同制作", "受託脱却", "自社IP"],
};

// 顧客側に起きている変化（RULE-THEME-11）。会社自身ではなく「顧客」の変化。
const CUSTOMER_SIDE_CHANGE = [
  "採用難", "採用が難しく", "人手不足", "人件費", "人件費高騰", "最低賃金",
  "インバウンド", "訪日客", "訪日外国人",
  "LINE予約", "モバイルオーダー", "ネット予約", "オンライン予約",
  "Google口コミ", "口コミ", "レビュー",
  "AI電話", "AI接客", "チャットボット",
  "EC化", "ネット通販", "越境EC",
  "リピート率低下", "客離れ", "客数減", "来店数",
  "高齢化", "後継者不足", "事業承継",
  "価格改定", "値上げ", "原材料高",
  "キャッシュレス", "電子マネー",
  "報酬改定", "法改正", "制度改正", "2024年問題", "2025年問題",
];

// First Action が「明日の朝30分でできる」か（RULE-THEME-12）
const TOMORROW_ACTION_VERB = [
  "確認する", "確認し", "見る", "洗い出す", "洗い出し", "ヒアリング", "問い合わせ", "聞く", "聞き取り",
  "追加する", "追加し", "変更する", "変更し", "作る", "作成し", "書き出す", "リスト", "棚卸し",
  "登録する", "投稿する", "返信する", "設定する", "比較する", "数える", "調べる",
];
const VAGUE_ACTION = [
  "検討する", "検討し", "検討を", "推進する", "推進し", "調査を継続", "調査を続け",
  "強化する", "強化し", "取り組む", "目指す", "推し進める", "見直しを進め",
  "DXを検討", "AI導入を検討", "AI活用を検討", "市場調査を継続",
];

// 既知の一般論（Novelty 減点。RULE-THEME-4 / kscope 専用ルール）
const KNOWN_GENERALITY = [
  "新規事業の成功率は低い", "成功率は10", "成功企業は全体の", "10件立ち上げても",
  "DXの重要性", "DXが重要", "DX化が求められ",
  "AI導入が進んで", "AI活用が広がって", "生成AIの登場により",
  "市場は拡大して", "市場規模は成長", "デジタル化の波",
  "働き方改革が求められ", "少子高齢化が進み",
];

// 規模フィルタ（RULE-THEME-13）: Far は Hero/Title に使わない
const FAR_MARKERS = /(世界|グローバル|global|米ドル|USドル|世界経済|世界市場|国際市場)/i;
const FAR_CAGR_ONLY = /^(?:[^。]*?CAGR[^。]*)。?$/; // CAGR しか言っていない1文
const NEAR_MARKERS = /(店舗|商圏|地域|地元|沿線|商店街|個店|近隣|エリア|市内|県内|来店|常連|顧客|取引先|現場)/;
const MID_MARKERS = /(国内|日本|全国|業界|業種|同業|補助金|助成金|制度|報酬改定|法改正)/;

/** テキストに配列 words のいずれかが含まれるか。 */
function includesAny(text, words) {
  const t = String(text || "");
  return words.some((w) => t.indexOf(w) !== -1);
}

/** Near / Mid / Far のいずれか（RULE-THEME-13）。 */
function businessSizeTier(text) {
  const t = String(text || "");
  if (NEAR_MARKERS.test(t)) return "near";
  if (FAR_MARKERS.test(t)) {
    // Far マーカーがあっても、国内・業界の文脈が主なら mid 扱い
    return MID_MARKERS.test(t) && !/世界|グローバル|米ドル/.test(t.slice(0, 40)) ? "mid" : "far";
  }
  if (MID_MARKERS.test(t)) return "mid";
  return "mid"; // 判定不能は mid（Far ではない＝Hero 使用可）
}

module.exports = {
  THEME_LIBRARY,
  CUSTOMER_SIDE_CHANGE,
  TOMORROW_ACTION_VERB,
  VAGUE_ACTION,
  KNOWN_GENERALITY,
  FAR_MARKERS,
  NEAR_MARKERS,
  MID_MARKERS,
  includesAny,
  businessSizeTier,
};
