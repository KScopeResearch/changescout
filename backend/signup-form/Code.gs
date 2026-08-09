// ChangeScout βテスター登録フォーム バックエンド（Google Apps Script）
//
// LP（website/index.html）の #signup フォームから送信されたデータを
// このスプレッドシートの1行として記録し、管理者へメール通知する。
//
// セットアップ手順は backend/signup-form/README.md を参照。

const NOTIFY_EMAIL = "takenori.kouda@gmail.com";

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ status: "error", message: "invalid JSON" });
  }

  const company = (data.company || "").toString().trim();
  const name = (data.name || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const interest = (data.interest || "").toString().trim();

  // 必須項目（会社名・お名前・メール）が欠けている場合は記録しない。
  if (!company || !name || !email) {
    return respond({ status: "error", message: "missing required field" });
  }

  const now = new Date();
  sheet.appendRow([now, company, name, email, interest]);

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: "【ChangeScout】新規β登録: " + company,
      body:
        "βテスターの新規登録がありました。\n\n" +
        "会社名: " + company + "\n" +
        "お名前: " + name + "\n" +
        "メールアドレス: " + email + "\n" +
        "関心のある分野: " + (interest || "(未入力)") + "\n" +
        "登録日時: " + Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd HH:mm"),
    });
  } catch (err) {
    // メール送信に失敗してもスプレッドシートへの記録は成功しているので、
    // ここでは握りつぶしてエラーを返さない（データの取りこぼしを防ぐ）。
  }

  return respond({ status: "success" });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
