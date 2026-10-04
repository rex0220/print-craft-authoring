/**
 * 印刷屋の計算式エンジン（KintoneFormulaPCraft.min.js）と authoring API（print-craft-authoring-api.js）を Node で動かす。
 * どちらも**利用者の印刷屋 zip から読む**（plugin-zip.ts。tools は配らない）。開発中は隣の print-craft の prod/ からも読める。
 * 段階 0 の work/authoring-spike/engine.mjs が元（docs/authoring-plan.md 11 章、12.2、12.9 の 9）。
 *   - happy-dom の window / document をグローバルに置く（ESC_HTML などが document を使う。API の bundle は window にグローバルを置く）
 *   - kintone / cybozu / rex0220_users_info3 は副作用の無いスタブ。kintone.api は呼ばない（reject）。kintone.api.url は setContext の URL から組む
 *   - 読む順は印刷屋の manifest と同じ: moment（vendor/）→ moment-timezone → bignumber → KintoneFormulaPCraft → authoring API
 *   - 版の照合: zip の manifest の version が対応する版か、API の apiVersion が合うか。エンジンの SHA-256 が既知でなければ警告
 * 1 プロセスに 1 回だけ読む（グローバルを使うため）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import { devPluginDir, MOMENT_FILE } from "./paths.ts";
import { API_ENTRY, BIGNUMBER_ENTRY, ENGINE_ENTRY, MANIFEST_ENTRY, MOMENT_TZ_ENTRY, PluginZipError, readPluginZip, sha256Hex, type PluginSources } from "./plugin-zip.ts";
import { KNOWN_ENGINE_SHA256, SUPPORTED_API_VERSION, SUPPORTED_PLUGIN_VERSIONS } from "./meta.ts";

/** 計算式のインスタンス（print-craft の config/libs.ts の KintoneFormula と同じ形） */
export interface FormulaInstance {
  funs: Record<string, unknown>;
  usedFields(init?: Record<string, unknown>): Record<string, unknown>;
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
  baseUrl: string;
  appId: number;
  loginUser: LoginUser;
}

export interface EngineSource {
  kind: "zip" | "dev";
  from: string;
  pluginVersion: string;
  engineSha256: string;
  apiSha256?: string;
  /** エンジンの SHA-256 が tools の既知の一覧にあるか */
  engineKnown: boolean;
}

export interface Engine {
  window: Record<string, unknown>;
  Ctor: FormulaCtor;
  /** 印刷屋の authoring API（設定画面・帳票のコードと kit） */
  api: PrintCraftAuthoringApi;
  source: EngineSource;
  /** 読み込み時の注意（エンジンの SHA-256 が未知など） */
  warnings: string[];
  setContext(ctx: Partial<KintoneContext>): void;
  /** 設定画面と同じ検証用のインスタンス（createFormula） */
  checker(pp: unknown, crec: unknown): FormulaInstance;
  /** デスクトップと同じ実行用のインスタンス（newFormula） */
  runner(pp: unknown, record: unknown): FormulaInstance;
  functionNames(): string[];
}

export interface LoadEngineOptions {
  /** 印刷屋の zip。省略時は環境変数 PCRAFT_PLUGIN_ZIP、無ければ開発中の print-craft の prod/ */
  pluginZip?: string;
}

const DEFAULT_USER: LoginUser = { id: "1", code: "authoring", name: "authoring", email: "", language: "ja" };

let loaded: Engine | null = null;

/** 読み込み元を決める: zip（引数 → 環境変数）→ 開発中の print-craft */
export function resolvePluginSources(opt: LoadEngineOptions = {}): PluginSources & { kind: "zip" | "dev" } {
  const zip = opt.pluginZip ?? process.env.PCRAFT_PLUGIN_ZIP;
  if (zip) {
    if (!existsSync(zip)) throw new PluginZipError(`印刷屋の zip が無い: ${zip}（.env の PCRAFT_PLUGIN_ZIP か --plugin-zip）`);
    return { ...readPluginZip(zip), kind: "zip" };
  }
  const dev = devPluginDir();
  if (!dev) throw new PluginZipError("印刷屋の zip の場所が分からない。.env に PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス> を書く（または --plugin-zip）");
  const read = (rel: string): string => readFileSync(path.join(dev, rel), "utf8");
  const apiFile = path.join(dev, API_ENTRY);
  const engine = read(ENGINE_ENTRY);
  const api = existsSync(apiFile) ? readFileSync(apiFile, "utf8") : undefined;
  const manifest = JSON.parse(read(MANIFEST_ENTRY)) as PluginSources["manifest"];
  return {
    kind: "dev",
    from: dev,
    manifest,
    pluginVersion: String(manifest.version ?? ""),
    engine,
    bignumber: read(BIGNUMBER_ENTRY),
    momentTimezone: read(MOMENT_TZ_ENTRY),
    api,
    sha256: { engine: sha256Hex(engine), ...(api ? { api: sha256Hex(api) } : {}) }
  };
}

export async function loadEngine(opt: LoadEngineOptions = {}): Promise<Engine> {
  if (loaded) return loaded;
  const src = resolvePluginSources(opt);
  const warnings: string[] = [];
  if (!SUPPORTED_PLUGIN_VERSIONS.includes(src.pluginVersion)) {
    throw new PluginZipError(`印刷屋プラグインの版 ${src.pluginVersion || "不明"}（${src.from}）には対応していない。tools が対応する版: ${SUPPORTED_PLUGIN_VERSIONS.join(", ")}`);
  }
  if (!src.api) throw new PluginZipError(`印刷屋の zip に ${API_ENTRY} が無い（Ver.6 以降の zip が要る）: ${src.from}`);
  const known = KNOWN_ENGINE_SHA256[src.pluginVersion] ?? [];
  const engineKnown = known.includes(src.sha256.engine);
  if (!engineKnown) warnings.push(`計算式エンジンの SHA-256 が tools の既知の一覧に無い（${src.sha256.engine.slice(0, 12)}…。新しい修正版か、改変された zip）。動作は続けるが結果が設定画面と違うことがある`);

  const g = globalThis as Record<string, unknown>;
  const { Window } = (await import("happy-dom")) as unknown as { Window: new (opt: { url: string }) => Record<string, unknown> };
  const ctx: KintoneContext = { baseUrl: "https://example.cybozu.com", appId: 1, loginUser: { ...DEFAULT_USER } };
  const window = new Window({ url: `${ctx.baseUrl}/k/${ctx.appId}/show` });
  for (const k of ["document", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLImageElement", "HTMLIFrameElement", "DOMParser", "Event", "CSS", "getComputedStyle", "Blob", "File", "URL", "DOMRect", "requestAnimationFrame", "cancelAnimationFrame"]) {
    const v = window[k];
    if (v !== undefined && g[k] === undefined) g[k] = k === "getComputedStyle" && typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(window) : v;
  }
  g.window = window;

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

  if (!existsSync(MOMENT_FILE)) throw new Error(`moment が無い: ${MOMENT_FILE}（tools の npm install 時に取る。手で取るなら npm run vendor）`);
  const runScript = (code: string, filename: string): void => {
    vm.runInThisContext(code, { filename });
    for (const k of ["moment", "rex0220_BigNumber", "rex0220_Decimal", "rex0220p", "rex0220PrintCraftAuthoring"]) {
      if (g[k] === undefined && window[k] !== undefined) g[k] = window[k];
      if (window[k] === undefined && g[k] !== undefined) window[k] = g[k];
    }
  };
  runScript(readFileSync(MOMENT_FILE, "utf8"), MOMENT_FILE);
  runScript(src.momentTimezone, `${src.from}!${MOMENT_TZ_ENTRY}`);
  runScript(src.bignumber, `${src.from}!${BIGNUMBER_ENTRY}`);
  runScript(src.engine, `${src.from}!${ENGINE_ENTRY}`);
  runScript(src.api, `${src.from}!${API_ENTRY}`);
  const rex0220p = window.rex0220p as { KintoneFormulaPCraft?: FormulaCtor } | undefined;
  const Ctor = rex0220p?.KintoneFormulaPCraft;
  if (typeof Ctor !== "function") throw new Error("KintoneFormulaPCraft is not loaded");
  const api = window.rex0220PrintCraftAuthoring as PrintCraftAuthoringApi | undefined;
  if (!api) throw new Error("印刷屋の authoring API（rex0220PrintCraftAuthoring）が読めない");
  if (api.apiVersion !== SUPPORTED_API_VERSION) throw new PluginZipError(`印刷屋の authoring API の版 ${api.apiVersion} には対応していない（tools は ${SUPPORTED_API_VERSION}）。tools を印刷屋の版に合わせて更新する`);

  loaded = {
    window,
    Ctor,
    api,
    source: { kind: src.kind, from: src.from, pluginVersion: src.pluginVersion, engineSha256: src.sha256.engine, apiSha256: src.sha256.api, engineKnown },
    warnings,
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
