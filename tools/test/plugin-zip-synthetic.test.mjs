/**
 * 合成 zip（印刷屋のコードを含まないスタブ）で plugin-zip.ts の整合性の検査と上限、engine.ts の照合を試す（1-10 レビュー BLOCKER 2 / MAJOR 6）。
 * 1.1.0（2026-10-08 Takashi「pluginid のチェックのみで OK」）: 読み込んでよいかはプラグイン ID だけで決める。本物の中身でも PUBKEY が別の鍵なら実行せずに止まる。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGIN_ZIP } from "./helpers.mjs";
import { makeZip, makePluginZip, stubInnerEntries, PRINT_CRAFT_PUBKEY } from "./zip-helper.mjs";
import { PluginZipError, ZIP_LIMITS, crc32, pluginIdOf, readPluginZip, unzip } from "../src/plugin-zip.ts";
import { loadEngine } from "../src/engine.ts";
import { PRINT_CRAFT_PLUGIN_ID } from "../src/meta.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-zip-"));
const file = (name, buf) => {
  const p = path.join(dir, name);
  writeFileSync(p, buf);
  return p;
};

test("crc32 と stored の zip の往復", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const z = unzip(makeZip({ "a.txt": "hello", "dir/b.bin": Buffer.from([1, 2, 3]) }));
  assert.deepEqual([...z.keys()], ["a.txt", "dir/b.bin"]);
  assert.equal(z.get("a.txt").toString(), "hello");
});

test("壊れた zip は止まる: CRC、local header の名前、大きさ、同名の entry、不正な名前", () => {
  assert.throws(() => unzip(makeZip({ "a.txt": "x" }, { badCrc: "a.txt" })), /CRC が合わない/);
  assert.throws(() => unzip(makeZip({ "a.txt": "x" }, { badLocalName: "a.txt" })), /central directory と local header で違う/);
  assert.throws(() => unzip(makeZip({ "a.txt": "x" }, { badSize: "a.txt" })), /大きさが合わない/);
  assert.throws(() => unzip(makeZip({ "a.txt": "x" }, { duplicate: "a.txt" })), /同じ名前の entry/);
  assert.throws(() => unzip(makeZip({ "../a.txt": "x" })), /entry 名が不正/);
  assert.throws(() => unzip(makeZip({ "/a.txt": "x" })), /entry 名が不正/);
  assert.throws(() => unzip(Buffer.from("not a zip")), PluginZipError);
  const truncated = makeZip({ "a.txt": "hello world" });
  assert.throws(() => unzip(truncated.subarray(0, truncated.length - 5)), PluginZipError);
});

test("上限: entry の数、entry の大きさ、合計、外側の大きさ", () => {
  const limits = { ...ZIP_LIMITS, maxEntries: 2, maxEntryBytes: 10, maxTotalBytes: 15 };
  assert.throws(() => unzip(makeZip({ a: "1", b: "2", c: "3" }), limits), /entry が多すぎる/);
  assert.throws(() => unzip(makeZip({ a: "x".repeat(11) }), limits), /entry が大きすぎる/);
  assert.throws(() => unzip(makeZip({ a: "x".repeat(8), b: "y".repeat(8) }), limits), /合計が大きすぎる/);
  assert.throws(() => unzip(makeZip({ a: "x" }), { ...ZIP_LIMITS, maxOuterBytes: 10 }), /zip が大きすぎる/);
  assert.equal(unzip(makeZip({ a: "x".repeat(8) }), limits).get("a").length, 8);
});

test("合成の印刷屋 zip（スタブ）から版と entry と SHA-256 が取れる。contents.zip が無ければ印刷屋の zip ではない", () => {
  const p = file("stub.zip", makePluginZip(stubInnerEntries()));
  const s = readPluginZip(p);
  assert.equal(s.pluginVersion, "6");
  assert.match(s.sha256.engine, /^[0-9a-f]{64}$/);
  assert.match(s.sha256.api, /^[0-9a-f]{64}$/);
  assert.match(s.sha256.contents, /^[0-9a-f]{64}$/);
  assert.ok(s.api.includes("rex0220PrintCraftAuthoring"));
  assert.equal(s.pluginId, PRINT_CRAFT_PLUGIN_ID, "合成 zip の PUBKEY は印刷屋の公開鍵");
  assert.equal(pluginIdOf(PRINT_CRAFT_PUBKEY), PRINT_CRAFT_PLUGIN_ID);
  assert.equal(readPluginZip(file("nokey.zip", makePluginZip(stubInnerEntries(), { PUBKEY: null }))).pluginId, undefined, "PUBKEY が無ければ ID は無い");
  assert.throws(() => readPluginZip(file("nocontents.zip", makeZip({ PUBKEY: "x" }))), /印刷屋の zip ではない/);
  assert.throws(() => readPluginZip(file("noengine.zip", makePluginZip({ "manifest.json": "{}" }))), /が無い/);
  assert.throws(() => readPluginZip(file("badmanifest.zip", makePluginZip(stubInnerEntries({ "manifest.json": "{" })))), /manifest\.json を読めない/);
});

test("本物の zip の ID は印刷屋のもの。本物の中身でも PUBKEY を別の鍵にした zip は実行せずに止まる", async () => {
  const real = readPluginZip(PLUGIN_ZIP);
  assert.equal(real.pluginId, PRINT_CRAFT_PLUGIN_ID);
  const outer = unzip(readFileSync(PLUGIN_ZIP));
  const otherKey = file("other-key.zip", makeZip({ "contents.zip": outer.get("contents.zip"), PUBKEY: Buffer.from("another plugin key"), SIGNATURE: outer.get("SIGNATURE") }));
  assert.notEqual(readPluginZip(otherKey).pluginId, PRINT_CRAFT_PLUGIN_ID);
  await assert.rejects(() => loadEngine({ pluginZip: otherKey }), (e) => e instanceof PluginZipError && /印刷屋プラグインの zip ではない/.test(e.message));
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
