/**
 * 一覧帳票の描画（tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.2、T2）: listRecords を渡すと、印刷屋と同じく先頭のレコードを基点にし、
 * $records に全部を選んだ順に入れて描く（エンジンの RECS_* が読む）。渡さなければ今までどおり対象外。
 *   - docs/samples の一覧帳票（RECS_HTML、15 件ずつ、合計欄あり）は、お試しアプリ list の 1・14 件で 1 ページ、15・25 件で 2 ページ、30 件で 3 ページ
 *     （RECS_HTML の perPage は合計欄の行も数える。15 件ちょうどだと、2 ページ目は見出しと合計欄だけ。最後のページが明細でいっぱいなら合計欄を次に送る普通の形）
 *   - 選んだ順のまま（RECS_MAP）、$id やシステム項目を落とさない
 *   - 一覧帳票で関連レコード一覧（親のコード・親$子）を使う設定は検査で止まる（印刷屋の relatedUsageErrors）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
import { tryApp, withCount } from "../src/try-apps/index.ts";
import { previewInChild } from "../src/worker/evaluator.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(here, "..", "..", "docs", "samples");
const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;
const ev = { pluginZip: ZIP9 };
const policy = { allowExternal: [] };
const list = tryApp("list");
const LIST_SETTINGS = readFileSync(path.join(SAMPLES, "一覧帳票", "settings.json"), "utf8");
const wrap = (app, record) => ({ tool: "pcraft-authoring try-app", fetchedAt: "", baseUrl: "https://example.cybozu.com", appId: app.fields.appId, id: 1, record });
const preview = (settingsText, records, app = list) => previewInChild(ev, { settingsText, fields: app.fields, recordFile: wrap(app, records[0]), policy, listRecords: records.map((r) => wrap(app, r)) });

/** 一覧帳票のボタン 1 つの設定（HTML 欄は空、計算式でページを作る） */
function listButton(app, formulaSet) {
  return JSON.stringify({
    date: "2026-10-20 12:00:00", pluginName: "印刷屋プラグイン", pluginID: "rex0220 Print craft plugin", PluginVersion: "9", appId: app.fields.appId, appName: app.fields.appName,
    pluginEnable: true, commonCssEnable: false, externalRefs: "block",
    pluginInfos: [{
      state: true, menu: "一覧", desc: "", list: true, viewsCsv: "",
      tagsInfo: { fieldsInfo: [{ state: false, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: "" }, { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: '"一覧.pdf"' }, { state: true, desc: "一覧", css: "", html: "", formulaSet }], filecode: "", pageSize: "A4", orientation: "p", dpi: "96" },
      calcInfo: { fieldsInfo: [] }
    }]
  });
}

test("docs/samples の一覧帳票（15 件ずつ、合計欄あり）: 1・14 件で 1 ページ、15・25 件で 2 ページ、30 件で 3 ページ。式のエラー 0", { skip }, async () => {
  for (const [n, pages] of [[1, 1], [14, 1], [15, 2], [25, 2], [30, 3]]) {
    const r = await preview(LIST_SETTINGS, withCount(list, n));
    assert.deepEqual(r.findings.items.filter((f) => f.level === "error"), [], r.findings.format());
    assert.deepEqual(r.skipped, []);
    assert.equal(r.results.length, 1);
    assert.deepEqual([r.results[0].pages, r.results[0].errors], [pages, []], `${n} 件`);
  }
  // 15 件ちょうど: 2 ページ目は見出しと合計欄だけ（perPage は合計欄の行も数える）
  const r15 = await preview(LIST_SETTINGS, withCount(list, 15));
  const last = r15.results[0].inner.split('class="rex0220-pcraft-page').at(-1);
  assert.match(last, /\(2\/2\)/);
  assert.doesNotMatch(last, /顧客名 \d+/, "2 ページ目に明細の行が無い");
});

test("$records は選んだ順のまま、$id とシステム項目を落とさない（RECS_MAP）", { skip }, async () => {
  const recs = withCount(list, 5).reverse();
  const r = await preview(listButton(list, `CONCAT("<div class='rex0220-pcraft-page'>", JOIN(RECS_MAP(レコード番号), ","), "|", JOIN(RECS_MAP($id), ","), "|", JOIN(RECS_MAP(更新日時), ","), "</div>")`), recs);
  assert.deepEqual(r.results[0].errors, []);
  assert.match(r.results[0].inner, /5,4,3,2,1\|1005,1004,1003,1002,1001\|/);
});

test("listRecords を渡さなければ、一覧帳票は今までどおり対象外（1 レコードのプレビュー）", { skip }, async () => {
  const r = await previewInChild(ev, { settingsText: LIST_SETTINGS, fields: list.fields, recordFile: wrap(list, withCount(list, 1)[0]), policy });
  assert.equal(r.results.length, 0);
  assert.match(r.skipped[0], /一覧帳票は 1 レコードのプレビューの対象外/);
});

test("一覧帳票で関連レコード一覧（親のコード・親$子）を使う設定は検査で止まり、描かない（印刷屋の relatedUsageErrors）", { skip }, async () => {
  const gantt = tryApp("gantt");
  const rec = { ...structuredClone(gantt.records[0]) };
  for (const f of [`CONCAT("<div class='rex0220-pcraft-page'>", COUNTROW(task_list), "</div>")`, `CONCAT("<div class='rex0220-pcraft-page'>", JOIN(RECS_MAP(task_list$task_name), ","), "</div>")`]) {
    const r = await preview(listButton(gantt, f), [rec], gantt);
    assert.ok(r.findings.items.some((x) => x.level === "error"), `${f}: ${r.findings.format()}`);
    assert.equal(r.results.length, 0, "描かない");
  }
});
