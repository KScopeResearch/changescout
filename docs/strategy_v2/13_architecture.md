# 13_architecture.md — 将来アーキテクチャ

**注: 本ドキュメントは将来構想の設計メモであり、現時点での実装を意味しない。
`website/` 配下への変更は本フェーズでは一切行わない。**

## コンポーネント構成（構想）

```
[リード管理]  ターゲットリスト・オプトイン記録・送信履歴の管理
     ↓
[企業解析エンジン]  ドメイン→HP取得→構造化データ抽出（04_company_analysis.md）
     ↓
[市場変化データベース]  ChangeScoutと共有する変化データ（法改正・補助金・ニュース等）
     ↓
[AIパイプライン]  業種推測→関連度判定→Opportunity/Action生成→メール生成（05_ai_pipeline.md）
     ↓
[レビューキュー]  人間の承認待ちドラフトを管理するワークフロー（06_human_review.md）
     ↓
[送信基盤]  メール配信、到達率・開封・クリックのトラッキング
     ↓
[レポートページ]  無料/有料レポートの表示、登録フォーム（07/08/10）
     ↓
[分析・モニタリング]  KPIダッシュボード、監査ログ
```

## ChangeScoutとの資産共有ポイント

- **市場変化データベース**: ChangeScoutの分析エンジンが参照するデータと、AORが参照する
  データは本質的に同じものになりうる。`database/opportunities.csv` のようなデータ資産を
  両プロダクトで共有できれば、開発コストと精度の両方にレバレッジが効く
  （PROJECT.mdの「Reusable Assets」原則に合致）
- **企業解析エンジン**: AORで開発する「ドメイン→企業情報」の解析エンジンは、
  ChangeScoutの「プロフィール入力」を補助・自動補完する機能としても転用できる可能性がある
  （入力の手間を減らす方向での統合）

## データフロー上の注意点

- レビューキューを経由しない自動送信経路を作らない（[06_human_review.md](06_human_review.md)の原則を
  アーキテクチャレベルで強制する）
- オプトイン/オプトアウト状態を単一の真実源（Single Source of Truth）で管理し、
  送信基盤がこれを必ず参照する設計にする（誤送信防止、[14_risk.md](14_risk.md)）

## メール送信アーキテクチャ v1.2

Phase44でSmartlead・blastengine双方から書面回答を受領したことを受け、Initial AOR・Weekly AORの
送信Provider構成を正式仕様として記録する（回答原文・詳細な許容/条件事項は
[docs/external-provider-confirmations.md](../external-provider-confirmations.md)参照）。

**v1.1での変更点（Phase47 STEP1）**: blastengine Webhookの正式仕様回答（2026-08-28受領）を踏まえ、
6〜9節（Webhook Security・Event Mapping・SOFTERROR仕様・重複Webhook仕様）を追加した。1〜5節は
v1.0から変更していない。

**v1.2での変更点（Phase47 STEP2）**: STEP1時点では「実装未確定」としていた重複Webhookの冪等化と、
同一emailの複数Lead時の挙動をローカル実装・確定した。9節（重複Webhook仕様）を実装内容に合わせて
更新し、新規10節（Lead単位のSuppression）を追加した。これらはblastengineの正式回答（外部事実）では
なく、PJ2側の設計判断であることを明示するため、各節に根拠を記載する。1〜8節は無変更。

**v1.5での変更点（Phase48 STEP14〜18）**: 初回AOR送信基盤を AWS 上で SES → blastengine へ切替デプロイ
（`pj2-aor-initial-report-delivery` Lambda、2026-08-28）。2026-08-28 に AWS 実環境から blastengine 経由で
初回AORを1通実送信し `delivery_id` 採番・受信まで確認。Webhook 受信 Lambda（`pj2-aor-blastengine-webhook`）は
STEP12 の公式構造対応パーサを含めてデプロイ済み。運用方針（実Webhook未受信のまま運用開始・意図的バウンスは実施しない・
IP制限は当面 HTTPS+Basic認証のみで `aws:SourceIp` 不採用・retry は別課題・Test Lead 残置）を
新規11節に **Phase48 STEP18 での確定事項**として整理した。1〜10節の設計は無変更。

**v1.4での変更点（Phase48 STEP12）**: blastengine公式Webhookマニュアル（https://blastengine.jp/webhook/ 、
Phase48 STEP11で確認）に掲載されている実payload構造が、Phase47実装時に仮定していたflat構造
（`events[].{type,datetime,mailaddress,...}`）ではなく、`events[].event.{type,datetime,detail{...}}`と
ネストしていることが判明した。7節に公式payload構造を追記し、受信Parser（`process-blastengine-event.js`
の`parseBlastengineEvent()`）を公式構造へ合わせて修正した（PJ2側の実装変更。正規化後の内部イベント
形式・Event Mapping・冪等キーは無変更）。**なお本修正時点では実Webhookをまだ受信していないため、
「公式マニュアル記載の構造」への適合であって「実受信payload」での検証は次STEP以降**。

**v1.3での変更点（Phase48 STEP7〜8）**: blastengine Transaction APIへの実疎通検証（2026-08-28、
テスト宛先へ2通のみ送信し成功`delivery_id`を確認）で判明した2点を反映し、4節（オプトアウト仕様）を
更新した。(a) `list_unsubscribe.mailto`はbare email addressではなく`mailto:`スキーム付きURIが必須で
あること、(b) 実際のエラーレスポンスは`error_messages.<field>.<subfield>`のネストしたオブジェクト
形式であること。いずれもblastengineの書面回答ではなく実APIで観測した事実であり、
[docs/external-provider-confirmations.md](../external-provider-confirmations.md)「4. blastengine 実API疎通検証で観測した事実」に一次記録がある。
これに対するコード側の対応（`normalizeMailto()`・`flattenErrorMessages()`）はPJ2側の設計判断。
1〜3節・5〜10節は無変更。

### 1. Provider構成

| メール種別 | Provider | 送信条件 |
|---|---|---|
| Initial AOR | blastengine API | 公開メールアドレス宛・企業ごとの個別レポート・初回接触として原則1回のみ |
| Weekly AOR | Amazon SES API | 本人が明示的にオプトインした宛先のみ・定期配信 |

InitialとWeeklyは異なる送信用途であり、異なる送信ポリシーを持つ。両者は別の送信基盤・別の送信条件で
運用し、一方の変更が他方の送信ポリシーへ影響しないようにする。

### 2. Provider選定理由

**Initial AOR = blastengine API**
- blastengine確認済み利用ポリシーに適合（`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」参照）
- 初回・個別送信という用途に合致
- 対象は公開アドレスであり、一斉メルマガ用途ではない

**Weekly AOR = Amazon SES API**
- 受信者本人の明示的なオプトイン後にのみ送信
- Lambdaによるスケジュール配信を想定した定期配信基盤

**blastengineの許可は無条件ではない**: blastengineからの回答は、Provider構成表に記載した利用パターン（公開アドレス・個別レポート・原則1回のみ、外部購入リストではない、苦情/バウンス後は送信しない）に加えて、本ドキュメント3節（共通Suppression）・4節（オプトアウト仕様）・5節（ドメインウォームアップ仕様）に記載する条件の実装・遵守を実質的な前提条件として提示している（詳細は`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」の「必須条件として要求した事項」参照）。

※ 上記はいずれも各Providerの運用ポリシー・利用規約との整合性に基づく記載であり、法律上の適法性評価ではない。

### 3. 共通Suppression仕様

Provider（blastengine／Amazon SES）を問わず、送信前に以下のSuppression状態を確認する共通レイヤーを
設計原則とする。

- Bounce
- Complaint
- Unsubscribe

いずれかに該当する宛先には、使用するProviderにかかわらず送信しない。実装方法は本ドキュメントの対象外とする。

### 4. オプトアウト仕様

**Initial AOR**:
- 配信停止導線をメール本文へ記載する
- blastengineの`list_unsubscribe`フィールド（`{mailto?, url?}`）でList-Unsubscribe相当を付与する（実装済み）

**Weekly AOR**（Phase49 STEP5でメール側を実装）:
- 配信停止導線をメール本文へ記載する（text/html両方に配信停止リンク。返信ベースの停止も併記）
- SESv2 `Content.Simple.Headers` で `List-Unsubscribe` ヘッダーを付与する（`ses-client.js` を拡張。
  URL・ヘッダー値は Initial と同じ `unsubscribe-url.js` の `buildUnsubscribeUrl()` / `buildListUnsubscribeHeaders()` を使用）
- RFC 8058 の `List-Unsubscribe-Post`（真のワンクリック）は **`oneClick: false` で未付与**。現在の配信停止URLは
  静的な確認ページであり MUA からの直接 POST を処理しないため（付けると誤って「停止完了」と表示される）。
  POST を受けて即座に配信停止する軽量エンドポイントを用意したら `oneClick: true` へ戻す
- **残ギャップ（配線）**: `unsubscribe.html` が POST する `LEAD_API_BASE_URL` は `common.js` でプレースホルダ
  （`http://localhost:4700`）。`website/aor-lead-api` は本番未デプロイ、`unsubscribe.html` 等の静的ファイルも
  配信サイトへ未デプロイ。このためメール内リンク／`List-Unsubscribe` を辿っても end-to-end の配信停止まで
  到達しない（Initial 側も同様）。現状 end-to-end で機能するのは返信ベースのみ。
  - **Phase49 STEP6**: 配線方式を確定（Lambda + Function URL、blastengine-webhook と同じ薄い HTTP アダプター方針）。
    `website/aor-lead-api/server.js` から `requestListener(req, res)` を切り出し、`scripts/generator/lambda/lead-api-handler.js`
    （Function URL v2 イベント ⇔ Node req/res 変換）を実装・ローカルテスト済み（`test/lambda-lead-api-handler.test.js`
    9件 pass）。**残るのはデプロイ**（新 Lambda `pj2-aor-lead-api` + Function URL + 環境変数、`common.js` の
    `LEAD_API_BASE_URL` 書き換え、サイト再デプロイ）。次 STEP で実施

#### blastengine `list_unsubscribe` の仕様分離（Phase48 STEP7〜8）

| 区分 | 内容 |
|---|---|
| **blastengine公式仕様**（APIドキュメント記載） | List-Unsubscribeは汎用`headers`キーではなく`list_unsubscribe: {mailto?, url?}`という専用フィールド。`mailto`・`url`はいずれも任意。DKIM設定必須・データサイズ目安980byte以内 |
| **実APIで観測した事実**（2026-08-28、実疎通検証。書面回答ではない） | (a) `list_unsubscribe.mailto`にbare email address（例: `aor-report@changescout.jp`）を渡すとHTTP 400 `{"error_messages":{"list_unsubscribe":{"mailto":["{validation.pattern.error}"]}}}`。`mailto:`スキーム付きURI（`mailto:aor-report@changescout.jp`）が必須。(b) `url`のみ、または`mailto:`付きなら200が返り`delivery_id`を採番。(c) エラーレスポンスはPhase45時点で想定していた`error_messages.main`配列だけでなく、`error_messages.<field>.<subfield>: string[]`のネストしたオブジェクト形式でも返る |
| **PJ2側の設計判断**（コード実装） | `blastengine-client.js`に`normalizeMailto()`を追加し、呼び出し側がbare emailを渡しても送信前に`mailto:`を付与して正規化する（呼び出し側`send-initial-report.js`は変更不要）。エラー抽出は`flattenErrorMessages()`でネストした`error_messages`を再帰的に平坦化し、フィールドパス付きメッセージ（`list_unsubscribe.mailto: ...`）を得る。APIキー・Authorization・Bearerトークン・リクエストボディ・PIIはエラーメッセージへ含めない |

Weekly AOR側の `List-Unsubscribe` ヘッダー・本文リンクは Phase49 STEP5 で実装済み（上記4節参照）。
残るのは配信停止HTTPエンドポイントのデプロイ・配線（Initial/Weekly共通の残課題）。

### 5. ドメインウォームアップ仕様

blastengineからの回答（`docs/external-provider-confirmations.md`「2. blastengine — 正式回答」参照）を
根拠として、以下を運用仕様とする。

- 新しいFromドメインは、送信開始から約2週間かけてウォームアップする
- 初期は少量送信から開始し、段階的に送信量を増やす
- 「2週間」等の数値はblastengineから提示された目安の一例であり、確定した固定値ではない

### 6. Webhook Security

blastengine Webhookには署名（HMAC等）機構が提供されないことが正式回答（2026-08-28、
`docs/external-provider-confirmations.md`「3. blastengine Webhook正式回答」参照）で確定した。
これを踏まえ、以下3層での防御を設計方針とする。

- **HTTPS**: PJ2側のWebhook受信エンドポイントはHTTPSで待ち受ける（blastengine側もHTTPS推奨）
- **Basic認証**: Webhook URLへBasic認証を付与する（blastengineが推奨する方式）
- **IPホワイトリスト**: blastengineのWebhook送信元IP（`3.114.82.121`、`35.79.248.35`）に限定する。
  実装はAWS側（API Gateway／Lambda Function URL／ALB等）で行う想定であり、PJ2側のアプリケーション
  コード（`process-blastengine-event.js`等）自体にはIP検証ロジックを持たせない

### 7. blastengine Event Mapping

#### Webhook payload構造（公式マニュアル記載、https://blastengine.jp/webhook/ 、Phase48 STEP11で確認）

```json
{
  "events": [
    {
      "event": {
        "type": "DROP",
        "datetime": "YYYY-MM-DDTHH:mm:ss+09:00",
        "detail": {
          "mailaddress": "xxxx@xxxxx.xxx",
          "subject": "XXXXXXXX",
          "error_code": "554(errors)",
          "error_message": "....",
          "delivery_id": 123,
          "insert_codes": []
        }
      }
    }
  ]
}
```

- 各イベントは`events[].event`でラップされる。受信者情報・`delivery_id`等は`events[].event.detail`配下
- `events`は配列（1リクエストに複数イベントを許容する前提はPhase47から維持。実受信で単一/複数が確定した時点で見直す）
- `delivery_id`はマニュアルの例では数値。Parser側で`String()`正規化する
- **区分**: 上記構造は公式マニュアル記載事項。Phase47 STEP1で仮定していたflat構造は誤りで、Phase48 STEP12にParserを本構造へ修正した（PJ2実装変更）。実Webhook受信での最終確認は次STEP

#### イベント種別 → delivery_status

| blastengineイベント | delivery_status |
|---|---|
| HARDERROR | bounced |
| DROP | bounced |
| SOFTERROR | 状態変更なし |
| unknown（未知のイベント種別） | 状態変更なし |

Provider（blastengine／Amazon SES）を問わず、`delivery_status: "unsubscribed"`のLeadは
いかなるメールイベントによっても上書きしない（[process-ses-event.js](../../scripts/generator/leads/process-ses-event.js)
と同じ確定仕様を踏襲する）。

### 8. SOFTERROR仕様

blastengine側で最大24時間以内に自動再試行される（正式回答で確定）。PJ2側システムでの
再送処理は行わない。SOFTERROR受信時はdelivery_statusを変更せず、historyへの記録のみ行う。

### 9. 重複Webhook仕様

blastengine WebhookにはEvent ID（一意なイベント識別子）が存在しないため、同一Webhookが
複数回届く可能性がある（正式回答で確定）。冪等キーとして以下4項目の組み合わせで判定する。

- `delivery_id`
- `mailaddress`
- `error_code`
- `event.datetime`

**実装（Phase47 STEP2、`process-blastengine-event.js`の`hasAlreadyRecordedEvent()`）**: 新規の
storageは追加せず、既存のLead.historyをそのまま冪等性チェックに使う。10節で確定したとおり
delivery_idにより対象Leadが一意に特定されるため、`mailaddress`の比較は実質的に不要（対象Leadの
historyを見ている時点でemailは既に一致している）——実装上の冪等キーは`delivery_id`・`error_code`・
`event.datetime`の3項目とし、これらすべてが一致する`email_bounced`のhistoryエントリが既に存在する
場合は、`updateLead()`・`appendHistory()`のいずれも呼ばずに処理済みとして扱う。

**race conditionに関する既知の限界**: `updateLead()`/`appendHistory()`はread→writeの2段階I/O
（await境界を挟む）であり、同一Leadに対する真に同時（同一ミリ秒オーダー）のリクエストが競合した
場合、この冪等化では防ぎきれない理論上のraceが残る。これはblastengine対応固有の問題ではなく、
DBレスのファイル/S3ベースLead storeが元々持つ構造的な既知の限界であり、PJ2の他のI/O
（Phase4-A/B API・SESイベント処理等）にも同様に存在する。恒久対応にはDynamoDBの
ConditionExpression等トランザクショナルなstorageが必要だが、新規DB導入は本Phaseのスコープ外の
ため、既知の限界として記録するに留める（blastengineの再試行は24時間以内に時間差を置いて行われる
設計であり、実運用上の発生可能性は低いと考えられる）。

### 10. Lead単位のSuppression（同一emailの複数Lead）

PJ2は「同一emailで異なるcompany_urlの複数Leadを許容する」確定仕様（P0-1）を持つ。このため
blastengine Webhookが対象Leadをmailaddressだけで特定しようとすると、同一emailの複数Leadの
どれに反映すべきかが一意に決まらない問題があった（Phase47 STEP1で残課題として明記）。

**Lead特定方法の確定**: send-initial-report.jsは送信成功時に必ず
`appendHistory(leadId, "initial_report_sent", {message_id: <Provider側の送信ID>})`を記録している。
blastengineのdelivery_idは1送信ごとに新規発行される一意な値であるため、Webhookイベントの
delivery_idとこのmessage_idを照合すれば（`lead-store.js`の`findLeadByInitialSendMessageId()`）、
mailaddressに基づく推測を一切行わずに対象Leadを一意に特定できる。「先頭1件だけ更新する」という
実装上の暫定挙動は仕様として確定させず、この方式へ置き換えた。

**delivery_status伝播範囲の確定**: HARDERROR/DROPによるdelivery_status変更は、delivery_idで
特定された「その1件のLead」にのみ適用し、同一emailを持つ他のLeadへは伝播させない
（Lead単位のSuppression）。根拠:

- 既存の`unsubscribe-lead.js`（reply-based `unsubscribeLead(email)`）は、同一emailで複数Leadが
  見つかった場合「一意に特定できないため、いずれも変更しない」（ambiguous）という設計を既に
  採用しており、複数Leadへの一括適用を避けることがPJ2の既存方針と整合する
- `isDeliveryBlocked()`／`isDeliveryApproved()`はいずれもLead単位の関数であり、email単位の
  Suppressionテーブルはこれまで一度も存在しない

**残課題（未実装、意図的にスコープ外）**: メールサーバーの実態としては、同一メールアドレスが
恒久的にbounceする場合、同一emailを持つ別Leadへの将来送信も同様にbounceする可能性が高い。
これに対する自動伝播（email単位のSuppression）は今回実装していない。将来的に実運用でこの
ギャップが問題になった場合は、別途仕様として検討する。

**unsubscribedとの整合性**: `unsubscribed`は既存のunsubscribe-lead.jsの設計どおり、
lead_id・report_tokenの組（URL経由）またはCLIでの一意特定（reply経由、ambiguous時は不変更）に
基づくLead単位の状態であり、今回の変更でこの既存仕様には一切手を加えていない。

### 11. Webhook 運用方針と残課題（Phase48 STEP18 で確定）

以下は **PJ2 側の運用判断**であり、blastengine 公式仕様ではない（公式仕様は 6〜9節。「公式に存在しない」と書いた項目は blastengine 公式マニュアル・API ドキュメントで確認できなかったという意味）。

| 項目 | 確定方針 | 内容 |
|---|---|---|
| **実Webhook payload の実地検証** | ⚠️ 未検証のまま運用開始 | 7節の payload 構造は blastengine 公式マニュアル（`https://blastengine.jp/webhook/`）記載事項として確認済みで、`parseBlastengineEvent()` もそれに合わせて実装・テスト済み（Phase48 STEP12、91 テスト green）。ただし **実際の Webhook POST はまだ1件も受信していない**。`events[].event.detail.delivery_id` 等が実 payload とキー名・ネストまで完全一致するかは、初回の実 Webhook 受信時に最終確認する。不一致ならパーサを再修正する。**「公式仕様として確認済み」と「実 Webhook での動作確認済み」は別**として扱う |
| **意図的なバウンス発生による E2E** | 実施しない（確定） | blastengine には公式の Webhook テスト送信・delivery 単位の再発火・sandbox・強制エラー・テスト用失敗 recipient のいずれも**確認できない**（Phase48 STEP17 調査）。HARDERROR/DROP Webhook を得るには実メールを意図的に失敗させるしかなく、送信元ドメインのエラー率を上げ blastengine の運用推奨（エラー率10%監視）に反する方向。**人工的な HARDERROR/DROP は原則発生させない。実運用開始後に最初に自然発生する HARDERROR/DROP で実 Webhook E2E を確認する**（上記「実 payload の実地検証」も同じ機会に行う） |
| **Webhook Function URL の IP 制限** | 当面 HTTPS + Basic認証のみ（確定）。`aws:SourceIp` 方式は不採用 | blastengine 固定送信元 IP（`3.114.82.121`, `35.79.248.35`）への制限は、Lambda の resource-based policy では `aws:SourceIp` を表現できない（`AddPermission` API が IP 系 condition を受け付けない。Phase48 STEP10 で確認）ため、**Function URL 単体では実現不可能**。<br>**確定方針**: 当面は **HTTPS（Function URL が強制）+ Basic認証**（`crypto.timingSafeEqual`・環境変数未設定時 fail-closed）のみで運用する。ハンドラ内での `x-forwarded-for` 検証（C 案）は現時点では**採用しない**（アプリ層に IP 検証を持たせない既存方針を維持）。<br>**将来候補**（必要性が出た時点で別 Phase）: (A) CloudFront + WAF、(B) API Gateway + リソースポリシー。移行要否は Webhook 量・セキュリティ要件・本番公開の段階を見て判断する |
| **`shared/retry.js` の `retryable` 未参照** | 今回修正しない（別課題へ切り出し） | `withRetryAndTimeout()` は `err.retryable` を見ず、タイムアウト以外の全エラーを `maxRetries` 回リトライする。blastengine 送信は HTTP 400（`retryable:false`）でも計3回試行する。共通 retry 層のため blastengine / SES / LLM / search 全利用箇所に影響する。`retryable === false → 即 throw` への改善は影響範囲調査を伴う別 Phase の課題とする |
| **Phase48 E2E 用 Test Lead** | 当面残置（後日 cleanup） | STEP16 で作成した Test Lead（`initial_report_sent`、message_id 保存済み、実メール受信済み）は現時点では削除しない。cleanup は別 STEP で行い、その際 **Test Lead 1件のみ削除・既存2 Lead は残す** |

## 段階的な構築方針

初期フェーズ（Phase 0〜1、[15_roadmap.md](15_roadmap.md)）では上記コンポーネントの多くを
スプレッドシート・手作業・汎用AIチャット（ChatGPT/Claude）で代替し、
検証が進んだ工程から順にシステム化する。「先にシステムを作ってから検証する」のではなく、
「検証しながら、繰り返し発生する工程だけをシステム化する」順序を守る
（PROJECT.mdの「Automate Everything」「Build Fast」原則に合致）。
