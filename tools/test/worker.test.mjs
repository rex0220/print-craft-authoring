/**
 * 評価の子プロセス（src/worker/。tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.5・4.6、T0a）:
 *   - 子プロセスで式を評価する（値・生の値・式の評価のエラー。pid は親と違う）。inline（テストだけ）は親の中で同じ結果
 *   - ビルドした dist/eval-worker.mjs でも同じ（ビルドしていなければ飛ばす）
 *   - 時間の上限・メモリの上限で止めても親は落ちず、次の呼び出しに答える
 *   - 誤りの種類（zip / input / other。other は元の文を送らない）、結果を返さない終わり、標準出力・標準エラーは数えるだけ、子プロセスの環境変数
 *   - Worker thread（isolation "thread"。Claude Desktop の Electron の Node は子プロセスを起こせない）: 同じ結果、時間の上限、Worker のメモリの上限、標準出力
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";
import { EvalError, EvalExitError, EvalMemoryError, EvalTimeoutError, childEnv, defaultIsolation, runEval } from "../src/worker/run.ts";
import { classifyEvalError, toJsonSafe } from "../src/worker/eval-run.ts";
import { AUTHORING_ROOT } from "../src/paths.ts";

const ZIP9 = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
const skip = existsSync(ZIP9) ? false : `print-craft の Ver.9 の zip が無い: ${ZIP9}`;
const BUILT = path.join(AUTHORING_ROOT, "dist", "eval-worker.mjs");

const FORMULAS = ["1+1", "M_SIN(1)", "LET(a, 0, a)", "zz", 'ARRAY(1, 2, "a")', "LET(a, 1, ARRAY_FOR(2, k, zz))"];
function assertFormulaResults(r) {
  assert.equal(r.engine.pluginVersion, "9");
  assert.equal(r.engine.apiVersion, 3);
  assert.ok(r.engine.decimalSha256);
  const [plus, sin, zero, missing, arr, nested] = r.formulas;
  assert.deepEqual(plus, { text: "2", raw: 2 });
  assert.deepEqual(sin, { text: "0.84147098480789650665" }, "生の値が文字と同じなら省く");
  assert.deepEqual(zero, { text: "0", raw: 0 });
  assert.deepEqual(missing, { evaluationError: "getVal FIELD CODE NOT FOUND: zz" });
  assert.deepEqual(arr, { text: "1,2,a", raw: [1, 2, "a"] });
  assert.deepEqual(nested, { evaluationError: "getVal FIELD CODE NOT FOUND: zz" }, "入れ子でも頭に Error: を重ねない（Ver.102 のエンジン）");
}

test("子プロセスで式を評価: 値・生の値・式の評価のエラー。pid は親と違う。標準出力・標準エラーは 0", { skip }, async () => {
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: FORMULAS });
  assertFormulaResults(r);
  assert.notEqual(r.diag.pid, process.pid, "親と違うプロセスで評価した");
  assert.equal(r.diag.isolation, "process");
  assert.equal(defaultIsolation(), "process", "Electron でない Node では子プロセス");
  assert.deepEqual([r.diag.stdoutChars, r.diag.stderrChars], [0, 0]);
});

test("Worker thread（isolation thread）でも同じ結果。pid は親と同じ、threadId は主スレッドと違う", { skip }, async () => {
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: FORMULAS }, { isolation: "thread" });
  assertFormulaResults(r);
  assert.equal(r.diag.isolation, "thread");
  assert.equal(r.diag.pid, process.pid);
  assert.notEqual(r.diag.threadId, 0);
});

test("Worker thread の時間の上限: 超えたら Worker を止めて EvalTimeoutError。次の呼び出しに答える", { skip }, async () => {
  const t0 = Date.now();
  await assert.rejects(
    runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["ARRAY_COUNT(ARRAY_FOR(100000, i, ARRAY_COUNT(ARRAY_FOR(100000, j, i))))"] }, { isolation: "thread", timeoutSec: 1 }),
    (e) => e instanceof EvalTimeoutError
  );
  assert.ok(Date.now() - t0 < 10_000, `止めるのが遅い（${Date.now() - t0} ms）`);
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["2+2"] }, { isolation: "thread" });
  assert.equal(r.formulas[0].text, "4");
});

test("inline（テストだけ）は親の中で同じ結果", { skip }, async () => {
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: FORMULAS }, { inline: true });
  assertFormulaResults(r);
  assert.equal(r.diag.pid, process.pid);
});

test("ビルドした dist/eval-worker.mjs でも同じ（ビルドしていなければ飛ばす）", { skip: skip || (!existsSync(BUILT) && `ビルドしていない: ${BUILT}`) }, async () => {
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: FORMULAS }, { workerFile: BUILT });
  assertFormulaResults(r);
  assert.notEqual(r.diag.pid, process.pid);
});

test("時間の上限: 超えたら子プロセスを止めて EvalTimeoutError。親は落ちず、次の呼び出しに答える", { skip }, async () => {
  const t0 = Date.now();
  await assert.rejects(
    runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["ARRAY_COUNT(ARRAY_FOR(100000, i, ARRAY_COUNT(ARRAY_FOR(100000, j, i))))"] }, { timeoutSec: 1 }),
    (e) => e instanceof EvalTimeoutError && /1 秒を超えた/.test(e.message)
  );
  assert.ok(Date.now() - t0 < 10_000, `止めるのが遅い（${Date.now() - t0} ms）`);
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["2+2"] });
  assert.equal(r.formulas[0].text, "4");
});

test("メモリの上限: 子プロセスのヒープの上限を超えたら EvalMemoryError。親は落ちず、次の呼び出しに答える", { skip }, async () => {
  await assert.rejects(
    runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ['ARRAY_COUNT(ARRAY_FOR(30, j, ARRAY_FOR(100000, i, CONCAT("abcdefghij", i, j))))'] }, { heapLimitMb: 64 }),
    (e) => e instanceof EvalMemoryError && /64 MiB/.test(e.message)
  );
  const r = await runEval({ kind: "formulas", pluginZip: ZIP9, formulas: ["3+3"] });
  assert.equal(r.formulas[0].text, "6");
});

test("誤りの種類: zip が無い → zip、式の数が多すぎる → input（文はそのまま）", { skip }, async () => {
  await assert.rejects(runEval({ kind: "formulas", pluginZip: path.join(os.tmpdir(), "no-such-print-craft.zip"), formulas: ["1"] }), (e) => e instanceof EvalError && e.kind === "zip" && e.innerName === "PluginZipError");
  await assert.rejects(runEval({ kind: "formulas", pluginZip: ZIP9, formulas: Array.from({ length: 11 }, () => "1") }), (e) => e instanceof EvalError && e.kind === "input" && /1〜10/.test(e.message));
});

test("other の誤りは元の文を送らない（決まった文と、instanceof で決めた名前だけ）", () => {
  const c = classifyEvalError(new TypeError("秘密 /Users/x/secret.txt TOKEN-123"));
  assert.deepEqual(c, { kind: "other", name: "TypeError", message: "評価の中で想定外の誤り（TypeError）" });
  const fake = Object.assign(new Error("値"), { name: "InputError" });
  assert.equal(classifyEvalError(fake).kind, "other", "name を偽装しても input にならない");
});

// 子プロセスの入口を差し替えて、標準出力・標準エラーと終わり方を試す
function fakeEntry(body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-worker-"));
  const file = path.join(dir, "entry.mjs");
  writeFileSync(file, body);
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("子プロセスの標準出力・標準エラーは親に流さず文字数だけを数える", async () => {
  const e = fakeEntry(`process.once("message", () => { console.log("x".repeat(10)); console.error("yy"); process.send({ ok: true, outcome: { engine: {}, engineWarnings: [], diag: { pid: process.pid, threadId: 0, stdoutChars: 0, stderrChars: 0 } } }, () => process.disconnect()); });`);
  try {
    const r = await runEval({ kind: "formulas", formulas: ["1"] }, { workerFile: e.file });
    assert.deepEqual([r.diag.stdoutChars, r.diag.stderrChars], [11, 3]);
  } finally {
    e.cleanup();
  }
});

test("Worker thread のメモリの上限（ERR_WORKER_OUT_OF_MEMORY）は EvalMemoryError。標準出力は数えるだけ（素の JavaScript の入口で試す。印刷屋のエンジンはプロセスごと落ちることがある）", async () => {
  const oom = fakeEntry(`const a = []; for (;;) a.push("x".repeat(100) + Math.random());`);
  const out = fakeEntry(`import { parentPort } from "node:worker_threads"; console.log("abc"); parentPort.postMessage({ ok: true, outcome: { engine: {}, engineWarnings: [], diag: { pid: process.pid, threadId: 1, stdoutChars: 0, stderrChars: 0 } } });`);
  try {
    await assert.rejects(runEval({ kind: "formulas", formulas: ["1"] }, { isolation: "thread", workerFile: oom.file, heapLimitMb: 32 }), (e) => e instanceof EvalMemoryError && /32 MiB/.test(e.message));
    const r = await runEval({ kind: "formulas", formulas: ["1"] }, { isolation: "thread", workerFile: out.file });
    assert.deepEqual([r.diag.isolation, r.diag.stdoutChars], ["thread", 4]);
  } finally {
    oom.cleanup();
    out.cleanup();
  }
});

test("結果を返さずに終わった子プロセスは EvalExitError（終わるまで待つ）", async () => {
  const e = fakeEntry(`process.once("message", () => process.exit(3));`);
  try {
    await assert.rejects(runEval({ kind: "formulas", formulas: ["1"] }, { workerFile: e.file }), (x) => x instanceof EvalExitError && /exit 3/.test(x.message));
  } finally {
    e.cleanup();
  }
});

test("子プロセスの環境変数は動くのに要るものだけ（トークンや PATH は渡さない）", () => {
  const env = childEnv({ TZ: "Asia/Tokyo", KINTONE_API_TOKEN: "x", PCRAFT_KINTONE_CONFIG: "/x", PATH: "/bin", SystemRoot: "C:\\Windows" });
  assert.deepEqual(env, process.versions.electron ? { TZ: "Asia/Tokyo", SystemRoot: "C:\\Windows", ELECTRON_RUN_AS_NODE: "1" } : { TZ: "Asia/Tokyo", SystemRoot: "C:\\Windows" });
});

test("生の値は JSON にできる形に直す（循環・関数・クラスのインスタンス・深さ・大きさ）", () => {
  const a = [1];
  a.push(a);
  assert.deepEqual(toJsonSafe(a), [1, [1, [1, [1, "[入れ子が深い]"]]]]);
  assert.equal(toJsonSafe(() => 1), "[function]");
  class Big {
    toString() {
      return "123.45";
    }
  }
  assert.equal(toJsonSafe(new Big()), "123.45");
  assert.equal(toJsonSafe(Number.NaN), "NaN");
  assert.equal(toJsonSafe(undefined), null);
  const long = toJsonSafe(Array.from({ length: 150 }, (_, i) => i));
  assert.equal(long.length, 101);
  assert.match(long[100], /50 要素を省いた/);
});
