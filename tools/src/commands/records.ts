/**
 * レコードを数件、形の要約だけで見る（段階 0-2 の段 4。print-craft MCP の kintone_list_records の本体。docs/api-table.md、実装案 5.4）。
 * プレビュー用の代表の 1 件を選ぶため。値・ファイル名・ユーザー名は返さない（形だけ。record --summary と同じ shapeLines）。保存もしない。
 *   - query は条件と並べ替えだけ。limit / offset を含めば止める（件数は AI に決めさせない。サーバーが末尾に limit を付ける）
 *   - query は 500 文字まで（URL の 8 KB の上限に届かないように）
 *   - 返す文字の合計に上限を付け、超えたら打ち切る（truncated）
 */
import type { RestClient } from "../kintone-rest.ts";
import { shapeLines } from "./record.ts";
import type { KintoneRecord } from "./record.ts";

export const LIST_LIMIT = 5;
export const QUERY_MAX = 500;
/** AI に返す文字の合計の上限（docs/api-table.md の 64 KiB の案。文字数で数える） */
export const SHAPE_TEXT_MAX = 64 * 1024;

export class QueryError extends Error {}

/** 引用符の中を除いた query（limit / offset の検査で、値の中の文字に反応しないように） */
function withoutQuoted(q: string): string {
  return q.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** 受け取った query を検査し、末尾に limit を付けた query を返す */
export function listQueryOf(query: string | undefined): string {
  const q = (query ?? "").trim();
  if ([...q].length > QUERY_MAX) throw new QueryError(`query は ${QUERY_MAX} 文字まで`);
  if (/\b(limit|offset)\b/i.test(withoutQuoted(q))) throw new QueryError("query に limit / offset は書かない（件数はサーバーが決める）");
  return q ? `${q} limit ${LIST_LIMIT}` : `limit ${LIST_LIMIT}`;
}

export interface RecordShape {
  /** レコード番号（$id） */
  id: string;
  /** 1 項目 1 行の形（値は出さない） */
  lines: string[];
}

export interface RecordShapes {
  appId: number;
  query: string;
  records: RecordShape[];
  /** 返す文字の上限で打ち切った */
  truncated: boolean;
}

export async function listRecordShapes(client: RestClient, opt: { app: number; query?: string; guestSpaceId?: number }): Promise<RecordShapes> {
  const query = listQueryOf(opt.query);
  const res = await client.get<{ records?: KintoneRecord[] }>("records", { app: opt.app, query }, opt.guestSpaceId);
  const out: RecordShape[] = [];
  let used = 0;
  let truncated = false;
  for (const record of (res.records ?? []).slice(0, LIST_LIMIT)) {
    const idValue = (record.$id as { value?: unknown } | undefined)?.value;
    const shape = { id: typeof idValue === "string" ? idValue : String(idValue ?? ""), lines: shapeLines(record) };
    const size = shape.lines.reduce((n, l) => n + l.length + 1, shape.id.length);
    if (used + size > SHAPE_TEXT_MAX) {
      truncated = true;
      break;
    }
    used += size;
    out.push(shape);
  }
  return { appId: opt.app, query, records: out, truncated };
}
