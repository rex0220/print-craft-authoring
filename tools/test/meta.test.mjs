/** version が出す情報と、RegExp を含む CONFIG_SCHEMA の安定したハッシュ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { devMeta, stableJson, schemaRevisionOf, SUPPORTED_PLUGIN_VERSIONS, SUPPORTED_API_VERSION } from "../src/meta.ts";
import { loadEngine } from "./helpers.mjs";

test("devMeta: tools の版、対応する印刷屋の版と API の版、commit", () => {
  const m = devMeta();
  assert.match(m.toolsVersion, /^6\.\d+\.\d+$/);
  assert.deepEqual(m.supportedPluginVersions, ["6"]);
  assert.equal(m.supportedApiVersion, 1);
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
  assert.ok(SUPPORTED_PLUGIN_VERSIONS.includes(engine.source.pluginVersion));
  assert.equal(engine.api.apiVersion, SUPPORTED_API_VERSION);
});
