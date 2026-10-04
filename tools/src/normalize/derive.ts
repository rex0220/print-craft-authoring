/**
 * 派生値の生成（docs/authoring-plan.md 12.2。段階 0 の work/authoring-spike/spike-normalize.mjs の移植 + 更新項目の行の再構成）。
 * 入力にあった派生値は信用せず上書きする:
 *   - HTML 設定の各行: id、formula（formulaSet からコメントを除いたもの）、usedFields（実エンジンで crec を評価）
 *   - 更新項目: 行の並びと state / formulaSet / remark は AI のまま、type / ptcode / row_type / lookup / fieldlabel / required は
 *     fields + layout の一覧（createFieldsInfo）で上書き（設定画面の buildCalcRows と同じ）。一覧に無い項目はエラー。先頭は $out（無ければ既定の "1" を足す）。
 *     一覧にあって入力に無い項目は足さない（設定画面の「未使用を除く」の後の形）。入力が [] なら [] のまま（dialog を開いていないボタン）。
 *     calcInfo.usedFields は有効な行の和、flinkage は false
 *   - views（viewsCsv から）、id の振り直し（toSavedRows）、ルートの usedFields と pluginUOG（computeUsage）
 */
import type { Engine } from "../engine.ts";
import type { Findings } from "./findings.ts";
import { calcIneligibleReason, type Model } from "./model.ts";
import { buildMenuRows, computeUsage, defaultMenuInfo, normalizeCssRows, normalizeTagsInfo, stripComments, toSavedRows, type PrintCraftSaved } from "print-craft/src/config/load.ts";
import type { CalcField, MenuRow, TagRow } from "print-craft/src/config/schema.ts";

/** 封筒のキー（kit の export-import.ts と同じ） */
export const ENVELOPE_KEYS = ["date", "pluginName", "pluginID", "PluginVersion", "appId", "appName"] as const;
/** 外枠（kit の shell）が付け足すキー。CONFIG_SCHEMA に無く、インポートで落ちる */
export const SHELL_KEYS = ["pluginProductEnv", "pluginLastUpdate", "pluginUpdater", "startDate", "name", "version", "ldate"] as const;

const AI_CALC_KEYS = ["state", "formulaSet", "remark"] as const;
const META_CALC_KEYS = ["row_type", "type", "lookup", "ptcode", "fieldlabel", "required"] as const;

export interface EvalResult {
  formula: string;
  usedFields: Record<string, unknown>;
  error?: string;
}

/** 設定画面の formulaRule と同じ: 検証用レコードで評価して usedFields を取る */
export function evaluateFormula(engine: Engine, model: Model, formulaSet: string): EvalResult {
  const formula = stripComments(formulaSet.replace(/\r\n?/g, "\n"));
  if (!formula.trim()) return { formula, usedFields: {} };
  const kf = engine.checker(model.pp, model.crec);
  kf.usedFields({});
  try {
    kf.dq(formula);
  } catch (e) {
    return { formula, usedFields: {}, error: String((e as Error)?.message ?? e) };
  }
  return { formula, usedFields: kf.usedFields() };
}

export function rowLabel(row: MenuRow, index: number): string {
  return row.menu || `ボタン ${index + 1}`;
}

export function tagRowLabel(tag: TagRow, index: number): string {
  const kind = index === 0 ? "ボタン表示条件" : index === 1 ? "ファイル名" : tag.desc || tag.fieldcode || "本文";
  return `HTML 設定 ${index + 1} 行目 (${kind})`;
}

/** 設定本体（封筒と外枠のキーを除いたもの）を取り出す */
export function bodyOf(envelope: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set<string>([...ENVELOPE_KEYS, ...SHELL_KEYS]);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(envelope)) if (!skip.has(k)) out[k] = envelope[k];
  return out;
}

export function deriveBody(input: Record<string, unknown>, model: Model, engine: Engine, f: Findings): Record<string, unknown> {
  const rows = buildMenuRows(input as PrintCraftSaved, "ja");
  rows.forEach((row, i) => {
    const label = rowLabel(row, i);
    // ---- HTML 設定 ----
    const tags = normalizeTagsInfo(row.tagsInfo);
    if (tags) {
      tags.fieldsInfo = tags.fieldsInfo.map((t, j) => {
        const base: TagRow = { ...t, id: j + 1, formulaSet: String(t.formulaSet ?? "").replace(/\r\n?/g, "\n") };
        if (!t.state) return { ...base, formula: "", usedFields: {} };
        const r = evaluateFormula(engine, model, base.formulaSet);
        if (r.error) f.error("formula.syntax", `${label} / ${tagRowLabel(t, j)}`, `計算式を評価できない: ${r.error}`);
        return { ...base, formula: r.formula, usedFields: r.usedFields };
      });
      row.tagsInfo = tags;
    }
    // ---- 更新項目 ----
    // 設定画面は dialog を開いたことが無いボタンの fieldsInfo を [] のまま保存する。入力が空ならそのまま（$out も足さない）
    const given = row.calcInfo.fieldsInfo;
    if (given.length === 0) {
      row.calcInfo.usedFields = {};
      row.calcInfo.flinkage = false;
      return;
    }
    const outRow = given.find((x) => x.fieldcode === "$out");
    const rebuilt: CalcField[] = [];
    // $out の row_type は設定画面の言語の文言（dialogs.ts の outLabel）。入力にあればそのまま、無ければ日本語
    rebuilt.push(
      outRow
        ? { ...outRow, row_type: outRow.row_type || "更新条件", type: "BOOL", lookup: false, ptcode: "", fieldlabel: "", fieldcode: "$out", required: false }
        : { id: 1, state: false, row_type: "更新条件", type: "BOOL", lookup: false, ptcode: "", fieldlabel: "", fieldcode: "$out", required: false, remark: "", formulaSet: "1", formula: "1", usedFields: {} }
    );
    if (!outRow && given.length) f.info("calc.out", `${label} / 更新項目`, "先頭の $out（更新条件）が無いので既定（1 = 常に更新）を足した");
    const seen = new Set<string>(["$out"]);
    for (const x of given) {
      if (x.fieldcode === "$out") continue;
      if (seen.has(x.fieldcode)) {
        f.error("calc.duplicate", `${label} / 更新項目 ${x.fieldcode}`, "同じ項目が 2 回ある");
        continue;
      }
      seen.add(x.fieldcode);
      const cand = model.calcByCode.get(x.fieldcode);
      if (!cand) {
        f.error("calc.ineligible", `${label} / 更新項目 ${x.fieldcode}`, `${x.fieldcode} は更新項目にできない: ${calcIneligibleReason(model, x.fieldcode)}`);
        continue;
      }
      const diffs = META_CALC_KEYS.filter((k) => x[k] !== undefined && x[k] !== "" && String(x[k]) !== String(cand[k] ?? ""));
      if (diffs.length) f.info("calc.meta", `${label} / 更新項目 ${x.fieldcode}`, `fields の定義で上書き: ${diffs.map((k) => `${k} ${JSON.stringify(x[k])} → ${JSON.stringify(cand[k] ?? "")}`).join(", ")}`);
      rebuilt.push({
        id: 0, state: !!x.state, row_type: cand.row_type, type: cand.type, lookup: cand.lookup, ptcode: cand.ptcode || "", fieldlabel: cand.fieldlabel, fieldcode: cand.fieldcode, required: !!cand.required,
        remark: String(x.remark ?? ""), formulaSet: String(x.formulaSet ?? "").replace(/\r\n?/g, "\n"), formula: "", usedFields: {}
      });
    }
    // 一覧にあって入力に無い項目は足さない（設定画面の「未使用を除く」の後の形。dialog は開いたときに全候補を並べるが、保存されるのは残した行だけ）
    let used: Record<string, unknown> = {};
    row.calcInfo.fieldsInfo = rebuilt.map((c, j) => {
      const base: CalcField = { ...c, id: j + 1 };
      if (!c.state) return { ...base, formula: "", usedFields: {} };
      const r = evaluateFormula(engine, model, base.formulaSet);
      if (r.error) f.error("formula.syntax", `${label} / 更新項目 ${j + 1} 行目 (${c.fieldcode})`, `計算式を評価できない: ${r.error}`);
      used = { ...used, ...r.usedFields };
      return { ...base, formula: r.formula, usedFields: r.usedFields };
    });
    row.calcInfo.usedFields = used;
    row.calcInfo.flinkage = false;
  });

  const saved = toSavedRows(rows);
  const usage = computeUsage(rows, model.pp);
  const body: Record<string, unknown> = {
    pluginEnable: input.pluginEnable === undefined ? true : !!input.pluginEnable,
    menuInfo: input.menuInfo && typeof input.menuInfo === "object" ? input.menuInfo : defaultMenuInfo("ja"),
    guestsInfo: Array.isArray(input.guestsInfo) ? input.guestsInfo : [],
    pluginComment: String(input.pluginComment ?? ""),
    pluginDescription: String(input.pluginDescription ?? ""),
    commonCssEnable: input.commonCssEnable === undefined ? true : !!input.commonCssEnable,
    cssInfo: normalizeCssRows(input.cssInfo),
    ...(input.fontInfo && typeof input.fontInfo === "object" ? { fontInfo: input.fontInfo } : {}),
    pluginInfos: saved,
    usedFields: usage.usedFields,
    pluginUOG: usage.pluginUOG
  };
  // 上に無いキーはそのまま残す（CONFIG_SCHEMA の検証が後で落とす・弾く）
  for (const k of Object.keys(input)) if (!(k in body)) body[k] = input[k];
  return body;
}
