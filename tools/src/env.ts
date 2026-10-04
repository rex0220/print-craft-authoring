/**
 * kintone の認証情報（docs/authoring-plan.md 12.2、12.9 の 4 と 8）。テンプレートが使う kintone 公式 MCP（@kintone/mcp-server）と同じ変数名で、
 * .env は 1 つで済む。
 *   KINTONE_BASE_URL   例 https://example.cybozu.com（必須）
 *   KINTONE_API_TOKEN  API トークン（閲覧権限だけのものを第一候補にする。カンマ区切りで複数可）
 *   KINTONE_USERNAME / KINTONE_PASSWORD   ログインユーザー（トークンが無いとき）
 * dashboard の authoring テンプレートの KSQL_BASE_URL / KSQL_TOKEN / KSQL_USERNAME / KSQL_PASSWORD も読む（KINTONE_* が無いとき）。
 * OS の環境変数が優先され、.env は足りない分を埋める。値はログや例外の文言に出さない。
 * 注意: kintone 公式 MCP はトークンとユーザーの両方があるとユーザーを使う。tools はトークンを使う。どちらか 1 つだけ書くのがよい。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
  password: ["KINTONE_PASSWORD", "KSQL_PASSWORD"]
} as const;

/** .env の形（KEY=VALUE。# の行と空行は無視。両端の " ' は外す。export KEY=… も可） */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

export interface LoadAuthOptions {
  /** .env のパス（省略時は cwd/.env） */
  envFile?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export class AuthError extends Error {}

export function loadAuth(opt: LoadAuthOptions = {}): KintoneAuth {
  const osEnv = opt.env ?? process.env;
  const file = opt.envFile ?? path.join(opt.cwd ?? process.cwd(), ".env");
  const fromFile = existsSync(file) ? parseDotEnv(readFileSync(file, "utf8")) : {};
  // OS の環境変数（KINTONE_* → KSQL_*）→ .env（KINTONE_* → KSQL_*）
  const pick = (names: readonly string[]): string | undefined => {
    for (const src of [osEnv, fromFile]) {
      for (const n of names) {
        const v = src[n];
        if (v && v.trim()) return v.trim();
      }
    }
    return undefined;
  };
  const baseUrl = pick(NAMES.baseUrl);
  if (!baseUrl) throw new AuthError(`KINTONE_BASE_URL が無い（OS の環境変数か .env: ${file}。kintone 公式 MCP と同じ変数。dashboard の KSQL_BASE_URL でもよい）`);
  if (!/^https:\/\/[^/\s]+$/.test(baseUrl.replace(/\/+$/, ""))) throw new AuthError("KINTONE_BASE_URL は https://<サブドメイン>.cybozu.com の形で書く");
  const token = pick(NAMES.token);
  const username = pick(NAMES.username);
  const password = pick(NAMES.password);
  if (!token && !(username && password)) throw new AuthError("KINTONE_API_TOKEN か、KINTONE_USERNAME と KINTONE_PASSWORD の両方が要る（OS の環境変数か .env）");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, username: token ? undefined : username, password: token ? undefined : password };
}

/** 認証の種類だけを文言にする（値は出さない） */
export function describeAuth(auth: KintoneAuth): string {
  return auth.token ? "API トークン" : `ログインユーザー ${auth.username ?? ""}`;
}
