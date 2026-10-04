/**
 * normalize <settings.json> --fields <fields.json> [--out <path>] [--check] [--policy <path>] [--json]
 * AI が書いた封筒形式の設定 JSON を、設定画面と同じ手順で派生値を作り直し（derive.ts）、検査して（checks.ts）、保存値の大きさを測り（size.ts）、
 * エラーが無ければ封筒形式で書き出す（date を更新）。--check は入力の派生値と生成した値の差を出す（AI の自己点検、エクスポートの往復の確認）。
 * 印刷屋のコード（スキーマ、派生値、kit の検証）は利用者の zip の authoring API（engine.api）から。終了コード: エラーがあれば 1（書き出さない）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Engine } from "../engine.ts";
import type { FieldsFile } from "./fields.ts";
import { Findings } from "../normalize/findings.ts";
import { buildModel } from "../normalize/model.ts";
import { bodyOf, deriveBody, ENVELOPE_KEYS } from "../normalize/derive.ts";
import { checkBody } from "../normalize/checks.ts";
import { loadPolicy, type Policy } from "../normalize/policy.ts";
import { formatSize, measureStored, type StoredSize } from "../normalize/size.ts";

export const PLUGIN_NAME = "印刷屋プラグイン";

export interface NormalizeInput {
  settingsText: string;
  settingsFile?: string;
  fields: FieldsFile;
  engine: Engine;
  policy?: Policy;
  check?: boolean;
  now?: () => Date;
}

export interface NormalizeResult {
  findings: Findings;
  output?: Record<string, unknown>;
  body?: Record<string, unknown>;
  size?: StoredSize;
  checkDiffs?: string[];
  summary: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 2 つの値の差を path 付きで集める（短く） */
export function jsonDiff(a: unknown, b: unknown, pathStr: string, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${pathStr}.${k}`, out);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => jsonDiff(x, b[i], `${pathStr}[${i}]`, out));
    return;
  }
  const short = (v: unknown): string => {
    const s = JSON.stringify(v);
    return s === undefined ? "undefined" : s.length > 100 ? s.slice(0, 100) + "…" : s;
  };
  out.push(`${pathStr}: ${short(a)} → ${short(b)}`);
}

export async function normalizeSettings(input: NormalizeInput): Promise<NormalizeResult> {
  const f = new Findings();
  const api = input.engine.api;
  const pluginVersion = api.pluginVersion;
  const where = input.settingsFile ?? "settings";
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(input.settingsText) as Record<string, unknown>;
  } catch (e) {
    f.error("json", where, `JSON として読めない: ${(e as Error).message}`);
    return { findings: f, summary: "JSON を読めない" };
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    f.error("json", where, "JSON の最上位はオブジェクト（封筒形式）");
    return { findings: f, summary: "封筒形式でない" };
  }
  // ---- 封筒 ----
  if (envelope.pluginID !== api.pluginId) f.error("envelope.pluginID", where, `pluginID は "${api.pluginId}": ${JSON.stringify(envelope.pluginID)}（封筒なしの素の設定は作らない）`);
  if (String(envelope.PluginVersion ?? "") !== pluginVersion) f.error("envelope.version", where, `PluginVersion は印刷屋の版 ${pluginVersion}（zip の manifest）: ${JSON.stringify(envelope.PluginVersion)}`);
  if (envelope.appId !== undefined && Number(envelope.appId) !== input.fields.appId) f.warning("envelope.appId", where, `appId ${JSON.stringify(envelope.appId)} が fields のアプリ ${input.fields.appId} と違う`);
  if (f.hasErrors) return { findings: f, summary: "封筒の誤り" };

  // ---- 設定本体のスキーマ ----
  const inputBody = bodyOf(envelope);
  let inputClean: Record<string, unknown>;
  try {
    inputClean = api.validate<Record<string, unknown>>(inputBody, api.CONFIG_SCHEMA, api.CONFIG_LIMITS);
  } catch (e) {
    if (e instanceof api.ValidationError) {
      f.error("schema", where, `設定のスキーマに合わない: ${e.message}`);
      return { findings: f, summary: "スキーマの誤り" };
    }
    throw e;
  }

  // ---- 派生値 → 検査 → 大きさ ----
  const model = buildModel(input.fields, api);
  const body = deriveBody(inputBody, model, input.engine, f);
  const policy = input.policy ?? { allowExternal: [] };
  await checkBody(body, model, f, { policy, settingsFile: input.settingsFile });
  let cleaned: Record<string, unknown>;
  try {
    cleaned = api.validate<Record<string, unknown>>(body, api.CONFIG_SCHEMA, api.CONFIG_LIMITS);
  } catch (e) {
    if (e instanceof api.ValidationError) {
      f.error("schema", where, `正規化した設定がスキーマに合わない: ${e.message}`);
      return { findings: f, body, summary: "スキーマの誤り" };
    }
    throw e;
  }
  const size = await measureStored(cleaned, api);
  if (!size.ok) f.error("size", where, formatSize(size));
  else f.info("size", where, formatSize(size));

  let checkDiffs: string[] | undefined;
  if (input.check) {
    checkDiffs = [];
    jsonDiff(inputClean, cleaned, "$", checkDiffs);
  }

  const rows = (cleaned.pluginInfos ?? []) as Array<{ menu: string; state: boolean }>;
  const summary = `アプリ ${input.fields.appId} ${input.fields.appName}、ボタン ${rows.length}（有効 ${rows.filter((r) => r.state).length}）`;
  if (f.hasErrors) return { findings: f, body: cleaned, size, checkDiffs, summary };
  const now = (input.now ?? (() => new Date()))();
  const output: Record<string, unknown> = {
    date: formatDate(now),
    pluginName: typeof envelope.pluginName === "string" && envelope.pluginName ? envelope.pluginName : PLUGIN_NAME,
    pluginID: api.pluginId,
    PluginVersion: pluginVersion,
    appId: input.fields.appId,
    appName: typeof envelope.appName === "string" && envelope.appName ? envelope.appName : input.fields.appName
  };
  for (const k of ENVELOPE_KEYS) if (!(k in output)) output[k] = envelope[k];
  Object.assign(output, cleaned);
  return { findings: f, output, body: cleaned, size, checkDiffs, summary };
}

export async function readFieldsFile(file: string): Promise<FieldsFile> {
  const fields = JSON.parse(readFileSync(file, "utf8")) as FieldsFile;
  if (!fields || typeof fields !== "object" || !fields.properties) throw new Error(`${file} は fields コマンドの出力ではない（properties が無い）`);
  return fields;
}

export function relativeSettingsPath(file: string): string {
  const rel = path.relative(process.cwd(), path.resolve(file));
  return rel.startsWith("..") ? file : rel.replace(/\\/g, "/");
}

export { loadPolicy };
