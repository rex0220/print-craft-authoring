/** 共通の中核の入口（src/core.ts → npm の @rex0220/print-craft-authoring-tools/core。2026-10-09 Takashi「B」）: 公開の名前と、出さないもの */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/core.ts";

test("入口は print-craft MCP が使う関数を出す（公開の約束。名前を消すときは CORE_API_VERSION を上げる）", () => {
  assert.equal(core.CORE_API_VERSION, 1);
  for (const name of [
    "createContext", "resolveRead", "resolveWrite", "assertChangeAllowed", "loadWorkspace", "appFolderOfFile", "snapshotNameOf",
    "toolsMeta", "loadEngine", "pluginZipPath", "baseUrlFromEnv", "loadAuth", "loadAuthForEnv", "createRestClient", "normalizeKintoneBaseUrl",
    "normalizeSettings", "readFieldsFile", "loadPolicy", "saveNewSettings", "updateButton", "digestOf", "listButtons", "diffSettings",
    "fetchFields", "summarizeFields", "fetchRecord", "summarizeRecord", "shapeLines", "listRecordShapes", "listQueryOf", "runPreview",
    "pullSettings", "takeInbox", "writeNewFile", "findAppDir", "listAppFolder", "assertDirInside"
  ]) {
    assert.equal(typeof core[name], "function", name);
  }
  for (const name of ["PathError", "PermissionError", "WorkspaceError", "InputError", "AuthError", "RestError", "QueryError", "PluginZipError", "FileExistsError", "LockBusyError"]) {
    assert.ok(core[name].prototype instanceof Error, name);
  }
});

test("入口は CLI と開発用の場所の探し方（環境変数を読む）を出さない。package.json の exports は ./core と ./package.json だけ", () => {
  for (const name of ["main", "printCraftRootOf", "printCraftProdDir", "devPluginDir", "PRINT_CRAFT_ROOT"]) assert.equal(name in core, false, name);
  const src = readFileSync(new URL("../src/core.ts", import.meta.url), "utf8");
  assert.ok(!/from "\.\/(cli|dev-paths)\.ts"/.test(src));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(pkg.exports), ["./core", "./package.json"]);
  assert.deepEqual(pkg.exports["./core"], { types: "./dist/types/core.d.ts", import: "./dist/core.mjs", default: "./dist/core.mjs" });
  assert.equal(pkg.bin["pcraft-authoring"], "dist/cli.mjs", "CLI はそのまま");
});
