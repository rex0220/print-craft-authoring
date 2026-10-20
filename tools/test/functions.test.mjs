/**
 * 関数の文書と lib の照合（docs/authoring-plan.md 12.4、Codex MAJOR 7）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
// 関数の表と資料は最新の印刷屋（Ver.9）に合わせる（2026-10-20。docs は「（Ver.9 から）」の印を付ける）。zip があれば Ver.9 の zip を読む
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
if (existsSync(ZIP9)) process.env.PCRAFT_PLUGIN_ZIP = ZIP9;
const { loadEngine } = await import("./helpers.mjs");
import { AUTHORING_ROOT, REPO_ROOT } from "../src/paths.ts";

const docs = path.join(REPO_ROOT, "docs");
const functions = JSON.parse(readFileSync(path.join(AUTHORING_ROOT, "functions.json"), "utf8"));
const names = Object.keys(functions.functions).sort();

test("functions.json の名前は lib の関数表と同じ（違えば npm run gen-functions）", async () => {
  const engine = await loadEngine();
  assert.deepEqual(names, engine.functionNames());
  assert.equal(functions.engineSha256, engine.source.engineSha256, "lib が変わっている。npm run gen-functions");
  for (const [name, f] of Object.entries(functions.functions)) {
    assert.ok(["print-craft", "general"].includes(f.kind), `${name} kind`);
    assert.ok(["node", "dom", "kintone-meta", "unsupported"].includes(f.node), `${name} node`);
    assert.ok(f.category && f.category !== "未分類", `${name} の分類が無い`);
  }
});

test("関数一覧.md: lib の全関数の項目があり、lib に無い関数の項目が無い", () => {
  const file = path.join(docs, "関数一覧.md");
  assert.ok(existsSync(file), "docs/関数一覧.md が無い（tools で npm run gen-docs）");
  const md = readFileSync(file, "utf8");
  const items = [...md.matchAll(/^- (?:[★✕] )?\*\*([A-Z][A-Z0-9_]*)\*\*\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(items.filter((n) => !names.includes(n)), [], "lib に無い関数の項目");
  assert.deepEqual(names.filter((n) => !items.includes(n)), [], "項目が無い関数");
  // Ver.9 から使える関数（Ver.8 までは無い 7 つと、decimal.js を使う M_* / R_*）には「（Ver.9 から）」の印
  for (const n of ["MEDIAN", "VAR", "VARP", "STDEV", "STDEVP", "UUID", "CRC32", "M_SIN", "R_PMT"]) assert.match(md, new RegExp(`^- \\*\\*${n}\\*\\*\\([^\\n]*\\): （Ver\\.9 から）`, "m"), `${n} の「（Ver.9 から）」の印`);
});

test("帳票関数リファレンス.md: 印刷屋固有の全関数の行がある", () => {
  const file = path.join(docs, "帳票関数リファレンス.md");
  assert.ok(existsSync(file), "docs/帳票関数リファレンス.md が無い");
  const md = readFileSync(file, "utf8");
  const rows = new Set([...md.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`/gm)].map((m) => m[1]));
  const printCraft = names.filter((n) => functions.functions[n].kind === "print-craft");
  assert.deepEqual(printCraft.filter((n) => !rows.has(n)), [], "リファレンスの表に無い印刷屋固有の関数");
  assert.deepEqual([...rows].filter((n) => !names.includes(n)), [], "lib に無い関数の行");
});
