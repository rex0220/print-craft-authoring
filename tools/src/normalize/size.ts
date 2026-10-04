/**
 * 保存値の大きさ（docs/authoring-plan.md 12.3、Codex MAJOR 6）。印刷屋の API 経由で kit の writeConfig（print-craft の保存形式 compressed）を呼び、
 * kintone の制限（1 値 65,535 文字、合計 256 KB）を設定画面と同じコードで検査する。
 */
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";

export interface StoredSize {
  ok: boolean;
  totalBytes: number;
  maxTotalBytes: number;
  splitCount: number;
  maxValueLength: number;
  maxValueLimit: number;
  error?: string;
}

export async function measureStored(data: unknown, api: PrintCraftAuthoringApi): Promise<StoredSize> {
  const limits = api.DEFAULT_LIMITS;
  try {
    const stored = await api.writeConfig(data, "compressed");
    const values = Object.values(stored);
    const totalBytes = values.reduce((n, v) => n + Buffer.byteLength(v, "utf8"), 0);
    const split = Object.keys(stored).filter((k) => /^json\d*$/.test(k)).length;
    return { ok: true, totalBytes, maxTotalBytes: limits.maxTotalBytes, splitCount: split, maxValueLength: Math.max(0, ...values.map((v) => v.length)), maxValueLimit: limits.maxValueLength };
  } catch (e) {
    const message = e instanceof api.ConfigStoreError ? e.message : String((e as Error)?.message ?? e);
    return { ok: false, totalBytes: 0, maxTotalBytes: limits.maxTotalBytes, splitCount: 0, maxValueLength: 0, maxValueLimit: limits.maxValueLength, error: message };
  }
}

export function formatSize(s: StoredSize): string {
  if (!s.ok) return `保存値が kintone の制限を超える: ${s.error}`;
  const pct = Math.round((s.totalBytes / s.maxTotalBytes) * 100);
  return `保存値（compressed）${s.totalBytes.toLocaleString()} bytes / 上限 ${s.maxTotalBytes.toLocaleString()}（${pct}%。残り ${(s.maxTotalBytes - s.totalBytes).toLocaleString()}）、分割 ${s.splitCount}`;
}
