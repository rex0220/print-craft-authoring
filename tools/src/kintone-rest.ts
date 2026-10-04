/**
 * kintone REST API の読み取り専用クライアント（docs/authoring-plan.md 12.2、Codex MAJOR 5 の反映）。
 *   - GET しか送らない（メソッドはここで固定。他のメソッドを送る口が無い）
 *   - 送れるパスは ALLOWED_PATHS に固定し、それ以外は送信前に止める（ゲストスペースの /k/guest/<id>/v1/… も同じ一覧）
 *   - 認証は API トークン（X-Cybozu-API-Token）か、ログインユーザー（X-Cybozu-Authorization）
 *   - エラーの文言に認証情報とレコードの中身を入れない
 */
import type { KintoneAuth } from "./env.ts";

/** 許可する API（/k/v1/ と /k/guest/<id>/v1/ の後ろ） */
export const ALLOWED_APIS = ["app", "app/form/fields", "app/form/layout", "record", "preview/app/form/fields", "preview/app/form/layout"] as const;
export type AllowedApi = (typeof ALLOWED_APIS)[number];

export class RestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly apiPath: string | undefined;
  // Node の型の除去で動かすため、コンストラクターのパラメータープロパティは使わない
  constructor(message: string, status: number, code?: string, apiPath?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.apiPath = apiPath;
  }
}

export class NotAllowedError extends Error {}

export type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RestClient {
  readonly baseUrl: string;
  /** 許可した API を GET で呼ぶ。api は "app" / "app/form/fields" など。guestSpaceId を渡すとゲストスペースの URL */
  get<T>(api: AllowedApi, params: Record<string, string | number | boolean | undefined>, guestSpaceId?: number): Promise<T>;
}

export function apiPathOf(api: string, guestSpaceId?: number): string {
  if (!(ALLOWED_APIS as readonly string[]).includes(api)) throw new NotAllowedError(`この API は authoring tools では呼ばない: ${api}（許可: ${ALLOWED_APIS.join(", ")}）`);
  const prefix = guestSpaceId ? `/k/guest/${guestSpaceId}/v1/` : "/k/v1/";
  return `${prefix}${api}.json`;
}

export function authHeaders(auth: KintoneAuth): Record<string, string> {
  if (auth.token) return { "X-Cybozu-API-Token": auth.token };
  if (auth.username && auth.password) return { "X-Cybozu-Authorization": Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64") };
  throw new NotAllowedError("認証情報が無い");
}

export function createRestClient(auth: KintoneAuth, fetchImpl: FetchLike = fetch as unknown as FetchLike): RestClient {
  const baseUrl = auth.baseUrl.replace(/\/+$/, "");
  const headers = { ...authHeaders(auth), Accept: "application/json" };
  return {
    baseUrl,
    async get<T>(api: AllowedApi, params: Record<string, string | number | boolean | undefined>, guestSpaceId?: number): Promise<T> {
      const apiPath = apiPathOf(api, guestSpaceId);
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
      const url = `${baseUrl}${apiPath}${qs.size ? `?${qs}` : ""}`;
      const res = await fetchImpl(url, { method: "GET", headers });
      const text = await res.text();
      if (!res.ok) {
        let code: string | undefined;
        let message = "";
        try {
          const body = JSON.parse(text) as { code?: string; message?: string };
          code = body.code;
          message = body.message ?? "";
        } catch {
          // JSON でない応答はそのまま
        }
        const hint = res.status === 401 ? "（認証情報かアクセス権を確かめる。API トークンならそのアプリで有効か）" : res.status === 403 ? "（アクセス権が無い）" : res.status === 404 ? "（アプリかレコードが無い）" : "";
        throw new RestError(`kintone ${apiPath} が HTTP ${res.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}${hint}`, res.status, code, apiPath);
      }
      return JSON.parse(text) as T;
    }
  };
}
