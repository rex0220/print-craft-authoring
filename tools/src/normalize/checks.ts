/**
 * 正規化した設定の検査（docs/authoring-plan.md 12.3）。派生値は derive.ts が作った後に呼ぶ。
 */
import type { Findings } from "./findings.ts";
import { fieldExists, UOG_MARK, type Model } from "./model.ts";
import { rowLabel, tagRowLabel } from "./derive.ts";
import { checkCss } from "./css-check.ts";
import { checkHtml, expressionsOf } from "./html-check.ts";
import { isAllowed, type Policy } from "./policy.ts";
import { PAGE_SIZES, DPI_OPTIONS, type MenuRow, type CssRow, type TagRow } from "print-craft/src/config/schema.ts";
import { PAPER_NAMES } from "print-craft/src/shared/paper.ts";
import { PRINT_MODES } from "print-craft/src/shared/print-mode.ts";

export interface CheckOptions {
  policy: Policy;
  /** cwd からの相対パス（policy の files と照合） */
  settingsFile?: string;
}

/** 生の HTML を入れる関数（差分で人が見る対象） */
const RAW_HTML_FUNCTIONS = ["HTML", "FVAL", "TABLE_HTML", "RECS_HTML", "FIELDS_HTML", "PAGE_HTML", "TAGS_HTML", "UNESC_HTML"];
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
  const rows = (body.pluginInfos ?? []) as MenuRow[];
  const fieldCodes = new Set(Object.keys(model.pp));
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
    // 列挙
    if (!PAPER_NAMES.includes(tags.pageSize)) f.error("tags.pageSize", label, `pageSize が使えない値: ${tags.pageSize}（${PAPER_NAMES.join(", ")}）`);
    else if (!PAGE_SIZES.includes(tags.pageSize)) f.warning("tags.pageSize", label, `pageSize ${tags.pageSize} は設定画面の候補に無い（動くが画面で選べない）`);
    if (tags.orientation !== "p" && tags.orientation !== "l") f.error("tags.orientation", label, `orientation は p か l: ${tags.orientation}`);
    if (!DPI_OPTIONS.includes(String(tags.dpi))) f.error("tags.dpi", label, `dpi は "96" か "150": ${JSON.stringify(tags.dpi)}`);
    if (tags.printMode !== undefined && !(PRINT_MODES as readonly string[]).includes(tags.printMode)) f.error("tags.printMode", label, `printMode は ${PRINT_MODES.join(" / ")}: ${tags.printMode}`);
    if (row.list && tags.printMode && tags.printMode !== "preview") f.info("tags.printMode", label, "一覧帳票では printMode は効かない（常にプレビュー）");
    // 保存先
    if (tags.filecode) {
      const p = model.pp[tags.filecode];
      if (!p) f.error("tags.filecode", label, `filecode の項目が fields に無い: ${tags.filecode}`);
      else if (p.type !== "FILE") f.error("tags.filecode", label, `filecode は添付ファイル項目: ${tags.filecode} は ${p.type}`);
      else if (p.ptcode) f.error("tags.filecode", label, `filecode はテーブルの外の添付ファイル項目: ${tags.filecode} はテーブル ${p.ptcode} の中`);
    } else if (row.list === false && row.state) {
      f.info("tags.filecode", label, "保存先が無い（PC はダウンロード、iPhone は共有シート、Android の kintone アプリは案内）");
    }
    // 行ごと
    const fieldsInfo = tags.fieldsInfo as TagRow[];
    if (fieldsInfo.length < 2) f.warning("tags.rows", label, "HTML 設定は 1 行目 $out、2 行目 $fname、3 行目以降が帳票");
    if (fieldsInfo[0] && fieldsInfo[0].fieldcode !== "$out") f.error("tags.rows", label, `1 行目の fieldcode は $out: ${fieldsInfo[0].fieldcode}`);
    if (fieldsInfo[1] && fieldsInfo[1].fieldcode !== "$fname") f.error("tags.rows", label, `2 行目の fieldcode は $fname: ${fieldsInfo[1].fieldcode}`);
    if (!fieldsInfo.slice(2).some((t) => t.state && (t.html || t.formulaSet))) f.warning("tags.rows", label, "有効な帳票の行（3 行目以降の html か計算式）が無い");
    for (const [j, t] of fieldsInfo.entries()) {
      const where = `${label} / ${tagRowLabel(t, j)}`;
      // usedFields の実在
      for (const code of Object.keys(t.usedFields ?? {})) {
        if (code === UOG_MARK) continue;
        if (!fieldExists(model, code)) f.error("field.unknown", where, `項目が fields に無い: ${code}（ラベルで書いた、別アプリの項目、綴りの違い）`);
      }
      if (!t.state) continue;
      // 計算式の中の生の HTML を入れる関数・ATTR にレコードの値
      const formula = t.formula || "";
      if (formula) {
        const raw = RAW_HTML_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(formula));
        if (raw.length && j >= 2) f.warning("formula.rawHtml", where, `生の HTML を入れる関数: ${raw.join(", ")}（レコードの値がそのまま HTML になる。差分で人が見る）`);
        for (const m of formula.matchAll(/\bATTR\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
          const ids = identifiersOf(m[1]).filter((id) => fieldCodes.has(id) && !id.startsWith("$"));
          if (ids.length) f.warning("formula.attr", where, `ATTR の値にレコードの項目: ${ids.join(", ")}（属性値はエスケープされない。" で壊れる）`);
        }
      }
      // HTML
      if (t.html) {
        const r = await checkHtml(t.html, { baseUrl: model.baseUrl });
        for (const e of r.errors) f.error("html.rule", where, e);
        for (const w of r.warnings) f.warning("html.rule", where, w);
        for (const u of r.externals) externalFinding(f, opt, where, u.url, u.via);
        const rawExprs = expressionsOf(t.html).filter((e) => !/^ESC_HTML\s*\(/.test(e));
        if (rawExprs.length) f.warning("html.rawExpression", where, `\${式} が ESC_HTML を通していない: ${rawExprs.slice(0, 5).map((e) => `\${${e}}`).join(" ")}${rawExprs.length > 5 ? ` 他 ${rawExprs.length - 5}` : ""}（文字列は \${ESC_HTML(項目)}。FVAL / HTML は生の HTML）`);
      }
      // CSS
      if (t.css) {
        const r = checkCss(t.css);
        for (const e of r.errors) f.error("css.rule", where, e);
        for (const u of r.externals) externalFinding(f, opt, where, u.url, `CSS ${u.via}`);
      }
    }
    // pluginUOG と表示条件の UINFO（11.1 の気づき。情報）
    const outRow = fieldsInfo[0];
    if (outRow?.state && outRow.usedFields && UOG_MARK in outRow.usedFields && !body.pluginUOG) {
      f.info("uog.condition", label, "ボタン表示条件で UINFO / OINFO / GINFO を使っているが pluginUOG は偽（更新項目だけで決まる仕様。実機では評価できる）");
    }
    // 更新項目の usedFields
    for (const [j, c] of row.calcInfo.fieldsInfo.entries()) {
      if (!c.state) continue;
      for (const code of Object.keys(c.usedFields ?? {})) {
        if (code === UOG_MARK) continue;
        if (!fieldExists(model, code)) f.error("field.unknown", `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, `項目が fields に無い: ${code}`);
      }
    }
  }
}
