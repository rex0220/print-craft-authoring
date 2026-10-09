/** 中核の境界（段階 0-2）: cli.ts 以外は process.cwd() / process.env を読まない（print-craft MCP が渡す文脈と別の値を使わないように）。paths.ts は開発とビルドのときだけ使う場所の探し方なので除く */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const ALLOWED = new Set(["cli.ts", "paths.ts"]);

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("中核は process.cwd() / process.env を読まない（cli.ts と開発用の paths.ts だけ）", () => {
  const hits = [];
  for (const f of files(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "").replace(/^\s*\/?\*.*$/, "");
        if (/process\.(cwd\(\)|env\b)/.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
