/**
 * お試しアプリの rows / count の値を、行・レコードの番号 i（1 から）と項目の型で決める（print-craft の docs/authoring-try-plan.md 4.1 の値の表。Codex r2 M6）。
 * 何度作っても同じ。印は上から順に 1 つだけ当てる: 空（i % 11）→ 0（i % 13）→ 負（i % 17）→ 長い（i % 7）→ 改行（i % 5）→ 普通。
 * 計算（CALC）は数値と同じ規則（kintone が計算する値の代わり）。番号と日時は固定（$id = 1000 + i、レコード番号 = i、テーブルの行 ID = 900000 + i、
 * 作成日時・更新日時 = 2026-01-15T00:00:00Z、作成者・更新者 = demo_user01）。値はすべて架空
 */
import type { FieldProperty, FieldsFile } from "../commands/fields.ts";
import type { KintoneRecord } from "../commands/record.ts";
import { DEFAULT_USERS } from "./users/default-users.ts";

export type Mark = "empty" | "zero" | "negative" | "long" | "newline" | "normal";

/** 印の規則（上が先） */
export const MARK_RULES: ReadonlyArray<readonly [number, Mark]> = [
  [11, "empty"],
  [13, "zero"],
  [17, "negative"],
  [7, "long"],
  [5, "newline"]
];

export function markOf(i: number): Mark {
  for (const [m, mark] of MARK_RULES) if (i % m === 0) return mark;
  return "normal";
}

/** 長い文字の足し（全角 40 字） */
export const LONG_TEXT = "長い文字の試しです。".repeat(4);
const BASE_DATE = Date.UTC(2026, 0, 15);
const FIXED_TIME = "2026-01-15T00:00:00Z";
const ymd = (i: number): string => new Date(BASE_DATE + i * 86_400_000).toISOString().slice(0, 10);
const two = (n: number): string => String(n).padStart(2, "0");
const userOf = (i: number): { code: string; name: string } => {
  const u = DEFAULT_USERS.users[(i - 1) % DEFAULT_USERS.users.length];
  return { code: u.code, name: u.name };
};
const FIRST_USER = userOf(1);

/** 選択肢（index の順） */
export function optionsOf(p: FieldProperty): string[] {
  const o = (p as { options?: Record<string, { label?: string; index?: string | number }> }).options ?? {};
  return Object.entries(o)
    .sort((a, b) => Number(a[1].index ?? 0) - Number(b[1].index ?? 0))
    .map(([k]) => k);
}

type Value = { type: string; value: unknown };

/** 1 つの項目の値（kintone のレコードの形）。値を持たない型（グループ、ラベル、テーブルなど）は undefined */
export function valueOf(p: FieldProperty, i: number, mark: Mark = markOf(i)): Value | undefined {
  const label = p.label ?? p.code;
  const text = `${label} ${i}`;
  const empty = mark === "empty";
  switch (p.type) {
    case "SINGLE_LINE_TEXT":
    case "LINK":
      if (p.type === "LINK") return { type: p.type, value: empty ? "" : `https://example.com/${i}` };
      return { type: p.type, value: empty ? "" : mark === "long" ? `${label}${i}${LONG_TEXT}` : text };
    case "MULTI_LINE_TEXT":
    case "RICH_TEXT":
      if (empty) return { type: p.type, value: "" };
      if (mark === "long") return { type: p.type, value: `${label}${i}${LONG_TEXT}` };
      if (mark === "newline") return { type: p.type, value: p.type === "RICH_TEXT" ? `<div>${text}</div><div>2 行目</div><div>3 行目</div>` : `${text}\n2 行目\n3 行目` };
      return { type: p.type, value: text };
    case "NUMBER":
    case "CALC":
      return { type: p.type, value: empty ? "" : mark === "zero" ? "0" : mark === "negative" ? `-${i * 100}` : String(i * 100) };
    case "DATE":
      return { type: p.type, value: empty ? "" : ymd(i) };
    case "DATETIME":
      return { type: p.type, value: empty ? "" : `${ymd(i)}T00:00:00Z` };
    case "TIME":
      return { type: p.type, value: empty ? "" : `${two(9 + (i % 9))}:${two(i % 60)}` };
    case "DROP_DOWN": {
      const opts = optionsOf(p);
      return { type: p.type, value: empty || opts.length === 0 ? "" : opts[(i - 1) % opts.length] };
    }
    case "RADIO_BUTTON": {
      // ラジオボタンは空にできない（kintone）。空の印でも選択肢の先頭
      const opts = optionsOf(p);
      return { type: p.type, value: opts.length === 0 ? "" : empty ? opts[0] : opts[(i - 1) % opts.length] };
    }
    case "CHECK_BOX":
    case "MULTI_SELECT": {
      const opts = optionsOf(p);
      return { type: p.type, value: empty || opts.length === 0 ? [] : [opts[(i - 1) % opts.length]] };
    }
    case "USER_SELECT":
    case "STATUS_ASSIGNEE":
      return { type: p.type, value: empty ? [] : [userOf(i)] };
    case "ORGANIZATION_SELECT": {
      const o = DEFAULT_USERS.organizations[(i - 1) % DEFAULT_USERS.organizations.length];
      return { type: p.type, value: empty || !o ? [] : [{ code: o.code, name: o.name }] };
    }
    case "GROUP_SELECT": {
      const g = DEFAULT_USERS.groups[(i - 1) % DEFAULT_USERS.groups.length];
      return { type: p.type, value: empty || !g ? [] : [{ code: g.code, name: g.name }] };
    }
    case "RECORD_NUMBER":
      return { type: p.type, value: String(i) };
    case "CREATED_TIME":
    case "UPDATED_TIME":
      return { type: p.type, value: FIXED_TIME };
    case "CREATOR":
    case "MODIFIER":
      return { type: p.type, value: FIRST_USER };
    case "STATUS":
      return { type: p.type, value: "未処理" };
    case "CATEGORY":
    case "FILE":
      return { type: p.type, value: [] };
    default:
      return undefined;
  }
}

/** テーブルの行（i = 1..n。子の項目の全部。行 ID = 900000 + i）。prefix は関連レコード一覧の仮のテーブルの子の名前（親$子） */
export function rowsOf(children: Record<string, FieldProperty>, n: number, prefix = ""): Array<{ id: string; value: Record<string, Value> }> {
  return Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    const value: Record<string, Value> = {};
    for (const p of Object.values(children)) {
      const v = valueOf(p, i);
      if (v) value[`${prefix}${p.code}`] = v;
    }
    return { id: String(900_000 + i), value };
  });
}

/** レコード（i 番目。テーブルは空。$id = 1000 + i、$revision = "1"） */
export function recordOf(fields: FieldsFile, i: number): KintoneRecord {
  const rec: Record<string, Value> = { $id: { type: "__ID__", value: String(1000 + i) }, $revision: { type: "__REVISION__", value: "1" } };
  for (const p of Object.values(fields.properties)) {
    if (p.type === "SUBTABLE" || p.type === "REFERENCE_TABLE") {
      rec[p.code] = { type: "SUBTABLE", value: [] };
      continue;
    }
    const v = valueOf(p, i);
    if (v) rec[p.code] = v;
  }
  return rec as unknown as KintoneRecord;
}
