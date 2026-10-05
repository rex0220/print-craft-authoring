/**
 * pcraft-authoring <command> …（docs/authoring-plan.md 12.2）。shebang は scripts/build.mjs の banner が付ける。印刷屋プラグインの設定 JSON を AI で作る・確かめるための CLI。
 * 計算式エンジンと印刷屋のコードは利用者の印刷屋 zip（.env の PCRAFT_PLUGIN_ZIP）から読む（engine.ts）。kintone には GET しか送らない（kintone-rest.ts）。
 * 1-10 レビュー BLOCKER 5: テンプレートでは AI がこの CLI を確認なしに呼べるので、
 *   - 読むのは作業フォルダー（cwd）の中のファイルだけ、書くのは fields/ records/ settings/ temp/ out/ の下だけ（safe-path.ts）
 *   - .env、policy/authoring-policy.json、印刷屋の zip の場所は固定。オプションで別の場所を指定できない（AI が書けるファイルを読ませない）
 * 終了コード: 0 成功、1 検査のエラー・認証・kintone・zip・入力の誤り、2 使い方の誤り（パスの制限を含む）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthError, allowUnknownPlugin, baseUrlFromEnv, describeAuth, loadAuth, pluginZipPath } from "./env.ts";
import { NotAllowedError, RestError, createRestClient } from "./kintone-rest.ts";
import { KintoneUrlError } from "./kintone-url.ts";
import { fetchFields, summarizeFields } from "./commands/fields.ts";
import { fetchRecord, summarizeRecord, usedFieldCodes } from "./commands/record.ts";
import { InputError, loadPolicy, normalizeSettings, readFieldsFile, readJsonLimited, readTextLimited, relativeSettingsPath } from "./commands/normalize.ts";
import { diffSettings } from "./commands/diff.ts";
import { runPreview } from "./commands/preview.ts";
import { DEFAULT_CONTEXT_BASE_URL, loadEngine, type Engine } from "./engine.ts";
import { PluginZipError } from "./plugin-zip.ts";
import { PolicyError } from "./normalize/policy.ts";
import { schemaRevisionOf, toolsMeta } from "./meta.ts";
import { PathError, WRITE_ROOTS, resolveRead, resolveWrite, resolveWriteDir } from "./safe-path.ts";

const USAGE = `使い方: pcraft-authoring <command> [options]

  version [--expect <印刷屋の版>] [--json]
      tools の版と、印刷屋の zip から読んだプラグインの版・authoring API の版・計算式エンジンの SHA-256・設定スキーマの版。
      zip が読めない、中身が既知と違う、対応しない版、または --expect の版と zip の版が違えば終了コード 1。
  fields --app N [--lang ja] [--preview] [--guest <spaceId>] [--out fields/<file>]
      項目定義とレイアウトとアプリ名を fields/<N>.json に保存（既定は運用中の形。--preview は設定画面と同じ preview の API）。
  record --app N --id R [--fields-from <settings.json>] [--guest <spaceId>] [--out records/<file>]
      レコードを records/<N>-<R>.json に保存。--fields-from で設定が使う項目だけ残す。
  normalize <settings.json> --fields <fields.json> [--out settings/<file>] [--dry-run] [--check] [--json]
      設定画面と同じ手順で派生値を作り直し、検査して、エラーが無ければ書き戻す（既定は同じファイルに上書き。--dry-run は書かない）。
      --check は入力の派生値と生成した値の差を出す。外部 URL の承認は policy/authoring-policy.json（場所は固定。利用者が書く）。
  diff <before.json> <after.json> [--derived]
      既存設定の変更をインポートする前に人が見る差分（ボタン単位。派生値は --derived で含める）。
  preview <settings.json> --fields <fields.json> --record <record.json> [--button <名前>] [--out-dir out/<dir>] [--json]
      有効なボタンごとに帳票の HTML を out/<ボタン名>.html に書く（sandbox の iframe + CSP。画像はダミー。Web フォントは配信元が承認済みのときだけ読む）。
      一覧帳票は対象外。式の失敗は赤字で埋めて終了コード 1。

読むファイルは作業フォルダーの中、書き込み先は fields/ records/ settings/ temp/ out/ の下だけ。
.env（作業フォルダーのもの）: KINTONE_BASE_URL（*.cybozu.com / *.kintone.com / *.cybozu.cn）と、KINTONE_API_TOKEN または KINTONE_USERNAME / KINTONE_PASSWORD
（kintone 公式 MCP と同じ）、PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス>（計算式エンジンと印刷屋のコードをここから読む）。
kintone には GET しか送らない。
`;

const FLAGS = new Set(["preview", "check", "json", "dry-run", "derived"]);

class UsageError extends Error {}

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

/** 使えないオプション（1-10 レビュー BLOCKER 5 で外した）を渡されたら理由を出して止める */
function rejectRemovedOptions(args: string[]): void {
  for (const name of ["env", "policy", "plugin-zip"]) {
    if (args.includes(`--${name}`)) throw new UsageError(`--${name} は使えない。.env と policy/authoring-policy.json と PCRAFT_PLUGIN_ZIP は作業フォルダーのものに固定（AI が書けるファイルを読ませないため）`);
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

function shown(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith("..") ? rel : file;
}

async function engineFor(): Promise<Engine> {
  const engine = await loadEngine({ pluginZip: pluginZipPath(), allowUnknown: allowUnknownPlugin() });
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
    if (!meta.supportedPluginVersions.includes(expect)) expectError = `--expect ${expect}: tools ${meta.toolsVersion} が対応する印刷屋の版は ${meta.supportedPluginVersions.join(", ")}（tools を更新する）`;
    else if (engine.source.pluginVersion !== expect) expectError = `--expect ${expect}: zip の印刷屋の版は ${engine.source.pluginVersion}（${engine.source.from}。アプリに入れた版の zip を PCRAFT_PLUGIN_ZIP に書く）`;
  }
  const info = {
    ...meta,
    plugin: engine ? { source: engine.source.kind, from: engine.source.from, pluginVersion: engine.source.pluginVersion, apiVersion: engine.api.apiVersion, engineSha256: engine.source.engineSha256, apiSha256: engine.source.apiSha256, engineKnown: engine.source.engineKnown, schemaRevision: schemaRevisionOf(engine.api.CONFIG_SCHEMA) } : null,
    expected: expect,
    ok: !!engine && !expectError,
    error: error ?? expectError
  };
  if (flag(args, "json")) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log(`@rex0220/print-craft-authoring-tools ${meta.toolsVersion}${meta.mode === "dev" ? "（開発中）" : ""}（対応する印刷屋の版 ${meta.supportedPluginVersions.join(", ")}、API ${meta.supportedApiVersion}。commit ${meta.commit}${meta.builtAt ? `、ビルド ${meta.builtAt}` : ""}）`);
    if (engine) {
      console.log(`印刷屋プラグイン: 版 ${engine.source.pluginVersion}、authoring API ${engine.api.apiVersion}（${engine.source.kind === "zip" ? "zip" : "開発中の print-craft"}: ${engine.source.from}）`);
      console.log(`計算式エンジン: sha256 ${engine.source.engineSha256}${engine.source.engineKnown ? "（zip の中身は既知）" : "（既知の一覧と違う中身を含む）"}`);
      console.log(`設定スキーマの版: ${schemaRevisionOf(engine.api.CONFIG_SCHEMA)}`);
      if (expectError) console.error(expectError);
      else if (expect !== undefined) console.log(`--expect ${expect}: 一致`);
    } else {
      console.error(`印刷屋の zip: ${error}`);
    }
  }
  return info.ok ? 0 : 1;
}

function client() {
  const auth = loadAuth();
  return { client: createRestClient(auth), authLabel: describeAuth(auth) };
}

async function fields(args: string[]): Promise<number> {
  const app = intOption(args, "app", true) as number;
  const guestSpaceId = intOption(args, "guest", false);
  const out = resolveWrite(option(args, "out") ?? path.join("fields", `${app}.json`), WRITE_ROOTS.fields);
  const { client: c, authLabel } = client();
  const file = await fetchFields(c, { app, lang: option(args, "lang"), preview: flag(args, "preview"), guestSpaceId });
  writeJson(out, file);
  console.log(`${summarizeFields(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}`);
  return 0;
}

async function record(args: string[]): Promise<number> {
  const app = intOption(args, "app", true) as number;
  const id = intOption(args, "id", true) as number;
  const guestSpaceId = intOption(args, "guest", false);
  const out = resolveWrite(option(args, "out") ?? path.join("records", `${app}-${id}.json`), WRITE_ROOTS.records);
  const from = option(args, "fields-from");
  let keep: Set<string> | undefined;
  if (from) {
    const settings = readJsonLimited(resolveRead(from));
    const codes = usedFieldCodes(settings);
    if (!codes) console.log(`${from} に使う項目の情報が無いので絞らない（normalize した設定なら usedFields から絞れる）`);
    else keep = codes;
  }
  const { client: c, authLabel } = client();
  const file = await fetchRecord(c, { app, id, guestSpaceId, keep });
  writeJson(out, file);
  console.log(`${summarizeRecord(file)}\n${authLabel}で ${c.baseUrl} から取得 → ${shown(out)}（個人情報を含む。コミットしない）`);
  return 0;
}

async function normalize(args: string[]): Promise<number> {
  const [settingsArg] = positional(args);
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const fieldsArg = option(args, "fields");
  if (!fieldsArg) throw new UsageError("--fields <fields.json> が要る（fields コマンドの出力）");
  const settingsFile = resolveRead(settingsArg);
  const fieldsFile = resolveRead(fieldsArg);
  const write = !flag(args, "dry-run");
  const out = write ? resolveWrite(option(args, "out") ?? settingsFile, WRITE_ROOTS.settings) : undefined;
  const fieldsData = await readFieldsFile(fieldsFile);
  const baseUrl = baseUrlFromEnv();
  const engine = await engineFor();
  engine.setContext({ baseUrl: baseUrl ?? DEFAULT_CONTEXT_BASE_URL, appId: fieldsData.appId });
  const result = await normalizeSettings({
    settingsText: readTextLimited(settingsFile),
    settingsFile: relativeSettingsPath(settingsArg),
    fields: fieldsData,
    engine,
    policy: loadPolicy(),
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
    writeJson(out, result.output);
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

async function preview(args: string[]): Promise<number> {
  const [settingsArg] = positional(args);
  if (!settingsArg) throw new UsageError("設定 JSON のパスが要る");
  const fieldsArg = option(args, "fields");
  const recordArg = option(args, "record");
  if (!fieldsArg || !recordArg) throw new UsageError("--fields <fields.json> と --record <record.json> が要る（fields / record コマンドの出力）");
  const settingsFile = resolveRead(settingsArg);
  const fieldsFile = resolveRead(fieldsArg);
  const recordFile = resolveRead(recordArg);
  const outDir = resolveWriteDir(option(args, "out-dir") ?? "out", WRITE_ROOTS.out);
  const fieldsData = await readFieldsFile(fieldsFile);
  const engine = await engineFor();
  const result = await runPreview({
    settingsText: readTextLimited(settingsFile),
    settingsFile: relativeSettingsPath(settingsArg),
    fields: fieldsData,
    recordFile: readJsonLimited(recordFile),
    engine,
    policy: loadPolicy(),
    button: option(args, "button"),
    baseUrl: baseUrlFromEnv()
  });
  const written: string[] = [];
  if (!result.findings.hasErrors) {
    for (const r of result.results) {
      const file = resolveWrite(path.join(outDir, r.file), WRITE_ROOTS.out);
      writeText(file, r.html);
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
    } else if (e instanceof AuthError || e instanceof RestError || e instanceof NotAllowedError || e instanceof PluginZipError || e instanceof PolicyError || e instanceof InputError || e instanceof KintoneUrlError) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
);
