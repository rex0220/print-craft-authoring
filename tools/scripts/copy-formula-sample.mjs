/**
 * formula の標本「計算式サンプル」とユーザー情報の既定のテストデータを、formula-authoring の決まったコミットから写す（print-craft の docs/authoring-try-plan.md 4.1、P3、T1）。
 *   - 写す元は作業ツリーではなく、コミット（COMMIT）の blob（formula 側が先に進んでも中身が変わらない）。写す元の sha256 と写した先の sha256 を src/try-apps/SOURCE.json の formula に書く
 *   - 中身は変えない（変換なし）。普段のテストは写した先と SOURCE.json を照合し、このスクリプトは指定のコミットの blob と照合する（自分自身との照合にしない。Codex r1 M4）
 * 使い方: node scripts/copy-formula-sample.mjs [--write]（既定は比べるだけ）。formula-authoring は隣のフォルダー（../../formula-authoring）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORMULA = path.resolve(tools, "..", "..", "formula-authoring");
const OUT = path.join(tools, "src", "try-apps");
const SOURCE = path.join(OUT, "SOURCE.json");
const WRITE = process.argv.includes("--write");

/** formula-authoring の main の 011cc65（標本とユーザー情報は 3788114 のまま。2026-10-20） */
const COMMIT = "011cc65";
const FILES = [
  ["tools/src/sample-app/fields.json", "formula-sample/fields.json"],
  ["tools/src/sample-app/record-1.json", "formula-sample/record-1.json"],
  ["tools/src/sample-app/record-2.json", "formula-sample/record-2.json"],
  ["tools/src/sample-app/record-3.json", "formula-sample/record-3.json"],
  ["tools/src/users/default-users.ts", "users/default-users.ts"],
  ["tools/src/users/index.ts", "users/index.ts"]
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (...a) => execFileSync("git", ["-C", FORMULA, ...a], { maxBuffer: 64 * 1024 * 1024 });
if (!existsSync(FORMULA)) {
  console.error(`formula-authoring が無い: ${FORMULA}`);
  process.exit(1);
}
const commit = git("rev-parse", COMMIT).toString().trim();
const files = FILES.map(([from, to]) => {
  const data = git("show", `${commit}:${from}`);
  const dest = path.join(OUT, to);
  const state = !existsSync(dest) ? "new" : sha256(readFileSync(dest)) === sha256(data) ? "same" : "changed";
  return { from, to, data, sourceSha256: sha256(data), state };
});
for (const f of files) console.log(`  ${f.state.padEnd(7)} ${f.to}（${f.data.length.toLocaleString()} bytes、sha256 ${f.sourceSha256.slice(0, 12)}）`);
if (!WRITE) {
  console.log(`比べるだけ（formula-authoring ${COMMIT}。--write で写す）`);
  process.exit(0);
}
for (const f of files) {
  mkdirSync(path.dirname(path.join(OUT, f.to)), { recursive: true });
  writeFileSync(path.join(OUT, f.to), f.data);
}
const prev = existsSync(SOURCE) ? JSON.parse(readFileSync(SOURCE, "utf8")) : {};
prev.formula = {
  note: "formula の標本「計算式サンプル」（アプリ 4329。架空の値）とユーザー情報の既定のテストデータ（架空の 10 人）。scripts/copy-formula-sample.mjs が写した。手で直さない",
  repository: "rex0220/formula-authoring",
  commit,
  files: files.map((f) => ({ from: f.from, to: f.to, sourceSha256: f.sourceSha256, destSha256: f.sourceSha256, transform: "none" }))
};
writeFileSync(SOURCE, `${JSON.stringify(prev, null, 2)}\n`);
console.log(`写した（formula-authoring ${commit.slice(0, 7)}）。記録: src/try-apps/SOURCE.json`);
