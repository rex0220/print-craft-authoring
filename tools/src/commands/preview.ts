/**
 * preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir <dir>] [--json]
 * 正規化（normalize と同じ手順。エラーがあれば止まる）→ 有効なボタンごとに帳票 HTML（sandbox の iframe + CSP）→ out/<ボタン名>.html。
 * 一覧帳票（list）は 1 レコードでは作れないので対象外（段階 2）。式の失敗は帳票に赤字で埋め、終了コード 1。
 */
import type { Engine } from "../engine.ts";
import type { FieldsFile } from "./fields.ts";
import type { KintoneRecord, RecordFile } from "./record.ts";
import type { Policy } from "../normalize/policy.ts";
import { Findings } from "../normalize/findings.ts";
import { buildModel } from "../normalize/model.ts";
import { normalizeSettings } from "./normalize.ts";
import { renderButton, safeFileName, type RenderedButton } from "../preview/render.ts";
import type { MenuRow } from "print-craft/src/config/schema.ts";

export interface PreviewInput {
  settingsText: string;
  settingsFile?: string;
  fields: FieldsFile;
  recordFile: unknown;
  engine: Engine;
  policy?: Policy;
  button?: string;
}

export interface PreviewResult {
  findings: Findings;
  results: Array<RenderedButton & { file: string }>;
  skipped: string[];
  summary: string;
}

/** レコードの形を 3 通り受ける */
export function extractRecord(file: unknown): KintoneRecord {
  if (!file || typeof file !== "object") throw new Error("レコードの JSON がオブジェクトでない");
  const o = file as Record<string, unknown>;
  if (o.record && typeof o.record === "object") return (o as unknown as RecordFile).record;
  const values = Object.values(o);
  if (values.length && values.every((v) => v && typeof v === "object" && "type" in (v as object) && "value" in (v as object))) return o as KintoneRecord;
  throw new Error("レコードの JSON の形が分からない（record コマンドの出力か、/k/v1/record の応答か、{ 項目: { type, value } } の形）");
}

export async function runPreview(input: PreviewInput): Promise<PreviewResult> {
  const normalized = await normalizeSettings({ settingsText: input.settingsText, settingsFile: input.settingsFile, fields: input.fields, engine: input.engine, policy: input.policy });
  const findings = normalized.findings;
  const results: PreviewResult["results"] = [];
  const skipped: string[] = [];
  if (!normalized.body) return { findings, results, skipped, summary: normalized.summary };
  const record = extractRecord(input.recordFile);
  const model = buildModel(input.fields, input.engine.api);
  input.engine.setContext({ baseUrl: input.fields.baseUrl, appId: input.fields.appId });
  const rows = (normalized.body.pluginInfos ?? []) as MenuRow[];
  rows.forEach((row, i) => {
    if (!row.state || !row.tagsInfo) return;
    if (input.button !== undefined && row.menu !== input.button) return;
    if (row.list) {
      skipped.push(`${row.menu}: 一覧帳票は 1 レコードのプレビューの対象外（段階 2）`);
      return;
    }
    const r = renderButton({ body: normalized.body!, row, model, engine: input.engine, record });
    results.push({ ...r, file: `${safeFileName(row.menu, i)}.html` });
  });
  if (input.button !== undefined && results.length === 0 && !skipped.length) findings.error("preview.button", input.button, "その名前の有効なボタンが無い");
  const summary = `${normalized.summary}。プレビュー ${results.length} 件${skipped.length ? `、対象外 ${skipped.length}` : ""}、式のエラー ${results.reduce((n, r) => n + r.errors.length, 0)}`;
  return { findings, results, skipped, summary };
}
