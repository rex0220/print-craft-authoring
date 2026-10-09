/**
 * ファイルの確定とロック（段階 0-2。save.ts の保存、pull と take のダウンロード / pull のファイル。Codex 再レビュー BLOCKER 2、MAJOR 3、4）。
 *   - 新しいファイル（writeNewFile）: 同じフォルダーの一時ファイル（wx）→ 確かめ直し（recheck）→ ハードリンクで確定（同じ名前があれば失敗 = 確かめた後に
 *     作られたファイルも上書きしない。ハードリンクが使えないファイルシステムでは COPYFILE_EXCL のコピー）→ 一時ファイルを消す
 *   - ロック（acquireLock）: 確定先の隣の .<名前>.pcraft-lock に所有者の印（乱数）を書く（wx。symlink があれば失敗する）。
 *     普通のファイルでなければ取らない。60 秒より古いものは、固有の名前に付け替えて（原子的に自分のものにして）から古いかを確かめて消す。
 *     付け替えの間に新しいロックに替わっていたら戻す。外すときと確定の直前は、自分の印のロックかを確かめる（長く止まった後に、他の保存が取り直したロックを消さない・上書きしない）
 *   - 後始末（cleanupAll）: 一時ファイルとロックの片付けは、1 つずつ別に試す（1 つの失敗で残りを飛ばさない）。Windows の EPERM / EBUSY は短く待って 3 回まで。
 *     確定の後の片付けの失敗は、確定の失敗にしない（呼ぶ側が警告として返す）
 * 同じ中核を使う書き込みどうしだけがロックに従う（AI の直接の Write はプラグインのフックで止める）。
 */
import { randomBytes } from "node:crypto";
import { constants, copyFileSync, linkSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync, type Stats } from "node:fs";
import path from "node:path";

export const LOCK_STALE_MS = 60_000;

/** 確定先に同じ名前のファイルが既にある（確かめた後に作られた場合を含む） */
export class FileExistsError extends Error {}
/** 同じファイルへの別の書き込みがロックを持っている */
export class LockBusyError extends Error {}

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const rand = (): string => randomBytes(6).toString("hex");

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 片付けを 1 つずつ試し、失敗の文を返す（一方の失敗で他方を飛ばさない。EPERM / EBUSY は短く待ってやり直す） */
export function cleanupAll(steps: Array<() => void>, tries = 3): string[] {
  const errors: string[] = [];
  for (const step of steps) {
    for (let i = 1; ; i++) {
      try {
        step();
        break;
      } catch (e) {
        const code = errCode(e);
        if (i < tries && (code === "EPERM" || code === "EBUSY")) {
          sleepSync(20 * i);
          continue;
        }
        errors.push(e instanceof Error ? e.message : String(e));
        break;
      }
    }
  }
  return errors;
}

/** 確定先と同じフォルダーの一時ファイルの名前 */
export function tempPathFor(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${rand()}.tmp`);
}

/** 一時ファイルを新しい名前で確定する（同じ名前があれば FileExistsError。上書きしない） */
export function placeNew(tmp: string, target: string): void {
  try {
    linkSync(tmp, target);
    return;
  } catch (e) {
    const code = errCode(e);
    if (code === "EEXIST") throw new FileExistsError(`確定の直前に同じ名前のファイルができた: ${path.basename(target)}`);
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EXDEV" && code !== "ENOSYS") throw e;
  }
  try {
    copyFileSync(tmp, target, constants.COPYFILE_EXCL);
  } catch (e) {
    if (errCode(e) === "EEXIST") throw new FileExistsError(`確定の直前に同じ名前のファイルができた: ${path.basename(target)}`);
    throw e;
  }
}

export interface WriteNewResult {
  /** 確定の後の片付けの失敗（確定はしている） */
  cleanup: string[];
}

/**
 * 新しいファイルとして書く。recheck は一時ファイルを書く前と確定の直前に呼ぶ（書ける場所・許可を確かめ直す。投げれば確定しない）。
 * 同じ名前があれば FileExistsError（確かめた後に作られた場合も）。失敗したら一時ファイルを消す
 */
export function writeNewFile(target: string, text: string, recheck: () => void = () => {}): WriteNewResult {
  const tmp = tempPathFor(target);
  let placed = false;
  let failure: unknown;
  try {
    recheck(); // 一時ファイルを書く前にも（差し替えられたフォルダーに書かない）
    writeFileSync(tmp, text, { encoding: "utf8", flag: "wx" });
    recheck();
    placeNew(tmp, target);
    placed = true;
  } catch (e) {
    failure = e;
  }
  const cleanup = cleanupAll([() => rmSync(tmp, { force: true })]);
  if (!placed) throw failure;
  return { cleanup };
}

export interface Lock {
  /** まだ自分のロックか（確定の直前に確かめる） */
  owned(): boolean;
  /** 自分のロックなら外す（他の保存が取り直したロックは消さない）。外したら true */
  release(): boolean;
}

export function lockPathFor(target: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.pcraft-lock`);
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch (e) {
    if (errCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** 確定先のロックを取る。取れなければ LockBusyError */
export function acquireLock(target: string, staleMs = LOCK_STALE_MS): Lock {
  const file = lockPathFor(target);
  const token = randomBytes(16).toString("hex");
  const busy = (why = "同じファイルへの別の保存が進行中。少し待ってからやり直す"): LockBusyError => new LockBusyError(why);
  const tryCreate = (): boolean => {
    try {
      writeFileSync(file, token, { flag: "wx" });
      return true;
    } catch (e) {
      if (errCode(e) === "EEXIST") return false;
      throw e;
    }
  };
  const isStale = (st: Stats): boolean => Date.now() - st.mtimeMs > staleMs;
  if (!tryCreate()) {
    const st = lstatOrNull(file);
    if (st && !st.isFile()) throw busy(`ロックのファイルが普通のファイルでない: ${path.basename(file)}（利用者が確かめて消す）`);
    if (st && !isStale(st)) throw busy();
    if (st) {
      // 古いロック: 固有の名前に付け替えて自分のものにしてから、まだ古いかを確かめる
      const aside = `${file}.${rand()}.stale`;
      try {
        renameSync(file, aside);
      } catch (e) {
        if (errCode(e) !== "ENOENT") throw e;
      }
      const moved = lstatOrNull(aside);
      if (moved) {
        if (!moved.isFile() || !isStale(moved)) {
          // 付け替えの間に新しいロックに替わっていた → 戻す（戻せなければ、もう別のロックがある）
          if (moved.isFile()) {
            try {
              linkSync(aside, file);
            } catch {
              // 別のロックがある
            }
          }
          rmSync(aside, { force: true });
          throw busy();
        }
        rmSync(aside, { force: true });
      }
    }
    if (!tryCreate()) throw busy();
  }
  const owned = (): boolean => {
    try {
      const st = lstatSync(file);
      return st.isFile() && readFileSync(file, "utf8") === token;
    } catch {
      return false;
    }
  };
  return {
    owned,
    release: () => {
      if (!owned()) return false;
      rmSync(file, { force: true });
      return true;
    }
  };
}
