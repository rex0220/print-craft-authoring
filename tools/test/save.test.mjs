/** 保存の約束（段階 0-2 の段 5。print-craft-authoring-mcp の実装案 5.3。pcraft_save_settings / pcraft_update_button の本体） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";
import { MAX_SAVE_INPUT_BYTES, digestOf, saveNewSettings, updateButton } from "../src/commands/save.ts";
import { realResolve } from "../src/safe-path.ts";
import { CONN, makeConnWorkspace } from "./conn-helper.mjs";

const engine = await loadEngine();
const policy = { allowExternal: [] };

function makeWork(envs) {
  const root = realResolve(".", mkdtempSync(path.join(os.tmpdir(), "pcraft-save-")));
  mkdirSync(path.join(root, "settings"));
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
  if (envs) writeFileSync(path.join(root, "environments.json"), JSON.stringify(envs));
  return root;
}
/** normalize の前（setContext）で onSet を呼ぶエンジン。確かめてから確定までの間にファイルが変わる場合を作る */
const racing = (onSet) =>
  new Proxy(engine, {
    get(t, k) {
      if (k === "setContext") return (c) => (onSet(), t.setContext(c));
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    }
  });
const noTmp = (dir) => assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".tmp")), [], "一時ファイルを残さない");

test("saveNewSettings: normalize を通ったときだけ確定する。同じ名前があれば conflict、エラーがあれば invalid で書かない", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const r = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(r.status, "ok", r.message);
    assert.equal(r.path, "settings/見積書.json");
    const file = path.join(root, "settings", "見積書.json");
    assert.equal(r.digest, digestOf(readFileSync(file)), "digest は確定したファイルのもの");
    const out = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(out.usedFields && out.pluginInfos[0].id && out.pluginInfos[0].tagsInfo.fieldsInfo[2].formula, "派生値（usedFields、id、formula）を作って書いた（normalize の出力）");
    noTmp(path.join(root, "settings"));

    const again = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(again.status, "conflict");
    assert.equal(digestOf(readFileSync(file)), r.digest, "上書きしない");

    const bad = await saveNewSettings(ctx, { path: "settings/壊れた.json", content: JSON.stringify(aiSettings({ pluginID: "other" })), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(bad.status, "invalid");
    assert.ok(bad.findings.some((f) => f.level === "error"));
    assert.ok(!existsSync(path.join(root, "settings", "壊れた.json")), "エラーがあれば書かない");
    noTmp(path.join(root, "settings"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveNewSettings: 作業フォルダーの外・書けない場所・ダウンロードの名前・接続のファイルに無い profile・1 接続の形の kintone/ は denied、印の無いフォルダーは conflict、fields が無いのは invalid", async () => {
  const t = makeConnWorkspace();
  const root = t.root;
  mkdirSync(path.join(root, "settings"));
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
  const ctx = { root, engine, policy, mode: t.mode() };
  const content = JSON.stringify(aiSettings());
  try {
    for (const p of ["../x.json", ".env", "policy/authoring-policy.json", "settings/rex0220-print-craft-app3740-20261005-125115.json"]) {
      const r = await saveNewSettings(ctx, { path: p, content, fields: "fields/3740.json", expectedAbsent: true });
      assert.equal(r.status, "denied", p);
    }
    const unknown = path.join(root, "kintone", "stage", "3740-見積書");
    mkdirSync(unknown, { recursive: true });
    writeFileSync(path.join(unknown, "fields.json"), JSON.stringify(FIELDS_FILE));
    const r1 = await saveNewSettings(ctx, { path: "kintone/stage/3740-見積書/新しい帳票.json", content, expectedAbsent: true });
    assert.deepEqual([r1.status, r1.code], ["denied", "PermissionError"], r1.message);
    assert.match(r1.message, /profile「stage」は接続のファイル/);
    const bare = path.join(root, "kintone", "dev", "3740-見積書");
    mkdirSync(bare, { recursive: true });
    writeFileSync(path.join(bare, "fields.json"), JSON.stringify(FIELDS_FILE));
    const r2 = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/新しい帳票.json", content, expectedAbsent: true });
    assert.deepEqual([r2.status, r2.code], ["conflict", "app-marker-missing"], r2.message);
    const single = await saveNewSettings({ ...ctx, mode: { kind: "single" } }, { path: "kintone/dev/3740-見積書/新しい帳票.json", content, expectedAbsent: true });
    assert.equal(single.status, "denied", "1 接続の形では kintone/ の下を変えない");
    assert.ok(!existsSync(path.join(bare, "新しい帳票.json")));
    const noFields = await saveNewSettings(ctx, { path: "settings/a.json", content, expectedAbsent: true });
    assert.equal(noFields.status, "invalid", "fields が無いのは入力の誤り（0-3b で denied から変えた）");
    assert.equal(noFields.code, "InputError");
    assert.match(noFields.message, /fields/);
  } finally {
    t.cleanup();
  }
});

test("updateButton: digest を照合してボタン 1 つを差し替える。無ければ末尾に足す。digest が違えば conflict、menu が違えば invalid", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const saved = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(saved.status, "ok", saved.message);
    const row = { ...aiSettings().pluginInfos[0], desc: "見積書の PDF を作ります" };

    const stale = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: "0".repeat(64), replacement: JSON.stringify(row), fields: "fields/3740.json" });
    assert.equal(stale.status, "conflict");
    assert.match(stale.message, /digest が違う/);

    const mismatch = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: saved.digest, replacement: JSON.stringify({ ...row, menu: "別" }), fields: "fields/3740.json" });
    assert.equal(mismatch.status, "invalid");

    const r = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: saved.digest, replacement: JSON.stringify(row), fields: "fields/3740.json" });
    assert.equal(r.status, "ok", r.message);
    const after = JSON.parse(readFileSync(path.join(root, "settings", "見積書.json"), "utf8"));
    assert.equal(after.pluginInfos.length, 1);
    assert.equal(after.pluginInfos[0].desc, "見積書の PDF を作ります");
    assert.notEqual(r.digest, saved.digest);

    const added = await updateButton(ctx, { path: "settings/見積書.json", button: "請求書", expectedDigest: r.digest, replacement: JSON.stringify({ ...row, menu: "請求書" }), fields: "fields/3740.json" });
    assert.equal(added.status, "ok", added.message);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "settings", "見積書.json"), "utf8")).pluginInfos.map((b) => b.menu), ["見積書", "請求書"], "無ければ末尾に足す");
    noTmp(path.join(root, "settings"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateButton: ダウンロード / pull のファイルは書き換えない（denied）、無いファイルは conflict", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const snap = path.join(root, "settings", "rex0220-print-craft-app3740-20261005-125115.json");
    writeFileSync(snap, JSON.stringify(aiSettings()));
    const r = await updateButton(ctx, { path: "settings/rex0220-print-craft-app3740-20261005-125115.json", button: "見積書", expectedDigest: digestOf(readFileSync(snap)), replacement: JSON.stringify(aiSettings().pluginInfos[0]), fields: "fields/3740.json" });
    assert.equal(r.status, "denied");
    const none = await updateButton(ctx, { path: "settings/無い.json", button: "見積書", expectedDigest: "x", replacement: "{}", fields: "fields/3740.json" });
    assert.notEqual(none.status, "ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveNewSettings: expectedAbsent: true が無い・大きすぎる入力は invalid。updateButton も大きすぎる replacement は invalid", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const content = JSON.stringify(aiSettings());
    const noFlag = await saveNewSettings(ctx, { path: "settings/a.json", content, fields: "fields/3740.json" });
    assert.equal(noFlag.status, "invalid");
    assert.match(noFlag.message, /expectedAbsent/);
    const big = "x".repeat(MAX_SAVE_INPUT_BYTES - 10) + "あああああ"; // 文字数は上限より少ないが UTF-8 のバイト数で超える
    const tooBig = await saveNewSettings(ctx, { path: "settings/a.json", content: big, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(tooBig.status, "invalid");
    assert.match(tooBig.message, /バイトまで/);
    assert.ok(!existsSync(path.join(root, "settings", "a.json")));
    const saved = await saveNewSettings(ctx, { path: "settings/a.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(saved.status, "ok", saved.message);
    const r = await updateButton(ctx, { path: "settings/a.json", button: "見積書", expectedDigest: saved.digest, replacement: big, fields: "fields/3740.json" });
    assert.equal(r.status, "invalid");
    assert.match(r.message, /バイトまで/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("アプリのフォルダーの中は同じフォルダーの fields.json で検査する。別の fields を渡すと denied（Codex レビュー MAJOR 4）。フォルダーが無ければ作らない", async () => {
  const t = makeConnWorkspace();
  const root = t.root;
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
  const ctx = { root, engine, policy, mode: t.mode() };
  const content = JSON.stringify(aiSettings());
  try {
    const none = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/a.json", content, expectedAbsent: true });
    assert.equal(none.status, "denied", none.message);
    assert.match(none.message, /アプリのフォルダーが無い.*先に fields か pull/);
    assert.ok(!existsSync(path.join(root, "kintone")), "アプリのフォルダーを保存では作らない（先に fields か pull）");
    const dir = t.appFolder("dev", 3740, "見積書");
    const other = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/a.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(other.status, "invalid", "アプリのフォルダーに fields.json がまだ無い（入力の誤り）");
    assert.match(other.message, /fields\.json が無い/);
    writeFileSync(path.join(dir, "fields.json"), JSON.stringify(FIELDS_FILE));
    const stillOther = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/a.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(stillOther.status, "denied");
    assert.match(stillOther.message, /同じフォルダーの fields\.json/);
    assert.ok(!existsSync(path.join(dir, "a.json")));
    const own = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/a.json", content, expectedAbsent: true });
    assert.equal(own.status, "ok", own.message);
    const same = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/b.json", content, fields: "kintone/dev/3740-見積書/fields.json", expectedAbsent: true });
    assert.equal(same.status, "ok", same.message);
    const upd = await updateButton(ctx, { path: "kintone/dev/3740-見積書/a.json", button: "見積書", expectedDigest: own.digest, replacement: JSON.stringify(aiSettings().pluginInfos[0]), fields: "fields/3740.json" });
    assert.equal(upd.status, "denied");
    const marker = await saveNewSettings(ctx, { path: "kintone/dev/3740-見積書/.pcraft-app.json", content, expectedAbsent: true });
    assert.notEqual(marker.status, "ok", "印は書く先にできない");
    noTmp(dir);
  } finally {
    t.cleanup();
  }
});

test("確かめてから確定までの間に作られた・変えられたファイルは上書きしない（conflict。Codex レビュー MAJOR 5）", async () => {
  const root = makeWork();
  const content = JSON.stringify(aiSettings());
  const file = path.join(root, "settings", "見積書.json");
  try {
    const created = await saveNewSettings({ root, engine: racing(() => writeFileSync(file, "人が書いた")), policy }, { path: "settings/見積書.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(created.status, "conflict");
    assert.equal(readFileSync(file, "utf8"), "人が書いた", "後から作られたファイルを上書きしない");
    rmSync(file);

    const saved = await saveNewSettings({ root, engine, policy }, { path: "settings/見積書.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(saved.status, "ok", saved.message);
    const row = JSON.stringify({ ...aiSettings().pluginInfos[0], desc: "変えた" });
    const changed = await updateButton({ root, engine: racing(() => writeFileSync(file, "人が直した")), policy }, { path: "settings/見積書.json", button: "見積書", expectedDigest: saved.digest, replacement: row, fields: "fields/3740.json" });
    assert.equal(changed.status, "conflict");
    assert.equal(readFileSync(file, "utf8"), "人が直した");
    noTmp(path.join(root, "settings"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("同じファイルへの保存はロックで重ねない。60 秒より古いロックは外して進む。終わればロックを消す", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  const lockFile = path.join(root, "settings", ".見積書.json.pcraft-lock");
  try {
    const saved = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(saved.status, "ok", saved.message);
    assert.ok(!existsSync(lockFile), "ロックを残さない");
    const row = JSON.stringify({ ...aiSettings().pluginInfos[0], desc: "変えた" });
    writeFileSync(lockFile, "1");
    const busy = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: saved.digest, replacement: row, fields: "fields/3740.json" });
    assert.equal(busy.status, "conflict");
    assert.match(busy.message, /進行中/);
    assert.equal(digestOf(readFileSync(path.join(root, "settings", "見積書.json"))), saved.digest);
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockFile, old, old);
    const r = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: saved.digest, replacement: row, fields: "fields/3740.json" });
    assert.equal(r.status, "ok", r.message);
    assert.ok(!existsSync(lockFile));
    noTmp(path.join(root, "settings"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("確かめてから確定までの間に、書く先のフォルダーが symlink に差し替えられたら確定しない（denied）", async () => {
  const root = makeWork();
  mkdirSync(path.join(root, "temp"));
  const content = JSON.stringify(aiSettings());
  try {
    const swap = () => {
      renameSync(path.join(root, "settings"), path.join(root, "settings-old"));
      symlinkSync(path.join(root, "temp"), path.join(root, "settings"));
    };
    const r = await saveNewSettings({ root, engine: racing(swap), policy }, { path: "settings/見積書.json", content, fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(r.status, "denied", r.message);
    assert.match(r.message, /途中で変わった/);
    assert.deepEqual(readdirSync(path.join(root, "temp")), [], "差し替えた先に何も書かない（一時ファイルも残さない）");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const NO_CHMOD = process.platform === "win32" || process.getuid?.() === 0;

test("normalize の間に接続が変わったフォルダーには、一時ファイルもロックも作らない（conflict の connection-changed。Codex 再々レビュー MAJOR 1）", { skip: NO_CHMOD }, async () => {
  const t = makeConnWorkspace();
  const root = t.root;
  const dir = t.appFolder("dev", 3740, "見積書", FIELDS_FILE);
  const rotate = () => {
    t.writeConn({ ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, tokenMap: { ...CONN.profiles.dev.tokenMap, APP3740: "rotated-token" } } } });
    chmodSync(dir, 0o555); // 先に一時ファイルかロックを作ろうとすれば、接続の変化でなく書き込みの失敗になる
  };
  try {
    const content = JSON.stringify(aiSettings());
    const saved = await saveNewSettings({ root, engine, policy, mode: t.mode() }, { path: "kintone/dev/3740-見積書/a.json", content, expectedAbsent: true });
    assert.equal(saved.status, "ok", saved.message);
    const r = await saveNewSettings({ root, engine: racing(rotate), policy, mode: t.mode() }, { path: "kintone/dev/3740-見積書/b.json", content, expectedAbsent: true });
    assert.deepEqual([r.status, r.code], ["conflict", "connection-changed"], r.message);
    chmodSync(dir, 0o755);
    t.writeConn(CONN);
    const u = await updateButton({ root, engine: racing(rotate), policy, mode: t.mode() }, { path: "kintone/dev/3740-見積書/a.json", button: "見積書", expectedDigest: saved.digest, replacement: JSON.stringify({ ...aiSettings().pluginInfos[0], desc: "変えた" }) });
    assert.deepEqual([u.status, u.code], ["conflict", "connection-changed"], u.message);
    chmodSync(dir, 0o755);
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith(".") && n !== ".pcraft-app.json"), [], "一時ファイルもロックも無い");
    assert.equal(digestOf(readFileSync(path.join(dir, "a.json"))), saved.digest);
  } finally {
    chmodSync(dir, 0o755);
    t.cleanup();
  }
});

test("確定の後に一時ファイル・ロックを消せなくても ok（確定している）。cleanup と message で伝える（Codex 再レビュー MAJOR 4）", { skip: NO_CHMOD }, async () => {
  const root = makeWork();
  const dir = path.join(root, "settings");
  try {
    const r = await saveNewSettings({ root, engine, policy, afterPlace: () => chmodSync(dir, 0o555) }, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    chmodSync(dir, 0o755);
    assert.equal(r.status, "ok");
    assert.equal(r.digest, digestOf(readFileSync(path.join(dir, "見積書.json"))), "確定したファイル");
    assert.equal(r.cleanup.length, 2, "ロックと一時ファイルの両方を試した（1 つの失敗で残りを飛ばさない）");
    assert.match(r.message, /確定したが、一時ファイルかロックを消せなかった/);
  } finally {
    chmodSync(dir, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("書く先のフォルダーが無ければ作る（settings/ がまだ無い作業フォルダー。0-3b の試作で見つけた）", async () => {
  const root = makeWork();
  rmSync(path.join(root, "settings"), { recursive: true });
  try {
    const r = await saveNewSettings({ root, engine, policy }, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(r.status, "ok", r.message);
    assert.equal(r.digest, digestOf(readFileSync(path.join(root, "settings", "見積書.json"))));
    const t = await saveNewSettings({ root, engine, policy }, { path: "temp/新しい/a.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(t.status, "ok", "temp/ の下の新しいフォルダーも");
    const outside = await saveNewSettings({ root, engine, policy }, { path: "docs/a.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(outside.status, "denied", "書けない場所にはフォルダーも作らない");
    assert.ok(!existsSync(path.join(root, "docs")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("状態の分け方: 項目定義のファイルが無いは invalid、想定外の失敗（書き込みの失敗）は failed（denied にしない）。code に誤りの種類", async () => {
  const root = makeWork();
  try {
    const missing = await saveNewSettings({ root, engine, policy }, { path: "settings/a.json", content: JSON.stringify(aiSettings()), fields: "fields/9999.json", expectedAbsent: true });
    assert.deepEqual([missing.status, missing.code], ["invalid", "InputError"]);
    assert.match(missing.message, /項目定義のファイルが無い/);
    const outside = await saveNewSettings({ root, engine, policy }, { path: "../a.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.deepEqual([outside.status, outside.code], ["denied", "PathError"]);
    const snap = await saveNewSettings({ root, engine, policy }, { path: "settings/rex0220-print-craft-app3740-20261005-125115.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.deepEqual([snap.status, snap.code], ["denied", "PermissionError"]);
    if (!NO_CHMOD) {
      chmodSync(path.join(root, "settings"), 0o555);
      try {
        const io = await saveNewSettings({ root, engine, policy }, { path: "settings/b.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
        assert.equal(io.status, "failed", io.message);
        assert.equal(io.code, "Error");
      } finally {
        chmodSync(path.join(root, "settings"), 0o755);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
