/**
 * 評価の子プロセスの入口（dist/eval-worker.mjs。print-craft の docs/authoring-try-plan.md 4.6）。
 * 親から IPC で仕事（EvalJob）を 1 つ受け取り、結果を 1 回だけ返して終わる（親も結果を受け取ったら止める）
 */
import { classifyEvalError, runEvalJob } from "./eval-run.ts";
import type { EvalJob, EvalMessage } from "./eval-job.ts";

const post = (m: EvalMessage): void => {
  if (!process.send) return;
  process.send(m, () => process.disconnect());
};
process.once("message", (job: unknown) => {
  runEvalJob(job as EvalJob)
    .then((outcome) => post({ ok: true, outcome }))
    // 種類（kind）は中核のクラスの instanceof で決める。other の文は送らない
    .catch((e: unknown) => post({ ok: false, error: classifyEvalError(e) }));
});
