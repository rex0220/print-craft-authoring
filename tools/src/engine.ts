/**
 * 計算式の実エンジン（KintoneFormulaPCraft.min.js。印刷屋の zip と同じファイル）を Node で動かす。
 * 段階 0 の work/authoring-spike/engine.mjs の移植（docs/authoring-plan.md 11 章、12.2）。
 *   - happy-dom の window / document をグローバルに置く（ESC_HTML などが document を使う）
 *   - kintone / cybozu / rex0220_users_info3 は副作用の無いスタブ。kintone.api は呼ばない（reject）。kintone.api.url は setContext で
 *     渡した kintone の URL から組む（APP_URL 用）
 *   - 読む順は印刷屋の manifest と同じ: moment（vendor/）→ moment-timezone → bignumber（rex0220_BigNumber）→ KintoneFormulaPCraft
 *   - UMD が window に置くものと globalThis を揃える（lib は bare の rex0220_BigNumber / moment を参照する）
 * 1 プロセスに 1 回だけ読む（グローバルを使うため）。
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { ENGINE_FILE_NAME, MOMENT_FILE, libDir } from "./paths.ts";

/** 計算式のインスタンス（print-craft の config/libs.ts の KintoneFormula と同じ形） */
export interface FormulaInstance {
  funs: Record<string, unknown>;
  /** 引数ありで使用フィールドの記録を初期化、引数なしで取得 */
  usedFields(init?: Record<string, unknown>): Record<string, unknown>;
  /** 式を評価する。不正なら例外 */
  dq(expression: string): unknown;
  initTableInfo?(ptcode: string): void;
}

export type FormulaCtor = new (name: string, pp: unknown, record: unknown, fieldCheck: boolean, strict?: boolean) => FormulaInstance;

export interface LoginUser {
  id: string;
  code: string;
  name: string;
  email: string;
  language: string;
}

export interface KintoneContext {
  /** 例 https://example.cybozu.com（APP_URL の元） */
  baseUrl: string;
  appId: number;
  loginUser: LoginUser;
}

export interface Engine {
  window: Record<string, unknown>;
  Ctor: FormulaCtor;
  engineFile: string;
  engineSha256: string;
  /** スタブの kintone の URL・アプリ番号・ログインユーザーを差し替える（fields で取った値を渡す） */
  setContext(ctx: Partial<KintoneContext>): void;
  /** 設定画面と同じ検証用のインスタンス（createFormula）。pp は expandFields、crec は createCheckRecord の結果 */
  checker(pp: unknown, crec: unknown): FormulaInstance;
  /** デスクトップと同じ実行用のインスタンス（newFormula）。record は /k/v1/record の形 */
  runner(pp: unknown, record: unknown): FormulaInstance;
  /** 関数表の名前（設定画面の formulaFunctionNames と同じ） */
  functionNames(): string[];
}

const DEFAULT_USER: LoginUser = { id: "1", code: "authoring", name: "authoring", email: "", language: "ja" };

let loaded: Engine | null = null;

export function sha256(buf: string | Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function loadEngine(): Promise<Engine> {
  if (loaded) return loaded;
  const g = globalThis as Record<string, unknown>;
  const { Window } = (await import("happy-dom")) as unknown as { Window: new (opt: { url: string }) => Record<string, unknown> };
  const ctx: KintoneContext = { baseUrl: "https://example.cybozu.com", appId: 1, loginUser: { ...DEFAULT_USER } };
  const window = new Window({ url: `${ctx.baseUrl}/k/${ctx.appId}/show` });
  for (const k of ["document", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLImageElement", "HTMLIFrameElement", "DOMParser", "Event", "CSS", "getComputedStyle", "Blob", "File", "URL", "DOMRect", "requestAnimationFrame", "cancelAnimationFrame"]) {
    const v = window[k];
    if (v !== undefined && g[k] === undefined) g[k] = k === "getComputedStyle" && typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(window) : v;
  }
  g.window = window;

  // kintone のスタブ（書き込みも読み取りも API は呼ばない）
  const kintone = {
    getLoginUser: () => ({ ...ctx.loginUser, isGuest: false }),
    app: { getId: () => ctx.appId },
    mobile: { app: { getId: () => ctx.appId } },
    api: Object.assign(() => Promise.reject(new Error("kintone.api is not available in authoring tools")), {
      url: (p: string, _guest?: boolean) => `${ctx.baseUrl}${p.startsWith("/") ? "" : "/"}${p}`
    }),
    $PLUGIN_ID: "authoring"
  };
  g.kintone = kintone;
  g.cybozu = { data: { IS_MOBILE_DEVICE: false } };
  // rex0220_users_info3.data の形（lib が読む 9 項目）。ログインユーザー 1 人だけ（UINFO(LOGIN_CODE()) が動く）
  const u = ctx.loginUser;
  const infoUser = { id: u.id, code: u.code, name: u.name, email: u.email, primaryOrganization: null, organizations: [], groups: [] };
  const usersInfo = {
    users: [infoUser], organizations: [], groups: [],
    userCodes: { [u.code]: infoUser }, orgCodes: {}, groupCodes: {},
    userIds: { [u.id]: u.code }, orgIds: {}, groupIds: {}
  };
  g.rex0220_users_info3 = { request: () => undefined, getUsersInfo: async () => usersInfo, data: usersInfo };
  window.kintone = g.kintone;
  window.cybozu = g.cybozu;
  window.rex0220_users_info3 = g.rex0220_users_info3;

  const dir = libDir();
  const files = {
    moment: MOMENT_FILE,
    tz: path.join(dir, "moment-timezone-with-data.min.js"),
    bignumber: path.join(dir, "bignumber.min.js"),
    engine: path.join(dir, ENGINE_FILE_NAME)
  };
  if (!existsSync(files.moment)) throw new Error(`moment が無い: ${files.moment}（authoring/ で npm run vendor）`);
  for (const f of [files.tz, files.bignumber, files.engine]) if (!existsSync(f)) throw new Error(`lib が無い: ${f}`);
  const runScript = (file: string): void => {
    vm.runInThisContext(readFileSync(file, "utf8"), { filename: file });
    for (const k of ["moment", "rex0220_BigNumber", "rex0220_Decimal", "rex0220p"]) {
      if (g[k] === undefined && window[k] !== undefined) g[k] = window[k];
      if (window[k] === undefined && g[k] !== undefined) window[k] = g[k];
    }
  };
  runScript(files.moment);
  runScript(files.tz);
  runScript(files.bignumber);
  runScript(files.engine);
  const rex0220p = window.rex0220p as { KintoneFormulaPCraft?: FormulaCtor } | undefined;
  const Ctor = rex0220p?.KintoneFormulaPCraft;
  if (typeof Ctor !== "function") throw new Error("KintoneFormulaPCraft is not loaded");

  loaded = {
    window,
    Ctor,
    engineFile: files.engine,
    engineSha256: sha256(readFileSync(files.engine)),
    setContext(next) {
      if (next.baseUrl) ctx.baseUrl = next.baseUrl.replace(/\/+$/, "");
      if (next.appId) ctx.appId = next.appId;
      if (next.loginUser) ctx.loginUser = { ...ctx.loginUser, ...next.loginUser };
    },
    checker: (pp, crec) => new Ctor("formula", pp, crec, true, true),
    runner: (pp, record) => new Ctor("formula", pp, record, true),
    functionNames: () => Object.keys(new Ctor("formula", {}, {}, true, true).funs).sort()
  };
  return loaded;
}
