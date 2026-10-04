/**
 * 合成 zip（スタブ）で engine.ts の版の照合を試す: tools の版の先頭と印刷屋の版、API の pluginVersion と manifest の版、API の契約（キーと型）。
 * loadEngine は 1 プロセスに 1 回しか読み込まないので、止まる場合だけをこのファイルで試す（成功する読み込みは engine.test.mjs）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePluginZip, stubInnerEntries } from "./zip-helper.mjs";
import { PluginZipError } from "../src/plugin-zip.ts";
import { loadEngine, resolvePluginSources } from "../src/engine.ts";
import { devPluginDir } from "../src/paths.ts";

// OS の環境変数（開発者の PC に入っていることがある）に左右されないようにする
delete process.env.PCRAFT_PLUGIN_ZIP;
delete process.env.PCRAFT_ALLOW_DEV_PLUGIN;
delete process.env.PCRAFT_ALLOW_UNKNOWN_PLUGIN;

const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-contract-"));

test("zip の指定が無いとき: 公開ビルド（mode build）は隣の print-craft があっても読まない。ソース実行（dev）も PCRAFT_ALLOW_DEV_PLUGIN=1 が無ければ読まない", () => {
  assert.throws(() => resolvePluginSources({}, "build"), (e) => e instanceof PluginZipError && /zip の場所が分からない/.test(e.message) && !/PCRAFT_ALLOW_DEV_PLUGIN/.test(e.message));
  assert.throws(() => resolvePluginSources({}, "dev"), (e) => e instanceof PluginZipError && /PCRAFT_ALLOW_DEV_PLUGIN=1/.test(e.message));
  process.env.PCRAFT_ALLOW_DEV_PLUGIN = "1";
  try {
    assert.throws(() => resolvePluginSources({}, "build"), /zip の場所が分からない/, "build では環境変数でも解除できない");
    if (devPluginDir()) {
      const s = resolvePluginSources({}, "dev");
      assert.equal(s.kind, "dev");
      assert.equal(s.pluginVersion, "6");
    }
  } finally {
    delete process.env.PCRAFT_ALLOW_DEV_PLUGIN;
  }
});
const zipFile = (name, inner) => {
  const p = path.join(dir, name);
  writeFileSync(p, makePluginZip(inner));
  return p;
};

test("対応しない版の zip は止まる（コードを実行しない）", async () => {
  const p = zipFile("v5.zip", stubInnerEntries({ "manifest.json": JSON.stringify({ version: 5 }) }));
  await assert.rejects(() => loadEngine({ pluginZip: p, allowUnknown: true }), (e) => e instanceof PluginZipError && /版 5/.test(e.message));
});

test("authoring API が無い zip は止まる", async () => {
  const inner = stubInnerEntries();
  delete inner["config_js/print-craft-authoring-api.js"];
  const p = zipFile("noapi.zip", inner);
  await assert.rejects(() => loadEngine({ pluginZip: p, allowUnknown: true }), /print-craft-authoring-api\.js が無い/);
});

test("スタブの zip は既知でないので既定では止まる。allowUnknown でも API の契約（キーと型）が合わなければ止まる", async () => {
  const p = zipFile("stub.zip", stubInnerEntries());
  await assert.rejects(() => loadEngine({ pluginZip: p }), /既知のリリースと違う/);
  await assert.rejects(() => loadEngine({ pluginZip: p, allowUnknown: true }), (e) => e instanceof PluginZipError && /tools が使うものが無い、または型が違う/.test(e.message) && /buildMenuRows/.test(e.message));
});

test("API の pluginVersion が manifest の版と違う zip は止まる", async () => {
  const p = zipFile("mismatch.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": 'window.rex0220PrintCraftAuthoring = { apiVersion: 1, pluginVersion: "7" };' }));
  await assert.rejects(() => loadEngine({ pluginZip: p, allowUnknown: true }), /manifest の版 6 と違う/);
});

test("API の版が違う zip は止まる", async () => {
  const p = zipFile("apiver.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": 'window.rex0220PrintCraftAuthoring = { apiVersion: 2, pluginVersion: "6" };' }));
  await assert.rejects(() => loadEngine({ pluginZip: p, allowUnknown: true }), /authoring API の版 2/);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
