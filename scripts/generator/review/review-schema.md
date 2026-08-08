# review-schema.md — review.json スキーマ定義（Task13）

## これは何か

`report.json`（AI生成レポート、`schema_version 2.4`）とは**別ファイル**として、
`scripts/generator/output/<slug>/review.json` に保存する、人間レビューの状態管理用データ。

**設計方針（重要）**: `report.json`には既に`human_review`という埋め込みフィールドが
存在するが（`status`/`reviewer`/`reviewed_at`/`checklist`/`notes`/`review_history`）、
これは「AI生成レポートの一部としての簡易的なレビュー状態」であり、Task13で新設する
`review.json`とは**意図的に分離**している。理由:

1. `report.json`の構造（schema_version 2.4）を変更しないというプロジェクトルールを守るため
2. レビューworkflow（コメント・修正指示・監査履歴）は将来DB移行を見据えた独立コンポーネントとして
   設計すべきであり、AI生成物のスキーマに混ぜ込むべきではないため
3. `report.json`は「AIパイプラインの出力」、`review.json`は「人間の判断の記録」という
   責務の違いを明確にするため

**既知の特性（バグではない）**: `review.json`の`status`が`approved`になっても、
`report.json`側の`human_review.status`は自動更新**されない**。

### 同期方針の最終決定（Task14）

Task13で保留にしていた「`review.json` → `report.json.human_review`を同期するか」について、
Task14で**「同期しない」**と決定した。理由:

1. **enumの非互換**: `review.json`の`status`は4値（`pending_review`/`approved`/
   `needs_revision`/`rejected`）だが、`report.json`の`human_review.status`は3値
   （`rejected`を持たない）。同期しようとすると、(a) `report.json`のスキーマに`rejected`を
   追加する（`schema_version 2.4`を変更しないというプロジェクトルールに反する）か、
   (b) `rejected`→`needs_revision`に丸めて書き込む（情報が失われる、非可逆）かの
   いずれかを選ぶ必要があり、両方とも望ましくない
2. **双方向同期の複雑さ**: `report.json`側が手動編集される可能性を考えると、一方向コピーだけでは
   不十分で、競合解決（どちらが正か）まで設計する必要が生じる。Phase1 MVPの
   「画面より設計を優先する」という方針に対して過剰投資になる
3. **責務分離の一貫性**: Task13の設計方針（上記1〜3）を継続する方が、`review.json`を
   将来DBへ移行する際の見通しも良い（`report.json`は常にAIパイプラインの生成時スナップショット、
   `review.json`が唯一のレビュー状態の正、という単純なモデルを保てる）

**この決定の実際の影響**: Review Dashboard（`website/aor-admin/`）の詳細画面では、
`report.evaluation.improvements`（生成時点の`human_review.status`を参照して作られる）が
「human_reviewが未着手です」と表示され続ける一方、`review.json`側は既に`approved`になっている、
という一見矛盾する表示が起こりうる。UIにはこの点を説明する注記を表示している
（`website/aor-admin/public/assets/js/detail.js`）。将来的に`report.json`側のフィールドを
本当に一本化したい場合は、`human_review`自体を`report.json`から削除し`review.json`に
一本化する（v2.4の次のメジャースキーマ改定として扱う）方が、中途半端な同期より健全である。

## ファイル配置

```
scripts/generator/output/<slug>/
├── company_context.json
├── report.json
├── evaluation.md
└── review.json          … Task13で追加
```

## トップレベル構造

```json
{
  "schema_version": "review-1.0",
  "report_id": "generated-example.com",
  "reviewer": null,
  "reviewed_at": null,
  "status": "pending_review",
  "comments": [],
  "fixes": [],
  "history": []
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `schema_version` | string | review.json自体のスキーマバージョン（`report.json`のschema_versionとは独立） |
| `report_id` | string | 対応する`report.json`の`id`フィールドと一致させる |
| `reviewer` | string\|null | 直近の操作を行ったレビュー担当者。`pending_review`のままなら`null` |
| `reviewed_at` | string(ISO8601)\|null | 直近の`status`変更日時 |
| `status` | string | 下記「statusの状態遷移」を参照 |
| `comments` | array | 自由記述のコメントログ（`status`変更を伴わない） |
| `fixes` | array | 修正指示のリスト（`needs_revision`時に使うことが多い） |
| `history` | array | すべての操作の監査ログ（承認・差し戻し・コメント・修正指示追加） |

## statusの状態遷移

```
pending_review ──approve──────→ approved
       │                            │
       ├──reject──────────────→ rejected
       │
       └──requestRevision────→ needs_revision ──approve──→ approved
                                       │              │
                                       └──reject───────┴──→ rejected
```

- `pending_review`: AI生成直後、誰もレビューしていない初期状態
- `approved`: 承認済み。`quality-evaluator.js`の`evaluation.status !== "FAIL"`と合わせて
  `publishable`判定に使う（review-engine.jsの`isPublishable()`）
- `needs_revision`: 差し戻し。`fixes[]`に具体的な修正指示を伴うことが多い
- `rejected`: 却下（`report.json`側の`human_review.status`の3値にはない、review.json独自の状態。
  「一旦差し戻して直せば通る」ではなく「この分析結果自体を使わない」という強い却下を表す）

いずれの状態からも`approve`/`reject`/`requestRevision`を呼び出し可能（状態機械としては
厳密に遷移を制限していない。差し戻し後に承認、承認後に問題が見つかり却下、等の
現実的なレビューフローを許容するため）。

## `comments[]`

```json
{ "id": "c-1", "at": "2026-08-06T10:00:00+09:00", "actor": "ops-1", "text": "evidenceの出典日付を確認してください" }
```

## `fixes[]`

```json
{ "id": "f-1", "at": "2026-08-06T10:00:00+09:00", "actor": "ops-1", "description": "業界団体調査の発行年を最新版に更新", "resolved": false }
```

`resolved`は現時点では`addFix()`時に常に`false`で追加される（Task13時点では「解決済みにする」
専用の操作は未実装。次Taskへの申し送り事項）。

## `history[]`

すべての操作（`approve`/`reject`/`requestRevision`/`addComment`/`addFix`）で1件追加される、
監査ログ。

```json
{ "at": "2026-08-06T10:00:00+09:00", "actor": "ops-1", "action": "approved", "from_status": "pending_review", "to_status": "approved", "comment": "内容確認済み。送信可。" }
```

| フィールド | 型 | 説明 |
|---|---|---|
| `at` | string(ISO8601) | 操作日時 |
| `actor` | string | 操作を行った人（またはシステム） |
| `action` | string | `approved`\|`rejected`\|`revision_requested`\|`comment_added`\|`fix_added` |
| `from_status` / `to_status` | string\|null | statusを変更する操作の場合のみ。`comment_added`/`fix_added`はstatusを変えないため`null` |
| `comment` | string\|null | 操作に添えたコメント（あれば） |

## `publishable`判定（Task5、Task36で条件追加）

`review.json`自体には`publishable`フィールドは**保持しない**（`report.json`の`evaluation`と
組み合わせて都度算出する派生値のため、永続化すると二重管理になり不整合の元になる）。
`review-engine.js`の`isPublishable(review, evaluation, report)`が算出する。

```
publishable = (review.status === "approved")
              AND (evaluation.status !== "FAIL")
              AND (report.meta.generated_at が review.reviewed_at より後ではない)
```

**3つ目の条件（Task36で追加）**: Task29の実運用監査で、承認済み（`review.status === "approved"`）
のレポートを同一slugで再生成しても、`review.json`の承認状態が自動的には無効化されないという
既知の制約が判明していた。これに対応するため、`report.meta.generated_at`（レポート生成日時）が
`review.reviewed_at`（直近レビュー日時）より**後**の場合（＝承認後にレポートが再生成された
可能性がある場合）は`publishable = false`とする。日時比較は文字列比較ではなく`Date.parse()`
による数値比較で行い、いずれかの日時が不正な形式の場合・`review.reviewed_at`が存在しない場合は
比較不能として安全側（`false`）に倒す。同時刻（`generated_at === reviewed_at`）は「後に
再生成された」とは言えないため許可する。

`report`（第3引数）は省略可能。省略した場合はこの3つ目の条件を評価せず、Task36以前と同じ
2条件のみで判定する（既存呼び出し元との後方互換性のため）。`report.json`・`review.json`の
JSON構造自体は変更していない（いずれも既存フィールドの比較のみで実現）。

## バリデーション（Task6）

`scripts/generator/validate-report.js`に追加した`validateReview(review)`が以下を検証する
（詳細はvalidate-report.js本体のJSDoc参照）:

- `review`オブジェクトの存在
- `status`が4値のいずれかであること
- `pending_review`以外では`reviewer`が必須であること
- `reviewed_at`（存在する場合）がISO8601形式であること
- `comments`/`fixes`/`history`が配列であること
- `history[]`各要素の`at`（ISO8601）・`action`の必須チェック
