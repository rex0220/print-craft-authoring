/** version が出す情報（開発中の計算）と、RegExp を含む CONFIG_SCHEMA の安定したハッシュ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { devMeta, stableJson, schemaRevision } from "../src/meta.ts";

test("devMeta: tools の版、印刷屋の版 6、スキーマの版 12 桁、commit、エンジンの SHA-256", async () => {
  const m = await devMeta();
  assert.match(m.toolsVersion, /^6\.\d+\.\d+$/);
  assert.equal(m.pluginVersion, "6");
  assert.match(m.schemaRevision, /^[0-9a-f]{12}$/);
  assert.match(m.printCraftCommit, /^([0-9a-f]{7,}(\+dirty)?|unknown)$/);
  assert.equal(m.engineFile, "KintoneFormulaPCraft.min.js");
  assert.match(m.engineSha256, /^[0-9a-f]{64}$/);
  assert.equal(m.mode, "dev");
});

test("stableJson は RegExp を文字列にする（JSON.stringify は {} にする）。schemaRevision は 12 桁で安定", async () => {
  assert.equal(stableJson({ a: /x+/i }), '{"a":"/x+/i"}');
  assert.equal(JSON.stringify({ a: /x+/i }), '{"a":{}}');
  const r1 = await schemaRevision();
  assert.match(r1, /^[0-9a-f]{12}$/);
  assert.equal(await schemaRevision(), r1);
});
