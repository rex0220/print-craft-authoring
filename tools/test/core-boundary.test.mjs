/**
 * 中核の境界（段階 0-2）: cli.ts 以外は process.cwd() / process.env を読まない（print-craft MCP が渡す文脈と別の値を使わないように）。
 * 例外は開発用の場所の探し方 dev-paths.ts だけで、これを import してよいのは cli.ts だけ（Codex 再レビュー BLOCKER 1: engine.ts が paths.ts 経由で環境変数を読んでいた）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const READS_ENV = new Set(["cli.ts", "dev-paths.ts"]);
const IMPORTS_DEV = new Set(["cli.ts"]);

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** コメントを除いた行（1 行の中の / * … * / 、// 以降、* で始まる行） */
const codeLines = (f) =>
  readFileSync(f, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "").replace(/^\s*\/?\*.*$/, ""));

test("中核は process.cwd() / process.env を読まない（cli.ts と開発用の dev-paths.ts だけ）", () => {
  const hits = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (READS_ENV.has(rel)) continue;
    codeLines(f).forEach((code, i) => {
      if (/process\.(cwd\(\)|env\b)/.test(code)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("dev-paths.ts（環境変数を読む）を import するのは cli.ts だけ（中核は import しただけで環境変数を読むことにならない）", () => {
  const hits = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (IMPORTS_DEV.has(rel) || rel === "dev-paths.ts") continue;
    codeLines(f).forEach((code, i) => {
      if (/dev-paths(\.ts)?["']/.test(code)) hits.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
