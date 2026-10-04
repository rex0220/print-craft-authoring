/**
 * fields --app N [--lang ja] [--preview] [--guest S] [--env <.env>] [--out <file>]
 * 項目定義（/k/v1/app/form/fields の properties）、レイアウト（/k/v1/app/form/layout）、アプリ名（/k/v1/app）を 1 つの JSON に保存する。
 * 設定画面は preview の API を読む（load.ts 204 / 209 行）ので --preview で同じ API に切り替えられる（既定は運用中の形。
 * preview は API トークンでは呼べないことがある）。normalize / preview はこのファイルから pp と更新項目の一覧を作る。
 */
import type { RestClient } from "../kintone-rest.ts";

export interface FieldProperty {
  type: string;
  code: string;
  label: string;
  fields?: Record<string, FieldProperty>;
  [key: string]: unknown;
}

export interface LayoutRow {
  type?: string;
  code?: string;
  fields?: Array<{ type?: string; code?: string; [key: string]: unknown }>;
  layout?: LayoutRow[];
  [key: string]: unknown;
}

/** fields/<app>.json の形 */
export interface FieldsFile {
  tool: "pcraft-authoring fields";
  fetchedAt: string;
  baseUrl: string;
  appId: number;
  appName: string;
  guestSpaceId?: number;
  preview: boolean;
  lang: string;
  revision: string;
  properties: Record<string, FieldProperty>;
  layout: LayoutRow[];
}

export interface FieldsOptions {
  app: number;
  lang?: string;
  preview?: boolean;
  guestSpaceId?: number;
  now?: () => Date;
}

export async function fetchFields(client: RestClient, opt: FieldsOptions): Promise<FieldsFile> {
  const lang = opt.lang ?? "ja";
  const app = await client.get<{ appId: string; name: string }>("app", { id: opt.app }, opt.guestSpaceId);
  const fields = await client.get<{ properties: Record<string, FieldProperty>; revision: string }>(opt.preview ? "preview/app/form/fields" : "app/form/fields", { app: opt.app, lang }, opt.guestSpaceId);
  const layout = await client.get<{ layout: LayoutRow[]; revision: string }>(opt.preview ? "preview/app/form/layout" : "app/form/layout", { app: opt.app }, opt.guestSpaceId);
  return {
    tool: "pcraft-authoring fields",
    fetchedAt: (opt.now ?? (() => new Date()))().toISOString(),
    baseUrl: client.baseUrl,
    appId: Number(app.appId),
    appName: app.name,
    ...(opt.guestSpaceId ? { guestSpaceId: opt.guestSpaceId } : {}),
    preview: !!opt.preview,
    lang,
    revision: String(fields.revision ?? layout.revision ?? ""),
    properties: fields.properties ?? {},
    layout: layout.layout ?? []
  };
}

/** 画面に出す要約（項目の数と型。値は無い） */
export function summarizeFields(file: FieldsFile): string {
  const props = Object.values(file.properties);
  const tables = props.filter((p) => p.type === "SUBTABLE");
  const byType = new Map<string, number>();
  for (const p of props) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
  const types = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ");
  const tableLines = tables.map((t) => `  テーブル ${t.code}: ${Object.keys(t.fields ?? {}).join(", ")}`);
  return [`アプリ ${file.appId} ${file.appName}（${file.preview ? "preview" : "運用中"}、lang=${file.lang}）`, `項目 ${props.length}（${types}）`, ...tableLines].join("\n");
}
