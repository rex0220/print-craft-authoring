/**
 * 環境とアプリのフォルダー（2026-10-05 Takashi「tools のフォルダー構成の整理。ドメイン・アプリ番号で分けたらどうか」）。
 *   構成 1: 開発は開発環境のドメイン、運用は本番のドメイン → environments の baseUrl を分ける
 *   構成 2: 同じドメインで、開発は開発用のアプリ、運用は本番のアプリ → baseUrl は同じで apps の番号を分ける
 * 作業フォルダーのルートに environments.json（利用者が書く。AI は書かない）があるときだけ使う。無ければ今までの形（settings/ fields/ records/ out/）。
 * フォルダー: kintone/<ホスト名>/<アプリ番号>-<アプリ名>/（番号の後ろは目印。tools は番号で探すので、アプリ名が変わっても動く）
 *   fields.json、records/<レコード番号>.json、out/
 *   本番へは、開発のアプリで確かめたファイルをそのまま本番の設定画面でアップロードする（Takashi「段階 B は不要。開発の設定ファイルを本番アプリに import でいい」。
 *   appId の違いは印刷屋のアップロードの注意だけ、項目の違いは保存の検査で止まる。一覧 ID は開発で空か "-" にして、特定の一覧は本番の設定画面で選ぶ）
 *   rex0220-print-craft-app<番号>-<YYYYMMDD>-<HHmmss>.json … 設定画面のダウンロード（名前はそのまま。Takashi「直すのが面倒」）と pull。一番新しいものが今の設定
 *   …-edit.json … ダウンロード / pull を AI が直したもの（edit で写す。ダウンロードのファイルは書き換えない。Takashi「直したものを別の名前」）
 *   その他の *.json … AI が新しく作る帳票（1 ファイル 1 帳票）
 * inbox/ … ダウンロードを置く場所（take がアプリのフォルダーへ名前のまま移す）
 * 認証は --env の環境の envFile（既定 .env。env/<名前>.env の形だけ）から読み、接続先は environments.json の baseUrl（env.ts の loadAuthForEnv）
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { KintoneUrlError, normalizeKintoneBaseUrl } from "./kintone-url.ts";
import { PathError, isInside, realResolve, safeFileName } from "./safe-path.ts";

export const WORKSPACE_FILE = "environments.json";
export const KINTONE_ROOT = "kintone";
export const INBOX = "inbox";
/** 設定画面のダウンロードのファイル名の接頭辞（kit の exportFileName。print-craft の exportPrefix） */
export const SNAPSHOT_PREFIX = "rex0220-print-craft";
export const SNAPSHOT_RE = /^rex0220-print-craft-app(\d+)-(\d{8})-(\d{6})\.json$/;
export const EDIT_RE = /^rex0220-print-craft-app(\d+)-(\d{8})-(\d{6})-edit\.json$/;

const ENV_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_FILE = /^(\.env|env\/[A-Za-z0-9._-]{1,64}\.env)$/;
const MAX_BYTES = 256 * 1024;

export class WorkspaceError extends Error {}

/**
 * 環境の役割（段階 0-2 の段 3。print-craft-authoring-mcp の実装案 13.3、permission-table.md）。environments.json に書けるのは
 * development / production だけ。書いていない環境は内部だけの状態 unclassified（読み取りと診断だけ。kintone/ の下を変えられない）
 */
export type EnvRole = "development" | "production" | "unclassified";
export const ENV_ROLES = ["development", "production"] as const;

export interface EnvironmentDef {
  name: string;
  /** 役割（書いていなければ unclassified） */
  role: EnvRole;
  /** 正規化した接続先（https://<サブドメイン>.cybozu.com） */
  baseUrl: string;
  /** フォルダー名に使うホスト名 */
  host: string;
  /** 認証のファイル（作業フォルダーからの相対。.env か env/<名前>.env） */
  envFile: string;
}

export interface AppDef {
  /** 論理アプリ名（--app に書ける名前） */
  name: string;
  /** 環境の名前 → アプリ番号 */
  ids: Record<string, number>;
}

export interface Workspace {
  defaultEnv: string;
  environments: Record<string, EnvironmentDef>;
  apps: AppDef[];
}

export const isEnvName = (s: string): boolean => ENV_NAME.test(s);

/** environments.json を検証して読む（未知のキー、名前の形、接続先、envFile の場所、番号を厳しく見る） */
export function parseWorkspace(text: string, where = WORKSPACE_FILE): Workspace {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new WorkspaceError(`${where} を JSON として読めない: ${(e as Error).message}`);
  }
  const obj = (v: unknown, at: string): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new WorkspaceError(`${where}: ${at} はオブジェクト`);
    return v as Record<string, unknown>;
  };
  const root = obj(raw, "最上位");
  for (const k of Object.keys(root)) if (!["default", "environments", "apps"].includes(k)) throw new WorkspaceError(`${where}: 使えるキーは default / environments / apps: ${k}`);
  const envsRaw = obj(root.environments, "environments");
  const environments: Record<string, EnvironmentDef> = {};
  for (const [name, v] of Object.entries(envsRaw)) {
    if (!isEnvName(name)) throw new WorkspaceError(`${where}: 環境の名前は英数字と _ - の 32 文字まで: ${name}`);
    const e = obj(v, `environments.${name}`);
    for (const k of Object.keys(e)) if (!["baseUrl", "envFile", "role"].includes(k)) throw new WorkspaceError(`${where}: environments.${name} に使えるキーは baseUrl / envFile / role: ${k}`);
    if (e.role !== undefined && !(ENV_ROLES as readonly unknown[]).includes(e.role)) throw new WorkspaceError(`${where}: environments.${name}.role は development（開発）か production（本番）: ${String(e.role)}`);
    const role: EnvRole = e.role === undefined ? "unclassified" : (e.role as EnvRole);
    let baseUrl: string;
    try {
      baseUrl = normalizeKintoneBaseUrl(String(e.baseUrl ?? ""));
    } catch (err) {
      throw new WorkspaceError(`${where}: environments.${name}.baseUrl が不正: ${err instanceof KintoneUrlError ? err.message : String(err)}`);
    }
    const envFile = e.envFile === undefined ? ".env" : String(e.envFile).replace(/\\/g, "/");
    if (!ENV_FILE.test(envFile)) throw new WorkspaceError(`${where}: environments.${name}.envFile は .env か env/<名前>.env: ${envFile}`);
    environments[name] = { name, role, baseUrl, host: new URL(baseUrl).hostname, envFile };
  }
  if (Object.keys(environments).length === 0) throw new WorkspaceError(`${where}: environments に環境が 1 つも無い`);
  const defaultEnv = root.default === undefined ? Object.keys(environments)[0] : String(root.default);
  if (!environments[defaultEnv]) throw new WorkspaceError(`${where}: default の環境が environments に無い: ${defaultEnv}`);
  const apps: AppDef[] = [];
  if (root.apps !== undefined) {
    if (!Array.isArray(root.apps)) throw new WorkspaceError(`${where}: apps は配列`);
    const names = new Set<string>();
    for (const [i, v] of root.apps.entries()) {
      const a = obj(v, `apps[${i}]`);
      const name = typeof a.name === "string" ? a.name.trim() : "";
      if (!name || name.length > 100 || /^\d+$/.test(name)) throw new WorkspaceError(`${where}: apps[${i}].name は 100 文字までの名前（数字だけは不可）`);
      if (names.has(name)) throw new WorkspaceError(`${where}: apps の名前が重複: ${name}`);
      names.add(name);
      const ids: Record<string, number> = {};
      for (const [k, n] of Object.entries(a)) {
        if (k === "name") continue;
        if (!environments[k]) throw new WorkspaceError(`${where}: apps[${i}] の ${k} は environments に無い環境`);
        if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new WorkspaceError(`${where}: apps[${i}].${k} はアプリ番号（正の整数）`);
        ids[k] = n;
      }
      apps.push({ name, ids });
    }
  }
  return { defaultEnv, environments, apps };
}

/** 作業フォルダーの environments.json（無ければ null = 今までの形） */
export function loadWorkspace(cwd: string): Workspace | null {
  const file = path.join(cwd, WORKSPACE_FILE);
  if (!existsSync(file)) return null;
  const size = statSync(file).size;
  if (size > MAX_BYTES) throw new WorkspaceError(`${WORKSPACE_FILE} が大きすぎる（${size} バイト）`);
  return parseWorkspace(readFileSync(file, "utf8"));
}

export function pickEnv(ws: Workspace, name?: string): EnvironmentDef {
  const n = name ?? ws.defaultEnv;
  const e = ws.environments[n];
  if (!e) throw new WorkspaceError(`環境「${n}」は ${WORKSPACE_FILE} に無い（${Object.keys(ws.environments).join(", ")}）`);
  return e;
}

/** --app の値（番号か、apps の名前）をその環境のアプリ番号にする */
export function resolveApp(ws: Workspace, env: EnvironmentDef, app: string): { appId: number; name?: string } {
  if (/^\d+$/.test(app)) {
    const appId = Number(app);
    const def = ws.apps.find((a) => a.ids[env.name] === appId);
    return { appId, ...(def ? { name: def.name } : {}) };
  }
  const def = ws.apps.find((a) => a.name === app);
  if (!def) throw new WorkspaceError(`アプリ「${app}」は ${WORKSPACE_FILE} の apps に無い（番号で書くか、apps に足す）`);
  const appId = def.ids[env.name];
  if (!appId) throw new WorkspaceError(`アプリ「${app}」の環境「${env.name}」の番号が ${WORKSPACE_FILE} に無い`);
  return { appId, name: def.name };
}

/** アプリのフォルダーの名前（番号-アプリ名。名前が使えなければ番号だけ） */
export function folderNameOf(appId: number, appName: string): string {
  const name = safeFileName(appName, "");
  return name ? `${appId}-${name}` : String(appId);
}

export function hostDirOf(cwd: string, env: EnvironmentDef): string {
  return path.join(cwd, KINTONE_ROOT, env.host);
}

/**
 * フォルダーの実体（symlink を解いたもの）が作業フォルダーの中か。外なら一覧を作らずに PathError
 * （kintone/<ホスト> や inbox が外への symlink のとき、外のファイルの名前を出さない。B1 の Codex レビュー BLOCKER 1）
 */
export function assertDirInside(cwd: string, dir: string): void {
  const root = realResolve(".", cwd);
  if (!isInside(realResolve(dir, cwd), root)) throw new PathError(`フォルダーの実体が作業フォルダーの外を指している（symlink など）: ${path.relative(cwd, dir)}`);
}

/** 今あるアプリのフォルダー（番号で探す。無ければ null。同じ番号が 2 つあれば止まる）。kintone/ とホストのフォルダーの実体が作業フォルダーの中のときだけ一覧する */
export function findAppDir(cwd: string, env: EnvironmentDef, appId: number): string | null {
  const hostDir = hostDirOf(cwd, env);
  if (!existsSync(hostDir)) return null;
  assertDirInside(cwd, path.join(cwd, KINTONE_ROOT));
  assertDirInside(cwd, hostDir);
  const hits = readdirSync(hostDir, { withFileTypes: true }).filter((d) => d.isDirectory() && (d.name === String(appId) || d.name.startsWith(`${appId}-`))).map((d) => d.name);
  if (hits.length > 1) throw new WorkspaceError(`アプリ ${appId} のフォルダーが 2 つある: ${hits.join(", ")}（kintone/${env.host}/ の下を 1 つにする）`);
  return hits.length ? path.join(hostDir, hits[0]) : null;
}

/** アプリのフォルダー（あればそれ、無ければ 番号-アプリ名 で作る場所。作るのは書くとき） */
export function appDirFor(cwd: string, env: EnvironmentDef, appId: number, appName: string): string {
  return findAppDir(cwd, env, appId) ?? path.join(hostDirOf(cwd, env), folderNameOf(appId, appName));
}

/** ファイルが kintone/<ホスト>/<番号>-…/ の中（records/ などの下を含む）なら、そのフォルダーとホストと番号 */
export function appFolderOfFile(cwd: string, file: string): { dir: string; host: string; appId: number } | null {
  const rel = path.relative(path.join(cwd, KINTONE_ROOT), path.resolve(cwd, file)).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null;
  const [host, folder, ...rest] = rel.split("/");
  if (!host || !folder || rest.length === 0) return null;
  const m = folder.match(/^(\d+)(?:-|$)/);
  if (!m) return null;
  return { dir: path.join(cwd, KINTONE_ROOT, host, folder), host, appId: Number(m[1]) };
}

const pad = (n: number): string => String(n).padStart(2, "0");
/** ダウンロードと同じ名前（kit の exportFileName と同じ。日時はこの PC の時刻） */
export function snapshotNameOf(appId: number, now: Date = new Date()): string {
  return `${SNAPSHOT_PREFIX}-app${appId}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
}

export function editNameOf(snapshotFile: string): string {
  return snapshotFile.replace(/\.json$/, "-edit.json");
}

export interface AppFolderList {
  dir: string;
  hasFields: boolean;
  /** ダウンロードと pull（新しい順） */
  snapshots: string[];
  /** 直したもの（新しい順） */
  edits: string[];
  /** AI が作った帳票など、その他の json */
  reports: string[];
  records: string[];
  outs: number;
}

const stampOf = (name: string): string => {
  const m = name.match(/-(\d{8})-(\d{6})(?:-edit)?\.json$/);
  return m ? `${m[1]}${m[2]}` : "";
};
const newestFirst = (a: string, b: string): number => stampOf(b).localeCompare(stampOf(a)) || b.localeCompare(a);

/** アプリのフォルダーの一覧。cwd を渡すと、フォルダーと records / out の実体が作業フォルダーの中か確かめてから一覧する */
export function listAppFolder(dir: string, cwd?: string): AppFolderList {
  if (cwd !== undefined) for (const d of [dir, path.join(dir, "records"), path.join(dir, "out")]) if (existsSync(d)) assertDirInside(cwd, d);
  const files = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  const names = files.filter((d) => d.isFile() && d.name.endsWith(".json")).map((d) => d.name);
  const sub = (name: string, filter: (n: string) => boolean): string[] => {
    const p = path.join(dir, name);
    return existsSync(p) ? readdirSync(p).filter(filter).sort() : [];
  };
  return {
    dir,
    hasFields: names.includes("fields.json"),
    snapshots: names.filter((n) => SNAPSHOT_RE.test(n)).sort(newestFirst),
    edits: names.filter((n) => EDIT_RE.test(n)).sort(newestFirst),
    reports: names.filter((n) => n !== "fields.json" && !SNAPSHOT_RE.test(n) && !EDIT_RE.test(n)).sort(),
    records: sub("records", (n) => n.endsWith(".json")),
    outs: sub("out", (n) => n.endsWith(".html")).length
  };
}

/** 環境のうち、ホスト名が同じもの（構成 2 では 2 つ以上ある） */
export function envsOfHost(ws: Workspace, host: string): EnvironmentDef[] {
  return Object.values(ws.environments).filter((e) => e.host === host);
}

/**
 * アプリのフォルダー（kintone/<ホスト>/<番号>-…/）がどの環境のものか。ホストが 1 つの環境だけならそれ、
 * 同じホストの環境が 2 つ以上（構成 2）なら apps でその番号を持つ環境が 1 つだけのときそれ。決まらなければ undefined
 */
export function envOfAppFolder(ws: Workspace, host: string, appId: number): EnvironmentDef | undefined {
  const hits = envsOfHost(ws, host);
  if (hits.length === 1) return hits[0];
  const byApp = hits.filter((e) => ws.apps.some((a) => a.ids[e.name] === appId));
  return byApp.length === 1 ? byApp[0] : undefined;
}
