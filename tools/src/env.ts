/**
 * kintone の認証情報（docs/authoring-plan.md 12.2、12.9 の 4）。dashboard の authoring テンプレートと同じ変数名で、.env は 1 つで済む。
 *   KSQL_BASE_URL   例 https://example.cybozu.com（必須）
 *   KSQL_TOKEN      API トークン（閲覧権限だけのものを第一候補にする）
 *   KSQL_USERNAME / KSQL_PASSWORD   ログインユーザー（トークンが無いとき）
 * OS の環境変数が優先され、.env は足りない分を埋める（dashboard の README と同じ）。値はログや例外の文言に出さない。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface KintoneAuth {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

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
  const pick = (k: string): string | undefined => {
    const v = osEnv[k] ?? fromFile[k];
    return v && v.trim() ? v.trim() : undefined;
  };
  const baseUrl = pick("KSQL_BASE_URL");
  if (!baseUrl) throw new AuthError(`KSQL_BASE_URL が無い（OS の環境変数か .env: ${file}）`);
  if (!/^https:\/\/[^/\s]+$/.test(baseUrl.replace(/\/+$/, ""))) throw new AuthError("KSQL_BASE_URL は https://<サブドメイン>.cybozu.com の形で書く");
  const token = pick("KSQL_TOKEN");
  const username = pick("KSQL_USERNAME");
  const password = pick("KSQL_PASSWORD");
  if (!token && !(username && password)) throw new AuthError("KSQL_TOKEN か、KSQL_USERNAME と KSQL_PASSWORD の両方が要る（OS の環境変数か .env）");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, username: token ? undefined : username, password: token ? undefined : password };
}

/** 認証の種類だけを文言にする（値は出さない） */
export function describeAuth(auth: KintoneAuth): string {
  return auth.token ? "API トークン" : `ログインユーザー ${auth.username ?? ""}`;
}
