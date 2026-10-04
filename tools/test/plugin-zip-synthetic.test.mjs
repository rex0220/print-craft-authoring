/**
 * 合成 zip（印刷屋のコードを含まないスタブ）で plugin-zip.ts の整合性の検査と上限、engine.ts の fail-closed を試す（1-10 レビュー BLOCKER 2 / MAJOR 6）。
 * fail-closed は本物の zip の authoring API を 1 バイト変えた zip で確かめる（実行せずに止まる。PCRAFT_ALLOW_UNKNOWN_PLUGIN のときだけ警告で続く）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGIN_ZIP } from "./helpers.mjs";
import { makeZip, makePluginZip, stubInnerEntries } from "./zip-helper.mjs";
import { API_ENTRY, PluginZipError, ZIP_LIMITS, crc32, readPluginZip, unzip } from "../src/plugin-zip.ts";
import { loadEngine, unknownParts } from "../src/engine.ts";
import { KNOWN_PLUGIN_RELEASES } from "../src/meta.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-zip-"));
/** unknownParts の文言から名前だけ（"authoring API 59c27e480f41…" → "authoring API"） */
const names = (parts) => parts.map((x) => x.replace(/ (?:[0-9a-z]+…|無し)$/, ""));
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
  assert.deepEqual(names(unknownParts(s)), ["計算式エンジン", "authoring API", "bignumber", "moment-timezone"], "スタブはどれも既知でない");
  assert.throws(() => readPluginZip(file("nocontents.zip", makeZip({ PUBKEY: "x" }))), /印刷屋の zip ではない/);
  assert.throws(() => readPluginZip(file("noengine.zip", makePluginZip({ "manifest.json": "{}" }))), /が無い/);
  assert.throws(() => readPluginZip(file("badmanifest.zip", makePluginZip(stubInnerEntries({ "manifest.json": "{" })))), /manifest\.json を読めない/);
});

test("本物の zip は 4 つの中身がすべて既知。API を 1 文字でも変えた zip は実行せずに止まる（PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 なら警告で続く）", async () => {
  const real = readPluginZip(PLUGIN_ZIP);
  assert.deepEqual(unknownParts(real), []);
  assert.ok(KNOWN_PLUGIN_RELEASES["6"].some((r) => r.api === real.sha256.api));
  // 改変した zip（authoring API の末尾にコメントを足す）
  const outer = unzip(readFileSync(PLUGIN_ZIP));
  const inner = unzip(outer.get("contents.zip"));
  const entries = {};
  for (const [k, v] of inner) entries[k] = v;
  entries[API_ENTRY] = Buffer.concat([inner.get(API_ENTRY), Buffer.from("\n// tampered\n")]);
  const tampered = file("tampered.zip", makeZip({ "contents.zip": makeZip(entries), PUBKEY: outer.get("PUBKEY"), SIGNATURE: outer.get("SIGNATURE") }));
  const parts = unknownParts(readPluginZip(tampered));
  assert.deepEqual(names(parts), ["authoring API"]);
  await assert.rejects(() => loadEngine({ pluginZip: tampered }), (e) => e instanceof PluginZipError && /既知のリリースと違う: authoring API/.test(e.message) && /PCRAFT_ALLOW_UNKNOWN_PLUGIN=1/.test(e.message));
  const engine = await loadEngine({ pluginZip: tampered, allowUnknown: true });
  assert.equal(engine.source.engineKnown, false);
  assert.equal(engine.warnings.length, 1);
  assert.match(engine.warnings[0], /PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 なので続ける/);
  assert.equal(engine.api.apiVersion, 1);
});

test("既知の一覧はリリース単位の tuple: 配っていない組み合わせ（エンジンは A、API は B）は既知と見ない", () => {
  const A = { engine: "a1", api: "a2", bignumber: "a3", momentTimezone: "a4" };
  const B = { engine: "b1", api: "b2", bignumber: "b3", momentTimezone: "b4" };
  const releases = { "6": [A, B] };
  const src = (h) => ({ pluginVersion: "6", sha256: h });
  assert.deepEqual(unknownParts(src(A), releases), []);
  assert.deepEqual(unknownParts(src(B), releases), []);
  const mixed = unknownParts(src({ engine: "a1", api: "b2", bignumber: "a3", momentTimezone: "a4" }), releases);
  assert.deepEqual(names(mixed), ["authoring API"], "A に最も近いので API だけが違うと出る");
  assert.deepEqual(names(unknownParts(src({ ...A, api: undefined }), releases)), ["authoring API"]);
  assert.deepEqual(unknownParts({ pluginVersion: "7", sha256: A }, releases), ["版の一覧が無い"]);
  // 同率（A と 2 つ、B と 2 つ一致）なら登録順に左右されず 4 つとも出す
  const tie = unknownParts(src({ engine: "a1", api: "a2", bignumber: "b3", momentTimezone: "b4" }), releases);
  assert.deepEqual(names(tie), ["計算式エンジン", "authoring API", "bignumber", "moment-timezone"]);
  assert.deepEqual(names(unknownParts(src({ engine: "z1", api: "z2", bignumber: "z3", momentTimezone: "z4" }), releases)), ["計算式エンジン", "authoring API", "bignumber", "moment-timezone"], "どれとも一致しなければ 4 つ");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
