/**
 * 印刷屋 Ver.8 の zip（print-craft の dist/print-craft-plugin8.zip。authoring API 3）: 関連レコード一覧（REFERENCE_TABLE）を帳票の計算式で使う
 * （print-craft の docs/related-records-spec.md 11 章）。loadEngine は 1 プロセスに 1 回だけ読むので、他の版の zip を読むテストとは別のファイル。zip が無ければ飛ばす。
 *   - fields: 参照先の項目定義を related に生で入れる（取れなければ relatedNotes）。要約は 親$子 で字下げ
 *   - normalize: 仮のテーブルの子を使う式が通る。1 行目・一覧用・FSET はエラー。related の無い fields で使えばエラー
 *   - record: 設定が使う子だけを fields に絞って /k/v1/records を取り、仮のテーブルとして入れる。上限超えはエラー
 *   - preview: 仮のテーブルの TABLE_HTML が描ける。レコードに無ければ警告
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";

const ZIP8 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin8.zip");
const skip = existsSync(ZIP8) ? false : `print-craft の Ver.8 の zip が無い: ${ZIP8}`;

const v = (type, value) => ({ type, value });
const OWN = {
  プロジェクト名: { type: "SINGLE_LINE_TEXT", code: "プロジェクト名", label: "プロジェクト名" },
  uuid: { type: "SINGLE_LINE_TEXT", code: "uuid", label: "UUID" },
  task_list: {
    type: "REFERENCE_TABLE", code: "task_list", label: "タスク一覧", noLabel: false,
    referenceTable: { relatedApp: { app: "4121", code: "" }, condition: { field: "uuid", relatedField: "project_id" }, filterCond: 'task_delete not in ("ON")', sort: "display_order asc", size: "5", displayFields: ["task_name"] }
  },
  no_perm: { type: "REFERENCE_TABLE", code: "no_perm", label: "権限なし", referenceTable: null },
  添付: { type: "FILE", code: "添付", label: "添付" }
};
const RELATED = {
  project_id: { type: "SINGLE_LINE_TEXT", code: "project_id", label: "プロジェクト ID" },
  task_name: { type: "SINGLE_LINE_TEXT", code: "task_name", label: "タスク名" },
  start_date: { type: "DATE", code: "start_date", label: "開始日" },
  progress: { type: "NUMBER", code: "progress", label: "進捗", digit: true },
  レコード番号: { type: "RECORD_NUMBER", code: "レコード番号", label: "レコード番号" },
  sub: { type: "SUBTABLE", code: "sub", label: "中のテーブル", fields: { x: { type: "NUMBER", code: "x", label: "x" } } }
};
const LAYOUT = [
  { type: "ROW", fields: [{ type: "SINGLE_LINE_TEXT", code: "プロジェクト名" }, { type: "SINGLE_LINE_TEXT", code: "uuid" }] },
  { type: "ROW", fields: [{ type: "REFERENCE_TABLE", code: "task_list" }] },
  { type: "ROW", fields: [{ type: "REFERENCE_TABLE", code: "no_perm" }] },
  { type: "ROW", fields: [{ type: "FILE", code: "添付" }] }
];
const FIELDS8 = {
  tool: "pcraft-authoring fields", fetchedAt: "2026-10-12T00:00:00.000Z", baseUrl: "https://x.cybozu.com", appId: 4120, appName: "プロジェクト", preview: false, lang: "ja", revision: "3",
  properties: OWN, layout: LAYOUT,
  related: { task_list: { app: 4121, appName: "タスク", revision: "9", properties: RELATED } },
  relatedNotes: ["no_perm: 参照先のアプリを参照する権限が無い（referenceTable が null。この関連レコード一覧は帳票の計算式で使えない）"]
};
const HTML = '<div class="rex0220-pcraft-page"><h1>${ESC_HTML(プロジェクト名)}</h1><p>タスク ${COUNTROW(task_list)} 件</p>##table##</div>';
const FORMULA = 'REPLACE($html, "##table##", TABLE_HTML(task_list, task_list$task_name, task_list$start_date, task_list$progress))';

function settingsOf(engine, { first = "", formula = FORMULA, html = HTML, list = false, calc = [] } = {}) {
  return {
    date: "2026-10-12 10:00:00", pluginName: "印刷屋プラグイン", pluginID: engine.api.pluginId, PluginVersion: "8", appId: 4120, appName: "プロジェクト",
    pluginEnable: true, commonCssEnable: false, externalRefs: "block",
    pluginInfos: [
      {
        state: true, menu: "工程表", desc: "", list,
        tagsInfo: {
          fieldsInfo: [
            { state: !!first, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: first },
            { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: '"工程表-" & プロジェクト名 & ".pdf"' },
            { state: true, desc: "本文", css: "", html, formulaSet: formula }
          ],
          filecode: "", pageSize: "A4", orientation: "p", dpi: "96", printMode: "preview"
        },
        calcInfo: { fieldsInfo: calc }
      }
    ]
  };
}

function fakeClient(responses) {
  const calls = [];
  return {
    baseUrl: "https://x.cybozu.com",
    calls,
    async get(api, params, guest) {
      calls.push({ api, params, guest });
      const r = responses[api];
      if (!r) throw new Error(`unexpected api ${api}`);
      return typeof r === "function" ? r(params) : r;
    }
  };
}

const taskRecords = (from, n) =>
  Array.from({ length: n }, (_, i) => {
    const id = from + i + 1;
    return { $id: v("__ID__", String(id)), project_id: v("SINGLE_LINE_TEXT", "abc"), task_name: v("SINGLE_LINE_TEXT", `タスク ${id} <b>`), start_date: v("DATE", "2026-10-01"), progress: v("NUMBER", String(id % 100)), レコード番号: v("RECORD_NUMBER", String(id)) };
  });

/** /k/v1/records の偽の応答（offset を見て 500 件ずつ。1 ページ目だけ totalCount） */
const recordsResponder = (total) => (params) => {
  const offset = Number(/offset (\d+)/.exec(params.query)[1]);
  const n = Math.max(0, Math.min(500, total - offset));
  // 偽のクライアントには真偽値のまま届く（本物の RestClient は URL で "true" にする）
  return { records: taskRecords(offset, n), ...(params.totalCount === true || params.totalCount === "true" ? { totalCount: String(total) } : {}) };
};

const engineP = skip ? null : import("../src/engine.ts").then(({ loadEngine }) => loadEngine({ pluginZip: ZIP8 }));

test("Ver.8 の zip: 版 8、API 3、プラグイン ID は印刷屋。関連レコード一覧の関数と定数がある（REQUIRED_API_V3）", { skip }, async () => {
  const engine = await engineP;
  assert.equal(engine.source.pluginVersion, "8");
  assert.equal(engine.source.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.deepEqual(engine.warnings, []);
  assert.equal(engine.api.apiVersion, 3);
  assert.equal(engine.api.RELATED_LIMIT, 1000);
  assert.equal(engine.api.RELATED_SEPARATOR, "$");
  for (const k of ["expandRelatedFields", "makeReportPp", "relatedChildrenUsedBy", "relatedUsageErrors", "relatedCondition", "fetchRelatedRecords", "toRelatedRows", "evaluate"]) assert.equal(typeof engine.api[k], "function", k);
  assert.equal(engine.runner({}, {}).dq("1 + 2"), 3);
});

test("fields: 関連レコード一覧の参照先の項目定義を related に生で入れる（運用環境、同じ lang）。参照先を取れなければ relatedNotes。要約は 親$子 で字下げ", { skip }, async () => {
  const { fetchFields, listFields, summarizeFields, referenceTablesOf } = await import("../src/commands/fields.ts");
  assert.deepEqual(referenceTablesOf(OWN), [{ code: "task_list", label: "タスク一覧", app: 4121 }, { code: "no_perm", label: "権限なし", app: null }]);
  const own = fakeClient({
    app: (p) => ({ appId: String(p.id), name: p.id === 4120 ? "プロジェクト" : "タスク" }),
    "app/form/fields": (p) => ({ properties: p.app === 4120 ? OWN : RELATED, revision: p.app === 4120 ? "3" : "9" }),
    "app/form/layout": { layout: LAYOUT, revision: "3" }
  });
  const file = await fetchFields(own, { app: 4120, now: () => new Date("2026-10-12T00:00:00Z") });
  assert.deepEqual(Object.keys(file.related), ["task_list"]);
  assert.deepEqual([file.related.task_list.app, file.related.task_list.appName, file.related.task_list.revision, Object.keys(file.related.task_list.properties)], [4121, "タスク", "9", Object.keys(RELATED)]);
  assert.deepEqual(own.calls.map((c) => [c.api, c.params.app ?? c.params.id]), [["app", 4120], ["app/form/fields", 4120], ["app/form/layout", 4120], ["app", 4121], ["app/form/fields", 4121]], "参照先は運用環境の fields を 1 回");
  assert.equal(own.calls[4].params.lang, "ja");
  assert.equal(file.relatedNotes.length, 1);
  assert.match(file.relatedNotes[0], /^no_perm: .*referenceTable が null/);
  // 参照先の接続が無い（tokenMap にトークンが無い）
  const noToken = await fetchFields(own, { app: 4120, relatedClientFor: () => { throw new Error("profile「dev」の tokenMap に APP4121 が無い"); } });
  assert.deepEqual(noToken.related, {});
  assert.ok(noToken.relatedNotes.some((n) => /^task_list: .*tokenMap に APP4121 が無い/.test(n)), noToken.relatedNotes.join("\n"));
  // 関連レコード一覧の無いアプリは related のキーを持たない
  const plain = fakeClient({ app: { appId: "1", name: "x" }, "app/form/fields": { properties: { a: OWN.uuid }, revision: "1" }, "app/form/layout": { layout: [], revision: "1" } });
  const pf = await fetchFields(plain, { app: 1 });
  assert.equal("related" in pf, false);
  const text = listFields(file);
  assert.match(text, /^task_list「タスク一覧」  REFERENCE_TABLE/m);
  assert.match(text, /→ 関連レコード（アプリ 4121 タスク）（条件 uuid = 参照先の project_id、絞り込み task_delete not in \("ON"\)、並び display_order asc）。計算式では task_list\$<参照先の項目コード>/);
  assert.match(text, /^ {2}task_list\$task_name「タスク名」  SINGLE_LINE_TEXT$/m);
  assert.match(text, /^ {2}task_list\$progress「進捗」  NUMBER（桁区切り）$/m);
  assert.ok(!text.includes("task_list$sub"), "参照先のテーブルは出さない");
  assert.match(text, /^no_perm「権限なし」  REFERENCE_TABLE\n {2}→ 関連レコード: 参照先の項目定義なし（参照先のアプリを参照する権限が無い/m);
  assert.match(summarizeFields(file), /関連レコード一覧 task_list: 参照先 アプリ 4121 タスク（項目 6）/);
  assert.match(summarizeFields(file), /注意: no_perm/);
});

test("normalize: 仮のテーブル（親$子）を使う式が通り、usedFields に親と子が入る。1 行目・一覧用・FSET はエラー。related の無い fields で使えば「fields を取り直す」", { skip }, async () => {
  const engine = await engineP;
  const { normalizeSettings } = await import("../src/commands/normalize.ts");
  const run = (settings, fields = FIELDS8) => normalizeSettings({ settingsText: JSON.stringify(settings), settingsFile: "settings/工程表.json", fields, engine, now: () => new Date(2026, 9, 12, 12, 0, 0) });
  const rules = (r, level) => r.findings.items.filter((f) => f.level === level).map((f) => f.rule);
  const ok = await run(settingsOf(engine));
  assert.deepEqual(rules(ok, "error"), [], ok.findings.format());
  const body = ok.output.pluginInfos[0].tagsInfo.fieldsInfo[2];
  assert.equal(body.usedFields.task_list >= 1, true);
  assert.deepEqual(Object.keys(body.usedFields).filter((k) => k.startsWith("task_list$")).sort(), ["task_list$progress", "task_list$start_date", "task_list$task_name"]);
  assert.deepEqual(ok.output.usedFields, {}, "ルートの usedFields は更新項目の分だけ（HTML 設定の分は入らない。設定画面と同じ）");
  const first = await run(settingsOf(engine, { first: "COUNTROW(task_list) > 0" }));
  assert.ok(rules(first, "error").includes("related.firstRow"), first.findings.format());
  const list = await run(settingsOf(engine, { list: true }));
  assert.ok(rules(list, "error").includes("related.listReport"), list.findings.format());
  const write = await run(settingsOf(engine, { formula: 'FSET(task_list$progress, 1) & $html' }));
  assert.ok(rules(write, "error").includes("related.write"), write.findings.format());
  const calc = await run(settingsOf(engine, { calc: [{ state: true, fieldcode: "$out", formulaSet: "task_list$progress > 1" }, { state: true, fieldcode: "プロジェクト名", formulaSet: '"x"' }] }));
  assert.ok(rules(calc, "error").includes("related.firstRow"), "更新条件も 1 行目");
  const { related: _r, relatedNotes: _n, ...noRelated } = FIELDS8;
  const stale = await run(settingsOf(engine), noRelated);
  assert.ok(rules(stale, "error").includes("related.fields"), stale.findings.format());
  const unused = await run(settingsOf(engine, { formula: "$html", html: '<div class="rex0220-pcraft-page">${ESC_HTML(プロジェクト名)}</div>' }), noRelated);
  assert.deepEqual(rules(unused, "error"), [], "関連レコード一覧を使わないボタンは related が無くてもよい");
});

test("record: 設定が使う子だけ fields に絞って /k/v1/records を 500 件ずつ取り、仮のテーブルとして入れる。裸の親コードは全項目。上限超えはエラー。--fields-from の絞りと両立", { skip }, async () => {
  const engine = await engineP;
  const { fetchRecord, relatedPlanOf, usedFieldCodes, relatedErrorText, missingInRecord } = await import("../src/commands/record.ts");
  const own = { $id: v("__ID__", "7"), $revision: v("__REVISION__", "2"), プロジェクト名: v("SINGLE_LINE_TEXT", "計画 A"), uuid: v("SINGLE_LINE_TEXT", 'ab"c'), 添付: v("FILE", []) };
  const client = fakeClient({ record: { record: own }, records: recordsResponder(3) });
  // 子だけを書いた式（TABLE_HTML(task_list, …) は第 1 引数が裸の親コードなので全項目になる）
  const settings = settingsOf(engine, { formula: "$html & SUM(task_list$progress)", html: '<div class="rex0220-pcraft-page">${task_list$task_name}</div>' });
  assert.deepEqual(relatedPlanOf(engine.api, FIELDS8, settings), [{ parent: "task_list", app: 4121, children: ["progress", "task_name"] }]);
  assert.deepEqual(relatedPlanOf(engine.api, FIELDS8), [{ parent: "task_list", app: 4121, children: "all" }], "設定が無ければ全項目");
  assert.deepEqual(relatedPlanOf(engine.api, FIELDS8, settingsOf(engine)), [{ parent: "task_list", app: 4121, children: "all" }], "COUNTROW(task_list) は裸の親コード → 全項目");
  const relatedFor = (c) => ({ api: engine.api, fields: FIELDS8, settings, clientFor: (app) => { assert.equal(app, 4121); return c; } });
  const related = relatedFor(client);
  const file = await fetchRecord(client, { app: 4120, id: 7, related, now: () => new Date("2026-10-12T00:00:00Z") });
  const q = client.calls.filter((c) => c.api === "records");
  assert.equal(q.length, 1);
  assert.equal(q[0].params.query, 'project_id = "ab\\"c" and (task_delete not in ("ON")) order by display_order asc limit 500 offset 0');
  assert.deepEqual([q[0].params["fields[0]"], q[0].params["fields[1]"], q[0].params["fields[2]"], q[0].params.totalCount], ["$id", "task_name", "progress", true]);
  assert.deepEqual(file.relatedTables, { task_list: { app: 4121, rows: 3, children: ["progress", "task_name"] } }, "子は式に出た順");
  assert.equal(file.record.task_list.type, "SUBTABLE");
  assert.deepEqual(file.record.task_list.value[0], { id: "1", value: { "task_list$task_name": v("SINGLE_LINE_TEXT", "タスク 1 <b>"), "task_list$progress": v("NUMBER", "1") } });
  assert.deepEqual(missingInRecord(settings, FIELDS8, file.record), []);
  assert.deepEqual(missingInRecord(settings, FIELDS8, own), ["task_list"], "関連レコードを取っていないレコード");
  // --fields-from で絞っても仮のテーブルは残る（子は使うものだけ）
  const keep = usedFieldCodes(settings);
  const c2 = fakeClient({ record: { record: own }, records: recordsResponder(2) });
  const narrowed = await fetchRecord(c2, { app: 4120, id: 7, keep, related: relatedFor(c2) });
  assert.ok(narrowed.keptFields.some((k) => k.startsWith("task_list(")), narrowed.keptFields.join());
  assert.equal(narrowed.record.task_list.value.length, 2);
  assert.equal(narrowed.record.uuid, undefined, "条件の項目は帳票の式に無いので絞られる（関連レコードは絞る前に取る）");
  // 条件の値が空なら取らない
  const c3 = fakeClient({ record: { record: { ...own, uuid: v("SINGLE_LINE_TEXT", "") } }, records: () => { throw new Error("呼ばれない"); } });
  const empty = await fetchRecord(c3, { app: 4120, id: 7, related: relatedFor(c3) });
  assert.deepEqual(empty.record.task_list, { type: "SUBTABLE", value: [] });
  // 上限超え
  const c4 = fakeClient({ record: { record: own }, records: recordsResponder(1001) });
  await assert.rejects(fetchRecord(c4, { app: 4120, id: 7, related: relatedFor(c4) }), /関連レコード一覧 task_list の参照先のレコードが 1001 件あり、上限（1000 件）を超えている/);
  assert.equal(relatedErrorText(new Error("x")), null);
  // 1,000 件は 2 ページ
  const big = fakeClient({ record: { record: own }, records: recordsResponder(1000) });
  const bigFile = await fetchRecord(big, { app: 4120, id: 7, related: relatedFor(big) });
  assert.equal(bigFile.record.task_list.value.length, 1000);
  assert.deepEqual(big.calls.filter((c) => c.api === "records").map((c) => c.params.totalCount), [true, false]);
});

test("preview: 仮のテーブルの TABLE_HTML を描ける（式のエラー 0）。レコードに関連レコードが無ければ警告", { skip }, async () => {
  const engine = await engineP;
  const { runPreview } = await import("../src/commands/preview.ts");
  const rows = taskRecords(0, 2).map((r) => ({ id: r.$id.value, value: { "task_list$task_name": r.task_name, "task_list$start_date": r.start_date, "task_list$progress": r.progress } }));
  const record = { $id: v("__ID__", "7"), $revision: v("__REVISION__", "2"), プロジェクト名: v("SINGLE_LINE_TEXT", "計画 A"), uuid: v("SINGLE_LINE_TEXT", "abc"), 添付: v("FILE", []), task_list: v("SUBTABLE", rows) };
  const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 4120, id: 7, relatedTables: { task_list: { app: 4121, rows: 2, children: "all" } }, record };
  const r = await runPreview({ settingsText: JSON.stringify(settingsOf(engine)), settingsFile: "settings/工程表.json", fields: FIELDS8, recordFile, engine });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.results[0].errors, []);
  assert.equal(r.results[0].pages, 1);
  assert.ok(!r.findings.items.some((f) => f.rule === "preview.record"), r.findings.format());
  const { task_list: _t, ...noRelated } = record;
  const r2 = await runPreview({ settingsText: JSON.stringify(settingsOf(engine)), settingsFile: "settings/工程表.json", fields: FIELDS8, recordFile: { ...recordFile, record: noRelated }, engine });
  const warn = r2.findings.items.find((f) => f.rule === "preview.record");
  assert.ok(warn && warn.message.includes("task_list"), r2.findings.format());
});

test("docs/samples/工程表（関連レコード一覧のサンプル）: settings-source → normalize はエラー 0 で settings.json と一致、合成のレコードで preview が 2 ページ・式のエラー 0", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  const { REPO_ROOT } = await import("../src/paths.ts");
  const { normalizeSettings, jsonDiff } = await import("../src/commands/normalize.ts");
  const { runPreview } = await import("../src/commands/preview.ts");
  const engine = await engineP;
  const dir = path.join(REPO_ROOT, "docs", "samples", "工程表");
  const fields = JSON.parse(readFileSync(path.join(dir, "fields.json"), "utf8"));
  const r = await normalizeSettings({ settingsText: readFileSync(path.join(dir, "settings-source.json"), "utf8"), settingsFile: "docs/samples/工程表/settings-source.json", fields, engine });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  const committed = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"));
  const diffs = [];
  const strip = ({ date, ...rest }) => rest;
  jsonDiff(strip(committed), strip(r.output), "$", diffs);
  assert.deepEqual(diffs, [], "settings.json が settings-source.json の正規化結果と違う（normalize をやり直してコミット）");
  const recordFile = JSON.parse(readFileSync(path.join(dir, "record.json"), "utf8"));
  const p = await runPreview({ settingsText: JSON.stringify(committed), fields, recordFile, engine });
  assert.ok(!p.findings.hasErrors, p.findings.format());
  assert.equal(p.results.length, 1);
  assert.deepEqual(p.results[0].errors, []);
  assert.equal(p.results[0].pages, 2, "30 タスク = 1 ページ目 24 行 + 2 ページ目 6 行");
});

test("Ver.8 の zip には decimal.js が無い: decimalSha256 なし、M_SIN は検査で「not available」のエラーになり、Ver.9 から使えることを添える（Ver.9 は engine-v9.test.mjs）", { skip }, async () => {
  const engine = await engineP;
  assert.equal(engine.source.decimalSha256, undefined);
  const { runPreview } = await import("../src/commands/preview.ts");
  const record = { $id: v("__ID__", "7"), $revision: v("__REVISION__", "2"), プロジェクト名: v("SINGLE_LINE_TEXT", "計画 A"), uuid: v("SINGLE_LINE_TEXT", "abc"), 添付: v("FILE", []), task_list: v("SUBTABLE", []) };
  const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 4120, id: 7, record };
  const settings = settingsOf(engine, { html: '<div class="rex0220-pcraft-page">##m##</div>', formula: 'REPLACE($html, "##m##", ESC_HTML(M_SIN(1)))' });
  const r = await runPreview({ settingsText: JSON.stringify(settings), settingsFile: "settings/工程表.json", fields: FIELDS8, recordFile, engine });
  // preview の前の検査（normalize）が式を評価して止める。原因（Ver.9 から）を添える
  const err = r.findings.items.find((f) => f.level === "error" && f.rule === "formula.syntax");
  assert.ok(err && err.message.includes("M_SIN() is not available.") && err.message.includes("印刷屋 Ver.9 から使える"), r.findings.format());
  assert.deepEqual(r.results, [], "検査のエラーで描かない");
});

test("Ver.8 の zip の preview: HTML の ${…} の M_SIN は検査を通り（HTML の ${…} は検査で評価しない）、式のエラーに Ver.9 から使えることを添えられる（4.4。renderErrorHint）。try の式も同じ", { skip }, async () => {
  const engine = await engineP;
  const { runPreview } = await import("../src/commands/preview.ts");
  const { renderErrorHint } = await import("../src/normalize/derive.ts");
  const record = { $id: v("__ID__", "7"), $revision: v("__REVISION__", "2"), プロジェクト名: v("SINGLE_LINE_TEXT", "計画 A"), uuid: v("SINGLE_LINE_TEXT", "abc"), 添付: v("FILE", []), task_list: v("SUBTABLE", []) };
  const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 4120, id: 7, record };
  const settings = settingsOf(engine, { html: '<div class="rex0220-pcraft-page">${M_SIN(1)} ${R_PMT(0.01, 12, 100000)}</div>', formula: "" });
  const r = await runPreview({ settingsText: JSON.stringify(settings), settingsFile: "settings/工程表.json", fields: FIELDS8, recordFile, engine });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  assert.deepEqual(r.results[0].errors, ["HTML 設定 3 行目 ${M_SIN(1)}: M_SIN() is not available.", "HTML 設定 3 行目 ${R_PMT(0.01, 12, 100000)}: R_PMT() is not available."]);
  assert.deepEqual(r.results[0].errors.map((e) => renderErrorHint(e, engine.source.pluginVersion)), ["M_SIN() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.8）", "R_PMT() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.8）"]);

  const { tryInChild } = await import("../src/worker/evaluator.ts");
  const t = await tryInChild({ pluginZip: ZIP8 }, { records: [1], formulas: [{ formula: "M_SIN(1)" }] });
  assert.equal(t.result.formulas[0].values[0].evaluationError, "M_SIN() is not available.（M_SIN() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.8））");
});
