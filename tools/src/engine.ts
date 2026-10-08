/**
 * 印刷屋の計算式エンジン（KintoneFormulaPCraft.min.js）と authoring API（print-craft-authoring-api.js）を Node で動かす。
 * どちらも**利用者の印刷屋 zip から読む**（plugin-zip.ts。tools は配らない）。
 * 段階 0 の work/authoring-spike/engine.mjs が元（docs/authoring-plan.md 11 章、12.2、12.9 の 9）。
 *   - happy-dom の window / document をグローバルに置く（ESC_HTML などが document を使う。API の bundle は window にグローバルを置く）
 *   - kintone / cybozu / rex0220_users_info3 は副作用の無いスタブ。kintone.api は呼ばない（reject）。kintone.api.url は setContext の URL から組む
 *   - 読む順は印刷屋の manifest と同じ: moment（vendor/）→ moment-timezone → bignumber → KintoneFormulaPCraft → authoring API
 *   - 読み込んでよいかの照合（1.1.0。Takashi 2026-10-08「pluginid のチェックのみで OK」、docs/authoring-plan.md 12.18）: 外側の zip の PUBKEY から出る
 *     プラグイン ID が印刷屋のもの（meta.ts の PRINT_CRAFT_PLUGIN_ID）でなければ**実行せずに止める**。SIGNATURE は検証しない（本物の zip の PUBKEY を写した zip も通る）。
 *     manifest の version が Ver.6 以上の整数か、authoring API があるか。実行した後に API の apiVersion（SUPPORTED_API_VERSIONS）と pluginVersion、tools が使うキーの型。
 *     1.0.0 までは 4 ファイルの SHA-256 を既知のリリースの組と照合していた（1-10 レビュー BLOCKER 2）。tools の版は印刷屋の版と独立（2026-10-06 Takashi）
 *   - 開発中に隣の print-craft の prod/ から読む経路は、**ソースから動かしていて（mode dev）かつ PCRAFT_ALLOW_DEV_PLUGIN=1 のときだけ**。
 *     公開ビルド（mode build）では zip 以外から読まない（再レビュー BLOCKER 1: 利用者の node_modules に置いたファイルを実行しない）
 * zip の中のコードはこのプロセス（Node を起動した OS ユーザーと同じ権限）で動く。sandbox ではない。
 * 1 プロセスに 1 回だけ読む（グローバルを使うため）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import { devPluginDir, MOMENT_FILE } from "./paths.ts";
import { API_ENTRY, BIGNUMBER_ENTRY, ENGINE_ENTRY, MANIFEST_ENTRY, MOMENT_TZ_ENTRY, PluginZipError, readPluginZip, sha256Hex, type PluginSources } from "./plugin-zip.ts";
import { isSupportedPluginVersion, MIN_PLUGIN_VERSION, PRINT_CRAFT_PLUGIN_ID, REQUIRED_API, SUPPORTED_API_VERSIONS, toolsMeta } from "./meta.ts";

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
  /** プラグイン ID（zip の PUBKEY から。印刷屋のものでなければ読み込まない。pull が使う。開発中の print-craft から読んだときは無い） */
  pluginId?: string;
}

export interface Engine {
  window: Record<string, unknown>;
  Ctor: FormulaCtor;
  /** 印刷屋の authoring API（設定画面・帳票のコードと kit） */
  api: PrintCraftAuthoringApi;
  source: EngineSource;
  /** 読み込み時の注意（既知でない中身を許して続けたなど） */
  warnings: string[];
  setContext(ctx: Partial<KintoneContext>): void;
  /** 設定画面と同じ検証用のインスタンス（createFormula） */
  checker(pp: unknown, crec: unknown): FormulaInstance;
  /** デスクトップと同じ実行用のインスタンス（newFormula） */
  runner(pp: unknown, record: unknown): FormulaInstance;
  functionNames(): string[];
}

export interface LoadEngineOptions {
  /** 印刷屋の zip。省略時は環境変数 PCRAFT_PLUGIN_ZIP */
  pluginZip?: string;
  /** テスト用。省略時は toolsMeta().mode（ソースから動かすと dev、ビルドした bundle は build） */
  mode?: "build" | "dev";
}

/** 接続先が分からないときの APP_URL などの元（実在しないテナント） */
export const DEFAULT_CONTEXT_BASE_URL = "https://example.cybozu.com";
const DEFAULT_USER: LoginUser = { id: "1", code: "authoring", name: "authoring", email: "", language: "ja" };

let loaded: Engine | null = null;

/** 読み込み元を決める: zip（引数 → 環境変数）。開発中（mode dev + PCRAFT_ALLOW_DEV_PLUGIN=1）だけ隣の print-craft の prod/ */
export function resolvePluginSources(opt: LoadEngineOptions = {}, mode: "build" | "dev" = opt.mode ?? toolsMeta().mode): PluginSources & { kind: "zip" | "dev" } {
  const zip = opt.pluginZip ?? process.env.PCRAFT_PLUGIN_ZIP;
  if (zip) {
    if (!existsSync(zip)) throw new PluginZipError(`印刷屋の zip が無い: ${zip}（.env の PCRAFT_PLUGIN_ZIP）`);
    return { ...readPluginZip(zip), kind: "zip" };
  }
  const devAllowed = mode === "dev" && process.env.PCRAFT_ALLOW_DEV_PLUGIN === "1";
  if (!devAllowed) {
    throw new PluginZipError(`印刷屋の zip の場所が分からない。.env に PCRAFT_PLUGIN_ZIP=<印刷屋プラグインの zip のパス> を書く${mode === "dev" ? "（開発中に隣の print-craft の prod/ を読むなら環境変数 PCRAFT_ALLOW_DEV_PLUGIN=1）" : ""}`);
  }
  const dev = devPluginDir();
  if (!dev) throw new PluginZipError("印刷屋の zip の場所が分からない（PCRAFT_ALLOW_DEV_PLUGIN=1 だが隣の print-craft の prod/ が無い）。.env に PCRAFT_PLUGIN_ZIP を書く");
  const read = (rel: string): string => readFileSync(path.join(dev, rel), "utf8");
  const apiFile = path.join(dev, API_ENTRY);
  const engine = read(ENGINE_ENTRY);
  const bignumber = read(BIGNUMBER_ENTRY);
  const momentTimezone = read(MOMENT_TZ_ENTRY);
  const api = existsSync(apiFile) ? readFileSync(apiFile, "utf8") : undefined;
  const manifest = JSON.parse(read(MANIFEST_ENTRY)) as PluginSources["manifest"];
  return {
    kind: "dev",
    from: dev,
    manifest,
    pluginVersion: String(manifest.version ?? ""),
    engine,
    bignumber,
    momentTimezone,
    api,
    sha256: { engine: sha256Hex(engine), ...(api ? { api: sha256Hex(api) } : {}), bignumber: sha256Hex(bignumber), momentTimezone: sha256Hex(momentTimezone) }
  };
}

export async function loadEngine(opt: LoadEngineOptions = {}): Promise<Engine> {
  if (loaded) return loaded;
  const meta = toolsMeta();
  const src = resolvePluginSources(opt, opt.mode ?? meta.mode);
  const warnings: string[] = [];
  // 実行してよいか: 外側の zip の PUBKEY から出るプラグイン ID が印刷屋のものか（1.1.0。Takashi 2026-10-08「pluginid のチェックのみで OK」。SIGNATURE は見ない）
  if (src.kind === "zip" && src.pluginId !== PRINT_CRAFT_PLUGIN_ID) {
    throw new PluginZipError(`印刷屋プラグインの zip ではない（プラグイン ID ${src.pluginId ?? "不明（PUBKEY が無い）"}。印刷屋は ${PRINT_CRAFT_PLUGIN_ID}）: ${src.from}。配布元から入手した印刷屋の zip を PCRAFT_PLUGIN_ZIP に書く`);
  }
  if (src.kind === "dev") warnings.push(`開発中の print-craft（${src.from}。PCRAFT_ALLOW_DEV_PLUGIN=1）から読む。プラグイン ID は確かめない`);
  if (!isSupportedPluginVersion(src.pluginVersion)) {
    throw new PluginZipError(`印刷屋プラグインの版 ${src.pluginVersion || "不明"}（${src.from}）には対応していない。tools が扱うのは Ver.${MIN_PLUGIN_VERSION} 以降`);
  }
  if (!src.api) throw new PluginZipError(`印刷屋の zip に ${API_ENTRY} が無い（Ver.${MIN_PLUGIN_VERSION} 以降の zip が要る）: ${src.from}`);

  const g = globalThis as Record<string, unknown>;
  const { Window } = (await import("happy-dom")) as unknown as { Window: new (opt: { url: string }) => Record<string, unknown> };
  const ctx: KintoneContext = { baseUrl: DEFAULT_CONTEXT_BASE_URL, appId: 1, loginUser: { ...DEFAULT_USER } };
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
  if (!api || typeof api !== "object") throw new PluginZipError("印刷屋の authoring API（rex0220PrintCraftAuthoring）が読めない");
  if (!SUPPORTED_API_VERSIONS.includes(api.apiVersion)) throw new PluginZipError(`印刷屋の authoring API の版 ${String(api.apiVersion)} には対応していない（tools は ${SUPPORTED_API_VERSIONS.join(", ")}）。tools を新しい版にする`);
  if (String(api.pluginVersion) !== src.pluginVersion) throw new PluginZipError(`authoring API の印刷屋の版 ${String(api.pluginVersion)} が zip の manifest の版 ${src.pluginVersion} と違う（組み替えられた zip）`);
  const bad = Object.entries(REQUIRED_API).filter(([k, t]) => typeof (api as unknown as Record<string, unknown>)[k] !== t).map(([k]) => k);
  if (bad.length) throw new PluginZipError(`印刷屋の authoring API に tools が使うものが無い、または型が違う: ${bad.join(", ")}（tools と印刷屋の版を合わせる）`);

  loaded = {
    window,
    Ctor,
    api,
    source: { kind: src.kind, from: src.from, pluginVersion: src.pluginVersion, engineSha256: src.sha256.engine, apiSha256: src.sha256.api, ...(src.pluginId ? { pluginId: src.pluginId } : {}) },
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
