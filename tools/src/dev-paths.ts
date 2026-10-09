/**
 * 開発とビルドのときだけ使う場所の探し方（環境変数を読む。中核の境界の外。cli.ts と scripts/・試験だけが import する。Codex 再レビュー BLOCKER 1）。
 *   - print-craft（型だけ import する。開発中は prod/ からも読める）: 開発依存 "print-craft": "file:../../print-craft" の junction、環境変数 PCRAFT_PRINT_CRAFT_ROOT、隣のフォルダー
 *   - plugin-config-kit、rexgrid（型だけ）: 同じ探し方（PCRAFT_KIT_ROOT、PCRAFT_REXGRID_ROOT）
 * 中核（engine.ts など）は環境変数を読まない。開発中の読み込み元は CLI が printCraftProdDir(W.env) で決めて loadEngine に渡す。
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { AUTHORING_ROOT, REPO_ROOT } from "./paths.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** 開発依存の junction（tools/node_modules/<name>）の実体、無ければ fallback */
function linkedRoot(env: Env, name: string, envVar: string, fallback: string): string {
  const v = env[envVar];
  if (v) return v;
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
export function printCraftRootOf(env: Env): string {
  return linkedRoot(env, "print-craft", "PCRAFT_PRINT_CRAFT_ROOT", path.resolve(REPO_ROOT, "..", "print-craft"));
}

/** 開発中の読み込み元（print-craft の prod/。zip の中と同じ配置）。在るかは engine.ts が確かめる */
export function printCraftProdDir(env: Env): string {
  return path.join(printCraftRootOf(env), "prod");
}

/** scripts/ と試験用（このプロセスの環境変数で決める） */
export const PRINT_CRAFT_ROOT = printCraftRootOf(process.env);

/** 開発中の読み込み元が在れば、そのフォルダー（試験用） */
export function devPluginDir(): string | null {
  const dir = printCraftProdDir(process.env);
  return existsSync(path.join(dir, "desktop_js", "KintoneFormulaPCraft.min.js")) ? dir : null;
}

/** plugin-config-kit のフォルダー（型だけ） */
export function kitRoot(): string {
  return linkedRoot(process.env, "plugin-config-kit", "PCRAFT_KIT_ROOT", path.resolve(REPO_ROOT, "..", "..", "plugin-config-kit"));
}

export function rexgridRoot(): string {
  return linkedRoot(process.env, "rexgrid", "PCRAFT_REXGRID_ROOT", path.resolve(REPO_ROOT, "..", "..", "rexgrid"));
}
