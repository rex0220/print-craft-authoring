/**
 * 印刷屋 Ver.7 の zip（print-craft の dist/print-craft-plugin7.zip。authoring API 2）を読めるか（tools 1.1.0。docs/authoring-plan.md 12.18）。
 * loadEngine は 1 プロセスに 1 回だけ読むので、Ver.6 の zip を読む engine.test.mjs とは別のファイルにする。zip が無ければ飛ばす（print-craft が Ver.7 より前）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINT_CRAFT_ROOT } from "../src/paths.ts";

const ZIP7 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin7.zip");
const skip = existsSync(ZIP7) ? false : `print-craft の Ver.7 の zip が無い: ${ZIP7}`;
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("Ver.7 の zip: 版 7、API 2、プラグイン ID は印刷屋。webFontPageCss があり、buildReportCss は Ver.6 と同じ形", { skip }, async () => {
  const { loadEngine } = await import("../src/engine.ts");
  const engine = await loadEngine({ pluginZip: ZIP7 });
  assert.equal(engine.source.kind, "zip");
  assert.equal(engine.source.pluginVersion, "7");
  assert.equal(engine.source.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.deepEqual(engine.warnings, []);
  assert.equal(engine.api.apiVersion, 2);
  assert.equal(engine.api.pluginVersion, "7");
  assert.equal(typeof engine.api.webFontPageCss, "function");
  const font = engine.api.webFontOf({ enabled: true, preset: "noto-sans-jp" });
  assert.match(engine.api.webFontPageCss(font), /\.rex0220-pcraft-page \{\n {2}font-family: "Noto Sans JP", sans-serif;/);
  const row = { tagsInfo: { fieldsInfo: [] } };
  const css = engine.api.buildReportCss({ commonCssEnable: false, cssInfo: [] }, row, { width: 794, height: 1123 }, font);
  assert.ok(css.includes('font-family: "Noto Sans JP", sans-serif;'), "ページの基本 CSS の書体");
  assert.ok(!css.includes("rex0220-print-craft-web-font"), "置き換えの規則は buildReportCss に入らない（印刷屋が読み込めたときに帳票の HTML の後ろに置く）");
  assert.equal(engine.runner({}, {}).dq("1 + 2"), 3, "計算式エンジンが動く");
});

test("Ver.6 で作った設定（PluginVersion 6）を Ver.7 の zip で normalize: エラーにせず情報を出し、書き出す封筒は 7", { skip }, async () => {
  const { loadEngine } = await import("../src/engine.ts");
  const { normalizeSettings } = await import("../src/commands/normalize.ts");
  const { FIELDS_FILE, aiSettings } = await import("./fixtures.mjs");
  const engine = await loadEngine({ pluginZip: ZIP7 });
  const r = await normalizeSettings({ settingsText: JSON.stringify(aiSettings({ PluginVersion: "6" })), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, engine, now: () => new Date(2026, 9, 8, 12, 0, 0) });
  const errors = r.findings.items.filter((x) => x.level === "error");
  assert.deepEqual(errors, [], r.findings.format());
  assert.ok(r.findings.items.some((x) => x.level === "info" && x.rule === "envelope.version.upgrade"));
  assert.equal(r.output.PluginVersion, "7");
});

test("version --expect 7: Ver.7 の zip なら 0", { skip }, () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));
  const r = spawnSync(process.execPath, ["--no-warnings", CLI, "version", "--expect", "7"], { encoding: "utf8", env: { ...env, PCRAFT_PLUGIN_ZIP: ZIP7 }, cwd: path.dirname(CLI) });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /印刷屋プラグイン: 版 7、authoring API 2/);
  assert.match(r.stdout, /--expect 7: 一致/);
});
