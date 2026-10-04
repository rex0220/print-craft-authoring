/**
 * fields/<app>.json（fields コマンドの出力）から、設定画面と同じ項目の模型を作る（docs/authoring-plan.md 12.2）。
 *   pp     … expandFields（$id / $revision / $out / $html を足す）→ createCheckRecord（テーブルの子を ptcode 付きで平らに足す）
 *   crec   … 計算式の検証用レコード（空の値）
 *   calcCandidates … 更新項目にできる項目（createFieldsInfo。レイアウト順、isTargetType の型、計算項目とルックアップのコピー先を除く、テーブルの中を除く）
 */
import type { FieldsFile } from "../commands/fields.ts";
import { expandFields } from "print-craft/src/shared/fields.ts";
import { createCheckRecord, createFieldsInfo, isTargetType, type FieldInfo, type FieldProp, type LayoutRow } from "print-craft/src/config/load.ts";

export const PSEUDO_FIELDS = new Set(["$id", "$revision", "$out", "$html", "$rseq"]);
/** UINFO / OINFO / GINFO を使った印（項目ではない。lib 26 行） */
export const UOG_MARK = "$UGO$";
export const EXEC_CONDITION_LABEL = "実行条件";

export interface Model {
  file: FieldsFile;
  baseUrl: string;
  appId: number;
  /** 検証用（createCheckRecord でテーブルの子が足されている） */
  pp: Record<string, FieldProp>;
  crec: Record<string, unknown>;
  /** 実行用（preview）。テーブルの子は入れ子のまま */
  ppRun: Record<string, FieldProp>;
  calcCandidates: FieldInfo[];
  calcByCode: Map<string, FieldInfo>;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildModel(file: FieldsFile): Model {
  // 検証用の pp は設定画面と同じ作り方（load.ts 204〜214 行）: properties + $id / $revision / $html → createCheckRecord がテーブルの子を ptcode 付きで足す。
  // expandFields（デスクトップの作り方）を先に通すと、createCheckRecord が子の ptcode を "" に戻してしまう（キーの順で上書きされる）ので使わない
  const pp: Record<string, FieldProp> = { ...(clone(file.properties) as Record<string, FieldProp>) };
  pp["$id"] = { type: "RECORD_NUMBER", code: "$id", label: "$id" };
  pp["$revision"] = { type: "__REVISION__", code: "$revision", label: "$revision" };
  pp["$html"] = { type: "MULTI_LINE_TEXT", code: "$html", label: "$html" };
  const crec = createCheckRecord(pp);
  // 実行用（preview）はデスクトップと同じ expandFields
  const ppRun = expandFields(clone(file.properties) as Record<string, FieldProp>, EXEC_CONDITION_LABEL);
  // createFieldsInfo はレイアウトの項目を pp で引く（テーブルの子は ptcode 付きで出るので、設定画面の dialog と同じく除く。dialogs.ts 753 行）
  const calcCandidates = createFieldsInfo(pp, clone(file.layout) as LayoutRow[]).filter((c) => !c.ptcode && c.type !== "SUBTABLE");
  const calcByCode = new Map<string, FieldInfo>();
  for (const c of calcCandidates) calcByCode.set(c.fieldcode, c);
  return { file, baseUrl: file.baseUrl, appId: file.appId, pp, crec, ppRun, calcCandidates, calcByCode };
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
  if (!isTargetType(p.type)) return `更新できない型（${p.type}）`;
  if (p.expression) return "計算項目";
  if (p.copyfield) return "ルックアップのコピー先";
  return "レイアウトに無い";
}
