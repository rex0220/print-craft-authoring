/**
 * 仕様書（docs/設定ファイル仕様.md）と CONFIG_SCHEMA の同期（docs/authoring-plan.md 12.4、Codex MAJOR 7）。
 *   - manifest（docs/schema-manifest.json。gen-schema-manifest.mjs が zip の API の CONFIG_SCHEMA から作る）が今の CONFIG_SCHEMA と同じ版か
 *   - manifest の全キーが仕様書のキー表（`| \`パス\` |` で始まる行）にあるか、仕様書のキー表に manifest に無いパスが無いか
 *   - 仕様書の列挙（用紙、向き、dpi、printMode）が印刷屋の定数と同じか
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { REPO_ROOT } from "../src/paths.ts";
import { schemaRevisionOf } from "../src/meta.ts";

const docs = path.join(REPO_ROOT, "docs");
const manifestFile = path.join(docs, "schema-manifest.json");
const specFile = path.join(docs, "設定ファイル仕様.md");

export function tablePaths(markdown) {
  const out = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) out.push(m[1]);
  }
  return out;
}

export function enumTable(markdown) {
  const out = {};
  const section = markdown.split(/^## /m).find((s) => s.startsWith("列挙"));
  if (!section) return out;
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/);
    if (!m) continue;
    out[m[1]] = [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
  }
  return out;
}

test("manifest がある。schemaRevision が zip の API の CONFIG_SCHEMA と同じ（違えば npm run gen-schema）", async () => {
  assert.ok(existsSync(manifestFile), "docs/schema-manifest.json が無い（tools で npm run gen-schema）");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const engine = await loadEngine();
  assert.equal(manifest.schemaRevision, schemaRevisionOf(engine.api.CONFIG_SCHEMA), "CONFIG_SCHEMA が変わっている。npm run gen-schema と仕様書の見直し");
  assert.equal(manifest.pluginVersion, engine.source.pluginVersion);
  assert.ok(manifest.entries.length > 50);
});

test("仕様書のキー表と manifest のキーが一致する", () => {
  assert.ok(existsSync(specFile), "docs/設定ファイル仕様.md が無い");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const spec = readFileSync(specFile, "utf8");
  const documented = new Set(tablePaths(spec));
  const schemaPaths = new Set(manifest.entries.map((e) => e.path));
  const missing = [...schemaPaths].filter((p) => !documented.has(p));
  const extra = [...documented].filter((p) => !schemaPaths.has(p) && !p.startsWith("$envelope.") && !p.startsWith("$derived."));
  assert.deepEqual(missing, [], `仕様書に無いキー: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `スキーマに無いキー（綴り）: ${extra.join(", ")}`);
});

test("仕様書の列挙が印刷屋の定数と同じ", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const spec = readFileSync(specFile, "utf8");
  const enums = enumTable(spec);
  assert.deepEqual(enums["pluginInfos[].tagsInfo.pageSize"], manifest.enums["pluginInfos[].tagsInfo.pageSize"].runtime);
  assert.deepEqual(enums["pluginInfos[].tagsInfo.orientation"], manifest.enums["pluginInfos[].tagsInfo.orientation"]);
  assert.deepEqual(enums["pluginInfos[].tagsInfo.dpi"], manifest.enums["pluginInfos[].tagsInfo.dpi"]);
  assert.deepEqual(enums["pluginInfos[].tagsInfo.printMode"], manifest.enums["pluginInfos[].tagsInfo.printMode"]);
});

test("仕様書の上限が manifest と同じ（html / css / formulaSet / 全体）", () => {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const spec = readFileSync(specFile, "utf8");
  const limit = (p) => manifest.entries.find((e) => e.path === p).maxLength;
  assert.ok(spec.includes(`${limit("pluginInfos[].tagsInfo.fieldsInfo[].html").toLocaleString()}`), "html の上限が仕様書に無い");
  assert.ok(spec.includes(`${limit("pluginInfos[].tagsInfo.fieldsInfo[].formulaSet").toLocaleString()}`), "formulaSet の上限が仕様書に無い");
  assert.ok(spec.includes(`${manifest.limits.maxStringLength.toLocaleString()}`), "CONFIG_LIMITS の maxStringLength が仕様書に無い");
});
