/**
 * 評価の入口（dist/eval-worker.mjs。print-craft の docs/authoring-try-plan.md 4.6）。子プロセスと Worker thread のどちらでも動く（run.ts の isolation）:
 *   - 子プロセス: 親から IPC で仕事（EvalJob）を 1 つ受け取り、結果を 1 回だけ返して終わる（親も結果を受け取ったら止める）
 *   - Worker thread（Claude Desktop の Electron の Node）: workerData の仕事を評価し、parentPort に 1 回だけ返す
 */
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { classifyEvalError, runEvalJob } from "./eval-run.ts";
import type { EvalJob, EvalMessage } from "./eval-job.ts";

const run = (job: unknown, post: (m: EvalMessage) => void): void => {
  runEvalJob(job as EvalJob)
    .then((outcome) => post({ ok: true, outcome }))
    // 種類（kind）は中核のクラスの instanceof で決める。other の文は送らない
    .catch((e: unknown) => post({ ok: false, error: classifyEvalError(e) }));
};

if (!isMainThread && parentPort) {
  const port = parentPort;
  run(workerData, (m) => port.postMessage(m));
} else {
  process.once("message", (job: unknown) =>
    run(job, (m) => {
      if (process.send) process.send(m, () => process.disconnect());
    })
  );
}
