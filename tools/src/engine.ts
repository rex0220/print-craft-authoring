/**
 * 印刷屋の計算式エンジン（KintoneFormulaPCraft.min.js）と authoring API（print-craft-authoring-api.js）を Node で動かす。
 * どちらも**利用者の印刷屋 zip から読む**（plugin-zip.ts。tools は配らない）。
 * 段階 0 の work/authoring-spike/engine.mjs が元（docs/authoring-plan.md 11 章、12.2、12.9 の 9）。
 *   - happy-dom の window / document をグローバルに置く（ESC_HTML などが document を使う。API の bundle は window にグローバルを置く）
 *   - kintone / cybozu / rex0220_users_info3 は副作用の無いスタブ。kintone.api は呼ばない（reject）。kintone.api.url は setContext の URL から組む
 *   - 読む順は印刷屋の manifest と同じ: moment（vendor/）→ moment-timezone → bignumber → KintoneFormulaPCraft → authoring API
 *   - 版と中身の照合（1-10 レビュー BLOCKER 2 / MAJOR 8、再レビュー BLOCKER 1 / MAJOR 3）: zip の manifest の version が対応する版か、
 *     エンジン・API・bignumber・moment-timezone の SHA-256 が既知のリリースの組み合わせ（tuple）と一致するか（**違えば実行せずに止める**。
 *     利用者が .env に PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 を書いたときだけ警告で続く）、API の apiVersion と pluginVersion、tools が使うキーの型、tools の版の先頭（= 印刷屋の版）
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
import { KNOWN_PLUGIN_RELEASES, REQUIRED_API, SUPPORTED_API_VERSION, SUPPORTED_PLUGIN_VERSIONS, toolsMeta, type KnownRelease } from "./meta.ts";

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
  /** zip の中身（エンジン・API・bignumber・moment-timezone）が既知のリリースの組み合わせと一致するか */
  engineKnown: boolean;
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
  /** 既知でない中身の zip でも警告で続ける（.env の PCRAFT_ALLOW_UNKNOWN_PLUGIN=1。利用者だけが書ける） */
  allowUnknown?: boolean;
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

const PARTS: Array<[label: string, key: keyof KnownRelease & keyof PluginSources["sha256"]]> = [
  ["計算式エンジン", "engine"],
  ["authoring API", "api"],
  ["bignumber", "bignumber"],
  ["moment-timezone", "momentTimezone"]
];

/**
 * zip の中身が既知のリリースの組み合わせと一致するか。一致すれば []、しなければ最も近いリリースと違う部品の一覧
 * （releases はテスト用に差し替えられる）
 */
export function unknownParts(src: PluginSources, releases: Record<string, KnownRelease[]> = KNOWN_PLUGIN_RELEASES): string[] {
  const list = releases[src.pluginVersion];
  if (!list?.length) return ["版の一覧が無い"];
  const matches = (r: KnownRelease): number => PARTS.filter(([, k]) => src.sha256[k] && r[k] === src.sha256[k]).length;
  if (list.some((r) => matches(r) === PARTS.length)) return [];
  const show = ([label, k]: (typeof PARTS)[number]): string => `${label} ${src.sha256[k] ? src.sha256[k]!.slice(0, 12) + "…" : "無し"}`;
  const bestScore = Math.max(...list.map(matches));
  if (bestScore === 0) return PARTS.map(show);
  // 最も近いリリース（同率なら全部）で「違う部品」が同じならそれを出す。候補によって違う部品が違うなら 4 つとも出す（登録順に左右されない）
  const candidates = list.filter((r) => matches(r) === bestScore);
  const diffs = candidates.map((r) => PARTS.filter(([, k]) => !src.sha256[k] || r[k] !== src.sha256[k]).map(([label]) => label).join("|"));
  if (new Set(diffs).size !== 1) return PARTS.map(show);
  const best = candidates[0];
  const diff = PARTS.filter(([, k]) => !src.sha256[k] || best[k] !== src.sha256[k]).map(show);
  return diff.length ? diff : PARTS.map(show);
}

export async function loadEngine(opt: LoadEngineOptions = {}): Promise<Engine> {
  if (loaded) return loaded;
  const meta = toolsMeta();
  const src = resolvePluginSources(opt, opt.mode ?? meta.mode);
  const warnings: string[] = [];
  if (!SUPPORTED_PLUGIN_VERSIONS.includes(src.pluginVersion)) {
    throw new PluginZipError(`印刷屋プラグインの版 ${src.pluginVersion || "不明"}（${src.from}）には対応していない。tools が対応する版: ${SUPPORTED_PLUGIN_VERSIONS.join(", ")}`);
  }
  if (!src.api) throw new PluginZipError(`印刷屋の zip に ${API_ENTRY} が無い（Ver.6 以降の zip が要る）: ${src.from}`);
  const toolsMajor = meta.toolsVersion.split(".")[0];
  if (toolsMajor !== src.pluginVersion) throw new PluginZipError(`tools ${meta.toolsVersion} は印刷屋 Ver.${toolsMajor} 用。zip は版 ${src.pluginVersion}（${src.from}）。tools を印刷屋の版に合わせる`);
  const unknown = unknownParts(src);
  const engineKnown = unknown.length === 0;
  if (!engineKnown) {
    const head = `印刷屋の zip の中身が tools の既知のリリースと違う: ${unknown.join("、")}（${src.from}）`;
    if (src.kind === "dev") warnings.push(`${head}。開発中の print-craft（PCRAFT_ALLOW_DEV_PLUGIN=1）なので続ける`);
    else if (opt.allowUnknown) warnings.push(`${head}。PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 なので続ける（結果が設定画面と違うことがある）`);
    else throw new PluginZipError(`${head}。配布元から取り直した zip を使うか、tools を新しい版にする。新しい修正版の zip だと分かっていて続けるなら、利用者が .env に PCRAFT_ALLOW_UNKNOWN_PLUGIN=1 を書く（zip の中のコードはこの PC の権限で動く。AI は .env を書けない）`);
  }

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
  if (api.apiVersion !== SUPPORTED_API_VERSION) throw new PluginZipError(`印刷屋の authoring API の版 ${String(api.apiVersion)} には対応していない（tools は ${SUPPORTED_API_VERSION}）。tools を印刷屋の版に合わせて更新する`);
  if (String(api.pluginVersion) !== src.pluginVersion) throw new PluginZipError(`authoring API の印刷屋の版 ${String(api.pluginVersion)} が zip の manifest の版 ${src.pluginVersion} と違う（組み替えられた zip）`);
  const bad = Object.entries(REQUIRED_API).filter(([k, t]) => typeof (api as unknown as Record<string, unknown>)[k] !== t).map(([k]) => k);
  if (bad.length) throw new PluginZipError(`印刷屋の authoring API に tools が使うものが無い、または型が違う: ${bad.join(", ")}（tools と印刷屋の版を合わせる）`);

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
