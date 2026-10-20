/**
 * 評価の結果を返せる形に直す部品（評価の子プロセスの eval-run.ts と、お試しアプリの commands/try.ts が使う。print-craft の docs/authoring-try-plan.md 4.5）
 */
import { MAX_ERROR_CHARS, type JsonValue } from "./eval-job.ts";

/** 文字を上限で切る（字） */
export function cutText(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…（${(s.length - max).toLocaleString()} 字を切った）`;
}

/** エンジンが投げた評価のエラーの文（上限つき） */
export function evaluationErrorText(e: unknown): string {
  let s: string;
  try {
    s = String((e as { message?: unknown } | undefined)?.message ?? e);
  } catch {
    s = "（エラーの文を読めない）";
  }
  return cutText(s, MAX_ERROR_CHARS);
}

/**
 * エンジンの生の値を JSON にできる形に直す（構造化クローンで送れる形。循環、関数、DOM、BigNumber / Decimal を直接送らない）。
 * 配列は 100 要素、オブジェクトは 50 キー、深さ 4 まで。数・文字・真偽・null 以外は文字にする
 */
export function toJsonSafe(v: unknown, depth = 0): JsonValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function" || typeof v === "symbol") return `[${typeof v}]`;
  if (depth >= 4) return "[入れ子が深い]";
  if (Array.isArray(v)) {
    const out = v.slice(0, 100).map((x) => toJsonSafe(x, depth + 1));
    if (v.length > 100) out.push(`…（${(v.length - 100).toLocaleString()} 要素を省いた）`);
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto === Object.prototype || proto === null) {
    const out: { [key: string]: JsonValue } = {};
    const keys = Object.keys(v as object);
    for (const k of keys.slice(0, 50)) out[k] = toJsonSafe((v as Record<string, unknown>)[k], depth + 1);
    if (keys.length > 50) out["…"] = `${(keys.length - 50).toLocaleString()} キーを省いた`;
    return out;
  }
  // BigNumber / Decimal / Date / moment / DOM など: 文字にする（toString は zip のコードのことがある。失敗は印だけ）
  try {
    return String(v);
  } catch {
    return "[文字にできない値]";
  }
}

export const byteLength = (s: string): number => Buffer.byteLength(s, "utf8");

