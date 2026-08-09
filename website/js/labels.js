// Shared label dictionaries for CompanyProfile fields
// (docs/strategy/technical_debt/01_duplicate_code.md D3).
//
// industryLabels intentionally has no "other" key: "other" is an internal
// classification only and must never surface as literal text (e.g. in the
// "${industry}向け..." heading pattern). Pages that need to display "other"
// as a value (rather than build a "${industry}向け" phrase) handle that case
// locally on top of this dict, since the right fallback text differs by context
// (e.g. profile-complete.html shows "その他", opportunity-detail.html's AI
// Transparency panel shows "登録情報ベース").
const industryLabels = {
  "it-dx": "IT・DX支援",
  construction: "建設",
  professional: "士業",
  manufacturing: "製造業",
  ec: "EC事業者",
  "freelance-dev": "フリーランス開発者",
  consultant: "経営コンサルタント",
};

const regionLabels = {
  nationwide: "全国",
  kanto: "関東",
  kansai: "関西",
  chubu: "中部・東海",
  kyushu: "九州・沖縄",
  other: "その他",
};
