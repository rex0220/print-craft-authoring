/**
 * tools の版と、対応する印刷屋の版・authoring API の版・既知のエンジンの SHA-256（docs/authoring-plan.md 12.1、12.2 の version）。
 * エンジンと印刷屋のコードは利用者の zip から読むので、ビルド時に埋めるのは tools の版と commit だけ。印刷屋の版は実行時に zip から分かる。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTHORING_ROOT } from "./paths.ts";

declare const __PCRAFT_TOOLS_META__: string | undefined;

/** tools が対応する印刷屋プラグインの版（manifest.json の version） */
export const SUPPORTED_PLUGIN_VERSIONS = ["6"];
/** tools が対応する印刷屋の authoring API の版（print-craft の src/authoring/api.ts の AUTHORING_API_VERSION） */
export const SUPPORTED_API_VERSION = 1;
/** 版ごとの既知の計算式エンジン（KintoneFormulaPCraft.min.js）の SHA-256。違えば警告（改変か未知の修正版） */
export const KNOWN_ENGINE_SHA256: Record<string, string[]> = {
  "6": ["8a5f78f78f51e04b5daaa435b0e8a8c0ea4d08d388d84d279f0cd1b50a857140"]
};

export interface ToolsMeta {
  toolsVersion: string;
  supportedPluginVersions: string[];
  supportedApiVersion: number;
  /** tools のリポジトリ（print-craft-authoring）の commit（作業ツリーに変更があれば +dirty） */
  commit: string;
  builtAt: string;
  mode: "build" | "dev";
}

/** RegExp を文字列にして JSON にする（CONFIG_SCHEMA の pattern を落とさない） */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (x instanceof RegExp ? `/${x.source}/${x.flags}` : x));
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** CONFIG_SCHEMA のハッシュ（先頭 12 桁）。印刷屋の API から受けた schema で計算する */
export function schemaRevisionOf(schema: unknown): string {
  return sha256Hex(stableJson(schema)).slice(0, 12);
}

export function gitCommit(dir: string): string {
  try {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

export function devMeta(): ToolsMeta {
  const pkg = JSON.parse(readFileSync(path.join(AUTHORING_ROOT, "package.json"), "utf8")) as { version: string };
  return { toolsVersion: pkg.version, supportedPluginVersions: SUPPORTED_PLUGIN_VERSIONS, supportedApiVersion: SUPPORTED_API_VERSION, commit: gitCommit(AUTHORING_ROOT), builtAt: "", mode: "dev" };
}

export function toolsMeta(): ToolsMeta {
  if (typeof __PCRAFT_TOOLS_META__ === "string") return JSON.parse(__PCRAFT_TOOLS_META__) as ToolsMeta;
  return devMeta();
}
