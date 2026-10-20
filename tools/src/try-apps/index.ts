/**
 * お試しアプリ（print-craft の docs/authoring-try-plan.md 4.1。T1）: formula の標本「計算式サンプル」と帳票のパターン 3 つ（quote / list / gantt）の項目定義と
 * 固定のレコード 3 件（1 = 典型、2 = 端、3 = 空）を束ねる。行・レコードの多いものは同梱せず、rows / count でその場で作る（generate.ts の値の表。P7）。
 *   - formula-sample: scripts/copy-formula-sample.mjs が formula-authoring の決まったコミットから写した（SOURCE.json の formula）
 *   - quote / list / gantt: scripts/gen-try-apps.mjs がテンプレートの docs/samples から作った（SOURCE.json の reports）
 *   - 値はすべて架空。接続先は https://example.cybozu.com（利用者のアプリ・レコード・接続とは無関係）
 * JSON はビルドで束ねる。上限は実機に合わせる: テーブル 1,000 行、関連レコード一覧 1,001 行まで（1,001 は印刷屋と同じく上限のエラーを確かめるため）、
 * 一覧帳票は一覧の 1 ページの表示件数まで（100 件。kintone の一覧の表示件数の選択肢の最大。2026-10-20 Takashi「100」）
 */
import formulaFields from "./formula-sample/fields.json" with { type: "json" };
import formulaRec1 from "./formula-sample/record-1.json" with { type: "json" };
import formulaRec2 from "./formula-sample/record-2.json" with { type: "json" };
import formulaRec3 from "./formula-sample/record-3.json" with { type: "json" };
import quoteFields from "./quote/fields.json" with { type: "json" };
import quoteRec1 from "./quote/record-1.json" with { type: "json" };
import quoteRec2 from "./quote/record-2.json" with { type: "json" };
import quoteRec3 from "./quote/record-3.json" with { type: "json" };
import listFields from "./list/fields.json" with { type: "json" };
import listRec1 from "./list/record-1.json" with { type: "json" };
import listRec2 from "./list/record-2.json" with { type: "json" };
import listRec3 from "./list/record-3.json" with { type: "json" };
import ganttFields from "./gantt/fields.json" with { type: "json" };
import ganttRec1 from "./gantt/record-1.json" with { type: "json" };
import ganttRec2 from "./gantt/record-2.json" with { type: "json" };
import ganttRec3 from "./gantt/record-3.json" with { type: "json" };
import type { FieldProperty, FieldsFile } from "../commands/fields.ts";
import type { KintoneRecord } from "../commands/record.ts";
import { InputError } from "../commands/normalize.ts";
import { recordOf, rowsOf } from "./generate.ts";

export type TryAppKey = "formula-sample" | "quote" | "list" | "gantt";
export const TRY_APP_KEYS: readonly TryAppKey[] = ["formula-sample", "quote", "list", "gantt"];

/** テーブルの行数の上限（印刷屋にはテーブルの行数の上限が無い。お試しアプリの上限） */
export const MAX_ROWS = 1000;
/** 関連レコード一覧の仮のテーブルの行数の上限（印刷屋の RELATED_LIMIT = 1,000 の 1 つ上まで作れる。1,001 は上限のエラー） */
export const MAX_RELATED_ROWS = 1001;
/** 一覧帳票のレコード数の上限（一覧の 1 ページの表示件数） */
export const MAX_COUNT = 100;

export interface TryApp {
  key: TryAppKey;
  title: string;
  fields: FieldsFile;
  /** 固定のレコード（records[0] = 1 典型、[1] = 2 端、[2] = 3 空） */
  records: KintoneRecord[];
  /** rows で行を作るテーブル（quote は明細、gantt は関連レコード一覧の仮のテーブル）。無ければ rows は使えない */
  rowsTable?: { code: string; related: boolean };
  /** count が使えるか（一覧帳票） */
  count: boolean;
}

type RecordJson = { record: unknown };
const recs = (...r: RecordJson[]): KintoneRecord[] => r.map((x) => x.record as KintoneRecord);

const APPS: Record<TryAppKey, TryApp> = {
  "formula-sample": { key: "formula-sample", title: "計算式サンプル（全項目タイプ × 2、テーブル 2 つ）", fields: formulaFields as unknown as FieldsFile, records: recs(formulaRec1, formulaRec2, formulaRec3), count: false },
  quote: { key: "quote", title: "見積書（明細のテーブル）", fields: quoteFields as unknown as FieldsFile, records: recs(quoteRec1, quoteRec2, quoteRec3), rowsTable: { code: "見積明細", related: false }, count: false },
  list: { key: "list", title: "一覧帳票（案件管理）", fields: listFields as unknown as FieldsFile, records: recs(listRec1, listRec2, listRec3), count: true },
  gantt: { key: "gantt", title: "工程表（関連レコード一覧 task_list）", fields: ganttFields as unknown as FieldsFile, records: recs(ganttRec1, ganttRec2, ganttRec3), rowsTable: { code: "task_list", related: true }, count: false }
};

export function tryApp(key: string): TryApp {
  const app = (APPS as Record<string, TryApp | undefined>)[key];
  if (!app) throw new InputError(`お試しアプリの名前が違う: ${key}（${TRY_APP_KEYS.join(" / ")}）`);
  return app;
}

/** 固定のレコード（番号 1〜3。写しを返す） */
export function fixedRecord(app: TryApp, n: number): KintoneRecord {
  const r = app.records[n - 1];
  if (!Number.isInteger(n) || !r) throw new InputError(`お試しアプリ ${app.key} のレコードの番号は 1〜${app.records.length}（${n}）`);
  return structuredClone(r);
}

/** レコード 1（典型）のテーブルの行を、値の表で作った n 行に替える（rows。quote は明細、gantt は関連レコード一覧の仮のテーブル） */
export function withRows(app: TryApp, n: number): KintoneRecord {
  const t = app.rowsTable;
  if (!t) throw new InputError(`お試しアプリ ${app.key} では rows を使えない（quote / gantt）`);
  const max = t.related ? MAX_RELATED_ROWS : MAX_ROWS;
  if (!Number.isInteger(n) || n < 0 || n > max) throw new InputError(`rows は 0〜${max.toLocaleString()}（${n}）`);
  const rec = fixedRecord(app, 1);
  let children: Record<string, FieldProperty> | undefined;
  if (t.related) children = (app.fields as { related?: Record<string, { properties?: Record<string, FieldProperty> }> }).related?.[t.code]?.properties;
  else children = (app.fields.properties[t.code] as FieldProperty | undefined)?.fields;
  if (!children) throw new Error(`お試しアプリ ${app.key} にテーブル ${t.code} の項目定義が無い`);
  (rec as Record<string, unknown>)[t.code] = { type: "SUBTABLE", value: rowsOf(children, n, t.related ? `${t.code}$` : "") };
  return rec;
}

/** 一覧帳票のレコードを、値の表で n 件作る（count。i = 1..n） */
export function withCount(app: TryApp, n: number): KintoneRecord[] {
  if (!app.count) throw new InputError(`お試しアプリ ${app.key} では count を使えない（list）`);
  if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) throw new InputError(`count は 1〜${MAX_COUNT}（${n}）`);
  return Array.from({ length: n }, (_, k) => recordOf(app.fields, k + 1));
}

/** 関連レコード一覧の仮のテーブルのうち、印刷屋の上限（limit = api.RELATED_LIMIT）を超えているもの（印刷屋はこのとき帳票を作らない） */
export function relatedOverLimit(app: TryApp, record: KintoneRecord, limit: number): Array<{ parent: string; rows: number }> {
  const related = (app.fields as { related?: Record<string, unknown> }).related ?? {};
  return Object.keys(related)
    .map((parent) => ({ parent, rows: ((record as Record<string, { value?: unknown[] }>)[parent]?.value ?? []).length }))
    .filter((x) => x.rows > limit);
}
