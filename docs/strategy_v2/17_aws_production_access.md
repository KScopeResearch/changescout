# 17_aws_production_access.md — AWS SES Production Access 再申請用資料

## これは何か

AWS Support Case `178662791300353` への回答（未承諾メール送信は認められない、公開情報だけでは
SES上の受信許可とみなされない、B2Bでも扱いは変わらない、初回送信前の明示的なオプトインを推奨、
というAWSからの指摘）を受け、Candidate（収集）とApproved（送信許可）を分離する実装を行った
（`scripts/generator/leads/lead-store.js`の`delivery_approval_status`、
`website/aor-admin`のLeads画面、`send-initial-report.js`のゲート）。

本ドキュメントは、その実装結果に基づいてAWSへ再申請する際の説明文（英語、提出用）と、
その日本語訳（社内確認用）、および主張の技術的根拠（社内参照用、AWSへは提出しない）をまとめる。

再申請そのもの（AWS Supportコンソールへの提出操作）は本ドキュメント作成の範囲外。
提出前に、実際の運用開始日・送信量見込み等、申請フォーム側で追加入力が必要な項目が
無いかを別途確認すること。

---

## AWS提出用（英語）

> **Subject: Updated SES Production Access request — Candidate/Approved separation (re: Case 178662791300353)**
>
> We are writing to provide an updated description of our sending architecture following your review of
> Case 178662791300353. You noted that our previous model — sending directly to addresses collected from
> public sources — does not by itself demonstrate recipient permission for SES, and that this holds even
> for B2B correspondence. In response, we have restructured the application so that data collection and
> the decision to send are two structurally separate stages, and only the second stage can ever reach
> Amazon SES.
>
> **1. Lead Collection (Candidate list — never sent to)**
> Public B2B contact addresses (for example, an `info@` or `sales@` address published on a company's own
> official website) are collected into our internal lead database as "Candidates." Every new candidate
> record is created with a status field, `delivery_approval_status`, hard-coded to `"pending"`. There is
> no code path in our application that can create a candidate record with any other initial value, and no
> automated process that changes it. A Candidate is inert data — our sending logic never reads from the
> candidate list directly.
>
> **2. Approval Gateway (human review, authenticated staff only)**
> Before any Candidate can be emailed, an authenticated staff member reviews it in our internal,
> password-protected admin console (session-based authentication, CSRF-protected, all actions logged)
> and manually confirms two things for that specific address: (a) it is genuinely a business contact
> address published on the company's own website — the category exempted under Japan's Act on Regulation
> of Transmission of Specified Electronic Mail (特定電子メール法); and (b) the page where it was found
> carries no "no unsolicited email" / "do not contact for sales" notice. Only when both are confirmed does
> the staff member click "Approve," which sets `delivery_approval_status` to `"approved"` and records who
> approved it and when in an auditable history log. Addresses that do not meet these criteria are marked
> `"rejected"` and permanently excluded. This decision is never automated; it always requires an explicit
> human action by an authenticated operator.
>
> **3. SES Delivery Gate (hard-coded, cannot be bypassed)**
> Our sending script performs an explicit check — `isDeliveryApproved(lead)` — immediately before every
> SES `SendEmail` call. If a recipient's `delivery_approval_status` is anything other than `"approved"`
> (including the default `"pending"` state, or `"rejected"`), the send is skipped and no SES API call is
> made. There is no code path that sends to a Candidate or an unapproved recipient. Recipients who
> unsubscribe are excluded through the same gate via a separate, independently enforced status field.
> Recurring (weekly) reports are sent only to recipients who already received an approved initial email
> and then separately, explicitly opted in to continue receiving updates; that consent is also recorded
> and checked before every subsequent send.
>
> In short: collection and permission-to-send are enforced as two separate stages in the codebase itself,
> not merely in policy, and Amazon SES is only ever called for recipients that passed an explicit, logged,
> human approval step. We would welcome the opportunity to walk through this workflow live, or to provide
> further technical detail, if that would help your review.

---

## 社内用日本語訳

> **件名: SES Production Access再申請 — Candidate/Approved分離について（Case 178662791300353関連）**
>
> Case `178662791300353`でのご指摘（公開情報から収集したアドレスへ直接送信するモデルは、それ自体では
> SES上の受信許可を示す根拠にならず、B2Bであってもこの扱いは変わらないという点）を受け、送信アーキテクチャを
> 見直しましたのでご報告します。データの収集と「送ってよいかどうかの判断」を、コード構造として明確に
> 2段階へ分離し、後者を経由した場合にのみAmazon SESへ到達する設計に変更しました。
>
> **1. リード収集（Candidateリスト — 送信対象ではない）**
> 企業の公式サイトに掲載されている公開のB2B連絡先（`info@`や`sales@`等）を、社内のリードデータベースへ
> 「Candidate（候補）」として収集します。新規に作成されるCandidateレコードは、`delivery_approval_status`
> というステータス項目が常に`"pending"`（未承認）から始まります。この初期値以外でレコードが作られる
> コード経路は存在せず、自動的にこの値を変更する処理もありません。Candidateは受動的なデータに過ぎず、
> 送信処理がCandidateリストを直接参照することはありません。
>
> **2. 承認ゲートウェイ（人間によるレビュー、認証済みスタッフのみ）**
> Candidateがメール送信対象になる前に、認証済みの担当者が社内の管理画面（パスワード保護、
> セッション認証、CSRF保護、全操作を監査ログへ記録）でその宛先を個別に確認し、以下の2点を
> 手動で確認します。(a) 実際に企業自身の公式サイトに掲載されている営業窓口アドレスであり、
> 日本の特定電子メール法（特定電子メールの送信の適正化等に関する法律）のオプトイン規制適用除外に
> 該当すること。(b) 掲載元ページに「営業メールお断り」等の受信拒否の明示的な記載が無いこと。
> 両方を確認できた場合にのみ、担当者が「Approve」を押すことで`delivery_approval_status`が
> `"approved"`へ変わり、誰がいつ承認したかが監査可能な履歴として記録されます。基準を満たさない
> 宛先は`"rejected"`として記録され、以後永続的に送信対象から除外されます。この判断が自動化される
> ことは一切なく、常に認証済みの担当者による明示的な操作を必須とします。
>
> **3. SES送信ゲート（コードにハードコードされ、迂回不可能）**
> 送信スクリプトは、SESの`SendEmail`を呼び出す直前に必ず`isDeliveryApproved(lead)`という
> 明示的なチェックを行います。受信者の`delivery_approval_status`が`"approved"`以外
> （既定値の`"pending"`、または`"rejected"`を含む）の場合、送信はスキップされ、SES APIは
> 一切呼び出されません。CandidateまたはApprovedでない受信者へ送信するコード経路は存在しません。
> 配信停止（unsubscribe）した受信者も、別に独立して管理されるステータス項目により、同じゲートを
> 通じて除外されます。継続配信（週次レポート）は、初回の承認済みメールを受け取った受信者が、
> さらに個別に継続を明示的に希望した場合にのみ送信され、その同意も送信の都度確認されます。
>
> 要約すると、収集と送信許可は運用ポリシー上だけでなく、コード自体の構造として2段階に分離されており、
> Amazon SESは、明示的で記録された人間の承認を経た受信者に対してのみ呼び出されます。この仕組みの
> 実演や、追加の技術的な説明が審査の助けになるようであれば、いつでも対応いたします。

---

## 技術的根拠（社内参照用、AWSへは提出しない）

上記の主張が実装と一致していることを、担当者が事後に検証できるよう、対応するコード上の根拠を
記す（英文提出文書には含めない）。

| 主張 | 根拠となるコード |
|---|---|
| Candidateは常に`"pending"`から始まる | `scripts/generator/leads/lead-store.js` `buildNewLead()`。`delivery_approval_status`を引数として受け付けない設計のため、収集経路（`import-leads.js`・`create-lead-from-email.js`・`website/aor-lead-api/server.js`のPOST /api/leads）のいずれも自動承認を経由できない |
| Approved以外はSESへ到達しない | `scripts/generator/leads/send-initial-report.js` `sendInitialReportForLead()`内の`isDeliveryApproved(lead)`チェック（`lead-store.js`の同名関数）。falseの場合はSES呼び出し自体を行わずskipする |
| 承認は認証済みスタッフによる明示操作のみ | `website/aor-admin/server.js` `POST /api/leads/:lead_id/delivery-approval`（同ファイルの既存認証・CSRF保護・`auth.logAudit()`監査ログの仕組みをそのまま適用）。フロントエンドは`website/aor-admin/public/leads.html`・`assets/js/leads.js` |
| 承認者・日時が事後追跡できる | `lead-store.js`の`appendHistory()`により、`delivery_approved`/`delivery_rejected`イベントへ`reviewer`（認証済みセッションのusername、クライアント入力は信用しない）を記録 |
| 配信停止も同じゲートで除外される | `isDeliveryBlocked(lead)`（`delivery_status`が`unsubscribed`/`bounced`/`suppressed`の場合）。`send-initial-report.js`・`send-weekly-report.js`双方が送信直前にチェックする |
| 継続配信は別途の明示同意が必要 | `send-weekly-report.js`の`weekly_report_consent === true`ゲート（`website/aor-lead-api/server.js`の`POST /api/leads/:lead_id/weekly-report-consent`、受信者本人がレポート内リンクから同意した場合のみtrueになる） |
| 承認基準そのものの自動判定は行っていない（誇張していない） | Approved判定基準（[03_lead_generation.md](03_lead_generation.md)「Candidate / Approved分離とApproved判定」）の当てはめは人間が行う。ページ内の受信拒否文言検出等を自動化するコードは存在しない——提出文書でも「human review」「manual」と明記し、実装以上の主張をしていない |
| Bounce/Complaint通知を実際に処理するプロセスがある（申請フォームの同意チェックボックスの裏付け） | `scripts/generator/leads/process-ses-event.js`（コアロジック、Bounce→`delivery_status:"bounced"`、Complaint→`delivery_status:"suppressed"`）を`scripts/generator/lambda/ses-event-handler.js`がAWS Lambda（`pj2-aor-ses-event-processing`）としてラップし、実際にAWSへデプロイ・配線済み。配線: SES Configuration Set `pj2-aor-delivery`（Event Destination: Delivery/Bounce/Complaint）→ SNS Topic `pj2-aor-ses-events` → 上記Lambda。初回・週次送信Lambda（`pj2-aor-initial-report-delivery`・`pj2-aor-weekly-report-delivery`）には環境変数`SES_CONFIGURATION_SET=pj2-aor-delivery`を設定済みで、この2つのLambdaが送るメールは必ずこのConfiguration Set経由になる（`ses-client.js`の`ConfigurationSetName`付与）。デプロイ後、テスト用のBounceイベントをLambdaへ直接invokeし、実際にAWS上でLead JSONのdelivery_statusが更新されることを確認済み |

**関連する自動テスト**（実装が上記の通り動作することの回帰確認）:
`scripts/generator/test/lead-store.test.js`、`send-initial-report.test.js`、
`aor-admin-leads.test.js`（Candidate生成→pendingのままSESゲートで弾かれる→
管理画面API経由でapprovedに変更→SESゲート通過、までを1本のE2Eテストで検証）、
`lambda-ses-event-handler.test.js`（SNSレコード解釈・processSesEvent()への委譲・
複数レコードの独立処理を検証）、`ses-client.test.js`（`SES_CONFIGURATION_SET`環境変数が
送信ボディの`ConfigurationSetName`へ反映されることを検証）。

## 未確定・提出前に確認すべき事項

- 実際の運用開始時期・想定送信数（申請フォーム側で問われる場合、本ドキュメントの範囲外のため別途用意する）
- Approved判定基準自体（[03_lead_generation.md](03_lead_generation.md)記載の3条件）は法務専門家による
  正式な確認を経ていない（[14_risk.md](14_risk.md)参照）。AWSへの技術的な説明とは独立した論点として、
  引き続き法務確認を進めること
- 週次配信（Subscribed）・配信停止（Unsubscribed）の実運用フローは実装済みだが、実際の送信実績が
  無いため、申請文中で「実績」ではなく「設計・実装済みの仕組み」として説明している点に注意
- ~~Bounce/Complaint通知の実配線（SNS/Lambda/Configuration Set）が未着手~~ →
  **解消済み**。上記表のとおり実際にAWSへデプロイ・動作確認済みのため、申請フォームの
  「バウンスや苦情の通知を処理するプロセスがあることを確認した」チェックボックスは
  事実に基づいて同意できる状態になった
- **ウェブサイトURLについて**: 現在申請フォームに入力するURLは`https://aor.changescout.jp/`
  （CloudFrontの既定ドメイン）であり、独自ドメインを設定していない。審査担当者から見ると、
  既定のCloudFrontドメインは「作りかけの実験的なサイト」という印象を与えやすく、
  提出内容全体の信頼性評価にマイナスに働く可能性がある。改善余地としては、
  (a) `changescout.jp`配下のサブドメイン（例: `aor.changescout.jp`）をこのCloudFront
  ディストリビューションのAlternate Domain Name（CNAME）として設定し、ACM証明書を発行する、
  (b) 会社としての公式LP（`docs/strategy/PROJECT.md`のミッション・実績等を含む、単なるAOR
  受信者向けページ以上の「実在する事業者」を示す情報）を別途用意し、審査担当者の連絡先欄・
  申請文中で参照できるようにする、の2点が考えられる。**ただし、これはあくまで見た目の
  信頼性の話であり、送信内容・送信対象の実態（Approved判定の中身）を偽らない範囲でのみ
  行うこと**——独自ドメインを取得しても、送信対象が実際には未承諾の収集済みアドレスの
  ままなら、審査結果に影響する本質的な論点（本人の事前同意の有無）は変わらない
