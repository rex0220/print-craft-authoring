/** pull: アプリのプラグインの設定（API ラボの GET）を設定画面のダウンロードと同じ封筒形式にする。プラグイン ID は zip の PUBKEY から（2026-10-05） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, PLUGIN_ZIP } from "./helpers.mjs";
import { readPluginZip, pluginIdOf } from "../src/plugin-zip.ts";
import { defaultPullName, pullSettings } from "../src/commands/pull.ts";
import { normalizeSettings, InputError } from "../src/commands/normalize.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const engine = await loadEngine();
/** 印刷屋の 5 変種のプラグイン ID（work-link/link-html の prod / trial / capdo / testc / china と同じ） */
const PRINT_CRAFT_ID = "lcapkanpjdabgphknkabojmcfhonhkhp";

function fakeClient(stored, revision = "12") {
  const calls = [];
  return {
    calls,
    baseUrl: "https://x.cybozu.com",
    async get(api, params, guestSpaceId) {
      calls.push([api, params, guestSpaceId]);
      if (api === "app") return { appId: String(params.id), name: "見積書(印刷屋)" };
      return { config: stored, revision };
    }
  };
}

/** 設定画面が保存した形（kit の writeConfig の圧縮形式 + shell の共通項目） */
async function savedConfig() {
  const r = await normalizeSettings({ settingsText: JSON.stringify(aiSettings()), settingsFile: "settings/a.json", fields: FIELDS_FILE, engine });
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...body } = r.output;
  const stored = await engine.api.writeConfig({ ...body, pluginLastUpdate: "2026-10-05 10:00:00", pluginUpdater: "佐藤", pluginProductEnv: true }, "compressed");
  return { body, stored };
}

test("プラグイン ID は zip の PUBKEY から（kintone の plugin-packer と同じ。印刷屋は 5 変種とも同じ ID）", () => {
  assert.equal(readPluginZip(PLUGIN_ZIP).pluginId, PRINT_CRAFT_ID);
  assert.equal(engine.source.pluginId, PRINT_CRAFT_ID);
  assert.match(pluginIdOf(Buffer.from("x")), /^[a-p]{32}$/);
});

test("pull: 運用中の設定を app/plugin/config（GET）で取り、readConfig → スキーマで検証 → 設定画面のダウンロードと同じ封筒形式。normalize --check で差なし", async () => {
  const { body, stored } = await savedConfig();
  assert.equal(stored.compress, "2", "印刷屋の保存形式（圧縮）");
  const c = fakeClient(stored);
  const r = await pullSettings(c, engine, { app: 3740, pluginId: PRINT_CRAFT_ID, now: () => new Date(2026, 9, 5, 11, 0, 0) });
  assert.deepEqual(c.calls, [["app", { id: 3740 }, undefined], ["app/plugin/config", { app: 3740, id: PRINT_CRAFT_ID }, undefined]]);
  assert.deepEqual([r.appName, r.revision, r.format], ["見積書(印刷屋)", "12", "compressed"]);
  const e = r.envelope;
  assert.deepEqual([e.date, e.pluginName, e.pluginID, e.PluginVersion, e.appId, e.appName], ["2026-10-05 11:00:00", "印刷屋プラグイン", "rex0220 Print craft plugin", "6", 3740, "見積書(印刷屋)"]);
  for (const k of ["pluginLastUpdate", "pluginUpdater", "pluginProductEnv"]) assert.equal(k in e, false, `保存のときの共通項目 ${k} は落とす（スキーマに無い）`);
  assert.deepEqual(e.pluginInfos, body.pluginInfos);
  const again = await normalizeSettings({ settingsText: JSON.stringify(e), settingsFile: "settings/見積書(印刷屋).json", fields: FIELDS_FILE, engine, check: true });
  assert.ok(!again.findings.hasErrors, again.findings.format());
  assert.deepEqual(again.checkDiffs, [], "取った設定の派生値は tools が作り直したものと同じ");
});

test("pull: --preview は動作テスト環境（preview/app/plugin/config）、ゲストスペースは guestSpaceId を渡す", async () => {
  const { stored } = await savedConfig();
  const c = fakeClient(stored);
  await pullSettings(c, engine, { app: 12, preview: true, guestSpaceId: 7, pluginId: PRINT_CRAFT_ID });
  assert.deepEqual(c.calls.map((x) => [x[0], x[2]]), [["app", 7], ["preview/app/plugin/config", 7]]);
});

test("pull: 設定が空、値が文字列でない、プラグイン ID の形が違うときは止まる", async () => {
  await assert.rejects(pullSettings(fakeClient({}), engine, { app: 1, pluginId: PRINT_CRAFT_ID }), (err) => err instanceof InputError && /設定が空/.test(err.message));
  await assert.rejects(pullSettings(fakeClient({ compress: 2 }), engine, { app: 1, pluginId: PRINT_CRAFT_ID }), (err) => err instanceof InputError && /文字列でない/.test(err.message));
  await assert.rejects(pullSettings(fakeClient({}), engine, { app: 1, pluginId: "abc" }), (err) => err instanceof InputError && /プラグイン ID の形/.test(err.message));
});

test("CLI pull: --app が無ければ使い方の誤り（2）", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));
  const r = spawnSync(process.execPath, ["--no-warnings", cli, "pull"], { encoding: "utf8", env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--app <数値> が要る/);
  assert.match(r.stderr, /pull --app N/, "使い方に pull がある");
});

test("pull: 既定の保存先は APP<番号>-<アプリ名>（使えない文字は _、アプリ名が空なら APP<番号>）", () => {
  assert.equal(defaultPullName("見積書(印刷屋)", 3740), "APP3740-見積書(印刷屋).json");
  assert.equal(defaultPullName("見積/請求", 5), "APP5-見積_請求.json");
  assert.equal(defaultPullName("", 5), "APP5.json");
});
