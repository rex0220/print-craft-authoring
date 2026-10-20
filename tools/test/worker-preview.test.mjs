/**
 * preview を子プロセスで（tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.6、T0c）:
 *   - previewInChild は、このプロセスの runPreview と同じ結果（findings、ボタンごとのページ・式のエラー・ファイル名・HTML）。pid は親と違う
 *   - Worker thread（Claude Desktop）でも同じ
 *   - 重い式（上限 1,000 万回に当たる。親で描くと約 35 秒）は時間の上限で止まる（子プロセスも Worker thread も）。メモリの上限は子プロセスで止まる
 *   - レコードの形の誤りは EvalError（kind input）、決まった文
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";
import { runPreview } from "../src/commands/preview.ts";
import { previewInChild } from "../src/worker/evaluator.ts";
import { EvalError, EvalMemoryError, EvalTimeoutError } from "../src/worker/run.ts";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";

const ZIP = process.env.PCRAFT_PLUGIN_ZIP;
const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip = ZIP && existsSync(ZIP) ? false : "テストの印刷屋の zip が無い";
const skip9 = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;
const v = (type, value) => ({ type, value });
const RECORD = {
  $id: v("RECORD_NUMBER", "3"),
  $revision: v("__REVISION__", "7"),
  宛名: v("SINGLE_LINE_TEXT", "□□□□株式会社"),
  見積番号: v("SINGLE_LINE_TEXT", "S-0000003"),
  見積日: v("DATE", "2026-02-12"),
  小計金額: v("NUMBER", "7994000"),
  消費税: v("NUMBER", "799400"),
  合計金額: v("NUMBER", "8793400"),
  備考: v("MULTI_LINE_TEXT", "月額費用のお見積りです。\n合計3,000ユーザー"),
  担当者: v("USER_SELECT", [{ code: "authoring", name: "authoring" }]),
  見積ファイル: v("FILE", []),
  発行済み: v("CHECK_BOX", []),
  見積明細: v("SUBTABLE", [
    { id: "1", value: { 商品名: v("SINGLE_LINE_TEXT", "kintone ワイドコース"), 数量: v("NUMBER", "1"), 単価: v("NUMBER", "3000000"), 金額: v("CALC", "3000000") } },
    { id: "2", value: { 商品名: v("SINGLE_LINE_TEXT", "セキュアアクセス"), 数量: v("NUMBER", "1000"), 単価: v("NUMBER", "250"), 金額: v("CALC", "250000") } }
  ])
};
const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 3740, id: 3, record: RECORD };
const input = (settings = aiSettings()) => ({ settingsText: JSON.stringify(settings), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, recordFile, policy: { allowExternal: [] }, baseUrl: "https://x.cybozu.com" });
const HEAVY = "ARRAY_COUNT(ARRAY_FOR(100000, i, ARRAY_COUNT(ARRAY_FOR(100000, j, i))))";
const heavySettings = () => {
  const s = aiSettings();
  s.pluginInfos[0].tagsInfo.fieldsInfo[2].formulaSet = HEAVY;
  return s;
};
const shape = (r) => r.results.map((b) => ({ menu: b.menu, file: b.file, fileName: b.fileName, pages: b.pages, errors: b.errors, html: b.html, inner: b.inner }));

test("previewInChild はこのプロセスの runPreview と同じ結果（findings・ページ・式のエラー・ファイル名・HTML）。pid は親と違う。Worker thread でも同じ", { skip }, async () => {
  const engine = await loadEngine();
  const local = await runPreview({ ...input(), engine });
  for (const isolation of ["process", "thread"]) {
    const child = await previewInChild({ pluginZip: ZIP, run: { isolation } }, input());
    assert.equal(child.diag.isolation, isolation);
    if (isolation === "process") assert.notEqual(child.diag.pid, process.pid);
    assert.deepEqual(child.findings.items, local.findings.items);
    assert.equal(child.summary, local.summary);
    assert.deepEqual(child.skipped, local.skipped);
    assert.deepEqual(shape(child), shape(local), isolation);
    assert.equal(child.results.length, 1);
    assert.equal(child.results[0].pages, 1);
  }
});

test("重い式は時間の上限で止まる（子プロセスも Worker thread も。親で描くと約 35 秒）。止めた後も次の呼び出しに答える（Ver.9 の zip）", { skip: skip9 }, async () => {
  for (const isolation of ["process", "thread"]) {
    const t0 = Date.now();
    await assert.rejects(previewInChild({ pluginZip: ZIP9, run: { isolation, timeoutSec: 1 } }, input(heavySettings())), (e) => e instanceof EvalTimeoutError, isolation);
    assert.ok(Date.now() - t0 < 10_000, `${isolation}: 止めるのが遅い（${Date.now() - t0} ms）`);
    const r = await previewInChild({ pluginZip: ZIP9, run: { isolation } }, input());
    assert.equal(r.results[0].pages, 1, isolation);
  }
});

test("メモリの上限: 子プロセスのヒープの上限を超える帳票の式は EvalMemoryError（親は落ちない。Ver.9 の zip）", { skip: skip9 }, async () => {
  const s = aiSettings();
  s.pluginInfos[0].tagsInfo.fieldsInfo[2].formulaSet = 'ARRAY_COUNT(ARRAY_FOR(30, j, ARRAY_FOR(100000, i, CONCAT("abcdefghij", i, j))))';
  await assert.rejects(previewInChild({ pluginZip: ZIP9, run: { isolation: "process", heapLimitMb: 64 } }, input(s)), (e) => e instanceof EvalMemoryError);
  const r = await previewInChild({ pluginZip: ZIP9 }, input());
  assert.equal(r.results[0].pages, 1);
});

test("レコードの形の誤りは EvalError（kind input）。文は中核の決まった文", { skip }, async () => {
  await assert.rejects(previewInChild({ pluginZip: ZIP }, { ...input(), recordFile: [1, 2] }), (e) => e instanceof EvalError && e.kind === "input" && /レコードの JSON/.test(e.message));
});
