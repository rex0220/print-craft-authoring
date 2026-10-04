/**
 * tools の版・対応する印刷屋の版・設定スキーマの版・元の commit・同梱エンジンの SHA-256（docs/authoring-plan.md 12.1、12.2 の version）。
 * ビルドでは scripts/build.mjs が __PCRAFT_TOOLS_META__ に JSON を埋める。開発中（src を直接動かすとき）は print-craft のファイルから計算する。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AUTHORING_ROOT, ENGINE_FILE_NAME, PRINT_CRAFT_ROOT, libDir } from "./paths.ts";

declare const __PCRAFT_TOOLS_META__: string | undefined;

export interface ToolsMeta {
  toolsVersion: string;
  /** 対応する印刷屋プラグインの版（prod/manifest.json の version） */
  pluginVersion: string;
  /** CONFIG_SCHEMA の内容のハッシュ（先頭 12 桁） */
  schemaRevision: string;
  /** print-craft の commit（作業ツリーに変更があれば +dirty） */
  printCraftCommit: string;
  engineFile: string;
  engineSha256: string;
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

export function gitCommit(dir: string): string {
  try {
    const head = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}+dirty` : head;
  } catch {
    return "unknown";
  }
}

/** print-craft の src/config/schema.ts を読んで CONFIG_SCHEMA のハッシュを出す（開発中とビルド時。Node 22.6 以上の型の除去で .ts を直接読む） */
export async function schemaRevision(): Promise<string> {
  const mod = (await import(pathToFileURL(path.join(PRINT_CRAFT_ROOT, "src", "config", "schema.ts")).href)) as { CONFIG_SCHEMA: unknown };
  return sha256Hex(stableJson(mod.CONFIG_SCHEMA)).slice(0, 12);
}

export async function devMeta(): Promise<ToolsMeta> {
  const pkg = JSON.parse(readFileSync(path.join(AUTHORING_ROOT, "package.json"), "utf8")) as { version: string };
  const manifest = JSON.parse(readFileSync(path.join(PRINT_CRAFT_ROOT, "prod", "manifest.json"), "utf8")) as { version: number | string };
  const engineFile = path.join(libDir(), ENGINE_FILE_NAME);
  return {
    toolsVersion: pkg.version,
    pluginVersion: String(manifest.version),
    schemaRevision: await schemaRevision(),
    printCraftCommit: gitCommit(PRINT_CRAFT_ROOT),
    engineFile: ENGINE_FILE_NAME,
    engineSha256: sha256Hex(readFileSync(engineFile)),
    builtAt: "",
    mode: "dev"
  };
}

export async function toolsMeta(): Promise<ToolsMeta> {
  if (typeof __PCRAFT_TOOLS_META__ === "string") return JSON.parse(__PCRAFT_TOOLS_META__) as ToolsMeta;
  return devMeta();
}
