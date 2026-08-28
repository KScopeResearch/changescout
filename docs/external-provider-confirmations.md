# 外部メール配信サービス 規約適合性確認 記録（Phase 44 STEP 0で新設）

PJ2 AORのInitial AOR送信基盤について、外部メール配信/営業支援サービスへ「PJ2 AORの具体的な用途を、貴社の利用規約・ポリシー上許可するか」を事前確認した記録をまとめる。

**このファイルは「サービス提供者からの正式な回答・確認結果」を蓄積する場所であり、今後同種の確認が増えるたびに追記していく（サービスごとに新規ファイルを作らない）。**

各エントリは以下を含める：

- 対象サービス名
- 受領日
- 参照ID（チケット番号・feedback ID等、サービス側が発行したもの）
- 原文（改変・要約せず、受領した内容をそのまま記載する）
- 原文から確定できる事項（サービス側が許可した範囲）と、サービス側が明言していない事項（特に法的判断）の分離整理

---

## 1. Smartlead.ai — 正式回答（受領日: 2026-08-26）

### 確認した用途（問い合わせ内容の要旨）

Phase 34〜36で作成した問い合わせ文（`docs/strategy_v2`関連フェーズの記録参照）に基づき、以下を明示して確認した：

- B2Bサービスであること
- Initial AORは特定企業向けに個別生成するレポートであること
- 送信対象メールアドレスは運営側が企業公式サイト等の公開情報から収集すること
- 受信者本人による事前のオプトイン・リクエストは送信の必須条件としていないこと
- 送信前に社内スタッフが個別レビュー・承認を行うこと
- Initial AORは初回接触として原則1回のみ送信し、多段階の営業シーケンスではないこと
- Weekly AORは受信者本人が明示的にオプトインした場合のみ、送信の都度consentを確認して送信すること
- APIを利用したプログラム送信を想定していること

### 参照ID

- **feedback #397848**（Smartlead側のサポートチケット/フィードバック識別子）
- メール内フッターの識別子: `GLEAPID:6a8ea905af9ae43e6b8a3b40`（Smartleadのサポートツール（Gleap等）が付与したと見られる識別子。原文証跡としてそのまま保持する）

### 原文（改変・要約なし。受領した内容をそのまま記載）

> Sender Image
>
> Hi Takenori,
>
> Really appreciate how much detail you put into this, made it way easier to give you a straight answer instead of a runaround.
>
> Yes, you're good to go. This is genuinely the use case Smartlead is built around — targeted outreach to business addresses you've sourced yourself, reviewed by a human before it goes out, one email as the opener rather than a drip sequence, and a proper opt-in check before anyone gets added to your weekly report list. Our terms don't outlaw cold email, they outlaw spam as the actual anti-spam laws define it, and what you're doing isn't that.
>
> One thing I'd tweak though: relying only on reply-to-unsubscribe works fine for CAN-SPAM, but GDPR and CASL want opt-out to happen right away, not after someone reads a reply and manually processes it. If any of your recipients are in the EU or Canada, adding a one-click unsubscribe next to the reply option will save you a headache later. Also worth double checking your first email states who you are, how you got their address, and includes a mailing address somewhere — small thing but it matters for CAN-SPAM.
>
> Sending through the API is totally fine, no restriction there.
>
> Can't give you a formal legal opinion on how this holds up under Japanese or EU law specifically, that's really a question for your own counsel if you want it airtight. But as far as what we allow on the platform, you're clear.
>
> Let me know if you run into anything else while you're setting it up.
> We are here to help!
>
> Reply directly to this email or open feedback #397848 for full details.
> Unsubscribe from these emails
> GLEAPID:6a8ea905af9ae43e6b8a3b40

### Smartleadが明示的に許容した範囲（サービス規約上の判断として明記されている事項）

| 項目 | Smartleadの回答 |
|---|---|
| targeted outreach（自社で調達したbusiness addressesへの個別アウトリーチ） | 許容。"the use case Smartlead is built around" と明言 |
| sourced business addressesへの送信（受信者本人の事前opt-inなし） | 許容。"business addresses you've sourced yourself" を前提として許容 |
| human review後の送信 | 許容（前提条件として言及されているが、必須要件とまでは明言していない） |
| one-email opener（drip sequenceではない単発の1通） | 許容。"one email as the opener rather than a drip sequence" |
| Weekly report list（継続配信リスト）への追加 | **proper opt-in checkを要求**（Weeklyには明示的なopt-inが必要、という点はSmartlead側も同じ理解） |
| API経由の送信 | 許容。"Sending through the API is totally fine, no restriction there" |
| cold email自体の扱い | 規約はcold emailそのものを禁止しているのではなく、実際のアンチスパム法が定義する「spam」を禁止している、という説明。PJ2の用途は該当しないとの判断 |

### Smartleadが明示的に法的判断を行っていない事項（法務助言ではない部分）

| 項目 | Smartleadの発言 |
|---|---|
| 日本法・EU法上の適法性 | "Can't give you a formal legal opinion on how this holds up under Japanese or EU law specifically, that's really a question for your own counsel if you want it airtight." — **正式な法的意見ではないと明言** |
| GDPR/CASL対応の具体的要件 | 一般的な注意喚起（ワンクリック配信停止の追加を推奨）はあるが、法的な確定判断としては提示していない |
| CAN-SPAMの送信者情報明記要件 | 同様に、一般的な留意事項としての言及であり、法的助言ではない |

### 今回確認・記録できたこと

- **Smartlead自身は、PJ2のInitial AORモデル（自社調達のbusiness addressesへの人間承認後・単発の初回アウトリーチ、API送信）を、自社サービス規約上「利用可能（"you're good to go" / "you're clear"）」と明確に回答した。**
- Weekly AOR（継続配信）については、Smartlead側も「proper opt-in check」が前提であるという理解を共有しており、PJ2の`weekly_report_consent`ゲートの設計方針と矛盾しない。
- **一方で、この回答は「Smartleadというサービスの利用規約上の許可」であり、「日本法・EU法上の適法性」についての法的判断ではないことをSmartlead自身が明記している。** 日本の特定電子メール法・EUのGDPR・カナダのCASL等への適合性は、別途自社の法務確認が必要な事項として残る。
- Smartleadからは、EU/カナダ宛先が含まれる場合の運用上の推奨事項（ワンクリック配信停止の追加、送信者情報・郵送先住所の明記）が付随的に示された。これはSmartleadの規約適合性の判断とは別に、実装時の設計判断材料として扱う。

---

## 2. blastengine — 正式回答（受領日: 2026-08-27）

### 回答者情報

- 会社名: 株式会社ラクスライトクラウド（株式会社ラクス100%子会社）
- 担当者: 工藤様
- 連絡先: support@blastengine.jp／Tel 03-6862-7337（サポート受付時間: 平日10:00〜17:00、土日祝を除く）

### 確認した用途（問い合わせ内容の要旨、フォーム送信控えより）

Phase38で作成した問い合わせ文を`https://blastengine.jp/contact/`（公式問い合わせフォーム）より送信。フォーム上の会社名は「株式会社カレイドスコープ」、氏名「幸田武範」、月間メール送信数「〜9,999通」として送信。問い合わせ内容はSmartlead向けと同一の主旨（B2B、Initial AORの個別性・単発性・公開アドレス収集・人間承認・API送信・現状のunsubscribe方式等）。

### 原文（改変・要約なし。受領した内容をそのまま記載）

> 株式会社カレイドスコープ
> 幸田様
>
> お世話になっております。
> ブラストエンジンの工藤と申します。
>
> 社内確認にお時間いただいてしまい申し訳ございません。
>
> 下記の配信運用であれば、ブラストエンジンをご利用いただくことが可能と考えております。
> ・汎用的なメルマガの「一斉・大量送信」ではなく、1社ごとに最適化した個別レポートを送付
> ・多段階の営業追客シーケンスではなく、初回接触として原則「1回のみ」の送信
> ・外部から購入したリストではなく、公式サイト等に記載のある公開アドレス宛への送信
> ・苦情やバウンスが発生した宛先には以後一切送信しない
>
> 配信ポリシー上の判断基準と「監視閾値」について、ブラストエンジンでは、
> 他のお客様と共有する送信IPアドレス（共有IPプール）の信頼性を守るため、
> エラー率10％の基準を設けております。
>
> 万が一、バウンス率や苦情が上記の基準を一時的に超えて品質低下を検知した場合でも、
> システム側で事前通知なしにアカウントを即座に強制停止するような措置は原則として行っておりません。
> 検知した場合は、弊社サポートチームからお客様へ直接状況を確認させていただき、
> 送信文面やリストの精査方法など、解決に向けて
> 直接アドバイスをさせていただく伴走型の是正サポートをとっております。
>
> ■ブラストエンジン利用規約　第18条（禁止事項）(7)
> https://blastengine.jp/provision/　
>
>
> また、ブラストエンジンを用いてAPI送信されるにあたり、
> 以下の3点の実装および遵守を実質的な必須条件とさせていただいております。
>
> ①明確な「オプトアウト（配信停止）導線」のメール本文への記述
> 受信者がスパム報告を押してしまうのを防ぐため、
> メールのフッター等に配信停止の手続き方法を分かりやすく明記するようお願いしております。
> なお、ブラストエンジンではList-Unsubscribeヘッダーを付与して配信することが可能です。
> ■List-Unsubscribe
> https://blastengine.jp/documents/#tag/List-Unsubscribe
>
> ②不達アドレスの除外およびWebhookの連携
> ブラストエンジンには標準機能として、2週間以内に2回ハードエラーが発生した宛先を、
> 自動的に最大2週間送信除外にする「エラー停止リスト機能」がございますが、
> 貴社システム側でもリアルタイムにエラーを検知できるよう、Webhook機能を推奨いたします。
>
> ③送信開始初期のドメインウォームアップの実施
> ブラストエンジンが提供する送信IPアドレスはすでに実績がありクリーンですが、
> 貴社が新しく用意する送信元Fromドメインと弊社のIPアドレスを組み合わせた実績は、
> 受信側サーバーにとっては「新規の送信者」となります。
> そのため、運用開始当初は、いきなり1日に大量の新規配信を投げるのではなく、
> 2週間ほどかけて段階的に送信ボリュームをスケールさせるドメインウォームアップをお願いしております。
>
>
> また、API連携の関連資料をお送りいたします。
> 一部、添付ファイルなどの配信制限がございますが、
> オプションプランのご契約によって拡張していただくことが可能です。
>
> ■ブラストエンジンサポートサイト
> https://help.blastengine.jp/
>
> ■APIドキュメント
> https://blastengine.jp/documents/
>
> ■ライブラリ
> https://github.com/blastengineMania
>
> ■サンプルコード
> https://qiita.com/tags/blastengine
>
> ■SPF/DKIM/DMARC設定
> https://info.blastengine.jp/spfdkim.pdf
> https://blastengine.jp/dkim-manual/
>
> ■SPF/DKIM/DMARC完全ガイド
> https://blastengine.jp/wp-content/uploads/2024/11/SPF_DKIM_DMARC_kanzen_guide.pdf
>
> ■エンベロープFrom持ち込み機能
> https://blastengine.jp/custom-envelope/
>
> ■API添付ファイル容量上限アップオプション
> https://info.blastengine.jp/API_attachmentfilelimitupgrade.pdf
> デフォルトでは添付ファイル1MBのサイズ上限が御座います。
> 1MBを超える添付ファイルが発生する場合はオプションにて上限アップが可能です。
> デフォルトの1MBを超えるメールの月間配信通数および上限値の掛け合わせで金額設定されております。
>
> ■APIレートリミット緩和オプション
> https://info.blastengine.jp/API_ratelimitupgrade.pdf
> デフォルトでは500回/分のAPIレートリミットが御座います。
> 上記を超えたレートリミットをご希望の場合はオプションにて上限アップが可能です。
>
> ■ユーザー作成オプション
> https://info.blastengine.jp/user_create_option.pdf
> 1契約で複数のログインユーザーを権限付きで作成することができます。
> 使用例は以下をご参照ください。
> 例1）メール配信状況についての問い合わせはコールセンター等のご担当者様が対応され、
> 　　　コールセンター担当者は配信ログのみ閲覧可能とし、
> 　　　契約情報等は閲覧不可、編集不可としたい場合。
> 例2）メール配信機能としてブラストエンジンを組み込んだシステムをお客様に納品され、
> 　　　お客様側では契約情報等は閲覧不可、編集不可としたい場合。
>
>
> 不足情報がございましたら、お手数ですがご教示いただけますと幸いです。
> 何卒よろしくお願いいたします。
>
> ---------------------------------------------------------------
> 株式会社ラクスライトクラウド
>  (株式会社ラクス100％子会社)
>
> Tel : 03-6862-7337
> Mail: support@blastengine.jp
> URL : https://blastengine.jp/
>
> サポート受付時間: 平日 10:00～17:00 (土日祝を除く)
> ---------------------------------------------------------------
> プライバシーマーク 認定番号：第10821806号
> 適格請求書発行事業者登録番号：T3011001043240
> ---------------------------------------------------------------

### blastengineが明示的に許容した事項

| 項目 | blastengineの回答 |
|---|---|
| 1社ごとに最適化した個別レポート送信（汎用メルマガの一斉・大量送信ではない） | 許容。「下記の配信運用であれば、ブラストエンジンをご利用いただくことが可能と考えております」の1点目として明記 |
| 初回接触として原則1回のみの送信（多段階の営業追客シーケンスではない） | 許容。同上2点目 |
| 公式サイト等に記載のある公開アドレス宛への送信（外部購入リストではない） | 許容。同上3点目 |
| 苦情・バウンス発生後の以後送信停止（PJ2の既存運用） | PJ2側の運用として妥当と認められている（同上4点目） |
| API経由の送信 | 許容。ただし無条件ではなく、下記「blastengineが必須条件として要求した事項」①〜③（オプトアウト導線明記・不達アドレス除外/Webhook連携・ドメインウォームアップ）を実装・遵守することを実質的な前提条件として案内している |

### blastengineが必須条件として要求した事項

| 条件 | 内容 |
|---|---|
| ① オプトアウト導線の明記 | メール本文（フッター等）に配信停止手続きを分かりやすく明記すること。List-Unsubscribeヘッダーの付与が機能として可能 |
| ② 不達アドレスの除外＋Webhook連携 | 標準機能として「2週間以内に2回ハードエラー→自動最大2週間送信除外」のエラー停止リスト機能あり。加えて、貴社システム側でのリアルタイムエラー検知のためWebhook連携を推奨 |
| ③ ドメインウォームアップの実施 | 新しいFromドメイン＋blastengine IPの組み合わせは受信側にとって「新規送信者」扱いになるため、運用開始当初は2週間ほどかけて段階的に送信量をスケールさせることを要請 |

**参考（運用上の監視基準の説明。上記①〜③とは別枠）**: 共有IPプールの信頼性維持のため、エラー率10%を監視閾値として設定。一時的にこの基準を超えた場合でも、事前通知なしの即時強制停止は原則行わず、サポートチームが直接状況確認・是正アドバイスを行う「伴走型の是正サポート」を実施するとの説明あり。根拠として利用規約第18条（禁止事項）(7)への言及あり（条文本文はメール内に引用されておらず、リンクのみ）。

### 未確定事項（blastengineが回答していない事項）

| 項目 | 状況 |
|---|---|
| 日本法・海外法（GDPR等）上の適法性 | **メール本文中に一切の言及なし。** Smartleadのように「法的意見ではない」と明示的に断ってもいないが、適法性について肯定・否定いずれの言及もない（問い合わせ文側で「日本法上の適法性についてのご判断は不要です」と明記していたため、この点に触れていないこと自体は問い合わせの範囲と整合する） |
| 配信量の具体的な上限 | 個別の数量上限の明示はなし。APIレートリミット（デフォルト500回/分）という技術仕様の言及のみ |
| Reply-Toの設定可否 | 今回のメールでは言及なし |
| 許可表現の強さ | 「ご利用いただくことが可能と考えております」という表現であり、Smartleadの"you're good to go"/"you're clear"と比べるとやや留保的なニュアンスを含む。ただし、3条件（①〜③）を満たすことを前提とした許可であることは明確 |

### 現時点の確認状況比較（Smartlead vs blastengine）

| 項目 | Smartlead | blastengine |
|---|---|---|
| 規約回答 | 回答受領済み | 回答受領済み |
| API送信許可 | 回答あり（制限なしと明言） | 回答あり（3条件付きで許容） |
| Cold outreach | 回答あり（許容） | 回答あり（許容、4つの運用条件に合致する場合） |
| Weekly opt-in条件 | 回答あり（proper opt-in checkを要求） | 言及なし（Weekly用途はSmartleadにもblastengineにも問い合わせていないため対象外） |
| 法的判断ではない旨 | 回答あり（明示的に「法的意見ではない」と明言） | 言及なし（適法性について肯定・否定どちらの言及もなし） |
| 追加の必須条件 | ワンクリック配信停止の推奨（EU/カナダ宛先がある場合）、送信者情報明記 | オプトアウト導線明記、Webhook連携、ドメインウォームアップ（2週間） |

---

## 3. blastengine Webhook正式回答（2026-08-28）

### 記載形式についての注記

上記1・2のエントリ（Smartlead・blastengineの規約適合性回答）は、受領したメール原文をそのまま「原文」節に引用する形式で記録している。本エントリは、2026-08-28にPJ2 AOR運営者（幸田）がblastengineサポートへ確認し受領したWebhook仕様の回答内容を、Phase47 STEP1の指示に基づき要旨として記録するものであり、**受信メールの原文（verbatim）は本ファイルに引用していない**。以下は指示書に明記された「正式回答のみ・推測禁止」の内容をそのまま転記したものであり、本ファイルの筆者（Claude Code）が独自に推測・補完した内容は含まない。原文メール自体の保存が必要な場合は、別途原文を確認のうえ追記することを推奨する。

### 確認できた事項

| 項目 | blastengineの回答 |
|---|---|
| Webhook署名（認証） | HMAC等の署名機能は提供されない。Basic認証付きWebhook URLの利用を推奨 |
| Webhook送信元IP | `3.114.82.121`、`35.79.248.35` の2つに固定 |
| 重複通知 | 同一Webhookが複数回届く可能性がある。Event ID（一意なイベント識別子）は存在しない。`delivery_id` を識別子として利用可能 |
| timestampフィールド | `event.datetime`。ISO8601形式、JSTオフセット付き |
| SOFTERRORの再試行 | blastengine側で24時間以内に自動再試行される。送信元（PJ2）システム側での再送は不要 |
| HTTPS | HTTPでも受信は可能だが、blastengineとしてはHTTPSを推奨。PJ2ではHTTPSを採用する |

### Webhook payload構造（公式マニュアル記載。https://blastengine.jp/webhook/ 、Phase48 STEP11で確認）

**区分: blastengine公式マニュアル記載事項**（サポートからのメール回答ではなく、公開マニュアルの掲載内容）。

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

- `events` は配列。各要素は `events[].event` でイベント本体をラップし、受信者情報・`delivery_id` 等は `events[].event.detail` 配下にネストする
- `event.type` / `event.datetime` はイベント直下、`detail.mailaddress` / `detail.subject` / `detail.error_code` / `detail.error_message` / `detail.delivery_id` / `detail.insert_codes` は `detail` 配下
- `delivery_id` はマニュアルの例では**数値**

**Phase47 STEP1実装との差異**: Phase47 STEP1では、公式マニュアル未確認のまま `events[]` 要素にフィールドが直接並ぶ**flat構造**を仮定してParser（`process-blastengine-event.js`）を実装していた。Phase48 STEP11で上記の正しい構造が判明し、Phase48 STEP12でParserを公式構造へ合わせて修正した（→「4. 実API疎通検証で観測した事実」の 4-4 参照。これはPJ2側の実装変更）。

**未確認**: 上記は公式マニュアルの記載であり、**実際のWebhook受信トラフィックでの検証はまだ行っていない**（実Webhook未受信。次STEP以降）。マニュアルの例と実payloadでキー名・ネストが完全一致するかは実受信時に最終確認する。

### 未確定のまま残る事項（今回の回答に含まれない）

- Webhook署名が提供されない前提での、なりすまし対策の具体的な実装方法（Basic認証＋IPホワイトリストの組み合わせで対応する設計をSTEP2で検討する）
- `delivery_id`・`mailaddress`・`error_code`・`event.datetime`以外に、重複判定へ使える追加フィールドの有無
- Basic認証の資格情報（ユーザー名・パスワード）の発行方法・タイミング（blastengine管理画面側の設定はPhase47では未実施）
- 管理画面の「テストWebhook送信」機能の有無（公式マニュアルには設定手順のみ記載。テスト送信ボタンの記載は確認できていない）

### 今回確認・記録できたこと

- blastengine WebhookにはHMAC等の署名機構が無いため、送信元認証はBasic認証＋（AWS側での）IPホワイトリストの組み合わせで設計する方針が現実的であることが確定した。
- 重複通知が起こりうる前提で、`delivery_id`を軸とした冪等化設計が必要であることが確定した（Event IDが存在しないため）。
- SOFTERRORはPJ2側での再送処理が不要（blastengine側が24時間以内に自動再試行）であることが確定した。

---

## 4. blastengine 実API疎通検証で観測した事実（検証日: 2026-08-28）

### このエントリの位置づけ（重要）

**本エントリは「サービス提供者からの正式な回答」ではない。** 1〜3節はblastengineサポートから書面で受領した回答を記録したものだが、本エントリはPJ2 AOR運営者（Claude Code経由）がPhase48 STEP7で**blastengine Transaction APIへ実際にリクエストを送って観測した挙動**を記録するものである。テスト用宛先（`BLASTENGINE_TEST_TO`）へ検証メールを**2通のみ**送信し、成功`delivery_id`を確認した時点で疎通確認は完了しており、以後このSTEPでの実API送信は行わない。

観測した事実と、blastengine公式ドキュメントの記載、PJ2側の実装対応を、以下のとおり明確に分離して記録する。

### 4-1. `list_unsubscribe.mailto` の形式

| 区分 | 内容 |
|---|---|
| **blastengine公式仕様**（APIドキュメント `https://blastengine.jp/documents/#tag/List-Unsubscribe`、Phase45 STEP3Cで確認済み） | List-Unsubscribeは汎用的な`headers`キーではなく、`list_unsubscribe: {mailto?, url?}` という専用フィールドで指定する。`mailto`・`url`はいずれも任意。公式ドキュメントには`mailto`値の具体的な文字列フォーマット（スキームの要否）についての明示的な記載は確認できていない |
| **実APIで観測した事実**（2026-08-28） | `list_unsubscribe.mailto` に bare email address（`aor-report@changescout.jp`）を渡すと **HTTP 400**。レスポンスボディは `{"error_messages":{"list_unsubscribe":{"mailto":["{validation.pattern.error}"]}}}`。`mailto:` スキームを付けた URI（`mailto:aor-report@changescout.jp`）を渡すと **HTTP 200**、`delivery_id` を採番。`url` のみ（`mailto` 省略）でも **HTTP 200** |
| **PJ2側の実装対応**（設計判断） | `scripts/generator/leads/blastengine-client.js` に `normalizeMailto()` を追加。`buildSendEmailBody()` が `list_unsubscribe.mailto` を組み立てる際、既に `mailto:` が付いていればそのまま、bare email なら `mailto:` を付与して正規化する。呼び出し側（`send-initial-report.js`、`process.env.BLASTENGINE_FROM` を bare で渡している）は変更不要 |

### 4-2. エラーレスポンスの構造

| 区分 | 内容 |
|---|---|
| **blastengine公式仕様**（Phase45 STEP3Cで確認した範囲） | エラー形式は `{"error_messages": {"main": ["メッセージ", ...]}}`。機械可読な `code` 相当のフィールドは公式ドキュメントに記載がない |
| **実APIで観測した事実**（2026-08-28） | フィールド単位のバリデーションエラーは `error_messages.main`（配列）ではなく、`{"error_messages":{"list_unsubscribe":{"mailto":["{validation.pattern.error}"]}}}` のように **`error_messages.<field>.<subfield>: string[]` のネストしたオブジェクト**で返る。`main` 専用の抽出ロジックではこの種のエラー原因が完全に欠落する |
| **PJ2側の実装対応**（設計判断） | `blastengine-client.js` に `flattenErrorMessages()` を追加。`error_messages` を再帰的に平坦化し、`main` 直下はprefixなし・それ以外はフィールドパスを前置（`list_unsubscribe.mailto: {validation.pattern.error}`）した文字列配列を得る。APIキー・Authorizationヘッダー・Bearerトークン・リクエストボディ・PIIはこの抽出対象（サーバー返却のバリデーションメッセージのみ）に含まれない。`err.code` は従来どおり常に `null`、`statusCode`／`retryable` の判定は無変更 |

### 4-3. リトライ挙動（Phase48 STEP8 read-only調査で確認、コード変更なし）

| 区分 | 内容 |
|---|---|
| **PJ2側の現行実装** | `scripts/generator/shared/retry.js` の `withRetryAndTimeout()` は **`err.retryable` を参照しない**。タイムアウト以外のあらゆるエラーを `maxRetries` 回まで再試行する。blastengine送信は `maxRetries: 2`（合計3回）。HTTP 400（`retryable: false`）でも3回試行してから `blastengine Transaction APIが3回とも失敗しました: ...` を投げる。最終エラーは素の `Error` であり、`retryable`／`statusCode`／`code` は引き継がれない（これらは `send-initial-report.js` が job history へ記録する用途で `callSendEmail()` が付与するもので、リトライ制御には使われていない） |
| **影響評価** | 400は「何も送信されていない」ことを意味するため、再試行で重複メールは発生しない。ただし確定失敗に対して3回APIを呼ぶのはレートリミット（500回/分）とレイテンシの無駄。Phase48 STEP7の実検証時に実際に「3回とも失敗」ログが出たのはこの挙動による |
| **今回の対応** | STEP8の指示範囲は read-only 調査のため、retry仕様は変更していない。現行挙動を明文化する回帰テストのみ追加（`test/shared.test.js`）。`err.retryable` を見て非retryableエラーを即時打ち切る改善は次STEP以降の検討事項 |

### 4-4. Webhook payload構造（Phase48 STEP11-12）

| 区分 | 内容 |
|---|---|
| **blastengine公式マニュアル記載**（https://blastengine.jp/webhook/ ） | Webhook payloadは `{ "events": [ { "event": { "type", "datetime", "detail": { "mailaddress", "subject", "error_code", "error_message", "delivery_id", "insert_codes" } } } ] }` というネスト構造（詳細は「3. blastengine Webhook正式回答」の「Webhook payload構造」節、または `docs/strategy_v2/13_architecture.md` 7節参照）。`delivery_id` はマニュアルの例では数値 |
| **Phase47 STEP1実装の誤り** | Phase47 STEP1では公式マニュアル未確認のまま、`events[]` 要素にフィールドが直接並ぶ**flat構造**（`events[].{type, datetime, mailaddress, delivery_id, ...}`）を仮定して `parseBlastengineEvent()` を実装していた。これは推測であり、公式構造と一致しない |
| **PJ2側の実装対応**（Phase48 STEP12、設計判断） | `scripts/generator/leads/process-blastengine-event.js` の `parseBlastengineEvent()` を公式マニュアル構造へ合わせて全面修正。`events[].event.detail` をunwrapし、正規化後の内部イベント形式（`{type, datetime, mailaddress, subject, error_code, error_message, delivery_id, insert_codes}` のflat）・Event Mapping（HARDERROR/DROP→bounced 等）・冪等キー（delivery_id + error_code + datetime）・Lead特定方式（`findLeadByInitialSendMessageId(delivery_id)`）はいずれも無変更。`delivery_id` は数値でも `String()` で正規化。Validation例外メッセージは `events[index]` とフィールドパスのみで mailaddress 等のPIIを含めない。テストfixture（`process-blastengine-event.test.js`・`blastengine-webhook-suppression-integration.test.js`）も公式構造へ更新 |
| **未確認** | 上記は公式マニュアルの記載構造への適合であり、**実Webhook受信トラフィックでの検証は未実施**（実Webhook未受信）。マニュアルの例と実payloadが完全一致するかは実受信時に最終確認する。一致しない場合はコードを再修正する |
