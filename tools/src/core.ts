/**
 * 共通の中核の入口（npm の @rex0220/print-craft-authoring-tools/core。print-craft-authoring-mcp の print-craft MCP が使う）。
 * 2026-10-09 Takashi「B」: 別のパッケージにせず、tools のパッケージに入口を足す（公開も版も 1 つ。CLI と同じ版）。
 *   - 中核は process.cwd() / process.env を読まない。作業フォルダー（実際のパス）と環境変数は呼ぶ側が引数で渡す（context.ts）
 *   - 印刷屋のコード（計算式エンジン、authoring API）は含まない。利用者の印刷屋の zip から loadEngine が読む
 *   - ここに出すものが公開の約束。CLI（cli.ts）と開発用の dev-paths.ts は出さない
 * ビルド: scripts/build.mjs が dist/core.mjs（ESM。happy-dom は依存のまま外に置く）と dist/types/（型）を作る。
 */
export const CORE_API_VERSION = 1;

// 作業の文脈とパス
export { createContext, type WorkContext } from "./context.ts";
export { PathError, WRITE_ROOTS, isInside, realResolve, resolveRead, resolveWrite } from "./safe-path.ts";
export { PermissionError, assertChangeAllowed, classOfAppPath, roleOfTarget, type ChangeOp, type TargetClass, type TargetRole } from "./permission.ts";
export {
  EDIT_RE,
  INBOX,
  KINTONE_ROOT,
  SNAPSHOT_RE,
  WORKSPACE_FILE,
  WorkspaceError,
  appDirFor,
  appFolderOfFile,
  editNameOf,
  envOfAppFolder,
  findAppDir,
  folderNameOf,
  listAppFolder,
  loadWorkspace,
  parseWorkspace,
  pickEnv,
  resolveApp,
  snapshotNameOf,
  type EnvRole,
  type EnvironmentDef,
  type Workspace
} from "./workspace.ts";

// 版と印刷屋の zip
export { MIN_PLUGIN_VERSION, PRINT_CRAFT_PLUGIN_ID, SUPPORTED_API_VERSIONS, isSupportedPluginVersion, toolsMeta, type ToolsMeta } from "./meta.ts";
export { DEFAULT_CONTEXT_BASE_URL, loadEngine, type Engine, type LoadEngineOptions } from "./engine.ts";
export { PluginZipError } from "./plugin-zip.ts";

// 接続先と認証、kintone の GET
export { AuthError, baseUrlFromEnv, describeAuth, loadAuth, loadAuthForEnv, pluginZipPath, unquote, type KintoneAuth, type LoadAuthOptions } from "./env.ts";
export { KintoneUrlError, isKintoneBaseUrl, normalizeKintoneBaseUrl } from "./kintone-url.ts";
export { ALLOWED_APIS, NotAllowedError, RECEIVE_LIMITS, RestError, createRestClient, type AllowedApi, type FetchLike, type RestClient } from "./kintone-rest.ts";

// 設定の検査・保存・ボタン
export { InputError, MAX_INPUT_BYTES, normalizeSettings, readFieldsFile, readJsonLimited, readTextLimited, relativeSettingsPath, type NormalizeInput, type NormalizeResult } from "./commands/normalize.ts";
export { loadPolicy, type Policy } from "./normalize/policy.ts";
export { type Finding } from "./normalize/findings.ts";
export { MAX_SAVE_INPUT_BYTES, digestOf, saveNewSettings, updateButton, type SaveContext, type SaveResult, type SaveStatus } from "./commands/save.ts";
export { ButtonNotFoundError, listButtons, shortenDataUrls, type ButtonsOptions } from "./commands/buttons.ts";
export { DERIVED_KEYS, diffSettings } from "./commands/diff.ts";

// 項目定義・レコード・preview・pull・take
export { fetchFields, listFields, summarizeFields, type FieldsFile, type FieldsOptions } from "./commands/fields.ts";
export { describeRecord, fetchRecord, missingInRecord, narrowRecord, shapeLines, summarizeRecord, usedFieldCodes, type KintoneRecord, type RecordFile, type RecordOptions } from "./commands/record.ts";
export { LIST_LIMIT, QUERY_MAX, QueryError, SHAPE_TEXT_MAX, listQueryOf, listRecordShapes, type RecordShape, type RecordShapes } from "./commands/records.ts";
export { extractRecord, previewFileNames, runPreview, type PreviewInput, type PreviewResult } from "./commands/preview.ts";
export { defaultPullName, pullSettings, type PullOptions, type PullResult } from "./commands/pull.ts";
export { takeInbox, type TakeResult } from "./commands/take.ts";

// ファイルの確定（新しいファイルとしてだけ置く）
export { FileExistsError, LockBusyError, writeNewFile } from "./commit-file.ts";
