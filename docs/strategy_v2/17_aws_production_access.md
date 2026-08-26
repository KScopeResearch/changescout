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

---

## AWS提出用（英語）

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

## 社内用日本語訳

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
| Approved以外はSESへ到達しない | `scripts/generator/leads/send-initial-report.js` `sendInitialReportForLead()`内の`isDeliveryApproved(lead)`チェック（`lead-store.js`の同名関数）。falseの場合はSES呼び出し自体を行わずskipする |
| 承認は認証済みスタッフによる明示操作のみ | `website/aor-admin/server.js` `POST /api/leads/:lead_id/delivery-approval`（同ファイルの既存認証・CSRF保護・`auth.logAudit()`監査ログの仕組みをそのまま適用）。フロントエンドは`website/aor-admin/public/leads.html`・`assets/js/leads.js` |
| 承認者・日時が事後追跡できる | `lead-store.js`の`appendHistory()`により、`delivery_approved`/`delivery_rejected`イベントへ`reviewer`（認証済みセッションのusername、クライアント入力は信用しない）を記録 |
| 配信停止も同じゲートで除外される | `isDeliveryBlocked(lead)`（`delivery_status`が`unsubscribed`/`bounced`/`suppressed`の場合）。`send-initial-report.js`・`send-weekly-report.js`双方が送信直前にチェックする |
| 継続配信（Weekly、主要用途）は受信者本人の明示行動が必要 | `send-weekly-report.js`の`weekly_report_consent === true`ゲート（`website/aor-lead-api/server.js`の`POST /api/leads/:lead_id/weekly-report-consent`、受信者本人がレポート内リンクから同意した場合のみtrueになる）。これが提出文1.の直接の裏付け |
| Approved判定基準は本人の事前オプトインではない（誇張していない） | Approved判定基準（[03_lead_generation.md](03_lead_generation.md)「Candidate / Approved分離とApproved判定」）は、収集元の適法性（公開アドレスか・受信拒否の記載が無いか）の当てはめであり、受信者本人の事前リクエストの記録ではない。提出文2.・3.はこれを正確に反映している |
| Bounce/Complaint通知を実際に処理するプロセスがある | `scripts/generator/leads/process-ses-event.js`（コアロジック、Bounce→`delivery_status:"bounced"`、Complaint→`delivery_status:"suppressed"`）を`scripts/generator/lambda/ses-event-handler.js`がAWS Lambda（`pj2-aor-ses-event-processing`）としてラップし、実際にAWSへデプロイ・配線済み。配線: SES Configuration Set `pj2-aor-delivery`（Event Destination: Delivery/Bounce/Complaint）→ SNS Topic `pj2-aor-ses-events` → 上記Lambda。初回・週次送信Lambda（`pj2-aor-initial-report-delivery`・`pj2-aor-weekly-report-delivery`）には環境変数`SES_CONFIGURATION_SET=pj2-aor-delivery`を設定済みで、この2つのLambdaが送るメールは必ずこのConfiguration Set経由になる（`ses-client.js`の`ConfigurationSetName`付与）。デプロイ後、テスト用のBounceイベントをLambdaへ直接invokeし、実際にAWS上でLead JSONのdelivery_statusが更新されることを確認済み |
| 送信可否は送信直前に毎回再確認される（承認時の1回きりではない） | `sendInitialReportForLead()`・`sendWeeklyReportForLead()`はいずれも、対象Lead一覧の事前フィルタだけでなく、実際のSES呼び出し直前に個別Leadへ対して`isDeliveryApproved()`/`isDeliveryBlocked()`等のゲートを再評価する（一括処理の事前フィルタと送信直前チェックが二重になっている設計） |
| 初回AORは現時点でSESから分離されていない（事実として明記） | `sendInitialReportForLead()`は現在も`ses-client.js`の`sendEmail()`を直接呼ぶ。Candidate/Approved分離の実装はSES送信対象の絞り込みであり、送信基盤自体をSESから分離する変更ではない。提出文3.の「送信方式は未確定」はこの現状を正確に反映している（別Phaseで送信基盤分離を検討する） |

**関連する自動テスト**（実装が上記の通り動作することの回帰確認）:
`scripts/generator/test/lead-store.test.js`、`send-initial-report.test.js`、
`aor-admin-leads.test.js`（Candidate生成→pendingのままSESゲートで弾かれる→
管理画面API経由でapprovedに変更→SESゲート通過、までを1本のE2Eテストで検証）、
`lambda-ses-event-handler.test.js`（SNSレコード解釈・processSesEvent()への委譲・
複数レコードの独立処理を検証）、`ses-client.test.js`（`SES_CONFIGURATION_SET`環境変数が
送信ボディの`ConfigurationSetName`へ反映されることを検証）。

## 未確定・提出前に確認すべき事項

- **初回AORの送信方式が未確定**（今回追加）: 提出文3.に記載のとおり、初回AORをSES経由で
  送り続けるか、SES以外の基盤へ切り出すかは未決定。この判断・実装は別Phaseで行う。今回の
  ドキュメント更新は、この未確定な状態を正直に説明することが目的であり、判断を先取りしていない
- 実際の運用開始時期・想定送信数（申請フォーム側で問われる場合、本ドキュメントの範囲外のため別途用意する）
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
  判定の中身、初回AORの送信方式が未確定であること）を偽らない範囲でのみ行っている**点に
  変わりはない
