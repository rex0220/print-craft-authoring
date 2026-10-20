/**
 * 評価の子プロセスに渡す仕事と返す結果（構造化クローンで渡せる形だけ。関数やクラスは渡さない）。print-craft の docs/authoring-try-plan.md 4.5・4.6（T0a）。
 * 2026-10-20: Worker thread の resourceLimits では、印刷屋のエンジンでヒープの上限に当たるとプロセス全体が落ちた（FATAL ERROR）ので、
 * 計画の Q1 の決まりどおり子プロセスにした（ファイルの名前の worker は「評価を受け持つもの」の意味で残す）。
 * 形は formula-authoring の tools/src/worker/eval-job.ts を元にした。
 *   - kind "formulas": 空のレコードで式を評価する（T0a の確かめ。T3 の try の式の土台）
 *   - kind "normalize": 設定の正規化（検査と派生値。T0b。CLI の normalize、print-craft MCP の pcraft_normalize と保存の検査）
 *   - kind "preview": 帳票の試し出力（normalize + 描画 + 掃除 + verifyPreviewHtml。T0c。CLI の preview、print-craft MCP の pcraft_preview）
 *   - kind "try": お試しアプリで式と帳票を試す（T3。CLI の try、print-craft MCP の pcraft_try。ユーザー情報は既定のテストデータ）
 *   - 返すのは JSON にできる形だけ（エンジンの生の値は子プロセスの中で直す。循環、関数、DOM、BigNumber / Decimal を直接送らない）
 */

import type { FieldsFile } from "../commands/fields.ts";
import type { Finding } from "../normalize/findings.ts";
import type { Policy } from "../normalize/policy.ts";
import type { StoredSize } from "../normalize/size.ts";
import type { RenderedButton } from "../preview/render.ts";
import type { TryOutcome } from "../commands/try.ts";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type EvalKind = "formulas" | "normalize" | "preview" | "try";

export interface EvalJob {
  kind: EvalKind;
  /** 読み込み元（絶対パス。CLI は .env から、MCP は設定項目から決める） */
  pluginZip?: string;
  /** 開発中（mode dev）の読み込み元（隣の print-craft の prod/） */
  devPluginDir?: string;
  mode?: "build" | "dev";
  /** 接続先（検証済み。APP_URL などの元。無ければ既定） */
  baseUrl?: string;
  /**
   * ユーザー情報: "default" = 既定のテストデータ（架空の 10 人。formula の写し。ログインユーザーは authoring）。省略はログインユーザー 1 人だけ（今までどおり）。
   * お試しアプリ（try）が使う（print-craft の docs/authoring-try-plan.md 4.1）
   */
  users?: "default";
  /** kind "formulas": 評価する式（1 回 MAX_JOB_FORMULAS まで） */
  formulas?: string[];
  /** kind "normalize": 設定と項目定義（normalizeSettings の入力。エンジンは子プロセスが読む） */
  normalize?: {
    settingsText: string;
    settingsFile?: string;
    fields: FieldsFile;
    policy?: Policy;
    check?: boolean;
  };
  /** kind "preview": 設定・項目定義・レコード（runPreview の入力。エンジンは子プロセスが読む） */
  preview?: {
    settingsText: string;
    settingsFile?: string;
    fields: FieldsFile;
    /** レコードのファイルの中身（record コマンドの出力など。形は runPreview が確かめる） */
    recordFile: unknown;
    policy?: Policy;
    button?: string;
    /** 一覧帳票のボタンを描くときの一覧のレコード（runPreview の listRecords） */
    listRecords?: unknown[];
  };
  /** kind "try": お試しアプリの入力（commands/try.ts の TryInput。子プロセスでも validateTryInput で確かめる） */
  try?: unknown;
}

/** kind "preview" の結果（runPreview の結果。findings は Finding の配列で返し、親が Findings に直す） */
export interface PreviewOutcome {
  findings: Finding[];
  results: Array<RenderedButton & { file: string }>;
  skipped: string[];
  summary: string;
}

/** kind "normalize" の結果（normalizeSettings の結果。findings は Finding の配列で返し、親が Findings に直す） */
export interface NormalizeOutcome {
  findings: Finding[];
  output?: Record<string, unknown>;
  body?: Record<string, unknown>;
  size?: StoredSize;
  checkDiffs?: string[];
  summary: string;
}

/** 1 つの式の結果 */
export interface FormulaEvalResult {
  /** 帳票の ${…} に差し込む文字（null / undefined は空）。大きすぎれば無い（tooLarge） */
  text?: string;
  /** エンジンの生の値（JSON にできる形に直したもの。text と同じ文字なら省く） */
  raw?: JsonValue;
  /** エンジンが式の評価として返したエラーの文（dq の呼び出しの直近の catch だけ。上限 MAX_ERROR_CHARS 字） */
  evaluationError?: string;
  /** 結果の文字が MAX_VALUE_BYTES を超えた */
  tooLarge?: boolean;
  /** 評価の後（文字や JSON への直し）で失敗した（文は返さない） */
  convertFailed?: boolean;
}

export interface EvalOutcome {
  formulas?: FormulaEvalResult[];
  normalize?: NormalizeOutcome;
  preview?: PreviewOutcome;
  try?: TryOutcome;
  /** 読み込んだエンジン（版と SHA-256） */
  engine: { pluginVersion: string; apiVersion: number; engineSha256: string; decimalSha256?: string };
  /** エンジンの読み込みの注意 */
  engineWarnings: string[];
  /** 診断（結果の外。テストが子プロセスで評価されたことを確かめる） */
  diag: {
    /** 評価したプロセスの ID（inline と thread は親と同じ） */
    pid: number;
    /** 評価したスレッド（主スレッドは 0。thread は Worker の番号） */
    threadId: number;
    /** 分け方（親が入れる。inline は無い） */
    isolation?: "process" | "thread";
    /** 子プロセスの標準出力・標準エラーの文字数（親が数える。中身は流さない・返さない） */
    stdoutChars: number;
    stderrChars: number;
    /** 評価したプロセスの RSS の最大（MiB。process.resourceUsage().maxRSS。inline は親の値） */
    maxRssMb?: number;
    /** 大きすぎて生の値を省いた */
    rawDropped?: boolean;
  };
}

/**
 * 子プロセスの中の誤りの種類（中核のクラスの instanceof で決める。zip のコードが name を偽装しても input / zip にならない）:
 * input（中核の InputError）、zip（PluginZipError。code 付き）、policy（PolicyError）、other（zip のコードの例外など）。
 * other の文は子プロセスから送らない（値やパスを含みうる。応答にもログにも出さない。計画 4.5）
 */
export type EvalErrorKind = "input" | "zip" | "policy" | "other";

export type EvalMessage = { ok: true; outcome: EvalOutcome } | { ok: false; error: { kind: EvalErrorKind; name: string; message: string; code?: string } };

/** 1 回の仕事の式の数 */
export const MAX_JOB_FORMULAS = 10;
/** 1 つの式の結果の文字の上限（UTF-8 のバイト数。計画 4.2） */
export const MAX_VALUE_BYTES = 262_144;
/** エラーの文の上限（字。計画 4.2・4.5） */
export const MAX_ERROR_CHARS = 1_000;
/** 子プロセスからのメッセージの上限（UTF-8 のバイト数。計画 4.2。kind formulas と try） */
export const MAX_MESSAGE_BYTES = 4_194_304;
/** preview（利用者のレコードの帳票）のメッセージの上限（UTF-8 のバイト数。工程表 1,000 行・36 ページでも収まる大きさ。超えたら描いた帳票を返さない） */
export const MAX_PREVIEW_MESSAGE_BYTES = 33_554_432;
