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
  assert.throws(() => resolvePluginSources({}, "build"), (e) => e instanceof PluginZipError && e.code === "not-configured" && /zip の場所が分からない/.test(e.message) && !/PCRAFT_ALLOW_DEV_PLUGIN/.test(e.message));
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
  await assert.rejects(() => loadEngine({ pluginZip: other }), (e) => e instanceof PluginZipError && e.code === "not-print-craft" && e.info.pluginVersion === "6" && /印刷屋プラグインの zip ではない/.test(e.message) && /lcapkanpjdabgphknkabojmcfhonhkhp/.test(e.message));
  const nokey = zipFile("no-pubkey.zip", inner, { PUBKEY: null });
  await assert.rejects(() => loadEngine({ pluginZip: nokey }), (e) => e instanceof PluginZipError && /PUBKEY が無い/.test(e.message));
  assert.equal(globalThis.__pcraftRan, undefined, "zip のコードは実行されていない");
});

test("対応しない版（5、小数、文字）の zip は止まる（コードを実行しない）", async () => {
  for (const version of [5, 6.5, "x"]) {
    const p = zipFile(`v-${version}.zip`, stubInnerEntries({ "manifest.json": JSON.stringify({ version }) }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e instanceof PluginZipError && e.code === "unsupported-version" && e.info.pluginVersion === String(version) && /には対応していない/.test(e.message) && /Ver\.6 以降/.test(e.message), String(version));
  }
});

test("authoring API が無い zip は止まる", async () => {
  const inner = stubInnerEntries();
  delete inner["config_js/print-craft-authoring-api.js"];
  const p = zipFile("noapi.zip", inner);
  await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e.code === "no-api" && /print-craft-authoring-api\.js が無い/.test(e.message));
});

test("ID が印刷屋のスタブの zip は読み込まれるが、API の契約（キーと型）が合わなければ止まる", async () => {
  const p = zipFile("stub.zip", stubInnerEntries());
  await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e instanceof PluginZipError && e.code === "api-incomplete" && e.info.apiVersion === 1 && /tools が使うものが無い、または型が違う/.test(e.message) && /buildMenuRows/.test(e.message));
});

test("API の pluginVersion が manifest の版と違う zip は止まる", async () => {
  const p = zipFile("mismatch.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": 'window.rex0220PrintCraftAuthoring = { apiVersion: 1, pluginVersion: "7" };' }));
  await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e.code === "api-mismatch" && /manifest の版 6 と違う/.test(e.message));
});

test("API の版: 1 と 2 は受け付け（契約の検査まで進む）、0 と 3 は止まる", async () => {
  for (const v of [1, 2]) {
    const p = zipFile(`api-${v}.zip`, stubInnerEntries({ "config_js/print-craft-authoring-api.js": `window.rex0220PrintCraftAuthoring = { apiVersion: ${v}, pluginVersion: "6" };` }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), /tools が使うものが無い/, `API ${v} は版の照合を通る`);
  }
  for (const v of [0, 3]) {
    const p = zipFile(`api-${v}.zip`, stubInnerEntries({ "config_js/print-craft-authoring-api.js": `window.rex0220PrintCraftAuthoring = { apiVersion: ${v}, pluginVersion: "6" };` }));
    await assert.rejects(() => loadEngine({ pluginZip: p }), (e) => e.code === "api-unsupported" && e.info.apiVersion === v && e.info.pluginVersion === "6" && new RegExp(`authoring API の版 ${v} には対応していない（tools は 1, 2）`).test(e.message));
  }
});

test("誤りの種類（code）: zip が無い・zip として読めない・印刷屋のコードを実行できない・計算式エンジンが無い・API が読めない（診断で読めない / 合わないを分ける。B1 の Codex 再レビュー MAJOR 1）", async () => {
  await assert.rejects(() => loadEngine({ pluginZip: path.join(dir, "無い.zip") }), (e) => e instanceof PluginZipError && e.code === "missing");
  const garbage = path.join(dir, "garbage.zip");
  writeFileSync(garbage, "not a zip");
  await assert.rejects(() => loadEngine({ pluginZip: garbage }), (e) => e instanceof PluginZipError && e.code === "unreadable" && e.info.pluginVersion === undefined);
  const throwing = zipFile("throwing.zip", stubInnerEntries({ "desktop_js/bignumber.min.js": "throw new Error('stub failure');" }));
  await assert.rejects(() => loadEngine({ pluginZip: throwing }), (e) => e instanceof PluginZipError && e.code === "engine-unreadable" && /bignumber\.min\.js/.test(e.message) && e.info.pluginVersion === "6");
  const noCtor = zipFile("no-ctor.zip", stubInnerEntries({ "desktop_js/KintoneFormulaPCraft.min.js": "window.rex0220p = {};" }));
  await assert.rejects(() => loadEngine({ pluginZip: noCtor }), (e) => e instanceof PluginZipError && e.code === "engine-unreadable" && /KintoneFormulaPCraft/.test(e.message));
  const noApi = zipFile("no-api-object.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": "/* 何も置かない（前の試験の読み込みが置いたグローバルも消す） */ delete globalThis.rex0220PrintCraftAuthoring; delete window.rex0220PrintCraftAuthoring;" }));
  await assert.rejects(() => loadEngine({ pluginZip: noApi }), (e) => e instanceof PluginZipError && e.code === "api-unreadable");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
