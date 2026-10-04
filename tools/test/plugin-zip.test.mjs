/** 印刷屋の zip の読み込み（2 層の zip、必要なファイル、manifest、SHA-256）。fixture は print-craft の dist/print-craft-plugin6.zip */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PLUGIN_ZIP } from "./helpers.mjs";
import { readPluginZip, unzip, PluginZipError, API_ENTRY } from "../src/plugin-zip.ts";
import { KNOWN_ENGINE_SHA256 } from "../src/meta.ts";

test("印刷屋の zip から engine / bignumber / moment-timezone / authoring API / manifest が取れる", () => {
  assert.ok(existsSync(PLUGIN_ZIP), `fixture の zip が無い: ${PLUGIN_ZIP}（print-craft で npm run build-prod）`);
  const s = readPluginZip(PLUGIN_ZIP);
  assert.equal(s.pluginVersion, "6");
  assert.equal(s.manifest.name.ja, "印刷屋");
  assert.ok(s.engine.length > 300000 && s.engine.includes("KintoneFormulaPCraft"));
  assert.ok(s.bignumber.length > 10000);
  assert.ok(s.momentTimezone.length > 100000);
  assert.ok(s.api && s.api.includes("rex0220PrintCraftAuthoring"), "authoring API（Ver.6 で同梱）");
  assert.match(s.sha256.engine, /^[0-9a-f]{64}$/);
  assert.ok(KNOWN_ENGINE_SHA256["6"].includes(s.sha256.engine), "エンジンの SHA-256 が既知の一覧にある");
  assert.ok(s.manifest.config.js.includes(API_ENTRY));
});

test("unzip: 壊れた入力と、印刷屋でない zip", () => {
  assert.throws(() => unzip(Buffer.from("not a zip")), PluginZipError);
  assert.throws(() => readPluginZip("C:/nonexistent/x.zip"), PluginZipError);
});
