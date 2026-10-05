/** fields / record コマンドの中身（偽のクライアントで）: 保存する JSON の形、要約、--fields-from の絞り方 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchFields, summarizeFields } from "../src/commands/fields.ts";
import { fetchRecord, identifiersOf, missingInRecord, narrowRecord, summarizeRecord, usedFieldCodes } from "../src/commands/record.ts";

const PROPERTIES = {
  宛名: { type: "SINGLE_LINE_TEXT", code: "宛名", label: "宛名" },
  見積ファイル: { type: "FILE", code: "見積ファイル", label: "見積ファイル" },
  見積明細: { type: "SUBTABLE", code: "見積明細", label: "見積明細", fields: { 商品名: { type: "SINGLE_LINE_TEXT", code: "商品名", label: "商品名" }, 金額: { type: "CALC", code: "金額", label: "金額" } } }
};
const LAYOUT = [{ type: "ROW", fields: [{ type: "SINGLE_LINE_TEXT", code: "宛名" }] }, { type: "SUBTABLE", code: "見積明細", fields: [{ type: "SINGLE_LINE_TEXT", code: "商品名" }] }];

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

test("fields: app / fields / layout を取って 1 つの JSON に。--preview で preview の API", async () => {
  const c = fakeClient({ app: { appId: "3740", name: "見積書(印刷屋)" }, "app/form/fields": { properties: PROPERTIES, revision: "12" }, "app/form/layout": { layout: LAYOUT, revision: "12" } });
  const file = await fetchFields(c, { app: 3740, now: () => new Date("2026-10-04T00:00:00Z") });
  assert.equal(file.appId, 3740);
  assert.equal(file.appName, "見積書(印刷屋)");
  assert.equal(file.preview, false);
  assert.equal(file.lang, "ja");
  assert.equal(file.revision, "12");
  assert.deepEqual(Object.keys(file.properties), ["宛名", "見積ファイル", "見積明細"]);
  assert.equal(file.layout.length, 2);
  assert.deepEqual(c.calls.map((x) => x.api), ["app", "app/form/fields", "app/form/layout"]);
  assert.deepEqual(c.calls[1].params, { app: 3740, lang: "ja" });
  assert.match(summarizeFields(file), /項目 3/);
  assert.match(summarizeFields(file), /テーブル 見積明細: 商品名, 金額/);

  const p = fakeClient({ app: { appId: "3740", name: "x" }, "preview/app/form/fields": { properties: {}, revision: "1" }, "preview/app/form/layout": { layout: [], revision: "1" } });
  const pf = await fetchFields(p, { app: 3740, preview: true, lang: "en", guestSpaceId: 7 });
  assert.equal(pf.preview, true);
  assert.equal(pf.guestSpaceId, 7);
  assert.deepEqual(p.calls.map((x) => [x.api, x.guest]), [["app", 7], ["preview/app/form/fields", 7], ["preview/app/form/layout", 7]]);
});

const RECORD = {
  $id: { type: "RECORD_NUMBER", value: "1" },
  $revision: { type: "__REVISION__", value: "3" },
  宛名: { type: "SINGLE_LINE_TEXT", value: "A 社" },
  電話: { type: "SINGLE_LINE_TEXT", value: "090" },
  見積ファイル: { type: "FILE", value: [] },
  見積明細: { type: "SUBTABLE", value: [{ id: "10", value: { 商品名: { type: "SINGLE_LINE_TEXT", value: "p" }, 金額: { type: "CALC", value: "1" }, メモ: { type: "SINGLE_LINE_TEXT", value: "秘密" } } }] },
  他テーブル: { type: "SUBTABLE", value: [{ id: "11", value: { x: { type: "NUMBER", value: "1" } } }] }
};

test("usedFieldCodes: usedFields・更新項目・filecode から集める。無ければ null", () => {
  const settings = {
    usedFields: { 宛名: 1, 見積明細: 5 },
    pluginInfos: [
      { tagsInfo: { filecode: "見積ファイル", fieldsInfo: [{ usedFields: { 商品名: 2, $html: 1 } }] }, calcInfo: { fieldsInfo: [{ state: true, fieldcode: "$out" }, { state: true, fieldcode: "ダミー", usedFields: { 金額: 1 } }, { state: false, fieldcode: "使わない" }] } }
    ]
  };
  assert.deepEqual([...usedFieldCodes(settings)].sort(), ["ダミー", "商品名", "宛名", "見積ファイル", "見積明細", "金額"]);
  assert.equal(usedFieldCodes({ pluginInfos: [{ tagsInfo: { fieldsInfo: [{}] } }] }), null);
  assert.equal(usedFieldCodes(null), null);
});

test("usedFieldCodes: HTML 欄の ${式} と計算式の本文の語も拾う（usedFields は計算式欄だけ。2026-10-06）。文字列の中身は拾わない", () => {
  assert.deepEqual(identifiersOf('DATE_FORMAT(見積日, "YYYY年M月D日") & 担当者.name'), ["DATE_FORMAT", "見積日", "担当者", "name"]);
  assert.deepEqual(identifiersOf('REPLACE(ESC_HTML(備考), NEWLINE(), "<br>")'), ["REPLACE", "ESC_HTML", "備考", "NEWLINE"]);
  // 正規化済み: usedFields に HTML の ${式} の項目が無い（印刷屋の保存形と同じ）
  const normalized = {
    pluginInfos: [{ tagsInfo: { filecode: "", fieldsInfo: [
      { formula: "", usedFields: {} },
      { formula: '"見積書-" & 見積番号 & ".pdf"', usedFields: { 見積番号: 1 } },
      { html: '<p>${ESC_HTML(宛名)} 御中</p><p>${FVAL(合計)}</p><p>${DATE_FORMAT(見積日, "YYYY年M月D日")}</p>##table##', formula: 'LET(t, TABLE_HTML(見積明細, 商品名), REPLACE($html, "##table##", t))', usedFields: { 見積明細: 5, 商品名: 2, $html: 1 } }
    ] } }]
  };
  const codes = usedFieldCodes(normalized);
  for (const c of ["見積番号", "宛名", "合計", "見積日", "見積明細", "商品名"]) assert.ok(codes.has(c), c);
  assert.ok(!codes.has("YYYY年M月D日"), "文字列の中身は拾わない");
  assert.ok(!codes.has("$html"));
  // 正規化の前（usedFields なし、formulaSet だけ）でも計算式の項目を拾う
  const source = { pluginInfos: [{ tagsInfo: { fieldsInfo: [{ formulaSet: "// 保存先が空のとき\nNOT(見積ファイル)" }] }, calcInfo: { fieldsInfo: [{ state: true, fieldcode: "発行済み", formulaSet: '"済" & 担当者' }] } }] };
  const s2 = usedFieldCodes(source);
  for (const c of ["見積ファイル", "発行済み", "担当者"]) assert.ok(s2.has(c), c);
});

test("missingInRecord: 設定が使う項目のうちレコードに無いもの（fields にある項目だけ。テーブルの子も）", () => {
  const fields = { properties: {
    宛名: { type: "SINGLE_LINE_TEXT", code: "宛名", label: "宛名" },
    合計: { type: "CALC", code: "合計", label: "合計" },
    見積明細: { type: "SUBTABLE", code: "見積明細", label: "見積明細", fields: { 商品名: { type: "SINGLE_LINE_TEXT", code: "商品名", label: "商品名" }, 金額: { type: "CALC", code: "金額", label: "金額" } } }
  } };
  const settings = { pluginInfos: [{ tagsInfo: { fieldsInfo: [{ html: "${ESC_HTML(宛名)} ${FVAL(合計)}", formula: "TABLE_HTML(見積明細, 商品名, 金額)", usedFields: { 見積明細: 3, 商品名: 1, 金額: 1 } }] } }] };
  const full = { 宛名: { type: "SINGLE_LINE_TEXT", value: "A" }, 合計: { type: "CALC", value: "1" }, 見積明細: { type: "SUBTABLE", value: [{ value: { 商品名: { type: "SINGLE_LINE_TEXT", value: "p" }, 金額: { type: "CALC", value: "1" } } }] } };
  assert.deepEqual(missingInRecord(settings, fields, full), []);
  const narrow = { 見積明細: { type: "SUBTABLE", value: [{ value: { 商品名: { type: "SINGLE_LINE_TEXT", value: "p" } } }] } };
  assert.deepEqual(missingInRecord(settings, fields, narrow), ["宛名", "合計", "見積明細.金額"]);
  // テーブルの行が 0 なら子は分からないので言わない
  assert.deepEqual(missingInRecord(settings, fields, { ...full, 見積明細: { type: "SUBTABLE", value: [] } }), []);
});

test("narrowRecord: 使う項目と $id / $revision だけ。テーブルは子を絞る、テーブル自身を使えば全部", () => {
  const a = narrowRecord(RECORD, new Set(["宛名", "商品名"]));
  assert.deepEqual(Object.keys(a.record), ["$id", "$revision", "宛名", "見積明細"]);
  assert.deepEqual(Object.keys(a.record.見積明細.value[0].value), ["商品名"]);
  assert.equal(a.record.見積明細.value[0].id, "10");
  assert.deepEqual(a.kept, ["宛名", "見積明細(商品名)"]);
  const b = narrowRecord(RECORD, new Set(["見積明細"]));
  assert.deepEqual(Object.keys(b.record.見積明細.value[0].value), ["商品名", "金額", "メモ"]);
  assert.deepEqual(b.kept, ["見積明細"]);
});

test("record: /k/v1/record を取り、keep があれば絞って keptFields を書く。要約に値は出ない", async () => {
  const c = fakeClient({ record: { record: RECORD } });
  const file = await fetchRecord(c, { app: 3740, id: 1, keep: new Set(["宛名", "見積明細"]), now: () => new Date("2026-10-04T00:00:00Z") });
  assert.deepEqual(c.calls, [{ api: "record", params: { app: 3740, id: 1 }, guest: undefined }]);
  assert.deepEqual(Object.keys(file.record), ["$id", "$revision", "宛名", "見積明細"]);
  assert.deepEqual(file.keptFields, ["宛名", "見積明細"]);
  const s = summarizeRecord(file);
  assert.match(s, /項目 4/);
  assert.match(s, /見積明細 1 行/);
  assert.ok(!s.includes("A 社") && !s.includes("秘密"));
  const all = await fetchRecord(c, { app: 3740, id: 1 });
  assert.equal(all.keptFields, undefined);
  assert.equal(Object.keys(all.record).length, 7);
});
