/**
 * try（お試しアプリで式と帳票を試す。CLI の try と print-craft MCP の pcraft_try。print-craft の docs/authoring-try-plan.md 4.2〜4.5、T3）。
 * 評価の子プロセス（Worker thread）の中で動かす（runEval の kind "try"。親は validateTryInput で入力だけを確かめる）。値はすべて架空なので、
 * 式の評価として返った値とエラーの文、描いたページの文字を返す（4.5）。利用者のアプリ・レコード・接続は使わない。
 *   - 対象のレコード: 省略は固定のレコード 3 件、records は番号で絞る、rows はレコード 1 のテーブルを n 行に（quote / gantt）、count は一覧のレコード n 件（list）
 *   - formulas: 式ごとに対象のレコードで評価（table を付ければその行ごと。20 行まで）
 *   - button: 印刷屋の設定の 1 ボタン（1 行目 $out = displayCondition、2 行目 $fname = fileNameFormula、3 行目 = html / css / bodyFormula）を本物の形で組み、
 *     通常の runPreview（normalize → 描画 → 掃除 → verifyPreviewHtml）で描く。list: true は対象のレコードを全部 $records に入れて 1 つの帳票
 *   - 関連レコード一覧の仮のテーブルが印刷屋の上限（RELATED_LIMIT）を超えたら、印刷屋と同じく帳票を作らない（related.tooMany）
 *   - 結果は structuredContent にした JSON の文字数 16,000 まで（4.2 の削る順）。描いた HTML は files（out/try/ に書くのは呼ぶ側）
 */
import type { Engine } from "../engine.ts";
import { DEFAULT_CONTEXT_BASE_URL } from "../engine.ts";
import { InputError } from "./normalize.ts";
import { runPreview } from "./preview.ts";
import { buildModel } from "../normalize/model.ts";
import type { Finding } from "../normalize/findings.ts";
import type { KintoneRecord } from "./record.ts";
import { MAX_COUNT, TRY_APP_KEYS, fixedRecord, relatedOverLimit, tryApp, withCount, withRows, type TryApp, type TryAppKey } from "../try-apps/index.ts";
import { byteLength, cutText, evaluationErrorText, toJsonSafe } from "../worker/values.ts";
import { renderErrorHint, sinceV9Hint } from "../normalize/derive.ts";
import type { JsonValue } from "../worker/eval-job.ts";

export const TRY_MAX_FORMULAS = 10;
/** 入力の上限（UTF-8 のバイト数。4.2） */
export const TRY_MAX_HTML_BYTES = 65_536;
export const TRY_MAX_CSS_BYTES = 32_768;
export const TRY_MAX_FORMULA_BYTES = 16_384;
/** table を付けた式を評価する行の数 */
export const TRY_MAX_TABLE_ROWS = 20;
/** 結果の上限（4.2）: 1 ページの文字、エラーの文 1 つ（字）、結果全体の JSON の文字数、式 1 つの結果と HTML の大きさ（バイト） */
export const TRY_MAX_PAGE_CHARS = 2_000;
export const TRY_MAX_ERROR_CHARS = 1_000;
export const TRY_MAX_RESULT_CHARS = 16_000;
export const TRY_MAX_VALUE_BYTES = 262_144;
export const TRY_MAX_HTML_OUT_BYTES = 2_097_152;

export interface TryFormula {
  formula: string;
  table?: string;
}
export interface TryButton {
  html: string;
  css?: string;
  bodyFormula?: string;
  fileNameFormula?: string;
  displayCondition?: string;
  pageSize?: string;
  orientation?: string;
  dpi?: string;
  list?: boolean;
}
export interface TryInput {
  app?: string;
  records?: number[];
  rows?: number;
  count?: number;
  formulas?: TryFormula[];
  button?: TryButton;
}

export interface TryValue {
  target: string;
  row?: number;
  text?: string;
  raw?: JsonValue;
  evaluationError?: string;
  tooLarge?: boolean;
  convertFailed?: boolean;
}
export interface TryFormulaResult {
  formula: string;
  table?: string;
  values: TryValue[];
  rowsOmitted?: number;
}
export interface TryPageText {
  page: number;
  text: string;
  cutChars?: number;
  hasError?: boolean;
}
export interface TryButtonTarget {
  target: string;
  /** files の key と同じ（out/try/<app>-<key>.html） */
  key: string;
  pages: number;
  pageTexts: TryPageText[];
  pagesOmitted?: number[];
  errors: string[];
  errorCount: number;
  fileName: { value: string; usedDefault?: boolean; evaluationError?: string };
  displayCondition: { applied: false } | { applied: true; set: boolean; shown: boolean; value?: string; evaluationError?: string };
  /** 描いた HTML が大きすぎて files に入れなかった */
  htmlTooLarge?: boolean;
}
export interface TryResult {
  app: TryAppKey;
  title: string;
  mode: "formulas" | "button";
  targets: string[];
  formulas?: TryFormulaResult[];
  button?: { findings: Finding[]; results: TryButtonTarget[] };
  /** 帳票を作らなかった対象（印刷屋と同じ理由。関連レコード一覧の上限） */
  refused?: Array<{ target: string; code: "related.tooMany"; message: string }>;
  notes: string[];
  /** 結果を上限に収めるために削ったこと */
  cut?: string[];
}
export interface TryOutcome {
  result: TryResult;
  /**
   * 描いた帳票（呼ぶ側が out/try/<app>-<key>.html に書く。Desktop は inner を会話の中のプレビューに）。描けなかった対象（関連レコード一覧の上限、HTML が大きすぎる）は
   * html が無い（呼ぶ側は同じ名前の古いファイルを消す。前の結果を残さない。4.2）
   */
  files: Array<{ key: string; menu?: string; html?: string; inner?: string }>;
}

const KEYS = ["app", "records", "rows", "count", "formulas", "button"];
const BUTTON_KEYS = ["html", "css", "bodyFormula", "fileNameFormula", "displayCondition", "pageSize", "orientation", "dpi", "list"];
const bad = (m: string): never => {
  throw new InputError(m);
};
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const checkBytes = (v: unknown, name: string, max: number): void => {
  if (v === undefined) return;
  if (typeof v !== "string") bad(`${name} は文字列`);
  if (byteLength(v as string) > max) bad(`${name} が長すぎる（${byteLength(v as string).toLocaleString()} バイト。${max.toLocaleString()} バイトまで）`);
};

/** 入力を確かめる（親でも子でも。知らないキー、併せて渡せないもの、長さ。決まった文の InputError） */
export function validateTryInput(v: unknown): TryInput {
  if (!v || typeof v !== "object" || Array.isArray(v)) bad("try の入力はオブジェクト");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) bad(`知らないキー: ${k}`);
  const app = tryApp(o.app === undefined ? "formula-sample" : String(o.app));
  const targets = ["records", "rows", "count"].filter((k) => o[k] !== undefined);
  if (targets.length > 1) bad(`records・rows・count は 1 つだけ（${targets.join("・")}）`);
  if (o.records !== undefined) {
    const r = o.records;
    if (!Array.isArray(r) || r.length === 0 || r.length > app.records.length || !r.every((n) => isInt(n) && n >= 1 && n <= app.records.length) || new Set(r).size !== r.length) {
      bad(`records は 1〜${app.records.length} の番号を重ならずに 1〜${app.records.length} 個`);
    }
  }
  if (o.rows !== undefined && !isInt(o.rows)) bad("rows は整数");
  if (o.count !== undefined && (!isInt(o.count) || o.count < 1 || o.count > MAX_COUNT)) bad(`count は 1〜${MAX_COUNT}`);
  if (o.rows !== undefined && !app.rowsTable) bad(`お試しアプリ ${app.key} では rows を使えない（quote / gantt）`);
  if (o.count !== undefined && !app.count) bad(`お試しアプリ ${app.key} では count を使えない（list）`);
  const modes = ["formulas", "button"].filter((k) => o[k] !== undefined);
  if (modes.length !== 1) bad("formulas と button のどちらか 1 つ");
  if (o.formulas !== undefined) {
    const f = o.formulas;
    if (!Array.isArray(f) || f.length === 0 || f.length > TRY_MAX_FORMULAS) bad(`formulas は 1〜${TRY_MAX_FORMULAS} 個`);
    (f as unknown[]).forEach((x, i) => {
      if (!x || typeof x !== "object" || Array.isArray(x)) bad(`formulas[${i}] はオブジェクト（{ formula, table? }）`);
      const e = x as Record<string, unknown>;
      for (const k of Object.keys(e)) if (k !== "formula" && k !== "table") bad(`formulas[${i}] の知らないキー: ${k}`);
      if (typeof e.formula !== "string" || !e.formula.trim()) bad(`formulas[${i}].formula は空でない文字列`);
      checkBytes(e.formula, `formulas[${i}].formula`, TRY_MAX_FORMULA_BYTES);
      if (e.table !== undefined && !tableCodes(app).includes(String(e.table))) bad(`formulas[${i}].table はお試しアプリ ${app.key} のテーブルのコード（${tableCodes(app).join(" / ") || "無し"}）`);
    });
  }
  if (o.button !== undefined) {
    const b = o.button;
    if (!b || typeof b !== "object" || Array.isArray(b)) bad("button はオブジェクト");
    const e = b as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!BUTTON_KEYS.includes(k)) bad(`button の知らないキー: ${k}`);
    if (typeof e.html !== "string") bad("button.html は文字列（HTML 欄。計算式だけでページを作るなら空の文字列）");
    checkBytes(e.html, "button.html", TRY_MAX_HTML_BYTES);
    checkBytes(e.css, "button.css", TRY_MAX_CSS_BYTES);
    for (const k of ["bodyFormula", "fileNameFormula", "displayCondition"]) checkBytes(e[k], `button.${k}`, TRY_MAX_FORMULA_BYTES);
    for (const k of ["pageSize", "orientation", "dpi"]) if (e[k] !== undefined && typeof e[k] !== "string") bad(`button.${k} は文字列`);
    if (e.list !== undefined && typeof e.list !== "boolean") bad("button.list は真偽");
  }
  return o as TryInput;
}

/** お試しアプリのテーブルのコード（テーブルと、関連レコード一覧の仮のテーブル） */
function tableCodes(app: TryApp): string[] {
  const subtables = Object.values(app.fields.properties).filter((p) => p.type === "SUBTABLE").map((p) => p.code);
  const related = Object.keys((app.fields as { related?: Record<string, unknown> }).related ?? {});
  return [...subtables, ...related];
}

interface Target {
  label: string;
  key: string;
  record: KintoneRecord;
  list?: KintoneRecord[];
}

/** 対象のレコード */
function targetsOf(app: TryApp, input: TryInput, listMode: boolean): Target[] {
  if (input.count !== undefined) {
    const recs = withCount(app, input.count);
    return [{ label: `一覧 ${input.count} 件`, key: "list", record: { ...structuredClone(recs[0]), $records: recs } as unknown as KintoneRecord, list: recs }];
  }
  const fixed = input.rows !== undefined ? [{ label: `レコード 1（${app.rowsTable!.code} ${input.rows} 行）`, key: "rows", record: withRows(app, input.rows) }] : (input.records ?? app.records.map((_, i) => i + 1)).map((n) => ({ label: `レコード ${n}`, key: String(n), record: fixedRecord(app, n) }));
  if (!listMode) return fixed;
  const recs = fixed.map((t) => t.record);
  return [{ label: `一覧（${fixed.map((t) => t.label).join("、")}）`, key: "list", record: { ...structuredClone(recs[0]), $records: recs } as unknown as KintoneRecord, list: recs }];
}

const NOTES = [
  "お試しアプリ（架空の値）で試した結果。項目コードはお試しアプリのもので、利用者の設定に書かない",
  "ユーザー情報は既定のテストデータ（架空の 10 人。ログインユーザーは authoring）",
  "ページはテンプレートや式がページの要素（rex0220-pcraft-page）を作ったときだけ分かれる。行が 1 ページに収まるか・はみ出すかは分からない（印刷屋の PDF で確かめる）"
];

type Api = Engine["api"] & {
  evaluate: (kf: unknown, formula: string) => unknown;
  formulaOf?: unknown;
  RELATED_LIMIT?: number;
  DEFAULT_FILE_NAME?: string;
};

/** 評価のエラーの文（Ver.8 までの zip の M_* / R_* には Ver.9 から使えることを添える。4.4） */
function errorText(e: unknown, pluginVersion: string): string {
  const text = evaluationErrorText(e);
  const hint = sinceV9Hint(text, pluginVersion);
  return cutText(hint ? `${text}（${hint}）` : text, TRY_MAX_ERROR_CHARS);
}

function evalValue(api: Api, kf: unknown, formula: string, pluginVersion: string): Omit<TryValue, "target" | "row"> {
  let v: unknown;
  try {
    v = api.evaluate(kf, formula);
  } catch (e) {
    return { evaluationError: errorText(e, pluginVersion) };
  }
  try {
    const text = v == null ? "" : String(v);
    if (byteLength(text) > TRY_MAX_VALUE_BYTES) return { tooLarge: true };
    const raw = toJsonSafe(v);
    return typeof raw === "string" && raw === text ? { text } : { text, raw };
  } catch {
    return { convertFailed: true };
  }
}

/** 1 ボタンの設定（封筒形式）を組む */
function trySettings(api: Api, app: TryApp, b: TryButton): string {
  return JSON.stringify({
    date: "2026-01-15 00:00:00",
    pluginName: "印刷屋プラグイン",
    pluginID: api.pluginId,
    PluginVersion: String(api.pluginVersion),
    appId: app.fields.appId,
    appName: app.fields.appName,
    pluginEnable: true,
    commonCssEnable: false,
    externalRefs: "block",
    pluginInfos: [
      {
        state: true,
        menu: "お試し",
        desc: "",
        list: b.list === true,
        viewsCsv: b.list ? "" : "-",
        tagsInfo: {
          fieldsInfo: [
            { state: b.displayCondition !== undefined && b.displayCondition !== "", desc: "ボタン表示条件", fieldcode: "$out", formulaSet: b.displayCondition ?? "" },
            { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: b.fileNameFormula ?? '"お試し.pdf"' },
            { state: true, desc: "本文", css: b.css ?? "", html: b.html, formulaSet: b.bodyFormula ?? "" }
          ],
          filecode: "",
          pageSize: b.pageSize ?? "A4",
          orientation: b.orientation ?? "p",
          dpi: b.dpi ?? "96",
          printMode: "preview"
        },
        calcInfo: { fieldsInfo: [] }
      }
    ]
  });
}

/** 描いた帳票（inner）からページごとの文字（空白を詰める） */
function pageTextsOf(engine: Engine, inner: string): TryPageText[] {
  const W = engine.window as unknown as { DOMParser: new () => { parseFromString(s: string, t: string): Document } };
  const doc = new W.DOMParser().parseFromString(inner, "text/html");
  return Array.from(doc.querySelectorAll(".rex0220-pcraft-page")).map((el, i) => {
    const full = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const hasError = !!el.querySelector(".pcraft-authoring-error");
    return full.length > TRY_MAX_PAGE_CHARS ? { page: i + 1, text: full.slice(0, TRY_MAX_PAGE_CHARS), cutChars: full.length - TRY_MAX_PAGE_CHARS, ...(hasError ? { hasError } : {}) } : { page: i + 1, text: full, ...(hasError ? { hasError } : {}) };
  });
}

/** 返すページを選ぶ（先頭 → 最後 → エラーのあるページを番号の順。budget は文字数） */
function pickPages(all: TryPageText[], budget: number): { pages: TryPageText[]; omitted: number[] } {
  const order: number[] = [];
  const add = (i: number): void => {
    if (i >= 0 && i < all.length && !order.includes(i)) order.push(i);
  };
  add(0);
  add(all.length - 1);
  all.forEach((p, i) => p.hasError && add(i));
  const picked: number[] = [];
  let used = 0;
  for (const i of order) {
    const n = JSON.stringify(all[i]).length;
    if (picked.length > 0 && used + n > budget) continue;
    picked.push(i);
    used += n;
  }
  picked.sort((a, b) => a - b);
  return { pages: picked.map((i) => all[i]), omitted: all.map((_, i) => i).filter((i) => !picked.includes(i)).map((i) => i + 1) };
}

/** 結果を TRY_MAX_RESULT_CHARS に収める（4.2 の削る順: ページの文字 → 生の値 → エラーの無いページ → エラーの文を 200 字。場所・件数・省いた印は残す） */
function fit(result: TryResult): TryResult {
  const size = (): number => JSON.stringify(result).length;
  const cut: string[] = [];
  if (size() <= TRY_MAX_RESULT_CHARS) return result;
  if (result.button) {
    // ページの文字: 1 つのボタンの結果あたりの予算で選び直す
    const budget = Math.max(1_000, Math.floor(TRY_MAX_RESULT_CHARS / Math.max(1, result.button.results.length)) - 1_500);
    for (const r of result.button.results) {
      const all = [...r.pageTexts];
      const { pages, omitted } = pickPages(all, budget);
      r.pageTexts = pages;
      if (omitted.length) r.pagesOmitted = [...(r.pagesOmitted ?? []), ...omitted].sort((a, b) => a - b);
    }
    cut.push("ページの文字を選んだ（先頭・最後・エラーのあるページ）");
  }
  if (size() > TRY_MAX_RESULT_CHARS && result.formulas) {
    for (const f of result.formulas) for (const v of f.values) delete v.raw;
    cut.push("生の値（raw）を省いた");
  }
  if (size() > TRY_MAX_RESULT_CHARS && result.button) {
    for (const r of result.button.results) {
      const keep = r.pageTexts.filter((p) => p.hasError);
      const drop = r.pageTexts.filter((p) => !p.hasError).map((p) => p.page);
      r.pageTexts = keep;
      if (drop.length) r.pagesOmitted = [...(r.pagesOmitted ?? []), ...drop].sort((a, b) => a - b);
    }
    cut.push("エラーの無いページの文字を省いた");
  }
  if (size() > TRY_MAX_RESULT_CHARS) {
    for (const f of result.formulas ?? []) for (const v of f.values) if (v.evaluationError) v.evaluationError = cutText(v.evaluationError, 200);
    for (const r of result.button?.results ?? []) r.errors = r.errors.map((e) => cutText(e, 200));
    cut.push("エラーの文を 200 字に切った");
  }
  if (size() > TRY_MAX_RESULT_CHARS) {
    for (const f of result.formulas ?? []) {
      const total = f.values.length;
      while (f.values.length > 1 && JSON.stringify(result).length > TRY_MAX_RESULT_CHARS) f.values.pop();
      if (f.values.length < total) f.rowsOmitted = (f.rowsOmitted ?? 0) + (total - f.values.length);
    }
    for (const r of result.button?.results ?? []) {
      const total = r.errors.length;
      while (r.errors.length > 0 && JSON.stringify(result).length > TRY_MAX_RESULT_CHARS) r.errors.pop();
      if (r.errors.length < total) cut.push(`${r.target} のエラーの文 ${total - r.errors.length} 件を省いた（件数は errorCount）`);
    }
    cut.push("値・エラーの文を後ろから省いた");
  }
  result.cut = cut;
  return result;
}

/**
 * 式を対象のレコードで評価する（try の formulas。table を付けた式はその行ごと、20 行まで）。値はエンジンが式の評価として返したもの（4.5）。
 * scripts/verify-patterns.mjs も同じ評価で資料（docs/計算パターン.md）の例を確かめる（架空の値のレコードを作って渡す）
 */
export function evaluateTryFormulas(engine: Engine, ppRun: unknown, targets: ReadonlyArray<{ label: string; record: KintoneRecord }>, formulas: readonly TryFormula[]): TryFormulaResult[] {
  const api = engine.api as Api;
  const version = engine.source.pluginVersion;
  return formulas.map((f) => {
    const out: TryFormulaResult = { formula: cutText(f.formula, 200), ...(f.table ? { table: f.table } : {}), values: [] };
    for (const t of targets) {
      if (!f.table) {
        out.values.push({ target: t.label, ...evalValue(api, engine.runner(ppRun, structuredClone(t.record)), f.formula, version) });
        continue;
      }
      const rows = ((t.record as Record<string, { value?: unknown[] }>)[f.table]?.value ?? []).length;
      const kf = engine.runner(ppRun, structuredClone(t.record)) as unknown as { initTableInfo?: (c: string) => void; currRow?: (r: number) => unknown };
      kf.initTableInfo?.(f.table);
      for (let r = 0; r < Math.min(rows, TRY_MAX_TABLE_ROWS); r++) {
        if (r > 0) kf.currRow?.(r);
        out.values.push({ target: t.label, row: r + 1, ...evalValue(api, kf, f.formula, version) });
      }
      if (rows > TRY_MAX_TABLE_ROWS) out.rowsOmitted = (out.rowsOmitted ?? 0) + rows - TRY_MAX_TABLE_ROWS;
      if (rows === 0) out.values.push({ target: t.label, row: 0, text: "（テーブルの行が無い）" });
    }
    return out;
  });
}

/** お試しアプリで試す（評価の子プロセスの中で。users は既定のテストデータを入れてから呼ぶ） */
export async function runTry(engine: Engine, raw: unknown, baseUrl?: string): Promise<TryOutcome> {
  const input = validateTryInput(raw);
  const app = tryApp(input.app ?? "formula-sample");
  const api = engine.api as Api;
  const limit = typeof api.RELATED_LIMIT === "number" ? api.RELATED_LIMIT : 1000;
  const listMode = input.button?.list === true;
  const targets = targetsOf(app, input, listMode);
  const result: TryResult = { app: app.key, title: app.title, mode: input.formulas ? "formulas" : "button", targets: targets.map((t) => t.label), notes: [...NOTES] };
  const files: TryOutcome["files"] = [];
  // 印刷屋と同じく、関連レコード一覧の仮のテーブルが上限を超えたら帳票を作らない（式も評価しない）
  const usable = targets.filter((t) => {
    const over = relatedOverLimit(app, t.record, limit);
    if (!over.length) return true;
    (result.refused ??= []).push(...over.map((o) => ({ target: t.label, code: "related.tooMany" as const, message: `関連レコード一覧 ${o.parent} のレコードが ${o.rows.toLocaleString()} 件（印刷屋は ${limit.toLocaleString()} 件まで。超えると帳票を作らない）` })));
    if (input.button) files.push({ key: t.key });
    return false;
  });
  const model = buildModel(app.fields, api, baseUrl);
  engine.setContext({ baseUrl: model.baseUrl || DEFAULT_CONTEXT_BASE_URL, appId: app.fields.appId });

  if (input.formulas) {
    result.formulas = evaluateTryFormulas(engine, model.ppRun, usable, input.formulas);
    return { result: fit(result), files };
  }

  const b = input.button!;
  const settingsText = trySettings(api, app, b);
  const button: NonNullable<TryResult["button"]> = { findings: [], results: [] };
  result.button = button;
  const seen = new Set<string>();
  for (const t of usable) {
    const res = await runPreview({
      settingsText,
      settingsFile: `try/${app.key}.json`,
      fields: app.fields,
      recordFile: { record: listMode ? t.list![0] : t.record },
      engine,
      policy: { allowExternal: [] },
      baseUrl,
      ...(listMode ? { listRecords: t.list!.map((r) => ({ record: r })) } : {}),
      renderLimits: { maxValueBytes: TRY_MAX_VALUE_BYTES, maxTotalBytes: TRY_MAX_HTML_OUT_BYTES }
    });
    for (const f of res.findings.items) {
      const k = JSON.stringify(f);
      if (!seen.has(k)) {
        seen.add(k);
        button.findings.push(f);
      }
    }
    if (res.findings.hasErrors) break;
    const r = res.results[0];
    if (!r) continue;
    const kf = (): unknown => engine.runner(model.ppRun, structuredClone(t.record));
    // ファイル名: 印刷屋の fileNameOf は例外を握って既定の名前にするので、評価のエラーは別に取る（4.2、Codex r2 M2）
    let fileName: TryButtonTarget["fileName"] = { value: r.fileName };
    if (b.fileNameFormula) {
      try {
        api.evaluate(kf(), b.fileNameFormula);
      } catch (e) {
        fileName = { value: r.fileName, usedDefault: true, evaluationError: errorText(e, engine.source.pluginVersion) };
      }
    }
    // ボタン表示条件: 一覧帳票は印刷屋が評価しない。詳細画面は評価の結果の真偽、例外なら印刷屋と同じく出す
    let displayCondition: TryButtonTarget["displayCondition"];
    if (listMode) displayCondition = { applied: false };
    else if (!b.displayCondition) displayCondition = { applied: true, set: false, shown: true };
    else {
      try {
        const v = api.evaluate(kf(), b.displayCondition);
        displayCondition = { applied: true, set: true, shown: !!v, value: cutText(v == null ? "" : String(v), 200) };
      } catch (e) {
        displayCondition = { applied: true, set: true, shown: true, evaluationError: errorText(e, engine.source.pluginVersion) };
      }
    }
    const htmlTooLarge = byteLength(r.inner) > TRY_MAX_HTML_OUT_BYTES;
    button.results.push({
      target: t.label,
      key: t.key,
      pages: r.pages,
      pageTexts: pageTextsOf(engine, r.inner),
      errors: r.errors.map((e) => {
        const hint = renderErrorHint(e, engine.source.pluginVersion);
        return cutText(hint ? `${e}（${hint}）` : e, TRY_MAX_ERROR_CHARS);
      }),
      errorCount: r.errors.length,
      fileName,
      displayCondition,
      ...(htmlTooLarge ? { htmlTooLarge } : {})
    });
    files.push(htmlTooLarge ? { key: t.key } : { key: t.key, menu: r.menu, html: r.html, inner: r.inner });
  }
  return { result: fit(result), files };
}

export { TRY_APP_KEYS };
