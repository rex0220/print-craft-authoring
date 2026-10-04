/**
 * tools をビルドする（docs/authoring-plan.md 12.1、12.9 の 9）。
 *   - src/cli.ts を esbuild で 1 本（dist/cli.mjs。platform node、ESM、Node 20）。happy-dom は依存のまま外に置く
 *   - 印刷屋と kit のコードは bundle に入れない（型だけ import している。実行時は利用者の印刷屋 zip の authoring API と計算式エンジンを読む）
 *   - tools の版と commit を __PCRAFT_TOOLS_META__ に埋める（version コマンドが出す）
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
// 前のビルドの残り（以前は dist/lib/ にエンジンを複写していた）を消す。npm pack は dist/** を全部入れるので、古いファイルが残っていると配布物に入る
rmSync(path.join(root, "dist"), { recursive: true, force: true });
const { devMeta } = await import(pathToFileURL(path.join(root, "src", "meta.ts")).href);
const { kitRoot, rexgridRoot, PRINT_CRAFT_ROOT } = await import(pathToFileURL(path.join(root, "src", "paths.ts")).href);

const meta = { ...devMeta(), builtAt: new Date().toISOString(), mode: "build" };
const banner = `#!/usr/bin/env node\n/*! @rex0220/print-craft-authoring-tools ${meta.toolsVersion} (c) rex0220. MIT License. 計算式エンジンと印刷屋のコードは利用者の印刷屋プラグインの zip から読む（このファイルには含まれない）。commit ${meta.commit}. */`;
const result = await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile: path.join(root, "dist", "cli.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  charset: "utf8",
  legalComments: "none",
  external: ["happy-dom"],
  banner: { js: banner },
  define: { __PCRAFT_TOOLS_META__: JSON.stringify(JSON.stringify(meta)) },
  // 型だけの import が残っていればここで解決される（実行コードには入らない）。入っていないことを下で確かめる
  alias: { "print-craft": PRINT_CRAFT_ROOT, "plugin-config-kit": kitRoot(), rexgrid: rexgridRoot() },
  absWorkingDir: root,
  metafile: true,
  logLevel: "warning"
});
const inputs = Object.keys(result.metafile.inputs);
const leaked = inputs.filter((p) => /print-craft[\\/](src|lib|prod)[\\/]|plugin-config-kit[\\/]src|rexgrid[\\/]src/.test(p));
if (leaked.length) {
  console.error(`印刷屋 / kit / rexgrid のコードが bundle に入っている（型だけの import にする）:\n  ${leaked.join("\n  ")}`);
  process.exit(1);
}
// 作った bundle が起動するか（1-10 の後に、ソースの shebang と banner の shebang が重なって構文エラーになったことがある）
const smoke = spawnSync(process.execPath, [path.join(root, "dist", "cli.mjs"), "help"], { encoding: "utf8" });
if (smoke.status !== 0 || !/使い方: pcraft-authoring/.test(smoke.stdout)) {
  console.error(`dist/cli.mjs が起動しない（exit ${smoke.status}）:\n${smoke.stderr}`);
  process.exit(1);
}
const size = readFileSync(path.join(root, "dist", "cli.mjs")).length;
console.log(`wrote dist/cli.mjs (${size.toLocaleString()} bytes; tools ${meta.toolsVersion}, commit ${meta.commit}; ${inputs.length} inputs, 印刷屋 / kit のコードは含まない, help が起動する)`);
