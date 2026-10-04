/**
 * 置き場所の解決。tools/src と tools/dist はどちらも tools/ の 1 つ下なので、import.meta.url から同じ計算で tools/ が出る。
 *   - print-craft（印刷屋の src / lib / prod）: 開発依存 "print-craft": "file:../../print-craft" の junction（tools/node_modules/print-craft）か、
 *     環境変数 PCRAFT_PRINT_CRAFT_ROOT、無ければ隣のフォルダー ../../print-craft（Projects/kintone-plugin/print-craft）
 *   - 計算式エンジンなどの lib: 配布物では dist/lib/（build が prod/desktop_js から複写）、開発中は print-craft の prod/desktop_js
 *   - moment: vendor/（scripts/vendor.mjs が CDN から取る。印刷屋の manifest と同じ 2.24.0）
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** tools/ */
export const AUTHORING_ROOT = path.resolve(here, "..");
/** リポジトリ print-craft-authoring のルート（テンプレートの置き場所） */
export const REPO_ROOT = path.resolve(AUTHORING_ROOT, "..");
export const VENDOR_DIR = path.join(AUTHORING_ROOT, "vendor");
export const MOMENT_URL = "https://js.cybozu.com/momentjs/2.24.0/moment-with-locales.min.js";
export const MOMENT_FILE = path.join(VENDOR_DIR, "moment-with-locales.min.js");
export const ENGINE_FILE_NAME = "KintoneFormulaPCraft.min.js";
/** build が dist/lib/ に複写する lib（prod/desktop_js のファイル名） */
export const LIB_FILES = [ENGINE_FILE_NAME, "bignumber.min.js", "moment-timezone-with-data.min.js"] as const;

/** 開発依存の junction（tools/node_modules/<name>）の実体、無ければ fallback */
function linkedRoot(name: string, envVar: string, fallback: string): string {
  const env = process.env[envVar];
  if (env) return env;
  const linked = path.join(AUTHORING_ROOT, "node_modules", name);
  if (existsSync(path.join(linked, "package.json"))) {
    try {
      return realpathSync(linked);
    } catch {
      return linked;
    }
  }
  return fallback;
}

/** print-craft/（印刷屋のリポジトリ） */
export const PRINT_CRAFT_ROOT = linkedRoot("print-craft", "PCRAFT_PRINT_CRAFT_ROOT", path.resolve(REPO_ROOT, "..", "print-craft"));

/** lib のフォルダー。環境変数 PCRAFT_AUTHORING_LIB → dist/lib → print-craft の prod/desktop_js */
export function libDir(): string {
  const env = process.env.PCRAFT_AUTHORING_LIB;
  if (env) return env;
  const dist = path.join(AUTHORING_ROOT, "dist", "lib");
  if (existsSync(path.join(dist, ENGINE_FILE_NAME))) return dist;
  return path.join(PRINT_CRAFT_ROOT, "prod", "desktop_js");
}

/** plugin-config-kit のフォルダー */
export function kitRoot(): string {
  return linkedRoot("plugin-config-kit", "PCRAFT_KIT_ROOT", path.resolve(REPO_ROOT, "..", "..", "plugin-config-kit"));
}

export function rexgridRoot(): string {
  return linkedRoot("rexgrid", "PCRAFT_REXGRID_ROOT", path.resolve(REPO_ROOT, "..", "..", "rexgrid"));
}
