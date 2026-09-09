/**
 * ab-i-theme-regression.test.js — Phase56 STEP5
 * ab-i の距離4品質を V3.1 でも維持する（保護ルール）。再生成はしない。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scoreCandidate } = require("../shared/business-chance-ranking");
const { businessSizeTier } = require("../shared/theme-library");
const fs = require("fs");
const path = require("path");

/* Phase56 STEP4 で再生成された ab-i の新テーマ相当（距離4を維持したい形）。 */
const ABI_GOOD = {
  title: "日中アニメ共同制作の企画・プロデュース支援サービス立ち上げ",
  why_now:
    "アニメ制作現場ではアニメーター不足が深刻化し、2026年には市場が5年ぶりに縮小する可能性が指摘されています。制作会社の間では受託依存から脱却し自社IPを保有する動きが広がっており、日中両方に精通したプロデュース支援の需要が高まっています。",
  why_company:
    "日本と中国のアニメ番組の企画・制作・プロデュースを手掛けてきた実績があり、日中両市場の制作・配信・ライセンスに精通しています。",
  market_change:
    "アニメ産業市場は2024年に3兆8,407億円と過去最高を更新し、アニメーター不足や制作コスト高騰で「利益なき繁忙」が続いています。制作会社は製作委員会への出資など受託依存からの脱却を進めています。",
  first_action: "経済産業省のIP360補助金の第3回公募スケジュールを確認し、社内プロジェクトチームを組成する。",
  evidence: [{ source_id: "src-1" }, { source_id: "src-3" }, { source_id: "src-4" }, { source_id: "src-14" }],
};

/* 退行した場合の形（世界アニメ市場が主語）。これは低スコアであってほしい。 */
const ABI_BAD = {
  title: "世界アニメ市場向けIP展開支援",
  why_now:
    "経済産業省は2033年までに海外アニメ市場を約6兆円へ拡大する目標を掲げ、2024年の海外市場規模は2.17兆円で、CAGRは2桁成長です。",
  why_company: "アニメの企画・制作を行っています。",
  market_change: "世界の海外アニメ市場は今後も拡大が見込まれます。",
  first_action: "海外展開の可能性を検討する。",
  evidence: [{ source_id: "src-20" }],
};

test("ab-i: 良テーマ（アニメ産業・アニメーター不足・受託脱却）は distance>=80・near", () => {
  const s = scoreCandidate(ABI_GOOD);
  assert.ok(s.total >= 80, "total=" + s.total + " " + JSON.stringify(s.breakdown));
  assert.notEqual(s.tier, "far");
});

test("ab-i: 良テーマの why_now / title は Far ではない（日本のアニメ産業＝mid or near）", () => {
  assert.notEqual(businessSizeTier(ABI_GOOD.title + ABI_GOOD.why_now), "far");
});

test("ab-i: 退行テーマ（世界アニメ市場を6兆円へ）は Far・低スコア", () => {
  const bad = scoreCandidate(ABI_BAD).total;
  const good = scoreCandidate(ABI_GOOD).total;
  assert.equal(businessSizeTier(ABI_BAD.title + ABI_BAD.why_now), "far");
  assert.ok(bad < good - 20, "bad=" + bad + " good=" + good);
  assert.equal(scoreCandidate(ABI_BAD).acceptable, false);
});

test("ab-i: prompts に保護ルール（海外アニメ市場を主語にしない）がある", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "prompts", "quality-rules.md"), "utf-8");
  assert.match(qr, /ab-i 保護/);
  assert.match(qr, /海外アニメ市場を○兆円へ/);
  assert.match(qr, /アニメーター不足/);
});
