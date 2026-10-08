/**
 * 計算式エンジンと authoring API を利用者の zip（fixture: print-craft の dist zip）から読み、段階 0（docs/authoring-plan.md 11 章）と同じ結果を出すこと。
 * Node 22.6 以上（型の除去で src/*.ts を直接読む）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, PLUGIN_ZIP } from "./helpers.mjs";

const FIELDS = {
  宛名: { type: "SINGLE_LINE_TEXT", code: "宛名", label: "宛名" },
  見積番号: { type: "SINGLE_LINE_TEXT", code: "見積番号", label: "見積番号" },
  見積日: { type: "DATE", code: "見積日", label: "見積日" },
  小計金額: { type: "NUMBER", code: "小計金額", label: "小計金額", unit: "¥", unitPosition: "BEFORE", digit: true },
  消費税: { type: "NUMBER", code: "消費税", label: "消費税", unit: "¥", unitPosition: "BEFORE", digit: true },
  合計金額: { type: "NUMBER", code: "合計金額", label: "合計金額", unit: "¥", unitPosition: "BEFORE", digit: true },
  備考: { type: "MULTI_LINE_TEXT", code: "備考", label: "備考" },
  担当者: { type: "USER_SELECT", code: "担当者", label: "担当者" },
  見積ファイル: { type: "FILE", code: "見積ファイル", label: "見積ファイル" },
  見積明細: {
    type: "SUBTABLE", code: "見積明細", label: "見積明細",
    fields: {
      商品名: { type: "SINGLE_LINE_TEXT", code: "商品名", label: "商品名" },
      数量: { type: "NUMBER", code: "数量", label: "数量", digit: true },
      単価: { type: "NUMBER", code: "単価", label: "単価", unit: "¥", unitPosition: "BEFORE", digit: true },
      金額: { type: "CALC", code: "金額", label: "金額", expression: "数量*単価", format: "NUMBER_DIGIT", unit: "¥", unitPosition: "BEFORE" }
    }
  }
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const v = (type, value) => ({ type, value });
const RECORD = {
  $id: v("RECORD_NUMBER", "3"),
  $revision: v("__REVISION__", "7"),
  宛名: v("SINGLE_LINE_TEXT", '□□□□株式会社 <b>&"\'</b>'),
  見積番号: v("SINGLE_LINE_TEXT", "S-0000003"),
  見積日: v("DATE", "2026-02-12"),
  小計金額: v("NUMBER", "7994000"),
  消費税: v("NUMBER", "799400"),
  合計金額: v("NUMBER", "8793400"),
  備考: v("MULTI_LINE_TEXT", "月額費用のお見積りです。<b>太字</b>\n合計3,000ユーザー"),
  担当者: v("USER_SELECT", [{ code: "authoring", name: "authoring" }]),
  見積ファイル: v("FILE", []),
  見積明細: v("SUBTABLE", [
    { id: "1", value: { 商品名: v("SINGLE_LINE_TEXT", "kintone ワイドコース"), 数量: v("NUMBER", "1"), 単価: v("NUMBER", "3000000"), 金額: v("CALC", "3000000") } },
    { id: "2", value: { 商品名: v("SINGLE_LINE_TEXT", "セキュアアクセス <script>x</script>"), 数量: v("NUMBER", "1000"), 単価: v("NUMBER", "250"), 金額: v("CALC", "250000") } }
  ])
};
const QIITA_FORMULA = `LET(
  table, TABLE_HTML(見積明細,
    OPT("pref","pcraft-inv-item-"),
    ARRAY("#",ROWNO(見積明細)+1),
    商品名,数量,単価,金額
  ),
  html,$html,
  html,REPLACE(html, "##table##", table),
  html,REPLACE(html, "##備考##",  FVAL(備考)), // コメント
  html
)`;

const engine = await loadEngine();
const api = engine.api;
const ppCheck = { ...clone(FIELDS), $id: { type: "RECORD_NUMBER", code: "$id", label: "$id" }, $revision: { type: "__REVISION__", code: "$revision", label: "$revision" }, $html: { type: "MULTI_LINE_TEXT", code: "$html", label: "$html" } };
const crec = api.createCheckRecord(ppCheck);
const ppRun = api.expandFields(clone(FIELDS), "実行条件");
const check = (formulaSet) => {
  const kf = engine.checker(ppCheck, crec);
  kf.usedFields({});
  const result = kf.dq(api.stripComments(formulaSet));
  return { result, usedFields: kf.usedFields() };
};
const run = (formula) => engine.runner(ppRun, RECORD).dq(formula);

test("利用者の zip から読む: 版 6、API 1、プラグイン ID は印刷屋、関数表が 243 件", () => {
  assert.equal(engine.source.kind, "zip");
  assert.equal(engine.source.from, PLUGIN_ZIP);
  assert.equal(engine.source.pluginVersion, "6");
  assert.equal(engine.source.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.deepEqual(engine.warnings, []);
  assert.equal(api.apiVersion, 1);
  assert.equal(api.pluginVersion, "6");
  assert.equal(api.pluginId, "rex0220 Print craft plugin");
  assert.equal(engine.functionNames().length, 243);
  assert.ok(engine.functionNames().includes("TABLE_HTML"));
  assert.equal(typeof api.buildMenuRows, "function");
  assert.equal(typeof api.writeConfig, "function");
});

test("構文チェック + usedFields（段階 0 と同じ: Qiita の見積書の式）", () => {
  const { usedFields } = check(QIITA_FORMULA);
  assert.deepEqual(usedFields, { 見積明細: 5, 商品名: 2, 数量: 2, 単価: 2, 金額: 2, $html: 1, 備考: 1 });
});

test("UINFO は $UGO$ を記録し、pluginUOG が真になる", () => {
  const { usedFields } = check('UINFO(担当者, "name")');
  assert.deepEqual(usedFields, { $UGO$: 1, 担当者: 1 });
  assert.equal(api.computePluginUOG([{ state: true, calcInfo: { usedFields, fieldsInfo: [] } }]), true);
});

test("構文エラーは例外", () => {
  assert.throws(() => check('IF(合計金額 > 0, "a"'));
});

test("エスケープの実際（11 章の表）: ESC_HTML は & < > だけ、TAG の子は < > だけ、ATTR はしない", () => {
  assert.equal(run("ESC_HTML(宛名)"), '□□□□株式会社 &lt;b&gt;&amp;"\'&lt;/b&gt;');
  assert.equal(run('TAGS_HTML(TAG("p", 宛名))'), '<p>□□□□株式会社 &lt;b&gt;&"\'&lt;/b&gt;</p>');
  assert.ok(String(run('TAGS_HTML(TAG("p", ATTR("title", 宛名), "x"))')).includes('title="□□□□株式会社 <b>&"\'</b>"'));
  assert.ok(String(run("FVAL(備考)")).includes("<b>太字</b><br>"));
});

test("TABLE_HTML のセルはエスケープされない（レコードの値が HTML として入る）", () => {
  const html = String(run('TABLE_HTML(見積明細, OPT("pref","t-"), 商品名)'));
  assert.ok(html.includes("<script>x</script>"));
});

test("PAGE_HTML はページの class を付け、IMGSRC は置き換えタグを返す。API の getPaperSize / defaultCssRows", () => {
  assert.ok(String(run('PAGE_HTML(TAG("div", "x"))')).includes('class="rex0220-pcraft-page"'));
  assert.equal(typeof run("IMGSRC(見積ファイル)"), "string");
  assert.deepEqual(api.getPaperSize("A4", "p", 96).scr, { width: 794, height: 1123 });
  assert.deepEqual(api.defaultCssRows().map((r) => r.name), ["table", "card", "comm", "invoice"]);
});

test("setContext で APP_URL の元になる URL とアプリ番号が変わる", () => {
  engine.setContext({ baseUrl: "https://sample.cybozu.com/", appId: 3740 });
  assert.equal(globalThis.kintone.app.getId(), 3740);
  assert.equal(globalThis.kintone.api.url("/k/v1/record.json"), "https://sample.cybozu.com/k/v1/record.json");
});
