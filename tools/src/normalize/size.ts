/**
 * 保存値の大きさ（docs/authoring-plan.md 12.3、Codex MAJOR 6）。kit の config-store の writeConfig（print-craft の保存形式 compressed）で符号化し、
 * kintone の制限（1 値 65,535 文字、合計 256 KB）を同じコードで検査する。
 */
import { ConfigStoreError, DEFAULT_LIMITS, writeConfig } from "plugin-config-kit/src/config-store.ts";

export interface StoredSize {
  ok: boolean;
  /** 符号化した値の合計バイト数（UTF-8） */
  totalBytes: number;
  maxTotalBytes: number;
  /** 分割した値の数（json / json0.. の数） */
  splitCount: number;
  /** いちばん長い値の文字数 */
  maxValueLength: number;
  maxValueLimit: number;
  error?: string;
}

export async function measureStored(data: unknown): Promise<StoredSize> {
  try {
    const stored = await writeConfig(data, "compressed");
    const values = Object.values(stored);
    const totalBytes = values.reduce((n, v) => n + Buffer.byteLength(v, "utf8"), 0);
    const split = Object.keys(stored).filter((k) => /^json\d*$/.test(k)).length;
    return { ok: true, totalBytes, maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes, splitCount: split, maxValueLength: Math.max(0, ...values.map((v) => v.length)), maxValueLimit: DEFAULT_LIMITS.maxValueLength };
  } catch (e) {
    const message = e instanceof ConfigStoreError ? e.message : String((e as Error)?.message ?? e);
    return { ok: false, totalBytes: 0, maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes, splitCount: 0, maxValueLength: 0, maxValueLimit: DEFAULT_LIMITS.maxValueLength, error: message };
  }
}

export function formatSize(s: StoredSize): string {
  if (!s.ok) return `保存値が kintone の制限を超える: ${s.error}`;
  const pct = Math.round((s.totalBytes / s.maxTotalBytes) * 100);
  return `保存値（compressed）${s.totalBytes.toLocaleString()} bytes / 上限 ${s.maxTotalBytes.toLocaleString()}（${pct}%。残り ${(s.maxTotalBytes - s.totalBytes).toLocaleString()}）、分割 ${s.splitCount}`;
}
