/**
 * テストの共通: 計算式エンジンと authoring API は、開発中の print-craft の dist/print-craft-plugin6.zip（利用者が持つ zip と同じ形）から読む。
 * 各テストファイルは別プロセスなので、ここで環境変数を置いてから engine を読む。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { PRINT_CRAFT_ROOT } from "../src/dev-paths.ts";

export const PLUGIN_ZIP = path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin6.zip");
if (!process.env.PCRAFT_PLUGIN_ZIP && existsSync(PLUGIN_ZIP)) process.env.PCRAFT_PLUGIN_ZIP = PLUGIN_ZIP;

const engineModule = await import("../src/engine.ts");
/** 中核のエンジンは環境変数を読まないので、テストの zip を明示して渡す（段階 0-2） */
export const loadEngine = (opt = {}) => engineModule.loadEngine({ pluginZip: process.env.PCRAFT_PLUGIN_ZIP, ...opt });
