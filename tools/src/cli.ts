/**
 * pcraft-authoring <command>（docs/authoring-plan.md 12.2）。
 *   version [--plugin-zip <zip>] [--json]
 *   fields --app N [--lang ja] [--preview] [--guest S] [--env <.env>] [--out <file>]
 *   record --app N --id R [--fields-from <settings.json>] [--guest S] [--env <.env>] [--out <file>]
 *   normalize <settings.json> --fields <fields.json> [--out <file>] [--dry-run] [--check] [--policy <file>] [--plugin-zip <zip>] [--json]
 *   diff <before.json> <after.json> [--derived]
 *   preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir <dir>] [--policy <file>] [--plugin-zip <zip>] [--json]
 * 計算式エンジンと印刷屋のコードは利用者の印刷屋 zip（.env の PCRAFT_PLUGIN_ZIP か --plugin-zip）から読む。tools は配らない。
 * 終了コード: 0 = 正常、1 = 検査や照合で不一致・kintone や認証や zip のエラー、2 = 使い方の誤り
 * 画面に出すのは件数と名前だけで、レコードの値と認証情報は出さない。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthError, describeAuth, loadAuth, pluginZipPath } from "./env.ts";
import { NotAllowedError, RestError, createRestClient } from "./kintone-rest.ts";
import { fetchFields, summarizeFields } from "./commands/fields.ts";
import { fetchRecord, summarizeRecord, usedFieldCodes } from "./commands/record.ts";
import { loadPolicy, normalizeSettings, readFieldsFile, relativeSettingsPath } from "./commands/normalize.ts";
import { diffSettings } from "./commands/diff.ts";
import { runPreview } from "./commands/preview.ts";
import { loadEngine, type Engine } from "./engine.ts";
import { PluginZipError } from "./plugin-zip.ts";
import { schemaRevisionOf, toolsMeta } from "./meta.ts";

const USAGE = `使い方: pcraft-authoring <command> [options]

  version [--plugin-zip <zip>] [--json]
      tools の版と、印刷屋の zip から読んだプラグインの版・authoring API の版・計算式エンジンの SHA-256・設定スキーマの版。
      zip が読めない、または対応しない版なら終了コード 1。
  fields --app N [--lang ja] [--preview] [--guest <spaceId>] [--env <.env>] [--out <file>]
      項目定義とレイアウトとアプリ名を fields/<N>.json に保存（既定は運用中の形。--preview は設定画面と同じ preview の API）。
  record --app N --id R [--fields-from <settings.json>] [--guest <spaceId>] [--env <.env>] [--out <file>]
      レコードを records/<N>-<R>.json に保存。--fields-from で設定が使う項目だけ残す。
  normalize <settings.json> --fields <fields.json> [--out <file>] [--dry-run] [--check] [--policy <file>] [--json]
      設定画面と同じ手順で派生値を作り直し、検査して、エラーが無ければ書き戻す（既定は同じファイルに上書き。--dry-run は書かない）。
      --check は入力の派生値と生成した値の差を出す。外部 URL の承認は policy/authoring-policy.json（--policy で場所を指定）。
  diff <before.json> <after.json> [--derived]
      既存設定の変更をインポートする前に人が見る差分（ボタン単位。派生値は --derived で含める）。
  preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir <dir>] [--policy <file>] [--json]
      有効なボタンごとに帳票の HTML を out/<ボタン名>.html に書く（sandbox の iframe + CSP。画像はダミー、Web フォントは読まない）。
      一覧帳票は対象外。式の失敗は赤字で埋めて終了コード 1。

.env（または OS の環境変数）: KINTONE_BASE_URL と、KINTONE_API_TOKEN または KINTONE_USERNAME / KINTONE_PASSWORD（kintone 公式 MCP と同じ）、
PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス>（計算式エンジンと印刷屋のコードをここから読む。--plugin-zip でも指定可）。
kintone には GET しか送らない。
`;

const FLAGS = new Set(["preview", "check", "json", "dry-run", "derived"]);

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
    if (required) throw new UsageError(`--${name} が要る`);
    return undefined;
  }
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} は整数: ${v}`);
  return Number(v);
}

class UsageError extends Error {}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text, "utf8");
}

/** エンジンを読む（--plugin-zip → .env / 環境変数 PCRAFT_PLUGIN_ZIP → 開発中の print-craft）。読み込み時の注意は stderr に */
async function engineFor(args: string[]): Promise<Engine> {
  const zip = option(args, "plugin-zip") ?? pluginZipPath({ envFile: option(args, "env") });
  const engine = await loadEngine({ pluginZip: zip });
  for (const w of engine.warnings) console.error(`注意: ${w}`);
  return engine;
}

async function version(args: string[]): Promise<number> {
  const meta = toolsMeta();
  let engine: Engine | null = null;
  let error: string | undefined;
  try {
    engine = await engineFor(args);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const info = {
    ...meta,
    plugin: engine ? { source: engine.source.kind, from: engine.source.from, pluginVersion: engine.source.pluginVersion, apiVersion: engine.api.apiVersion, engineSha256: engine.source.engineSha256, engineKnown: engine.source.engineKnown, schemaRevision: schemaRevisionOf(engine.api.CONFIG_SCHEMA) } : null,
    error
  };
  if (flag(args, "json")) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log(`@rex0220/print-craft-authoring-tools ${meta.toolsVersion}${meta.mode === "dev" ? "（開発中）" : ""}（対応する印刷屋の版 ${meta.supportedPluginVersions.join(", ")}、API ${meta.supportedApiVersion}。commit ${meta.commit}${meta.builtAt ? `、ビルド ${meta.builtAt}` : ""}）`);
    if (engine) {
      console.log(`印刷屋プラグイン: 版 ${engine.source.pluginVersion}、authoring API ${engine.api.apiVersion}（${engine.source.kind === "zip" ? "zip" : "開発中の print-craft"}: ${engine.source.from}）`);
      console.log(`計算式エンジン: sha256 ${engine.source.engineSha256}${engine.source.engineKnown ? "（既知）" : "（未知）"}`);
      console.log(`設定スキーマの版: ${schemaRevisionOf(engine.api.CONFIG_SCHEMA)}`);
    } else {
      console.error(`印刷屋の zip: ${error}`);
    }
  }
  return engine ? 0 : 1;
}

function client(args: string[]) {
  const auth = loadAuth({ envFile: option(args, "env") });
  return { client: createRestClient(auth), authLabel: describeAuth(auth) };
}

async function fields(args: string[]): Promise<number> {
  const app = intOption(args, "app", true) as number;
  const guestSpaceId = intOption(args, "guest", false);
  const { client: c, authLabel } = client(args);
  const file = await fetchFields(c, { app, lang: option(args, "lang"), preview: flag(args, "preview"), guestSpaceId });
  const out = option(args, "out") ?? path.join("fields", `${app}.json`);
  writeJson(out, file);
  console.log(`${summarizeFields(file)}\n${authLabel} で ${c.baseUrl} から取得 → ${out}`);
  return 0;
}

async function record(args: string[]): Promise<number> {
  const app = intOption(args, "app", true) as number;
  const id = intOption(args, "id", true) as number;
  const guestSpaceId = intOption(args, "guest", false);
  const from = option(args, "fields-from");
  let keep: Set<string> | undefined;
  if (from) {
    const settings = JSON.parse(readFileSync(from, "utf8")) as unknown;
    const codes = usedFieldCodes(settings);
    if (!codes) console.log(`${from} に使う項目の情報が無いので絞らない（normalize した設定なら usedFields から絞れる）`);
    else keep = codes;
  }
  const { client: c, authLabel } = client(args);
  const file = await fetchRecord(c, { app, id, guestSpaceId, keep });
  const out = option(args, "out") ?? path.join("records", `${app}-${id}.json`);
  writeJson(out, file);
  console.log(`${summarizeRecord(file)}\n${authLabel} で ${c.baseUrl} から取得 → ${out}（個人情報を含む。コミットしない）`);
  return 0;
}

async function normalize(args: string[]): Promise<number> {
  const [settingsFile] = positional(args);
  if (!settingsFile) throw new UsageError("設定 JSON のパスが要る");
  const fieldsFile = option(args, "fields");
  if (!fieldsFile) throw new UsageError("--fields <fields.json> が要る（fields コマンドの出力）");
  const engine = await engineFor(args);
  const fieldsData = await readFieldsFile(fieldsFile);
  engine.setContext({ baseUrl: fieldsData.baseUrl, appId: fieldsData.appId });
  const result = await normalizeSettings({
    settingsText: readFileSync(settingsFile, "utf8"),
    settingsFile: relativeSettingsPath(settingsFile),
    fields: fieldsData,
    engine,
    policy: loadPolicy({ policyFile: option(args, "policy") }),
    check: flag(args, "check")
  });
  if (flag(args, "json")) {
    console.log(JSON.stringify({ summary: result.summary, findings: result.findings.items, size: result.size, checkDiffs: result.checkDiffs, written: !!result.output && !flag(args, "dry-run") }, null, 2));
  } else {
    console.log(`normalize: ${settingsFile}（${result.summary}）`);
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
  if (!flag(args, "dry-run")) {
    const out = option(args, "out") ?? settingsFile;
    writeJson(out, result.output);
    if (!flag(args, "json")) console.log(`出力: ${out}（封筒の date を更新。派生値を生成）`);
  }
  return 0;
}

async function diff(args: string[]): Promise<number> {
  const [before, after] = positional(args);
  if (!before || !after) throw new UsageError("diff <before.json> <after.json>");
  const a = JSON.parse(readFileSync(before, "utf8")) as Record<string, unknown>;
  const b = JSON.parse(readFileSync(after, "utf8")) as Record<string, unknown>;
  console.log(diffSettings(a, b, { derived: flag(args, "derived") }));
  return 0;
}

async function preview(args: string[]): Promise<number> {
  const [settingsFile] = positional(args);
  if (!settingsFile) throw new UsageError("設定 JSON のパスが要る");
  const fieldsFile = option(args, "fields");
  const recordFile = option(args, "record");
  if (!fieldsFile || !recordFile) throw new UsageError("--fields <fields.json> と --record <record.json> が要る（fields / record コマンドの出力）");
  const engine = await engineFor(args);
  const fieldsData = await readFieldsFile(fieldsFile);
  const result = await runPreview({
    settingsText: readFileSync(settingsFile, "utf8"),
    settingsFile: relativeSettingsPath(settingsFile),
    fields: fieldsData,
    recordFile: JSON.parse(readFileSync(recordFile, "utf8")) as unknown,
    engine,
    policy: loadPolicy({ policyFile: option(args, "policy") }),
    button: option(args, "button")
  });
  const outDir = option(args, "out-dir") ?? "out";
  const written: string[] = [];
  if (!result.findings.hasErrors) {
    for (const r of result.results) {
      const file = path.join(outDir, r.file);
      writeText(file, r.html);
      written.push(file);
    }
  }
  if (flag(args, "json")) {
    console.log(JSON.stringify({ summary: result.summary, findings: result.findings.items, results: result.results.map((r) => ({ menu: r.menu, file: path.join(outDir, r.file), fileName: r.fileName, pages: r.pages, errors: r.errors })), skipped: result.skipped, written }, null, 2));
  } else {
    console.log(`preview: ${settingsFile}（${result.summary}）`);
    console.log(result.findings.format());
    for (const r of result.results) {
      console.log(`${r.menu}: ${r.pages} ページ、ファイル名 ${r.fileName}${r.errors.length ? `、式のエラー ${r.errors.length}` : ""} → ${path.join(outDir, r.file)}`);
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
    if (e instanceof UsageError) {
      console.error(`${e.message}\n${USAGE}`);
      process.exitCode = 2;
    } else if (e instanceof AuthError || e instanceof RestError || e instanceof NotAllowedError || e instanceof PluginZipError) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
);
