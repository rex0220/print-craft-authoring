/**
 * fields/<app>.json（fields コマンドの出力）から、設定画面と同じ項目の模型を作る（docs/authoring-plan.md 12.2）。印刷屋のコードは API（engine.api）から使う。
 *   pp     … properties + $id / $revision / $html → createCheckRecord（テーブルの子を ptcode 付きで平らに足す）。設定画面の load.ts 204〜214 行と同じ作り方
 *   crec   … 計算式の検証用レコード（空の値）
 *   ppRun  … 実行用（preview）。デスクトップと同じ expandFields
 *   calcCandidates … 更新項目にできる項目（createFieldsInfo。テーブルの子を除く）
 */
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import type { FieldInfo, FieldProp } from "print-craft/src/config/load.ts";
import type { FieldsFile } from "../commands/fields.ts";

export const PSEUDO_FIELDS = new Set(["$id", "$revision", "$out", "$html", "$rseq"]);
/** UINFO / OINFO / GINFO を使った印（項目ではない。lib 26 行） */
export const UOG_MARK = "$UGO$";
export const EXEC_CONDITION_LABEL = "実行条件";

export interface Model {
  api: PrintCraftAuthoringApi;
  file: FieldsFile;
  baseUrl: string;
  appId: number;
  pp: Record<string, FieldProp>;
  crec: Record<string, unknown>;
  ppRun: Record<string, FieldProp>;
  calcCandidates: FieldInfo[];
  calcByCode: Map<string, FieldInfo>;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildModel(file: FieldsFile, api: PrintCraftAuthoringApi): Model {
  // 検証用の pp は設定画面と同じ作り方。expandFields を先に通すと createCheckRecord が子の ptcode を "" に戻す（キーの順で上書き）ので使わない
  const pp: Record<string, FieldProp> = { ...(clone(file.properties) as unknown as Record<string, FieldProp>) };
  pp["$id"] = { type: "RECORD_NUMBER", code: "$id", label: "$id" };
  pp["$revision"] = { type: "__REVISION__", code: "$revision", label: "$revision" };
  pp["$html"] = { type: "MULTI_LINE_TEXT", code: "$html", label: "$html" };
  const crec = api.createCheckRecord(pp);
  const ppRun = api.expandFields(clone(file.properties) as unknown as Record<string, FieldProp>, EXEC_CONDITION_LABEL);
  // createFieldsInfo はテーブルの子を ptcode 付きで出すので、設定画面の dialog と同じく除く（dialogs.ts 753 行）
  const calcCandidates = api.createFieldsInfo(pp, clone(file.layout) as Parameters<PrintCraftAuthoringApi["createFieldsInfo"]>[1]).filter((c) => !c.ptcode && c.type !== "SUBTABLE");
  const calcByCode = new Map<string, FieldInfo>();
  for (const c of calcCandidates) calcByCode.set(c.fieldcode, c);
  return { api, file, baseUrl: file.baseUrl, appId: file.appId, pp, crec, ppRun, calcCandidates, calcByCode };
}

/** 項目コードが使えるか（usedFields の実在チェック。12.3） */
export function fieldExists(model: Model, code: string): boolean {
  if (PSEUDO_FIELDS.has(code)) return true;
  const p = model.pp[code];
  if (!p) return false;
  if (p.ptcode) return !!model.pp[p.ptcode];
  return true;
}

/** 更新項目にできない理由（できれば null） */
export function calcIneligibleReason(model: Model, code: string): string | null {
  if (model.calcByCode.has(code)) return null;
  const p = model.pp[code];
  if (!p) return "fields に無い";
  if (p.ptcode) return `テーブル ${p.ptcode} の中`;
  if (!model.api.isTargetType(p.type)) return `更新できない型（${p.type}）`;
  if (p.expression) return "計算項目";
  if (p.copyfield) return "ルックアップのコピー先";
  return "レイアウトに無い";
}
