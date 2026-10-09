/**
 * take [--profile <名前>]
 * inbox/ に置いた設定のダウンロード（rex0220-print-craft-app<番号>-<日時>.json。名前はそのまま）を、封筒の appId で
 * アプリのフォルダー kintone/<profile>/<番号>-<アプリ名>/ に移す（2026-10-05 Takashi「ダウンロードのファイル名をそのまま使いたい」）。
 * ダウンロードにはドメインが入っていないので、profile はほかのコマンドと同じ選び方（--profile、無ければ defaultProfile、無ければ dev。15.2）。
 * フォルダーが無ければ作り、中身より先に印を置く（15.5）。印が合わないフォルダーには置かない。
 * 印刷屋の設定でないファイル、ファイル名の番号と封筒の appId が違うファイル、行き先に同じ名前の別の中身があるファイルは移さない（理由を出す）
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { readJsonLimited } from "./normalize.ts";
import { realResolve, resolveRead, resolveWrite, WRITE_ROOTS } from "../safe-path.ts";
import { assertChangeAllowed, PermissionError } from "../permission.ts";
import { FileExistsError, withRetry, writeNewFile } from "../commit-file.ts";
import { ConnectionError, pickProfile } from "../connections.ts";
import { appDirFor, assertAppMark, assertInsideWorkspace, ensureAppFolder, INBOX, requireProfiles, SNAPSHOT_RE, type WorkspaceMode } from "../workspace.ts";

/** 印刷屋の設定の封筒の pluginID（印刷屋の PLUGIN_ID_NAME と同じ。engine の api.pluginId で確かめている） */
export const PRINT_CRAFT_PLUGIN_ID = "rex0220 Print craft plugin";

export interface TakeResult {
  /** leftInInbox: 行き先には置いたが inbox の元を消せなかった（消してよい。次の take でも「同じもの」として消す） */
  moved: Array<{ file: string; to: string; same: boolean; leftInInbox?: boolean }>;
  skipped: Array<{ file: string; reason: string }>;
  /** 置いたが一時ファイルを消せなかった、など（移したことは変わらない） */
  warnings: string[];
}

/** inbox の元を消す（Windows の EPERM / EBUSY は短く待ってやり直す）。消せなければ false（行き先には置いてある） */
function removeSource(src: string, warnings: string[], rel: string): boolean {
  try {
    withRetry(() => unlinkSync(src));
    return true;
  } catch (e) {
    warnings.push(`${rel} は行き先に置いたが、inbox から消せなかった（${(e as NodeJS.ErrnoException).code ?? (e as Error).message}）。消してよい`);
    return false;
  }
}

export function takeInbox(cwdIn: string, mode: WorkspaceMode, profile?: string): TakeResult {
  // profile の形でなければ止める（未設定・移行で止まっている）。profile は 15.2 の選び方（決まらなければ誤り）
  const connections = requireProfiles(mode, "take");
  const def = pickProfile(connections.set, profile);
  // 作業フォルダーを最初に実際のパスに直す（移した先は実際のパスなので、相対パスの表示がずれないように。macOS の /var → /private/var）
  const cwd = realResolve(".", cwdIn);
  const result: TakeResult = { moved: [], skipped: [], warnings: [] };
  const inbox = path.join(cwd, INBOX);
  if (!existsSync(inbox)) return result;
  // inbox の実体が作業フォルダーの中か（外への symlink なら、外のファイルの名前を出さずに止める。B1 の Codex レビュー BLOCKER 1）
  assertInsideWorkspace(cwd, inbox);
  for (const name of readdirSync(inbox).filter((n) => n.toLowerCase().endsWith(".json")).sort()) {
    const rel = `${INBOX}/${name}`;
    const src = resolveRead(rel, cwd);
    let data: Record<string, unknown>;
    try {
      data = readJsonLimited(src);
    } catch (e) {
      result.skipped.push({ file: rel, reason: (e as Error).message });
      continue;
    }
    if (data.pluginID !== PRINT_CRAFT_PLUGIN_ID) {
      result.skipped.push({ file: rel, reason: "印刷屋の設定のファイルではない（pluginID が違う）" });
      continue;
    }
    const appId = data.appId;
    if (typeof appId !== "number" || !Number.isInteger(appId) || appId <= 0) {
      result.skipped.push({ file: rel, reason: "封筒の appId が無い" });
      continue;
    }
    // 取り込むのはダウンロードの名前（rex0220-print-craft-app<番号>-<日時>.json）のファイルだけ（Codex レビュー MAJOR 3。名前は変えずに置く）
    if (!SNAPSHOT_RE.test(name)) {
      result.skipped.push({ file: rel, reason: "ダウンロードの名前（rex0220-print-craft-app<番号>-<日時>.json）ではない。設定画面のダウンロードの名前のまま inbox/ に置く" });
      continue;
    }
    const m = name.match(/-app(\d+)-/);
    if (m && Number(m[1]) !== appId) {
      result.skipped.push({ file: rel, reason: `ファイル名のアプリ ${m[1]} と封筒の appId ${appId} が違う` });
      continue;
    }
    const dir = appDirFor(cwd, def.profile, appId, typeof data.appName === "string" ? data.appName : "");
    const dest = resolveWrite(path.join(dir, name), WRITE_ROOTS.kintone, cwd);
    const text = readFileSync(src, "utf8");
    // 今あるフォルダーは、中のファイルを読む（同じ中身か比べる）前に印を確かめる（印の無い・合わないフォルダーの中は読まない。15.5）
    if (existsSync(dir)) {
      try {
        assertAppMark(dir, def, appId);
      } catch (e) {
        if (!(e instanceof ConnectionError)) throw e;
        result.skipped.push({ file: rel, reason: e.message });
        continue;
      }
    }
    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") !== text) {
        result.skipped.push({ file: rel, reason: `行き先に同じ名前の別の中身がある: ${path.relative(cwd, dest)}` });
        continue;
      }
      const removed = removeSource(src, result.warnings, rel);
      result.moved.push({ file: rel, to: path.relative(cwd, dest), same: true, ...(removed ? {} : { leftInInbox: true }) });
      continue;
    }
    // 新しい名前のダウンロードを足すことだけ（permission.ts。profile、印、接続のファイルを読み直して接続が同じか）。フォルダーが無ければ印を置いてから作る（15.5）。
    // 確定の直前にも確かめ直し、新しいファイルとしてだけ置く（確かめた後に同じ名前ができても上書きしない。Codex 再レビュー BLOCKER 2）。inbox の元は置けてから消す
    try {
      assertChangeAllowed(cwd, dest, "snapshot", mode);
      ensureAppFolder(dir, def, appId);
      const { cleanup } = writeNewFile(dest, text, () => {
        if (resolveWrite(path.join(dir, name), WRITE_ROOTS.kintone, cwd) !== dest) throw new PermissionError(`書く先のフォルダーが途中で変わった（symlink など）: ${path.relative(cwd, dest)}`);
        assertChangeAllowed(cwd, dest, "snapshot", mode);
      });
      for (const c of cleanup) result.warnings.push(`${rel} は行き先に置いたが、一時ファイルを消せなかった（${c}）。${path.relative(cwd, path.dirname(dest))} の .${name}.*.tmp を消してよい`);
    } catch (e) {
      if (e instanceof PermissionError || e instanceof ConnectionError) {
        result.skipped.push({ file: rel, reason: e.message });
        continue;
      }
      if (e instanceof FileExistsError) {
        result.skipped.push({ file: rel, reason: `行き先に同じ名前のファイルができた（移す途中で）: ${path.relative(cwd, dest)}。もう一度 take する` });
        continue;
      }
      throw e;
    }
    const removed = removeSource(src, result.warnings, rel);
    result.moved.push({ file: rel, to: path.relative(cwd, dest), same: false, ...(removed ? {} : { leftInInbox: true }) });
  }
  return result;
}
