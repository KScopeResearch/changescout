/**
 * s3-backend.test.js — scripts/generator/leads/backends/s3-backend.js の自動テスト。
 *
 * 実AWSへは一切接続しない。@aws-sdk/client-s3のS3Clientを、インメモリの疑似実装
 * （createFakeS3Client()）に差し替えてテストする（ses-client.jsのfetch差し替え、
 * send-initial-report.jsのoptions.sendEmail差し替えと同じ依存性注入パターン）。
 * S3ClientのCommand（GetObjectCommand/PutObjectCommand/ListObjectsV2Command）は
 * 実際の@aws-sdk/client-s3から生成し、command.constructor.name / command.inputで
 * 判定する（コマンド自体はSDKの実装をそのまま使うため、パラメータの組み立て方が
 * 変わっても追従できる）。
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const s3Backend = require("../leads/backends/s3-backend");

const ENV_VARS = ["LEAD_STORE_S3_BUCKET", "LEAD_STORE_S3_PREFIX", "AWS_REGION"];

/** @returns {Object} */
function snapshotEnv() {
  const snap = {};
  ENV_VARS.forEach((name) => (snap[name] = process.env[name]));
  return snap;
}

/** @param {Object} snap */
function restoreEnv(snap) {
  ENV_VARS.forEach((name) => {
    if (snap[name] === undefined) delete process.env[name];
    else process.env[name] = snap[name];
  });
}

/** @param {import("node:test").TestContext} t */
function withS3Config(t, overrides = {}) {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.LEAD_STORE_S3_BUCKET = overrides.bucket || "test-lead-bucket";
  process.env.AWS_REGION = overrides.region || "ap-northeast-1";
  if (overrides.prefix) process.env.LEAD_STORE_S3_PREFIX = overrides.prefix;
  else delete process.env.LEAD_STORE_S3_PREFIX;
}

/**
 * インメモリの疑似S3クライアント。objectsは{key: bodyString}のMap相当。
 * @param {{objects?:Object<string,string>, onSend?:Function}} [opts]
 * @returns {{send:Function, calls:Array<Object>, objects:Object<string,string>}}
 */
function createFakeS3Client(opts = {}) {
  const objects = opts.objects || {};
  const calls = [];
  const send = async (command) => {
    calls.push(command);
    if (opts.onSend) {
      const overridden = opts.onSend(command);
      if (overridden !== undefined) return overridden;
    }
    const name = command.constructor.name;
    if (name === "GetObjectCommand") {
      const key = command.input.Key;
      if (!(key in objects)) {
        const err = new Error("The specified key does not exist.");
        err.name = "NoSuchKey";
        throw err;
      }
      return { Body: { transformToString: async () => objects[key] } };
    }
    if (name === "PutObjectCommand") {
      objects[command.input.Key] = command.input.Body;
      return {};
    }
    if (name === "ListObjectsV2Command") {
      const prefix = command.input.Prefix || "";
      const keys = Object.keys(objects)
        .filter((k) => k.startsWith(prefix))
        .sort();
      return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
    }
    throw new Error(`未対応のコマンド: ${name}`);
  };
  return { send, calls, objects };
}

function sampleLead(overrides = {}) {
  return {
    lead_id: "a".repeat(64),
    report_token: "b".repeat(64),
    email: "s3-backend-test@example.invalid",
    company_url: "https://example.com",
    company_slug: null,
    status: "collected",
    delivery_status: "active",
    history: [{ at: "2026-01-01T00:00:00.000Z", event: "collected", metadata: null }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveConfig()
// ---------------------------------------------------------------------------

test("resolveConfig: LEAD_STORE_S3_BUCKET未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.LEAD_STORE_S3_BUCKET;
  assert.throws(() => s3Backend.resolveConfig(), /LEAD_STORE_S3_BUCKET/);
});

test("resolveConfig: AWS_REGION未設定はエラーになる", (t) => {
  withS3Config(t);
  delete process.env.AWS_REGION;
  assert.throws(() => s3Backend.resolveConfig(), /AWS_REGION/);
});

test("resolveConfig: prefix未指定時は既定値'leads/'になる", (t) => {
  withS3Config(t);
  const { prefix } = s3Backend.resolveConfig();
  assert.equal(prefix, "leads/");
});

test("resolveConfig: LEAD_STORE_S3_PREFIXで上書きできる", (t) => {
  withS3Config(t, { prefix: "custom-prefix/" });
  const { prefix } = s3Backend.resolveConfig();
  assert.equal(prefix, "custom-prefix/");
});

// ---------------------------------------------------------------------------
// leadKey()
// ---------------------------------------------------------------------------

test("leadKey: prefix + lead_id + .json という形式のキーを組み立てる", () => {
  assert.equal(s3Backend.leadKey("abc123", "leads/"), "leads/abc123.json");
});

test("leadKey: 不正なlead_id（パストラバーサル試行）は例外を投げる", () => {
  assert.throws(() => s3Backend.leadKey("../../etc/passwd", "leads/"));
  assert.throws(() => s3Backend.leadKey("..", "leads/"));
});

// ---------------------------------------------------------------------------
// readLead()
// ---------------------------------------------------------------------------

test("readLead: 存在するオブジェクトを正しくパースして返す", async (t) => {
  withS3Config(t);
  const lead = sampleLead();
  const key = s3Backend.leadKey(lead.lead_id, "leads/");
  const client = createFakeS3Client({ objects: { [key]: JSON.stringify(lead) } });

  const result = await s3Backend.readLead(lead.lead_id, { client });
  assert.deepEqual(result, lead);
});

test("readLead: 存在しないオブジェクト（NoSuchKey）はnullを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const result = await s3Backend.readLead("f".repeat(64), { client });
  assert.equal(result, null);
});

test("readLead: 404（$metadata.httpStatusCode）もnullを返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client({
    onSend: (command) => {
      if (command.constructor.name === "GetObjectCommand") {
        const err = new Error("Not Found");
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
    },
  });
  const result = await s3Backend.readLead("a".repeat(64), { client });
  assert.equal(result, null);
});

test("readLead: NoSuchKey/404以外のS3エラーはそのまま呼び出し元へ伝播する", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client({
    onSend: (command) => {
      if (command.constructor.name === "GetObjectCommand") {
        const err = new Error("Access Denied");
        err.name = "AccessDenied";
        throw err;
      }
    },
  });
  await assert.rejects(() => s3Backend.readLead("a".repeat(64), { client }), /Access Denied/);
});

test("readLead: 不正な形式のlead_idは例外を投げる（S3を呼ぶ前に検証される）", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  await assert.rejects(() => s3Backend.readLead("../../etc/passwd", { client }));
  assert.equal(client.calls.length, 0, "不正なlead_idの場合はS3自体を呼ばないはず");
});

test("readLead: 壊れたJSON（malformed）はJSON.parseの例外がそのまま伝播する", async (t) => {
  withS3Config(t);
  const leadId = "c".repeat(64);
  const key = s3Backend.leadKey(leadId, "leads/");
  const client = createFakeS3Client({ objects: { [key]: "{not valid json" } });
  await assert.rejects(() => s3Backend.readLead(leadId, { client }));
});

// ---------------------------------------------------------------------------
// writeLead()
// ---------------------------------------------------------------------------

test("writeLead: 正しいBucket/Key/ContentType/暗号化設定でPutObjectCommandを送る", async (t) => {
  withS3Config(t, { bucket: "my-lead-bucket" });
  const lead = sampleLead();
  const client = createFakeS3Client();

  await s3Backend.writeLead(lead.lead_id, lead, { client });

  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.constructor.name, "PutObjectCommand");
  assert.equal(call.input.Bucket, "my-lead-bucket");
  assert.equal(call.input.Key, `leads/${lead.lead_id}.json`);
  assert.equal(call.input.ContentType, "application/json");
  assert.equal(call.input.ServerSideEncryption, "AES256", "SSE-S3による暗号化を必須にしているはず");
  assert.deepEqual(JSON.parse(call.input.Body), lead);
});

test("writeLead → readLead: 書き込んだ内容をそのまま読み戻せる（往復確認）", async (t) => {
  withS3Config(t);
  const lead = sampleLead({ email: "roundtrip-test@example.invalid" });
  const client = createFakeS3Client();

  await s3Backend.writeLead(lead.lead_id, lead, { client });
  const result = await s3Backend.readLead(lead.lead_id, { client });

  assert.deepEqual(result, lead);
});

// ---------------------------------------------------------------------------
// listLeads()
// ---------------------------------------------------------------------------

test("listLeads: prefix配下の全Leadを返す", async (t) => {
  withS3Config(t);
  const lead1 = sampleLead({ lead_id: "1".repeat(64), email: "list-1@example.invalid" });
  const lead2 = sampleLead({ lead_id: "2".repeat(64), email: "list-2@example.invalid" });
  const client = createFakeS3Client({
    objects: {
      "leads/1111111111111111111111111111111111111111111111111111111111111111.json": JSON.stringify(lead1),
      "leads/2222222222222222222222222222222222222222222222222222222222222222.json": JSON.stringify(lead2),
    },
  });

  const leads = await s3Backend.listLeads({ client });
  assert.equal(leads.length, 2);
  assert.ok(leads.some((l) => l.lead_id === lead1.lead_id));
  assert.ok(leads.some((l) => l.lead_id === lead2.lead_id));
});

test("listLeads: prefix外のオブジェクトは含まない", async (t) => {
  withS3Config(t);
  const lead1 = sampleLead({ lead_id: "3".repeat(64) });
  const client = createFakeS3Client({
    objects: {
      [`leads/${lead1.lead_id}.json`]: JSON.stringify(lead1),
      "other-prefix/not-a-lead.json": JSON.stringify({ irrelevant: true }),
    },
  });

  const leads = await s3Backend.listLeads({ client });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].lead_id, lead1.lead_id);
});

test("listLeads: .json以外のキーは無視する", async (t) => {
  withS3Config(t);
  const lead1 = sampleLead({ lead_id: "4".repeat(64) });
  const client = createFakeS3Client({
    objects: {
      [`leads/${lead1.lead_id}.json`]: JSON.stringify(lead1),
      "leads/README.txt": "not a lead",
    },
  });

  const leads = await s3Backend.listLeads({ client });
  assert.equal(leads.length, 1);
});

test("listLeads: ページネーション（ContinuationToken）を正しく辿る", async (t) => {
  withS3Config(t);
  const lead1 = sampleLead({ lead_id: "5".repeat(64) });
  const lead2 = sampleLead({ lead_id: "6".repeat(64) });
  const key1 = `leads/${lead1.lead_id}.json`;
  const key2 = `leads/${lead2.lead_id}.json`;

  let listCallCount = 0;
  const client = createFakeS3Client({
    objects: { [key1]: JSON.stringify(lead1), [key2]: JSON.stringify(lead2) },
    onSend: (command) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        listCallCount += 1;
        if (!command.input.ContinuationToken) {
          return { Contents: [{ Key: key1 }], IsTruncated: true, NextContinuationToken: "page2" };
        }
        assert.equal(command.input.ContinuationToken, "page2");
        return { Contents: [{ Key: key2 }], IsTruncated: false };
      }
    },
  });

  const leads = await s3Backend.listLeads({ client });
  assert.equal(listCallCount, 2, "ListObjectsV2Commandが2回（2ページ分）呼ばれるはず");
  assert.equal(leads.length, 2);
});

test("listLeads: 一覧取得後にオブジェクトが削除された場合（GetObjectが失敗）はそのエントリだけ安全側にスキップする", async (t) => {
  withS3Config(t);
  const lead1 = sampleLead({ lead_id: "7".repeat(64) });
  const key1 = `leads/${lead1.lead_id}.json`;
  const missingKey = "leads/deleted-mid-list.json";

  const client = createFakeS3Client({
    onSend: (command) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        return { Contents: [{ Key: key1 }, { Key: missingKey }], IsTruncated: false };
      }
      if (command.constructor.name === "GetObjectCommand" && command.input.Key === missingKey) {
        const err = new Error("The specified key does not exist.");
        err.name = "NoSuchKey";
        throw err;
      }
      if (command.constructor.name === "GetObjectCommand" && command.input.Key === key1) {
        return { Body: { transformToString: async () => JSON.stringify(lead1) } };
      }
    },
  });

  const leads = await s3Backend.listLeads({ client });
  assert.equal(leads.length, 1, "削除されたエントリはスキップされ、他方だけ返るはず");
  assert.equal(leads[0].lead_id, lead1.lead_id);
});

test("listLeads: オブジェクトが1件も無い場合は空配列を返す", async (t) => {
  withS3Config(t);
  const client = createFakeS3Client();
  const leads = await s3Backend.listLeads({ client });
  assert.deepEqual(leads, []);
});

// ---------------------------------------------------------------------------
// PII/secretがログへ出力されないことの確認
// ---------------------------------------------------------------------------

test("PII非漏洩確認: read/write/list一連の操作でconsole.log/console.errorが一切呼ばれない", async (t) => {
  withS3Config(t);
  const lead = sampleLead({ email: "pii-log-check@example.invalid" });
  const client = createFakeS3Client();

  const originalLog = console.log;
  const originalError = console.error;
  const calls = [];
  console.log = (...args) => calls.push(["log", args]);
  console.error = (...args) => calls.push(["error", args]);
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  await s3Backend.writeLead(lead.lead_id, lead, { client });
  await s3Backend.readLead(lead.lead_id, { client });
  await s3Backend.listLeads({ client });

  assert.equal(calls.length, 0, "s3-backend.jsはread/write/list中に一切ログ出力しないはず（PII構造的非出力）");
});
