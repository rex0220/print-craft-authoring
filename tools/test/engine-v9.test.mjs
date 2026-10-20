/**
 * 印刷屋 Ver.9 の zip（print-craft の dist/print-craft-plugin9.zip。authoring API 3）: 計算式エンジンを計算式プラグイン Ver.102 と同じ版に、
 * decimal.js（desktop_js/rex0220_decimal.min.js）を同梱（print-craft の docs/ver9-plan.md）。tools 2.2.0 は zip に decimal があれば
 * bignumber の次・エンジンの前に読む（無い Ver.8 までの zip は今までどおり）。loadEngine は 1 プロセスに 1 回だけ読むので、他の版の zip を読むテストとは別のファイル。zip が無ければ飛ばす。
 *   - 版 9、decimal の SHA-256 が zip の中のファイルと同じ、warning なし
 *   - M_* / R_*（decimal）、小数の指数、MEDIAN などの関数、0 / false、エラーの文（入れ子でも頭に Error: を重ねない）、getCount
 *   - normalize → preview で M_* / R_* の式が通る
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
import { readPluginZip } from "../src/plugin-zip.ts";

const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;

const v = (type, value) => ({ type, value });
const FIELDS9 = {
  tool: "pcraft-authoring fields", fetchedAt: "2026-10-20T00:00:00.000Z", baseUrl: "https://x.cybozu.com", appId: 4200, appName: "確かめ", preview: false, lang: "ja", revision: "1",
  properties: { 金額: { type: "NUMBER", code: "金額", label: "金額" }, 名前: { type: "SINGLE_LINE_TEXT", code: "名前", label: "名前" } },
  layout: [{ type: "ROW", fields: [{ type: "NUMBER", code: "金額" }, { type: "SINGLE_LINE_TEXT", code: "名前" }] }]
};
const HTML = '<div class="rex0220-pcraft-page"><p>${ESC_HTML(M_SIN(1))}</p><p>${ESC_HTML(R_PMT(0.01, 12, 金額))}</p>##rest##</div>';
const FORMULA = 'REPLACE($html, "##rest##", CONCAT(ESC_HTML(M_LOG(100)), " / ", ESC_HTML(2**0.5), " / ", MEDIAN(1, 3, 2), " / ", LET(a, 0, a)))';

function settingsOf(engine, { html = HTML, formula = FORMULA } = {}) {
  return {
    date: "2026-10-20 10:00:00", pluginName: "印刷屋プラグイン", pluginID: engine.api.pluginId, PluginVersion: "9", appId: 4200, appName: "確かめ",
    pluginEnable: true, commonCssEnable: false, externalRefs: "block",
    pluginInfos: [
      {
        state: true, menu: "確かめ", desc: "", list: false, viewsCsv: "-",
        tagsInfo: {
          fieldsInfo: [
            { state: false, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: "" },
            { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: '"確かめ-" & 名前 & ".pdf"' },
            { state: true, desc: "本文", css: "", html, formulaSet: formula }
          ],
          filecode: "", pageSize: "A4", orientation: "p", dpi: "96", printMode: "preview"
        },
        calcInfo: { fieldsInfo: [] }
      }
    ]
  };
}

const engineP = skip ? null : import("../src/engine.ts").then(({ loadEngine }) => loadEngine({ pluginZip: ZIP9 }));

test("Ver.9 の zip: 版 9、API 3、プラグイン ID は印刷屋。decimal.js を読み、その SHA-256 は zip の中のファイルと同じ。warning なし", { skip }, async () => {
  const engine = await engineP;
  assert.equal(engine.source.pluginVersion, "9");
  assert.equal(engine.source.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.equal(engine.api.apiVersion, 3);
  assert.deepEqual(engine.warnings, []);
  const zip = readPluginZip(ZIP9);
  assert.ok(zip.decimal && zip.sha256.decimal, "zip に desktop_js/rex0220_decimal.min.js がある");
  assert.equal(engine.source.decimalSha256, zip.sha256.decimal);
  assert.equal(engine.source.engineSha256, zip.sha256.engine);
});

test("Ver.9 のエンジン: M_* / R_*（decimal.js）、小数の指数、MEDIAN など、変数の 0 / false、入れ子のエラーの文、getCount", { skip }, async () => {
  const engine = await engineP;
  const kf = engine.runner({}, {});
  const ev = (f) => { try { return kf.dq(f); } catch (e) { return `ERR ${String(e?.message ?? e)}`; } };
  assert.equal(ev("M_SIN(1)"), "0.84147098480789650665");
  assert.equal(ev("M_LOG(100)"), 2);
  assert.equal(ev("R_PMT(0.01, 12, 100000)"), "-8884.87886783417073399878312279");
  assert.equal(ev("R_IPMT(0, 1, 12, 600000)"), 0, "利率 0（計算式プラグイン Ver.101 の直し）");
  assert.equal(ev("2**0.5"), "1.4142135623730950488");
  assert.equal(ev("MEDIAN(1, 3, 2)"), "2", "MEDIAN は文字列で返す");
  assert.equal(ev("LENGTH(UUID())"), 36);
  assert.equal(ev("LET(a, 0, a)"), 0, "変数の 0 は空にならない");
  assert.equal(ev('LET(a, 1=2, IF(a, "真", "偽"))'), "偽", "変数の false は偽");
  assert.equal(ev("LET(a, 1, ARRAY_FOR(2, k, zz))"), "ERR getVal FIELD CODE NOT FOUND: zz", "入れ子でも頭に Error: を重ねない（Ver.102）");
  assert.equal(typeof kf.getCount, "function", "評価回数を読む口（Ver.102）");
  kf.clearCount();
  kf.dq('JOIN(ARRAY_FOR(100, k, IF(k > 0, "a", "b")), "")');
  const c = kf.getCount(true);
  assert.ok(c.tree > 0 && c.val > 0, JSON.stringify(c));
  assert.equal(c.values, c.valuesActual, "連番の番号 = 値の表の大きさ");
  assert.equal(c.limit, 10000000);
});

test("normalize → preview: M_* / R_* と小数の指数を使う帳票が、エラー 0 で派生値を作り、preview の式のエラー 0", { skip }, async () => {
  const engine = await engineP;
  const { normalizeSettings } = await import("../src/commands/normalize.ts");
  const { runPreview } = await import("../src/commands/preview.ts");
  const n = await normalizeSettings({ settingsText: JSON.stringify(settingsOf(engine)), settingsFile: "settings/確かめ.json", fields: FIELDS9, engine, now: () => new Date(2026, 9, 20, 12, 0, 0) });
  assert.deepEqual(n.findings.items.filter((f) => f.level === "error").map((f) => f.rule), [], n.findings.format());
  const body = n.output.pluginInfos[0].tagsInfo.fieldsInfo[2];
  assert.equal(body.formula, FORMULA);
  const record = { $id: v("__ID__", "1"), $revision: v("__REVISION__", "1"), 金額: v("NUMBER", "100000"), 名前: v("SINGLE_LINE_TEXT", "a") };
  const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 4200, id: 1, record };
  const r = await runPreview({ settingsText: JSON.stringify(n.output), settingsFile: "settings/確かめ.json", fields: FIELDS9, recordFile, engine });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0].errors, []);
});

// docs/samples の設定のうち版 9 以下のもの（Ver.8 の印刷屋から取り出した五線譜・盤面図を含む）は、Ver.9 の zip でも preview が通る（関連レコード一覧の工程表は engine-v8.test.mjs）
const SAMPLES = path.resolve(PRINT_CRAFT_ROOT, "..", "print-craft-authoring", "docs", "samples");
const sampleDirs = existsSync(SAMPLES) ? readdirSync(SAMPLES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(SAMPLES, d.name)) : [];
for (const dir of sampleDirs) {
  if (!existsSync(path.join(dir, "record.json"))) continue;
  const fields = JSON.parse(readFileSync(path.join(dir, "fields.json"), "utf8"));
  if (fields.related) continue;
  for (const file of readdirSync(dir).filter((f) => /^settings(-[a-z]+)?\.json$/.test(f) && f !== "settings-source.json")) {
    test(`sample ${path.basename(dir)}/${file}: Ver.9 の zip で preview が通る（式のエラー 0）`, { skip }, async () => {
      const engine = await engineP;
      const { runPreview } = await import("../src/commands/preview.ts");
      const recordFile = JSON.parse(readFileSync(path.join(dir, "record.json"), "utf8"));
      const r = await runPreview({ settingsText: readFileSync(path.join(dir, file), "utf8"), fields, recordFile, engine });
      assert.ok(!r.findings.hasErrors, r.findings.format());
      assert.ok(r.results.length >= 1);
      for (const b of r.results) {
        assert.deepEqual(b.errors, [], `${b.menu} の式のエラー`);
        assert.ok(b.pages >= 1, `${b.menu} のページ`);
      }
    });
  }
}
