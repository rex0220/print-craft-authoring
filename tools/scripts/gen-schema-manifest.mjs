/**
 * 設定スキーマの manifest を作る（docs/authoring-plan.md 12.4、Codex MAJOR 7）。
 *   docs/schema-manifest.json … 印刷屋の authoring API の CONFIG_SCHEMA を歩いて、キーのパス・型・上限・任意か・列挙を機械的に出したもの
 *                               + 列挙（用紙、向き、dpi、printMode）+ スキーマの版 + 印刷屋の版
 *   docs/defaults/cssInfo.json、menuInfo.json、calcInfo.json … 設定画面の既定値
 * API は engine.ts と同じ経路（PCRAFT_PLUGIN_ZIP の zip、無ければ開発中の print-craft の prod/）から読む。
 * 仕様書（docs/設定ファイル仕様.md）は手で書き、test/spec-sync.test.mjs が manifest と仕様書のキー表を比べる。tools/ で `npm run gen-schema`。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(here, "..");
const repo = path.resolve(tools, "..");
const { loadEngine } = await import(pathToFileURL(path.join(tools, "src", "engine.ts")).href);
const { schemaRevisionOf } = await import(pathToFileURL(path.join(tools, "src", "meta.ts")).href);
const engine = await loadEngine();
const api = engine.api;

const entries = [];
function walk(schema, pathStr) {
  const base = { path: pathStr, type: schema.type, optional: !!schema.optional };
  switch (schema.type) {
    case "string":
    case "scalar-string":
      entries.push({ ...base, maxLength: schema.maxLength ?? null, ...(schema.enum ? { enum: [...schema.enum] } : {}), ...(schema.pattern ? { pattern: String(schema.pattern) } : {}) });
      break;
    case "number":
      entries.push({ ...base, min: schema.min ?? null, max: schema.max ?? null, integer: !!schema.integer });
      break;
    case "boolean":
      entries.push({ ...base, loose: !!schema.loose });
      break;
    case "any":
      entries.push(base);
      break;
    case "array":
      entries.push({ ...base, maxItems: schema.maxItems ?? null, items: schema.items.type });
      walk(schema.items, `${pathStr}[]`);
      break;
    case "object":
      if (pathStr) entries.push({ ...base, unknown: schema.unknown ?? "strip" });
      for (const [k, v] of Object.entries(schema.props)) walk(v, pathStr ? `${pathStr}.${k}` : k);
      break;
    case "map":
      entries.push({ ...base, maxKeys: schema.maxKeys ?? null, values: schema.values.type });
      walk(schema.values, `${pathStr}.*`);
      break;
    default:
      entries.push(base);
  }
}
walk(api.CONFIG_SCHEMA, "");

const manifest = {
  note: "印刷屋の authoring API の CONFIG_SCHEMA から tools/scripts/gen-schema-manifest.mjs が作る。手で直さない。仕様書（設定ファイル仕様.md）との照合は tools/test/spec-sync.test.mjs",
  pluginVersion: engine.source.pluginVersion,
  apiVersion: api.apiVersion,
  schemaRevision: schemaRevisionOf(api.CONFIG_SCHEMA),
  source: `${engine.source.kind}: ${engine.source.from}`,
  limits: api.CONFIG_LIMITS,
  enums: {
    "pluginInfos[].tagsInfo.pageSize": { runtime: [...api.PAPER_NAMES], screen: [...api.PAGE_SIZES] },
    "pluginInfos[].tagsInfo.orientation": ["p", "l"],
    "pluginInfos[].tagsInfo.dpi": [...api.DPI_OPTIONS],
    "pluginInfos[].tagsInfo.printMode": [...api.PRINT_MODES],
    // 外部参照（Ver.6 の共通の設定。API に EXTERNAL_REFS が無い古い zip では固定の値）
    externalRefs: Array.isArray(api.EXTERNAL_REFS) ? [...api.EXTERNAL_REFS] : ["block", "allow"]
  },
  entries
};
const docs = path.join(repo, "docs");
mkdirSync(path.join(docs, "defaults"), { recursive: true });
writeFileSync(path.join(docs, "schema-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
writeFileSync(path.join(docs, "defaults", "cssInfo.json"), JSON.stringify(api.defaultCssRows(), null, 2) + "\n", "utf8");
writeFileSync(path.join(docs, "defaults", "menuInfo.json"), JSON.stringify(api.defaultMenuInfo("ja"), null, 2) + "\n", "utf8");
writeFileSync(path.join(docs, "defaults", "calcInfo.json"), JSON.stringify(api.emptyCalcInfo(), null, 2) + "\n", "utf8");
console.log(`docs/schema-manifest.json: ${entries.length} entries, schema ${manifest.schemaRevision}, plugin v${manifest.pluginVersion} (${manifest.source})`);
