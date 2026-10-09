/**
 * pcraft-authoring <command> …（docs/authoring-plan.md 12.2）。shebang は scripts/build.mjs の banner が付ける。印刷屋プラグインの設定 JSON を AI で作る・確かめるための CLI。
 * 計算式エンジンと印刷屋のコードは利用者の印刷屋 zip（.env の PCRAFT_PLUGIN_ZIP）から読む（engine.ts）。kintone には GET しか送らない（kintone-rest.ts）。
 * 1-10 レビュー BLOCKER 5: テンプレートでは AI がこの CLI を確認なしに呼べるので、
 *   - 読むのは作業フォルダー（cwd）の中のファイルだけ、書くのは fields/ records/ settings/ temp/ out/ の下だけ（safe-path.ts）
 *   - .env、policy/authoring-policy.json、印刷屋の zip の場所は固定。オプションで別の場所を指定できない（AI が書けるファイルを読ませない）
 * 終了コード: 0 成功、1 検査のエラー・認証・kintone・zip・入力の誤り、2 使い方の誤り（パスの制限を含む）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthError, baseUrlFromEnv, describeAuth, loadAuth, loadAuthForEnv, pluginZipPath } from "./env.ts";
import { appDirFor, appFolderOfFile, editNameOf, envsOfHost, findAppDir, INBOX, isEnvName, listAppFolder, loadWorkspace, pickEnv, resolveApp, SNAPSHOT_RE, snapshotNameOf, WorkspaceError, type EnvironmentDef, type Workspace } from "./workspace.ts";
import { takeInbox } from "./commands/take.ts";
import { NotAllowedError, RestError, createRestClient } from "./kintone-rest.ts";
import { KintoneUrlError } from "./kintone-url.ts";
import { fetchFields, listFields, summarizeFields } from "./commands/fields.ts";
import { describeRecord, fetchRecord, summarizeRecord, usedFieldCodes, type RecordFile } from "./commands/record.ts";
import { InputError, loadPolicy, normalizeSettings, readFieldsFile, readJsonLimited, readTextLimited, relativeSettingsPath } from "./commands/normalize.ts";
import { diffSettings } from "./commands/diff.ts";
import { ButtonNotFoundError, listButtons } from "./commands/buttons.ts";
import { defaultPullName, pullSettings } from "./commands/pull.ts";
import { runPreview } from "./commands/preview.ts";
import { DEFAULT_CONTEXT_BASE_URL, loadEngine, type Engine } from "./engine.ts";
import { PluginZipError } from "./plugin-zip.ts";
import { PolicyError } from "./normalize/policy.ts";
import { isSupportedPluginVersion, schemaRevisionOf, toolsMeta } from "./meta.ts";
import { PathError, WRITE_ROOTS, resolveRead as resolveReadIn, resolveWrite as resolveWriteIn, resolveWriteDir as resolveWriteDirIn } from "./safe-path.ts";
import { createContext, type WorkContext } from "./context.ts";
import { assertChangeAllowed, PermissionError, type ChangeOp } from "./permission.ts";
import { digestOf } from "./commands/save.ts";

const USAGE = `使い方: npx @rex0220/print-craft-authoring-tools <command> [options]
（短い npx pcraft-authoring は使わない。npm ci の前だと npm の公開レジストリの同じ名前のパッケージを取りに行く）

  version [--expect <印刷屋の版>] [--json]
      tools の版と、印刷屋の zip から読んだプラグインの版・authoring API の版・計算式エンジンの SHA-256・設定スキーマの版。
      zip が読めない、中身が既知と違う、対応しない版、または --expect の版と zip の版が違えば終了コード 1。
  fields --app N [--lang ja] [--preview] [--guest <spaceId>] [--out fields/<file>]
      項目定義とレイアウトとアプリ名を fields/<N>.json に保存（既定は運用中の形。--preview は設定画面と同じ preview の API）。
  fields --app N --summary
      取得済みの fields/<N>.json を 1 項目 1 行で（レイアウトの順。型・ラベル・書式・単位・選択肢・ルックアップ）。通信しない。
  pull --app N [--preview] [--guest <spaceId>] [--out settings/<file>] [--force] [--plugin-id <ID>]
      アプリに入っている印刷屋の今の設定を取って、設定画面の「設定をダウンロード」と同じ封筒形式で settings/APP<N>-<アプリ名>.json に保存（GET だけ）。
      kintone の API ラボ「アプリに追加されているプラグインの設定情報を取得する」を有効にした環境だけ。権限は運用中の設定がレコード閲覧（API トークンでも可）、
      --preview（動作テスト環境 = 保存して未反映の設定）がアプリ管理。プラグイン ID は印刷屋の zip から。既にあるファイルは --force で上書き。
  record --app N --id R [--fields-from <settings.json>] [--guest <spaceId>] [--out records/<file>]
      レコードを records/<N>-<R>.json に保存。--fields-from で設定が使う項目だけ残す。
  record --app N --id R --summary
      取得済みの records/<N>-<R>.json を 1 項目 1 行で。値は出さず形だけ（文字数・行数・数値の桁・テーブルの行数・添付の件数と種類）。通信しない。
  buttons <settings.json> [--button <名前>] [--json]
      設定のボタン一覧（画面・保存先・用紙・表示条件・ファイル名・帳票の行・更新項目）。--button でそのボタンの HTML / CSS / 計算式（data: の URL は長さだけ）。
      --json はファイルの digest（sha256）とボタンの名前の一覧も（直すときの照合に使う）。
  normalize <settings.json> --fields <fields.json> [--out settings/<file>] [--dry-run] [--check] [--json]
      設定画面と同じ手順で派生値を作り直し、検査して、エラーが無ければ書き戻す（既定は同じファイルに上書き。--dry-run は書かない）。
      --check は入力の派生値と生成した値の差を出す。外部 URL の承認は policy/authoring-policy.json（場所は固定。利用者が書く）。
  diff <before.json> <after.json> [--derived]
      既存設定の変更をインポートする前に人が見る差分（ボタン単位。派生値は --derived で含める）。
  preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir out/<dir>] [--json]
      有効なボタンごとに帳票の HTML を out/<ボタン名>.html に書く（sandbox の iframe + CSP。画像はダミー。Web フォントは配信元が承認済みのときだけ読む）。
      一覧帳票は対象外。式の失敗は赤字で埋めて終了コード 1。

環境とアプリのフォルダー（作業フォルダーに environments.json があるとき。構成 1 = 開発と本番でドメインが違う、構成 2 = 同じドメインで開発用と本番のアプリ）:
  全部のコマンドに --env <環境の名前>（省略は environments.json の default）。--app は番号か apps の名前。
  保存先は kintone/<ホスト名>/<番号>-<アプリ名>/（fields.json、records/<番号>.json、out/、設定のダウンロードと pull は
  rex0220-print-craft-app<番号>-<日時>.json の名前のまま）。認証はその環境の envFile だけ（OS の KINTONE_* は読まない）。
  normalize / preview にアプリのフォルダーの中のファイルを渡すと --fields は同じフォルダーの fields.json、preview --record 3 は records/3.json。
  ダウンロード / pull のファイルは書き換えない（edit で -edit.json に写して直す）。
  take [--env <名前>]
      inbox/ に置いた設定のダウンロードを、封筒の appId と environments.json の apps からアプリのフォルダーへ名前のまま移す。
  edit --app <アプリ> | edit <ダウンロードのファイル>
      一番新しい（または指定した）ダウンロード / pull を <名前>-edit.json に写す（既にあればそのまま）。直すのはこちら。
  files --app <アプリ>
      アプリのフォルダーのファイル（今の設定 = 一番新しいダウンロード / pull、-edit.json、新しい帳票、records、out）。
  buttons --app <アプリ>
      今の設定（一番新しいダウンロード / pull）のボタン一覧。

読むファイルは作業フォルダーの中、書き込み先は fields/ records/ settings/ temp/ out/ kintone/ の下だけ。
.env（作業フォルダーのもの）: KINTONE_BASE_URL（*.cybozu.com / *.kintone.com / *.cybozu.cn）と、KINTONE_API_TOKEN または KINTONE_USERNAME / KINTONE_PASSWORD
（kintone 公式 MCP と同じ）、PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス>（計算式エンジンと印刷屋のコードをここから読む）。
kintone には GET しか送らない。
`;

const FLAGS = new Set(["preview", "check", "json", "dry-run", "derived", "summary", "force"]);

class UsageError extends Error {}

/** 起動時に一度だけ作る作業の文脈（作業フォルダー = 起動したフォルダーの実際のパス、環境変数 = process.env）。中核にはこの値を渡す */
let W: WorkContext;
const resolveRead = (target: string): string => resolveReadIn(target, W.root);
const resolveWrite = (target: string, roots: readonly string[]): string => resolveWriteIn(target, roots, W.root);
const resolveWriteDir = (target: string, roots: readonly string[]): string => resolveWriteDirIn(target, roots, W.root);
const authOpt = () => ({ cwd: W.root, env: W.env });
/** kintone/ の下をこの操作で変えてよいか（environments.json の role と、操作 × 場所。permission.ts）。通信や normalize の前に止めるための早めの判定 */
const allow = (file: string, op: ChangeOp): void => assertChangeAllowed(W.root, file, op);

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!FLAGS.has(args[i].slice(2))) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function intOption(args: string[], name: string, required: boolean): number | undefined {
  const v = option(args, name);
  if (v === undefined) {
    if (required) throw new UsageError(`--${name} <数値> が要る`);
    return undefined;
  }
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} は数値: ${v}`);
  return Number(v);
}

/**
 * 使えないオプション（1-10 レビュー BLOCKER 5 で外した）を渡されたら理由を出して止める。
 * --env は 2026-10-05 から environments.json の環境の名前（場所ではない。context で検証）
 */
function rejectRemovedOptions(args: string[]): void {
  for (const name of ["policy", "plugin-zip"]) {
    if (args.includes(`--${name}`)) throw new UsageError(`--${name} は使えない。.env と policy/authoring-policy.json と PCRAFT_PLUGIN_ZIP は作業フォルダーのものに固定（AI が書けるファイルを読ませないため）`);
  }
}

/**
 * 書く直前に、書ける場所（roots）と、kintone/ の下ならこの操作で変えてよいか（role を読み直す）をもう一度確かめてから書く
 * （Codex レビュー BLOCKER 2: 早めの判定の後に通信や normalize を挟むと、その間に role が変わっても書けてしまう）
 */
function writeText(file: string, text: string, roots: readonly string[], op: ChangeOp): string {
  const real = resolveWrite(file, roots);
  allow(real, op);
  mkdirSync(path.dirname(real), { recursive: true });
  writeFileSync(real, text, "utf8");
  return real;
}

function writeJson(file: string, data: unknown, roots: readonly string[], op: ChangeOp): string {
  return writeText(file, JSON.stringify(data, null, 2) + "\n", roots, op);
}

function shown(file: string): string {
  const rel = path.relative(W.root, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

async function engineFor(): Promise<Engine> {
  const engine = await loadEngine({ pluginZip: pluginZipPath(authOpt()), allowDevPlugin: W.env.PCRAFT_ALLOW_DEV_PLUGIN === "1" });
  for (const w of engine.warnings) console.error(`注意: ${w}`);
  return engine;
}

async function version(args: string[]): Promise<number> {
  const meta = toolsMeta();
  let engine: Engine | null = null;
  let error: string | undefined;
  try {
    engine = await engineFor();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // --expect <版>: 印刷屋を上げてテンプレートを取り込んだ後に、zip の版と tools が対応する版がその版か確かめる（README「テンプレートの更新を取り込む」）
  const expect = option(args, "expect");
  if (expect !== undefined && !expect) throw new UsageError("--expect には印刷屋の版（例: 6）を続ける");
  let expectError: string | undefined;
  if (expect !== undefined && engine) {
    if (!isSupportedPluginVersion(expect)) expectError = `--expect ${expect}: tools ${meta.toolsVersion} が扱う印刷屋の版は Ver.${meta.minPluginVersion} 以降`;
    else if (engine.source.pluginVersion !== expect) expectError = `--expect ${expect}: zip の印刷屋の版は ${engine.source.pluginVersion}（${engine.source.from}。アプリに入れた版の zip を PCRAFT_PLUGIN_ZIP に書く）`;
  }
  const info = {
    ...meta,
    plugin: engine ? { source: engine.source.kind, from: engine.source.from, pluginVersion: engine.source.pluginVersion, apiVersion: engine.api.apiVersion, engineSha256: engine.source.engineSha256, apiSha256: engine.source.apiSha256, pluginId: engine.source.pluginId ?? null, schemaRevision: schemaRevisionOf(engine.api.CONFIG_SCHEMA) } : null,
    expected: expect,
    ok: !!engine && !expectError,
    error: error ?? expectError
  };
  if (flag(args, "json")) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log(`@rex0220/print-craft-authoring-tools ${meta.toolsVersion}${meta.mode === "dev" ? "（開発中）" : ""}（扱う印刷屋 Ver.${meta.minPluginVersion} 以降、API ${meta.supportedApiVersions.join(", ")}。commit ${meta.commit}${meta.builtAt ? `、ビルド ${meta.builtAt}` : ""}）`);
    if (engine) {
      console.log(`印刷屋プラグイン: 版 ${engine.source.pluginVersion}、authoring API ${engine.api.apiVersion}（${engine.source.kind === "zip" ? "zip" : "開発中の print-craft"}: ${engine.source.from}）`);
      console.log(`プラグイン ID: ${engine.source.pluginId ?? "（開発中の print-craft。確かめない）"}`);
      console.log(`計算式エンジン: sha256 ${engine.source.engineSha256}`);
      console.log(`設定スキーマの版: ${schemaRevisionOf(engine.api.CONFIG_SCHEMA)}`);
      if (expectError) console.error(expectError);
      else if (expect !== undefined) console.log(`--expect ${expect}: 一致`);
    } else {
      console.error(`印刷屋の zip: ${error}`);
    }
  }
  return info.ok ? 0 : 1;
}

/** environments.json（workspace.ts）があればその環境（--env か default）。無ければ今までの形（.env 1 つ、settings/ fields/ records/ out/） */
interface Ctx {
  ws: Workspace | null;
  env?: EnvironmentDef;
}

function context(args: string[]): Ctx {
  const ws = loadWorkspace(W.root);
  const name = option(args, "env");
  if (args.includes("--env")) {
    if (!name || !isEnvName(name)) throw new UsageError("--env には environments.json の環境の名前を続ける（ファイルの場所は指定できない）");
    if (!ws) throw new UsageError("--env は作業フォルダーに environments.json があるときだけ使える");
  }
  return ws ? { ws, env: pickEnv(ws, name) } : { ws: null };
}

function client(ctx?: Ctx) {
  const auth = ctx?.ws && ctx.env ? loadAuthForEnv(ctx.env, W.root) : loadAuth(authOpt());
  return { client: createRestClient(auth), authLabel: describeAuth(auth) };
}

/** 環境が既定でなければ、案内の文言に --env を添える */
const envFlag = (ctx: Ctx): string => (ctx.ws && ctx.env && ctx.env.name !== ctx.ws.defaultEnv ? ` --env ${ctx.env.name}` : "");

/** --app の値。environments.json があれば番号か apps の名前、無ければ番号 */
function appOf(args: string[], ctx: Ctx): number {
  if (!ctx.ws || !ctx.env) return intOption(args, "app", true) as number;
  const v = option(args, "app");
  if (!v) throw new UsageError("--app <番号か、environments.json の apps の名前> が要る");
  return resolveApp(ctx.ws, ctx.env, v).appId;
}

/** environments.json のとき: 今あるアプリのフォルダー（無ければ fields で作るよう案内して止める） */
function existingAppDir(ctx: Ctx, appId: number): string {
  const dir = findAppDir(W.root, ctx.env!, appId);
  if (!dir) throw new InputError(`アプリ ${appId} のフォルダー（kintone/${ctx.env!.host}/${appId}-…）が無い。先に npx @rex0220/print-craft-authoring-tools fields --app ${appId}${envFlag(ctx)}`);
  return dir;
}

function noOutInWorkspace(args: string[], ctx: Ctx): void {
  if (ctx.ws && args.includes("--out")) throw new UsageError("environments.json があるときは --out を使わない（保存先はアプリのフォルダー kintone/<ホスト名>/<番号>-<アプリ名>/）");
}

/** 取得済みのファイル（--summary）。無ければ取り方を添えて止める */
function existingFile(rel: string, howToFetch: string): string {
  const file = resolveRead(rel);
  if (!existsSync(file)) throw new InputError(`${shown(file)} が無い。先に npx @rex0220/print-craft-authoring-tools ${howToFetch}`);
  return file;
}

/** 設定のファイルの置き場所がアプリのフォルダーなら、同じフォルダーの fields.json / records/<番号>.json / out/ を既定にする */
function folderDefaults(settingsFile: string): { dir: string; host: string; appId: number } | null {
  return loadWorkspace(W.root) ? appFolderOfFile(W.root, settingsFile) : null;
}

/** --fields（無ければ、アプリのフォルダーの中のファイルなら同じフォルダーの fields.json） */
function fieldsFileOf(args: string[], folder: { dir: string; appId: number } | null): string {
  const arg = option(args, "fields");
  if (arg) return resolveRead(arg);
  if (!folder) throw new UsageError("--fields <fields.json> が要る（fields コマンドの出力。kintone/<ホスト名>/<番号>-…/ の中のファイルなら同じフォルダーの fields.json を使う）");
  return existingFile(path.join(folder.dir, "fields.json"), `fields --app ${folder.appId}`);
}

/** iframe の同一オリジンの判定に使う接続先。environments.json があればフォルダーのホストの環境の baseUrl（フォルダー名は AI が作れるので、それ自体は信用しない） */
function trustedBaseUrl(folder: { host: string } | null): string | undefined {
  const ws = loadWorkspace(W.root);
  if (ws && folder) return envsOfHost(ws, folder.host)[0]?.baseUrl;
  return baseUrlFromEnv(authOpt());
}

async function fields(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args, ctx);
  noOutInWorkspace(args, ctx);
  if (flag(args, "summary")) {
    const rel = ctx.ws ? path.join(existingAppDir(ctx, app), "fields.json") : path.join("fields", `${app}.json`);
    console.log(listFields(await readFieldsFile(existingFile(rel, `fields --app ${app}${envFlag(ctx)}`))));
    return 0;
  }
  const guestSpaceId = intOption(args, "guest", false);
  const { client: c, authLabel } = client(ctx);
  const file = await fetchFields(c, { app, lang: option(args, "lang"), preview: flag(args, "preview"), guestSpaceId });
  const out = ctx.ws
    ? resolveWrite(path.join(appDirFor(W.root, ctx.env!, app, file.appName), "fields.json"), WRITE_ROOTS.kintone)
    : resolveWrite(option(args, "out") ?? path.join("fields", `${app}.json`), WRITE_ROOTS.fields);
  allow(out, "fields");
  writeJson(out, file, ctx.ws ? WRITE_ROOTS.kintone : WRITE_ROOTS.fields, "fields");
  console.log(`${summarizeFields(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
  return 0;
}

async function record(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args, ctx);
  const id = intOption(args, "id", true) as number;
  noOutInWorkspace(args, ctx);
  const defaultRel = (): string => (ctx.ws ? path.join(existingAppDir(ctx, app), "records", `${id}.json`) : path.join("records", `${app}-${id}.json`));
  if (flag(args, "summary")) {
    const file = existingFile(defaultRel(), `record --app ${app} --id ${id}${envFlag(ctx)}`);
    const data = readJsonLimited(file) as unknown as RecordFile;
    if (!data.record || typeof data.record !== "object") throw new InputError(`${shown(file)} は record コマンドの出力ではない（record が無い）`);
    console.log(describeRecord(data));
    return 0;
  }
  const guestSpaceId = intOption(args, "guest", false);
  const out = resolveWrite(option(args, "out") ?? defaultRel(), WRITE_ROOTS.records);
  const from = option(args, "fields-from");
  let keep: Set<string> | undefined;
  if (from) {
    const settings = readJsonLimited(resolveRead(from));
    const codes = usedFieldCodes(settings);
    if (!codes) console.log(`${from} に使う項目の情報が無いので絞らない（normalize した設定なら usedFields から絞れる）`);
    else keep = codes;
  }
  const { client: c, authLabel } = client(ctx);
  allow(out, "record");
  const file = await fetchRecord(c, { app, id, guestSpaceId, keep });
  writeJson(out, file, WRITE_ROOTS.records, "record");
  console.log(`${summarizeRecord(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}（個人情報を含む。コミットしない）`);
  return 0;
}

async function normalize(args: string[]): Promise<number> {
  const [settingsArg] = positional(args);
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const settingsFile = resolveRead(settingsArg);
  const folder = folderDefaults(settingsFile);
  const fieldsFile = fieldsFileOf(args, folder);
  const write = !flag(args, "dry-run");
  // ダウンロードと pull のファイルは書き換えない（Takashi 2026-10-05「直したものを別の名前」）。edit で -edit.json に写して直す
  if (write && folder && !option(args, "out") && SNAPSHOT_RE.test(path.basename(settingsFile))) {
    throw new UsageError(`ダウンロード / pull のファイルは書き換えない。npx @rex0220/print-craft-authoring-tools edit ${shown(settingsFile)} で -edit.json に写してから直す（検査だけなら --dry-run）`);
  }
  const out = write ? resolveWrite(option(args, "out") ?? settingsFile, WRITE_ROOTS.settings) : undefined;
  if (out) allow(out, "settings");
  const fieldsData = await readFieldsFile(fieldsFile);
  const baseUrl = trustedBaseUrl(folder);
  const engine = await engineFor();
  engine.setContext({ baseUrl: baseUrl ?? DEFAULT_CONTEXT_BASE_URL, appId: fieldsData.appId });
  const result = await normalizeSettings({
    settingsText: readTextLimited(settingsFile),
    settingsFile: relativeSettingsPath(settingsArg, W.root),
    fields: fieldsData,
    engine,
    policy: loadPolicy({ cwd: W.root }),
    check: flag(args, "check"),
    baseUrl
  });
  if (flag(args, "json")) {
    console.log(JSON.stringify({ summary: result.summary, findings: result.findings.items, size: result.size, checkDiffs: result.checkDiffs, written: !!result.output && write }, null, 2));
  } else {
    console.log(`normalize: ${settingsArg}（${result.summary}）`);
    console.log(result.findings.format());
    if (result.checkDiffs) {
      console.log(result.checkDiffs.length ? `--check: 入力の派生値と生成した値の差 ${result.checkDiffs.length} 件` : "--check: 入力の派生値と生成した値は一致");
      for (const d of result.checkDiffs.slice(0, 50)) console.log(`  ${d}`);
      if (result.checkDiffs.length > 50) console.log(`  … 他 ${result.checkDiffs.length - 50} 件`);
    }
  }
  if (!result.output) {
    if (!flag(args, "json")) console.error("エラーがあるので書き出さない");
    return 1;
  }
  if (out) {
    writeJson(out, result.output, WRITE_ROOTS.settings, "settings");
    if (!flag(args, "json")) console.log(`出力: ${shown(out)}（封筒の date を更新。派生値を生成）`);
  }
  return 0;
}

async function diff(args: string[]): Promise<number> {
  const [before, after] = positional(args);
  if (!before || !after) throw new UsageError("diff <before.json> <after.json>");
  const a = readJsonLimited(resolveRead(before));
  const b = readJsonLimited(resolveRead(after));
  console.log(diffSettings(a, b, { derived: flag(args, "derived") }));
  return 0;
}

async function pull(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args, ctx);
  noOutInWorkspace(args, ctx);
  const guestSpaceId = intOption(args, "guest", false);
  const preview = flag(args, "preview");
  const outArg = option(args, "out");
  if (args.includes("--out") && !outArg) throw new UsageError("--out には settings/ の下のファイル名を続ける");
  const engine = await engineFor();
  const pluginId = option(args, "plugin-id") ?? engine.source.pluginId;
  if (!pluginId) throw new InputError("プラグイン ID が分からない（印刷屋の zip に PUBKEY が無い）。--plugin-id <ID>（アプリの設定 → プラグインの一覧で確かめる）");
  const { client: c, authLabel } = client(ctx);
  let result;
  try {
    result = await pullSettings(c, engine, { app, preview, guestSpaceId, pluginId });
  } catch (e) {
    if (e instanceof RestError && /plugin\/config/.test(e.apiPath ?? "")) {
      throw new RestError(`${e.message}。確かめること: kintone の API ラボ「アプリに追加されているプラグインの設定情報を取得または更新するREST API」が有効か（cybozu.com 共通管理者がアップデートオプションの「検討中の新機能」で）、権限（運用中: レコード閲覧。API トークンでも可 / --preview: アプリ管理）、アプリに印刷屋プラグイン（ID ${pluginId}）が入っているか`, e.status, e.code, e.apiPath);
    }
    throw e;
  }
  // environments.json があるときは、アプリのフォルダーにダウンロードと同じ名前（rex0220-print-craft-app<番号>-<日時>.json）で置く
  const out = ctx.ws
    ? resolveWrite(path.join(appDirFor(W.root, ctx.env!, app, result.appName), snapshotNameOf(app)), WRITE_ROOTS.kintone)
    : resolveWrite(outArg ?? path.join("settings", defaultPullName(result.appName, app)), WRITE_ROOTS.settings);
  if (existsSync(out) && !flag(args, "force")) throw new InputError(`${shown(out)} は既にある。上書きするなら --force（上書きの前の内容は git の差分で確かめる）、別の名前なら --out settings/<ファイル>`);
  allow(out, ctx.ws ? "snapshot" : "settings");
  writeJson(out, result.envelope, ctx.ws ? WRITE_ROOTS.kintone : WRITE_ROOTS.settings, ctx.ws ? "snapshot" : "settings");
  console.log(`pull: アプリ ${app} ${result.appName}（${preview ? "動作テスト環境" : "運用中"}の設定、revision ${result.revision}、保存形式 ${result.format}）を${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
  console.log(listButtons(result.envelope, { file: shown(out) }));
  return 0;
}

async function buttons(args: string[]): Promise<number> {
  let [settingsArg] = positional(args);
  if (!settingsArg && args.includes("--app")) {
    // environments.json のとき: --app のフォルダーの一番新しいダウンロード / pull（今の設定）
    const ctx = context(args);
    if (!ctx.ws) throw new UsageError("buttons --app は environments.json があるときだけ。今までの形では buttons <設定 JSON>");
    const app = appOf(args, ctx);
    const list = listAppFolder(existingAppDir(ctx, app));
    if (!list.snapshots.length) throw new InputError(`${shown(list.dir)} にダウンロード / pull のファイルが無い（設定画面でダウンロードして inbox/ に置き take、または pull --app ${app}${envFlag(ctx)}）`);
    settingsArg = shown(path.join(list.dir, list.snapshots[0]));
  }
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const button = option(args, "button");
  if (args.includes("--button") && !button) throw new UsageError("--button にはボタン名を続ける");
  const file = resolveRead(settingsArg);
  const settings = readJsonLimited(file);
  const text = listButtons(settings, { file: settingsArg, button });
  if (flag(args, "json")) {
    // 直すときの照合に使う digest（ファイルのバイト列の sha256）と、ボタンの名前（menu。設定の中で一意）
    const menus = (Array.isArray(settings.pluginInfos) ? settings.pluginInfos : []).map((r) => String((r as { menu?: unknown }).menu ?? ""));
    console.log(JSON.stringify({ file: shown(file), digest: digestOf(readFileSync(file)), menus, text }, null, 2));
  } else {
    console.log(text);
  }
  return 0;
}

async function take(args: string[]): Promise<number> {
  const ctx = context(args);
  if (!ctx.ws) throw new UsageError("take は environments.json があるときだけ使える（inbox/ のダウンロードをアプリのフォルダーへ移す）");
  const r = takeInbox(W.root, ctx.ws, args.includes("--env") ? ctx.env!.name : undefined);
  for (const m of r.moved) console.log(`${m.file} → ${m.to}${m.same ? "（同じものが既にあったので inbox から消した）" : ""}`);
  for (const s of r.skipped) console.error(`移さない: ${s.file}（${s.reason}）`);
  if (!r.moved.length && !r.skipped.length) console.log(`${INBOX}/ に設定のファイルが無い`);
  return r.skipped.length ? 1 : 0;
}

async function edit(args: string[]): Promise<number> {
  const ctx = context(args);
  if (!ctx.ws) throw new UsageError("edit は environments.json があるときだけ使える（今までの形では settings/ のファイルをそのまま直す）");
  let [src] = positional(args);
  if (!src) {
    const app = appOf(args, ctx);
    const list = listAppFolder(existingAppDir(ctx, app));
    if (!list.snapshots.length) throw new InputError(`${shown(list.dir)} にダウンロード / pull のファイルが無い`);
    src = path.join(list.dir, list.snapshots[0]);
  }
  const file = resolveRead(src);
  if (!SNAPSHOT_RE.test(path.basename(file)) || !appFolderOfFile(W.root, file)) throw new UsageError(`edit に渡すのはアプリのフォルダーのダウンロード / pull のファイル（rex0220-print-craft-app<番号>-<日時>.json）: ${src}`);
  const dest = resolveWrite(editNameOf(file), WRITE_ROOTS.kintone);
  if (existsSync(dest)) {
    console.log(`既にある（続けて直す）: ${shown(dest)}`);
  } else {
    allow(dest, "settings");
    writeText(dest, readTextLimited(file), WRITE_ROOTS.kintone, "settings");
    console.log(`${shown(file)} → ${shown(dest)}（ここを直す。ダウンロードのファイルは書き換えない）`);
  }
  console.log(`次: 直したら npx @rex0220/print-craft-authoring-tools normalize ${shown(dest)} → diff ${shown(file)} ${shown(dest)}`);
  return 0;
}

async function files(args: string[]): Promise<number> {
  const ctx = context(args);
  if (!ctx.ws) throw new UsageError("files は environments.json があるときだけ使える");
  const app = appOf(args, ctx);
  const l = listAppFolder(existingAppDir(ctx, app));
  const lines = [
    `${shown(l.dir)}（環境 ${ctx.env!.name}、${ctx.env!.baseUrl}）`,
    `fields.json: ${l.hasFields ? "あり" : `無い（npx @rex0220/print-craft-authoring-tools fields --app ${app}${envFlag(ctx)}）`}`,
    `ダウンロード / pull（新しい順。先頭が今の設定）: ${l.snapshots.length ? "" : "無い"}`,
    ...l.snapshots.map((n, i) => `  ${n}${i === 0 ? "  ← 今の設定" : ""}`),
    `直したもの（-edit.json）: ${l.edits.length ? "" : "無い"}`,
    ...l.edits.map((n) => `  ${n}`),
    `その他の設定（新しい帳票など）: ${l.reports.length ? "" : "無い"}`,
    ...l.reports.map((n) => `  ${n}`),
    `records/: ${l.records.length ? l.records.join(", ") : "無い"}　out/: ${l.outs} 件`
  ];
  console.log(lines.join("\n"));
  return 0;
}

async function preview(args: string[]): Promise<number> {
  const [settingsArg] = positional(args);
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const settingsFile = resolveRead(settingsArg);
  const folder = folderDefaults(settingsFile);
  const fieldsFile = fieldsFileOf(args, folder);
  const recordArg = option(args, "record");
  if (!recordArg) throw new UsageError("--record <record.json> が要る（record コマンドの出力。アプリのフォルダーの中のファイルならレコード番号だけでよい: --record 3）");
  // アプリのフォルダーの中のファイルなら --record 3 は同じフォルダーの records/3.json
  const recordFile = folder && /^\d+$/.test(recordArg) ? existingFile(path.join(folder.dir, "records", `${recordArg}.json`), `record --app ${folder.appId} --id ${recordArg}`) : resolveRead(recordArg);
  const outDir = resolveWriteDir(option(args, "out-dir") ?? (folder ? path.join(folder.dir, "out") : "out"), WRITE_ROOTS.out);
  const fieldsData = await readFieldsFile(fieldsFile);
  const engine = await engineFor();
  const result = await runPreview({
    settingsText: readTextLimited(settingsFile),
    settingsFile: relativeSettingsPath(settingsArg, W.root),
    fields: fieldsData,
    recordFile: readJsonLimited(recordFile),
    engine,
    policy: loadPolicy({ cwd: W.root }),
    button: option(args, "button"),
    baseUrl: trustedBaseUrl(folder)
  });
  const written: string[] = [];
  if (!result.findings.hasErrors) {
    for (const r of result.results) {
      const file = resolveWrite(path.join(outDir, r.file), WRITE_ROOTS.out);
      allow(file, "preview");
      writeText(file, r.html, WRITE_ROOTS.out, "preview");
      written.push(shown(file));
    }
  }
  if (flag(args, "json")) {
    console.log(JSON.stringify({ summary: result.summary, findings: result.findings.items, results: result.results.map((r) => ({ menu: r.menu, file: shown(path.join(outDir, r.file)), fileName: r.fileName, pages: r.pages, errors: r.errors })), skipped: result.skipped, written }, null, 2));
  } else {
    console.log(`preview: ${settingsArg}（${result.summary}）`);
    console.log(result.findings.format());
    for (const r of result.results) {
      console.log(`${r.menu}: ${r.pages} ページ、ファイル名 ${r.fileName}${r.errors.length ? `、式のエラー ${r.errors.length}` : ""} → ${shown(path.join(outDir, r.file))}`);
      for (const e of r.errors) console.log(`  ${e}`);
    }
    for (const s of result.skipped) console.log(`対象外: ${s}`);
    if (result.findings.hasErrors) console.error("設定にエラーがあるのでプレビューは書かない（normalize で直す）");
    else if (written.length) console.log(`出力 ${written.length} 件（レコードの値を含む。コミットしない。Chrome で開く）`);
  }
  return result.findings.hasErrors || result.results.some((r) => r.errors.length) ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  W = createContext({ cwd: process.cwd(), env: process.env });
  rejectRemovedOptions(args);
  // --env はどのコマンドでも検証する（環境を使わないコマンドで黙って無視しない）
  if (args.includes("--env")) context(args);
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return command === undefined ? 2 : 0;
    case "version":
      return version(args);
    case "fields":
      return fields(args);
    case "record":
      return record(args);
    case "normalize":
      return normalize(args);
    case "diff":
      return diff(args);
    case "buttons":
      return buttons(args);
    case "pull":
      return pull(args);
    case "take":
      return take(args);
    case "edit":
      return edit(args);
    case "files":
      return files(args);
    case "preview":
      return preview(args);
    default:
      console.error(`不明なコマンド: ${command}\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError || e instanceof PathError) {
      console.error(`${e.message}\n${USAGE}`);
      process.exitCode = 2;
    } else if (e instanceof AuthError || e instanceof RestError || e instanceof NotAllowedError || e instanceof PluginZipError || e instanceof PolicyError || e instanceof InputError || e instanceof KintoneUrlError || e instanceof ButtonNotFoundError || e instanceof WorkspaceError || e instanceof PermissionError) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
);
