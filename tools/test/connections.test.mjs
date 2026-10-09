/**
 * kintone の接続のファイル（kSQL の ksql.config.json と同じ形。print-craft-authoring-mcp の実装案 15 章）: 読むキー、profile の選び方（引数 → defaultProfile → dev）、
 * 認証（auto / token / userpass、tokenMap のキー、env:、passwordEnv）、置き場所（作業フォルダーの外、普通のファイル、大きさ）、秘密の値を出さないこと
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConnectionError, assertSameConnection, authFor, identityOf, loadConnections, pickProfile, sameIdentity, semanticDigest, snapshotOf } from "../src/connections.ts";

const SECRET = "SECRET-token-value-0123456789";
const PASSWORD = "SECRET-password-value";

function setup() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-conn-")));
  const ws = path.join(dir, "ws");
  mkdirSync(ws);
  const write = (name, data, mode = 0o600) => {
    const file = path.join(dir, name);
    writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
    chmodSync(file, mode);
    return file;
  };
  return { dir, ws, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const code = (c) => (e) => e instanceof ConnectionError && e.code === c && !e.message.includes(SECRET) && !e.message.includes(PASSWORD);

test("kSQL の README・手順書の例をそのまま読む（知らないキーは通す）。profile の選び方は引数 → defaultProfile → dev", () => {
  const t = setup();
  try {
    // kSQL の README の例（logicalApps・allowPhysicalAppRefs）と、Desktop の手順書の例（version・query・mcp）
    const file = t.write("ksql.config.json", {
      version: 1,
      defaultProfile: "prod",
      profiles: {
        dev: { baseUrl: "https://dev.example.cybozu.com", logicalApps: { ORDERS: 100 }, tokenMap: { APP100: "env:DEV_ORDERS_TOKEN" } },
        prod: { baseUrl: "https://prod.example.cybozu.com", allowPhysicalAppRefs: false, auth: "token", logicalApps: { ORDERS: 1200 }, tokenMap: { APP1200: "env:PROD_ORDERS_TOKEN" }, query: { maxRecords: 500, onLimit: "error", timeout: 30000 } }
      },
      mcp: { savedQueries: { path: ".ksql/queries.json" } }
    });
    const set = loadConnections(file, { workspaceRoots: [t.ws], env: { DEV_ORDERS_TOKEN: SECRET } });
    assert.deepEqual([...set.profiles.keys()], ["dev", "prod"]);
    assert.deepEqual(set.invalid, []);
    assert.equal(set.fileName, "ksql.config.json");
    assert.equal(pickProfile(set).profile, "prod", "defaultProfile");
    assert.equal(pickProfile(set, "dev").profile, "dev", "引数");
    assert.throws(() => pickProfile(set, "stage"), code("unknown-profile"));
    const dev = pickProfile(set, "dev");
    assert.deepEqual(dev.tokenApps, [100]);
    assert.deepEqual(dev.tokenReady, { 100: true });
    assert.deepEqual(pickProfile(set, "prod").tokenReady, { 1200: false }, "env: の変数が無い（名前は持たない）");
    assert.deepEqual(authFor(set, dev, 100), { baseUrl: "https://dev.example.cybozu.com", token: SECRET });
    assert.throws(() => authFor(set, pickProfile(set, "prod"), 1200), code("env-missing"));
    assert.ok(!JSON.stringify(set).includes(SECRET) && !JSON.stringify(set).includes("DEV_ORDERS_TOKEN"), "読んだ結果に秘密の値も環境変数の名前も入らない");

    const noDefault = loadConnections(t.write("b.json", { profiles: { dev: { baseUrl: "https://a.cybozu.com" }, x: { baseUrl: "https://b.cybozu.com" } } }), { workspaceRoots: [], env: {} });
    assert.equal(pickProfile(noDefault).profile, "dev", "defaultProfile が無ければ kSQL と同じく dev");
    const onlyProd = loadConnections(t.write("c.json", { profiles: { prod: { baseUrl: "https://a.cybozu.com" } } }), { workspaceRoots: [], env: {} });
    assert.throws(() => pickProfile(onlyProd), code("no-default-profile"), "profile が 1 つでも dev でなければ選ばない（kSQL と同じ）");
    const missingDefault = loadConnections(t.write("d.json", { defaultProfile: "nope", profiles: { dev: { baseUrl: "https://a.cybozu.com" } } }), { workspaceRoots: [], env: {} });
    assert.throws(() => pickProfile(missingDefault), code("profile-invalid"), "defaultProfile が無い profile を指す");
  } finally {
    t.cleanup();
  }
});

test("認証: auto はログイン名とパスワードがそろえば userpass、ほかは token。passwordEnv が先で、空白だけなら password。kSQL の環境変数の上書きは読まない", () => {
  const t = setup();
  try {
    const file = t.write("a.json", {
      profiles: {
        both: { baseUrl: "https://a.cybozu.com", username: "u", password: PASSWORD },
        user: { baseUrl: "https://a.cybozu.com", username: "u", tokenMap: { 1: SECRET } },
        pass: { baseUrl: "https://a.cybozu.com", password: PASSWORD },
        envpw: { baseUrl: "https://a.cybozu.com", username: "u", passwordEnv: "PCRAFT_PW", password: "inline" },
        blankenv: { baseUrl: "https://a.cybozu.com", username: "u", passwordEnv: "PCRAFT_BLANK", password: "inline" },
        up: { baseUrl: "https://a.cybozu.com", auth: "userpass", username: "u" },
        none: { baseUrl: "https://a.cybozu.com" }
      }
    });
    const env = { PCRAFT_PW: PASSWORD, PCRAFT_BLANK: "   ", KSQL_TOKEN: "ksql-token", KSQL_PASSWORD: "ksql-pw", KSQL_USERNAME: "ksql-user", KSQL_BASE_URL: "https://evil.cybozu.com" };
    const set = loadConnections(file, { workspaceRoots: [], env });
    const p = (n) => pickProfile(set, n);
    assert.deepEqual([p("both").auth, p("user").auth, p("pass").auth, p("envpw").auth, p("up").auth, p("none").auth], ["userpass", "token", "token", "userpass", "userpass", "token"]);
    assert.deepEqual(authFor(set, p("both"), 5), { baseUrl: "https://a.cybozu.com", username: "u", password: PASSWORD });
    assert.equal(authFor(set, p("envpw"), 5).password, PASSWORD, "passwordEnv の値が先");
    assert.equal(authFor(set, p("blankenv"), 5).password, "inline", "passwordEnv の値が空白だけなら password");
    assert.deepEqual(authFor(set, p("user"), 1), { baseUrl: "https://a.cybozu.com", token: SECRET });
    assert.throws(() => authFor(set, p("up"), 5), code("no-userpass"));
    assert.throws(() => authFor(set, p("none"), 5), code("no-token"), "KSQL_TOKEN を使わない");
    assert.equal(p("none").baseUrl, "https://a.cybozu.com", "KSQL_BASE_URL を使わない");
  } finally {
    t.cleanup();
  }
});

test("tokenMap: APP1 / app1 / 1 は同じ。APP001・そろえた後の重複・文字列でない値・空・env: の名前の誤りは、その profile だけ使えない。使わないアプリの env: が無くても止まらない", () => {
  const t = setup();
  try {
    const file = t.write("a.json", {
      profiles: {
        ok: { baseUrl: "https://a.cybozu.com", tokenMap: { APP1: "env:T1", app2: SECRET, 3: "env:MISSING" } },
        zero: { baseUrl: "https://a.cybozu.com", tokenMap: { APP001: SECRET } },
        dup: { baseUrl: "https://a.cybozu.com", tokenMap: { APP1: SECRET, 1: SECRET } },
        num: { baseUrl: "https://a.cybozu.com", tokenMap: { APP1: 123 } },
        empty: { baseUrl: "https://a.cybozu.com", tokenMap: { APP1: "  " } },
        envname: { baseUrl: "https://a.cybozu.com", tokenMap: { APP1: "env:1BAD-NAME" } },
        word: { baseUrl: "https://a.cybozu.com", tokenMap: { ORDERS: SECRET } }
      }
    });
    const set = loadConnections(file, { workspaceRoots: [], env: { T1: SECRET } });
    assert.deepEqual([...set.profiles.keys()], ["ok"]);
    assert.deepEqual(set.invalid.map((x) => x.name).sort(), ["dup", "empty", "envname", "num", "word", "zero"]);
    assert.match(set.invalid.find((x) => x.name === "zero").reason, /先頭に 0 を付けない/);
    assert.ok(!JSON.stringify(set.invalid).includes(SECRET), "理由に値を入れない");
    const ok = pickProfile(set, "ok");
    assert.deepEqual(ok.tokenApps, [1, 2, 3]);
    assert.equal(authFor(set, ok, 1).token, SECRET);
    assert.equal(authFor(set, ok, 2).token, SECRET);
    assert.throws(() => authFor(set, ok, 3), code("env-missing"));
    assert.throws(() => pickProfile(set, "zero"), code("profile-invalid"));
  } finally {
    t.cleanup();
  }
});

test("profile の名前とドメイン: 英数字と - _ の 40 文字まで、大文字小文字だけ違うものは両方使えない。kintone のドメインだけ（*.s.cybozu.com も）。ゲストスペースは profile の値", () => {
  const t = setup();
  try {
    const file = t.write("a.json", {
      profiles: {
        "a.b": { baseUrl: "https://a.cybozu.com" },
        ["x".repeat(41)]: { baseUrl: "https://a.cybozu.com" },
        Dev: { baseUrl: "https://a.cybozu.com" },
        dev: { baseUrl: "https://a.cybozu.com" },
        sec: { baseUrl: "https://a.s.cybozu.com" },
        k: { baseUrl: "https://a.kintone.com/" },
        cn: { baseUrl: "https://a.cybozu.cn" },
        g: { baseUrl: "https://a.cybozu.com", guestSpaceId: 15 },
        badg: { baseUrl: "https://a.cybozu.com", guestSpaceId: "15" },
        evil: { baseUrl: "https://a.cybozu.com.evil.example" },
        port: { baseUrl: "https://a.cybozu.com:8443" },
        pathy: { baseUrl: "https://a.cybozu.com/k/1/" },
        user: { baseUrl: "https://u:p@a.cybozu.com" },
        http: { baseUrl: "http://a.cybozu.com" },
        auth: { baseUrl: "https://a.cybozu.com", auth: "oauth" }
      }
    });
    const set = loadConnections(file, { workspaceRoots: [], env: {} });
    assert.deepEqual([...set.profiles.keys()].sort(), ["cn", "g", "k", "sec"]);
    assert.deepEqual(set.invalid.map((x) => x.name).sort(), ["Dev", "a.b", "auth", "badg", "dev", "evil", "http", "pathy", "port", "user", "x".repeat(40)].sort());
    assert.equal(pickProfile(set, "g").guestSpaceId, 15);
    assert.equal(pickProfile(set, "k").baseUrl, "https://a.kintone.com");
    assert.deepEqual(identityOf(pickProfile(set, "g")), { profile: "g", baseUrl: "https://a.cybozu.com", host: "a.cybozu.com", guestSpaceId: 15 });
    assert.ok(sameIdentity(identityOf(pickProfile(set, "g")), { profile: "g", baseUrl: "https://a.cybozu.com", host: "a.cybozu.com", guestSpaceId: 15 }));
    assert.ok(!sameIdentity(identityOf(pickProfile(set, "g")), { profile: "g", baseUrl: "https://a.cybozu.com", host: "a.cybozu.com", guestSpaceId: 16 }), "ゲストスペースが違えば別");
    for (const proto of ["__proto__", "constructor", "toString"]) assert.throws(() => pickProfile(set, proto), (e) => e instanceof ConnectionError, proto);
  } finally {
    t.cleanup();
  }
});

test("置き場所: 未設定、相対パス、無い、フォルダー、大きすぎる、壊れた JSON は読まない。作業フォルダーの中（実際のパスでも、作業フォルダーの中の symlink でも）は使わない。文に絶対パスと JSON の断片を出さない", (t2) => {
  const t = setup();
  try {
    const opt = { workspaceRoots: [t.ws], env: {} };
    assert.throws(() => loadConnections(undefined, opt), code("not-configured"));
    assert.throws(() => loadConnections("rel/a.json", opt), code("unreadable"));
    assert.throws(() => loadConnections(path.join(t.dir, "無い.json"), opt), (e) => code("unreadable")(e) && !e.message.includes(t.dir));
    mkdirSync(path.join(t.dir, "folder.json"));
    assert.throws(() => loadConnections(path.join(t.dir, "folder.json"), opt), code("unreadable"));
    const big = t.write("big.json", JSON.stringify({ pad: "x".repeat(300 * 1024) }));
    assert.throws(() => loadConnections(big, opt), code("unreadable"));
    const broken = t.write("broken.json", `{"profiles": {"dev": {"baseUrl": "https://a.cybozu.com", "tokenMap": {"APP1": ${SECRET}}}}}`);
    assert.throws(() => loadConnections(broken, opt), (e) => code("unreadable")(e) && /JSON として読めない/.test(e.message) && !e.message.includes(t.dir));
    const notObj = t.write("arr.json", "[]");
    assert.throws(() => loadConnections(notObj, opt), code("unreadable"));
    const inside = path.join(t.ws, "ksql.config.json");
    writeFileSync(inside, JSON.stringify({ profiles: {} }));
    assert.throws(() => loadConnections(inside, opt), code("inside-workspace"));
    const outside = t.write("outside.json", { profiles: { dev: { baseUrl: "https://a.cybozu.com" } } });
    try {
      symlinkSync(outside, path.join(t.ws, "link.json"));
      symlinkSync(t.ws, path.join(t.dir, "ws-link"));
    } catch (e) {
      t2.skip(`symlink を作れない: ${e.message}`);
      return;
    }
    assert.throws(() => loadConnections(path.join(t.ws, "link.json"), opt), code("inside-workspace"), "作業フォルダーの中の symlink が外を指す");
    assert.throws(() => loadConnections(path.join(t.dir, "ws-link", "ksql.config.json"), opt), code("inside-workspace"), "親のフォルダーが作業フォルダーへの symlink");
    assert.equal(loadConnections(outside, opt).profiles.size, 1, "作業フォルダーの外は読む");
  } finally {
    t.cleanup();
  }
});

test("秘密の値を直接書いたファイルがほかの利用者に読めるときは警告（env: だけなら警告しない）", { skip: process.platform === "win32" }, () => {
  const t = setup();
  try {
    const inline = { profiles: { dev: { baseUrl: "https://a.cybozu.com", tokenMap: { 1: SECRET } } } };
    assert.match(loadConnections(t.write("open.json", inline, 0o644), { workspaceRoots: [], env: {} }).warnings.join(), /ほかの利用者も読める。chmod 600/);
    assert.deepEqual(loadConnections(t.write("closed.json", inline, 0o600), { workspaceRoots: [], env: {} }).warnings, []);
    assert.deepEqual(loadConnections(t.write("env.json", { profiles: { dev: { baseUrl: "https://a.cybozu.com", tokenMap: { 1: "env:T" } } } }, 0o644), { workspaceRoots: [], env: {} }).warnings, []);
  } finally {
    t.cleanup();
  }
});

test("スナップショットと意味の digest（15.6）: 接続先・ゲストスペース・認証・参照の形が変われば違い、ほかの profile や直接書いたトークンの値だけの入れ替えでは同じ。確定の前の確かめ", () => {
  const t = setup();
  try {
    const base = { defaultProfile: "dev", profiles: { dev: { baseUrl: "https://a.cybozu.com", tokenMap: { 1: "env:T1", 2: SECRET } }, other: { baseUrl: "https://b.cybozu.com" } } };
    const file = t.write("a.json", base);
    const opt = { workspaceRoots: [], env: { T1: SECRET } };
    const set = loadConnections(file, opt);
    const dev = pickProfile(set);
    assert.deepEqual(snapshotOf(set, dev), { profile: "dev", baseUrl: "https://a.cybozu.com", host: "a.cybozu.com", guestSpaceId: null, auth: "token", fileName: "a.json" });
    assert.ok(!JSON.stringify(snapshotOf(set, dev)).includes(SECRET));
    const digestWith = (data, appId) => {
      const f = t.write("b.json", data);
      const s2 = loadConnections(f, opt);
      return semanticDigest(s2, pickProfile(s2, "dev"), appId);
    };
    const d1 = semanticDigest(set, dev, 1);
    assert.equal(digestWith({ ...base, profiles: { ...base.profiles, other: { baseUrl: "https://c.cybozu.com" } } }, 1), d1, "ほかの profile だけの書き換え");
    assert.equal(digestWith({ ...base, profiles: { ...base.profiles, dev: { ...base.profiles.dev, tokenMap: { 1: "env:T1", 2: "other-inline" } } } }, 2), semanticDigest(set, dev, 2), "直接書いた値だけの入れ替え（参照の形は同じ）");
    assert.notEqual(digestWith({ ...base, profiles: { ...base.profiles, dev: { ...base.profiles.dev, baseUrl: "https://x.cybozu.com" } } }, 1), d1, "接続先");
    assert.notEqual(digestWith({ ...base, profiles: { ...base.profiles, dev: { ...base.profiles.dev, guestSpaceId: 3 } } }, 1), d1, "ゲストスペース");
    assert.notEqual(digestWith({ ...base, profiles: { ...base.profiles, dev: { ...base.profiles.dev, tokenMap: { 1: "env:T9", 2: SECRET } } } }, 1), d1, "参照の環境変数");
    assert.notEqual(semanticDigest(set, dev, 2), d1, "アプリ");
    // 確定の前の確かめ
    assert.doesNotThrow(() => assertSameConnection({ set, def: dev }, () => loadConnections(file, opt), 1));
    t.write("a.json", { ...base, profiles: { ...base.profiles, dev: { ...base.profiles.dev, baseUrl: "https://x.cybozu.com" } } });
    assert.throws(() => assertSameConnection({ set, def: dev }, () => loadConnections(file, opt), 1), code("connection-changed"));
    t.write("a.json", { profiles: { other: base.profiles.other } });
    assert.throws(() => assertSameConnection({ set, def: dev }, () => loadConnections(file, opt), 1), code("connection-changed"), "profile が無くなった");
    t.write("a.json", "{ broken");
    assert.throws(() => assertSameConnection({ set, def: dev }, () => loadConnections(file, opt), 1), code("unreadable"), "読めなければ前の値に戻らない");
    assert.throws(() => loadConnections(t.write("c.json", { defaultProfile: 1, profiles: {} }), opt), code("unreadable"), "defaultProfile が文字列でない");
  } finally {
    t.cleanup();
  }
});
