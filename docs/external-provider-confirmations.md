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

## 2. blastengine — 問い合わせ状況（プレースホルダー、原文未取り込み）

**Status: 問い合わせ送信済み／回答内容はこのファイル・この会話セッションでは未確認**

- Source: blastengine公式問い合わせフォーム（`https://blastengine.jp/contact/`、Phase38で文面確定）
- Archive Status: 原文未取り込み（Pending original email import）

### 注記

- blastengineへの問い合わせはPhase38で文面が完成し、ユーザーにより送信済み（ユーザー確認済み、直近のやり取りで「blastengineには問合せ中です」と共有されている）。
- **回答が実際に届いたかどうか、届いた場合の内容は、この会話・このリポジトリのいずれにも原文が共有されておらず、確認できていない。**
- 「回答受領済み」という状態を、原文を見ないままこのファイルへ確定事実として記録することはしない（Smartleadエントリと同じ「原文を改変・要約せず、確認できた事実のみを記録する」方針を維持するため）。
- 原文（メール本文全体）が共有され次第、このエントリをSmartleadエントリと同じ構成（受領日・参照ID・原文・許容範囲/未確定事項の分離整理）へ全面的に書き換える。
- それまでの間、Phase44 STEP1/STEP2で行った規約面の暫定評価（C：不明／要書面確認）は変更しない。

### 現時点の確認状況比較（Smartlead vs blastengine）

| 項目 | Smartlead | blastengine |
|---|---|---|
| 規約回答 | 回答受領済み | 回答待ち |
| API送信許可 | 回答あり | 未確認 |
| Cold outreach | 回答あり | 未確認 |
| Weekly opt-in条件 | 回答あり | 未確認 |
| 法的判断ではない旨 | 回答あり | 未確認 |
