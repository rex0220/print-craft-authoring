/**
 * record --app N --id R [--fields-from <settings.json>] [--guest S] [--out records/<file>]
 * レコードを /k/v1/record（{ type, value }、テーブルは入れ子）で取って records/<app>-<id>.json に保存する。preview の入力。
 * レコードは個人情報を含むので、--fields-from で設定が使う項目だけ残し、中身は画面とログに出さない（Codex MAJOR 5）。
 */
import type { RestClient } from "../kintone-rest.ts";
import type { FieldsFile } from "./fields.ts";
import { expressionsOf } from "../normalize/html-check.ts";

export type FieldValue = { type: string; value: unknown };
export type KintoneRecord = Record<string, FieldValue>;

export interface RecordFile {
  tool: "pcraft-authoring record";
  fetchedAt: string;
  baseUrl: string;
  appId: number;
  id: number;
  guestSpaceId?: number;
  /** --fields-from で絞ったときの残した項目（絞らなければ無い） */
  keptFields?: string[];
  record: KintoneRecord;
}

export interface RecordOptions {
  app: number;
  id: number;
  guestSpaceId?: number;
  /** 残す項目（undefined なら全部） */
  keep?: Set<string>;
  now?: () => Date;
}

/** 常に残す疑似項目 */
const ALWAYS = new Set(["$id", "$revision"]);

/**
 * 式の中で項目コードになりうる語（"…" の文字列の中身と数値を除く）。計算式の文字列は \ を解釈しないので "…" は次の " まで。
 * 関数名やコメントの語も拾うが、絞るときはレコードにある項目しか残らないので害は無い（多めに拾う。絞りすぎるとプレビューが空欄になる）
 */
export function identifiersOf(expr: string): string[] {
  return expr
    .replace(/"[^"]*"/g, " ")
    .split(/[^\p{L}\p{N}_・＿＄￥$]+/u)
    .filter((t) => t && !/^\d+$/.test(t));
}

/**
 * 設定 JSON（封筒形式。正規化済みでなくてもよい）から、帳票と更新項目が使う項目コードを集める。
 * usedFields（あれば）、HTML 欄の ${式} と計算式の本文の語、更新項目の fieldcode、filecode。何も見つからなければ null（絞らない）。
 * usedFields は計算式欄だけから作られ、HTML 欄の ${式}（宛名、合計など）を含まない（2026-10-06 のリハーサルで、--fields-from が宛名などを落として
 * プレビューが空欄になっていたのを見つけた）
 */
export function usedFieldCodes(settings: unknown): Set<string> | null {
  const codes = new Set<string>();
  const s = settings as { pluginInfos?: Array<Record<string, unknown>>; usedFields?: Record<string, unknown> } | null;
  if (!s || typeof s !== "object") return null;
  const addKeys = (o: unknown): void => {
    if (o && typeof o === "object") for (const k of Object.keys(o as Record<string, unknown>)) codes.add(k);
  };
  const addWords = (text: unknown): void => {
    if (typeof text === "string") for (const w of identifiersOf(text)) codes.add(w);
  };
  /** 計算式の本文（正規化済みなら formula、まだなら formulaSet） */
  const addFormula = (f: Record<string, unknown>): void => addWords(typeof f.formula === "string" && f.formula ? f.formula : f.formulaSet);
  addKeys(s.usedFields);
  for (const row of s.pluginInfos ?? []) {
    const tags = row.tagsInfo as { fieldsInfo?: Array<Record<string, unknown>>; filecode?: string } | undefined;
    for (const f of tags?.fieldsInfo ?? []) {
      addKeys(f.usedFields);
      addFormula(f);
      if (typeof f.html === "string") for (const e of expressionsOf(f.html)) addWords(e);
    }
    if (tags?.filecode) codes.add(tags.filecode);
    const calc = row.calcInfo as { fieldsInfo?: Array<Record<string, unknown>>; usedFields?: Record<string, unknown> } | undefined;
    addKeys(calc?.usedFields);
    for (const f of calc?.fieldsInfo ?? []) {
      if (f.state && typeof f.fieldcode === "string" && !f.fieldcode.startsWith("$")) codes.add(f.fieldcode);
      addKeys(f.usedFields);
      addFormula(f);
    }
  }
  for (const c of [...codes]) if (c.startsWith("$")) codes.delete(c);
  return codes.size ? codes : null;
}

/** keep の項目だけ残す。テーブルは、テーブル自身か子のどれかが keep にあれば残し、子は keep にあるものだけ（テーブル自身が keep なら全部） */
export function narrowRecord(record: KintoneRecord, keep: Set<string>): { record: KintoneRecord; kept: string[] } {
  const out: KintoneRecord = {};
  const kept: string[] = [];
  for (const [code, fv] of Object.entries(record)) {
    if (ALWAYS.has(code)) {
      out[code] = fv;
      continue;
    }
    if (fv?.type === "SUBTABLE" && Array.isArray(fv.value)) {
      const rows = fv.value as Array<{ id?: string; value: KintoneRecord }>;
      const childCodes = new Set(rows.flatMap((r) => Object.keys(r.value ?? {})));
      const wholeTable = keep.has(code);
      const usedChildren = [...childCodes].filter((c) => keep.has(c));
      if (!wholeTable && usedChildren.length === 0) continue;
      out[code] = {
        type: "SUBTABLE",
        value: rows.map((r) => {
          if (wholeTable) return r;
          const v: KintoneRecord = {};
          for (const c of usedChildren) if (r.value[c]) v[c] = r.value[c];
          return { ...(r.id ? { id: r.id } : {}), value: v };
        })
      };
      kept.push(wholeTable ? code : `${code}(${usedChildren.join(",")})`);
      continue;
    }
    if (keep.has(code)) {
      out[code] = fv;
      kept.push(code);
    }
  }
  return { record: out, kept };
}

/**
 * 設定が使う項目のうち、プレビューのレコードに無いもの（fields にある項目だけを見る。テーブルの子は、テーブルが無いか行があって子が無いとき）。
 * 古い records/ や絞りすぎたレコードで帳票が空欄になるのを preview の警告で知らせる（2026-10-06）
 */
export function missingInRecord(settings: unknown, fields: Pick<FieldsFile, "properties">, record: KintoneRecord): string[] {
  const used = usedFieldCodes(settings);
  if (!used) return [];
  const missing: string[] = [];
  for (const [code, p] of Object.entries(fields.properties ?? {})) {
    if (p.type === "SUBTABLE") {
      const table = record[code];
      const rows = Array.isArray(table?.value) ? (table.value as Array<{ value?: KintoneRecord }>) : null;
      for (const child of Object.keys(p.fields ?? {})) {
        if (!used.has(child)) continue;
        if (!rows || (rows.length > 0 && !rows.some((r) => r.value && child in r.value))) missing.push(`${code}.${child}`);
      }
      if (used.has(code) && !table) missing.push(code);
      continue;
    }
    if (used.has(code) && !(code in record)) missing.push(code);
  }
  return [...new Set(missing)];
}

export async function fetchRecord(client: RestClient, opt: RecordOptions): Promise<RecordFile> {
  const res = await client.get<{ record: KintoneRecord }>("record", { app: opt.app, id: opt.id }, opt.guestSpaceId);
  let record = res.record ?? {};
  let keptFields: string[] | undefined;
  if (opt.keep) {
    const n = narrowRecord(record, opt.keep);
    record = n.record;
    keptFields = n.kept;
  }
  return {
    tool: "pcraft-authoring record",
    fetchedAt: (opt.now ?? (() => new Date()))().toISOString(),
    baseUrl: client.baseUrl,
    appId: opt.app,
    id: opt.id,
    ...(opt.guestSpaceId ? { guestSpaceId: opt.guestSpaceId } : {}),
    ...(keptFields ? { keptFields } : {}),
    record
  };
}

const MULTI_TYPES = new Set(["CHECK_BOX", "MULTI_SELECT", "CATEGORY"]);
const ENTITY_TYPES = new Set(["USER_SELECT", "ORGANIZATION_SELECT", "GROUP_SELECT", "STATUS_ASSIGNEE"]);
const DATE_TYPES: Record<string, string> = { DATE: "日付", DATETIME: "日時", CREATED_TIME: "日時", UPDATED_TIME: "日時", TIME: "時刻" };
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** 値の形（値そのものは出さない）。空なら "空" */
function shapeOf(fv: FieldValue): string {
  const v = fv.value;
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return "空";
  if (fv.type === "FILE" && Array.isArray(v)) {
    const byType = new Map<string, number>();
    for (const f of v as Array<{ contentType?: string }>) byType.set(f.contentType ?? "?", (byType.get(f.contentType ?? "?") ?? 0) + 1);
    return `${v.length} 件（${[...byType].map(([t, n]) => `${t} ${n}`).join("、")}）`;
  }
  if (MULTI_TYPES.has(fv.type) && Array.isArray(v)) return `${v.length} 個`;
  if (ENTITY_TYPES.has(fv.type) && Array.isArray(v)) return `${v.length} 件`;
  if (DATE_TYPES[fv.type]) return DATE_TYPES[fv.type];
  if (fv.type === "RECORD_NUMBER") return "あり";
  if (typeof v === "string") {
    if ((fv.type === "NUMBER" || fv.type === "CALC") && NUMERIC.test(v)) {
      const [int, dec] = v.replace("-", "").split(".");
      return `数値 ${v.startsWith("-") ? "負 " : ""}整数 ${int.length} 桁${dec ? `、小数 ${dec.length} 桁` : ""}`;
    }
    const lines = v.split("\n").length;
    return `${fv.type === "RICH_TEXT" ? "HTML " : ""}${[...v].length} 文字${lines > 1 ? `、${lines} 行` : ""}`;
  }
  if (typeof v === "object") return "あり";
  return typeof v;
}

/** テーブルの子の形を全行でまとめる（最も長い・行数の多い値と空の行の数） */
function columnShape(type: string, values: unknown[]): string {
  const shapes = values.map((value) => shapeOf({ type, value }));
  const filled = shapes.filter((s) => s !== "空");
  if (!filled.length) return "全行 空";
  const longest = filled.reduce((a, b) => (Number(b.match(/\d+/)?.[0] ?? 0) > Number(a.match(/\d+/)?.[0] ?? 0) ? b : a));
  const multiLine = filled.filter((s) => /\d+ 行$/.test(s)).length;
  return `最大 ${longest}${multiLine ? `（複数行の値 ${multiLine} 行）` : ""}${filled.length < shapes.length ? `、空 ${shapes.length - filled.length} 行` : ""}`;
}

/**
 * record --summary: 取得済みの records/<app>-<id>.json を 1 項目 1 行で。**値は出さず形だけ**（文字数・行数・数値の桁・件数・添付の種類。
 * SECURITY.md「レコードの値を標準出力に出さない」）。プレビューのレコードとして使えるか（備考に改行、明細が複数行、添付あり）を見るため（2026-10-05）
 */
export function describeRecord(file: RecordFile): string {
  const lines: string[] = [];
  for (const [code, fv] of Object.entries(file.record)) {
    if (code === "$id" || code === "$revision" || !fv) continue;
    if (fv.type === "SUBTABLE" && Array.isArray(fv.value)) {
      const rows = fv.value as Array<{ value: KintoneRecord }>;
      lines.push(`${code}  SUBTABLE  ${rows.length} 行`);
      const children = new Map<string, { type: string; values: unknown[] }>();
      for (const r of rows) {
        for (const [c, cv] of Object.entries(r.value ?? {})) {
          const e = children.get(c) ?? { type: cv.type, values: [] };
          e.values.push(cv.value);
          children.set(c, e);
        }
      }
      for (const [c, e] of children) lines.push(`  ${c}  ${e.type}  ${columnShape(e.type, e.values)}`);
      continue;
    }
    lines.push(`${code}  ${fv.type}  ${shapeOf(fv)}`);
  }
  const header = `アプリ ${file.appId} レコード ${file.id}（取得 ${file.fetchedAt}${file.keptFields ? `、--fields-from で ${file.keptFields.length} 項目に絞った` : ""}）。値は出さない（形だけ）`;
  return [header, ...lines].join("\n");
}

/** 画面に出す要約（項目の数だけ。値は出さない） */
export function summarizeRecord(file: RecordFile): string {
  const codes = Object.keys(file.record);
  const tables = codes.filter((c) => file.record[c]?.type === "SUBTABLE");
  const rows = tables.map((t) => `${t} ${Array.isArray(file.record[t].value) ? (file.record[t].value as unknown[]).length : 0} 行`);
  return `アプリ ${file.appId} レコード ${file.id}: 項目 ${codes.length}${tables.length ? `（テーブル ${rows.join(", ")}）` : ""}${file.keptFields ? `。--fields-from で ${file.keptFields.length} 項目に絞った` : ""}。値は表示しない`;
}
