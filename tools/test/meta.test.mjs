/** version が出す情報と、RegExp を含む CONFIG_SCHEMA の安定したハッシュ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { devMeta, stableJson, schemaRevisionOf, isSupportedPluginVersion, MIN_PLUGIN_VERSION, PRINT_CRAFT_PLUGIN_ID, SUPPORTED_API_VERSIONS } from "../src/meta.ts";
import { loadEngine } from "./helpers.mjs";

test("devMeta: tools の版、扱う印刷屋（プラグイン ID、版の下限）と API の版、commit", () => {
  const m = devMeta();
  // tools の版は印刷屋の版と独立（2026-10-06）。1.1.0 から印刷屋は ID と版の下限で決める（2026-10-08）
  assert.match(m.toolsVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(m.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.equal(m.minPluginVersion, 6);
  assert.deepEqual(m.supportedApiVersions, [1, 2]);
  assert.match(m.commit, /^([0-9a-f]{7,}(\+dirty)?|unknown)$/);
  assert.equal(m.mode, "dev");
});

test("stableJson は RegExp を文字列にする。schemaRevisionOf は 12 桁で安定し、zip の API の CONFIG_SCHEMA で計算できる", async () => {
  assert.equal(stableJson({ a: /x+/i }), '{"a":"/x+/i"}');
  assert.equal(JSON.stringify({ a: /x+/i }), '{"a":{}}');
  const engine = await loadEngine();
  const r1 = schemaRevisionOf(engine.api.CONFIG_SCHEMA);
  assert.match(r1, /^[0-9a-f]{12}$/);
  assert.equal(schemaRevisionOf(engine.api.CONFIG_SCHEMA), r1);
  assert.ok(isSupportedPluginVersion(engine.source.pluginVersion));
  assert.ok(SUPPORTED_API_VERSIONS.includes(engine.api.apiVersion));
  assert.equal(engine.source.pluginId, PRINT_CRAFT_PLUGIN_ID);
});

test("isSupportedPluginVersion: 整数で Ver.6 以上", () => {
  for (const v of ["6", "7", "10", "123"]) assert.equal(isSupportedPluginVersion(v), true, v);
  for (const v of ["5", "0", "", "6.0", "6.5", "07", "-7", "x", "1e3", " 7", "9999999"]) assert.equal(isSupportedPluginVersion(v), false, JSON.stringify(v));
  assert.equal(MIN_PLUGIN_VERSION, 6);
});
