/**
 * 親（CLI・print-craft MCP）が評価を子プロセスに頼む口（print-craft の docs/authoring-try-plan.md 4.6。T0b）。
 * Evaluator は「どの zip を、どの入口・上限で評価するか」だけを持ち、エンジン（checker / runner）は持たない
 * （親の処理から zip の式を直接評価できないように。Codex r2 M5）。結果は子プロセスの normalizeSettings と同じ形に戻す
 */
import { Findings } from "../normalize/findings.ts";
import type { NormalizeResult } from "../commands/normalize.ts";
import type { PreviewResult } from "../commands/preview.ts";
import { validateTryInput, type TryInput, type TryOutcome } from "../commands/try.ts";
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

export interface PreviewInChildInput {
  settingsText: string;
  settingsFile?: string;
  fields: FieldsFile;
  /** レコードのファイルの中身（record コマンドの出力など） */
  recordFile: unknown;
  policy?: Policy;
  button?: string;
  /** 検証済みの接続先 */
  baseUrl?: string;
  /** 一覧帳票のボタンを描くときの一覧のレコード（選んだ順） */
  listRecords?: unknown[];
}

/** 子プロセスの preview の結果（PreviewResult と、子が読んだ zip の印刷屋の版、エンジンの読み込みの注意・診断） */
export type PreviewInChildResult = PreviewResult & { pluginVersion: string; engineWarnings: string[]; diag: EvalOutcome["diag"] };

/**
 * 帳票の試し出力（検査 → 描画 → 掃除 → verifyPreviewHtml）を子プロセスで行う（T0c）。重い式は時間とメモリの上限で止まる。
 * 誤りは runEval と同じ。レコードの形の誤りは EvalError（kind input）、描画の想定外の誤りは EvalError（kind other。文はレコードの値を含みうるので決まった文）
 */
export async function previewInChild(ev: Evaluator, input: PreviewInChildInput): Promise<PreviewInChildResult> {
  const outcome = await runEval(
    {
      kind: "preview",
      pluginZip: ev.pluginZip,
      devPluginDir: ev.devPluginDir,
      mode: ev.mode,
      baseUrl: input.baseUrl,
      preview: { settingsText: input.settingsText, settingsFile: input.settingsFile, fields: input.fields, recordFile: input.recordFile, policy: input.policy, button: input.button, listRecords: input.listRecords }
    },
    ev.run
  );
  const p = outcome.preview;
  if (!p) throw new Error("評価の子プロセスが preview の結果を返さなかった");
  const findings = new Findings();
  for (const f of p.findings) findings.add(f.level, f.rule, f.where, f.message);
  return { findings, results: p.results, skipped: p.skipped, summary: p.summary, pluginVersion: outcome.engine.pluginVersion, engineWarnings: outcome.engineWarnings, diag: outcome.diag };
}

/**
 * お試しアプリで式と帳票を試す（T3）。入力は親でも確かめる（validateTryInput。子プロセスを起こす前に断る）。ユーザー情報は既定のテストデータ。
 * 結果は値が架空なので、式の評価の値とエラーの文、ページの文字を含む（4.5）
 */
export async function tryInChild(ev: Evaluator, input: TryInput, opt: { baseUrl?: string } = {}): Promise<TryOutcome & { engineWarnings: string[]; diag: EvalOutcome["diag"] }> {
  validateTryInput(input);
  const outcome = await runEval({ kind: "try", pluginZip: ev.pluginZip, devPluginDir: ev.devPluginDir, mode: ev.mode, baseUrl: opt.baseUrl, users: "default", try: input }, ev.run);
  if (!outcome.try) throw new Error("評価の子プロセスが try の結果を返さなかった");
  return { ...outcome.try, engineWarnings: outcome.engineWarnings, diag: outcome.diag };
}

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
