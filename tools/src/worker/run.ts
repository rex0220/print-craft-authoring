/**
 * 評価を親（CLI・MCP）の外で動かし、時間とメモリの上限で止める（print-craft の docs/authoring-try-plan.md 4.6。T0a）。formula-authoring の tools/src/worker/run.ts を元にした。
 *   - 同期の dq はイベントループを塞ぐので、親ではなく別のプロセスかスレッドで動かす。1 回の呼び出しに 1 つ（使い回さない。状態は次に残らない）
 *   - 分け方（isolation）は動いている場所で決める（2026-10-20 Takashi「OK」。計画 Q1）:
 *     - process（既定。CLI、Claude Code のシステムの node）: 子プロセス（child_process.fork、IPC）。ヒープの上限（--max-old-space-size）で子プロセスが落ちても親は落ちない
 *     - thread（Electron の Node。Claude Desktop の built-in Node.js は runAsNode の fuse が切ってあり、child_process.fork を使えない）: Worker thread（resourceLimits）。
 *       時間の上限は効く（Worker を止める）。印刷屋のエンジンがヒープの上限に当たると、Worker だけでなくプロセス（MCP サーバー）ごと落ちることがある
 *       （2026-10-20 に試した。素の JavaScript では Worker だけが止まる）。受け入れた危険（計画 7 章）
 *   - 時間: 既定 60 秒（上限 600 秒）。超えたら止める（子プロセスは SIGKILL、Worker は terminate）。メモリ: V8 のヒープの上限（既定 1,024 MiB。値は T0d で測って決める）
 *   - 成功・誤り・時間切れ・メモリの上限・結果を返さない終わりのすべての道で、子プロセス・Worker が終わるまで待ってから返し、listener を外す
 *   - 標準出力・標準エラー（zip のコードの console の出力など）は親に流さず、文字数だけを数えて diag に入れる（計画 4.5）。
 *     子プロセスの標準エラーは、メモリの上限で落ちたかの印（V8 の "heap out of memory" など）を探すことにだけ使う（中身は持たない・返さない）
 *   - 渡す環境変数は、呼ぶ側が渡した環境変数（RunOptions.env）のうち動くのに要るものだけ（TZ、Windows の SystemRoot・windir、Electron の ELECTRON_RUN_AS_NODE）。
 *     中核は process.env を読まない（core-boundary のテスト）。ファイルを読めなくする隔離ではない
 *   - 入口は、ビルドでは dist/eval-worker.mjs（cli.mjs・core.mjs の隣）、ソースから動かすときは src/worker/eval-worker.ts（子プロセスと Worker のどちらでも動く）。
 *     print-craft MCP（束ねた CJS）は workerFile で入口の絶対パスを渡す
 *   - inline（親の中で動かす）はテストだけの引数。環境変数では有効にならない（計画 4.6）
 * zip のコードは子プロセス・Worker でも同じ OS ユーザーの権限で動く（sandbox ではない）。上限は暴走を止める保険で、隔離ではない
 */
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { classifyEvalError, runEvalJob } from "./eval-run.ts";
import type { EvalErrorKind, EvalJob, EvalMessage, EvalOutcome } from "./eval-job.ts";

export const DEFAULT_TIMEOUT_SEC = 60;
export const MAX_TIMEOUT_SEC = 600;
/** V8 のヒープの上限（MiB。子プロセスは --max-old-space-size、Worker は resourceLimits.maxOldGenerationSizeMb。値は T0d で測って決める） */
export const DEFAULT_HEAP_LIMIT_MB = 1024;

/** 評価の分け方: process = 子プロセス、thread = Worker thread */
export type Isolation = "process" | "thread";

/** 時間の上限で止めた */
export class EvalTimeoutError extends Error {}
/** メモリの上限（V8 のヒープ）で止まった */
export class EvalMemoryError extends Error {}
/** 子プロセス・Worker が結果を返さずに終わった */
export class EvalExitError extends Error {}
/**
 * 子プロセス・Worker の中の誤り（kind / name / code を持って戻す）。kind は中核が instanceof で決めた種類（input / zip / policy / other）。
 * other の文は決まった文（中で元の文を送らない）
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
  /** 分け方（省略は defaultIsolation。テストは両方を試す） */
  isolation?: Isolation;
  /** 入口（絶対パス）。省略すれば自分の隣の eval-worker.mjs / eval-worker.ts */
  workerFile?: string;
  /** V8 のヒープの上限（MiB。省略は DEFAULT_HEAP_LIMIT_MB。テストは小さくして試す） */
  heapLimitMb?: number;
  /** 呼ぶ側の環境変数（CLI は process.env、MCP は起動のときの env）。ここから childEnv が要るものだけを選ぶ。省略は空 */
  env?: Record<string, string | undefined>;
}

/**
 * 環境変数の上限（PCRAFT_EVAL_TIMEOUT_SEC = 秒、PCRAFT_EVAL_HEAP_MB = MiB。重い帳票で上げるときと、テストで小さくして試すとき。T0d）。
 * 中核は process.env を読まないので、呼ぶ側（CLI は .env を含む環境変数、MCP は設定項目の値）の env を渡す。整数でなければ使わない。範囲に丸める
 */
export function evalLimitsFromEnv(env: Record<string, string | undefined> = {}): Pick<RunOptions, "timeoutSec" | "heapLimitMb"> {
  const int = (v: string | undefined): number | undefined => (v !== undefined && /^\d+$/.test(v.trim()) ? Number(v.trim()) : undefined);
  const t = int(env.PCRAFT_EVAL_TIMEOUT_SEC);
  const h = int(env.PCRAFT_EVAL_HEAP_MB);
  return {
    ...(t !== undefined ? { timeoutSec: Math.min(Math.max(t, 1), MAX_TIMEOUT_SEC) } : {}),
    ...(h !== undefined ? { heapLimitMb: Math.min(Math.max(h, 32), 4096) } : {})
  };
}

/** 入口が無い（パスは文に入れない。print-craft MCP が AI に返すため） */
const missingEntry = (): EvalError => new EvalError("評価の子プロセスの入口が無い（tools / print-craft MCP を入れ直す）", "Error", undefined, "other");

/** 自分の隣の入口（ビルド: dist/eval-worker.mjs。ソース: src/worker/eval-worker.ts） */
export function defaultWorkerFile(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  const built = path.join(dir, "eval-worker.mjs");
  if (here.endsWith(".mjs") && existsSync(built)) return built;
  const src = path.join(dir, "eval-worker.ts");
  if (existsSync(src)) return src;
  throw missingEntry();
}

/** 動いている場所の分け方: Electron の Node（Claude Desktop など。子プロセスを起こせないことがある）は thread、ほかは process */
export function defaultIsolation(): Isolation {
  return process.versions.electron ? "thread" : "process";
}

/** 渡す環境変数（呼ぶ側の環境変数のうち、動くのに要るものだけ） */
export function childEnv(env: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["TZ", "SystemRoot", "windir", "ELECTRON_RUN_AS_NODE"]) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  // Electron の Node から子プロセスを起こすときは、子プロセスも Node として動かす（runAsNode の fuse が切ってあれば fork 自体が使えない → thread）
  if (process.versions.electron && out.ELECTRON_RUN_AS_NODE === undefined) out.ELECTRON_RUN_AS_NODE = "1";
  return out;
}

const OOM_MARK = /heap out of memory|Reached heap limit|Allocation failed/;
/** 印が 2 つのかたまりにまたがっても見つけるため、前のかたまりの最後をこれだけ残す */
const MARK_CARRY = 64;

type Settled = { ok: true; outcome: EvalOutcome } | { ok: false; error: Error };

const timeoutError = (sec: number): EvalTimeoutError => new EvalTimeoutError(`評価が ${sec} 秒を超えたので止めた（式が重いか無限に近い繰り返し。上限 ${MAX_TIMEOUT_SEC} 秒）`);
const memoryError = (mb: number): EvalMemoryError => new EvalMemoryError(`評価がメモリの上限（${mb} MiB）を超えたので止まった（式が大きな値を作っている）`);
const fromMessage = (m: EvalMessage): Settled =>
  m && m.ok === true
    ? { ok: true, outcome: m.outcome }
    : m && m.ok === false
      ? { ok: false, error: new EvalError(m.error.message, m.error.name, m.error.code, m.error.kind ?? "other") }
      : { ok: false, error: new EvalError("評価の結果の形が違う", "Error", undefined, "other") };

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
    if (!path.isAbsolute(opt.workerFile) || !existsSync(opt.workerFile)) throw missingEntry();
    entry = opt.workerFile;
  } else entry = defaultWorkerFile();
  const heapLimitMb = Math.max(16, Math.floor(opt.heapLimitMb ?? DEFAULT_HEAP_LIMIT_MB));
  const isolation = opt.isolation ?? defaultIsolation();
  return isolation === "thread" ? runInThread(job, entry, timeoutSec, heapLimitMb, opt.env) : runInProcess(job, entry, timeoutSec, heapLimitMb, opt.env);
}

async function runInProcess(job: EvalJob, entry: string, timeoutSec: number, heapLimitMb: number, env: RunOptions["env"]): Promise<EvalOutcome> {
  const child = fork(entry, [], {
    execArgv: [`--max-old-space-size=${heapLimitMb}`],
    env: childEnv(env),
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
      finish({ ok: false, error: timeoutError(timeoutSec) });
    }, timeoutSec * 1000);
    child.on("message", (m: EvalMessage) => finish(fromMessage(m)));
    child.on("error", () => finish({ ok: false, error: new EvalError("評価の子プロセスを起こせない", "Error", undefined, "other") }));
    // 結果を返さずに終わった（メモリの上限で落ちた、など）。判定は close の後に標準エラーの印で行う
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
    if (!timedOut && settled.error instanceof EvalExitError && oomSeen) throw memoryError(heapLimitMb);
    if (settled.error instanceof EvalExitError) throw new EvalExitError(`評価の子プロセスが結果を返さずに終わった（exit ${ended.code ?? ended.signal}）`);
    throw settled.error;
  }
  settled.outcome.diag.isolation = "process";
  settled.outcome.diag.stdoutChars = stdoutChars;
  settled.outcome.diag.stderrChars = stderrChars;
  return settled.outcome;
}

async function runInThread(job: EvalJob, entry: string, timeoutSec: number, heapLimitMb: number, env: RunOptions["env"]): Promise<EvalOutcome> {
  const worker = new Worker(entry, { workerData: job, stdout: true, stderr: true, env: childEnv(env), resourceLimits: { maxOldGenerationSizeMb: heapLimitMb } });
  const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  let stdoutChars = 0;
  let stderrChars = 0;
  worker.stdout.on("data", (d: Buffer | string) => (stdoutChars += String(d).length));
  worker.stderr.on("data", (d: Buffer | string) => (stderrChars += String(d).length));

  const settled = await new Promise<Settled>((resolve) => {
    let done = false;
    const finish = (s: Settled): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(s);
    };
    const timer = setTimeout(() => finish({ ok: false, error: timeoutError(timeoutSec) }), timeoutSec * 1000);
    worker.on("message", (m: EvalMessage) => finish(fromMessage(m)));
    worker.on("messageerror", () => finish({ ok: false, error: new EvalError("評価の結果を受け取れない（送れない値）", "Error", undefined, "other") }));
    // 中で捕まえられなかった例外（読み込みの失敗、メモリの上限など）。文は信用しない
    worker.on("error", (e: Error & { code?: string }) => {
      if (e?.code === "ERR_WORKER_OUT_OF_MEMORY") finish({ ok: false, error: memoryError(heapLimitMb) });
      else finish({ ok: false, error: new EvalError("評価の Worker で想定外の誤り", "Error", undefined, "other") });
    });
    worker.on("exit", (code) => finish({ ok: false, error: new EvalExitError(`評価の Worker が結果を返さずに終わった（exit ${code}）`) }));
  });

  // どの道でも Worker が終わるまで待ってから返す（terminate は終わった Worker にも呼べる）
  await worker.terminate().catch(() => undefined);
  await exited;
  worker.removeAllListeners();
  worker.stdout.removeAllListeners();
  worker.stderr.removeAllListeners();
  if (!settled.ok) throw settled.error;
  settled.outcome.diag.isolation = "thread";
  settled.outcome.diag.stdoutChars = stdoutChars;
  settled.outcome.diag.stderrChars = stderrChars;
  return settled.outcome;
}
