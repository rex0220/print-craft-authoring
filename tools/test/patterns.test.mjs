/**
 * 計算パターンの検証（print-craft の docs/authoring-try-plan.md T5。formula-authoring の test/docs-sync.test.mjs と同じ考え）:
 *   - docs/計算パターン_検証.md が最新（scripts/verify-patterns.mjs の結果と同じ。違えば `npm run gen-patterns` で作り直す）
 *   - ケースの式が全部、期待どおり（エンジンの版が変わったときの回帰検査）
 *   - docs/計算パターン.md の ✔ の行の関数が、検証のケースのどれかに出てくる（検証していない例に ✔ を付けない）
 * 印刷屋 Ver.9 の zip が無ければ飛ばす。タイムゾーンは verify-patterns.mjs が Asia/Tokyo に固定する
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_FILE, defaultZip, renderDoc, runPatternCases } from "../scripts/verify-patterns.mjs";
import { PATTERN_CASES } from "../scripts/pattern-cases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ZIP9 = await defaultZip();
const skip = existsSync(ZIP9) ? false : `印刷屋 Ver.9 の zip が無い: ${ZIP9}`;

test("計算パターンの検証: 生成物が最新で、ケースの式が全部期待どおり", { skip }, async () => {
  const r = await runPatternCases(ZIP9);
  const bad = r.cases.flatMap((c) => c.rows.filter((x) => !x.match).map((x) => `${c.case.pattern}: ${x.formula} → ${JSON.stringify(x.got)}（期待 ${JSON.stringify(x.expect)}）`));
  assert.deepEqual(bad, []);
  assert.equal(readFileSync(DOC_FILE, "utf8"), `${renderDoc(r)}\n`, "docs/計算パターン_検証.md が古い（tools/ で npm run gen-patterns）");
});

test("計算パターン.md の ✔ の行の関数は、検証のケースに出てくる", () => {
  const doc = readFileSync(path.join(here, "..", "..", "docs", "計算パターン.md"), "utf8");
  const verified = PATTERN_CASES.flatMap((c) => c.formulas.map((f) => f.formula)).join("\n");
  const missing = [];
  for (const line of doc.split(/\r?\n/).filter((l) => /✔/.test(l))) {
    for (const m of line.matchAll(/`([A-Z][A-Z0-9_]*)\(/g)) if (!verified.includes(`${m[1]}(`)) missing.push(`${m[1]}: ${line.slice(0, 60)}`);
  }
  assert.deepEqual([...new Set(missing)], []);
});
