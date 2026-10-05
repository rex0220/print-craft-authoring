/**
 * kintone REST API の読み取り専用クライアント（docs/authoring-plan.md 12.2、Codex MAJOR 5 の反映。1-10 レビュー BLOCKER 1 で送信先の検証を足した）。
 *   - GET しか送らない（メソッドはここで固定。他のメソッドを送る口が無い）
 *   - 送れるパスは ALLOWED_APIS に固定し、それ以外は送信前に止める（ゲストスペースの /k/guest/<id>/v1/… も同じ一覧）
 *   - 送信先は kintone のドメイン（kintone-url.ts）だけ。URL は new URL(path, base) で組み、送信直前に origin が検証済みの origin と同じか確かめる
 *   - 認証は API トークン（X-Cybozu-API-Token）か、ログインユーザー（X-Cybozu-Authorization）
 *   - エラーの文言は HTTP の状態と kintone のコードと固定のヒントだけ（サーバーの message は出さない。認証情報とレコードの中身を混ぜない）
 */
import type { KintoneAuth } from "./env.ts";
import { KintoneUrlError, normalizeKintoneBaseUrl } from "./kintone-url.ts";

/**
 * 許可する API（/k/v1/ と /k/guest/<id>/v1/ の後ろ）。app/plugin/config と preview/app/plugin/config は pull が使う（API ラボの
 * 「アプリに追加されているプラグインの設定情報を取得する」。GET だけ。変更の PUT は呼ばない。Takashi 2026-10-05「tools のみで GET だけ」）
 */
export const ALLOWED_APIS = ["app", "app/form/fields", "app/form/layout", "record", "preview/app/form/fields", "preview/app/form/layout", "app/plugin/config", "preview/app/plugin/config"] as const;
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
  if (guestSpaceId !== undefined && (!Number.isInteger(guestSpaceId) || guestSpaceId <= 0)) throw new NotAllowedError(`ゲストスペースの ID が不正: ${String(guestSpaceId)}`);
  const prefix = guestSpaceId ? `/k/guest/${guestSpaceId}/v1/` : "/k/v1/";
  return `${prefix}${api}.json`;
}

export function authHeaders(auth: KintoneAuth): Record<string, string> {
  if (auth.token) return { "X-Cybozu-API-Token": auth.token };
  if (auth.username && auth.password) return { "X-Cybozu-Authorization": Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64") };
  throw new NotAllowedError("認証情報が無い");
}

export function createRestClient(auth: KintoneAuth, fetchImpl: FetchLike = fetch as unknown as FetchLike): RestClient {
  let baseUrl: string;
  try {
    baseUrl = normalizeKintoneBaseUrl(auth.baseUrl);
  } catch (e) {
    throw new NotAllowedError(`接続先が kintone ではないので送らない: ${e instanceof KintoneUrlError ? e.message : String(e)}`);
  }
  const headers = { ...authHeaders(auth), Accept: "application/json" };
  return {
    baseUrl,
    async get<T>(api: AllowedApi, params: Record<string, string | number | boolean | undefined>, guestSpaceId?: number): Promise<T> {
      const apiPath = apiPathOf(api, guestSpaceId);
      const url = new URL(apiPath, baseUrl);
      for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
      if (url.origin !== baseUrl || url.username || url.password) throw new NotAllowedError(`送信先が kintone の接続先と違うので送らない: ${url.origin}`);
      const res = await fetchImpl(url.href, { method: "GET", headers });
      const text = await res.text();
      if (!res.ok) {
        let code: string | undefined;
        try {
          const body = JSON.parse(text) as { code?: string };
          code = typeof body.code === "string" ? body.code.slice(0, 40) : undefined;
        } catch {
          // JSON でない応答は無視
        }
        const hint = res.status === 401 ? "（認証情報かアクセス権を確かめる。API トークンならそのアプリで有効か）" : res.status === 403 ? "（アクセス権が無い）" : res.status === 404 ? "（アプリかレコードが無い）" : "";
        throw new RestError(`kintone ${apiPath} が HTTP ${res.status}${code ? ` ${code}` : ""}${hint}`, res.status, code, apiPath);
      }
      return JSON.parse(text) as T;
    }
  };
}
