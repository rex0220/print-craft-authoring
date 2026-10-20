/**
 * 親（CLI・print-craft MCP）が評価を子プロセスに頼む口（print-craft の docs/authoring-try-plan.md 4.6。T0b）。
 * Evaluator は「どの zip を、どの入口・上限で評価するか」だけを持ち、エンジン（checker / runner）は持たない
 * （親の処理から zip の式を直接評価できないように。Codex r2 M5）。結果は子プロセスの normalizeSettings と同じ形に戻す
 */
import { Findings } from "../normalize/findings.ts";
import type { NormalizeResult } from "../commands/normalize.ts";
import type { FieldsFile } from "../commands/fields.ts";
import type { Policy } from "../normalize/policy.ts";
import { runEval, type RunOptions } from "./run.ts";
import type { EvalOutcome } from "./eval-job.ts";

export interface Evaluator {
  /** 印刷屋の zip（絶対パス） */
  pluginZip?: string;
  /** 開発中（mode dev）の読み込み元（CLI が PCRAFT_ALLOW_DEV_PLUGIN=1 のときだけ渡す） */
  devPluginDir?: string;
  mode?: "build" | "dev";
  /** 子プロセスの入口・時間とメモリの上限・環境変数（runEval の引数） */
  run?: RunOptions;
}

export interface NormalizeInChildInput {
  settingsText: string;
  settingsFile?: string;
  fields: FieldsFile;
  policy?: Policy;
  check?: boolean;
  /** 検証済みの接続先（APP_URL などの元、iframe の同一オリジンの判定） */
  baseUrl?: string;
}

/** 子プロセスの normalize の結果（NormalizeResult と、エンジンの読み込みの注意・診断） */
export type NormalizeInChildResult = NormalizeResult & { engineWarnings: string[]; diag: EvalOutcome["diag"] };

/** 設定の正規化（検査と派生値）を子プロセスで行う。誤りは runEval と同じ（EvalError / EvalTimeoutError / EvalMemoryError / EvalExitError） */
export async function normalizeInChild(ev: Evaluator, input: NormalizeInChildInput): Promise<NormalizeInChildResult> {
  const outcome = await runEval(
    {
      kind: "normalize",
      pluginZip: ev.pluginZip,
      devPluginDir: ev.devPluginDir,
      mode: ev.mode,
      baseUrl: input.baseUrl,
      normalize: { settingsText: input.settingsText, settingsFile: input.settingsFile, fields: input.fields, policy: input.policy, check: input.check }
    },
    ev.run
  );
  const n = outcome.normalize;
  if (!n) throw new Error("評価の子プロセスが normalize の結果を返さなかった");
  const findings = new Findings();
  for (const f of n.findings) findings.add(f.level, f.rule, f.where, f.message);
  return { findings, output: n.output, body: n.body, size: n.size, checkDiffs: n.checkDiffs, summary: n.summary, engineWarnings: outcome.engineWarnings, diag: outcome.diag };
}
