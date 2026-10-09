/**
 * .env の読み方（docs/authoring-plan.md 12.2、12.9 の 4・8・9）。テンプレートが使う kintone 公式 MCP（@kintone/mcp-server）と同じ変数名で、.env は 1 つで済む。
 *   KINTONE_BASE_URL   例 https://example.cybozu.com（必須。*.cybozu.com / *.kintone.com / *.cybozu.cn だけ。kintone-url.ts）
 *   KINTONE_API_TOKEN  API トークン（閲覧権限だけのものを第一候補にする。カンマ区切りで複数可）
 *   KINTONE_USERNAME / KINTONE_PASSWORD   ログインユーザー（トークンが無いとき）
 *   PCRAFT_PLUGIN_ZIP  印刷屋プラグインの zip（計算式エンジンと authoring API をここから読む。プラグイン ID が印刷屋のものでなければ読まない。engine.ts）
 *   （PCRAFT_ALLOW_UNKNOWN_PLUGIN は 1.1.0 で廃止。既知の中身の照合をやめたため）
 * dashboard の authoring テンプレートの KSQL_* も読む（KINTONE_* が無いとき）。OS の環境変数が優先され、.env は足りない分を埋める。値はログや例外の文言に出さない。
 * .env の場所はリポジトリのルート（cwd）に固定。CLI から別の場所を指定できない（1-10 レビュー BLOCKER 5。AI が書けるファイルを .env として読ませない）。
 * 注意: kintone 公式 MCP はトークンとユーザーの両方があるとユーザーを使う。tools はトークンを使う。どちらか 1 つだけ書くのがよい。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { KintoneUrlError, normalizeKintoneBaseUrl } from "./kintone-url.ts";

export interface KintoneAuth {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

const NAMES = {
  baseUrl: ["KINTONE_BASE_URL", "KSQL_BASE_URL"],
  token: ["KINTONE_API_TOKEN", "KSQL_TOKEN"],
  username: ["KINTONE_USERNAME", "KSQL_USERNAME"],
  password: ["KINTONE_PASSWORD", "KSQL_PASSWORD"],
  pluginZip: ["PCRAFT_PLUGIN_ZIP"]
} as const;

/** 前後の空白と、対になった外側の " / ' を外す（Windows の「パスのコピー」で付く引用符。.env と OS の環境変数の両方。引用符の中の空白は値のうち） */
export function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
  return value;
}

/** .env の形（KEY=VALUE。# の行と空行は無視。両端の " ' は外す。export KEY=… も可） */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = unquote(m[2]);
  }
  return out;
}

export interface LoadAuthOptions {
  /** テスト用。CLI からは渡さない（.env は cwd のものだけ） */
  envFile?: string;
  /** 作業フォルダー（.env の場所。WorkContext.root） */
  cwd: string;
  /** 環境変数（WorkContext.env）。中核は process.env を直接読まない */
  env: Readonly<Record<string, string | undefined>>;
}

export class AuthError extends Error {}

/** 値と、その出所（OS の環境変数か .env か）。相対パスの解決の起点を出所で変えるため（段階 0-2 の段 2） */
export interface Picked {
  value: string;
  /** process = OS の環境変数（print-craft MCP では設定項目から作った環境変数）、file = .env */
  source: "process" | "file";
  /** source が file のときの .env のパス */
  file?: string;
}

function pickerWithSource(opt: LoadAuthOptions): (names: readonly string[]) => Picked | undefined {
  const osEnv = opt.env;
  const file = envFileOf(opt);
  const fromFile = existsSync(file) ? parseDotEnv(readFileSync(file, "utf8")) : {};
  return (names) => {
    for (const [src, source] of [[osEnv, "process"], [fromFile, "file"]] as const) {
      for (const n of names) {
        const v = unquote(src[n] ?? "");
        if (v) return { value: v, source, ...(source === "file" ? { file } : {}) };
      }
    }
    return undefined;
  };
}

function picker(opt: LoadAuthOptions): (names: readonly string[]) => string | undefined {
  const pick = pickerWithSource(opt);
  return (names) => pick(names)?.value;
}

export function envFileOf(opt: LoadAuthOptions): string {
  return opt.envFile ?? path.join(opt.cwd, ".env");
}

/** 接続先の URL（検証済み。無ければ undefined） */
export function baseUrlFromEnv(opt: LoadAuthOptions): string | undefined {
  const raw = picker(opt)(NAMES.baseUrl);
  if (!raw) return undefined;
  try {
    return normalizeKintoneBaseUrl(raw);
  } catch (e) {
    throw new AuthError(`KINTONE_BASE_URL が不正: ${e instanceof KintoneUrlError ? e.message : String(e)}（https://<サブドメイン>.cybozu.com の形で書く）`);
  }
}

export function loadAuth(opt: LoadAuthOptions): KintoneAuth {
  const pick = picker(opt);
  const file = envFileOf(opt);
  const baseUrl = baseUrlFromEnv(opt);
  if (!baseUrl) throw new AuthError(`KINTONE_BASE_URL が無い（OS の環境変数か .env: ${file}。kintone 公式 MCP と同じ変数。dashboard の KSQL_BASE_URL でもよい）`);
  const token = pick(NAMES.token);
  const username = pick(NAMES.username);
  const password = pick(NAMES.password);
  if (!token && !(username && password)) throw new AuthError("KINTONE_API_TOKEN か、KINTONE_USERNAME と KINTONE_PASSWORD の両方が要る（OS の環境変数か .env）");
  return { baseUrl, token, username: token ? undefined : username, password: token ? undefined : password };
}

/**
 * environments.json の環境の認証（workspace.ts。2026-10-05）。接続先は environments.json の baseUrl、認証はその環境の envFile（.env か env/<名前>.env。
 * 場所は environments.json の値だけで、CLI から指定できない）だけから読む。OS の KINTONE_* / KSQL_* は読まない（開発と本番の取り違えを防ぐ。
 * OS に本番の KINTONE_BASE_URL があっても開発の環境で使わない）。envFile に KINTONE_BASE_URL があり environments.json と違えば止まる
 */
export function loadAuthForEnv(env: { name: string; baseUrl: string; envFile: string }, cwd: string): KintoneAuth {
  const file = path.join(cwd, env.envFile);
  if (!existsSync(file)) throw new AuthError(`環境「${env.name}」の認証のファイルが無い: ${env.envFile}（${env.envFile === ".env" ? ".env.example を写して作る" : "env/ に作る。.env と同じ書き方"}）`);
  const vars = parseDotEnv(readFileSync(file, "utf8"));
  const pick = (names: readonly string[]): string | undefined => {
    for (const n of names) if (vars[n] && vars[n].trim()) return vars[n].trim();
    return undefined;
  };
  const fileBase = pick(NAMES.baseUrl);
  if (fileBase) {
    let normalized = "";
    try {
      normalized = normalizeKintoneBaseUrl(fileBase);
    } catch {
      normalized = "";
    }
    if (normalized !== env.baseUrl) throw new AuthError(`${env.envFile} の KINTONE_BASE_URL が environments.json の環境「${env.name}」の baseUrl（${env.baseUrl}）と違う。取り違えを防ぐため止める（どちらかを直す）`);
  }
  const token = pick(NAMES.token);
  const username = pick(NAMES.username);
  const password = pick(NAMES.password);
  if (!token && !(username && password)) throw new AuthError(`${env.envFile} に KINTONE_API_TOKEN か、KINTONE_USERNAME と KINTONE_PASSWORD の両方が要る（環境「${env.name}」。OS の環境変数は読まない）`);
  return { baseUrl: env.baseUrl, token, username: token ? undefined : username, password: token ? undefined : password };
}

/**
 * 印刷屋の zip の場所（OS の環境変数か .env の PCRAFT_PLUGIN_ZIP。無ければ undefined = 開発中の print-craft を探す）。
 * .env に書いた相対パスは .env のフォルダーから解決する（今までどおり）。OS の環境変数（print-craft MCP では設定項目）の値は
 * 絶対パスだけを受け付ける（相対パスの起点が起動の場所に左右されるため。Desktop の起動の場所は / や C:\Windows\System32。段階 0-2 の段 2）
 */
export function pluginZipPath(opt: LoadAuthOptions): string | undefined {
  const picked = pickerWithSource(opt)(NAMES.pluginZip);
  if (!picked) return undefined;
  if (picked.source === "file") return path.resolve(path.dirname(picked.file ?? envFileOf(opt)), picked.value);
  if (!path.isAbsolute(picked.value)) throw new AuthError(`PCRAFT_PLUGIN_ZIP（OS の環境変数）は絶対パスで書く: ${picked.value}（.env に書くなら .env のフォルダーからの相対パスでもよい）`);
  return path.normalize(picked.value);
}

/** 認証の種類だけを文言にする（値もユーザー名も出さない） */
export function describeAuth(auth: KintoneAuth): string {
  return auth.token ? "API トークン" : "ログインユーザー";
}
