/** 保存の約束（段階 0-2 の段 5。print-craft-authoring-mcp の実装案 5.3。pcraft_save_settings / pcraft_update_button の本体） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";
import { digestOf, saveNewSettings, updateButton } from "../src/commands/save.ts";
import { realResolve } from "../src/safe-path.ts";

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
const noTmp = (dir) => assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".tmp")), [], "一時ファイルを残さない");

test("saveNewSettings: normalize を通ったときだけ確定する。同じ名前があれば conflict、エラーがあれば invalid で書かない", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const r = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json" });
    assert.equal(r.status, "ok", r.message);
    assert.equal(r.path, "settings/見積書.json");
    const file = path.join(root, "settings", "見積書.json");
    assert.equal(r.digest, digestOf(readFileSync(file)), "digest は確定したファイルのもの");
    const out = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(out.usedFields && out.pluginInfos[0].id && out.pluginInfos[0].tagsInfo.fieldsInfo[2].formula, "派生値（usedFields、id、formula）を作って書いた（normalize の出力）");
    noTmp(path.join(root, "settings"));

    const again = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json" });
    assert.equal(again.status, "conflict");
    assert.equal(digestOf(readFileSync(file)), r.digest, "上書きしない");

    const bad = await saveNewSettings(ctx, { path: "settings/壊れた.json", content: JSON.stringify(aiSettings({ pluginID: "other" })), fields: "fields/3740.json" });
    assert.equal(bad.status, "invalid");
    assert.ok(bad.findings.some((f) => f.level === "error"));
    assert.ok(!existsSync(path.join(root, "settings", "壊れた.json")), "エラーがあれば書かない");
    noTmp(path.join(root, "settings"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveNewSettings: 作業フォルダーの外・書けない場所・ダウンロードの名前・本番のフォルダー・fields が無いときは denied", async () => {
  const root = makeWork({ environments: { prod: { baseUrl: "https://x.cybozu.com", role: "production" } } });
  const ctx = { root, engine, policy };
  const content = JSON.stringify(aiSettings());
  try {
    for (const p of ["../x.json", ".env", "policy/authoring-policy.json", "settings/rex0220-print-craft-app3740-20261005-125115.json"]) {
      const r = await saveNewSettings(ctx, { path: p, content, fields: "fields/3740.json" });
      assert.equal(r.status, "denied", p);
    }
    const prodDir = path.join(root, "kintone", "x.cybozu.com", "3740-見積書");
    mkdirSync(prodDir, { recursive: true });
    writeFileSync(path.join(prodDir, "fields.json"), JSON.stringify(FIELDS_FILE));
    const prod = await saveNewSettings(ctx, { path: "kintone/x.cybozu.com/3740-見積書/新しい帳票.json", content });
    assert.equal(prod.status, "denied");
    assert.match(prod.message, /本番/);
    const noFields = await saveNewSettings(ctx, { path: "settings/a.json", content });
    assert.equal(noFields.status, "denied");
    assert.match(noFields.message, /fields/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateButton: digest を照合してボタン 1 つを差し替える。無ければ末尾に足す。digest が違えば conflict、menu が違えば invalid", async () => {
  const root = makeWork();
  const ctx = { root, engine, policy };
  try {
    const saved = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json" });
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
