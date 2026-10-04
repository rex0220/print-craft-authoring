/**
 * 印刷屋プラグインの zip を読む（docs/authoring-plan.md 12.9 の 9。Takashi「npm + kintone MCP + 印刷屋プラグイン.zip」）。
 * kintone のプラグイン zip は contents.zip + PUBKEY + SIGNATURE の 2 層。contents.zip の中から
 *   desktop_js/KintoneFormulaPCraft.min.js（計算式エンジン）、desktop_js/bignumber.min.js、desktop_js/moment-timezone-with-data.min.js、
 *   config_js/print-craft-authoring-api.js（印刷屋の設定画面・帳票のコードと kit を tools 向けにまとめた API。Ver.6 で同梱）、manifest.json
 * をメモリに取り出す。ファイルには書き出さない（エンジンと印刷屋のコードは利用者の zip の中だけにあり、tools は配らない）。
 * zip の読み取りは Node の zlib だけで行う（依存を足さない。stored と deflate、ZIP64 なし）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class PluginZipError extends Error {}

/** zip の全エントリーを { 名前 → 中身 } に展開する */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PluginZipError("zip の終端（EOCD）が無い");
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new PluginZipError(`zip の central directory が壊れている（entry ${n}）`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new PluginZipError(`zip の local header が壊れている: ${name}`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new PluginZipError(`zip の圧縮方式 ${method} には対応していない: ${name}`);
  }
  return out;
}

export interface PluginManifest {
  manifest_version?: number;
  version?: number | string;
  name?: Record<string, string>;
  [key: string]: unknown;
}

export interface PluginSources {
  /** 入力（zip のパス、または開発中の print-craft のフォルダー） */
  from: string;
  manifest: PluginManifest;
  pluginVersion: string;
  engine: string;
  bignumber: string;
  momentTimezone: string;
  /** 印刷屋の authoring API（Ver.6 以降の zip にある。無ければ undefined） */
  api?: string;
  sha256: { engine: string; api?: string };
}

export const ENGINE_ENTRY = "desktop_js/KintoneFormulaPCraft.min.js";
export const BIGNUMBER_ENTRY = "desktop_js/bignumber.min.js";
export const MOMENT_TZ_ENTRY = "desktop_js/moment-timezone-with-data.min.js";
export const API_ENTRY = "config_js/print-craft-authoring-api.js";
export const MANIFEST_ENTRY = "manifest.json";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 印刷屋の zip（2 層）から tools が要るものを取り出す */
export function readPluginZip(file: string): PluginSources {
  let outer: Map<string, Buffer>;
  try {
    outer = unzip(readFileSync(file));
  } catch (e) {
    throw new PluginZipError(`印刷屋の zip を読めない: ${file}（${e instanceof Error ? e.message : String(e)}）`);
  }
  const contents = outer.get("contents.zip");
  if (!contents) throw new PluginZipError(`印刷屋の zip ではない（contents.zip が無い）: ${file}`);
  const inner = unzip(contents);
  const need = (name: string): Buffer => {
    const b = inner.get(name);
    if (!b) throw new PluginZipError(`印刷屋の zip に ${name} が無い: ${file}`);
    return b;
  };
  const manifest = JSON.parse(need(MANIFEST_ENTRY).toString("utf8")) as PluginManifest;
  const engine = need(ENGINE_ENTRY);
  const api = inner.get(API_ENTRY);
  return {
    from: file,
    manifest,
    pluginVersion: String(manifest.version ?? ""),
    engine: engine.toString("utf8"),
    bignumber: need(BIGNUMBER_ENTRY).toString("utf8"),
    momentTimezone: need(MOMENT_TZ_ENTRY).toString("utf8"),
    api: api?.toString("utf8"),
    sha256: { engine: sha256Hex(engine), ...(api ? { api: sha256Hex(api) } : {}) }
  };
}
