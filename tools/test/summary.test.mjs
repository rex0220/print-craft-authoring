/** 要約コマンド: fields --summary（1 項目 1 行）、record --summary（値は出さず形だけ）、buttons（ボタン一覧と --button の中身） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFields } from "../src/commands/fields.ts";
import { describeRecord } from "../src/commands/record.ts";
import { ButtonNotFoundError, listButtons, shortenDataUrls } from "../src/commands/buttons.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));
const run = (args, cwd) => spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { encoding: "utf8", env: baseEnv, cwd });

const RECORD_FILE = {
  tool: "pcraft-authoring record",
  fetchedAt: "2026-10-05T00:00:00.000Z",
  baseUrl: "https://x.cybozu.com",
  appId: 3740,
  id: 3,
  record: {
    $id: { type: "__ID__", value: "3" },
    宛名: { type: "SINGLE_LINE_TEXT", value: "□□□□株式会社" },
    備考: { type: "MULTI_LINE_TEXT", value: "1 行目\n2 行目\n3 行目" },
    合計金額: { type: "NUMBER", value: "-8793400.5" },
    見積日: { type: "DATE", value: "2026-02-12" },
    担当者: { type: "USER_SELECT", value: [{ code: "sales1", name: "営業太郎" }] },
    発行済み: { type: "CHECK_BOX", value: [] },
    見積ファイル: { type: "FILE", value: [{ contentType: "image/png", name: "社印.png", fileKey: "k1" }, { contentType: "application/pdf", name: "見積.pdf", fileKey: "k2" }] },
    見積明細: {
      type: "SUBTABLE",
      value: [
        { id: "1", value: { 商品名: { type: "SINGLE_LINE_TEXT", value: "サイボウズ Office" }, 数量: { type: "NUMBER", value: "3000" } } },
        { id: "2", value: { 商品名: { type: "SINGLE_LINE_TEXT", value: "" }, 数量: { type: "NUMBER", value: "100" } } }
      ]
    }
  }
};

test("fields --summary: レイアウトの順、テーブルの子は字下げ、グループの中も順に、書式・単位・選択肢・保存先", () => {
  const out = listFields(FIELDS_FILE);
  const lines = out.split("\n");
  assert.match(lines[0], /^アプリ 3740 見積書\(印刷屋\)（運用中、lang=ja、取得 2026-10-04T00:00:00\.000Z）項目 11/);
  const codes = lines.slice(1).map((l) => l.replace(/^(\s*\S+).*$/, "$1"));
  assert.deepEqual(codes, ["宛名", "見積番号", "見積日", "担当者", "見積明細", "  商品名", "  数量", "  単価", "  金額", "小計金額", "消費税", "合計金額", "備考", "発行済み", "見積ファイル"]);
  assert.ok(out.includes("  金額  CALC（書式 NUMBER_DIGIT、単位「¥」前）"), out);
  assert.ok(out.includes("合計金額  NUMBER（桁区切り、単位「¥」前）"), out);
  assert.ok(out.includes("発行済み  CHECK_BOX（選択肢 済）"), out);
  assert.ok(out.includes("見積ファイル  FILE（保存先 filecode にできる）"), out);
  assert.ok(!out.includes("レイアウトに無い"), "全部レイアウトにある");
});

test("fields --summary: ルックアップ（参照先とコピー先）、ラベルがコードと違えば「」、レイアウトに無い項目は最後に", () => {
  const file = structuredClone(FIELDS_FILE);
  file.properties.型番 = { type: "SINGLE_LINE_TEXT", code: "型番", label: "型番", lookup: { relatedApp: { app: "3741" }, relatedKeyField: "型番", fieldMappings: [{ field: "宛名", relatedField: "名前" }] } };
  file.properties.見積番号.label = "見積書番号";
  file.properties.レコード番号 = { type: "RECORD_NUMBER", code: "レコード番号", label: "レコード番号" };
  file.layout.push({ type: "ROW", fields: [{ type: "SINGLE_LINE_TEXT", code: "型番" }] });
  const out = listFields(file);
  assert.ok(out.includes("型番  SINGLE_LINE_TEXT（ルックアップ（アプリ 3741 の 型番））"), out);
  assert.ok(out.includes("宛名  SINGLE_LINE_TEXT（ルックアップのコピー先）"), out);
  assert.ok(out.includes("見積番号「見積書番号」  SINGLE_LINE_TEXT"), out);
  assert.ok(out.endsWith("レイアウトに無い項目: レコード番号 RECORD_NUMBER"), out);
});

test("record --summary: 値は出さず形だけ（文字数・行数・数値の桁・件数・添付の種類、テーブルは列ごとに最大と空の行）", () => {
  const out = describeRecord(RECORD_FILE);
  assert.match(out, /^アプリ 3740 レコード 3（取得 2026-10-05T00:00:00\.000Z）。値は出さない（形だけ）/);
  assert.ok(out.includes("宛名  SINGLE_LINE_TEXT  8 文字"), out);
  assert.ok(out.includes("備考  MULTI_LINE_TEXT  14 文字、3 行"), out);
  assert.ok(out.includes("合計金額  NUMBER  数値 負 整数 7 桁、小数 1 桁"), out);
  assert.ok(out.includes("見積日  DATE  日付"), out);
  assert.ok(out.includes("担当者  USER_SELECT  1 件"), out);
  assert.ok(out.includes("発行済み  CHECK_BOX  空"), out);
  assert.ok(out.includes("見積ファイル  FILE  2 件（image/png 1、application/pdf 1）"), out);
  assert.ok(out.includes("見積明細  SUBTABLE  2 行"), out);
  assert.ok(out.includes("  商品名  SINGLE_LINE_TEXT  最大 12 文字、空 1 行"), out);
  assert.ok(out.includes("  数量  NUMBER  最大 数値 整数 4 桁"), out);
  for (const value of ["□□□□", "1 行目", "8793400", "2026-02-12", "営業太郎", "sales1", "社印.png", "k1", "サイボウズ", "3000"]) assert.ok(!out.includes(value), `値 ${value} を出さない`);
  assert.ok(!out.includes("$id"));
});

test("buttons: ボタン一覧（出す画面、保存先、用紙、表示条件、ファイル名、帳票の行、更新項目）と封筒の情報", () => {
  const s = aiSettings();
  s.pluginInfos.push({ state: false, menu: "一覧", list: true, viewsCsv: "20, 21", tagsInfo: { fieldsInfo: [{ state: false, fieldcode: "$out" }, { state: true, fieldcode: "$fname", formulaSet: '"一覧.pdf"' }, { state: true, desc: "表", formulaSet: "RECS_HTML(\n  顧客名\n)" }], pageSize: "A4", orientation: "l", dpi: "96" }, calcInfo: { fieldsInfo: [] } });
  s.pluginInfos.push({ state: true, menu: "詳細だけ", viewsCsv: "-", tagsInfo: { fieldsInfo: [] }, calcInfo: { fieldsInfo: [] } });
  const out = listButtons(s, { file: "settings/a.json" });
  assert.match(out, /^settings\/a\.json（アプリ 3740 見積書\(印刷屋\)、ボタン 3（有効 2）、外部参照 block、共通 CSS 既定（省略）、Web フォント なし、派生値なし、\d+\.\d KB）/);
  assert.match(out, /1\. 見積書（有効、詳細画面 \+ すべての一覧で一括処理、保存先 見積ファイル、A4 縦 96 dpi、押したとき confirm、\d+\.\d KB）/);
  assert.ok(out.includes("   表示条件: NOT(見積ファイル)"));
  assert.ok(out.includes('   ファイル名: "見積書-" & 見積番号 & ".pdf"'));
  assert.match(out, /帳票: 3 行目 本文: HTML [\d,]+ 文字、CSS \d+ 文字、計算式 11 行/);
  assert.ok(out.includes("   更新項目: 発行済み"));
  assert.match(out, /2\. 一覧（無効、一覧帳票（一覧 20,21）、保存先なし（ダウンロード）、A4 横 96 dpi/);
  assert.ok(out.includes("   表示条件: なし（常に出す）"));
  assert.ok(out.includes("3 行目 表: HTML 0 文字、CSS 0 文字、計算式 3 行"));
  assert.match(out, /3\. 詳細だけ（有効、詳細画面、/);
  assert.ok(out.includes("   表示条件: （1 行目が無い）"));
});

test("buttons --button: HTML / CSS / 計算式と更新項目。1・2 行目の css（設定画面の見出し）は出さない。data: の URL は先頭と長さだけ。無い名前は止まる", () => {
  const s = aiSettings();
  const seal = `data:image/svg+xml;base64,${"A".repeat(5000)}`;
  const tags = s.pluginInfos[0].tagsInfo.fieldsInfo;
  tags[0].css = "ボタン表示条件";
  tags[2].html = tags[2].html.replace(/src="data:[^"]+"/, `src="${seal}"`);
  const out = listButtons(s, { file: "settings/a.json", button: "見積書" });
  assert.ok(out.includes("--- HTML 設定 1 行目 $out ボタン表示条件（有効） ボタン表示条件\n計算式:\nNOT(見積ファイル)"), out);
  assert.ok(!out.includes("CSS:\nボタン表示条件"));
  assert.ok(out.includes("--- HTML 設定 3 行目 帳票（有効） 本文\nCSS:\n.pcraft-inv-seal"), out);
  assert.ok(out.includes(`${seal.slice(0, 40)}…（data URL 5,026 文字）`), out);
  assert.ok(!out.includes("A".repeat(100)));
  assert.ok(out.includes('2 行目 発行済み（有効）: ARRAY("済")  備考: 発行したら印を付ける'), out);
  assert.throws(() => listButtons(s, { file: "settings/a.json", button: "無い" }), (e) => e instanceof ButtonNotFoundError && /見積書/.test(e.message));
  assert.equal(shortenDataUrls('src="data:image/png;base64,AAAA"'), 'src="data:image/png;base64,AAAA"', "短いものはそのまま");
});

test("CLI: fields / record の --summary は取得済みのファイルを読む（通信しない）。無ければ取り方を出して 1。buttons は作業フォルダーの中の設定", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-summary-"));
  try {
    mkdirSync(path.join(work, "fields"));
    mkdirSync(path.join(work, "records"));
    mkdirSync(path.join(work, "settings"));
    writeFileSync(path.join(work, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    writeFileSync(path.join(work, "records", "3740-3.json"), JSON.stringify(RECORD_FILE));
    writeFileSync(path.join(work, "settings", "a.json"), JSON.stringify(aiSettings()));
    const f = run(["fields", "--app", "3740", "--summary"], work);
    assert.equal(f.status, 0, f.stderr);
    assert.match(f.stdout, /^アプリ 3740 /);
    const r = run(["record", "--app", "3740", "--id", "3", "--summary"], work);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes("値は出さない") && !r.stdout.includes("□□□□"));
    const missing = run(["record", "--app", "3740", "--id", "9", "--summary"], work);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /records[\\/]3740-9\.json が無い。先に npx pcraft-authoring record --app 3740 --id 9/);
    const b = run(["buttons", "settings/a.json"], work);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /1\. 見積書（有効/);
    const nb = run(["buttons", "settings/a.json", "--button", "無い"], work);
    assert.equal(nb.status, 1);
    assert.match(nb.stderr, /ボタン「無い」は settings\/a\.json に無い/);
    const outside = run(["buttons", path.join(os.tmpdir(), "x.json")], work);
    assert.equal(outside.status, 2);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
