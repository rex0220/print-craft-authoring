/** ファイルの確定とロック（commit-file.ts。Codex 再レビュー BLOCKER 2、MAJOR 3、4） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileExistsError, LockBusyError, acquireLock, cleanupAll, lockPathFor, writeNewFile } from "../src/commit-file.ts";
import { realResolve } from "../src/safe-path.ts";

const work = () => realResolve(".", mkdtempSync(path.join(os.tmpdir(), "pcraft-commit-")));
const leftovers = (dir) => readdirSync(dir).filter((n) => n.startsWith("."));
const age = (file, ms) => {
  const t = new Date(Date.now() - ms);
  utimesSync(file, t, t);
};

test("writeNewFile: 新しい名前で確定する。確かめた後に同じ名前ができたら上書きせず FileExistsError。確かめ直しが投げたら書かない。一時ファイルを残さない", () => {
  const dir = work();
  try {
    const target = path.join(dir, "a.json");
    assert.deepEqual(writeNewFile(target, "1"), { cleanup: [] });
    assert.equal(readFileSync(target, "utf8"), "1");
    assert.throws(() => writeNewFile(target, "2"), FileExistsError, "既にあれば上書きしない");
    const raced = path.join(dir, "b.json");
    assert.throws(() => writeNewFile(raced, "mine", () => writeFileSync(raced, "theirs")), FileExistsError);
    assert.equal(readFileSync(raced, "utf8"), "theirs", "確かめた後に作られたファイルを上書きしない");
    assert.throws(() => writeNewFile(path.join(dir, "c.json"), "x", () => {
      throw new Error("許可されない");
    }), /許可されない/);
    assert.ok(!existsSync(path.join(dir, "c.json")));
    assert.deepEqual(leftovers(dir), [], "一時ファイルを残さない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireLock: 取っている間は他が取れない。外すと取れる。外すのは自分の印のロックだけ（他の保存が取り直したロックは消さない）", () => {
  const dir = work();
  try {
    const target = path.join(dir, "a.json");
    const a = acquireLock(target);
    assert.equal(a.owned(), true);
    assert.throws(() => acquireLock(target), (e) => e instanceof LockBusyError && /進行中/.test(e.message));
    assert.equal(a.release(), true);
    assert.ok(!existsSync(lockPathFor(target)));
    const b = acquireLock(target);
    // 長く止まった b のロックを、他の保存が古いとみなして取り直した
    writeFileSync(lockPathFor(target), "someone-else");
    assert.equal(b.owned(), false, "確定の直前に気づける");
    assert.equal(b.release(), false);
    assert.equal(readFileSync(lockPathFor(target), "utf8"), "someone-else", "他の保存のロックを消さない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("acquireLock: 60 秒より古いロックは回収して取る。新しいロックは取らない。普通のファイルでないロック（symlink、フォルダー）は取らず、触らない", () => {
  const dir = work();
  try {
    const target = path.join(dir, "a.json");
    const lock = lockPathFor(target);
    writeFileSync(lock, "old");
    age(lock, 120_000);
    const l = acquireLock(target);
    assert.notEqual(readFileSync(lock, "utf8"), "old", "自分の印に替わる");
    assert.deepEqual(leftovers(dir).filter((n) => n.endsWith(".stale")), [], "回収した古いロックを残さない");
    l.release();
    writeFileSync(lock, "fresh");
    assert.throws(() => acquireLock(target, 60_000), LockBusyError);
    assert.equal(readFileSync(lock, "utf8"), "fresh");
    rmSync(lock);

    const victim = path.join(dir, "victim.txt");
    writeFileSync(victim, "keep");
    symlinkSync(victim, lock);
    age(victim, 120_000);
    assert.throws(() => acquireLock(target), (e) => e instanceof LockBusyError && /普通のファイルでない/.test(e.message));
    assert.equal(readFileSync(victim, "utf8"), "keep", "symlink の先を書き換えない");
    rmSync(lock);
    mkdirSync(lock);
    assert.throws(() => acquireLock(target), /普通のファイルでない/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanupAll: 1 つずつ別に試す（1 つの失敗で残りを飛ばさない）。EPERM / EBUSY はやり直す", () => {
  let tries = 0;
  const busyTwice = () => {
    tries++;
    if (tries < 3) throw Object.assign(new Error("busy"), { code: "EBUSY" });
  };
  assert.deepEqual(cleanupAll([busyTwice]), []);
  assert.equal(tries, 3);
  let second = false;
  const errors = cleanupAll([
    () => {
      throw Object.assign(new Error("消せない"), { code: "EACCES" });
    },
    () => {
      second = true;
    }
  ]);
  assert.deepEqual(errors, ["消せない"]);
  assert.equal(second, true, "前の片付けが失敗しても次を試す");
  let n = 0;
  assert.equal(cleanupAll([() => {
    n++;
    throw Object.assign(new Error("ずっと EPERM"), { code: "EPERM" });
  }]).length, 1);
  assert.equal(n, 3, "やり直しは 3 回まで");
});
