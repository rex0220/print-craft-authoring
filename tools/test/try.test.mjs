/**
 * try（お試しアプリで式と帳票を試す。tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.2〜4.5、T3）:
 *   - 入力の検査（知らないキー、併せて渡せないもの、番号、使えない標本、長さ、テーブルのコード）
 *   - 式: レコードごとの値と式の評価のエラー、テーブルの行ごと、count の $records、ユーザー情報は既定のテストデータ、大きすぎる結果
 *   - ボタン: ページの文字、ファイル名（評価のエラーなら既定の名前とエラー）、表示条件（評価のエラーなら出す。一覧帳票は評価しない）、帳票の files。
 *     試す式は検査（normalize）を通り、レコードで評価すると失敗するもの（JSON_P）。知らない項目は検査で止まる
 *   - 関連レコード一覧の上限（1,001 行）は印刷屋と同じく作らない（refused、files は html 無し）
 *   - 結果は JSON の文字数 16,000 まで（ページが多ければ先頭・最後・エラーのページ）。Worker thread でも同じ
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
import { TRY_MAX_RESULT_CHARS, validateTryInput } from "../src/commands/try.ts";
import { InputError } from "../src/commands/normalize.ts";
import { tryInChild } from "../src/worker/evaluator.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.join(here, "..", "..", "docs", "samples");
const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;
const ev = { pluginZip: ZIP9 };
const PAGE = (body) => `<div class="rex0220-pcraft-page">${body}</div>`;

test("入力の検査: 知らないキー、formulas と button の両方、records・rows・count の併用、番号、使えない標本、長さ、テーブルのコード", () => {
  const bad = (v, re) => assert.throws(() => validateTryInput(v), (e) => e instanceof InputError && re.test(e.message), JSON.stringify(v).slice(0, 80));
  bad({ formulas: [{ formula: "1" }], x: 1 }, /知らないキー: x/);
  bad({ formulas: [{ formula: "1" }], button: { html: "" } }, /どちらか 1 つ/);
  bad({}, /どちらか 1 つ/);
  bad({ app: "quote", records: [1], rows: 3, formulas: [{ formula: "1" }] }, /1 つだけ/);
  bad({ records: [], formulas: [{ formula: "1" }] }, /records は/);
  bad({ records: [1, 1], formulas: [{ formula: "1" }] }, /重ならずに/);
  bad({ records: [4], formulas: [{ formula: "1" }] }, /records は/);
  bad({ rows: 3, formulas: [{ formula: "1" }] }, /rows を使えない/);
  bad({ app: "quote", count: 3, formulas: [{ formula: "1" }] }, /count を使えない/);
  bad({ app: "list", count: 101, formulas: [{ formula: "1" }] }, /count は 1〜100/);
  bad({ app: "x", formulas: [{ formula: "1" }] }, /お試しアプリの名前が違う/);
  bad({ formulas: Array.from({ length: 11 }, () => ({ formula: "1" })) }, /1〜10 個/);
  bad({ formulas: [{ formula: "1", as: "TEXT" }] }, /知らないキー: as/);
  bad({ formulas: [{ formula: "1", table: "nope" }] }, /テーブルのコード/);
  bad({ formulas: [{ formula: "あ".repeat(6000) }] }, /長すぎる/);
  bad({ button: { html: "x".repeat(65_537) } }, /button.html が長すぎる/);
  bad({ button: { html: "", foo: 1 } }, /button の知らないキー: foo/);
  bad({ button: { css: "" } }, /button.html は文字列/);
  assert.deepEqual(validateTryInput({ app: "quote", rows: 5, button: { html: "" } }), { app: "quote", rows: 5, button: { html: "" } });
});

test("式: レコードごとの値と式の評価のエラー、テーブルの行ごと、ユーザー情報は既定のテストデータ、大きすぎる結果", { skip }, async () => {
  const r = await tryInChild(ev, { formulas: [{ formula: "数値1 * 2" }, { formula: "zz" }, { formula: "T1_数値 * 10", table: "テーブル1" }, { formula: 'JOIN(UINFO("demo_user02", "name"), "")' }, { formula: 'LENGTH(JOIN(ARRAY_FOR(30000, i, "abcdefghij"), ""))' }, { formula: 'JOIN(ARRAY_FOR(30000, i, "abcdefghij"), "")' }] });
  const res = r.result;
  assert.deepEqual([res.app, res.mode, res.targets], ["formula-sample", "formulas", ["レコード 1", "レコード 2", "レコード 3"]]);
  assert.deepEqual(res.formulas[0].values.map((v) => v.text), ["2468", "0", ""]);
  assert.deepEqual(res.formulas[1].values.map((v) => v.evaluationError), Array(3).fill("getVal FIELD CODE NOT FOUND: zz"));
  const rows = res.formulas[2].values;
  assert.deepEqual(rows.filter((v) => v.target === "レコード 1").map((v) => [v.row, v.text]), [[1, "1000"], [2, "2000"], [3, "3000"]]);
  assert.deepEqual(rows.filter((v) => v.target === "レコード 3").map((v) => [v.row, v.text]), [[0, "（テーブルの行が無い）"]]);
  assert.deepEqual(res.formulas[3].values.map((v) => v.text), Array(3).fill("架空 営業部長"));
  assert.deepEqual(res.formulas[4].values.map((v) => v.text), Array(3).fill("300000"));
  assert.deepEqual(res.formulas[5].values.map((v) => v.tooLarge), [true, true, true], "結果が 262,144 バイトを超えたら値を返さない");
  assert.equal(r.files.length, 0);
  assert.ok(res.notes.some((n) => /架空/.test(n)));
});

test("式の count: 一覧のレコードを $records に入れて評価（RECS_*）", { skip }, async () => {
  const r = await tryInChild(ev, { app: "list", count: 25, formulas: [{ formula: "ARRAY_COUNT(RECS_MAP(レコード番号))" }, { formula: "RECS_SUM(プラン費用)" }] });
  assert.deepEqual(r.result.targets, ["一覧 25 件"]);
  assert.deepEqual(r.result.formulas.map((f) => f.values[0].text), ["25", String(r.result.formulas[1].values[0].text)]);
  assert.equal(r.result.formulas[0].values[0].text, "25");
});

test("ボタン: ページの文字、ファイル名（評価のエラーなら既定の名前とエラー）、表示条件（エラーなら出す）、帳票の files", { skip }, async () => {
  const r = await tryInChild(ev, { app: "quote", records: [1, 3], button: { html: PAGE("<h1>${ESC_HTML(宛名)} 様</h1><p>${YEN(合計)}</p>"), fileNameFormula: "JSON_P(宛名)", displayCondition: "JSON_P(宛名) > 0" } });
  const b = r.result.button;
  assert.deepEqual(b.findings.filter((f) => f.level === "error"), []);
  assert.deepEqual(b.results.map((x) => x.target), ["レコード 1", "レコード 3"]);
  const [one, three] = b.results;
  assert.deepEqual([one.pages, one.errorCount, one.pageTexts[0].text], [1, 0, "株式会社あれこれ 様¥330,000"]);
  assert.equal(three.pageTexts[0].text, "様");
  assert.equal(one.fileName.usedDefault, true);
  assert.ok(one.fileName.evaluationError && one.fileName.value.endsWith(".pdf"), JSON.stringify(one.fileName));
  assert.deepEqual([one.displayCondition.applied, one.displayCondition.set, one.displayCondition.shown], [true, true, true], "評価のエラーなら印刷屋と同じく出す");
  assert.ok(one.displayCondition.evaluationError, "評価のエラーの文");
  assert.deepEqual(r.files.map((f) => [f.key, typeof f.html, typeof f.inner]), [["1", "string", "string"], ["3", "string", "string"]]);
  assert.match(r.files[0].inner, /株式会社あれこれ/);
});

test("一覧帳票のボタン: 表示条件は評価しない（applied: false）。docs/samples の一覧帳票の式で 25 件は 2 ページ", { skip }, async () => {
  const body = JSON.parse(readFileSync(path.join(SAMPLES, "一覧帳票", "settings.json"), "utf8")).pluginInfos[0].tagsInfo.fieldsInfo[2];
  const r = await tryInChild(ev, { app: "list", count: 25, button: { html: "", bodyFormula: body.formulaSet, list: true, orientation: "l", displayCondition: "1 = 2" } });
  const [x] = r.result.button.results;
  assert.deepEqual([x.target, x.pages, x.displayCondition], ["一覧 25 件", 2, { applied: false }]);
  assert.deepEqual(r.files.map((f) => f.key), ["list"]);
});

test("関連レコード一覧の上限: gantt の rows 1,001 は印刷屋と同じく作らない（refused。ボタンの files は html 無し = 古いファイルを消す）", { skip }, async () => {
  const f = await tryInChild(ev, { app: "gantt", rows: 1001, formulas: [{ formula: "COUNTROW(task_list)" }] });
  assert.deepEqual(f.result.refused.map((x) => x.code), ["related.tooMany"]);
  assert.deepEqual(f.result.formulas[0].values, []);
  const b = await tryInChild(ev, { app: "gantt", rows: 1001, button: { html: PAGE("${COUNTROW(task_list)}") } });
  assert.deepEqual(b.files, [{ key: "rows" }]);
  const ok = await tryInChild(ev, { app: "gantt", rows: 1000, formulas: [{ formula: "COUNTROW(task_list)" }] });
  assert.equal(ok.result.formulas[0].values[0].text, "1000");
});

test("結果は JSON の文字数 16,000 まで: 工程表 1,000 行（36 ページ）は先頭・最後・エラーのページを選び、省いたページの番号を返す。Worker thread でも同じ", { skip }, async () => {
  const s = JSON.parse(readFileSync(path.join(SAMPLES, "工程表", "settings.json"), "utf8")).pluginInfos[0].tagsInfo;
  const body = s.fieldsInfo[2];
  for (const isolation of ["process", "thread"]) {
    const r = await tryInChild({ ...ev, run: { isolation } }, { app: "gantt", rows: 1000, button: { html: body.html, css: body.css ?? "", bodyFormula: body.formulaSet, pageSize: s.pageSize, orientation: s.orientation } });
    const [x] = r.result.button.results;
    assert.equal(x.pages, 36, isolation);
    assert.ok(JSON.stringify(r.result).length <= TRY_MAX_RESULT_CHARS, `${isolation}: ${JSON.stringify(r.result).length}`);
    const shown = x.pageTexts.map((p) => p.page);
    assert.ok(shown.includes(1) && shown.includes(36), `${isolation}: 先頭と最後 ${shown}`);
    assert.equal(shown.length + (x.pagesOmitted?.length ?? 0), 36);
    assert.ok(r.result.cut?.length, "削ったことの印");
    assert.equal(r.diag.isolation, isolation);
  }
});

test("Ver.9 の zip では M_* / R_* が使えるので、Ver.9 から使えるの一言は出ない（Ver.8 は engine-v8.test.mjs）", { skip }, async () => {
  const r = await tryInChild(ev, { records: [1], formulas: [{ formula: "M_SIN(0)" }, { formula: 'R_PMT(0, 12, 120000)' }] });
  assert.deepEqual(r.result.formulas.map((f) => [f.values[0].text, f.values[0].evaluationError]), [["0", undefined], ["-10000", undefined]]);
});
