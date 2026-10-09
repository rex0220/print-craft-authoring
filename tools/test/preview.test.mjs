/** preview: 行単位のレンダラー（失敗しても続ける）、ページ番号とダミー画像、sandbox の iframe + CSP、一覧帳票は対象外、--button */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "./helpers.mjs";
import { runPreview, extractRecord } from "../src/commands/preview.ts";
import { InputError } from "../src/commands/normalize.ts";
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
  assert.ok(b.inner.includes("font-size: 16px; line-height: 1.5;"), "kintone の body と同じ文字の設定（line-height が無いと BIZ UD などで行が詰まる）");
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

test("preview の文書は閉じている: CSS の </style> で抜けられない、レコードの値の <a href> / <meta> / on* / <iframe> は外す、img-src は data: だけ", async () => {
  const s = aiSettings({ cssInfo: [{ state: true, name: "x", desc: "", css: '.a{color:red} </style><meta http-equiv="refresh" content="0;url=https://evil.example/"><style>.b{content:"<"}' }] });
  const rec = JSON.parse(JSON.stringify(recordFile));
  rec.record.見積明細.value[0].value.商品名.value = '<a href="https://evil.example/">link</a><img src="x" onerror="alert(1)"><meta http-equiv="refresh" content="0;url=https://evil.example/"><iframe src="https://evil.example/"></iframe><style></style><meta></style><span onclick="x()">t</span><a href="#top">in</a>';
  const r = await run(s, { recordFile: rec });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  const inner = r.results[0].inner;
  assert.ok(!inner.includes("</style><meta"), "CSS から </style> で抜けられない");
  assert.ok(inner.includes("\\3c /style>") || inner.includes("\\3c /style&gt;"), "CSS の < はエスケープ");
  assert.ok(!/<meta http-equiv="refresh"/.test(inner), "meta refresh は外す");
  assert.ok(!/<iframe/.test(inner.replace(/<iframe sandbox=""/g, "")), "帳票の中の iframe は外す");
  assert.ok(!/onerror=|onclick=/.test(inner), "イベント属性は外す");
  assert.ok(!/href="https:\/\/evil/.test(inner), "外部へのリンクは外す");
  assert.ok(inner.includes('href="#top"'), "文書内のリンクは残る");
  assert.ok(inner.includes(">link</a>") && inner.includes("in</a>"), "リンクの文字は残る");
  assert.ok(!PREVIEW_CSP.includes("blob:"));
  assert.match(PREVIEW_CSP, /img-src data:;/);
});

test("Web フォント: 承認済み（Google Fonts は既定）なら帳票の文書に <link> と CSP の配信元、未承認なら読まない（OS の書体）、policy で承認すれば読む", async () => {
  const google = aiSettings({ fontInfo: { enabled: true, preset: "biz-udpmincho", family: "BIZ UDPMincho", cssUrl: "https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&display=swap" } });
  const r = await run(google);
  assert.ok(!r.findings.hasErrors, r.findings.format());
  const b = r.results[0];
  assert.equal(b.webFont, "https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&display=swap");
  assert.ok(b.inner.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&amp;display=swap">'), "帳票の文書に <link>");
  assert.ok(b.inner.includes("style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.googleapis.com https://fonts.gstatic.com;"), "CSP に CSS とフォント本体の配信元");
  assert.ok(b.inner.includes('"BIZ UDPMincho"'), "ページの CSS に font-family");
  assert.ok(b.html.includes("承認済み") && b.html.includes("BIZ UDPMincho"), "ヘッダーの注記");
  assert.ok(!b.inner.includes("connect-src 'self'") && b.inner.includes("connect-src 'none'"), "通信の許可はフォントだけ");
  // 未承認の配信元 → 読まない（normalize は警告 external.url。preview は止まらない）
  const other = aiSettings({ fontInfo: { enabled: true, preset: "custom", family: "My Font", cssUrl: "https://fonts.example.com/my.css" } });
  const r2 = await run(other);
  assert.ok(!r2.findings.hasErrors, r2.findings.format());
  assert.ok(r2.findings.items.some((f) => f.rule === "external.url"));
  const b2 = r2.results[0];
  assert.equal(b2.webFont, null);
  assert.ok(!b2.inner.includes("<link"), "未承認は <link> を入れない");
  assert.ok(b2.inner.includes(`content="${PREVIEW_CSP}"`), "CSP は基本のまま");
  assert.ok(b2.html.includes("未承認"), "ヘッダーの注記");
  // policy で承認 → 読む（その他の配信元は CSS とフォント本体に同じ origin）
  const r3 = await run(other, { policy: { allowExternal: [{ origin: "https://fonts.example.com" }] } });
  const b3 = r3.results[0];
  assert.equal(b3.webFont, "https://fonts.example.com/my.css");
  assert.ok(b3.inner.includes('<link rel="stylesheet" href="https://fonts.example.com/my.css">'));
  assert.ok(b3.inner.includes("style-src 'unsafe-inline' https://fonts.example.com; font-src data: https://fonts.example.com;"));
  // Web フォント無し → <link> も配信元も無し
  const none = await run(aiSettings());
  assert.equal(none.results[0].webFont, null);
  assert.ok(!none.results[0].inner.includes("<link") && none.results[0].html.includes("Web フォントは使いません"));
});

test("extractRecord: record コマンドの出力、API の応答、レコードそのもの", () => {
  assert.equal(extractRecord(recordFile), RECORD);
  assert.equal(extractRecord({ record: RECORD }), RECORD);
  assert.equal(extractRecord(RECORD), RECORD);
  assert.throws(() => extractRecord({ foo: 1 }), (e) => e instanceof InputError && /形が分からない/.test(e.message), "入力の誤り（決まった文）");
  assert.throws(() => extractRecord(null), InputError);
});

test("検査でエラーがある設定は描かない（例外で止まらず findings のエラーを返す。不正な用紙の大きさ）", async () => {
  const base = aiSettings();
  const r = await run({ ...base, pluginInfos: [{ ...base.pluginInfos[0], tagsInfo: { ...base.pluginInfos[0].tagsInfo, pageSize: "X9" } }] });
  assert.ok(r.findings.hasErrors);
  assert.ok(r.findings.items.some((f) => f.level === "error" && /pageSize/.test(f.rule)));
  assert.deepEqual(r.results, []);
});
