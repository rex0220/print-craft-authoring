/**
 * 合成 zip（スタブ）で engine.ts の照合を試す: プラグイン ID、印刷屋の版、API の pluginVersion と manifest の版、API の版、API の契約（キーと型）。
 * loadEngine は 1 プロセスに 1 回しか読み込まないので、止まる場合だけをこのファイルで試す（成功する読み込みは engine.test.mjs と engine-v7.test.mjs）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePluginZip, stubInnerEntries } from "./zip-helper.mjs";
import { PluginZipError } from "../src/plugin-zip.ts";
import { loadEngine, resolvePluginSources } from "../src/engine.ts";
import { devPluginDir } from "../src/dev-paths.ts";

// OS の環境変数（開発者の PC に入っていることがある）に左右されないようにする
delete process.env.PCRAFT_PLUGIN_ZIP;
delete process.env.PCRAFT_ALLOW_DEV_PLUGIN;

const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-contract-"));

test("zip の指定が無いとき: 公開ビルド（mode build）は隣の print-craft があっても読まない。ソース実行（dev）も devPluginDir（CLI では PCRAFT_ALLOW_DEV_PLUGIN=1 のときだけ渡す）が無ければ読まない", () => {
  assert.throws(() => resolvePluginSources({}, "build"), (e) => e instanceof PluginZipError && /zip の場所が分からない/.test(e.message) && !/PCRAFT_ALLOW_DEV_PLUGIN/.test(e.message));
  assert.throws(() => resolvePluginSources({}, "dev"), (e) => e instanceof PluginZipError && /PCRAFT_ALLOW_DEV_PLUGIN=1/.test(e.message));
  assert.throws(() => resolvePluginSources({ devPluginDir: devPluginDir() ?? dir }, "build"), /zip の場所が分からない/, "build では解除できない");
  assert.throws(() => resolvePluginSources({ devPluginDir: dir }, "dev"), (e) => e instanceof PluginZipError && /prod\/ が無い/.test(e.message), "渡されたフォルダーにエンジンが無ければ止まる");
  process.env.PCRAFT_PLUGIN_ZIP = "/nonexistent/print-craft.zip";
  process.env.PCRAFT_ALLOW_DEV_PLUGIN = "1";
  try {
    assert.throws(() => resolvePluginSources({}, "dev"), /zip の場所が分からない/, "中核は環境変数を読まない（段階 0-2）");
  } finally {
    delete process.env.PCRAFT_PLUGIN_ZIP;
    delete process.env.PCRAFT_ALLOW_DEV_PLUGIN;
  }
  if (devPluginDir()) {
    const s = resolvePluginSources({ devPluginDir: devPluginDir() }, "dev");
    assert.equal(s.kind, "dev");
    assert.ok(Number(s.pluginVersion) >= 6, `隣の print-craft の prod/ の版: ${s.pluginVersion}`);
  }
});
const zipFile = (name, inner, outerExtra) => {
  const p = path.join(dir, name);
  writeFileSync(p, makePluginZip(inner, outerExtra));
  return p;
};

test("プラグイン ID が印刷屋のものでない zip（別の鍵、PUBKEY が無い）は止まる（コードを実行しない）", async () => {
  // 実行されたら分かるように、API が globalThis に印を付けるスタブにする
  const marker = 'globalThis.__pcraftRan = true; window.rex0220PrintCraftAuthoring = { apiVersion: 1, pluginVersion: "6" };';
  const inner = stubInnerEntries({ "config_js/print-craft-authoring-api.js": marker });
  const other = zipFile("other-key.zip", inner, { PUBKEY: Buffer.from("not the print-craft key") });
  await assert.rejects(() => loadEngine({ pluginZip: other }), (e) => e instanceof PluginZipError && /印刷屋プラグインの zip ではない/.test(e.message) && /lcapkanpjdabgphknkabojmcfhonhkhp/.test(e.message));
  const nokey = zipFile("no-pubkey.zip", inner, { PUBKEY: null });
  await assert.rejects(() => loadEngine({ pluginZip: nokey }), (e) => e instanceof PluginZipError && /PUBKEY が無い/.test(e.message));
  assert.equal(globalThis.__pcraftRan, undefined, "zip のコードは実行されていない");
});

test("対応しない版（5、小数、文字）の zip は止まる（コードを実行しない）", async () => {
  for (const version of [5, 6.5, "x"]) {
    const p = zipFile(`v-${version}.zip`, stubInnerEntries({ "manifest.json": JSON.stringify({ version }) }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e instanceof PluginZipError && /には対応していない/.test(e.message) && /Ver\.6 以降/.test(e.message), String(version));
  }
});

test("authoring API が無い zip は止まる", async () => {
  const inner = stubInnerEntries();
  delete inner["config_js/print-craft-authoring-api.js"];
  const p = zipFile("noapi.zip", inner);
  await assert.rejects(() => loadEngine({ pluginZip: p }), /print-craft-authoring-api\.js が無い/);
});

test("ID が印刷屋のスタブの zip は読み込まれるが、API の契約（キーと型）が合わなければ止まる", async () => {
  const p = zipFile("stub.zip", stubInnerEntries());
  await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e instanceof PluginZipError && /tools が使うものが無い、または型が違う/.test(e.message) && /buildMenuRows/.test(e.message));
});

test("API の pluginVersion が manifest の版と違う zip は止まる", async () => {
  const p = zipFile("mismatch.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": 'window.rex0220PrintCraftAuthoring = { apiVersion: 1, pluginVersion: "7" };' }));
  await assert.rejects(() => loadEngine({ pluginZip: p }), /manifest の版 6 と違う/);
});

test("API の版: 1 と 2 は受け付け（契約の検査まで進む）、0 と 3 は止まる", async () => {
  for (const v of [1, 2]) {
    const p = zipFile(`api-${v}.zip`, stubInnerEntries({ "config_js/print-craft-authoring-api.js": `window.rex0220PrintCraftAuthoring = { apiVersion: ${v}, pluginVersion: "6" };` }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), /tools が使うものが無い/, `API ${v} は版の照合を通る`);
  }
  for (const v of [0, 3]) {
    const p = zipFile(`api-${v}.zip`, stubInnerEntries({ "config_js/print-craft-authoring-api.js": `window.rex0220PrintCraftAuthoring = { apiVersion: ${v}, pluginVersion: "6" };` }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), new RegExp(`authoring API の版 ${v} には対応していない（tools は 1, 2）`));
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
