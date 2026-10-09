/**
 * take [--env <名前>]
 * inbox/ に置いた設定のダウンロード（rex0220-print-craft-app<番号>-<日時>.json。名前はそのまま）を、封筒の appId と environments.json から
 * アプリのフォルダー kintone/<ホスト名>/<番号>-<アプリ名>/ に移す（2026-10-05 Takashi「ダウンロードのファイル名をそのまま使いたい」）。
 * ダウンロードにはドメインが入っていないので、環境は apps の番号から決める。同じ番号が 2 つの環境にあるとき・apps に無い番号で環境が 2 つ以上あるときは --env が要る。
 * 印刷屋の設定でないファイル、ファイル名の番号と封筒の appId が違うファイル、行き先に同じ名前の別の中身があるファイルは移さない（理由を出す）
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { readJsonLimited } from "./normalize.ts";
import { realResolve, resolveRead, resolveWrite, WRITE_ROOTS } from "../safe-path.ts";
import { assertChangeAllowed, PermissionError } from "../permission.ts";
import { FileExistsError, withRetry, writeNewFile } from "../commit-file.ts";
import { appDirFor, INBOX, SNAPSHOT_RE, type EnvironmentDef, type Workspace } from "../workspace.ts";

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

function envFor(ws: Workspace, appId: number, envName?: string): EnvironmentDef | string {
  if (envName) return ws.environments[envName] ?? `環境「${envName}」は environments.json に無い`;
  const hits = Object.values(ws.environments).filter((e) => ws.apps.some((a) => a.ids[e.name] === appId));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return `アプリ ${appId} が ${hits.map((e) => e.name).join(" と ")} の両方にある。--env で選ぶ`;
  const all = Object.values(ws.environments);
  if (all.length === 1) return all[0];
  return `アプリ ${appId} は environments.json の apps に無く、環境が 2 つ以上ある。apps に足すか --env で選ぶ`;
}

export function takeInbox(cwdIn: string, ws: Workspace, envName?: string): TakeResult {
  // 作業フォルダーを最初に実際のパスに直す（移した先は実際のパスなので、相対パスの表示がずれないように。macOS の /var → /private/var）
  const cwd = realResolve(".", cwdIn);
  const result: TakeResult = { moved: [], skipped: [], warnings: [] };
  const inbox = path.join(cwd, INBOX);
  if (!existsSync(inbox)) return result;
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
    const env = envFor(ws, appId, envName);
    if (typeof env === "string") {
      result.skipped.push({ file: rel, reason: env });
      continue;
    }
    const dir = appDirFor(cwd, env, appId, typeof data.appName === "string" ? data.appName : "");
    const dest = resolveWrite(path.join(dir, name), WRITE_ROOTS.kintone, cwd);
    const text = readFileSync(src, "utf8");
    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") !== text) {
        result.skipped.push({ file: rel, reason: `行き先に同じ名前の別の中身がある: ${path.relative(cwd, dest)}` });
        continue;
      }
      const removed = removeSource(src, result.warnings, rel);
      result.moved.push({ file: rel, to: path.relative(cwd, dest), same: true, ...(removed ? {} : { leftInInbox: true }) });
      continue;
    }
    // 本番は新しい名前のダウンロードを足すことだけ、未分類は何も変えない（permission.ts）。確定の直前にも確かめ直し、
    // 新しいファイルとしてだけ置く（確かめた後に同じ名前ができても上書きしない。Codex 再レビュー BLOCKER 2）。inbox の元は置けてから消す
    try {
      assertChangeAllowed(cwd, dest, "snapshot");
      mkdirSync(path.dirname(dest), { recursive: true });
      const { cleanup } = writeNewFile(dest, text, () => {
        if (resolveWrite(path.join(dir, name), WRITE_ROOTS.kintone, cwd) !== dest) throw new PermissionError(`書く先のフォルダーが途中で変わった（symlink など）: ${path.relative(cwd, dest)}`);
        assertChangeAllowed(cwd, dest, "snapshot");
      });
      for (const c of cleanup) result.warnings.push(`${rel} は行き先に置いたが、一時ファイルを消せなかった（${c}）。${path.relative(cwd, path.dirname(dest))} の .${name}.*.tmp を消してよい`);
    } catch (e) {
      if (e instanceof PermissionError) {
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
