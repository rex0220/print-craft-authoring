/**
 * tools の版と、対応する印刷屋の版・authoring API の版・既知の zip の中身の SHA-256（docs/authoring-plan.md 12.1、12.2 の version）。
 * エンジンと印刷屋のコードは利用者の zip から読むので、ビルド時に埋めるのは tools の版と commit だけ。印刷屋の版は実行時に zip から分かる。
 * 1-10 レビュー BLOCKER 2: zip の中身（エンジン・API・bignumber・moment-timezone）は Node のプロセスで実行するので、既知のリリースの
 * 組み合わせ（4 つの SHA-256 の tuple）と一致しなければ既定では止める（engine.ts。利用者が .env に PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 を書いたときだけ警告で続ける）。
 * 部品ごとの一覧でなくリリース単位の tuple なのは、配っていない組み合わせ（エンジンは修正版 A、API は修正版 B）を既知と見ないため（再レビュー MAJOR 3）。
 * 印刷屋の版を上げたら、この一覧に新しいリリースの tuple を足す（print-craft の CLAUDE.md）。
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

/** 印刷屋の 1 リリース（5 変種とも同じファイル）の中身の SHA-256 */
export interface KnownRelease {
  /** desktop_js/KintoneFormulaPCraft.min.js */
  engine: string;
  /** config_js/print-craft-authoring-api.js */
  api: string;
  /** desktop_js/bignumber.min.js */
  bignumber: string;
  /** desktop_js/moment-timezone-with-data.min.js */
  momentTimezone: string;
  note?: string;
}

/** 版ごとの既知のリリース（印刷屋の修正版が出たら tuple を足す。`node -e` で zip から計算） */
export const KNOWN_PLUGIN_RELEASES: Record<string, KnownRelease[]> = {
  "6": [
    {
      engine: "8a5f78f78f51e04b5daaa435b0e8a8c0ea4d08d388d84d279f0cd1b50a857140",
      api: "59c27e480f419b9d3480c24426ae93dadf0ce7c46c940bcf7457d8252b26dea3",
      bignumber: "eca7c1c71fee589d7b5c58bd3df3f31d56fbd234821ed8c60ec4e2050ec50129",
      momentTimezone: "31b9bea01ffef2e8f311eafdbbcdd944a12194fa216d8f54489e15a7188d47dc",
      note: "Ver.6（2026-10-04 の PR #2 マージ時点。print-craft 73097d2。描画前の掃除が入る前）"
    },
    {
      engine: "8a5f78f78f51e04b5daaa435b0e8a8c0ea4d08d388d84d279f0cd1b50a857140",
      api: "3c029ba0bb2b2c869de9dc074e588cf3e5cae8caac91a83e3da196ef2aeee673",
      bignumber: "eca7c1c71fee589d7b5c58bd3df3f31d56fbd234821ed8c60ec4e2050ec50129",
      momentTimezone: "31b9bea01ffef2e8f311eafdbbcdd944a12194fa216d8f54489e15a7188d47dc",
      note: "Ver.6（2026-10-04〜05 描画前の掃除 sanitize.ts と共通の設定「外部参照」externalRefs、load.ts の derivedOf（無効な行と空の計算式は formula / usedFields を持たない）を入れた後。API に sanitizeReportCss / sanitizeReportNodes / isAllowedReportUrl / EXTERNAL_REFS / externalRefsOf を追加。途中の API 9cc7daf8… / b22564da… / 6c2e447d… は配っていないので載せない）"
    }
  ]
};

/** 旧名（計算式エンジンだけの一覧） */
export const KNOWN_ENGINE_SHA256: Record<string, string[]> = Object.fromEntries(Object.entries(KNOWN_PLUGIN_RELEASES).map(([v, rs]) => [v, rs.map((r) => r.engine)]));

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
