/**
 * pcraft-authoring <command>（docs/authoring-plan.md 12.2）。
 *   version [--expect <PluginVersion>] [--json]
 *   fields --app N [--lang ja] [--preview] [--guest S] [--env <.env>] [--out <file>]
 *   record --app N --id R [--fields-from <settings.json>] [--guest S] [--env <.env>] [--out <file>]
 *   normalize <settings.json> --fields <fields.json> [--out <file>] [--dry-run] [--check] [--policy <file>] [--json]
 *   diff <before.json> <after.json> [--derived]
 *   preview … 段階 1 の 1-4 で足す
 * 終了コード: 0 = 正常、1 = 検査や照合で不一致・kintone や認証のエラー、2 = 使い方の誤り・未実装
 * 画面に出すのは件数と名前だけで、レコードの値と認証情報は出さない。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthError, describeAuth, loadAuth } from "./env.ts";
import { NotAllowedError, RestError, createRestClient } from "./kintone-rest.ts";
import { fetchFields, summarizeFields } from "./commands/fields.ts";
import { fetchRecord, summarizeRecord, usedFieldCodes } from "./commands/record.ts";
import { loadPolicy, normalizeSettings, readFieldsFile, relativeSettingsPath } from "./commands/normalize.ts";
import { diffSettings } from "./commands/diff.ts";
import { loadEngine } from "./engine.ts";
import { toolsMeta } from "./meta.ts";

const USAGE = `使い方: pcraft-authoring <command> [options]

  version [--expect <PluginVersion>] [--json]
      tools の版、対応する印刷屋プラグインの版、設定スキーマの版、元の commit、同梱する計算式エンジンの SHA-256。
      --expect を付けると対応する版が違うときに終了コード 1。
  fields --app N [--lang ja] [--preview] [--guest <spaceId>] [--env <.env>] [--out <file>]
      項目定義とレイアウトとアプリ名を fields/<N>.json に保存（既定は運用中の形。--preview は設定画面と同じ preview の API）。
  record --app N --id R [--fields-from <settings.json>] [--guest <spaceId>] [--env <.env>] [--out <file>]
      レコードを records/<N>-<R>.json に保存。--fields-from で設定が使う項目だけ残す。
  normalize <settings.json> --fields <fields.json> [--out <file>] [--dry-run] [--check] [--policy <file>] [--json]
      設定画面と同じ手順で派生値を作り直し、検査して、エラーが無ければ書き戻す（既定は同じファイルに上書き。--dry-run は書かない）。
      --check は入力の派生値と生成した値の差を出す。外部 URL の承認は policy/authoring-policy.json（--policy で場所を指定）。
  diff <before.json> <after.json> [--derived]
      既存設定の変更をインポートする前に人が見る差分（ボタン単位。派生値は --derived で含める）。
  preview <settings.json> --fields <json> --record <json> [...]  （未実装: 段階 1 の 1-4）

認証は OS の環境変数か .env（KSQL_BASE_URL と、KSQL_TOKEN または KSQL_USERNAME / KSQL_PASSWORD）。kintone には GET しか送らない。
`;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** 先頭の「--」で始まらない引数（位置引数） */
function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!["preview", "check", "json", "dry-run", "derived"].includes(args[i].slice(2))) i++;
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

async function version(args: string[]): Promise<number> {
  const meta = await toolsMeta();
  if (flag(args, "json")) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(`@rex0220/print-craft-authoring-tools ${meta.toolsVersion}${meta.mode === "dev" ? "（開発中: print-craft の src と prod を直接読んでいる）" : ""}`);
    console.log(`対応する印刷屋プラグインの版: ${meta.pluginVersion}`);
    console.log(`設定スキーマの版: ${meta.schemaRevision}`);
    console.log(`print-craft の commit: ${meta.printCraftCommit}`);
    console.log(`計算式エンジン: ${meta.engineFile} sha256 ${meta.engineSha256}`);
    if (meta.builtAt) console.log(`ビルド: ${meta.builtAt}`);
  }
  const expect = option(args, "expect");
  if (expect !== undefined && expect !== meta.pluginVersion) {
    console.error(`対応する印刷屋プラグインの版が違う: tools は ${meta.pluginVersion}、期待は ${expect}`);
    return 1;
  }
  return 0;
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
  const meta = await toolsMeta();
  const engine = await loadEngine();
  const fieldsData = await readFieldsFile(fieldsFile);
  engine.setContext({ baseUrl: fieldsData.baseUrl, appId: fieldsData.appId });
  const result = await normalizeSettings({
    settingsText: readFileSync(settingsFile, "utf8"),
    settingsFile: relativeSettingsPath(settingsFile),
    fields: fieldsData,
    engine,
    pluginVersion: meta.pluginVersion,
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
      console.error(`${command}: 未実装（段階 1 の 1-4 で足す。docs/authoring-plan.md 12.5）`);
      return 2;
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
    } else if (e instanceof AuthError || e instanceof RestError || e instanceof NotAllowedError) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    }
  }
);
