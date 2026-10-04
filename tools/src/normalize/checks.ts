/**
 * 正規化した設定の検査（docs/authoring-plan.md 12.3）。派生値は derive.ts が作った後に呼ぶ。列挙の定数は印刷屋の API から。
 */
import type { Findings } from "./findings.ts";
import { fieldExists, UOG_MARK, type Model } from "./model.ts";
import { rowLabel, tagRowLabel } from "./derive.ts";
import { checkCss } from "./css-check.ts";
import { checkHtml, expressionsOf } from "./html-check.ts";
import { isAllowed, type Policy } from "./policy.ts";
import type { MenuRow, CssRow, TagRow } from "print-craft/src/config/schema.ts";

export interface CheckOptions {
  policy: Policy;
  /** cwd からの相対パス（policy の files と照合） */
  settingsFile?: string;
}

/** 生の HTML を入れる関数（差分で人が見る対象） */
const RAW_HTML_FUNCTIONS = ["HTML", "FVAL", "TABLE_HTML", "RECS_HTML", "FIELDS_HTML", "PAGE_HTML", "TAGS_HTML", "UNESC_HTML"];
/** 値に HTML の記号が入りえない項目の型（数値・日付・時刻・システム項目） */
const SAFE_VALUE_TYPES = new Set(["NUMBER", "CALC", "DATE", "DATETIME", "TIME", "CREATED_TIME", "UPDATED_TIME", "RECORD_NUMBER", "__REVISION__", "__ID__"]);
/** 数値・日付の項目を整える関数（引数の項目が安全な型なら結果も安全） */
const FORMAT_FUNCTIONS = new Set(["FVAL", "DATE_FORMAT", "DATE_ADD", "YEN", "FIXED", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "FLOOR", "CEIL", "ABS", "FSIZE", "DURATION_FORMAT", "TODAY", "NOW"]);

/**
 * HTML の ${式} が安全な差し込みか（12.3 の html.rawExpression）。
 *   安全: ESC_HTML(…)、REPLACE(ESC_HTML(…), …)、数値・日付の項目そのもの、数値・日付の項目を整える関数（FVAL(合計) など）、TODAY() / NOW()、文字列や数の定数
 *   それ以外（文字列系の項目、FVAL(文字列項目)、HTML(…) など）は警告
 */
export function isSafeExpression(expr: string, pp: Record<string, { type: string }>): boolean {
  const e = expr.trim();
  if (/^ESC_HTML\s*\(/.test(e)) return true;
  if (/^REPLACE\s*\(\s*ESC_HTML\s*\(/.test(e)) return true;
  if (/^(-?\d+(\.\d+)?|"[^"]*")$/.test(e)) return true;
  const field = e.match(/^([\p{L}_$][\p{L}\p{N}_$]*)$/u);
  if (field) return SAFE_VALUE_TYPES.has(pp[field[1]]?.type ?? "");
  const fn = e.match(/^([A-Z_]+)\s*\(\s*([\p{L}_$][\p{L}\p{N}_$]*)?\s*[,)]/u);
  if (fn && FORMAT_FUNCTIONS.has(fn[1])) {
    if (!fn[2]) return fn[1] === "TODAY" || fn[1] === "NOW";
    return SAFE_VALUE_TYPES.has(pp[fn[2]]?.type ?? "");
  }
  return false;
}

/** 式の中の識別子（項目コードの候補）。文字列の中は除く */
function identifiersOf(formula: string): string[] {
  const noStrings = formula.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return [...noStrings.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)].map((m) => m[0]);
}

function externalFinding(f: Findings, opt: CheckOptions, where: string, url: string, via: string): void {
  if (isAllowed(opt.policy, url, opt.settingsFile)) {
    f.info("external.allowed", where, `外部の URL（承認済み）: ${url}（${via}）`);
  } else {
    f.warning("external.url", where, `外部の URL: ${url}（${via}）。利用者が承認するなら policy/authoring-policy.json の allowExternal に origin か url を書く（AI は書かない）`);
  }
}

export async function checkBody(body: Record<string, unknown>, model: Model, f: Findings, opt: CheckOptions): Promise<void> {
  const { PAPER_NAMES, PAGE_SIZES, DPI_OPTIONS, PRINT_MODES } = model.api;
  const rows = (body.pluginInfos ?? []) as MenuRow[];
  const fieldCodes = new Set(Object.keys(model.pp));
  const pp = model.pp as Record<string, { type: string }>;
  // ---- 共通 CSS ----
  for (const [i, c] of ((body.cssInfo ?? []) as CssRow[]).entries()) {
    if (!c.state || !c.css) continue;
    const where = `共通 CSS ${i + 1} 行目 (${c.name})`;
    const r = checkCss(c.css);
    for (const e of r.errors) f.error("css.rule", where, e);
    for (const u of r.externals) externalFinding(f, opt, where, u.url, `CSS ${u.via}`);
  }
  // ---- Web フォント ----
  const font = body.fontInfo as { enabled?: boolean; cssUrl?: string } | undefined;
  if (font?.enabled && font.cssUrl) {
    if (!/^https:\/\//.test(font.cssUrl)) f.error("font.url", "Web フォント", `cssUrl は https の URL: ${font.cssUrl.slice(0, 80)}`);
    else externalFinding(f, opt, "Web フォント", font.cssUrl, "fontInfo.cssUrl");
  }
  // ---- ボタンごと ----
  for (const [i, row] of rows.entries()) {
    const label = rowLabel(row, i);
    const tags = row.tagsInfo;
    if (!tags) {
      if (row.state) f.warning("tags.missing", label, "HTML 設定が無い（ボタンは出るが帳票を作れない）");
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
    if (fieldsInfo.length < 2) f.warning("tags.rows", label, "HTML 設定は 1 行目 $out、2 行目 $fname、3 行目以降が帳票");
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
      const formula = t.formula || "";
      if (formula) {
        const raw = RAW_HTML_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(formula));
        if (raw.length && j >= 2) f.warning("formula.rawHtml", where, `生の HTML を入れる関数: ${raw.join(", ")}（レコードの値がそのまま HTML になる。差分で人が見る）`);
        for (const m of formula.matchAll(/\bATTR\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
          const ids = identifiersOf(m[1]).filter((id) => fieldCodes.has(id) && !id.startsWith("$"));
          if (ids.length) f.warning("formula.attr", where, `ATTR の値にレコードの項目: ${ids.join(", ")}（属性値はエスケープされない。" で壊れる）`);
        }
      }
      if (t.html) {
        const r = await checkHtml(t.html, { baseUrl: model.baseUrl });
        for (const e of r.errors) f.error("html.rule", where, e);
        for (const w of r.warnings) f.warning("html.rule", where, w);
        for (const u of r.externals) externalFinding(f, opt, where, u.url, u.via);
        const rawExprs = expressionsOf(t.html).filter((e) => !isSafeExpression(e, pp));
        if (rawExprs.length) f.warning("html.rawExpression", where, `\${式} が文字列をエスケープせずに差し込んでいる: ${rawExprs.slice(0, 5).map((e) => `\${${e}}`).join(" ")}${rawExprs.length > 5 ? ` 他 ${rawExprs.length - 5}` : ""}（文字列の項目は \${ESC_HTML(項目)}、複数行は \${REPLACE(ESC_HTML(項目), "\\n", "<br>")}。数値・日付の項目と FVAL / DATE_FORMAT はそのままでよい）`);
      }
      if (t.css) {
        const r = checkCss(t.css);
        for (const e of r.errors) f.error("css.rule", where, e);
        for (const u of r.externals) externalFinding(f, opt, where, u.url, `CSS ${u.via}`);
      }
    }
    const outRow = fieldsInfo[0];
    if (outRow?.state && outRow.usedFields && UOG_MARK in outRow.usedFields && !body.pluginUOG) {
      f.info("uog.condition", label, "ボタン表示条件で UINFO / OINFO / GINFO を使っているが pluginUOG は偽（更新項目だけで決まる仕様。実機では評価できる）");
    }
    for (const [j, c] of row.calcInfo.fieldsInfo.entries()) {
      if (!c.state) continue;
      for (const code of Object.keys(c.usedFields ?? {})) {
        if (code === UOG_MARK) continue;
        if (!fieldExists(model, code)) f.error("field.unknown", `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, `項目が fields に無い: ${code}`);
      }
    }
  }
}
