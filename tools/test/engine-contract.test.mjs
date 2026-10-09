/**
 * 合成 zip（スタブ）で engine.ts の照合を試す: プラグイン ID、印刷屋の版、API の pluginVersion と manifest の版、API の版、API の契約（キーと型）。
 * loadEngine は 1 プロセスに 1 回しか読み込まないので、止まる場合だけをこのファイルで試す（成功する読み込みは engine.test.mjs と engine-v7.test.mjs）。
 * zip のコードを動かし始めた後の失敗はプロセスに残る（以後は restart-required）ので、その場合は 1 つずつ子プロセスで試す（loadInChild）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makePluginZip, stubInnerEntries } from "./zip-helper.mjs";
import { PluginZipError } from "../src/plugin-zip.ts";
import { loadEngine, resolvePluginSources } from "../src/engine.ts";
import { devPluginDir } from "../src/dev-paths.ts";
import { PLUGIN_ZIP } from "./helpers.mjs";

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

const ENGINE_URL = new URL("../src/engine.ts", import.meta.url).href;
/** 新しいプロセスで zips を順に読み、それぞれの結果（成功なら版、失敗なら code と info）を返す（zip のコードを動かす失敗はプロセスに残るため） */
function loadInChild(...zips) {
  const script = `
    const { loadEngine } = await import(${JSON.stringify(ENGINE_URL)});
    const out = [];
    for (const z of JSON.parse(process.argv[1])) {
      try {
        const e = await loadEngine({ pluginZip: z });
        out.push({ ok: true, pluginVersion: e.source.pluginVersion });
      } catch (e) {
        out.push({ name: e.constructor.name, code: e.code, info: e.info, message: e.message });
      }
    }
    process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script, JSON.stringify(zips)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

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

const apiStub = (name, apiVersion, pluginVersion = "6") =>
  zipFile(name, stubInnerEntries({ "config_js/print-craft-authoring-api.js": `window.rex0220PrintCraftAuthoring = { apiVersion: ${apiVersion}, pluginVersion: "${pluginVersion}" };` }));

test("ID が印刷屋のスタブの zip は読み込まれるが、API の契約（キーと型）が合わなければ止まる（子プロセス）", () => {
  const [r] = loadInChild(zipFile("stub.zip", stubInnerEntries()));
  assert.deepEqual([r.name, r.code, r.info.apiVersion], ["PluginZipError", "api-incomplete", 1]);
  assert.match(r.message, /tools が使うものが無い、または型が違う/);
  assert.match(r.message, /buildMenuRows/);
});

test("API の pluginVersion が manifest の版と違う zip は止まる（子プロセス）", () => {
  const [r] = loadInChild(apiStub("mismatch.zip", 1, "7"));
  assert.equal(r.code, "api-mismatch");
  assert.match(r.message, /manifest の版 6 と違う/);
});

test("API の版: 1 と 2 は受け付け（契約の検査まで進む）、0 と 3 は止まる（1 つずつ子プロセス）", () => {
  for (const v of [1, 2]) assert.equal(loadInChild(apiStub(`api-${v}.zip`, v))[0].code, "api-incomplete", `API ${v} は版の照合を通る`);
  for (const v of [0, 3]) {
    const [r] = loadInChild(apiStub(`api-${v}.zip`, v));
    assert.deepEqual([r.code, r.info.apiVersion, r.info.pluginVersion], ["api-unsupported", v, "6"]);
    assert.match(r.message, new RegExp(`authoring API の版 ${v} には対応していない（tools は 1, 2）`));
  }
});

test("誤りの種類（code）: zip が無い・zip として読めない（このプロセス）、印刷屋のコードを実行できない・計算式エンジンが無い・API が読めない（子プロセス）。B1 の Codex 再レビュー MAJOR 1", async () => {
  await assert.rejects(() => loadEngine({ pluginZip: path.join(dir, "無い.zip") }), (e) => e instanceof PluginZipError && e.code === "missing");
  const garbage = path.join(dir, "garbage.zip");
  writeFileSync(garbage, "not a zip");
  await assert.rejects(() => loadEngine({ pluginZip: garbage }), (e) => e instanceof PluginZipError && e.code === "unreadable" && e.info.pluginVersion === undefined);
  const [throwing] = loadInChild(zipFile("throwing.zip", stubInnerEntries({ "desktop_js/bignumber.min.js": "throw new Error('stub failure');" })));
  assert.deepEqual([throwing.code, throwing.info.pluginVersion], ["engine-unreadable", "6"]);
  assert.match(throwing.message, /bignumber\.min\.js/);
  const [noCtor] = loadInChild(zipFile("no-ctor.zip", stubInnerEntries({ "desktop_js/KintoneFormulaPCraft.min.js": "window.rex0220p = {};" })));
  assert.equal(noCtor.code, "engine-unreadable");
  assert.match(noCtor.message, /KintoneFormulaPCraft/);
  const [noApi] = loadInChild(zipFile("no-api-object.zip", stubInnerEntries({ "config_js/print-craft-authoring-api.js": "/* 何も置かない */" })));
  assert.equal(noApi.code, "api-unreadable");
});

test("zip のコードを動かし始めた後に失敗したら、そのプロセスでは読み込み直さない（restart-required。前の誤りを info.previous に）。B1 の Codex 3 回目 MAJOR 1", () => {
  const [first, second, third] = loadInChild(zipFile("stub-poison.zip", stubInnerEntries()), apiStub("other-poison.zip", 1, "7"), path.join(dir, "無い.zip"));
  assert.equal(first.code, "api-incomplete");
  for (const r of [second, third]) {
    assert.deepEqual([r.code, r.info.previous, r.info.pluginVersion], ["restart-required", "api-incomplete", "6"]);
    assert.match(r.message, /起動し直す/);
  }
});

test("zip のコードを動かす前の失敗（版・プラグイン ID・無い・読めない・API が無い）はやり直せる: 後で正しい zip を読める", { skip: existsSync(PLUGIN_ZIP) ? false : `印刷屋の zip が無い: ${PLUGIN_ZIP}` }, () => {
  const noApiInner = stubInnerEntries();
  delete noApiInner["config_js/print-craft-authoring-api.js"];
  const garbage = path.join(dir, "garbage-retry.zip");
  writeFileSync(garbage, "not a zip");
  const results = loadInChild(
    zipFile("v5-retry.zip", stubInnerEntries({ "manifest.json": JSON.stringify({ version: 5 }) })),
    zipFile("other-key-retry.zip", stubInnerEntries(), { PUBKEY: Buffer.from("not the print-craft key") }),
    zipFile("noapi-retry.zip", noApiInner),
    path.join(dir, "無い.zip"),
    garbage,
    PLUGIN_ZIP
  );
  assert.deepEqual(results.map((r) => r.code ?? "ok"), ["unsupported-version", "not-print-craft", "no-api", "missing", "unreadable", "ok"]);
  assert.ok(Number(results[5].pluginVersion) >= 6);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
