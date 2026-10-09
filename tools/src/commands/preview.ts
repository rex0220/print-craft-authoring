/**
 * preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir <dir>] [--json]
 * 正規化（normalize と同じ手順。エラーがあれば止まる）→ 有効なボタンごとに帳票 HTML（sandbox の iframe + CSP）→ out/<ボタン名>.html。
 * 一覧帳票（list）は 1 レコードでは作れないので対象外（段階 2）。式の失敗は帳票に赤字で埋め、終了コード 1。
 * Web フォントは配信元が承認済み（policy。Google Fonts は既定）のときだけ帳票の文書に入れる（render.ts）。
 * ファイル名はボタン名から使えない文字と Windows の予約名を除き、同じ名前になるときは -2、-3 を付ける（1-10 レビュー MAJOR 4）。
 */
import { DEFAULT_CONTEXT_BASE_URL, type Engine } from "../engine.ts";
import type { FieldsFile } from "./fields.ts";
import { missingInRecord, type KintoneRecord, type RecordFile } from "./record.ts";
import { isAllowed, type Policy } from "../normalize/policy.ts";
import { Findings } from "../normalize/findings.ts";
import { buildModel } from "../normalize/model.ts";
import { InputError, normalizeSettings } from "./normalize.ts";
import { renderButton, type RenderedButton } from "../preview/render.ts";
import { safeFileName } from "../safe-path.ts";
import type { MenuRow } from "print-craft/src/config/schema.ts";

export interface PreviewInput {
  settingsText: string;
  settingsFile?: string;
  fields: FieldsFile;
  recordFile: unknown;
  engine: Engine;
  policy?: Policy;
  button?: string;
  /** .env の KINTONE_BASE_URL（検証済み。normalize と同じ） */
  baseUrl?: string;
}

export interface PreviewResult {
  findings: Findings;
  results: Array<RenderedButton & { file: string }>;
  skipped: string[];
  summary: string;
}

/** レコードの形を 3 通り受ける。形が違えば InputError（決まった文。レコードの値を含まない。print-craft MCP は描画の中の想定外の誤りと分ける） */
export function extractRecord(file: unknown): KintoneRecord {
  if (!file || typeof file !== "object") throw new InputError("レコードの JSON がオブジェクトでない");
  const o = file as Record<string, unknown>;
  if (o.record && typeof o.record === "object") return (o as unknown as RecordFile).record;
  const values = Object.values(o);
  if (values.length && values.every((v) => v && typeof v === "object" && "type" in (v as object) && "value" in (v as object))) return o as KintoneRecord;
  throw new InputError("レコードの JSON の形が分からない（record コマンドの出力か、/k/v1/record の応答か、{ 項目: { type, value } } の形）");
}

/** ボタン名 → 出力ファイル名（重複は -2、-3 …） */
export function previewFileNames(rows: Array<{ menu: string }>): string[] {
  const used = new Map<string, number>();
  return rows.map((row, i) => {
    const base = safeFileName(row.menu, `button-${i + 1}`);
    const n = used.get(base.toLowerCase()) ?? 0;
    used.set(base.toLowerCase(), n + 1);
    return n ? `${base}-${n + 1}.html` : `${base}.html`;
  });
}

export async function runPreview(input: PreviewInput): Promise<PreviewResult> {
  const normalized = await normalizeSettings({ settingsText: input.settingsText, settingsFile: input.settingsFile, fields: input.fields, engine: input.engine, policy: input.policy, baseUrl: input.baseUrl });
  const findings = normalized.findings;
  const results: PreviewResult["results"] = [];
  const skipped: string[] = [];
  // 検査でエラーがあれば描かない（描くと印刷屋のコードが不正な値で例外を出す。例: 用紙の大きさ。B1 の print-craft MCP の試験で見つけた）
  if (!normalized.body || findings.hasErrors) return { findings, results, skipped, summary: normalized.summary };
  const record = extractRecord(input.recordFile);
  const missing = missingInRecord(normalized.body, input.fields, record);
  if (missing.length) findings.warning("preview.record", "レコード", `設定が使う項目がプレビューのレコードに無い: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` 他 ${missing.length - 10}` : ""}（帳票では空になる。record --fields-from <この設定> で取り直す）`);
  const model = buildModel(input.fields, input.engine.api, input.baseUrl);
  // APP_URL などの元になる URL は .env の接続先。無ければ実在しないテナント（fields の値は使わない）
  input.engine.setContext({ baseUrl: model.baseUrl || DEFAULT_CONTEXT_BASE_URL, appId: input.fields.appId });
  const rows = (normalized.body.pluginInfos ?? []) as MenuRow[];
  const targets = rows.filter((row) => row.state && row.tagsInfo && (input.button === undefined || row.menu === input.button));
  const names = previewFileNames(targets);
  // Web フォント: 設定で有効なら、配信元が承認済み（policy の allowExternal。Google Fonts は既定）のときだけ帳票の文書に入れる（normalize の external.allowed / external.url と同じ判定）
  const font = input.engine.api.webFontOf(normalized.body.fontInfo);
  const webFont = font ? { font: { family: font.family, cssUrl: font.cssUrl }, approved: isAllowed(input.policy ?? { allowExternal: [] }, font.cssUrl, input.settingsFile) } : null;
  targets.forEach((row, i) => {
    if (row.list) {
      skipped.push(`${row.menu}: 一覧帳票は 1 レコードのプレビューの対象外（段階 2）`);
      return;
    }
    const r = renderButton({ body: normalized.body!, row, model, engine: input.engine, record, webFont });
    results.push({ ...r, file: names[i] });
  });
  if (input.button !== undefined && results.length === 0 && !skipped.length) findings.error("preview.button", input.button, "その名前の有効なボタンが無い");
  const summary = `${normalized.summary}。プレビュー ${results.length} 件${skipped.length ? `、対象外 ${skipped.length}` : ""}、式のエラー ${results.reduce((n, r) => n + r.errors.length, 0)}`;
  return { findings, results, skipped, summary };
}
