/** CLI のパスの制限（1-10 レビュー BLOCKER 5）: 読むのは cwd の中、書くのは決まった root の下。junction / symlink は実体で判定 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PathError, WRITE_ROOTS, realResolve, resolveRead, resolveWrite, resolveWriteDir, safeFileName } from "../src/safe-path.ts";

const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-safe-"));
const outsideDir = mkdtempSync(path.join(os.tmpdir(), "pcraft-outside-"));
mkdirSync(path.join(work, "settings"));
mkdirSync(path.join(work, "policy"));
writeFileSync(path.join(work, "settings", "a.json"), "{}");
writeFileSync(path.join(work, ".env"), "X=1");
writeFileSync(path.join(outsideDir, "o.json"), "{}");

test("resolveRead: cwd の中だけ。.env と node_modules は読まない", () => {
  assert.equal(resolveRead("settings/a.json", work), realResolve("settings/a.json", work));
  assert.equal(resolveRead(path.join(work, "settings", "a.json"), work), realResolve("settings/a.json", work));
  assert.throws(() => resolveRead(path.join(outsideDir, "o.json"), work), PathError);
  assert.throws(() => resolveRead("../o.json", work), PathError);
  assert.throws(() => resolveRead(".env", work), /読まない/);
  assert.throws(() => resolveRead(".env.local", work), /読まない/);
  assert.throws(() => resolveRead("node_modules/x/package.json", work), /読まない/);
  assert.throws(() => resolveRead("", work), PathError);
});

test("resolveWrite: root の下だけ。root そのもの、cwd の外、policy/、.env、予約名は不可", () => {
  assert.equal(resolveWrite("settings/b.json", WRITE_ROOTS.settings, work), path.join(realResolve(".", work), "settings", "b.json"));
  assert.equal(resolveWrite("temp/x/y.json", WRITE_ROOTS.settings, work), path.join(realResolve(".", work), "temp", "x", "y.json"));
  assert.throws(() => resolveWrite("settings", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite("policy/authoring-policy.json", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite(".env", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite("settings/../.env", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite("../x.json", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite(path.join(outsideDir, "x.json"), WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveWrite("settings/CON", WRITE_ROOTS.settings, work), /使えないファイル名/);
  assert.throws(() => resolveWrite("settings/nul.json", WRITE_ROOTS.settings, work), /使えないファイル名/);
  assert.throws(() => resolveWrite("settings/a.json.", WRITE_ROOTS.settings, work), /使えないファイル名/);
  if (process.platform === "win32") {
    assert.ok(resolveWrite("SETTINGS/B.json", WRITE_ROOTS.settings, work).toLowerCase().endsWith("settings\\b.json"), "Windows は大文字小文字を区別しない");
    assert.throws(() => resolveWrite("\\\\localhost\\c$\\x.json", WRITE_ROOTS.settings, work), PathError, "UNC");
  }
});

test("resolveWriteDir: out/ とその下だけ", () => {
  assert.equal(resolveWriteDir("out", WRITE_ROOTS.out, work), path.join(realResolve(".", work), "out"));
  assert.equal(resolveWriteDir("out/sub", WRITE_ROOTS.out, work), path.join(realResolve(".", work), "out", "sub"));
  assert.throws(() => resolveWriteDir("docs", WRITE_ROOTS.out, work), PathError);
  assert.throws(() => resolveWriteDir("..", WRITE_ROOTS.out, work), PathError);
});

test("symlink / junction で cwd の外へ出る書き込み先は実体で判定して止める", (t) => {
  try {
    symlinkSync(outsideDir, path.join(work, "settings", "link"), "junction");
  } catch (e) {
    t.skip(`symlink を作れない: ${e.message}`);
    return;
  }
  assert.throws(() => resolveWrite("settings/link/x.json", WRITE_ROOTS.settings, work), PathError);
  assert.throws(() => resolveRead("settings/link/o.json", work), PathError);
});

test("リンク切れの junction は実体が解けないので止める（存在しない扱いにしない）", (t) => {
  const target = mkdtempSync(path.join(os.tmpdir(), "pcraft-dangling-"));
  try {
    symlinkSync(target, path.join(work, "settings", "dangling"), "junction");
  } catch (e) {
    t.skip(`symlink を作れない: ${e.message}`);
    rmSync(target, { recursive: true, force: true });
    return;
  }
  rmSync(target, { recursive: true, force: true });
  assert.throws(() => resolveWrite("settings/dangling/x.json", WRITE_ROOTS.settings, work), /解決できない/);
  assert.throws(() => resolveRead("settings/dangling/x.json", work), /解決できない/);
});

test("safeFileName: 使えない文字、予約名、末尾のピリオド", () => {
  assert.equal(safeFileName("見積書", "b"), "見積書");
  assert.equal(safeFileName("a/b:c*d?e\"f<g>h|i", "b"), "a_b_c_d_e_f_g_h_i");
  assert.equal(safeFileName("CON", "button-1"), "button-1");
  assert.equal(safeFileName("nul", "button-1"), "button-1");
  assert.equal(safeFileName("x...", "b"), "x");
  assert.equal(safeFileName("   ", "b"), "b");
});

test.after(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});
