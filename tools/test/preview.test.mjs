/** preview: 行単位のレンダラー（失敗しても続ける）、ページ番号とダミー画像、sandbox の iframe + CSP、一覧帳票は対象外、--button */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "./helpers.mjs";
import { runPreview, extractRecord } from "../src/commands/preview.ts";
import { PREVIEW_CSP, escapeHtml } from "../src/preview/render.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const engine = await loadEngine();
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
  発行済み: v("CHECK_BOX", []),
  見積明細: v("SUBTABLE", [
    { id: "1", value: { 商品名: v("SINGLE_LINE_TEXT", "kintone ワイドコース"), 数量: v("NUMBER", "1"), 単価: v("NUMBER", "3000000"), 金額: v("CALC", "3000000") } },
    { id: "2", value: { 商品名: v("SINGLE_LINE_TEXT", "セキュアアクセス <script>x</script>"), 数量: v("NUMBER", "1000"), 単価: v("NUMBER", "250"), 金額: v("CALC", "250000") } }
  ])
};
const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 3740, id: 3, record: RECORD };
const run = (settings, extra = {}) => runPreview({ settingsText: JSON.stringify(settings), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, recordFile, engine, ...extra });

test("見積書のプレビュー: 1 ページ、sandbox の iframe、CSP、テーブルと値、##table## は置き換わる", async () => {
  const r = await run(aiSettings());
  assert.ok(!r.findings.hasErrors, r.findings.format());
  assert.equal(r.results.length, 1);
  const b = r.results[0];
  assert.equal(b.menu, "見積書");
  assert.equal(b.pages, 1);
  assert.deepEqual(b.errors, []);
  assert.equal(b.fileName, "見積書-S-0000003.pdf");
  assert.equal(b.file, "見積書.html");
  assert.ok(b.html.includes('<iframe sandbox="" '), "sandbox 属性だけの iframe");
  assert.ok(b.html.includes(`srcdoc="${escapeHtml("<!doctype html>")}`), "帳票は srcdoc");
  assert.ok(b.inner.includes(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`));
  assert.ok(b.inner.includes("□□□□株式会社 &lt;b&gt;&amp;"), "ESC_HTML の差し込み");
  assert.ok(b.inner.includes("kintone ワイドコース"), "TABLE_HTML の行");
  assert.ok(b.inner.includes("pcraft-inv-item-"), "TABLE_HTML の pref");
  assert.ok(!b.inner.includes("##table##"));
  assert.ok(b.inner.includes("rex0220-print-craft-page-css"), "印刷屋と同じページの基本 CSS");
  assert.ok(b.inner.includes("width: 794px"), "A4 96 dpi の幅");
  assert.match(r.summary, /プレビュー 1 件/);
});

test("ページ番号と添付ファイルの画像の置き換えタグ、\\ → &yen;", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  row.html = row.html.replace("##table##", '<p class="pn">#{&p} / #{&n}</p><img class="seal" width="10" src="#{&f(ABCDEF)}">##table## C:\\dir');
  const r = await run(s);
  const b = r.results[0];
  assert.deepEqual(b.errors, []);
  assert.ok(b.inner.includes('<p class="pn">1 / 1</p>'));
  assert.ok(/<img class="seal" width="10" src="data:image\/svg\+xml,/.test(b.inner), "ダミー画像");
  assert.ok(b.inner.includes("C:¥dir") || b.inner.includes("C:&yen;dir"));
});

test("式の失敗は赤字で埋めて続け、エラーに記録する", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  row.html = row.html.replace("見積書</div>", '見積書 ${NOFUNC(1)}</div><p>${ESC_HTML(宛名)}</p>');
  const r = await run(s);
  const b = r.results[0];
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0], /\$\{NOFUNC\(1\)\}/);
  assert.ok(b.inner.includes('<span class="pcraft-authoring-error">式のエラー: ${NOFUNC(1)}'));
  assert.ok(b.inner.includes("kintone ワイドコース"), "他の部分は描けている");
  assert.ok(b.html.includes('<ul class="errors">'));
});

test("一覧帳票は対象外、--button で絞る、設定にエラーがあれば描かない", async () => {
  const s = aiSettings();
  s.pluginInfos.push({ ...JSON.parse(JSON.stringify(s.pluginInfos[0])), menu: "一覧", list: true });
  const r = await run(s);
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.skipped, ["一覧: 一覧帳票は 1 レコードのプレビューの対象外（段階 2）"]);
  const only = await run(s, { button: "見積書" });
  assert.equal(only.results.length, 1);
  const none = await run(s, { button: "無い" });
  assert.equal(none.results.length, 0);
  assert.ok(none.findings.items.some((f) => f.rule === "preview.button"));
  const bad = aiSettings({ PluginVersion: "5" });
  const rb = await run(bad);
  assert.ok(rb.findings.hasErrors);
  assert.equal(rb.results.length, 0);
});

test("extractRecord: record コマンドの出力、API の応答、レコードそのもの", () => {
  assert.equal(extractRecord(recordFile), RECORD);
  assert.equal(extractRecord({ record: RECORD }), RECORD);
  assert.equal(extractRecord(RECORD), RECORD);
  assert.throws(() => extractRecord({ foo: 1 }));
  assert.throws(() => extractRecord(null));
});
