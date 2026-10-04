/** kintone REST の読み取り専用クライアント: GET 専用、許可パス固定、認証ヘッダー、エラーの文言に秘密を出さない。.env の読み方 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_APIS, NotAllowedError, RestError, apiPathOf, authHeaders, createRestClient } from "../src/kintone-rest.ts";
import { loadAuth, parseDotEnv, AuthError } from "../src/env.ts";

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
  fn.calls = calls;
  return fn;
};
const NO_FILE = "C:/nonexistent/.env";

test("許可した API だけパスになる。他は送信前に止まる", () => {
  assert.equal(apiPathOf("app/form/fields"), "/k/v1/app/form/fields.json");
  assert.equal(apiPathOf("record", 5), "/k/guest/5/v1/record.json");
  assert.throws(() => apiPathOf("records"), NotAllowedError);
  assert.throws(() => apiPathOf("record/comments"), NotAllowedError);
  assert.throws(() => apiPathOf("file"), NotAllowedError);
  assert.deepEqual([...ALLOWED_APIS], ["app", "app/form/fields", "app/form/layout", "record", "preview/app/form/fields", "preview/app/form/layout"]);
});

test("GET だけ送り、クエリと認証ヘッダーが付く（トークン優先）", async () => {
  const f = fakeFetch(200, { record: {} });
  const c = createRestClient({ baseUrl: "https://x.cybozu.com/", token: "tok" }, f);
  await c.get("record", { app: 3740, id: 1 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://x.cybozu.com/k/v1/record.json?app=3740&id=1");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.headers["X-Cybozu-API-Token"], "tok");
  assert.equal(f.calls[0].init.headers["X-Cybozu-Authorization"], undefined);
  assert.deepEqual(authHeaders({ baseUrl: "https://x.cybozu.com", username: "u", password: "p" }), { "X-Cybozu-Authorization": Buffer.from("u:p").toString("base64") });
});

test("許可外の API は fetch を呼ばずに止まる", async () => {
  const f = fakeFetch(200, {});
  const c = createRestClient({ baseUrl: "https://x.cybozu.com", token: "tok" }, f);
  await assert.rejects(() => c.get("file", { fileKey: "x" }), NotAllowedError);
  assert.equal(f.calls.length, 0);
});

test("エラーは HTTP の状態と kintone のコードだけを文言にする（トークンは出ない）", async () => {
  const f = fakeFetch(401, { code: "CB_AU01", id: "x", message: "ログインしてください。" });
  const c = createRestClient({ baseUrl: "https://x.cybozu.com", token: "SECRET-TOKEN" }, f);
  await assert.rejects(
    () => c.get("app", { id: 1 }),
    (e) => {
      assert.ok(e instanceof RestError);
      assert.equal(e.status, 401);
      assert.equal(e.code, "CB_AU01");
      assert.match(e.message, /HTTP 401 CB_AU01/);
      assert.ok(!e.message.includes("SECRET-TOKEN"));
      return true;
    }
  );
});

test(".env の読み方: kintone 公式 MCP と同じ KINTONE_*。OS の環境変数が優先、.env は足りない分、引用符を外す", () => {
  const parsed = parseDotEnv('# comment\nKINTONE_BASE_URL="https://a.cybozu.com"\nexport KINTONE_API_TOKEN=\'t1\'\n\nKINTONE_USERNAME=u\n');
  assert.deepEqual(parsed, { KINTONE_BASE_URL: "https://a.cybozu.com", KINTONE_API_TOKEN: "t1", KINTONE_USERNAME: "u" });
  const auth = loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://b.cybozu.com/", KINTONE_USERNAME: "u", KINTONE_PASSWORD: "p" } });
  assert.deepEqual(auth, { baseUrl: "https://b.cybozu.com", token: undefined, username: "u", password: "p" });
  const tokenAuth = loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://b.cybozu.com", KINTONE_API_TOKEN: "t", KINTONE_USERNAME: "u", KINTONE_PASSWORD: "p" } });
  assert.equal(tokenAuth.token, "t", "tools はトークンを使う（公式 MCP はユーザーを使うので、どちらか 1 つだけ書くのがよい）");
  assert.equal(tokenAuth.username, undefined);
  assert.throws(() => loadAuth({ envFile: NO_FILE, env: {} }), AuthError);
  assert.throws(() => loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "http://plain.example.com", KINTONE_API_TOKEN: "t" } }), AuthError);
  assert.throws(() => loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://b.cybozu.com", KINTONE_USERNAME: "u" } }), AuthError);
});

test(".env の読み方: dashboard の KSQL_* も読む。KINTONE_* があればそちら", () => {
  const ksql = loadAuth({ envFile: NO_FILE, env: { KSQL_BASE_URL: "https://k.cybozu.com", KSQL_TOKEN: "kt" } });
  assert.deepEqual(ksql, { baseUrl: "https://k.cybozu.com", token: "kt", username: undefined, password: undefined });
  const both = loadAuth({ envFile: NO_FILE, env: { KSQL_BASE_URL: "https://k.cybozu.com", KINTONE_BASE_URL: "https://n.cybozu.com", KSQL_TOKEN: "kt", KINTONE_API_TOKEN: "nt" } });
  assert.equal(both.baseUrl, "https://n.cybozu.com");
  assert.equal(both.token, "nt");
});
