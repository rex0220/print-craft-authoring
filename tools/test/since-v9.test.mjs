/**
 * Ver.9 から使える関数の一言（tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.4、Codex r1 N1）:
 *   - 条件は 3 つ（zip の版が 9 より前、文が厳密に「<名前>() is not available.」、名前が since-v9.ts の一覧にある）。返すのは関数名と決まった文だけ
 *   - preview の式のエラーの 2 つの形（${…} と 3 行目の計算式）。${…} の中の「: 」で切り間違えない
 *   - since-v9.ts は関数一覧の「（Ver.9 から）」と同じ（gen-function-list.mjs が両方を作る）
 * Ver.8 の zip の preview と try は engine-v8.test.mjs、Ver.9 では添えないことは try.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderErrorHint, sinceV9Hint } from "../src/normalize/derive.ts";
import { SINCE_V9_FUNCTIONS } from "../src/normalize/since-v9.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("sinceV9Hint: 版が 9 より前、厳密な文、一覧にある名前のときだけ。関数名と決まった文だけを返す", () => {
  assert.equal(sinceV9Hint("M_SIN() is not available.", "8"), "M_SIN() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.8）");
  assert.equal(sinceV9Hint("R_PMT() is not available.", "6"), "R_PMT() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.6）");
  assert.equal(sinceV9Hint("M_SIN() is not available.", "9"), undefined, "Ver.9 の zip では添えない");
  assert.equal(sinceV9Hint("M_SIN() is not available.", "10"), undefined);
  assert.equal(sinceV9Hint("M_SIN() is not available.", ""), undefined, "版が分からなければ添えない");
  assert.equal(sinceV9Hint("M_SIN() is not available. 秘密", "8"), undefined, "文の後ろに何か付いていれば添えない");
  assert.equal(sinceV9Hint("x M_SIN() is not available.", "8"), undefined);
  assert.equal(sinceV9Hint("M_NOPE() is not available.", "8"), undefined, "一覧に無い名前");
  assert.equal(sinceV9Hint("UINFO() is not available", "8"), undefined, "M_* / R_* でない");
  assert.equal(sinceV9Hint("M_SIN() arguments count.", "8"), undefined);
});

test("renderErrorHint: preview の式のエラーの 2 つの形。${…} の中の「: 」で切り間違えない", () => {
  const hint = "M_SIN() は印刷屋 Ver.9 から使える（使っている印刷屋の zip は Ver.8）";
  assert.equal(renderErrorHint("HTML 設定 3 行目 ${M_SIN(1)}: M_SIN() is not available.", "8"), hint);
  assert.equal(renderErrorHint('HTML 設定 12 行目 ${IF(a = "x: y", M_SIN(1), 0)}: M_SIN() is not available.', "8"), hint);
  assert.equal(renderErrorHint("HTML 設定 4 行目の計算式: M_SIN() is not available.", "8"), hint);
  assert.equal(renderErrorHint("HTML 設定 4 行目の計算式: M_SIN() is not available.", "9"), undefined);
  assert.equal(renderErrorHint("HTML 設定 3 行目 ${x}: getVal FIELD CODE NOT FOUND: x", "8"), undefined);
  assert.equal(renderErrorHint("M_SIN() is not available.", "8"), undefined, "preview の式のエラーの形でない");
});

test("since-v9.ts は関数一覧の「（Ver.9 から）」と同じ", () => {
  const doc = readFileSync(path.join(here, "..", "..", "docs", "関数一覧.md"), "utf8");
  const marked = [...doc.matchAll(/^- \*\*([A-Z][A-Z0-9_]*)\*\*\(.*?\): （Ver\.9 から）/gm)].map((m) => m[1]).sort();
  assert.deepEqual(marked, [...SINCE_V9_FUNCTIONS].sort());
  assert.ok(SINCE_V9_FUNCTIONS.includes("M_SIN") && SINCE_V9_FUNCTIONS.includes("R_PMT") && SINCE_V9_FUNCTIONS.includes("UUID"));
});
