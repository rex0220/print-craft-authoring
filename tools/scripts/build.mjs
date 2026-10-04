/**
 * tools をビルドする（docs/authoring-plan.md 12.1）。
 *   - src/cli.ts を esbuild で 1 本（dist/cli.mjs。platform node、ESM、Node 20）。happy-dom は依存のまま外に置く
 *   - print-craft の src/shared・src/config と plugin-config-kit の src は bundle に取り込む（alias は kit の build-plugin.mjs と同じ）
 *   - 同梱する lib（計算式エンジン min.js、bignumber、moment-timezone）を print-craft の prod/desktop_js から dist/lib/ に複写し、
 *     SHA-256 を dist/lib/manifest.json に書く
 *   - 版・対応する印刷屋の版・スキーマの版・commit・エンジンの SHA-256 を __PCRAFT_TOOLS_META__ に埋める（version コマンドが出す）
 * 実行は Node 22.6 以上（print-craft の schema.ts を直接読むため）。
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const { AUTHORING_ROOT, PRINT_CRAFT_ROOT, LIB_FILES, kitRoot, rexgridRoot } = await import(pathToFileURL(path.join(root, "src", "paths.ts")).href);
const { devMeta } = await import(pathToFileURL(path.join(root, "src", "meta.ts")).href);

const meta = { ...(await devMeta()), builtAt: new Date().toISOString(), mode: "build" };
const dist = path.join(AUTHORING_ROOT, "dist");
const distLib = path.join(dist, "lib");
mkdirSync(distLib, { recursive: true });

// lib の複写
const libManifest = { source: `print-craft ${meta.printCraftCommit} prod/desktop_js`, files: {} };
for (const name of LIB_FILES) {
  const src = path.join(PRINT_CRAFT_ROOT, "prod", "desktop_js", name);
  copyFileSync(src, path.join(distLib, name));
  libManifest.files[name] = createHash("sha256").update(readFileSync(src)).digest("hex");
}
writeFileSync(path.join(distLib, "manifest.json"), JSON.stringify(libManifest, null, 2) + "\n", "utf8");

const banner = `#!/usr/bin/env node\n/*! @rex0220/print-craft-authoring-tools ${meta.toolsVersion} for 印刷屋プラグイン v${meta.pluginVersion} (c) rex0220. print-craft ${meta.printCraftCommit}. engine sha256 ${meta.engineSha256.slice(0, 12)}. All rights reserved. */`;
await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile: path.join(dist, "cli.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  charset: "utf8",
  legalComments: "none",
  external: ["happy-dom"],
  banner: { js: banner },
  define: {
    __PCRAFT_TOOLS_META__: JSON.stringify(JSON.stringify(meta)),
    __PLUGIN_VERSION__: JSON.stringify(meta.pluginVersion)
  },
  alias: { "plugin-config-kit": kitRoot(), rexgrid: rexgridRoot() },
  absWorkingDir: root,
  logLevel: "warning"
});
console.log(`wrote dist/cli.mjs (tools ${meta.toolsVersion}, plugin v${meta.pluginVersion}, schema ${meta.schemaRevision}, print-craft ${meta.printCraftCommit})`);
console.log(`lib: ${LIB_FILES.join(", ")} → dist/lib/ (engine sha256 ${meta.engineSha256})`);
