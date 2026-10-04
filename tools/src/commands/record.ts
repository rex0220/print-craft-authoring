/**
 * record --app N --id R [--fields-from <settings.json>] [--guest S] [--env <.env>] [--out <file>]
 * レコードを /k/v1/record（{ type, value }、テーブルは入れ子）で取って records/<app>-<id>.json に保存する。preview の入力。
 * レコードは個人情報を含むので、--fields-from で設定が使う項目だけ残し、中身は画面とログに出さない（Codex MAJOR 5）。
 */
import type { RestClient } from "../kintone-rest.ts";

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
 * 設定 JSON（封筒形式。正規化済みでなくてもよい）から、帳票と更新項目が使う項目コードを集める。
 * usedFields（あれば）、更新項目の fieldcode、filecode。何も見つからなければ null（絞らない）
 */
export function usedFieldCodes(settings: unknown): Set<string> | null {
  const codes = new Set<string>();
  const s = settings as { pluginInfos?: Array<Record<string, unknown>>; usedFields?: Record<string, unknown> } | null;
  if (!s || typeof s !== "object") return null;
  const addKeys = (o: unknown): void => {
    if (o && typeof o === "object") for (const k of Object.keys(o as Record<string, unknown>)) codes.add(k);
  };
  addKeys(s.usedFields);
  for (const row of s.pluginInfos ?? []) {
    const tags = row.tagsInfo as { fieldsInfo?: Array<Record<string, unknown>>; filecode?: string } | undefined;
    for (const f of tags?.fieldsInfo ?? []) addKeys(f.usedFields);
    if (tags?.filecode) codes.add(tags.filecode);
    const calc = row.calcInfo as { fieldsInfo?: Array<Record<string, unknown>>; usedFields?: Record<string, unknown> } | undefined;
    addKeys(calc?.usedFields);
    for (const f of calc?.fieldsInfo ?? []) {
      if (f.state && typeof f.fieldcode === "string" && !f.fieldcode.startsWith("$")) codes.add(f.fieldcode);
      addKeys(f.usedFields);
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

/** 画面に出す要約（項目の数だけ。値は出さない） */
export function summarizeRecord(file: RecordFile): string {
  const codes = Object.keys(file.record);
  const tables = codes.filter((c) => file.record[c]?.type === "SUBTABLE");
  const rows = tables.map((t) => `${t} ${Array.isArray(file.record[t].value) ? (file.record[t].value as unknown[]).length : 0} 行`);
  return `アプリ ${file.appId} レコード ${file.id}: 項目 ${codes.length}${tables.length ? `（テーブル ${rows.join(", ")}）` : ""}${file.keptFields ? `。--fields-from で ${file.keptFields.length} 項目に絞った` : ""}。値は表示しない`;
}
