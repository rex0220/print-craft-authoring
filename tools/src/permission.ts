/**
 * kintone/ の下を変える前の許可（段階 0-2 の段 3。print-craft-authoring-mcp の docs/permission-table.md 4.2、実装案 13.3）。
 *   - 変える直前に environments.json を読み直す（起動のときの値を使い続けない。消す・名前を変えることで本番の保護を外せないように）
 *   - 開発（development）: ダウンロード / pull のファイルの書き換えだけ拒否
 *   - 本番（production）: 新しい名前のダウンロード / pull を足すこと（pull、take）だけ許す
 *   - 未分類（role が無い環境、environments.json が無いのに kintone/ の下、どの環境にも合わないフォルダー）: すべての変更を拒否
 * kintone/ の外（settings/ fields/ records/ out/ temp/）は環境に依らない（書ける場所は safe-path.ts が決める）。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { isInside } from "./safe-path.ts";
import { KINTONE_ROOT, SNAPSHOT_RE, WORKSPACE_FILE, appFolderOfFile, envOfAppFolder, loadWorkspace, type EnvRole } from "./workspace.ts";

export class PermissionError extends Error {}

/** write = 書く・書き換える（fields、record、normalize の書き戻し、preview、edit、pull --force）、add-snapshot = 新しい名前のダウンロード / pull を足す（pull、take） */
export type ChangeKind = "write" | "add-snapshot";

export interface TargetRole {
  role: EnvRole;
  /** 環境の名前（分かるとき） */
  envName?: string;
  /** 未分類の理由 */
  why?: string;
}

/** kintone/ の下のファイルの環境と役割（kintone/ の外なら null）。environments.json はその場で読む */
export function roleOfTarget(root: string, file: string): TargetRole | null {
  const abs = path.resolve(root, file);
  if (!isInside(abs, path.join(root, KINTONE_ROOT))) return null;
  const ws = loadWorkspace(root);
  if (!ws) return { role: "unclassified", why: `${WORKSPACE_FILE} が無い` };
  const folder = appFolderOfFile(root, abs);
  if (!folder) return { role: "unclassified", why: "アプリのフォルダー（kintone/<ホスト名>/<番号>-…/）の中でない" };
  const env = envOfAppFolder(ws, folder.host, folder.appId);
  // 同じホストの環境が 2 つ以上（構成 2）で apps に無い番号は、開発か本番か決まらない。--env（AI が付けられる引数）では決めない（本番の保護を外せないように）
  if (!env) return { role: "unclassified", why: `フォルダー（${folder.host} のアプリ ${folder.appId}）がどの環境のものか ${WORKSPACE_FILE} から決まらない（同じホストの環境が 2 つ以上あるときは、apps にアプリの番号を足す）` };
  return env.role === "unclassified" ? { role: "unclassified", envName: env.name, why: `環境「${env.name}」に role が無い` } : { role: env.role, envName: env.name };
}

/** kintone/ の下を変えてよいか。だめなら PermissionError（決まった文） */
export function assertChangeAllowed(root: string, file: string, kind: ChangeKind): void {
  const target = roleOfTarget(root, file);
  if (!target) return;
  const abs = path.resolve(root, file);
  const name = path.basename(abs);
  const isSnapshot = SNAPSHOT_RE.test(name);
  if (target.role === "unclassified") {
    throw new PermissionError(`${target.why}ので kintone/ の下を変更できない。${WORKSPACE_FILE} の環境に role（development か production）を書く（利用者が書く）`);
  }
  if (target.role === "production") {
    if (kind === "add-snapshot" && isSnapshot && !existsSync(abs)) return;
    throw new PermissionError(`環境「${target.envName}」は本番（role: production）なので変更できない。開発の環境で作る・直す（本番のフォルダーは pull / ダウンロードで今の設定を見るだけ）`);
  }
  if (isSnapshot && existsSync(abs)) {
    throw new PermissionError(`ダウンロード / pull のファイルは書き換えない: ${path.relative(root, abs)}。edit で -edit.json に写して直す`);
  }
}
