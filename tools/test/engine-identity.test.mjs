/**
 * 読み込んだ zip の照合（B1 の Codex 再レビュー MAJOR 2）: 1 プロセスに 1 つのエンジン。同じ zip（実体のパス・大きさ・更新日時）なら同じエンジンを返し、
 * 別の zip（同じ中身の写しでも）や、読み込んだ後に変わった zip は zip-changed で止める（前は黙って最初のエンジンを返した）。同時の読み込みは 1 つにまとめる。
 * loadEngine は 1 プロセスに 1 回だけ読むので、別のファイルにする
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGIN_ZIP } from "./helpers.mjs";
import { PluginZipError } from "../src/plugin-zip.ts";
import { loadEngine } from "../src/engine.ts";

const skip = existsSync(PLUGIN_ZIP) ? false : `印刷屋の zip が無い: ${PLUGIN_ZIP}`;
const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-identity-"));

test("同じ zip は同じエンジン、別の zip・変わった zip は zip-changed。同時の読み込みは 1 つ", { skip }, async () => {
  const a = path.join(dir, "a.zip");
  const b = path.join(dir, "b.zip");
  copyFileSync(PLUGIN_ZIP, a);
  copyFileSync(PLUGIN_ZIP, b);
  const [first, second] = await Promise.allSettled([loadEngine({ pluginZip: a }), loadEngine({ pluginZip: b })]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected", "読み込みの途中の別の zip も、終わるのを待ってから照合する");
  assert.ok(second.reason instanceof PluginZipError && second.reason.code === "zip-changed", String(second.reason));
  assert.match(second.reason.message, /読み込んだもの（a\.zip）と違う/);
  assert.equal(second.reason.info.pluginVersion, first.value.source.pluginVersion);
  const engine = first.value;
  assert.equal(await loadEngine({ pluginZip: a }), engine, "同じ zip");
  assert.equal(await loadEngine(), engine, "zip を渡さなければ読み込んだもの（今までどおり）");
  try {
    symlinkSync(a, path.join(dir, "link.zip"));
    assert.equal(await loadEngine({ pluginZip: path.join(dir, "link.zip") }), engine, "実体が同じなら同じ zip");
  } catch (e) {
    if (e?.code !== "EPERM") throw e;
  }
  const later = new Date(Date.now() + 60_000);
  utimesSync(a, later, later);
  await assert.rejects(() => loadEngine({ pluginZip: a }), (e) => e instanceof PluginZipError && e.code === "zip-changed", "読み込んだ後に変わった");
  rmSync(a);
  await assert.rejects(() => loadEngine({ pluginZip: a }), (e) => e instanceof PluginZipError && e.code === "zip-changed", "読み込んだ後に消えた");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
