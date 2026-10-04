/**
 * 置き場所の解決。tools/src と tools/dist はどちらも tools/ の 1 つ下なので、import.meta.url から同じ計算で tools/ が出る。
 *   - 計算式エンジンと印刷屋の authoring API は利用者の印刷屋 zip から読む（plugin-zip.ts）。開発中は隣の print-craft の prod/ からも読める
 *   - moment: vendor/（scripts/vendor.mjs が CDN から取る。印刷屋の manifest と同じ 2.24.0）
 *   - print-craft（型だけ import する）: 開発依存 "print-craft": "file:../../print-craft" の junction、環境変数 PCRAFT_PRINT_CRAFT_ROOT、隣のフォルダー
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

/** print-craft/（印刷屋のリポジトリ。開発中だけ使う） */
export const PRINT_CRAFT_ROOT = linkedRoot("print-craft", "PCRAFT_PRINT_CRAFT_ROOT", path.resolve(REPO_ROOT, "..", "print-craft"));

/** 開発中の読み込み元（print-craft の prod/。zip の中と同じ配置） */
export function devPluginDir(): string | null {
  const dir = path.join(PRINT_CRAFT_ROOT, "prod");
  return existsSync(path.join(dir, "desktop_js", "KintoneFormulaPCraft.min.js")) ? dir : null;
}

/** plugin-config-kit のフォルダー（型だけ） */
export function kitRoot(): string {
  return linkedRoot("plugin-config-kit", "PCRAFT_KIT_ROOT", path.resolve(REPO_ROOT, "..", "..", "plugin-config-kit"));
}

export function rexgridRoot(): string {
  return linkedRoot("rexgrid", "PCRAFT_REXGRID_ROOT", path.resolve(REPO_ROOT, "..", "..", "rexgrid"));
}
