/**
 * 保存の約束（段階 0-2 の段 5。print-craft-authoring-mcp の実装案 5.3。print-craft MCP の pcraft_save_settings / pcraft_update_button の本体）。
 *   - 新しい設定（saveNewSettings）: 同じ名前のファイルがあれば conflict（上書きしない）
 *   - 既存の設定のボタン 1 つ（updateButton）: 読んだ時点の digest（expectedDigest）を確かめ、違えば conflict。ボタンは menu の名前で選ぶ。
 *     無ければ末尾に足す
 *   - 確定の仕方: 確定先と同じフォルダーに一時ファイル → normalize（エラーが 1 つでもあれば確定しない）→ 名前を付け替える直前に
 *     書ける場所・environments.json の role・ダウンロードのファイル・digest をもう一度確かめる → 名前の付け替えで確定。失敗したら一時ファイルを消す
 *   - 警告は確定を止めない（findings で返す）
 * パスは作業フォルダーからの相対で受け取る（..・絶対パス・ドライブ名は safe-path.ts が止める）。
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Engine } from "../engine.ts";
import type { Policy } from "../normalize/policy.ts";
import type { Finding } from "../normalize/findings.ts";
import { WRITE_ROOTS, resolveRead, resolveWrite } from "../safe-path.ts";
import { assertChangeAllowed } from "../permission.ts";
import { SNAPSHOT_RE, appFolderOfFile } from "../workspace.ts";
import { normalizeSettings, readFieldsFile } from "./normalize.ts";

export type SaveStatus = "ok" | "invalid" | "conflict" | "denied";

export interface SaveResult {
  status: SaveStatus;
  /** 作業フォルダーからの相対パス（区切りは /） */
  path: string;
  /** 確定したファイルの digest（sha256。ok のとき） */
  digest?: string;
  findings: Finding[];
  /** status が ok でないときの理由（決まった文） */
  message?: string;
}

export interface SaveContext {
  /** 作業フォルダーの実際のパス（WorkContext.root） */
  root: string;
  engine: Engine;
  policy: Policy;
  /** iframe の同一オリジンの判定に使う接続先（検証済み） */
  baseUrl?: string;
}

/** ファイルの digest（sha256。pcraft_buttons が返し、pcraft_update_button が照合する） */
export function digestOf(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

const rel = (root: string, abs: string): string => path.relative(root, abs).replace(/\\/g, "/");

/** 項目定義: アプリのフォルダーの中なら同じフォルダーの fields.json、それ以外は引数の fields が要る */
function fieldsFileFor(ctx: SaveContext, target: string, fields: string | undefined): string {
  if (fields) return resolveRead(fields, ctx.root);
  const folder = appFolderOfFile(ctx.root, target);
  if (!folder) throw new SaveDenied(`fields（項目定義のファイル）が要る（アプリのフォルダー kintone/<ホスト名>/<番号>-…/ の中なら同じフォルダーの fields.json を使う）`);
  return resolveRead(path.join(folder.dir, "fields.json"), ctx.root);
}

class SaveDenied extends Error {}

/** 確定先と同じフォルダーに一時ファイルを書き、確かめ直してから名前を付け替える */
function commit(ctx: SaveContext, target: string, text: string, recheck: () => void): string {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    // 名前を付け替える直前にもう一度: 書ける場所（symlink の差し替えを含む）、role、ダウンロードのファイル、digest
    resolveWrite(rel(ctx.root, target), WRITE_ROOTS.settings, ctx.root);
    assertChangeAllowed(ctx.root, target, "write");
    if (SNAPSHOT_RE.test(path.basename(target))) throw new SaveDenied("ダウンロード / pull のファイルは書き換えない。edit で -edit.json に写して直す");
    recheck();
    renameSync(tmp, target);
    return digestOf(text);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true });
  }
}

async function normalizeText(ctx: SaveContext, target: string, text: string, fields: string | undefined) {
  const fieldsData = await readFieldsFile(fieldsFileFor(ctx, target, fields));
  ctx.engine.setContext({ baseUrl: ctx.baseUrl ?? "https://example.cybozu.com", appId: fieldsData.appId });
  return normalizeSettings({ settingsText: text, settingsFile: rel(ctx.root, target), fields: fieldsData, engine: ctx.engine, policy: ctx.policy, baseUrl: ctx.baseUrl });
}

function deniedResult(root: string, target: string, e: unknown): SaveResult {
  return { status: "denied", path: rel(root, target), findings: [], message: e instanceof Error ? e.message : String(e) };
}

/** 新しい設定を保存する（同じ名前のファイルがあれば conflict） */
export async function saveNewSettings(ctx: SaveContext, opt: { path: string; content: string; fields?: string }): Promise<SaveResult> {
  let target: string;
  try {
    target = resolveWrite(opt.path, WRITE_ROOTS.settings, ctx.root);
    if (SNAPSHOT_RE.test(path.basename(target))) throw new SaveDenied("ダウンロード / pull の名前（rex0220-print-craft-app<番号>-<日時>.json）では新しく保存しない");
    assertChangeAllowed(ctx.root, target, "write");
  } catch (e) {
    return deniedResult(ctx.root, path.resolve(ctx.root, opt.path), e);
  }
  if (existsSync(target)) return { status: "conflict", path: rel(ctx.root, target), findings: [], message: "同じ名前のファイルがある（新しい設定の保存は上書きしない。直すなら pcraft_update_button）" };
  let result;
  try {
    result = await normalizeText(ctx, target, opt.content, opt.fields);
  } catch (e) {
    return deniedResult(ctx.root, target, e);
  }
  if (!result.output) return { status: "invalid", path: rel(ctx.root, target), findings: result.findings.items, message: "normalize のエラーがあるので保存しない" };
  try {
    const digest = commit(ctx, target, JSON.stringify(result.output, null, 2) + "\n", () => {
      if (existsSync(target)) throw new ConflictError("確定の直前に同じ名前のファイルができた");
    });
    return { status: "ok", path: rel(ctx.root, target), digest, findings: result.findings.items };
  } catch (e) {
    if (e instanceof ConflictError) return { status: "conflict", path: rel(ctx.root, target), findings: result.findings.items, message: e.message };
    return deniedResult(ctx.root, target, e);
  }
}

class ConflictError extends Error {}

/**
 * 既存の設定のボタン 1 つを差し替える（無ければ末尾に足す）。expectedDigest は pcraft_buttons が返した値。
 * replacement はボタン 1 つ（pluginInfos の 1 行）の JSON。その menu が button と違えば invalid
 */
export async function updateButton(ctx: SaveContext, opt: { path: string; button: string; expectedDigest: string; replacement: string; fields?: string }): Promise<SaveResult> {
  let target: string;
  try {
    target = resolveRead(opt.path, ctx.root);
    resolveWrite(opt.path, WRITE_ROOTS.settings, ctx.root);
    if (SNAPSHOT_RE.test(path.basename(target))) throw new SaveDenied("ダウンロード / pull のファイルは書き換えない。edit で -edit.json に写して直す");
    assertChangeAllowed(ctx.root, target, "write");
  } catch (e) {
    return deniedResult(ctx.root, path.resolve(ctx.root, opt.path), e);
  }
  if (!existsSync(target)) return { status: "conflict", path: rel(ctx.root, target), findings: [], message: "ファイルが無い（新しい設定なら pcraft_save_settings）" };
  const current = readFileSync(target);
  if (digestOf(current) !== opt.expectedDigest) return { status: "conflict", path: rel(ctx.root, target), findings: [], message: "読んだ後にファイルが変わった（digest が違う）。pcraft_buttons で読み直す" };
  let settings: Record<string, unknown>;
  let replacement: Record<string, unknown>;
  try {
    settings = JSON.parse(current.toString("utf8")) as Record<string, unknown>;
    replacement = JSON.parse(opt.replacement) as Record<string, unknown>;
  } catch (e) {
    return { status: "invalid", path: rel(ctx.root, target), findings: [], message: `JSON として読めない: ${(e as Error).message}` };
  }
  if (!replacement || typeof replacement !== "object" || Array.isArray(replacement) || replacement.menu !== opt.button) {
    return { status: "invalid", path: rel(ctx.root, target), findings: [], message: "replacement はボタン 1 つ（pluginInfos の 1 行）のオブジェクトで、menu が button と同じ" };
  }
  const rows = Array.isArray(settings.pluginInfos) ? [...(settings.pluginInfos as Array<Record<string, unknown>>)] : [];
  const i = rows.findIndex((r) => r && r.menu === opt.button);
  if (i >= 0) rows[i] = replacement;
  else rows.push(replacement);
  let result;
  try {
    result = await normalizeText(ctx, target, JSON.stringify({ ...settings, pluginInfos: rows }), opt.fields);
  } catch (e) {
    return deniedResult(ctx.root, target, e);
  }
  if (!result.output) return { status: "invalid", path: rel(ctx.root, target), findings: result.findings.items, message: "normalize のエラーがあるので保存しない" };
  try {
    const digest = commit(ctx, target, JSON.stringify(result.output, null, 2) + "\n", () => {
      if (digestOf(readFileSync(target)) !== opt.expectedDigest) throw new ConflictError("確定の直前にファイルが変わった（digest が違う）。pcraft_buttons で読み直す");
    });
    return { status: "ok", path: rel(ctx.root, target), digest, findings: result.findings.items };
  } catch (e) {
    if (e instanceof ConflictError) return { status: "conflict", path: rel(ctx.root, target), findings: result.findings.items, message: e.message };
    return deniedResult(ctx.root, target, e);
  }
}
