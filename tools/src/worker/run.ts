/**
 * 評価を子プロセスで動かし、時間とメモリの上限で止める（print-craft の docs/authoring-try-plan.md 4.6。T0a）。formula-authoring の tools/src/worker/run.ts を元にした。
 *   - 同期の dq はイベントループを塞ぐので、親（CLI・MCP）ではなく子プロセスで動かす。1 回の呼び出しに子プロセス 1 つ（使い回さない。状態は次に残らない）
 *   - Worker thread にしない理由（2026-10-20 に試した。計画 Q1 の決まりで子プロセスに替えた）: resourceLimits を付けた Worker で印刷屋のエンジンが
 *     ヒープの上限に当たると、Worker だけでなくプロセス全体が FATAL ERROR（heap out of memory）で落ちた。素の JavaScript では Worker だけが止まる
 *   - 時間: 既定 60 秒（上限 600 秒）。超えたら子プロセスを SIGKILL で止める。メモリ: 子プロセスの --max-old-space-size（V8 のヒープの上限）。
 *     超えると子プロセスが落ちる（親は落ちない）。値は T0d で測って決める
 *   - 成功・誤り・時間切れ・メモリの上限・結果を返さない終わりのすべての道で、子プロセスが終わる（exit）まで待ってから返し、listener を外す
 *   - 子プロセスの標準出力・標準エラー（zip のコードの console の出力など）は親に流さず、文字数だけを数えて diag に入れる（計画 4.5）。
 *     標準エラーは、メモリの上限で落ちたかの印（V8 の "heap out of memory" など）を探すことにだけ使う（中身は持たない・返さない）
 *   - 子プロセスに渡す環境変数は、呼ぶ側が渡した環境変数（RunOptions.env）のうち動くのに要るものだけ（TZ、Windows の SystemRoot・windir、Electron の ELECTRON_RUN_AS_NODE）。
 *     中核は process.env を読まない（core-boundary のテスト）。ファイルを読めなくする隔離ではない
 *   - 子プロセスの入口は、ビルドでは dist/eval-worker.mjs（cli.mjs・core.mjs の隣）、ソースから動かすときは src/worker/eval-worker.ts。
 *     print-craft MCP（束ねた CJS）は workerFile で入口の絶対パスを渡す
 *   - inline（親の中で動かす）はテストだけの引数。環境変数では有効にならない（計画 4.6）
 * zip のコードは子プロセスでも同じ OS ユーザーの権限で動く（sandbox ではない）。上限は暴走を止める保険で、隔離ではない
 */
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyEvalError, runEvalJob } from "./eval-run.ts";
import type { EvalErrorKind, EvalJob, EvalMessage, EvalOutcome } from "./eval-job.ts";

export const DEFAULT_TIMEOUT_SEC = 60;
export const MAX_TIMEOUT_SEC = 600;
/** 子プロセスの V8 のヒープの上限（MiB。--max-old-space-size。値は T0d で測って決める） */
export const DEFAULT_HEAP_LIMIT_MB = 1024;

/** 時間の上限で止めた */
export class EvalTimeoutError extends Error {}
/** 子プロセスのメモリの上限（V8 のヒープ）で止まった */
export class EvalMemoryError extends Error {}
/** 子プロセスが結果を返さずに終わった */
export class EvalExitError extends Error {}
/**
 * 子プロセスの中の誤り（kind / name / code を持って戻す）。kind は中核が instanceof で決めた種類（input / zip / policy / other）。
 * other の文は決まった文（子プロセスが元の文を送らない）
 */
export class EvalError extends Error {
  readonly innerName: string;
  readonly code?: string;
  readonly kind: EvalErrorKind;
  constructor(message: string, innerName: string, code?: string, kind: EvalErrorKind = "other") {
    super(message);
    this.innerName = innerName;
    this.code = code;
    this.kind = kind;
  }
}

export interface RunOptions {
  timeoutSec?: number;
  /** 親の中で動かす（テストだけ） */
  inline?: boolean;
  /** 子プロセスの入口（絶対パス）。省略すれば自分の隣の eval-worker.mjs / eval-worker.ts */
  workerFile?: string;
  /** 子プロセスの V8 のヒープの上限（MiB。省略は DEFAULT_HEAP_LIMIT_MB。テストは小さくして試す） */
  heapLimitMb?: number;
  /** 呼ぶ側の環境変数（CLI は process.env、MCP は起動のときの env）。ここから childEnv が要るものだけを選ぶ。省略は空 */
  env?: Record<string, string | undefined>;
}

/** 自分の隣の子プロセスの入口（ビルド: dist/eval-worker.mjs。ソース: src/worker/eval-worker.ts） */
export function defaultWorkerFile(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  const built = path.join(dir, "eval-worker.mjs");
  if (here.endsWith(".mjs") && existsSync(built)) return built;
  const src = path.join(dir, "eval-worker.ts");
  if (existsSync(src)) return src;
  throw new Error(`評価の子プロセスの入口が無い: ${built}`);
}

/** 子プロセスに渡す環境変数（呼ぶ側の環境変数のうち、動くのに要るものだけ） */
export function childEnv(env: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["TZ", "SystemRoot", "windir", "ELECTRON_RUN_AS_NODE"]) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  // Electron の Node（Claude Desktop など）から起こすときは、子プロセスも Node として動かす
  if (process.versions.electron && out.ELECTRON_RUN_AS_NODE === undefined) out.ELECTRON_RUN_AS_NODE = "1";
  return out;
}

const OOM_MARK = /heap out of memory|Reached heap limit|Allocation failed/;
/** 印が 2 つのかたまりにまたがっても見つけるため、前のかたまりの最後をこれだけ残す */
const MARK_CARRY = 64;

type Settled = { ok: true; outcome: EvalOutcome } | { ok: false; error: Error };

export async function runEval(job: EvalJob, opt: RunOptions = {}): Promise<EvalOutcome> {
  const timeoutSec = Math.min(Math.max(opt.timeoutSec ?? DEFAULT_TIMEOUT_SEC, 1), MAX_TIMEOUT_SEC);
  if (opt.inline) {
    try {
      return await runEvalJob(job);
    } catch (e) {
      const c = classifyEvalError(e);
      throw new EvalError(c.message, c.name, c.code, c.kind);
    }
  }
  let entry: string;
  if (opt.workerFile !== undefined) {
    if (!path.isAbsolute(opt.workerFile) || !existsSync(opt.workerFile)) throw new Error(`評価の子プロセスの入口が無い（絶対パスで指定する）: ${opt.workerFile}`);
    entry = opt.workerFile;
  } else entry = defaultWorkerFile();
  const heapLimitMb = Math.max(16, Math.floor(opt.heapLimitMb ?? DEFAULT_HEAP_LIMIT_MB));

  const child = fork(entry, [], {
    execArgv: [`--max-old-space-size=${heapLimitMb}`],
    env: childEnv(opt.env),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "advanced",
    windowsHide: true
  });
  // close は exit の後、標準出力・標準エラー・IPC が閉じてから来る（最後のメッセージと標準エラーを取りこぼさない）
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let stdoutChars = 0;
  let stderrChars = 0;
  let carry = "";
  let oomSeen = false;
  child.stdout?.on("data", (d: Buffer | string) => (stdoutChars += String(d).length));
  child.stderr?.on("data", (d: Buffer | string) => {
    const s = String(d);
    stderrChars += s.length;
    if (!oomSeen && OOM_MARK.test(carry + s)) oomSeen = true;
    carry = s.slice(-MARK_CARRY);
  });

  let timedOut = false;
  const settled = await new Promise<Settled>((resolve) => {
    let done = false;
    const finish = (s: Settled): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(s);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      finish({ ok: false, error: new EvalTimeoutError(`評価が ${timeoutSec} 秒を超えたので止めた（式が重いか無限に近い繰り返し。上限 ${MAX_TIMEOUT_SEC} 秒）`) });
    }, timeoutSec * 1000);
    child.on("message", (m: EvalMessage) => {
      if (m && m.ok === true) finish({ ok: true, outcome: m.outcome });
      else if (m && m.ok === false) finish({ ok: false, error: new EvalError(m.error.message, m.error.name, m.error.code, m.error.kind ?? "other") });
      else finish({ ok: false, error: new EvalError("評価の結果の形が違う", "Error", undefined, "other") });
    });
    child.on("error", () => finish({ ok: false, error: new EvalError("評価の子プロセスを起こせない", "Error", undefined, "other") }));
    // 結果を返さずに終わった（メモリの上限で落ちた、など）。判定は close の後に標準エラーの最後で行う
    child.on("close", () => finish({ ok: false, error: new EvalExitError("評価の子プロセスが結果を返さずに終わった") }));
    child.send(job, (e) => {
      if (e) finish({ ok: false, error: new EvalError("評価の子プロセスに仕事を渡せない", "Error", undefined, "other") });
    });
  });

  // どの道でも子プロセスが終わるまで待ってから返す
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  const ended = await closed;
  child.removeAllListeners();
  child.stdout?.removeAllListeners();
  child.stderr?.removeAllListeners();
  if (!settled.ok) {
    if (!timedOut && settled.error instanceof EvalExitError && oomSeen) {
      throw new EvalMemoryError(`評価が子プロセスのメモリの上限（${heapLimitMb} MiB）を超えたので止まった（式が大きな値を作っている）`);
    }
    if (settled.error instanceof EvalExitError) throw new EvalExitError(`評価の子プロセスが結果を返さずに終わった（exit ${ended.code ?? ended.signal}）`);
    throw settled.error;
  }
  settled.outcome.diag.stdoutChars = stdoutChars;
  settled.outcome.diag.stderrChars = stderrChars;
  return settled.outcome;
}
