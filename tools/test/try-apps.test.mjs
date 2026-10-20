/**
 * お試しアプリ（src/try-apps/。tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.1、T1）:
 *   - SOURCE.json: 写した・作ったファイルの sha256（formula の写しは元と同じ = 変換なし。帳票のパターンの項目定義は docs/samples と同じ）
 *   - 値の表（印の順、型ごとの値）、固定のレコード 3 件、rows（0 / 1 / 1,000、関連レコード一覧は 1,001 まで作れて上限を超える）、count（1〜100）
 *   - Ver.9 の zip で 4 つの標本が normalize と描画を通る（一覧帳票の描画は T2）
 *   - ユーザー情報の既定のテストデータ（users: "default"。UINFO / OUSERS / GUSERS / LOGIN_CODE。ログインユーザーは authoring）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
import { MAX_COUNT, MAX_RELATED_ROWS, MAX_ROWS, TRY_APP_KEYS, fixedRecord, relatedOverLimit, tryApp, withCount, withRows } from "../src/try-apps/index.ts";
import { LONG_TEXT, markOf, valueOf } from "../src/try-apps/generate.ts";
import { InputError } from "../src/commands/normalize.ts";
import { normalizeInChild, previewInChild } from "../src/worker/evaluator.ts";
import { runEval } from "../src/worker/run.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TRY = path.join(here, "..", "src", "try-apps");
const SAMPLES = path.join(here, "..", "..", "docs", "samples");
const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip9 = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const policy = { allowExternal: [] };
const recordFile = (app, record) => ({ tool: "pcraft-authoring try-app", fetchedAt: "", baseUrl: "https://example.cybozu.com", appId: app.fields.appId, id: 1, record });

test("SOURCE.json: 写した・作ったファイルの sha256 が記録と同じ。formula の写しは変換なし、帳票のパターンの項目定義は docs/samples と同じ", () => {
  const src = JSON.parse(readFileSync(path.join(TRY, "SOURCE.json"), "utf8"));
  assert.equal(src.formula.repository, "rex0220/formula-authoring");
  assert.match(src.formula.commit, /^[0-9a-f]{40}$/);
  for (const f of src.formula.files) {
    assert.equal(f.transform, "none");
    assert.equal(f.destSha256, f.sourceSha256);
    assert.equal(sha256(readFileSync(path.join(TRY, f.to))), f.destSha256, f.to);
  }
  for (const key of ["quote", "list", "gantt"]) {
    const r = src.reports[key];
    assert.equal(sha256(readFileSync(path.join(here, "..", "..", r.sample, "fields.json"))), r.sourceFieldsSha256, `${key}: docs/samples の fields.json が写したときと違う（scripts/gen-try-apps.mjs --write で作り直す）`);
    for (const f of r.files) assert.equal(sha256(readFileSync(path.join(TRY, f.to))), f.sha256, f.to);
  }
});

test("値の表: 印は空（11）→ 0（13）→ 負（17）→ 長い（7）→ 改行（5）の順に 1 つだけ。型ごとの値", () => {
  assert.deepEqual([1, 5, 7, 11, 13, 17, 55].map(markOf), ["normal", "newline", "long", "empty", "zero", "negative", "empty"]);
  const num = { type: "NUMBER", code: "n", label: "数" };
  assert.deepEqual([1, 11, 13, 17].map((i) => valueOf(num, i).value), ["100", "", "0", "-1700"]);
  const text = { type: "SINGLE_LINE_TEXT", code: "t", label: "品名" };
  assert.equal(valueOf(text, 1).value, "品名 1");
  assert.equal(valueOf(text, 7).value, `品名7${LONG_TEXT}`);
  assert.equal(LONG_TEXT.length, 40);
  assert.equal(valueOf({ type: "MULTI_LINE_TEXT", code: "m", label: "備考" }, 5).value, "備考 5\n2 行目\n3 行目");
  assert.equal(valueOf({ type: "DATE", code: "d", label: "日" }, 1).value, "2026-01-16");
  const dd = { type: "DROP_DOWN", code: "s", label: "確度", options: { B: { label: "B", index: "1" }, A: { label: "A", index: "0" } } };
  assert.deepEqual([1, 2, 11].map((i) => valueOf(dd, i).value), ["A", "B", ""]);
  assert.equal(valueOf({ ...dd, type: "RADIO_BUTTON" }, 11).value, "A", "ラジオボタンは空にできないので先頭");
  assert.deepEqual(valueOf({ type: "USER_SELECT", code: "u", label: "担当" }, 2).value, [{ code: "demo_user02", name: "架空 営業部長" }]);
  assert.equal(valueOf({ type: "GROUP", code: "g", label: "枠" }, 1), undefined, "値を持たない型は作らない");
});

test("固定のレコード 3 件（1 = 典型、2 = 端、3 = 空）と、知らない名前・番号は InputError", () => {
  assert.deepEqual([...TRY_APP_KEYS], ["formula-sample", "quote", "list", "gantt"]);
  for (const key of TRY_APP_KEYS) assert.equal(tryApp(key).records.length, 3, key);
  assert.equal(fixedRecord(tryApp("quote"), 1).見積明細.value.length, 3, "典型は docs/samples の見本（明細 3 行）");
  assert.equal(fixedRecord(tryApp("quote"), 2).見積明細.value.length, 2, "端は長い品名と値引きの 2 行");
  assert.equal(fixedRecord(tryApp("quote"), 3).見積明細.value.length, 0);
  assert.equal(fixedRecord(tryApp("gantt"), 1).task_list.value.length, 30);
  assert.equal(fixedRecord(tryApp("gantt"), 2).task_list.value.length, 0);
  assert.throws(() => tryApp("x"), InputError);
  assert.throws(() => fixedRecord(tryApp("quote"), 4), InputError);
  const a = fixedRecord(tryApp("quote"), 1);
  a.宛名.value = "変えた";
  assert.notEqual(fixedRecord(tryApp("quote"), 1).宛名.value, "変えた", "写しを返す");
});

test("rows: quote は 0 / 1 / 1,000 行（1,001 は誤り）、gantt の関連レコード一覧は 1,001 行まで作れて印刷屋の上限 1,000 を超える。count: 1〜100", () => {
  const quote = tryApp("quote");
  assert.deepEqual([0, 1, MAX_ROWS].map((n) => withRows(quote, n).見積明細.value.length), [0, 1, 1000]);
  assert.throws(() => withRows(quote, MAX_ROWS + 1), InputError);
  const row = withRows(quote, 13).見積明細.value[12];
  assert.deepEqual([row.id, row.value.数量.value, row.value.商品名.value], ["900013", "0", "商品名 13"]);
  const gantt = tryApp("gantt");
  const g1000 = withRows(gantt, 1000);
  assert.equal(g1000.task_list.value.length, 1000);
  assert.ok(Object.keys(g1000.task_list.value[0].value).every((k) => k.startsWith("task_list$")), "仮のテーブルの子は 親$子");
  assert.deepEqual(relatedOverLimit(gantt, g1000, 1000), []);
  assert.deepEqual(relatedOverLimit(gantt, withRows(gantt, MAX_RELATED_ROWS), 1000), [{ parent: "task_list", rows: 1001 }]);
  assert.throws(() => withRows(gantt, MAX_RELATED_ROWS + 1), InputError);
  assert.throws(() => withRows(tryApp("list"), 1), InputError);
  const list = tryApp("list");
  assert.equal(withCount(list, 1).length, 1);
  const many = withCount(list, MAX_COUNT);
  assert.equal(many.length, 100);
  assert.deepEqual([many[0].$id.value, many[0].レコード番号.value, many[10].顧客名.value], ["1001", "1", ""]);
  for (const n of [0, MAX_COUNT + 1]) assert.throws(() => withCount(list, n), InputError);
  assert.throws(() => withCount(quote, 1), InputError);
});

/** 計算式サンプルの最小の設定（いくつかの型を差し込む 1 ボタン） */
function formulaSampleSettings(app) {
  return {
    date: "2026-10-20 12:00:00", pluginName: "印刷屋プラグイン", pluginID: "rex0220 Print craft plugin", PluginVersion: "9", appId: app.fields.appId, appName: app.fields.appName,
    pluginEnable: true, commonCssEnable: false, externalRefs: "block",
    pluginInfos: [{
      state: true, menu: "試し", desc: "", list: false, viewsCsv: "-",
      tagsInfo: {
        fieldsInfo: [
          { state: false, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: "" },
          { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: '"試し.pdf"' },
          { state: true, desc: "本文", css: "", html: '<div class="rex0220-pcraft-page"><p>${ESC_HTML(文字列1)}</p><p>${ESC_HTML(数値1)}</p><p>${ESC_HTML(DATE_FORMAT(日付1, "YYYY/MM/DD"))}</p><p>${ESC_HTML(JOIN(UINFO(), ","))}</p></div>', formulaSet: "" }
        ],
        filecode: "", pageSize: "A4", orientation: "p", dpi: "96", printMode: "preview"
      },
      calcInfo: { fieldsInfo: [] }
    }]
  };
}

test("Ver.9 の zip で 4 つの標本が normalize と描画を通る（固定のレコード 3 件と rows 1,000。一覧帳票の描画は T2）", { skip: skip9 }, async () => {
  const ev = { pluginZip: ZIP9 };
  const cases = [
    ["formula-sample", JSON.stringify(formulaSampleSettings(tryApp("formula-sample")))],
    ["quote", readFileSync(path.join(SAMPLES, "見積書", "settings.json"), "utf8")],
    ["gantt", readFileSync(path.join(SAMPLES, "工程表", "settings.json"), "utf8")]
  ];
  for (const [key, settingsText] of cases) {
    const app = tryApp(key);
    const records = [1, 2, 3].map((n) => fixedRecord(app, n));
    if (app.rowsTable) records.push(withRows(app, 1000));
    for (const [k, rec] of records.entries()) {
      const r = await previewInChild(ev, { settingsText, fields: app.fields, recordFile: recordFile(app, rec), policy });
      assert.deepEqual(r.findings.items.filter((f) => f.level === "error"), [], `${key} #${k + 1}: ${r.findings.format()}`);
      assert.ok(r.results.length >= 1, `${key} #${k + 1}`);
      for (const b of r.results) assert.deepEqual(b.errors, [], `${key} #${k + 1} ${b.menu} の式のエラー`);
    }
  }
  const list = tryApp("list");
  const n = await normalizeInChild(ev, { settingsText: readFileSync(path.join(SAMPLES, "一覧帳票", "settings.json"), "utf8"), fields: list.fields, policy });
  assert.deepEqual(n.findings.items.filter((f) => f.level === "error"), [], n.findings.format());
});

test("ユーザー情報の既定のテストデータ（users: \"default\"）: UINFO / OUSERS / GUSERS / LOGIN_CODE。ログインユーザーは authoring。省略は今までどおり 1 人", { skip: skip9 }, async () => {
  const F = ['JOIN(UINFO(), ",")', 'JOIN(UINFO("demo_user02", "name"), "")', 'JOIN(UINFO("demo_user02", "#boss"), "")', 'JOIN(UINFO("demo_user06", "orgs"), ",")', 'JOIN(UINFO("demo_user02", "groups"), ",")', 'JOIN(OUSERS("demo_dev1"), ",")', 'JOIN(GUSERS("demo_managers"), ",")', "LOGIN_CODE()", "LOGIN_NAME()", 'JOIN(UINFO("nobody", "name"), "")'];
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: F, users: "default" });
  assert.deepEqual(r.formulas.map((x) => x.text), [
    "demo_user01,demo_user02,demo_user03,demo_user04,demo_user05,demo_user06,demo_user07,demo_user08,demo_user09,authoring",
    "架空 営業部長", "demo_user01", "demo_dev1", "demo_managers,demo_approvers", "demo_user06,demo_user07,authoring", "demo_user01,demo_user02,demo_user03", "authoring", "架空 オーサリング", ""
  ]);
  const plain = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: [F[0], F[1]] });
  assert.deepEqual(plain.formulas.map((x) => x.text), ["authoring", ""], "省略はログインユーザー 1 人だけ（次の子プロセスに残らない）");
});
