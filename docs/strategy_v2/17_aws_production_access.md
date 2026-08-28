# 17_aws_production_access.md — AWS SES Production Access 再申請用資料

## これは何か

AWS Support Case `178662791300353` への回答（公開情報から収集した連絡先へ、受信者本人からの
事前リクエストなしにB2Bメールを送るモデルは、Production Access要件を満たさない、という指摘。
公開情報だけではSES上の受信許可とみなされず、B2Bであってもこの扱いは変わらない）を受けた
再申請用の資料（Phase 32A）。

**今回のドキュメント更新の方針**: Candidate（収集）とApproved（当社が送信対象として管理する
リスト）を分離する実装自体は既に行っている（`scripts/generator/leads/lead-store.js`の
`delivery_approval_status`、`website/aor-admin`のLeads画面、`send-initial-report.js`の
ゲート）。ただし、この「Approved」は**受信者本人の事前オプトインを意味するものではない**
（判定基準は収集元の適法性確認であり、本人の事前リクエストではない）。この点を曖昧にしたまま
「初回AORも含め、Approved Listへの送信はもう問題ない」という説明をAWSへ提出すると、前回と
同じ理由で再度の指摘を受けるリスクが高い。

そのため今回は、
- **Weekly AOR**（受信者本人が初回受領後に明示的に継続希望した場合のみ送信）を、SESの
  明確な主要用途として説明する
- **初回AOR**については、現時点でSESから完全に分離済みとは書かず、送信方式を今後も
  選択可能な状態（別途許可取得後にSESを使う／SES以外の基盤を使う、のいずれも取り得る）
  として説明する
- 「Approved」という言葉が「本人オプトイン済み」を意味しない、という点を明示する

という方針で英文・日本語訳を書き直した。初回AORの送信基盤分離設計自体は別Phaseで実施し、
今回はドキュメントの記述のみを扱う。

本ドキュメントは、AWSへ再申請する際の説明文（英語、提出用）と、その日本語訳（社内確認用）、
および主張の技術的根拠（社内参照用、AWSへは提出しない）をまとめる。

再申請そのもの（AWS Supportコンソールへの提出操作）は本ドキュメント作成の範囲外。
提出前に、実際の運用開始日・送信量見込み等、申請フォーム側で追加入力が必要な項目が
無いかを別途確認すること。

### 【2026-08-28 Phase48 → 2026-08-29 Phase49 STEP4】初回AORをblastengineへ分離 → 申請文面を現行版へ

**現状（Phase49 STEP3 で AWS 実状態を read-only 確認済み）**:

- `ProductionAccessEnabled = false`（SES は Sandbox）。`ReviewDetails` は存在しない
  = **Production Access は一度も申請されていない**（`PutAccountDetails` 未実行）
- `SendingEnabled = true` / `EnforcementStatus = HEALTHY` / 送信枠 200通/日・1通/秒（Sandbox 既定）
- `Case 178662791300353` は SES アカウントレビューに紐づかない**通常の Support Center ケース**
- `changescout.jp` は SES で Verified・DKIM Status = SUCCESS
- 送信構成: **初回AOR = blastengine Transaction API（`pj2-aor-initial-report-delivery` Lambda、
  2026-08-28 デプロイ・実送信1通確認済み）／週次AOR = Amazon SES（`weekly_report_consent === true`
  の受信者のみ）**

**本ドキュメントは2版を保持する**:

| 版 | 節 | 位置づけ |
|---|---|---|
| **現行版（Phase49 STEP4）** | 「AWS提出用（英語 / 現行版）」「社内用日本語訳（現行版）」 | 初回=blastengine 分離済みを前提に、**SES の用途を週次AORのみ**として説明する。**今後の申請にはこちらを使う** |
| Phase 32A 版 | 「AWS提出用（英語 / Phase 32A 版）」「社内用日本語訳（Phase 32A 版）」 | 初回もSES・送信方式未確定を前提とした旧文面。提出済みの可能性があるため**改変せず履歴として保持** |

現行版が Phase 32A 版より強い立て付けになる理由: 前回の指摘（公開情報から収集したアドレスへの
未承諾送信）の原因だった「初回の未承諾接触を SES から送る」経路が、**コード上から完全に無くなった**
（`sendInitialReportForLead()` も `lambda/initial-report-delivery-handler.js` も `ses-client` を
require しない）。SES から送るのは、受信者本人が明示的に継続を希望した週次更新のみになった。

再申請そのもの（AWS Support コンソール / Production Access フォームでの `PutAccountDetails` 相当の
提出操作）は引き続き本ドキュメントの範囲外。提出は運営者（幸田）が行う。

## AWS提出用（英語 / 現行版 — Phase49 STEP4）

> **Subject: SES Production Access request — Amazon SES used only for opt-in weekly update emails**
>
> We are requesting Amazon SES Production Access for a single, narrowly defined use case, and we want to
> describe it precisely so it can be evaluated on its own terms. This follows an earlier Support Center
> exchange (Case 178662791300353) in which it was noted that sending to addresses collected from public
> sources, without a prior request from the recipient, does not satisfy SES's requirements even for B2B
> mail. Since then we have changed our architecture so that the concern no longer applies to any mail we
> send through SES.
>
> **1. What we use Amazon SES for**
> We use SES for exactly one thing: a recurring "weekly update" email sent only to a recipient who has
> already received an initial report from us and then, separately and explicitly, asked to keep receiving
> updates. The recipient takes that action themselves by following a link in the initial report and
> confirming. Their request is recorded as `weekly_report_consent = true` and is re-checked in code
> immediately before every individual SES send. There is no code path that sends a weekly email to a
> recipient who has not taken that action.
>
> **2. The first, unsolicited contact is not sent through SES**
> The initial report — the first message a recipient receives from us, before any request on their part —
> is sent through a separate third-party email delivery provider (blastengine), not through SES. This
> separation is implemented and deployed: our initial-report Lambda and its sending code do not import or
> call the SES client at all. So the case you raised previously — an unsolicited first contact to a
> publicly listed business address — does not occur on SES. SES only ever carries mail to recipients who
> have explicitly opted in to continue hearing from us.
>
> **3. Frequency and content**
> At most one email per consented recipient per week, containing an updated version of the report that
> recipient already received and asked to keep receiving. This is not a marketing list, a drip sequence,
> or bulk promotional mail.
>
> **4. Unsubscribe and suppression**
> Every email identifies the sender and tells the recipient they can reply to be removed from future
> emails; those requests are recorded on the recipient's account. Every weekly send is then preceded by a
> single delivery gate, in code, that excludes any recipient who has opted out, or whose address has
> bounced or generated a complaint — this check runs before every individual SES call, not once at
> sign-up. We have additionally implemented a `List-Unsubscribe` header and a per-recipient tokenised
> unsubscribe link, and are deploying the small HTTP endpoint that completes that self-service flow.
>
> **5. Bounce and complaint handling**
> Amazon SES bounce and complaint notifications are captured automatically through an SES Configuration
> Set → SNS topic → AWS Lambda pipeline, which is deployed and has been tested by injecting a bounce
> event and confirming the recipient is suppressed. Account-level suppression for BOUNCE and COMPLAINT is
> enabled.
>
> **6. Sender identity and authentication**
> From address: `aor-report@changescout.jp`. The domain `changescout.jp` is a verified SES identity with
> DKIM signing status SUCCESS; SES DKIM signatures align with the From domain.
>
> **7. Compliance**
> For recipients in Japan we operate in line with Japan's Act on Regulation of Transmission of Specified
> Electronic Mail, including sender identification and a working opt-out. We present this as our operating
> policy, not as a legal opinion, and we understand SES's policy is a separate standard that this request
> addresses on its own terms.
>
> We are happy to provide any additional detail. Our public site describing the service is at
> https://aor.changescout.jp/ .

---

## 社内用日本語訳（現行版）

> **件名: SES Production Access申請 — Amazon SES はオプトイン済みの週次更新メール専用**
>
> 単一かつ範囲を限定した用途について、Amazon SES Production Access を申請します。その用途を正確に
> 説明し、それ自体の基準で評価いただけるようにします。以前の Support Center でのやり取り
> （Case 178662791300353）で、「公開情報から収集したアドレスへ、受信者本人からの事前リクエスト
> なしに送信するモデルは、B2B であっても SES の要件を満たさない」とのご指摘をいただきました。
> その後、当該の懸念が **SES から送るいかなるメールにも当てはまらない**ようアーキテクチャを
> 変更しました。
>
> **1. Amazon SES の用途**
> SES の用途は1つだけです——「週次更新」メールで、当社から初回レポートを既に受け取った受信者が、
> その後**別途・明示的に**継続受信を希望した場合にのみ送信します。受信者は、初回レポート内の
> リンクをたどって自ら確認操作を行います。この意思表示は `weekly_report_consent = true` として
> 記録され、個々の SES 送信の直前にコード上で毎回再確認されます。この操作を行っていない受信者へ
> 週次メールを送るコード経路は存在しません。
>
> **2. 最初の未承諾接触は SES から送らない**
> 初回レポート——受信者が当社から最初に受け取るメールで、受信者側の何らかのリクエストより前に
> 送られるもの——は、SES ではなく別の第三者メール配信事業者（blastengine）から送信します。この
> 分離は実装・デプロイ済みで、当社の初回レポート用 Lambda とその送信コードは SES クライアントを
> 一切 import・呼び出ししません。したがって、以前ご指摘のケース——公開掲載された業務用アドレスへの
> 未承諾の初回接触——は SES 上では発生しません。SES が運ぶのは、継続受信に明示的にオプトインした
> 受信者宛のメールのみです。
>
> **3. 頻度と内容**
> 同意済み受信者1人あたり最大で週1通。内容は、その受信者が既に受け取り継続を希望したレポートの
> 更新版です。マーケティングリスト・ドリップシーケンス・一斉販促メールではありません。
>
> **4. 配信停止と抑制**
> すべてのメールに送信者情報を明記し、配信停止をご希望の場合は返信いただくよう案内します。返信による
> 依頼は受信者の記録へ反映します。そのうえで、すべての週次送信の前にコード上の単一の配信ゲートを通し、
> 配信停止した受信者、またはアドレスがバウンス・苦情を発生させた受信者を、以後の全 SES 送信対象から
> 除外します。このチェックは登録時1回きりではなく、個々の SES 送信の直前に実行されます。加えて、
> `List-Unsubscribe` ヘッダーと受信者ごとのトークン付き配信停止リンクを実装済みで、そのセルフサービス
> 導線を完成させる小さな HTTP エンドポイントを現在デプロイ中です。
>
> **5. バウンス・苦情の処理**
> Amazon SES のバウンス・苦情通知は、SES Configuration Set → SNS トピック → AWS Lambda の
> パイプラインで自動的に捕捉します。これはデプロイ済みで、バウンスイベントを注入して受信者が
> 抑制されることを確認するテストを実施済みです。アカウントレベルの BOUNCE・COMPLAINT 抑制も
> 有効化しています。
>
> **6. 送信元 identity と認証**
> 送信元アドレス: `aor-report@changescout.jp`。ドメイン `changescout.jp` は SES で検証済みの
> identity であり、DKIM 署名ステータスは SUCCESS。SES の DKIM 署名は From ドメインとアライメント
> します。
>
> **7. 法令遵守**
> 日本国内の受信者については、特定電子メールの送信の適正化等に関する法律に沿って運用します
> （送信者情報の明記、機能する配信停止導線を含む）。これは当社の運用方針としてお伝えするもので
> あり、法的意見ではありません。SES のポリシーは別個の基準であり、本申請はそれ自体の基準で
> お答えしています。
>
> 追加情報が必要であればお知らせください。サービスを説明する公開サイトは
> https://aor.changescout.jp/ です。

---

## AWS提出用（英語 / Phase 32A 版 — 改変せず保持。提出済みの可能性あり）

> **Subject: Updated SES Production Access request — clarifying our approved-recipient sending model (re: Case 178662791300353)**
>
> We are writing to give you an accurate, current description of how we use Amazon SES today and how we
> plan to use it, following your review of Case 178662791300353. You noted that sending to addresses
> collected from public sources, without a prior request from the recipient, does not satisfy SES's
> requirements — including for B2B correspondence. We want to address that point directly, rather than
> restate our previous request in different words.
>
> **1. Our primary, clearly compliant use case: recurring updates to recipients who asked to continue**
> The clearest use case we would like Production Access evaluated against is recurring "weekly update"
> emails. These are sent only to a recipient who has already received an initial report from us and then
> separately, explicitly requested to keep receiving updates — an action the recipient takes themselves
> (confirming via a link in the initial report). That request is recorded as `weekly_report_consent = true`
> on the recipient's record and is checked immediately before every weekly SES send; no weekly email is
> ever sent to a recipient who has not taken that action.
>
> **2. What our "Approved List" does, and what the word "Approved" does not mean**
> Every email we send through SES is checked in code against a list of recipients we manage internally as
> "Approved," immediately before each SES call; there is no code path that sends to a recipient outside
> this list. We want to be precise about what "Approved" currently means, so it is not misread as prior
> recipient opt-in: it reflects our own internal decision that we may contact that address, based on staff
> review confirming the address is a business contact published on the company's own website with no
> visible objection to being contacted. It is not, at this time, a record of the recipient having
> proactively requested contact from us before that decision was made.
>
> **3. The initial report: sending method not yet finalized**
> Today, the initial report is also sent through SES once a candidate is marked Approved by our staff,
> using the same list and the same technical gate described above. We recognize this may not, by itself,
> meet SES's requirement that a recipient have made a prior request before we contact them, and we are not
> asking you to evaluate it as if it already does. We have not finalized how we will send the initial
> report going forward. We are evaluating two options: (a) obtaining a recipient's explicit permission
> through a channel other than SES before that recipient's first message is ever sent via SES, or (b)
> using a different email delivery mechanism for that first, unsolicited contact, reserving SES
> exclusively for recipients who have already been in contact with us and explicitly opted to continue.
> Whichever we choose, we will only send a recipient's first message through SES once we can show that
> message satisfies SES's requirement for a prior recipient request.
>
> **4. Safeguards already implemented and verified, independent of the open question above**
> - Any recipient who unsubscribes is excluded from all future sends through the same delivery gate that
>   governs every SES call.
> - Amazon SES bounce and complaint notifications are automatically captured (via an SES Configuration Set
>   → SNS Topic → AWS Lambda pipeline) and immediately suppress further sending to that address.
> - Recipient eligibility (Approved List membership, unsubscribe/bounce/complaint status) is re-checked
>   immediately before every individual SES send, not only once at approval time.
>
> **5. Compliance with Japanese law**
> Our operations targeting recipients in Japan have been reviewed for compliance with Japan's Act on
> Regulation of Transmission of Specified Electronic Mail. We are not presenting that review as evidence of
> compliance with SES's own policy; we understand these are separate standards, and this letter addresses
> the SES-specific standard on its own terms.
>
> We would welcome your guidance on which of the options described in (3) would be acceptable for
> Production Access, or any further requirements you can share so that we design the initial-contact
> mechanism correctly.

---

## 社内用日本語訳（Phase 32A 版 — 改変せず保持）

> **件名: SES Production Access再申請 — 承認済み受信者リストによる送信モデルの明確化（Case 178662791300353関連）**
>
> Case `178662791300353`でのご指摘（公開情報から収集したアドレスへ、受信者本人からの事前
> リクエストなしに送信するモデルは、B2Bであっても要件を満たさない）を受け、現時点で当社が
> Amazon SESをどう使っているか、また今後どう使う予定かを、正確にお伝えします。前回の申請を
> 言葉を変えて繰り返すのではなく、ご指摘の論点に直接お答えします。
>
> **1. 最も明確に要件を満たす主要用途：継続を希望した受信者への定期更新**
> Production Accessの審査対象としてまず評価いただきたい最も明確な用途は、「週次更新」
> メールです。これは、当社から初回レポートを既に受け取った受信者が、その後**受信者自身の
> 行動**（初回レポート内のリンクから確認）によって明示的に継続を希望した場合にのみ送信します。
> この意思表示は受信者の記録上`weekly_report_consent = true`として記録され、週次のSES送信
> 直前に毎回確認されます。この行動を取っていない受信者へ週次メールが送られることはありません。
>
> **2. 「Approved List」が意味すること・意味しないこと**
> 当社がSESから送信するすべてのメールは、送信直前にコード上で「Approved」として当社が管理する
> リストと照合されます。このリスト以外の受信者へ送信するコード経路は存在しません。ここで
> 「Approved」が意味する内容を正確にお伝えします——これは**受信者本人の事前オプトインの記録
> ではありません**。実際には、当社スタッフが、そのアドレスが企業自身の公式サイトに掲載されている
> 業務用連絡先であり、連絡を拒否する明示的な記載が無いことを確認したうえでの、**当社側の内部的な
> 送信可否判断**です。この判断が行われる前に、受信者側から当社への連絡依頼があったことを示す
> ものではありません。
>
> **3. 初回レポート：送信方式は未確定**
> 現時点では、候補者が当社スタッフによってApprovedとされた後、初回レポートも同じリスト・同じ
> 技術的ゲートを経由してSESから送信されます。これ単体では、SESが求める「受信者からの事前
> リクエスト」の要件を満たさない可能性があることを認識しており、既に満たしているものとして
> 評価いただくことは意図していません。今後の初回レポートの送信方式は未確定であり、以下の
> 2つの選択肢を検討中です。(a) SES以外の経路で受信者から明示的な許可を取得したうえで、
> その受信者への最初のメッセージをSESから送信する、(b) 最初の未承諾の接触には別のメール配信
> 手段を用い、SESは既に接点のある受信者・明示的に継続を希望した受信者専用とする。いずれを
> 選択するにせよ、SESが求める事前リクエストの要件を満たせることを確認できてから初めて、
> その受信者への最初のメッセージをSESから送信します。
>
> **4. 上記の未確定事項とは独立して、既に実装・動作確認済みの安全策**
> - 配信停止した受信者は、全てのSES送信を制御する同じ配信ゲートにより、以後の全送信対象から
>   除外されます。
> - Amazon SESのバウンス・苦情通知は自動的に捕捉され（SES Configuration Set → SNS Topic →
>   AWS Lambdaの配線）、該当アドレスへの以後の送信を即座に抑制します。
> - 受信者の送信可否（Approved Listへの該当・配信停止/バウンス/苦情状態）は、承認時の1回きり
>   ではなく、個々のSES送信の直前に毎回再確認されます。
>
> **5. 日本国内法への適合について**
> 日本国内の受信者を対象とする運用については、特定電子メールの送信の適正化等に関する法律への
> 適合について確認を行っています。この確認は、SES独自のポリシーへの適合を示すものとしては
> 提示していません。両者は別個の基準であると理解しており、本書ではSES固有の基準についてのみ
> お答えしています。
>
> 上記(3)の選択肢のうちどちらがProduction Accessとして許容されるか、あるいは初回接触の
> 仕組みを最初から正しく設計できるよう、追加でご教示いただける要件があればお知らせください。

---

## 技術的根拠（社内参照用、AWSへは提出しない）

上記の主張が実装と一致していることを、担当者が事後に検証できるよう、対応するコード上の根拠を
記す（英文提出文書には含めない）。**この表はいずれも「Approved List以外へは送信しないという
技術的事実」の裏付けであり、「Approvedにされた個々の受信者が事前オプトイン済みであること」の
裏付けではない**（両者を混同しないこと。上記提出文の2.・3.参照）。

| 主張 | 根拠となるコード |
|---|---|
| Candidateは常に`"pending"`から始まる | `scripts/generator/leads/lead-store.js` `buildNewLead()`。`delivery_approval_status`を引数として受け付けない設計のため、収集経路（`import-leads.js`・`create-lead-from-email.js`・`website/aor-lead-api/server.js`のPOST /api/leads）のいずれも自動承認を経由できない |
| Approved以外は送信基盤へ到達しない | `scripts/generator/leads/send-initial-report.js` `sendInitialReportForLead()`内の`isDeliveryApproved(lead)`チェック（`lead-store.js`の同名関数）。falseの場合は送信呼び出し自体を行わずskipする（初回=blastengine、週次=SESのいずれのゲートでも同じ） |
| 承認は認証済みスタッフによる明示操作のみ | `website/aor-admin/server.js` `POST /api/leads/:lead_id/delivery-approval`（同ファイルの既存認証・CSRF保護・`auth.logAudit()`監査ログの仕組みをそのまま適用）。フロントエンドは`website/aor-admin/public/leads.html`・`assets/js/leads.js` |
| 承認者・日時が事後追跡できる | `lead-store.js`の`appendHistory()`により、`delivery_approved`/`delivery_rejected`イベントへ`reviewer`（認証済みセッションのusername、クライアント入力は信用しない）を記録 |
| 配信停止も同じゲートで除外される | `isDeliveryBlocked(lead)`（`delivery_status`が`unsubscribed`/`bounced`/`suppressed`の場合）。`send-initial-report.js`・`send-weekly-report.js`双方が送信直前にチェックする |
| 継続配信（Weekly、主要用途）は受信者本人の明示行動が必要 | `send-weekly-report.js`の`weekly_report_consent === true`ゲート（`website/aor-lead-api/server.js`の`POST /api/leads/:lead_id/weekly-report-consent`、受信者本人がレポート内リンクから同意した場合のみtrueになる）。これが提出文1.の直接の裏付け |
| Approved判定基準は本人の事前オプトインではない（誇張していない） | Approved判定基準（[03_lead_generation.md](03_lead_generation.md)「Candidate / Approved分離とApproved判定」）は、収集元の適法性（公開アドレスか・受信拒否の記載が無いか）の当てはめであり、受信者本人の事前リクエストの記録ではない。提出文2.・3.はこれを正確に反映している |
| Bounce/Complaint通知を実際に処理するプロセスがある | `scripts/generator/leads/process-ses-event.js`（コアロジック、Bounce→`delivery_status:"bounced"`、Complaint→`delivery_status:"suppressed"`）を`scripts/generator/lambda/ses-event-handler.js`がAWS Lambda（`pj2-aor-ses-event-processing`）としてラップし、実際にAWSへデプロイ・配線済み。配線: SES Configuration Set `pj2-aor-delivery`（Event Destination: Delivery/Bounce/Complaint）→ SNS Topic `pj2-aor-ses-events` → 上記Lambda。初回・週次送信Lambda（`pj2-aor-initial-report-delivery`・`pj2-aor-weekly-report-delivery`）には環境変数`SES_CONFIGURATION_SET=pj2-aor-delivery`を設定済みで、この2つのLambdaが送るメールは必ずこのConfiguration Set経由になる（`ses-client.js`の`ConfigurationSetName`付与）。デプロイ後、テスト用のBounceイベントをLambdaへ直接invokeし、実際にAWS上でLead JSONのdelivery_statusが更新されることを確認済み |
| 送信可否は送信直前に毎回再確認される（承認時の1回きりではない） | `sendInitialReportForLead()`・`sendWeeklyReportForLead()`はいずれも、対象Lead一覧の事前フィルタだけでなく、実際のSES呼び出し直前に個別Leadへ対して`isDeliveryApproved()`/`isDeliveryBlocked()`等のゲートを再評価する（一括処理の事前フィルタと送信直前チェックが二重になっている設計） |
| 初回AORの送信基盤 | **【Phase 32A 提出時点】** `sendInitialReportForLead()`は`ses-client.js`の`sendEmail()`を直接呼んでいた。提出文3.の「送信方式は未確定」はこの状態を反映。<br>**【2026-08-28 / Phase48 更新】** 初回AORはSESから分離済み。`sendInitialReportForLead()`・`lambda/initial-report-delivery-handler.js`はいずれも`ses-client`をrequireせず`leads/blastengine-client.js`（blastengine Transaction API）を使う。`pj2-aor-initial-report-delivery` Lambda は 2026-08-28 に blastengine版へデプロイ済み（環境変数 `BLASTENGINE_USER_ID`/`BLASTENGINE_API_KEY`/`BLASTENGINE_FROM` 設定済み）。SESを呼ぶのは週次（`pj2-aor-weekly-report-delivery`、`weekly_report_consent === true` のみ）だけになった。詳細は [13_architecture.md](13_architecture.md)「メール送信アーキテクチャ」節を参照 |

**関連する自動テスト**（実装が上記の通り動作することの回帰確認）:
`scripts/generator/test/lead-store.test.js`、`send-initial-report.test.js`、
`aor-admin-leads.test.js`（Candidate生成→pendingのままSESゲートで弾かれる→
管理画面API経由でapprovedに変更→SESゲート通過、までを1本のE2Eテストで検証）、
`lambda-ses-event-handler.test.js`（SNSレコード解釈・processSesEvent()への委譲・
複数レコードの独立処理を検証）、`ses-client.test.js`（`SES_CONFIGURATION_SET`環境変数が
送信ボディの`ConfigurationSetName`へ反映されることを検証）。

## 未確定・提出前に確認すべき事項

- ~~**初回AORの送信方式が未確定**（Phase32A追加）~~ → **【解消 / Phase49 STEP4】** 初回AOR = blastengine、
  週次AOR = SES で確定。**現行版の申請文面（「AWS提出用（英語 / 現行版）」節）**が SES = 週次オプトイン
  専用として立て付けを更新済み。今後の申請にはこちらを使う。Phase 32A 版は提出済みの可能性があるため
  改変せず保持。**Phase 32A 版を実際に提出していたかどうか**（Support Center 送信履歴の確認）は運営者
  （幸田）が確認すること。提出していた場合、現行版で「初回を SES から外した」旨を追って伝えるのが望ましい。
  blastengine の規約適合性は書面回答受領済み（[external-provider-confirmations.md](../external-provider-confirmations.md)「2. blastengine — 正式回答」）
- **想定送信数（申請フォームの必須入力）**: Weekly AOR の実配信実績はゼロ。同意済み受信者数・週次送信数の
  現実的な見積もりは**既存資料からは確定できない**。申請フォームに数値を入力する際は、運営者が
  「初期は少量（例: 月間数百通規模）から」等、根拠を説明できる範囲で記載すること。**本ドキュメントでは
  申請フォームへの入力値を作らない**（根拠のない数字を提出しない方針）
- 実際の運用開始時期（申請フォームで問われる場合、運営者が別途用意する）
- Approved判定基準自体（[03_lead_generation.md](03_lead_generation.md)記載の3条件）は法務専門家による
  正式な確認を経ていない（[14_risk.md](14_risk.md)参照）。AWSへの技術的な説明とは独立した論点として、
  引き続き法務確認を進めること。**この基準は受信者本人の事前オプトインではないため、法務確認が
  完了しても、それ単独でSESの要件を満たすとは限らない**点に注意（提出文2.参照）
- 週次配信（Subscribed）・配信停止（Unsubscribed）の実運用フローは実装済みだが、実際の送信実績が
  無いため、申請文中で「実績」ではなく「設計・実装済みの仕組み」として説明している点に注意
- ~~Bounce/Complaint通知の実配線（SNS/Lambda/Configuration Set）が未着手~~ →
  **解消済み**。上記表のとおり実際にAWSへデプロイ・動作確認済みのため、申請フォームの
  「バウンスや苦情の通知を処理するプロセスがあることを確認した」チェックボックスは
  事実に基づいて同意できる状態になった
- **ウェブサイトURLについて**: 現在申請フォームに入力するURLは`https://aor.changescout.jp/`
  （GitHub Pages、独自ドメイン設定済み・HTTPS有効）。以前はCloudFrontの既定ドメインを
  使っていたが、審査担当者向けの説明ページ（`index.html`・`privacy.html`）をこのドメインへ
  移設済み。**これはあくまで見た目の信頼性の話であり、送信内容・送信対象の実態（Approved
  判定の中身＝本人の事前オプトインではないこと）を偽らない範囲でのみ行っている**点に
  変わりはない。提出前に `https://aor.changescout.jp/` が現在も到達可能で、現行の
  サービス説明・privacy ページを指していることを再確認すること
- ~~**週次 SES メールのワンクリック配信停止が未実装**（Phase49 STEP4 で判明）~~ → **【メール側は実装済み /
  Phase49 STEP5】** `send-weekly-report.js` が Initial と同じ `buildUnsubscribeUrl()`（同じ `report_token`
  ベース）で配信停止URLを組み立て、(a) `buildWeeklyEmailContent()` が text/html 本文に配信停止リンクを明記、
  (b) `ses-client.js` を `Content.Simple.Headers` 対応へ拡張し `List-Unsubscribe` ヘッダーを付与。返信ベースの
  停止も併記して維持。テスト 197/197 pass（`send-weekly-report.test.js` / `ses-client.test.js` /
  `unsubscribe-url.test.js`）。
  - **⚠️ 残るインフラギャップ**（申請前に対応推奨、Initial 側にも同じ問題）:
    1. **配信停止HTTPエンドポイントが本番未デプロイ**（Phase49 STEP3 で判明 → STEP6 で配線方式確定）:
       `website/aor-lead-api`（`POST /api/leads/unsubscribe` → `unsubscribeLeadByToken()`、および weekly-consent /
       paid-request / 公開フォーム）は AWS へデプロイされていない。API Gateway・Function URL とも未作成
       （`aws lambda list-functions` / `apigateway get-rest-apis` で確認済み）。`unsubscribe.html` が POST する
       `LEAD_API_BASE_URL` は `common.js` でプレースホルダ（`http://localhost:4700`）。**このため現状は Initial・
       Weekly とも、メール内リンク／`List-Unsubscribe` を辿っても実際の配信停止まで到達しない。返信ベースの
       停止のみが機能する。**
       - **Phase49 STEP6 で配線方式を確定**: Lambda + Function URL（`blastengine-webhook` と同じ薄い HTTP
         アダプター方針）。`server.js` から `requestListener(req, res)` を切り出し、`scripts/generator/lambda/
         lead-api-handler.js` を実装・ローカルテスト済み（9件 pass）。残るのはデプロイ（新 Lambda `pj2-aor-lead-api`
         + Function URL + 環境変数 `LEAD_API_ALLOWED_ORIGINS`、`common.js` の `LEAD_API_BASE_URL` 書き換え、
         `unsubscribe.html`/`common.js` を配信サイトへ再デプロイ）。次 STEP で実施
    2. **RFC 8058 の真のワンクリック（`List-Unsubscribe-Post`）は未対応**: 現在の配信停止URLは静的な確認ページ
       であり MUA からの直接 POST を処理しない。Weekly は `oneClick: false` で `List-Unsubscribe-Post` を付けて
       いない（付けると Gmail 等が「配信停止完了」と誤表示するため意図的に不採用）。POST を受けてその場で
       配信停止する軽量エンドポイントを用意したら `oneClick: true` へ戻す（`unsubscribe-url.js` にフラグあり）
  - 申請文面（現行版 §4）は返信ベースの配信停止 + 配信ゲート + suppression を「実装済み・稼働」として記載し、
    `List-Unsubscribe` ヘッダー + トークン付きリンクは「実装済み・エンドポイントをデプロイ中」と記載する
    （Phase49 STEP7 で「稼働中」と断定しない表現へ修正）。ギャップ1解消後に「デプロイ中」→「稼働」へ更新
- **現行版申請文面の記述と実装状況の対応（Phase49 STEP7 レビュー、3分類）**:

  | 申請文面の記述 | 分類 | 実装/デプロイ状況 |
  |---|---|---|
  | Initial = blastengine（SES 非経由、Lambda が `ses-client` 非依存） | **A: 実装済み・稼働** | `pj2-aor-initial-report-delivery` 2026-08-28 デプロイ。実送信1通確認済み |
  | Weekly = SES（`weekly_report_consent === true` のみ、送信直前に再チェック） | **A（コード）／実配信実績ゼロ** | `send-weekly-report.js` にゲート実装。Weekly Lambda は旧コードのまま（STEP5 の List-Unsubscribe は未デプロイ）。同意済み受信者ゼロ・週次送信ゼロ |
  | 返信による配信停止 → 記録へ反映 → 配信ゲートで除外 | **A: 実装済み・稼働** | `unsubscribeLeadByToken()`（CLI/reply）+ `isDeliveryBlocked()`。運用手順は `operations-checklist.md` に記載 |
  | `List-Unsubscribe` ヘッダー + トークン付き配信停止リンク | **B: 実装済み・本番未稼働** | Weekly=STEP5 実装（未コミット・未デプロイ）。Initial=blastengine `list_unsubscribe` で稼働だが遷移先エンドポイント未デプロイ |
  | 配信停止用 HTTP エンドポイント（`aor-lead-api`） | **B→C: 実装済み・デプロイ未実施** | STEP6 で Lambda アダプター実装・ローカルテスト済み。デプロイは次 STEP |
  | 継続希望（consent）の登録リンク（§1「following a link ... and confirming」） | **B: 実装済み・本番未稼働** | 同じ `aor-lead-api`（`POST /api/leads/:id/weekly-report-consent`）。エンドポイント未デプロイのため、現時点で consent をオンラインで登録する導線は動かない（＝そもそも週次送信対象が発生しない） |
  | SES Bounce/Complaint パイプライン（Config Set → SNS → Lambda）+ アカウント抑制 | **A: 実装済み・稼働（実バウンス未経験）** | `pj2-aor-ses-event-processing` デプロイ・配線済み。直接 invoke テスト済み。実 SES バウンス処理はまだ（週次送信実績ゼロのため） |
  | DKIM（`changescout.jp` Verified / SUCCESS） | **A: 実装済み・稼働** | `get-email-identity` で確認済み |

  → 申請文面は「is implemented and deployed」を Initial 分離・Bounce パイプラインにのみ使い、Weekly の
  List-Unsubscribe/リンク/consent 導線には「implemented ... and are deploying」を使う。**未デプロイのものを
  「稼働中」と書かない／稼働中のものを「予定」と書かない**、を STEP7 で担保した
- **現行版申請文面のレビュー観点（その他）**: (1) blastengine 側の実運用実績は初回1通のみ。「deployed」「tested」
  という語のみ使い「実績多数」のような表現はしていない。(2) Weekly の Bounce/Complaint は「tested by injecting a
  bounce event」= Lambda 直接 invoke テスト。実 SES バウンス検証はまだ。文面はこの範囲。(3) 特定電子メール法は
  「運用方針」であり法的意見ではない旨を明記済み（[14_risk.md](14_risk.md) と整合）
