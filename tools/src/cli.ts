/**
 * pcraft-authoring <command> …（docs/authoring-plan.md 12.2）。shebang は scripts/build.mjs の banner が付ける。印刷屋プラグインの設定 JSON を AI で作る・確かめるための CLI。
 * 計算式エンジンと印刷屋のコードは利用者の印刷屋 zip（.env の PCRAFT_PLUGIN_ZIP）から読む（engine.ts）。kintone には GET しか送らない（kintone-rest.ts）。
 * 1-10 レビュー BLOCKER 5: テンプレートでは AI がこの CLI を確認なしに呼べるので、
 *   - 読むのは作業フォルダー（cwd）の中のファイルだけ、書くのは fields/ records/ settings/ temp/ out/ の下だけ（safe-path.ts）
 *   - .env、policy/authoring-policy.json、印刷屋の zip の場所は固定。オプションで別の場所を指定できない（AI が書けるファイルを読ませない）
 * 終了コード: 0 成功、1 検査のエラー・認証・kintone・zip・入力の誤り、2 使い方の誤り（パスの制限を含む）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { jsonErrorWhere } from "./json-error.ts";
import path from "node:path";
import { AuthError, baseUrlFromEnv, describeAuth, kintoneConfigPath, loadAuth, pluginZipPath } from "./env.ts";
import { appDirFor, appFolderOfFile, assertAppMark, assertUsableInKintone, editNameOf, ensureAppFolder, findAppDir, INBOX, KINTONE_ROOT, legacyBlockedError, listAppFolder, modeOf, SNAPSHOT_RE, snapshotNameOf, WorkspaceError, type WorkspaceMode } from "./workspace.ts";
import { ConnectionError, PROFILE_NAME_RE, authFor, pickProfile, type ProfileDef } from "./connections.ts";
import { takeInbox } from "./commands/take.ts";
import { NotAllowedError, RestError, createRestClient } from "./kintone-rest.ts";
import { KintoneUrlError } from "./kintone-url.ts";
import { fetchFields, listFields, summarizeFields } from "./commands/fields.ts";
import { describeRecord, fetchRecord, summarizeRecord, usedFieldCodes, type RecordFile } from "./commands/record.ts";
import { printCraftProdDir } from "./dev-paths.ts";
import { FileExistsError, writeNewFile } from "./commit-file.ts";
import { InputError, MAX_INPUT_BYTES, loadPolicy, normalizeSettings, readFieldsFile, readJsonLimited, readTextLimited, relativeSettingsPath } from "./commands/normalize.ts";
import { diffSettings } from "./commands/diff.ts";
import { ButtonNotFoundError, listButtons } from "./commands/buttons.ts";
import { defaultPullName, pullSettings } from "./commands/pull.ts";
import { runPreview } from "./commands/preview.ts";
import { DEFAULT_CONTEXT_BASE_URL, loadEngine, type Engine } from "./engine.ts";
import { PluginZipError } from "./plugin-zip.ts";
import { PolicyError } from "./normalize/policy.ts";
import { isSupportedPluginVersion, schemaRevisionOf, toolsMeta } from "./meta.ts";
import { PathError, WRITE_ROOTS, isInside, resolveRead as resolveReadIn, resolveWrite as resolveWriteIn, resolveWriteDir as resolveWriteDirIn } from "./safe-path.ts";
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
      --preview（動作テスト環境 = 保存して未反映の設定）がアプリ管理。プラグイン ID は印刷屋の zip から。既にあるファイルは --force で上書き
      （--force は settings/ に置くときだけ。接続のファイルがあるときはダウンロードと同じ日時の名前で新しく置き、上書きしない）。
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

kintone の接続のファイル（PCRAFT_KINTONE_CONFIG があるとき。kSQL の ksql.config.json と同じ形。複数のドメイン・アプリ）:
  PCRAFT_KINTONE_CONFIG は OS の環境変数（絶対パス）か .env（.env のフォルダーからの相対パスでもよい）。接続のファイルは作業フォルダーの外に置く。
  kintone を使うコマンドに --profile <名前>（省略は接続のファイルの defaultProfile、無ければ dev）。--app は番号。--guest は使わない（profile の guestSpaceId）。
  保存先は kintone/<profile>/<番号>-<アプリ名>/（fields.json、records/<番号>.json、out/、設定のダウンロードと pull は
  rex0220-print-craft-app<番号>-<日時>.json の名前のまま。フォルダーの印 .pcraft-app.json）。認証は profile のそのアプリの tokenMap か、ログイン名とパスワード。
  normalize / preview にアプリのフォルダーの中のファイルを渡すと --fields は同じフォルダーの fields.json、preview --record 3 は records/3.json。
  ダウンロード / pull のファイルは書き換えない（edit で -edit.json に写して直す）。environments.json（1.x）は使わない（あれば止まる。バージョンアップ手順）。
  take [--profile <名前>]
      inbox/ に置いた設定のダウンロードを、封筒の appId で profile のアプリのフォルダーへ名前のまま移す。
  edit --app <アプリ> | edit <ダウンロードのファイル>
      一番新しい（または指定した）ダウンロード / pull を <名前>-edit.json に写す（既にあればそのまま）。直すのはこちら。
  files --app <アプリ>
      アプリのフォルダーのファイル（今の設定 = 一番新しいダウンロード / pull、-edit.json、新しい帳票、records、out）。
  buttons --app <アプリ>
      今の設定（一番新しいダウンロード / pull）のボタン一覧。

読むファイルは作業フォルダーの中、書き込み先は fields/ records/ settings/ temp/ out/ kintone/ の下だけ（kintone/ の下は接続のファイルがあるときだけ）。
.env（作業フォルダーのもの）: 接続のファイルが無いときは KINTONE_BASE_URL（*.cybozu.com / *.kintone.com / *.cybozu.cn）と、KINTONE_API_TOKEN または
KINTONE_USERNAME / KINTONE_PASSWORD（kintone 公式 MCP と同じ。1 接続）、PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス>（計算式エンジンと印刷屋のコードをここから読む）。
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
/** 動く形（接続のファイルの有無、environments.json。workspace.ts の modeOf）。kintone を使うコマンドと kintone/ の下のファイルを扱うときだけ読む */
let MODE: WorkspaceMode | undefined;
function mode(): WorkspaceMode {
  MODE ??= modeOf(W.root, { configFile: kintoneConfigPath(authOpt()), workspaceRoots: [W.root], env: W.env, surface: "cli" });
  return MODE;
}
const inKintone = (file: string): boolean => isInside(path.resolve(W.root, file), path.join(W.root, KINTONE_ROOT));
/** kintone/ の下をこの操作で変えてよいか（profile の形、印、操作 × 場所、接続のファイルを読み直して接続が同じか。permission.ts）。通信や normalize の前に止めるための早めの判定 */
const allow = (file: string, op: ChangeOp): void => {
  if (inKintone(file)) assertChangeAllowed(W.root, file, op, mode());
};
/** kintone/ の下のファイルを読む前に（profile の形、接続のファイルにある profile、印。15.5） */
const usable = (file: string): void => {
  if (inKintone(file)) assertUsableInKintone(W.root, file, mode());
};

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
 * --env は 2.0.0 からいつも断る（environments.json の形をやめた。--profile にする。print-craft MCP の実装案 15.9）。--profile は名前の形だけをいつも確かめる
 */
function rejectRemovedOptions(args: string[]): void {
  for (const name of ["policy", "plugin-zip"]) {
    if (args.includes(`--${name}`)) throw new UsageError(`--${name} は使えない。.env と policy/authoring-policy.json と PCRAFT_PLUGIN_ZIP は作業フォルダーのものに固定（AI が書けるファイルを読ませないため）`);
  }
  if (args.includes("--env")) throw new UsageError("--env は tools 2.0.0 から使わない。kintone の接続のファイル（PCRAFT_KINTONE_CONFIG）の profile を --profile で選ぶ（environments.json は接続のファイルに移す。バージョンアップ手順）");
  if (args.includes("--profile")) {
    const name = option(args, "profile");
    if (!name || !PROFILE_NAME_RE.test(name)) throw new UsageError("--profile には接続のファイルの profile の名前（英数字と - _）を続ける");
  }
}

/**
 * 書く直前に、書ける場所（roots）と、kintone/ の下ならこの操作で変えてよいか（印と、接続のファイルを読み直して接続が同じか）をもう一度確かめてから書く
 * （Codex レビュー BLOCKER 2: 早めの判定の後に通信や normalize を挟むと、その間に接続が変わっても書けてしまう）
 */
function writeText(file: string, text: string, roots: readonly string[], op: ChangeOp, opt: { exclusive?: boolean } = {}): string {
  const real = resolveWrite(file, roots);
  allow(real, op);
  mkdirSync(path.dirname(real), { recursive: true });
  // ダウンロード / pull のファイルと、--force の無い pull は新しいファイルとしてだけ書く（確かめた後に作られた同じ名前のファイルを上書きしない。Codex 再レビュー BLOCKER 2）
  if (opt.exclusive ?? op === "snapshot") {
    try {
      const { cleanup } = writeNewFile(real, text, () => {
        if (resolveWrite(file, roots) !== real) throw new InputError(`書く先のフォルダーが途中で変わった（symlink など）: ${shown(real)}`);
        allow(real, op);
      });
      for (const c of cleanup) console.error(`注意: 書いたが一時ファイルを消せなかった（${c}）`);
    } catch (e) {
      if (e instanceof FileExistsError) throw new InputError(`${shown(real)} は既にある（確かめた後に作られた）。上書きしない`);
      throw e;
    }
    return real;
  }
  writeFileSync(real, text, "utf8");
  return real;
}

function writeJson(file: string, data: unknown, roots: readonly string[], op: ChangeOp, opt: { exclusive?: boolean } = {}): string {
  return writeText(file, JSON.stringify(data, null, 2) + "\n", roots, op, opt);
}

function shown(file: string): string {
  const rel = path.relative(W.root, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

async function engineFor(): Promise<Engine> {
  const engine = await loadEngine({ pluginZip: pluginZipPath(authOpt()), devPluginDir: W.env.PCRAFT_ALLOW_DEV_PLUGIN === "1" ? printCraftProdDir(W.env) : undefined });
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

/**
 * kintone を使うコマンドの文脈（print-craft MCP の実装案 15.9 の表）: 接続のファイルがあれば profile の形（--profile か、defaultProfile、無ければ dev）、
 * 無ければ 1 接続の形（.env 1 つ、settings/ fields/ records/ out/）。environments.json が残っていれば止まる（legacy-config-present）
 */
interface Ctx {
  mode: WorkspaceMode;
  /** profile の形の選んだ profile */
  def?: ProfileDef;
  /** --profile を付けたか（案内の文言に添える） */
  explicit?: string;
}

function context(args: string[]): Ctx {
  const m = mode();
  if (m.kind === "legacy-blocked") throw legacyBlockedError();
  if (m.kind === "profiles") {
    if (args.includes("--guest")) throw new UsageError("接続のファイルの形では --guest を使わない（ゲストスペースは profile の guestSpaceId で決める）");
    const explicit = option(args, "profile");
    return { mode: m, def: pickProfile(m.connections.set, explicit), ...(explicit ? { explicit } : {}) };
  }
  if (args.includes("--profile")) throw new UsageError("--profile は kintone の接続のファイル（PCRAFT_KINTONE_CONFIG）があるときだけ使える");
  return { mode: m };
}

/** kintone の接続（profile の形はそのアプリの認証と profile のゲストスペース、1 接続の形は .env と --guest） */
function client(ctx: Ctx, args: string[], appId: number) {
  if (ctx.def && ctx.mode.kind === "profiles") {
    const auth = authFor(ctx.mode.connections.set, ctx.def, appId);
    return { client: createRestClient(auth), authLabel: `${describeAuth(auth)}（profile ${ctx.def.profile}）`, guestSpaceId: ctx.def.guestSpaceId ?? undefined };
  }
  const auth = loadAuth(authOpt());
  return { client: createRestClient(auth), authLabel: describeAuth(auth), guestSpaceId: intOption(args, "guest", false) };
}

/** --profile を付けていれば、案内の文言に添える */
const profileFlag = (ctx: Ctx): string => (ctx.explicit ? ` --profile ${ctx.explicit}` : "");

/** --app の値（番号） */
function appOf(args: string[]): number {
  return intOption(args, "app", true) as number;
}

/** profile の形でだけ使えるコマンドの文脈 */
function profileContext(args: string[], what: string): Ctx & { def: ProfileDef } {
  const ctx = context(args);
  if (!ctx.def) throw new UsageError(`${what} は kintone の接続のファイル（PCRAFT_KINTONE_CONFIG）があるときだけ使える`);
  return ctx as Ctx & { def: ProfileDef };
}

/** profile の形のとき: 今あるアプリのフォルダー（無ければ fields で作るよう案内して止める。印が合わなければ止める） */
function existingAppDir(ctx: Ctx & { def: ProfileDef }, appId: number): string {
  const dir = findAppDir(W.root, ctx.def.profile, appId);
  if (!dir) throw new InputError(`アプリ ${appId} のフォルダー（kintone/${ctx.def.profile}/${appId}-…）が無い。先に npx @rex0220/print-craft-authoring-tools fields --app ${appId}${profileFlag(ctx)}`);
  assertAppMark(dir, ctx.def, appId);
  return dir;
}

function noOutInWorkspace(args: string[], ctx: Ctx): void {
  if (ctx.def && args.includes("--out")) throw new UsageError("接続のファイルがあるときは --out を使わない（保存先はアプリのフォルダー kintone/<profile>/<番号>-<アプリ名>/）");
}

/** 取得済みのファイル（--summary）。無ければ取り方を添えて止める */
function existingFile(rel: string, howToFetch: string): string {
  const file = resolveRead(rel);
  if (!existsSync(file)) throw new InputError(`${shown(file)} が無い。先に npx @rex0220/print-craft-authoring-tools ${howToFetch}`);
  return file;
}

/**
 * 設定のファイルの置き場所がアプリのフォルダーなら、同じフォルダーの fields.json / records/<番号>.json / out/ を既定にする。
 * kintone/ の下のファイルは profile の形でだけ、印が今の接続のこのアプリのものなら使う（15.5）。--profile がフォルダーの profile と違えば止める
 */
function folderDefaults(settingsFile: string, args: string[]): { dir: string; profile: string; appId: number } | null {
  if (!inKintone(settingsFile)) return null;
  usable(settingsFile);
  const folder = appFolderOfFile(W.root, settingsFile);
  const explicit = option(args, "profile");
  if (folder && explicit && explicit !== folder.profile) throw new UsageError(`--profile ${explicit} とファイルのフォルダーの profile（${folder.profile}）が違う`);
  return folder;
}

/**
 * 項目定義のファイル。アプリのフォルダーの中のファイルは、いつも同じフォルダーの fields.json（--fields はそれと同じときだけ。別のアプリ・profile・settings/ の
 * 項目定義で検査しない。保存の中核と同じ。Codex の実装レビュー MAJOR 3）。ほかは --fields が要る
 */
function fieldsFileOf(args: string[], folder: { dir: string; appId: number } | null): string {
  const arg = option(args, "fields");
  if (folder) {
    const own = existingFile(path.join(folder.dir, "fields.json"), `fields --app ${folder.appId}`);
    if (arg && resolveRead(arg) !== own) throw new PermissionError(`アプリのフォルダーの中のファイルは、同じフォルダーの fields.json で検査する（--fields は付けないか、${shown(own)} にする）`);
    return own;
  }
  if (!arg) throw new UsageError("--fields <fields.json> が要る（fields コマンドの出力。kintone/<profile>/<番号>-…/ の中のファイルなら同じフォルダーの fields.json を使う）");
  const file = resolveRead(arg);
  usable(file);
  return file;
}

/**
 * iframe の同一オリジンの判定に使う接続先（フォルダー名は AI が作れるので、それ自体は信用しない。接続のファイルの profile の baseUrl）。
 * アプリのフォルダーのファイルはその profile、ほかは --profile か 15.2 の選び方（決まらなければ iframe を使わない）。1 接続の形は .env の KINTONE_BASE_URL
 */
function trustedBaseUrl(folder: { profile: string } | null, args: string[]): string | undefined {
  const m = mode();
  if (m.kind === "single") return baseUrlFromEnv(authOpt());
  if (m.kind !== "profiles") return undefined;
  if (folder) return m.connections.set.profiles.get(folder.profile)?.baseUrl;
  try {
    return pickProfile(m.connections.set, option(args, "profile")).baseUrl;
  } catch (e) {
    if (e instanceof ConnectionError && option(args, "profile") === undefined) return undefined;
    throw e;
  }
}

async function fields(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args);
  noOutInWorkspace(args, ctx);
  if (flag(args, "summary")) {
    const rel = ctx.def ? path.join(existingAppDir(ctx as Ctx & { def: ProfileDef }, app), "fields.json") : path.join("fields", `${app}.json`);
    console.log(listFields(await readFieldsFile(existingFile(rel, `fields --app ${app}${profileFlag(ctx)}`))));
    return 0;
  }
  const { client: c, authLabel, guestSpaceId } = client(ctx, args, app);
  const file = await fetchFields(c, { app, lang: option(args, "lang"), preview: flag(args, "preview"), guestSpaceId });
  if (ctx.def) {
    // フォルダーが無ければ作る（中身より先に印を置く。15.5）
    const dir = appDirFor(W.root, ctx.def.profile, app, file.appName);
    const out = resolveWrite(path.join(dir, "fields.json"), WRITE_ROOTS.kintone);
    allow(out, "fields");
    ensureAppFolder(dir, ctx.def, app);
    writeJson(out, file, WRITE_ROOTS.kintone, "fields");
    console.log(`${summarizeFields(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
    return 0;
  }
  const out = resolveWrite(option(args, "out") ?? path.join("fields", `${app}.json`), WRITE_ROOTS.fields);
  writeJson(out, file, WRITE_ROOTS.fields, "fields");
  console.log(`${summarizeFields(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
  return 0;
}

async function record(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args);
  const id = intOption(args, "id", true) as number;
  noOutInWorkspace(args, ctx);
  const defaultRel = (): string => (ctx.def ? path.join(existingAppDir(ctx as Ctx & { def: ProfileDef }, app), "records", `${id}.json`) : path.join("records", `${app}-${id}.json`));
  if (flag(args, "summary")) {
    const file = existingFile(defaultRel(), `record --app ${app} --id ${id}${profileFlag(ctx)}`);
    const data = readJsonLimited(file) as unknown as RecordFile;
    if (!data.record || typeof data.record !== "object") throw new InputError(`${shown(file)} は record コマンドの出力ではない（record が無い）`);
    console.log(describeRecord(data));
    return 0;
  }
  const out = resolveWrite(option(args, "out") ?? defaultRel(), WRITE_ROOTS.records);
  const from = option(args, "fields-from");
  let keep: Set<string> | undefined;
  if (from) {
    const fromFile = resolveRead(from);
    usable(fromFile);
    const settings = readJsonLimited(fromFile);
    const codes = usedFieldCodes(settings);
    if (!codes) console.log(`${from} に使う項目の情報が無いので絞らない（normalize した設定なら usedFields から絞れる）`);
    else keep = codes;
  }
  const { client: c, authLabel, guestSpaceId } = client(ctx, args, app);
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
  const folder = folderDefaults(settingsFile, args);
  const fieldsFile = fieldsFileOf(args, folder);
  const write = !flag(args, "dry-run");
  // ダウンロードと pull のファイルは書き換えない（Takashi 2026-10-05「直したものを別の名前」）。edit で -edit.json に写して直す
  if (write && folder && !option(args, "out") && SNAPSHOT_RE.test(path.basename(settingsFile))) {
    throw new UsageError(`ダウンロード / pull のファイルは書き換えない。npx @rex0220/print-craft-authoring-tools edit ${shown(settingsFile)} で -edit.json に写してから直す（検査だけなら --dry-run）`);
  }
  const out = write ? resolveWrite(option(args, "out") ?? settingsFile, WRITE_ROOTS.settings) : undefined;
  if (out) allow(out, "settings");
  const fieldsData = await readFieldsFile(fieldsFile);
  const baseUrl = trustedBaseUrl(folder, args);
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
  const [fa, fb] = [resolveRead(before), resolveRead(after)];
  usable(fa);
  usable(fb);
  const a = readJsonLimited(fa);
  const b = readJsonLimited(fb);
  console.log(diffSettings(a, b, { derived: flag(args, "derived") }));
  return 0;
}

async function pull(args: string[]): Promise<number> {
  const ctx = context(args);
  const app = appOf(args);
  noOutInWorkspace(args, ctx);
  // 接続のファイルがあるときはダウンロード / pull のファイル（新しい名前で置くだけ。上書きしない）なので --force は使えない（Codex 再々レビュー MINOR 4）
  if (ctx.def && flag(args, "force")) throw new UsageError("接続のファイルがあるときの pull は、ダウンロードと同じ日時の名前で新しく置く（ダウンロード / pull のファイルは上書きしない）ので --force は使えない");
  const preview = flag(args, "preview");
  const outArg = option(args, "out");
  if (args.includes("--out") && !outArg) throw new UsageError("--out には settings/ の下のファイル名を続ける");
  const engine = await engineFor();
  const pluginId = option(args, "plugin-id") ?? engine.source.pluginId;
  if (!pluginId) throw new InputError("プラグイン ID が分からない（印刷屋の zip に PUBKEY が無い）。--plugin-id <ID>（アプリの設定 → プラグインの一覧で確かめる）");
  const { client: c, authLabel, guestSpaceId } = client(ctx, args, app);
  let result;
  try {
    result = await pullSettings(c, engine, { app, preview, guestSpaceId, pluginId });
  } catch (e) {
    if (e instanceof RestError && /plugin\/config/.test(e.apiPath ?? "")) {
      throw new RestError(`${e.message}。確かめること: kintone の API ラボ「アプリに追加されているプラグインの設定情報を取得または更新するREST API」が有効か（cybozu.com 共通管理者がアップデートオプションの「検討中の新機能」で）、権限（運用中: レコード閲覧。API トークンでも可 / --preview: アプリ管理）、アプリに印刷屋プラグイン（ID ${pluginId}）が入っているか`, e.status, e.code, e.apiPath);
    }
    throw e;
  }
  // 接続のファイルがあるときは、アプリのフォルダーにダウンロードと同じ名前（rex0220-print-craft-app<番号>-<日時>.json）で置く（フォルダーが無ければ印を置いて作る）
  const dir = ctx.def ? appDirFor(W.root, ctx.def.profile, app, result.appName) : undefined;
  const out = dir
    ? resolveWrite(path.join(dir, snapshotNameOf(app)), WRITE_ROOTS.kintone)
    : resolveWrite(outArg ?? path.join("settings", defaultPullName(result.appName, app)), WRITE_ROOTS.settings);
  if (existsSync(out) && dir) throw new InputError(`${shown(out)} は既にある（同じ日時の名前）。少し待ってからやり直す（ダウンロード / pull のファイルは上書きしない）`);
  if (existsSync(out) && !flag(args, "force")) throw new InputError(`${shown(out)} は既にある。上書きするなら --force（上書きの前の内容は git の差分で確かめる）、別の名前なら --out settings/<ファイル>`);
  allow(out, dir ? "snapshot" : "settings");
  if (dir && ctx.def) ensureAppFolder(dir, ctx.def, app);
  writeJson(out, result.envelope, dir ? WRITE_ROOTS.kintone : WRITE_ROOTS.settings, dir ? "snapshot" : "settings", { exclusive: !!dir || !flag(args, "force") });
  console.log(`pull: アプリ ${app} ${result.appName}（${preview ? "動作テスト環境" : "運用中"}の設定、revision ${result.revision}、保存形式 ${result.format}）を${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
  console.log(listButtons(result.envelope, { file: shown(out) }));
  return 0;
}

async function buttons(args: string[]): Promise<number> {
  let [settingsArg] = positional(args);
  if (!settingsArg && args.includes("--app")) {
    // 接続のファイルがあるとき: --app のフォルダーの一番新しいダウンロード / pull（今の設定）
    const ctx = profileContext(args, "buttons --app");
    const app = appOf(args);
    const list = listAppFolder(existingAppDir(ctx, app), W.root);
    if (!list.snapshots.length) throw new InputError(`${shown(list.dir)} にダウンロード / pull のファイルが無い（設定画面でダウンロードして inbox/ に置き take、または pull --app ${app}${profileFlag(ctx)}）`);
    settingsArg = shown(path.join(list.dir, list.snapshots[0]));
  }
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const button = option(args, "button");
  if (args.includes("--button") && !button) throw new UsageError("--button にはボタン名を続ける");
  const file = resolveRead(settingsArg);
  usable(file);
  // ファイルは 1 回だけ読み、同じ中身から一覧と digest を作る（読み直すと、その間に変わったとき digest と一覧がずれる。Codex レビュー MAJOR 5）
  const bytes = readFileSync(file);
  if (bytes.length > MAX_INPUT_BYTES) throw new InputError(`${shown(file)} が大きすぎる（${bytes.length.toLocaleString()} バイト。上限 ${MAX_INPUT_BYTES.toLocaleString()}）`);
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch (e) {
    throw new InputError(`${shown(file)} を JSON として読めない${jsonErrorWhere(e)}（中身は表示しない）`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new InputError(`${shown(file)} の最上位はオブジェクト`);
  const text = listButtons(settings, { file: settingsArg, button });
  if (flag(args, "json")) {
    // 直すときの照合に使う digest（ファイルのバイト列の sha256）と、ボタンの名前（menu。設定の中で一意）
    const menus = (Array.isArray(settings.pluginInfos) ? settings.pluginInfos : []).map((r) => String((r as { menu?: unknown }).menu ?? ""));
    console.log(JSON.stringify({ file: shown(file), digest: digestOf(bytes), menus, text }, null, 2));
  } else {
    console.log(text);
  }
  return 0;
}

async function take(args: string[]): Promise<number> {
  const ctx = profileContext(args, "take（inbox/ のダウンロードをアプリのフォルダーへ移す）");
  const r = takeInbox(W.root, ctx.mode, ctx.explicit);
  for (const m of r.moved) console.log(`${m.file} → ${m.to}${m.leftInInbox ? "（置いたが inbox に残った）" : m.same ? "（同じものが既にあったので inbox から消した）" : ""}`);
  for (const s of r.skipped) console.error(`移さない: ${s.file}（${s.reason}）`);
  for (const w of r.warnings) console.error(`注意: ${w}`);
  if (!r.moved.length && !r.skipped.length) console.log(`${INBOX}/ に設定のファイルが無い`);
  return r.skipped.length ? 1 : 0;
}

async function edit(args: string[]): Promise<number> {
  const ctx = profileContext(args, "edit（今までの形では settings/ のファイルをそのまま直す）");
  let [src] = positional(args);
  if (!src) {
    const app = appOf(args);
    const list = listAppFolder(existingAppDir(ctx, app), W.root);
    if (!list.snapshots.length) throw new InputError(`${shown(list.dir)} にダウンロード / pull のファイルが無い`);
    src = path.join(list.dir, list.snapshots[0]);
  }
  const file = resolveRead(src);
  if (!SNAPSHOT_RE.test(path.basename(file)) || !appFolderOfFile(W.root, file)) throw new UsageError(`edit に渡すのはアプリのフォルダーのダウンロード / pull のファイル（rex0220-print-craft-app<番号>-<日時>.json）: ${src}`);
  usable(file);
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
  const ctx = profileContext(args, "files");
  const app = appOf(args);
  const l = listAppFolder(existingAppDir(ctx, app), W.root);
  const lines = [
    `${shown(l.dir)}（profile ${ctx.def.profile}、${ctx.def.baseUrl}${ctx.def.guestSpaceId ? `、ゲストスペース ${ctx.def.guestSpaceId}` : ""}）`,
    `fields.json: ${l.hasFields ? "あり" : `無い（npx @rex0220/print-craft-authoring-tools fields --app ${app}${profileFlag(ctx)}）`}`,
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
  const folder = folderDefaults(settingsFile, args);
  const fieldsFile = fieldsFileOf(args, folder);
  const recordArg = option(args, "record");
  if (!recordArg) throw new UsageError("--record <record.json> が要る（record コマンドの出力。アプリのフォルダーの中のファイルならレコード番号だけでよい: --record 3）");
  // アプリのフォルダーの中のファイルなら --record 3 は同じフォルダーの records/3.json
  const recordFile = folder && /^\d+$/.test(recordArg) ? existingFile(path.join(folder.dir, "records", `${recordArg}.json`), `record --app ${folder.appId} --id ${recordArg}`) : resolveRead(recordArg);
  usable(recordFile);
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
    baseUrl: trustedBaseUrl(folder, args)
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
    } else if (e instanceof AuthError || e instanceof RestError || e instanceof NotAllowedError || e instanceof PluginZipError || e instanceof PolicyError || e instanceof InputError || e instanceof KintoneUrlError || e instanceof ButtonNotFoundError || e instanceof WorkspaceError || e instanceof PermissionError || e instanceof ConnectionError) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
);
