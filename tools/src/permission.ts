/**
 * kintone/ の下を変える前の許可（段階 0-2。print-craft-authoring-mcp の docs/permission-table.md 4.2、実装案 13.3）。
 *   - 変える直前に environments.json を読み直す（起動のときの値を使い続けない。消す・名前を変えることで本番の保護を外せないように）。
 *     呼ぶ側は、判定を早めに 1 回（通信や normalize の前に止めるため）、実際に書く直前にもう 1 回行う（Codex レビュー BLOCKER 2）
 *   - 操作 × 対象のパス（Codex レビュー MAJOR 3）: 操作ごとに、アプリのフォルダーの中で書いてよい場所を決める
 *       settings（normalize の書き戻し、保存、ボタンの差し替え、edit）… -edit.json と新しい帳票（その他の *.json）
 *       snapshot（pull、take）… 新しい名前のダウンロード / pull（rex0220-print-craft-app<番号>-<日時>.json。既にあれば不可）
 *       fields … fields.json、record … records/ の下の *.json、preview … out/ の下
 *   - 役割: 未分類（role が無い環境、environments.json が無いのに kintone/ の下、どの環境にも合わないフォルダー）は何も変えない。
 *     本番（production）は snapshot だけ。開発（development）は上の表のとおり
 * kintone/ の外（settings/ fields/ records/ out/ temp/）は環境に依らない（書ける場所は操作ごとに safe-path.ts の WRITE_ROOTS が決める）。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { isInside } from "./safe-path.ts";
import { EDIT_RE, KINTONE_ROOT, SNAPSHOT_RE, WORKSPACE_FILE, appFolderOfFile, envOfAppFolder, loadWorkspace, type EnvRole } from "./workspace.ts";

export class PermissionError extends Error {}

export type ChangeOp = "settings" | "snapshot" | "fields" | "record" | "preview";

/** アプリのフォルダーの中の場所（docs/permission-table.md の P4〜P9） */
export type TargetClass = "snapshot" | "edit" | "report" | "fields" | "record" | "out" | "other";

const ALLOWED_CLASSES: Record<ChangeOp, readonly TargetClass[]> = {
  settings: ["edit", "report"],
  snapshot: ["snapshot"],
  fields: ["fields"],
  record: ["record"],
  preview: ["out"]
};

const OP_LABEL: Record<ChangeOp, string> = {
  settings: "設定（-edit.json と新しい帳票）",
  snapshot: "新しい名前のダウンロード / pull",
  fields: "fields.json",
  record: "records/ の下",
  preview: "out/ の下"
};

export interface TargetRole {
  role: EnvRole;
  /** 環境の名前（分かるとき） */
  envName?: string;
  /** 未分類の理由 */
  why?: string;
  /** アプリのフォルダーの中の場所（フォルダーが分かるとき） */
  cls?: TargetClass;
}

/** アプリのフォルダーからの相対パスで場所を分ける */
export function classOfAppPath(relInFolder: string): TargetClass {
  const rel = relInFolder.replace(/\\/g, "/");
  if (rel.startsWith("records/")) return rel.toLowerCase().endsWith(".json") ? "record" : "other";
  if (rel.startsWith("out/")) return "out";
  if (rel.includes("/")) return "other";
  if (rel === "fields.json") return "fields";
  if (SNAPSHOT_RE.test(rel)) return "snapshot";
  if (EDIT_RE.test(rel)) return "edit";
  if (rel.toLowerCase().endsWith(".json")) return "report";
  return "other";
}

/** kintone/ の下のファイルの環境・役割・場所（kintone/ の外なら null）。environments.json はその場で読む */
export function roleOfTarget(root: string, file: string): TargetRole | null {
  const abs = path.resolve(root, file);
  if (!isInside(abs, path.join(root, KINTONE_ROOT))) return null;
  const ws = loadWorkspace(root);
  const folder = appFolderOfFile(root, abs);
  const cls = folder ? classOfAppPath(path.relative(folder.dir, abs)) : undefined;
  if (!ws) return { role: "unclassified", why: `${WORKSPACE_FILE} が無い`, cls };
  if (!folder) return { role: "unclassified", why: "アプリのフォルダー（kintone/<ホスト名>/<番号>-…/）の中でない" };
  const env = envOfAppFolder(ws, folder.host, folder.appId);
  // 同じホストの環境が 2 つ以上（構成 2）で apps に無い番号は、開発か本番か決まらない。--env（AI が付けられる引数）では決めない（本番の保護を外せないように）
  if (!env) return { role: "unclassified", why: `フォルダー（${folder.host} のアプリ ${folder.appId}）がどの環境のものか ${WORKSPACE_FILE} から決まらない（同じホストの環境が 2 つ以上あるときは、apps にアプリの番号を足す）`, cls };
  return env.role === "unclassified" ? { role: "unclassified", envName: env.name, why: `環境「${env.name}」に role が無い`, cls } : { role: env.role, envName: env.name, cls };
}

/** kintone/ の下をこの操作で変えてよいか。だめなら PermissionError（決まった文） */
export function assertChangeAllowed(root: string, file: string, op: ChangeOp): void {
  const target = roleOfTarget(root, file);
  if (!target) return;
  const abs = path.resolve(root, file);
  if (target.role === "unclassified") {
    throw new PermissionError(`${target.why}ので kintone/ の下を変更できない。${WORKSPACE_FILE} の環境に role（development か production）を書く（利用者が書く）`);
  }
  if (target.role === "production" && op !== "snapshot") {
    throw new PermissionError(`環境「${target.envName}」は本番（role: production）なので変更できない。開発の環境で作る・直す（本番のフォルダーは pull / ダウンロードで今の設定を見るだけ）`);
  }
  const cls = target.cls ?? "other";
  if (cls === "snapshot" && existsSync(abs)) {
    throw new PermissionError(`ダウンロード / pull のファイルは書き換えない: ${path.relative(root, abs)}。edit で -edit.json に写して直す`);
  }
  if (!ALLOWED_CLASSES[op].includes(cls)) {
    throw new PermissionError(`この操作でアプリのフォルダーに書けるのは ${OP_LABEL[op]} だけ: ${path.relative(root, abs)}`);
  }
}
