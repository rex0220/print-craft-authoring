/**
 * 子プロセスの中でも主スレッド（inline。テスト）でも同じ: 仕事 → 結果（zip の読み込み、式の評価）。print-craft の docs/authoring-try-plan.md 4.5・4.6（T0a）。
 * 誤りの種類の決め方は formula-authoring の tools/src/worker/eval-run.ts と同じ（instanceof。zip のコードの name は使わない）
 */
import { threadId } from "node:worker_threads";
import { DEFAULT_CONTEXT_BASE_URL, loadEngine, type Engine } from "../engine.ts";
import { InputError, normalizeSettings } from "../commands/normalize.ts";
import { runPreview } from "../commands/preview.ts";
import { runTry } from "../commands/try.ts";
import { DEFAULT_USERS, defaultUsersInfo } from "../try-apps/users/index.ts";
import { PluginZipError } from "../plugin-zip.ts";
import { PolicyError } from "../normalize/policy.ts";
import { MAX_JOB_FORMULAS, MAX_MESSAGE_BYTES, MAX_PREVIEW_MESSAGE_BYTES, MAX_VALUE_BYTES, type EvalJob, type EvalMessage, type EvalOutcome, type FormulaEvalResult } from "./eval-job.ts";
import { byteLength, cutText, evaluationErrorText, toJsonSafe } from "./values.ts";

export { cutText, evaluationErrorText, toJsonSafe };

/**
 * 子プロセスの中の誤りを種類に分ける。other の文は送らない（決まった文だけ。zip のコードの例外は値やパスを含みうる。計画 4.5）。
 * name は instanceof で決めた固定の名前（例外の name / constructor.name は使わない）
 */
export function classifyEvalError(e: unknown): Extract<EvalMessage, { ok: false }>["error"] {
  const message = String((e as { message?: unknown } | undefined)?.message ?? e);
  if (e instanceof InputError) return { kind: "input", name: "InputError", message };
  if (e instanceof PluginZipError) return { kind: "zip", name: "PluginZipError", message, code: e.code };
  if (e instanceof PolicyError) return { kind: "policy", name: "PolicyError", message };
  const name = builtinErrorName(e);
  return { kind: "other", name, message: `評価の中で想定外の誤り（${name}）` };
}

/** JavaScript の組み込みの Error の種類（instanceof）。それ以外は Error */
export function builtinErrorName(e: unknown): string {
  if (e instanceof TypeError) return "TypeError";
  if (e instanceof RangeError) return "RangeError";
  if (e instanceof ReferenceError) return "ReferenceError";
  if (e instanceof SyntaxError) return "SyntaxError";
  if (e instanceof URIError) return "URIError";
  return "Error";
}

/** 1 つの式を評価する（dq の直近だけを catch = 式の評価のエラー。その後の直しの失敗は evaluationError に入れない） */
function evaluateOne(dq: (expression: string) => unknown, formula: string): FormulaEvalResult {
  let value: unknown;
  try {
    value = dq(formula);
  } catch (e) {
    return { evaluationError: evaluationErrorText(e) };
  }
  try {
    const text = value == null ? "" : String(value);
    if (byteLength(text) > MAX_VALUE_BYTES) return { tooLarge: true };
    const raw = toJsonSafe(value);
    return typeof raw === "string" && raw === text ? { text } : { text, raw };
  } catch {
    return { convertFailed: true };
  }
}

/** 既定のテストデータ（架空）のユーザー情報を入れる。ログインユーザーは authoring（テストデータの 10 人目。formula の calc の既定と同じ）。scripts/verify-patterns.mjs も使う */
export function setDefaultUsers(engine: Engine): void {
  const login = DEFAULT_USERS.users.find((u) => u.code === "authoring");
  engine.setUsers(defaultUsersInfo());
  if (login) engine.setContext({ loginUser: { id: String(login.id), code: login.code, name: login.name, email: login.email ?? "", language: login.locale ?? "ja" } });
}

export async function runEvalJob(job: EvalJob): Promise<EvalOutcome> {
  const engine = await loadEngine({ pluginZip: job.pluginZip, devPluginDir: job.devPluginDir, mode: job.mode });
  if (job.baseUrl) engine.setContext({ baseUrl: job.baseUrl });
  if (job.users === "default") setDefaultUsers(engine);
  const outcome: EvalOutcome = {
    engine: { pluginVersion: engine.source.pluginVersion, apiVersion: engine.api.apiVersion, engineSha256: engine.source.engineSha256, decimalSha256: engine.source.decimalSha256 },
    engineWarnings: [...engine.warnings],
    diag: { pid: process.pid, threadId, stdoutChars: 0, stderrChars: 0 }
  };
  if (job.kind === "formulas") {
    const formulas = job.formulas ?? [];
    if (formulas.length === 0 || formulas.length > MAX_JOB_FORMULAS) throw new InputError(`式の数は 1〜${MAX_JOB_FORMULAS}（${formulas.length}）`);
    if (formulas.some((f) => typeof f !== "string")) throw new InputError("式は文字列");
    const kf = engine.runner({}, {});
    outcome.formulas = formulas.map((f) => evaluateOne((x) => kf.dq(x), f));
  } else if (job.kind === "normalize") {
    const n = job.normalize;
    if (!n || typeof n.settingsText !== "string" || !n.fields) throw new InputError("normalize の仕事に設定か項目定義が無い（normalize.settingsText / normalize.fields）");
    // 接続先と appId は保存・CLI の normalize と同じ（APP_URL などの元。接続先が無ければ実在しないテナント）
    engine.setContext({ baseUrl: job.baseUrl ?? DEFAULT_CONTEXT_BASE_URL, appId: n.fields.appId });
    const res = await normalizeSettings({ settingsText: n.settingsText, settingsFile: n.settingsFile, fields: n.fields, engine, policy: n.policy, check: n.check, baseUrl: job.baseUrl });
    outcome.normalize = { findings: [...res.findings.items], output: res.output, body: res.body, size: res.size, checkDiffs: res.checkDiffs, summary: res.summary };
  } else if (job.kind === "preview") {
    const p = job.preview;
    if (!p || typeof p.settingsText !== "string" || !p.fields) throw new InputError("preview の仕事に設定か項目定義が無い（preview.settingsText / preview.fields）");
    // 検査・接続先と appId（setContext）・描画・掃除は runPreview の中（親で動かしていたときと同じ）
    const res = await runPreview({ settingsText: p.settingsText, settingsFile: p.settingsFile, fields: p.fields, recordFile: p.recordFile, engine, policy: p.policy, button: p.button, baseUrl: job.baseUrl, listRecords: p.listRecords });
    outcome.preview = { findings: [...res.findings.items], results: res.results, skipped: res.skipped, summary: res.summary };
    if (byteLength(JSON.stringify(outcome)) > MAX_PREVIEW_MESSAGE_BYTES) throw new InputError(`帳票の HTML が大きすぎて返せない（${MAX_PREVIEW_MESSAGE_BYTES.toLocaleString()} バイトまで。--button で 1 つのボタンに絞る）`);
  } else if (job.kind === "try") {
    // ユーザー情報は既定のテストデータ（tryInChild が users: "default" を渡す）。結果の大きさの上限は runTry の中、HTML を含むメッセージは preview と同じ上限
    outcome.try = await runTry(engine, job.try, job.baseUrl);
    if (byteLength(JSON.stringify(outcome)) > MAX_PREVIEW_MESSAGE_BYTES) throw new InputError(`お試しの帳票の HTML が大きすぎて返せない（${MAX_PREVIEW_MESSAGE_BYTES.toLocaleString()} バイトまで。records で 1 件に絞る）`);
  } else throw new InputError(`知らない仕事: ${String((job as { kind?: unknown }).kind)}`);
  outcome.diag.maxRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  // メッセージの上限: 超えたら生の値を省き、それでも超えたら文字を省く（計画 4.2）
  if (byteLength(JSON.stringify(outcome)) > MAX_MESSAGE_BYTES && outcome.formulas) {
    outcome.formulas = outcome.formulas.map(({ raw: _raw, ...rest }) => rest);
    outcome.diag.rawDropped = true;
    if (byteLength(JSON.stringify(outcome)) > MAX_MESSAGE_BYTES) outcome.formulas = outcome.formulas.map((r) => (r.text === undefined ? r : { tooLarge: true }));
  }
  return outcome;
}
