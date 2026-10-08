/**
 * tools の版と、扱う印刷屋の zip の決まり（docs/authoring-plan.md 12.1、12.2 の version、12.18）。
 * エンジンと印刷屋のコードは利用者の zip から読むので、ビルド時に埋めるのは tools の版と commit だけ。印刷屋の版は実行時に zip から分かる。
 * 1.1.0（2026-10-08 Takashi「pluginid のチェックのみで OK」）: zip のコードを実行してよいかは、外側の zip の PUBKEY から出るプラグイン ID が
 * 印刷屋のもの（PRINT_CRAFT_PLUGIN_ID）かで決める。版は MIN_PLUGIN_VERSION 以上、API の版は SUPPORTED_API_VERSIONS のどれか（engine.ts）。
 * 1.0.0 までは 4 ファイルの SHA-256 の組を既知のリリースと照合していた（1-10 レビュー BLOCKER 2）ので、印刷屋の zip が変わるたびに tools の公開が要った。
 * ID は PUBKEY から計算するだけで、SIGNATURE は検証しない（Takashi 判断。本物の zip の PUBKEY を写した zip も通る）。
 * 印刷屋の AUTHORING_API_VERSION が上がったら SUPPORTED_API_VERSIONS に足す（print-craft の CLAUDE.md）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTHORING_ROOT } from "./paths.ts";

declare const __PCRAFT_TOOLS_META__: string | undefined;

/** 印刷屋プラグインの kintone のプラグイン ID（PUBKEY の SHA-256 から。plugin-zip.ts の pluginIdOf。5 変種とも同じ鍵） */
export const PRINT_CRAFT_PLUGIN_ID = "lcapkanpjdabgphknkabojmcfhonhkhp";
/** tools が扱う印刷屋の版の下限（manifest.json の version。authoring API を同梱したのが Ver.6） */
export const MIN_PLUGIN_VERSION = 6;
/** tools が対応する印刷屋の authoring API の版（print-craft の src/authoring/api.ts の AUTHORING_API_VERSION。2 = Ver.7 で webFontPageCss を追加） */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1, 2];

/** 印刷屋の版として扱えるか（整数で MIN_PLUGIN_VERSION 以上） */
export function isSupportedPluginVersion(version: string): boolean {
  return /^[1-9]\d{0,5}$/.test(version) && Number(version) >= MIN_PLUGIN_VERSION;
}

/** tools が使う authoring API のキーと型（契約。zip の API がこの形でなければ止める。1-10 レビュー MAJOR 8） */
export const REQUIRED_API: Record<string, "function" | "object" | "string" | "number"> = {
  apiVersion: "number", pluginVersion: "string", pluginId: "string",
  CONFIG_SCHEMA: "object", CONFIG_LIMITS: "object", PAGE_SIZES: "object", DPI_OPTIONS: "object", PAPER_NAMES: "object", PRINT_MODES: "object",
  buildMenuRows: "function", normalizeTagsInfo: "function", normalizeCssRows: "function", toSavedRows: "function", computeUsage: "function", computePluginUOG: "function",
  createCheckRecord: "function", createFieldsInfo: "function", isTargetType: "function", stripComments: "function", defaultCssRows: "function", defaultMenuInfo: "function", expandFields: "function",
  buildReportCss: "function", fileNameOf: "function", formulaOf: "function", mountReportHtml: "function", replaceTags: "function", getPaperSize: "function", webFontOf: "function", DUMMY_IMAGE: "string",
  validate: "function", parseJsonSafely: "function", ValidationError: "function", writeConfig: "function", DEFAULT_LIMITS: "object", ConfigStoreError: "function",
  // pull（アプリのプラグインの設定を読んで封筒形式にする。2026-10-05）
  readConfig: "function", buildExportData: "function"
};

export interface ToolsMeta {
  toolsVersion: string;
  /** 扱う印刷屋の zip のプラグイン ID */
  pluginId: string;
  /** 扱う印刷屋の版の下限 */
  minPluginVersion: number;
  supportedApiVersions: number[];
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
  return { toolsVersion: pkg.version, pluginId: PRINT_CRAFT_PLUGIN_ID, minPluginVersion: MIN_PLUGIN_VERSION, supportedApiVersions: [...SUPPORTED_API_VERSIONS], commit: gitCommit(AUTHORING_ROOT), builtAt: "", mode: "dev" };
}

export function toolsMeta(): ToolsMeta {
  if (typeof __PCRAFT_TOOLS_META__ === "string") return JSON.parse(__PCRAFT_TOOLS_META__) as ToolsMeta;
  return devMeta();
}
