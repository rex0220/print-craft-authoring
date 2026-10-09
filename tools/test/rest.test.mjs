/** kintone REST の読み取り専用クライアント: GET 専用、許可パス固定、認証ヘッダー、エラーの文言に秘密を出さない。.env の読み方 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_APIS, NotAllowedError, RestError, apiPathOf, authHeaders, createRestClient } from "../src/kintone-rest.ts";
import { loadAuth, parseDotEnv, AuthError, baseUrlFromEnv, describeAuth } from "../src/env.ts";
import { KintoneUrlError, normalizeKintoneBaseUrl } from "../src/kintone-url.ts";

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
};
const NO_FILE = "C:/nonexistent/.env";

test("許可した API だけパスになる。他は送信前に止まる", () => {
  assert.equal(apiPathOf("app/form/fields"), "/k/v1/app/form/fields.json");
  assert.equal(apiPathOf("record", 5), "/k/guest/5/v1/record.json");
  assert.equal(apiPathOf("records"), "/k/v1/records.json", "records は段階 0-2 の段 4 で足した（kintone_list_records。形だけ返す）");
  assert.throws(() => apiPathOf("apps"), NotAllowedError, "apps.json は API トークンで使えないので足さない");
  assert.throws(() => apiPathOf("record/comments"), NotAllowedError);
  assert.throws(() => apiPathOf("file"), NotAllowedError);
  assert.deepEqual([...ALLOWED_APIS], ["app", "app/form/fields", "app/form/layout", "record", "records", "preview/app/form/fields", "preview/app/form/layout", "app/plugin/config", "preview/app/plugin/config"]);
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

test("エラーは HTTP の状態と kintone のコードだけを文言にする（トークンもサーバーの message も出ない）", async () => {
  const f = fakeFetch(401, { code: "CB_AU01", id: "x", message: "ログインしてください。SECRET-VALUE" });
  const c = createRestClient({ baseUrl: "https://x.cybozu.com", token: "SECRET-TOKEN" }, f);
  await assert.rejects(
    () => c.get("app", { id: 1 }),
    (e) => {
      assert.ok(e instanceof RestError);
      assert.equal(e.status, 401);
      assert.equal(e.code, "CB_AU01");
      assert.match(e.message, /HTTP 401 CB_AU01/);
      assert.ok(!e.message.includes("SECRET-TOKEN"));
      assert.ok(!e.message.includes("SECRET-VALUE") && !e.message.includes("ログインして"), "サーバーの message は出さない");
      return true;
    }
  );
});

test("送信先は kintone のドメインだけ（ユーザー情報・別ホスト・パス付きは送らない）", async () => {
  const f = fakeFetch(200, {});
  for (const bad of ["https://tenant.cybozu.com@evil.example", "https://evil.example", "https://x.cybozu.com:8443", "https://x.cybozu.com/k/", "https://x.cybozu.com/?a=1", "http://x.cybozu.com", "https://cybozu.com", "https://x.cybozu.com.evil.example", "https://evil.example\\@x.cybozu.com"]) {
    assert.throws(() => createRestClient({ baseUrl: bad, token: "t" }, f), NotAllowedError, bad);
  }
  assert.equal(f.calls.length, 0, "fetch は一度も呼ばれない");
  for (const ok of ["https://x.cybozu.com", "https://X.Cybozu.com/", "https://x.s.cybozu.com", "https://x.kintone.com", "https://x.cybozu.cn"]) {
    const c = createRestClient({ baseUrl: ok, token: "t" }, f);
    assert.match(c.baseUrl, /^https:\/\/[a-z0-9.-]+$/, ok);
  }
  assert.equal(normalizeKintoneBaseUrl("https://X.Cybozu.com/"), "https://x.cybozu.com");
  assert.throws(() => normalizeKintoneBaseUrl("https://good.cybozu.com@evil.example"), KintoneUrlError);
  assert.equal(describeAuth({ baseUrl: "https://x.cybozu.com", username: "Alex", password: "p" }), "ログインユーザー", "ユーザー名は出さない");
  assert.equal(describeAuth({ baseUrl: "https://x.cybozu.com", token: "t" }), "API トークン");
});

test("loadAuth: KINTONE_BASE_URL も kintone のドメインでなければ止まる", () => {
  assert.throws(() => loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://tenant.cybozu.com@evil.example", KINTONE_API_TOKEN: "t" } }), /KINTONE_BASE_URL が不正/);
  assert.throws(() => loadAuth({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://evil.example", KINTONE_API_TOKEN: "t" } }), /kintone のドメインではない/);
  assert.equal(baseUrlFromEnv({ envFile: NO_FILE, env: {} }), undefined);
  assert.equal(baseUrlFromEnv({ envFile: NO_FILE, env: { KINTONE_BASE_URL: "https://a.cybozu.com/" } }), "https://a.cybozu.com");
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

test("pluginZipPath: .env の相対パスは .env のフォルダーから、OS の環境変数は絶対パスだけ（段階 0-2 の段 2）", async () => {
  const { pluginZipPath } = await import("../src/env.ts");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const { default: path } = await import("node:path");
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-env-"));
  try {
    writeFileSync(path.join(work, ".env"), 'PCRAFT_PLUGIN_ZIP="zips/print-craft.zip"\n');
    assert.equal(pluginZipPath({ cwd: work, env: {} }), path.resolve(work, "zips/print-craft.zip"), ".env の相対パスは .env のフォルダーから");
    const abs = path.resolve(work, "abs/print-craft.zip");
    assert.equal(pluginZipPath({ cwd: work, env: { PCRAFT_PLUGIN_ZIP: abs } }), abs, "OS の環境変数の絶対パスはそのまま（.env より優先）");
    assert.throws(() => pluginZipPath({ cwd: work, env: { PCRAFT_PLUGIN_ZIP: "rel/print-craft.zip" } }), (e) => e instanceof AuthError && /絶対パスで書く/.test(e.message), "OS の環境変数の相対パスは止める");
    assert.equal(pluginZipPath({ cwd: work, env: { PCRAFT_PLUGIN_ZIP: `"${abs}"` } }), abs, "OS の環境変数の外側の引用符は外す（Codex レビュー MINOR 9）");
    assert.equal(pluginZipPath({ cwd: work, env: { PCRAFT_PLUGIN_ZIP: ` '${abs}' ` } }), abs);
    rmSync(path.join(work, ".env"));
    assert.equal(pluginZipPath({ cwd: work, env: {} }), undefined, "どちらにも無ければ undefined");
    assert.equal(pluginZipPath({ cwd: work, env: { PCRAFT_PLUGIN_ZIP: '""' } }), undefined, "引用符だけは無いのと同じ");
    const quoted = loadAuth({ cwd: work, env: { KINTONE_BASE_URL: '"https://q.cybozu.com"', KINTONE_API_TOKEN: '"tok"' } });
    assert.equal(quoted.baseUrl, "https://q.cybozu.com", "OS の環境変数の URL は引用符を外す");
    assert.equal(quoted.token, '"tok"', "認証情報は引用符を外さない（Codex 再レビュー MINOR 6）");
    const pw = loadAuth({ cwd: work, env: { KINTONE_BASE_URL: "https://q.cybozu.com", KINTONE_USERNAME: "'u'", KINTONE_PASSWORD: '  "p w"  ' } });
    assert.deepEqual([pw.username, pw.password], ["'u'", '"p w"'], "ユーザー名・パスワードも前後の空白だけ");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("unquote: 前後の空白と対になった外側の引用符だけを外す。Windows のドライブ・UNC のパスも引用符を外せば絶対パス", async () => {
  const { unquote } = await import("../src/env.ts");
  const { default: path } = await import("node:path");
  assert.equal(unquote('  "/Users/a/print craft.zip"  '), "/Users/a/print craft.zip");
  assert.equal(unquote("'x'"), "x");
  assert.equal(unquote('" pass "'), " pass ", "引用符の中の空白は値のうち（パスワードを変えない）");
  assert.equal(unquote('"x\''), '"x\'', "対になっていなければ外さない");
  assert.equal(unquote('"'), '"');
  for (const p of ['"C:\\Users\\a\\print-craft.zip"', "'D:/zips/print-craft.zip'", '"\\\\server\\share\\print-craft.zip"']) {
    assert.ok(path.win32.isAbsolute(unquote(p)), p);
    assert.ok(!path.win32.isAbsolute(p), "引用符付きのままでは絶対パスにならない（だから外す）");
  }
});
