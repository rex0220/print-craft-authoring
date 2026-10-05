/**
 * 正規化した設定の検査（docs/authoring-plan.md 12.3）。派生値は derive.ts が作った後に呼ぶ。列挙の定数は印刷屋の API から。
 * 1-10 レビューと再レビューで足したこと:
 *   - `isSafeExpression` は式全体を見る（"ESC_HTML(x) & HTML(…)" を安全にしない。& でつないだ項がすべて安全なら安全。REPLACE の置換文字列は <br> か記号無しの定数だけ）
 *   - HTML 設定の 1 行目 $out / 2 行目 $fname の欠落、有効なボタンの HTML 設定の欠落、有効なボタン名の重複はエラー
 * 2026-10-04 Takashi「ver.6 にチェックを組み込めばよい」: kintone 以外への読み込みとスクリプトは印刷屋 Ver.6 が描画の前に除く（共通の設定「外部参照」externalRefs = "block"。
 * print-craft の src/shared/sanitize.ts）。計算式が作る HTML を tools の静的検査で止め切れない（Codex レビュー 5 回）ので、止めるのは本体、tools は次の分担にした:
 *   - externalRefs が "allow"（Ver.5 と同じく何も除かない。自己責任）は、利用者が policy/authoring-policy.json の allowExternalRefs にその設定ファイルを
 *     書いていなければエラー。キーが無い設定（Ver.5 のエクスポート）は印刷屋が "allow" として動かすので derive.ts が "allow" を明示する（同じ承認が要る）
 *   - "block" の設定の HTML / CSS のテンプレートにある外部 URL はエラー（印刷屋が除くので帳票に出ない。添付ファイルか data:image にする）。
 *     "allow" の設定では policy の allowExternal で承認（承認済みは情報、無ければ警告）
 *   - Web フォント（fontInfo.cssUrl）は印刷屋が除かないので、外部参照の設定に関わらず policy の allowExternal で承認（Google Fonts は既定で承認）
 *   - 帳票の行の計算式が作る HTML は警告だけ: HTML を作る関数の名前、TAG の要素名や ATTR / STYLE / BATTR の値が定数でない、
 *     文字列の定数に HTML / CSS があれば HTML / CSS と同じ検査を警告として出す（外部 URL は "block" なら「除かれる」警告、"allow" なら承認の対象）
 */
import type { Findings } from "./findings.ts";
import { fieldExists, UOG_MARK, type Model } from "./model.ts";
import { rowLabel, tagRowLabel } from "./derive.ts";
import { checkCss } from "./css-check.ts";
import { checkHtml, expressionsOf } from "./html-check.ts";
import { isAllowed, isExternalRefsAllowed, type Policy } from "./policy.ts";
import type { MenuRow, CssRow, TagRow } from "print-craft/src/config/schema.ts";

export interface CheckOptions {
  policy: Policy;
  /** cwd からの相対パス（policy の files / allowExternalRefs と照合） */
  settingsFile?: string;
}

/** 共通の設定「外部参照」（印刷屋 Ver.6 の shared/external-refs.ts と同じ値） */
export type ExternalRefs = "block" | "allow";
export const EXTERNAL_REFS: readonly ExternalRefs[] = ["block", "allow"];

interface Ctx extends CheckOptions {
  mode: ExternalRefs;
  /** .env の KINTONE_BASE_URL（検証済み）。iframe の同一オリジンの判定 */
  baseUrl?: string;
}

/** HTML を作る・入れる関数（結果が HTML としてそのまま帳票に入る。差分で人が見る対象） */
const RAW_HTML_FUNCTIONS = ["HTML", "FVAL", "TABLE_HTML", "RECS_HTML", "FIELDS_HTML", "PAGE_HTML", "TAGS_HTML", "UNESC_HTML", "ADD_TAGS", "TAG", "VTAG", "ATTR", "BATTR", "STYLE"];
/** 値に HTML の記号が入りえない項目の型（数値・日付・時刻・システム項目） */
const SAFE_VALUE_TYPES = new Set(["NUMBER", "CALC", "DATE", "DATETIME", "TIME", "CREATED_TIME", "UPDATED_TIME", "RECORD_NUMBER", "__REVISION__", "__ID__"]);
/** 数値・日付の項目を整える関数（引数の項目が安全な型なら結果も安全） */
const FORMAT_FUNCTIONS = new Set(["FVAL", "DATE_FORMAT", "DATE_ADD", "YEN", "FIXED", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "FLOOR", "CEIL", "ABS", "FSIZE", "DURATION_FORMAT", "TODAY", "NOW"]);

const STRING_LITERAL = /^"(?:[^"\\]|\\.)*"$/s;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
/** HTML の記号を含まない文字列の定数 */
const isPlainLiteral = (s: string): boolean => STRING_LITERAL.test(s) && !/[<>&"']/.test(s.slice(1, -1));
/** REPLACE の置換に使える定数: 記号無し、または <br> */
const isSafeReplacement = (s: string): boolean => isPlainLiteral(s) || /^"<br\s*\/?>"$/i.test(s);
/** REPLACE の検索に使える値: 文字列の定数か NEWLINE()（改行は NEWLINE() で書く。"\n" は \ と n の 2 文字） */
const isSafeSearch = (s: string): boolean => STRING_LITERAL.test(s) || /^NEWLINE\(\s*\)$/.test(s);

/**
 * 文字列の定数の中の \n / \r / \t（2026-10-05）。実エンジンは " のエスケープ（\"）しか解釈しないので、"\n" は改行でなく \ と n の 2 文字で、
 * REPLACE(ESC_HTML(備考), "\n", "<br>") は何も置き換えない（試用の納品書で発覚。文書と samples がこの形を勧めていた）。改行は NEWLINE()
 */
export function backslashEscapes(formula: string): string[] {
  return [...new Set([...formula.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[0]).filter((lit) => /\\[nrt]/.test(lit)))];
}

/** 最上位の区切り文字（, や &）で分ける（文字列と括弧の中は分けない）。括弧や引用符が合わなければ null */
export function splitTopLevel(s: string, sep = ","): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) {
        cur += s[++i];
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth < 0) return null;
    }
    if (c === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (depth !== 0 || quote) return null;
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out;
}

/** 式全体が 1 つの関数呼び出し NAME(args) か（"A(1) & B(2)" は違う） */
export function parseCall(e: string): { name: string; args: string[] } | null {
  const m = e.match(/^([A-Z_][A-Z0-9_]*)\s*\(([\s\S]*)\)$/);
  if (!m) return null;
  const args = splitTopLevel(m[2]);
  if (!args) return null;
  return { name: m[1], args: args.length === 1 && args[0] === "" ? [] : args };
}

/**
 * 文字列の定数の中に // があるか。印刷屋の stripComments（load.ts）は文字列を見ずに // 以降を行末まで捨てるので、
 * "https://…" のような文字列は設定画面でもデスクトップでも壊れる（印刷屋の仕様。URL は HTML の属性か ##目印## に置く）。
 * 文字列の規則は実エンジンの p.dq と同じ: 二重引用符だけ、直前に \ がある " はエスケープ（\\" も閉じない）、' は文字
 */
export function commentInsideString(formulaSet: string): boolean {
  let inString = false;
  for (let i = 0; i < formulaSet.length; i++) {
    const c = formulaSet[i];
    if (inString) {
      if (c === "\\" && formulaSet[i + 1] === '"') i++;
      else if (c === '"') inString = false;
      else if (c === "/" && formulaSet[i + 1] === "/") return true;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "/" && formulaSet[i + 1] === "/") {
      // 文字列の外の // はコメント。行末まで飛ばす
      const nl = formulaSet.indexOf("\n", i);
      if (nl < 0) return false;
      i = nl;
    }
  }
  return false;
}

/** 式の中の文字列の定数（"…" と '…'。エスケープは外す） */
export function stringLiterals(formula: string): string[] {
  return [...formula.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1"));
}

/** 式の中の NAME(...) の呼び出しをすべて見つけ、引数を最上位のカンマで分けて返す（入れ子も見る） */
export function callsOf(formula: string, name: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let quote: string | null = null;
    const start = i;
    for (; i < formula.length; i++) {
      const c = formula[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const args = splitTopLevel(formula.slice(start, i));
    if (args) out.push(args.length === 1 && args[0] === "" ? [] : args);
  }
  return out;
}

/** 安全な型の項目と数と算術演算子だけの式か（FVAL(合計 * 1.1) など）。整える関数の入れ子（DATE_ADD(見積日, 1, "days")）も許す */
function isNumericSafe(arg: string, pp: Record<string, { type: string }>): boolean {
  const a = arg.trim();
  if (!a) return false;
  const call = parseCall(a);
  if (call && FORMAT_FUNCTIONS.has(call.name)) return isSafeExpression(a, pp);
  const tokens = a.match(/[\p{L}_$][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|[+\-*/()]|\s+|[\s\S]/gu) ?? [];
  for (const t of tokens) {
    if (/^\s+$/.test(t) || /^[+\-*/()]$/.test(t) || NUMBER_LITERAL.test(t)) continue;
    if (IDENT.test(t)) {
      if (!SAFE_VALUE_TYPES.has(pp[t]?.type ?? "")) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * HTML の ${式} が安全な差し込みか（12.3 の html.rawExpression）。式**全体**が次のどれか（& でつないだ項はすべてがこれなら安全）:
 *   ESC_HTML(…)、REPLACE(ESC_HTML(…), NEWLINE() か "文字列", "<br>" か記号無しの文字列)、数値・日付の項目そのもの、数値・日付の項目（と算術・整える関数の入れ子）を
 *   整える関数（FVAL(合計) など。残りの引数は記号無しの文字列や数の定数）、TODAY() / NOW()、数の定数、HTML の記号を含まない文字列の定数
 * それ以外（文字列系の項目、FVAL(文字列項目)、HTML(…)、記号を含む定数）は警告
 */
export function isSafeExpression(expr: string, pp: Record<string, { type: string }>): boolean {
  const e = expr.trim();
  if (!e) return false;
  const terms = splitTopLevel(e, "&");
  if (terms && terms.length > 1) return terms.every((t) => t !== "" && isSafeExpression(t, pp));
  if (NUMBER_LITERAL.test(e)) return true;
  if (STRING_LITERAL.test(e)) return isPlainLiteral(e);
  if (IDENT.test(e)) return SAFE_VALUE_TYPES.has(pp[e]?.type ?? "");
  const call = parseCall(e);
  if (!call) return false;
  if (call.name === "ESC_HTML") return call.args.length >= 1;
  if (call.name === "REPLACE") return call.args.length === 3 && parseCall(call.args[0])?.name === "ESC_HTML" && isSafeSearch(call.args[1]) && isSafeReplacement(call.args[2]);
  if (FORMAT_FUNCTIONS.has(call.name)) {
    if (call.name === "TODAY" || call.name === "NOW") return call.args.length === 0;
    if (call.args.length === 0 || !isNumericSafe(call.args[0], pp)) return false;
    return call.args.slice(1).every((a) => (STRING_LITERAL.test(a) ? !/[<>&]/.test(a) : NUMBER_LITERAL.test(a)));
  }
  return false;
}

/** policy の allowExternal で承認する外部 URL（"allow" の設定の HTML / CSS と、外部参照の設定に関わらず Web フォント） */
function approvedFinding(f: Findings, opt: CheckOptions, where: string, url: string, via: string): void {
  if (isAllowed(opt.policy, url, opt.settingsFile)) {
    f.info("external.allowed", where, `外部の URL（承認済み）: ${url}（${via}）`);
  } else {
    f.warning("external.url", where, `外部の URL: ${url}（${via}）。利用者が承認するなら policy/authoring-policy.json の allowExternal に origin か url を書く（AI は書かない）`);
  }
}

/**
 * 帳票の HTML / CSS の外部 URL。
 *   "block"（印刷屋が描画の前に除く）: HTML / CSS のテンプレートの URL はエラー（帳票に出ない）。計算式の文字列の URL は警告（帳票に入るかは静的に確かでない）
 *   "allow": 利用者の承認（policy の allowExternal）。承認済みは情報、無ければ警告
 */
function externalFinding(f: Findings, ctx: Ctx, where: string, url: string, via: string, certain = true): void {
  if (ctx.mode === "block") {
    const msg = `外部の URL: ${url}（${via}）。外部参照が「除く」（externalRefs: "block"）の設定では、印刷屋は描画の前に kintone 以外への読み込みを除くので帳票に出ない。添付ファイルの #{&f(…)} か data:image/ にする。外部をそのまま使うなら、利用者が externalRefs を "allow" にして policy/authoring-policy.json の allowExternalRefs にこの設定ファイルを書く（AI は書かない）`;
    if (certain) f.error("external.blocked", where, msg);
    else f.warning("external.blocked", where, `${msg}。計算式の文字列なので警告（帳票に入れば除かれる）`);
    return;
  }
  approvedFinding(f, ctx, where, url, via);
}

/** 計算式（formulaSet と HTML の ${式}）の文字列の \n などを警告する（formula.escape） */
function escapeFinding(f: Findings, where: string, formulas: string[]): void {
  const lits = [...new Set(formulas.flatMap(backslashEscapes))];
  if (lits.length) f.warning("formula.escape", where, `計算式の文字列は \\ を解釈しない: ${lits.slice(0, 3).join(" ")}（"\\n" は改行でなく \\ と n の 2 文字なので、REPLACE(…, "\\n", "<br>") は何も置き換えない）。改行は NEWLINE()（例 REPLACE(ESC_HTML(備考), NEWLINE(), "<br>")）`);
}

const HTML_LIKE = /<\s*[a-zA-Z!/]/;
const CSS_LIKE = /url\s*\(|@import|image-set\s*\(|expression\s*\(|behavior\s*:/i;

/**
 * 帳票の行の計算式が HTML を作る経路の検査（警告だけ。止めるのは印刷屋の描画前の掃除）:
 *   1. HTML を作る関数の名前（差分で人が見る）
 *   2. TAG / VTAG の要素名、ATTR / STYLE の名前と値、BATTR の属性名が定数でない（レコードの値や式。印刷屋は外部 URL と on 属性を除くが、属性の崩れは防げない）
 *   3. 文字列の定数に HTML や url( があれば、HTML / CSS のテンプレートと同じ検査を警告として出す（禁止の要素・属性、URL の形、外部 URL）
 */
async function checkFormulaHtml(formula: string, where: string, f: Findings, ctx: Ctx): Promise<void> {
  const raw = RAW_HTML_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(formula));
  if (raw.length) f.warning("formula.rawHtml", where, `HTML を作る・入れる関数: ${raw.join(", ")}（結果がそのまま帳票の HTML になる。印刷屋が描画の前に外部への読み込みとスクリプトを除くが、崩れは防げない。差分で人が見る）`);
  const dynamic: string[] = [];
  for (const name of ["TAG", "VTAG"]) {
    for (const args of callsOf(formula, name)) if (args[0] !== undefined && !STRING_LITERAL.test(args[0])) dynamic.push(`${name} の要素名 ${args[0]}`);
  }
  for (const name of ["ATTR", "STYLE"]) {
    for (const args of callsOf(formula, name)) {
      args.forEach((a, i) => {
        if (a !== "" && !STRING_LITERAL.test(a)) dynamic.push(`${name} の${i % 2 === 0 ? "名前" : "値"} ${a}`);
      });
    }
  }
  for (const args of callsOf(formula, "BATTR")) for (const a of args) if (a !== "" && !STRING_LITERAL.test(a)) dynamic.push(`BATTR の属性名 ${a}`);
  if (dynamic.length) {
    const shown = [...new Set(dynamic)];
    f.warning("formula.attr", where, `要素名や属性にレコードの値や式を入れている: ${shown.slice(0, 5).join(" / ")}${shown.length > 5 ? ` 他 ${shown.length - 5}` : ""}（定数だけにする。印刷屋は描画の前に外部 URL と on 属性を除くが、属性の崩れは防げない）`);
  }
  const seen = new Set<string>();
  for (const lit of stringLiterals(formula)) {
    if (seen.has(lit)) continue;
    seen.add(lit);
    if (HTML_LIKE.test(lit)) {
      const h = await checkHtml(lit, { baseUrl: ctx.baseUrl });
      for (const e of h.errors) f.warning("formula.html", where, `計算式の文字列の HTML: ${e}（印刷屋が描画の前に外部への読み込みとスクリプトを除く。差分で人が見る）`);
      for (const u of h.externals) externalFinding(f, ctx, where, u.url, `計算式の文字列 ${u.via}`, false);
    } else if (CSS_LIKE.test(lit)) {
      const c = checkCss(/[{}]/.test(lit) ? lit : `x{${lit}}`);
      for (const e of c.errors) f.warning("formula.html", where, `計算式の文字列の CSS: ${e}（印刷屋が描画の前に外部への読み込みを除く）`);
      for (const u of c.externals) externalFinding(f, ctx, where, u.url, `計算式の文字列 CSS ${u.via}`, false);
    }
  }
}

export async function checkBody(body: Record<string, unknown>, model: Model, f: Findings, opt: CheckOptions): Promise<void> {
  const { PAPER_NAMES, PAGE_SIZES, DPI_OPTIONS, PRINT_MODES } = model.api;
  const rows = (body.pluginInfos ?? []) as MenuRow[];
  const pp = model.pp as Record<string, { type: string }>;
  // ---- 外部参照（共通の設定。derive.ts がキーの無い設定に "allow" を明示している） ----
  const ext = body.externalRefs;
  const mode: ExternalRefs = ext === "allow" ? "allow" : "block";
  const ctx: Ctx = { ...opt, mode, baseUrl: model.baseUrl || undefined };
  if (ext !== "block" && ext !== "allow") {
    f.error("externalRefs.value", "共通の設定", `externalRefs は "block"（印刷屋が描画の前に kintone 以外への読み込みとスクリプトを除く）か "allow"（何も除かない。自己責任）: ${JSON.stringify(ext)}`);
  } else if (ext === "allow") {
    if (isExternalRefsAllowed(opt.policy, opt.settingsFile)) {
      f.info("externalRefs.allowed", "共通の設定", `外部参照は「許可」（利用者が policy/authoring-policy.json の allowExternalRefs で承認済み）。印刷屋は帳票の HTML / CSS から何も除かない（Ver.5 と同じ。自己責任）。外部の URL は allowExternal で承認する`);
    } else {
      f.error("externalRefs.unapproved", "共通の設定", `外部参照が「許可」（externalRefs: "allow"。キーが無い Ver.5 の設定も印刷屋は許可で動く）。印刷屋は帳票の HTML / CSS から kintone 以外への読み込みとスクリプトを除かない（自己責任）ので利用者の承認が要る: 利用者が policy/authoring-policy.json の allowExternalRefs にこの設定ファイル（${opt.settingsFile ?? "ファイル名が分からない"}）を書く（AI は書かない）。新しい設定は "block"（描画の前に除く）を明示する`);
    }
  }
  // ---- 共通 CSS ----
  for (const [i, c] of ((body.cssInfo ?? []) as CssRow[]).entries()) {
    if (!c.state || !c.css) continue;
    const where = `共通 CSS ${i + 1} 行目 (${c.name})`;
    const r = checkCss(c.css);
    for (const e of r.errors) f.error("css.rule", where, e);
    for (const u of r.externals) externalFinding(f, ctx, where, u.url, `CSS ${u.via}`);
  }
  // ---- Web フォント（印刷屋は除かないので、外部参照の設定に関わらず承認の対象） ----
  const font = body.fontInfo as { enabled?: boolean; cssUrl?: string } | undefined;
  if (font?.enabled && font.cssUrl) {
    if (!/^https:\/\//.test(font.cssUrl)) f.error("font.url", "Web フォント", `cssUrl は https の URL: ${font.cssUrl.slice(0, 80)}`);
    else approvedFinding(f, opt, "Web フォント", font.cssUrl, "fontInfo.cssUrl");
  }
  // ---- ボタンごと ----
  const seenMenus = new Map<string, number>();
  for (const [i, row] of rows.entries()) {
    const label = rowLabel(row, i);
    if (row.state) {
      const prev = seenMenus.get(row.menu);
      if (prev !== undefined) f.error("menu.duplicate", label, `有効なボタンの名前が ${prev + 1} 番目と同じ: ${row.menu}（diff と preview の出力が区別できない。名前を変える）`);
      else seenMenus.set(row.menu, i);
    }
    const tags = row.tagsInfo;
    if (!tags) {
      if (row.state) f.error("tags.rows", label, "有効なボタンに HTML 設定（tagsInfo）が無い（ボタンは出るが帳票を作れない。無効にするか HTML 設定を書く）");
      else f.info("tags.missing", label, "無効なボタンに HTML 設定が無い");
      continue;
    }
    if (!PAPER_NAMES.includes(tags.pageSize)) f.error("tags.pageSize", label, `pageSize が使えない値: ${tags.pageSize}（${PAPER_NAMES.join(", ")}）`);
    else if (!PAGE_SIZES.includes(tags.pageSize)) f.warning("tags.pageSize", label, `pageSize ${tags.pageSize} は設定画面の候補に無い（動くが画面で選べない）`);
    if (tags.orientation !== "p" && tags.orientation !== "l") f.error("tags.orientation", label, `orientation は p か l: ${tags.orientation}`);
    if (!DPI_OPTIONS.includes(String(tags.dpi))) f.error("tags.dpi", label, `dpi は "96" か "150": ${JSON.stringify(tags.dpi)}`);
    if (tags.printMode !== undefined && !(PRINT_MODES as readonly string[]).includes(tags.printMode)) f.error("tags.printMode", label, `printMode は ${PRINT_MODES.join(" / ")}: ${tags.printMode}`);
    if (row.list && tags.printMode && tags.printMode !== "preview") f.info("tags.printMode", label, "一覧帳票では printMode は効かない（常にプレビュー）");
    if (tags.filecode) {
      const p = model.pp[tags.filecode];
      if (!p) f.error("tags.filecode", label, `filecode の項目が fields に無い: ${tags.filecode}`);
      else if (p.type !== "FILE") f.error("tags.filecode", label, `filecode は添付ファイル項目: ${tags.filecode} は ${p.type}`);
      else if (p.ptcode) f.error("tags.filecode", label, `filecode はテーブルの外の添付ファイル項目: ${tags.filecode} はテーブル ${p.ptcode} の中`);
    } else if (row.list === false && row.state) {
      f.info("tags.filecode", label, "保存先が無い（PC はダウンロード、iPhone は共有シート、Android の kintone アプリは案内）");
    }
    const fieldsInfo = tags.fieldsInfo as TagRow[];
    if (fieldsInfo.length < 2) f.error("tags.rows", label, `HTML 設定は 1 行目 $out（ボタン表示条件）、2 行目 $fname（ファイル名）、3 行目以降が帳票。行が ${fieldsInfo.length} しか無い`);
    if (fieldsInfo[0] && fieldsInfo[0].fieldcode !== "$out") f.error("tags.rows", label, `1 行目の fieldcode は $out: ${fieldsInfo[0].fieldcode}`);
    if (fieldsInfo[1] && fieldsInfo[1].fieldcode !== "$fname") f.error("tags.rows", label, `2 行目の fieldcode は $fname: ${fieldsInfo[1].fieldcode}`);
    if (!fieldsInfo.slice(2).some((t) => t.state && (t.html || t.formulaSet))) f.warning("tags.rows", label, "有効な帳票の行（3 行目以降の html か計算式）が無い");
    for (const [j, t] of fieldsInfo.entries()) {
      const where = `${label} / ${tagRowLabel(t, j)}`;
      for (const code of Object.keys(t.usedFields ?? {})) {
        if (code === UOG_MARK) continue;
        if (!fieldExists(model, code)) f.error("field.unknown", where, `項目が fields に無い: ${code}（ラベルで書いた、別アプリの項目、綴りの違い）`);
      }
      if (!t.state) continue;
      if (t.formulaSet && commentInsideString(t.formulaSet)) f.error("formula.comment", where, "計算式の文字列の中に // がある（\"https://…\" など）。印刷屋は文字列の中でも // 以降をコメントとして捨てるので式が壊れる。URL は HTML の属性か ##目印## に置く");
      escapeFinding(f, where, [t.formula || "", ...(t.html ? expressionsOf(t.html) : [])]);
      const formula = t.formula || "";
      if (formula && j >= 2) await checkFormulaHtml(formula, where, f, ctx);
      if (t.html) {
        const r = await checkHtml(t.html, { baseUrl: ctx.baseUrl });
        for (const e of r.errors) f.error("html.rule", where, e);
        for (const w of r.warnings) f.warning("html.rule", where, w);
        for (const u of r.externals) externalFinding(f, ctx, where, u.url, u.via);
        const rawExprs = expressionsOf(t.html).filter((e) => !isSafeExpression(e, pp));
        if (rawExprs.length) f.warning("html.rawExpression", where, `\${式} が文字列をエスケープせずに差し込んでいる: ${rawExprs.slice(0, 5).map((e) => `\${${e}}`).join(" ")}${rawExprs.length > 5 ? ` 他 ${rawExprs.length - 5}` : ""}（文字列の項目は \${ESC_HTML(項目)}、複数行は \${REPLACE(ESC_HTML(項目), NEWLINE(), "<br>")}。数値・日付の項目と FVAL / DATE_FORMAT はそのままでよい）`);
      }
      if (t.css) {
        const r = checkCss(t.css);
        for (const e of r.errors) f.error("css.rule", where, e);
        for (const u of r.externals) externalFinding(f, ctx, where, u.url, `CSS ${u.via}`);
      }
    }
    const outRow = fieldsInfo[0];
    if (outRow?.state && outRow.usedFields && UOG_MARK in outRow.usedFields && !body.pluginUOG) {
      f.info("uog.condition", label, "ボタン表示条件で UINFO / OINFO / GINFO を使っているが pluginUOG は偽（更新項目だけで決まる仕様。実機では評価できる）");
    }
    for (const [j, c] of row.calcInfo.fieldsInfo.entries()) {
      if (!c.state) continue;
      if (c.formulaSet && commentInsideString(c.formulaSet)) f.error("formula.comment", `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, "計算式の文字列の中に // がある。印刷屋は文字列の中でも // 以降をコメントとして捨てるので式が壊れる");
      escapeFinding(f, `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, [c.formula || ""]);
      for (const code of Object.keys(c.usedFields ?? {})) {
        if (code === UOG_MARK) continue;
        if (!fieldExists(model, code)) f.error("field.unknown", `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, `項目が fields に無い: ${code}`);
      }
    }
  }
}
