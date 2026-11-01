/**
 * 印刷屋 Ver.10 の zip（print-craft の dist/print-craft-plugin10.zip。authoring API は 3 のまま）: 一覧帳票の対象の共通設定
 * `listRecordScope`（`page` / `all`）が CONFIG_SCHEMA に入った（print-craft の docs/ver10-plan.md、docs/list-all-records-plan.md）。
 * API の版は変わらないので tools のコードの対応は要らない（print-craft の CLAUDE.md の 4 基準）。docs/schema-manifest.json はこの zip から作る。
 * loadEngine は 1 プロセスに 1 回しか読まないので、他の版の zip を読むテストとは別のファイル。zip が無ければ飛ばす。
 *   - 版 10、API 3、プラグイン ID は印刷屋、warning なし
 *   - CONFIG_SCHEMA の listRecordScope は任意の string(10)（仕様書とキー表の照合は spec-sync.test.mjs）
 *   - normalize は `all` / `page` / 知らない値をそのまま残す（印刷屋は知らない値を page として動かす）。古い zip が落とすことは engine-v9.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";

const ZIP10 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin10.zip");
const skip = existsSync(ZIP10) ? false : `print-craft の Ver.10 の zip が無い: ${ZIP10}`;

const FIELDS = {
  tool: "pcraft-authoring fields", fetchedAt: "2026-10-31T00:00:00.000Z", baseUrl: "https://x.cybozu.com", appId: 4200, appName: "確かめ", preview: false, lang: "ja", revision: "1",
  properties: { 金額: { type: "NUMBER", code: "金額", label: "金額" }, 名前: { type: "SINGLE_LINE_TEXT", code: "名前", label: "名前" } },
  layout: [{ type: "ROW", fields: [{ type: "NUMBER", code: "金額" }, { type: "SINGLE_LINE_TEXT", code: "名前" }] }]
};

/** 一覧帳票 1 つだけの設定（listRecordScope を渡さなければ書かない） */
function settingsOf(engine, scope) {
  return {
    date: "2026-10-31 10:00:00", pluginName: "印刷屋プラグイン", pluginID: engine.api.pluginId, PluginVersion: "10", appId: 4200, appName: "確かめ",
    pluginEnable: true, commonCssEnable: false, externalRefs: "block",
    ...(scope === undefined ? {} : { listRecordScope: scope }),
    pluginInfos: [
      {
        state: true, menu: "一覧の確かめ", desc: "", list: true, viewsCsv: "",
        tagsInfo: {
          fieldsInfo: [
            { state: false, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: "" },
            { state: false, desc: "ファイル名", fieldcode: "$fname", formulaSet: "" },
            { state: true, desc: "本文", css: "", html: "", formulaSet: 'RECS_HTML(OPT("pagination", "Y", "perPage", "28", "maxPages", "36"), ARRAY("#", $rseq + 1), 名前, ARRAY("金額", YEN(金額), "value-right"))' }
          ],
          filecode: "", pageSize: "A4", orientation: "l", dpi: "96", printMode: "preview"
        },
        calcInfo: { fieldsInfo: [] }
      }
    ]
  };
}

const engineP = skip ? null : import("../src/engine.ts").then(({ loadEngine }) => loadEngine({ pluginZip: ZIP10 }));

async function normalized(scope) {
  const engine = await engineP;
  const { normalizeSettings } = await import("../src/commands/normalize.ts");
  const n = await normalizeSettings({ settingsText: JSON.stringify(settingsOf(engine, scope)), settingsFile: "settings/確かめ.json", fields: FIELDS, engine, now: () => new Date(2026, 9, 31, 12, 0, 0) });
  assert.deepEqual(n.findings.items.filter((f) => f.level === "error").map((f) => f.rule), [], n.findings.format());
  return n.output;
}

test("Ver.10 の zip: 版 10、API 3、プラグイン ID は印刷屋、warning なし", { skip }, async () => {
  const engine = await engineP;
  assert.equal(engine.source.pluginVersion, "10");
  assert.equal(engine.source.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.equal(engine.api.apiVersion, 3);
  assert.deepEqual(engine.warnings, []);
});

test("CONFIG_SCHEMA の listRecordScope は任意の string(10)", { skip }, async () => {
  const engine = await engineP;
  const schema = engine.api.CONFIG_SCHEMA.props.listRecordScope;
  assert.equal(schema.type, "string");
  assert.equal(schema.maxLength, 10);
  assert.equal(schema.optional, true);
});

test("normalize は listRecordScope を残す（all / page / 知らない値）。書かなければ出力にも無い", { skip }, async () => {
  assert.equal((await normalized("all")).listRecordScope, "all");
  assert.equal((await normalized("page")).listRecordScope, "page");
  assert.equal((await normalized("xxx")).listRecordScope, "xxx", "知らない値はそのまま（印刷屋が page として動かす）");
  const out = await normalized(undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(out, "listRecordScope"), false, "書かなければ足さない（印刷屋の既定は page）");
});
