/** normalize: 派生値の生成（設定画面と同じ）、更新項目の行の再構成、検査、往復（--check）、出力の封筒 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEngine } from "../src/engine.ts";
import { PRINT_CRAFT_ROOT } from "../src/paths.ts";
import { normalizeSettings, PLUGIN_ID, jsonDiff } from "../src/commands/normalize.ts";
import { FIELDS_FILE, aiSettings, HTML_TEMPLATE } from "./fixtures.mjs";

const engine = await loadEngine();
const run = (settings, extra = {}) => normalizeSettings({ settingsText: JSON.stringify(settings), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, engine, pluginVersion: "6", now: () => new Date(2026, 9, 4, 12, 0, 0), ...extra });
const rules = (r, level) => r.findings.items.filter((f) => f.level === level).map((f) => f.rule);

test("PLUGIN_ID は print-craft の設定画面の PLUGIN_ID_NAME と同じ", () => {
  const main = readFileSync(path.join(PRINT_CRAFT_ROOT, "src", "config", "main.ts"), "utf8");
  assert.ok(main.includes(`"${PLUGIN_ID}"`));
});

test("AI が書いた形から派生値を生成する（formula / usedFields / id / views / ルートの usedFields / pluginUOG）", async () => {
  const r = await run(aiSettings());
  assert.deepEqual(rules(r, "error"), []);
  assert.ok(r.output, "エラーが無いので出力がある");
  const row = r.output.pluginInfos[0];
  assert.equal(row.id, 1);
  assert.deepEqual(row.views, {});
  const tags = row.tagsInfo.fieldsInfo;
  assert.deepEqual(tags.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(tags[0].usedFields, { 見積ファイル: 1 });
  assert.equal(tags[0].formula, "NOT(見積ファイル)");
  assert.deepEqual(tags[1].usedFields, { 見積番号: 1 });
  assert.deepEqual(tags[2].usedFields, { 見積明細: 5, 商品名: 2, 数量: 2, 単価: 2, 金額: 2, $html: 1, 備考: 1 });
  assert.ok(!tags[2].formula.includes("// 複数行"), "formula はコメントを除いたもの");
  assert.equal(row.tagsInfo.printMode, "confirm");
  assert.deepEqual(r.output.usedFields, {});
  assert.equal(r.output.pluginUOG, false);
  // 封筒
  assert.equal(r.output.pluginID, PLUGIN_ID);
  assert.equal(r.output.PluginVersion, "6");
  assert.equal(r.output.appId, 3740);
  assert.equal(r.output.date, "2026-10-04 12:00:00");
  // 既定値が埋まる
  assert.equal(r.output.cssInfo.length, 4);
  assert.deepEqual(r.output.guestsInfo, []);
  assert.ok(r.output.menuInfo);
});

test("更新項目の行は AI の行だけを残し、メタデータを fields + layout の一覧で上書きする（設定画面の「未使用を除く」の後の形）", async () => {
  const r = await run(aiSettings());
  const calc = r.output.pluginInfos[0].calcInfo;
  const codes = calc.fieldsInfo.map((c) => c.fieldcode);
  assert.deepEqual(codes, ["$out", "発行済み"], "一覧にあって入力に無い項目は足さない");
  const issued = calc.fieldsInfo[1];
  assert.equal(issued.state, true);
  assert.equal(issued.type, "CHECK_BOX");
  assert.equal(issued.fieldlabel, "発行済み");
  assert.equal(issued.row_type, "グループ", "グループの中の行は row_type がグループのコード");
  assert.equal(issued.remark, "発行したら印を付ける");
  assert.equal(issued.formula, 'ARRAY("済")');
  assert.equal(calc.fieldsInfo[0].type, "BOOL");
  assert.equal(calc.fieldsInfo[0].row_type, "更新条件");
  // 更新項目を設定していないボタン（[]）は [] のまま
  const s = aiSettings();
  s.pluginInfos[0].calcInfo = { fieldsInfo: [] };
  const r2 = await run(s);
  assert.deepEqual(r2.output.pluginInfos[0].calcInfo, { fieldsInfo: [], usedFields: {}, flinkage: false });
  assert.deepEqual(calc.fieldsInfo.map((c) => c.id), calc.fieldsInfo.map((_, i) => i + 1));
  assert.equal(calc.flinkage, false);
  assert.deepEqual(calc.usedFields, {});
});

test("往復: 正規化した出力をもう一度正規化しても変わらない（--check の差 0）", async () => {
  const first = await run(aiSettings());
  const second = await run(first.output, { check: true });
  assert.deepEqual(second.checkDiffs, []);
  const diffs = [];
  jsonDiff(stripEnvelope(first.output), stripEnvelope(second.output), "$", diffs);
  assert.deepEqual(diffs, []);
});

function stripEnvelope(o) {
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...rest } = o;
  return rest;
}

test("警告と情報: FVAL の生の差し込み、生の HTML を入れる関数、保存値の大きさ", async () => {
  const r = await run(aiSettings());
  const w = rules(r, "warning");
  assert.ok(w.includes("html.rawExpression"), "${FVAL(…)} は ESC_HTML を通していない");
  assert.ok(w.includes("formula.rawHtml"), "TABLE_HTML / REPLACE … の生の HTML");
  assert.ok(rules(r, "info").includes("size"));
  assert.ok(r.size.ok);
  assert.ok(r.size.totalBytes > 1000 && r.size.totalBytes < 262144);
});

test("封筒の誤りは止まる: pluginID、PluginVersion、JSON でない", async () => {
  assert.deepEqual(rules(await run(aiSettings({ pluginID: "other" })), "error"), ["envelope.pluginID"]);
  assert.deepEqual(rules(await run(aiSettings({ PluginVersion: "5" })), "error"), ["envelope.version"]);
  const bad = await normalizeSettings({ settingsText: "{", fields: FIELDS_FILE, engine, pluginVersion: "6" });
  assert.deepEqual(rules(bad, "error"), ["json"]);
  const noEnvelope = await run({ pluginEnable: true, pluginInfos: [] });
  assert.ok(rules(noEnvelope, "error").includes("envelope.pluginID"));
});

test("検査: 列挙、保存先、更新項目にできない項目、無い項目、構文エラー", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0];
  row.tagsInfo.pageSize = "A7";
  row.tagsInfo.dpi = "72";
  row.tagsInfo.printMode = "now";
  row.tagsInfo.filecode = "宛名";
  row.tagsInfo.fieldsInfo[0].formulaSet = "NOT(見積ファイル";
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "金額", formulaSet: "1" });
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "見積ファイル", formulaSet: "1" });
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "存在しない", formulaSet: "1" });
  const r = await run(s);
  const e = r.findings.items.filter((f) => f.level === "error");
  const by = (rule) => e.filter((f) => f.rule === rule).map((f) => f.message);
  assert.match(by("tags.pageSize")[0], /A7/);
  assert.match(by("tags.dpi")[0], /72/);
  assert.match(by("tags.printMode")[0], /now/);
  assert.match(by("tags.filecode")[0], /添付ファイル項目/);
  assert.match(by("formula.syntax")[0], /評価できない/);
  assert.equal(by("calc.ineligible").length, 3);
  assert.match(by("calc.ineligible").find((m) => m.includes("金額")), /テーブル 見積明細 の中/);
  assert.match(by("calc.ineligible").find((m) => m.includes("見積ファイル")), /更新できない型/);
  assert.match(by("calc.ineligible").find((m) => m.includes("存在しない")), /fields に無い/);
  assert.equal(r.output, undefined, "エラーがあれば書き出さない");
});

test("検査: HTML の危険な書き方はエラー、外部 URL は警告（policy で許せば情報）、同一オリジンの iframe は許す", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0];
  row.tagsInfo.fieldsInfo[2].html = HTML_TEMPLATE.replace("##table##", `<script>alert(1)</script><p title="\${宛名}" onclick="x()">x</p><img src="https://cdn.example.com/seal.png"><iframe src="https://x.cybozu.com/k/3740/report/portlet?report=1"></iframe><iframe src="https://evil.example.com/"></iframe>##table##`);
  const r = await run(s);
  const msgs = r.findings.items.filter((f) => f.rule === "html.rule" && f.level === "error").map((f) => f.message);
  assert.ok(msgs.some((m) => m.includes("<script>")));
  assert.ok(msgs.some((m) => m.includes("onclick")));
  assert.ok(msgs.some((m) => m.includes("${式}")));
  assert.equal(msgs.filter((m) => m.includes("iframe")).length, 1, "他のオリジンの iframe だけエラー");
  assert.ok(r.findings.items.some((f) => f.rule === "external.url" && f.level === "warning" && f.message.includes("cdn.example.com")));
  // policy で許す
  const ok = await run(s, { policy: { allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/見積書.json"] }] } });
  assert.ok(ok.findings.items.some((f) => f.rule === "external.allowed" && f.level === "info"));
  assert.ok(!ok.findings.items.some((f) => f.rule === "external.url"));
  // files が違えば許さない
  const other = await run(s, { policy: { allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/other.json"] }] } });
  assert.ok(other.findings.items.some((f) => f.rule === "external.url"));
});

test("検査: CSS の @import と使えない URL、共通 CSS、Web フォントの URL", async () => {
  const s = aiSettings({ cssInfo: [{ state: true, name: "x", desc: "", css: "@import url(https://evil.example.com/a.css); .a{background:url(javascript:alert(1))}" }], fontInfo: { enabled: true, preset: "other", family: "F", cssUrl: "https://fonts.googleapis.com/css2?family=F" } });
  const r = await run(s);
  const css = r.findings.items.filter((f) => f.rule === "css.rule");
  assert.ok(css.some((f) => f.message.includes("@import")));
  assert.ok(css.some((f) => f.message.includes("使えない形")));
  assert.ok(r.findings.items.some((f) => f.rule === "external.allowed" && f.where === "Web フォント"), "Google Fonts は既定で許す");
});
