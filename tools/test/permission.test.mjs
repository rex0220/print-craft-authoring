/** kintone/ の下を変える前の許可（environments.json の role と、操作 × 場所。段階 0-2。print-craft-authoring-mcp の docs/permission-table.md 4.2） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertChangeAllowed, classOfAppPath, PermissionError, roleOfTarget } from "../src/permission.ts";
import { realResolve } from "../src/safe-path.ts";

const SNAP = "rex0220-print-craft-app3740-20261005-125115.json";
const EDIT = SNAP.replace(".json", "-edit.json");
const ENVS = {
  default: "dev",
  environments: { dev: { baseUrl: "https://dev-x.cybozu.com", role: "development" }, prod: { baseUrl: "https://x.cybozu.com", role: "production" } },
  apps: [{ name: "見積書", dev: 101, prod: 3740 }]
};

/** 作業フォルダーを作り、実際のパスを返す（macOS の /var → /private/var をそろえる） */
function makeWork(envs) {
  const work = realResolve(".", mkdtempSync(path.join(os.tmpdir(), "pcraft-perm-")));
  if (envs) writeFileSync(path.join(work, "environments.json"), JSON.stringify(envs));
  return work;
}

const denied = (fn, re) => assert.throws(fn, (e) => e instanceof PermissionError && re.test(e.message));

test("classOfAppPath: アプリのフォルダーの中の場所（P4〜P9）", () => {
  assert.equal(classOfAppPath(SNAP), "snapshot");
  assert.equal(classOfAppPath(EDIT), "edit");
  assert.equal(classOfAppPath("新しい帳票.json"), "report");
  assert.equal(classOfAppPath("fields.json"), "fields");
  assert.equal(classOfAppPath("records/3.json"), "record");
  assert.equal(classOfAppPath("records/x.txt"), "other");
  assert.equal(classOfAppPath("out/見積書.html"), "out");
  assert.equal(classOfAppPath("sub/a.json"), "other");
  assert.equal(classOfAppPath("a.txt"), "other");
});

test("開発: 操作ごとに書ける場所だけ。ダウンロード / pull のファイルの書き換えは拒否", () => {
  const work = makeWork(ENVS);
  try {
    const dir = path.join(work, "kintone", "dev-x.cybozu.com", "101-見積書");
    mkdirSync(dir, { recursive: true });
    const at = (f) => path.join(dir, f);
    assert.deepEqual(roleOfTarget(work, at("fields.json")), { role: "development", envName: "dev", cls: "fields" });
    // 書ける組み合わせ
    assertChangeAllowed(work, at("fields.json"), "fields");
    assertChangeAllowed(work, at("records/3.json"), "record");
    assertChangeAllowed(work, at("out/見積書.html"), "preview");
    assertChangeAllowed(work, at("rex0220-print-craft-app101-20261005-125115-edit.json"), "settings");
    assertChangeAllowed(work, at("新しい帳票.json"), "settings");
    assertChangeAllowed(work, at("rex0220-print-craft-app101-20261005-125115.json"), "snapshot");
    // 操作と場所が合わない（Codex レビュー MAJOR 3）
    denied(() => assertChangeAllowed(work, at("fields.json"), "settings"), /書けるのは 設定/);
    denied(() => assertChangeAllowed(work, at("rex0220-print-craft-app101-20261005-125116.json"), "settings"), /書けるのは 設定/, "設定の保存でダウンロードの名前を作らない");
    denied(() => assertChangeAllowed(work, at("records/3.json"), "settings"), /書けるのは/);
    denied(() => assertChangeAllowed(work, at("out/x.json"), "settings"), /書けるのは/);
    denied(() => assertChangeAllowed(work, at("新しい帳票.json"), "snapshot"), /新しい名前のダウンロード/);
    denied(() => assertChangeAllowed(work, at("records/3.json"), "fields"), /fields\.json/);
    denied(() => assertChangeAllowed(work, at("fields.json"), "preview"), /out\/ の下/);
    // ダウンロード / pull のファイルは書き換えない
    writeFileSync(at("rex0220-print-craft-app101-20261005-125115.json"), "{}");
    denied(() => assertChangeAllowed(work, at("rex0220-print-craft-app101-20261005-125115.json"), "snapshot"), /書き換えない/);
    denied(() => assertChangeAllowed(work, at("rex0220-print-craft-app101-20261005-125115.json"), "settings"), /書き換えない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("本番: 新しい名前のダウンロード / pull を足すことだけ。直す・書く・上書きは拒否", () => {
  const work = makeWork(ENVS);
  try {
    const dir = path.join(work, "kintone", "x.cybozu.com", "3740-見積書");
    mkdirSync(dir, { recursive: true });
    assertChangeAllowed(work, path.join(dir, SNAP), "snapshot");
    for (const [f, op] of [["fields.json", "fields"], [EDIT, "settings"], ["新しい帳票.json", "settings"], [path.join("records", "3.json"), "record"], [path.join("out", "見積書.html"), "preview"]]) {
      denied(() => assertChangeAllowed(work, path.join(dir, f), op), /本番（role: production）なので変更できない/);
    }
    writeFileSync(path.join(dir, SNAP), "{}");
    denied(() => assertChangeAllowed(work, path.join(dir, SNAP), "snapshot"), /書き換えない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("未分類: role が無い環境、environments.json が無い、どの環境にも合わない、アプリのフォルダーの外 → kintone/ の下は何も変えられない", () => {
  const noRole = makeWork({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com" } } });
  const noEnvs = makeWork(null);
  const work = makeWork(ENVS);
  try {
    denied(() => assertChangeAllowed(noRole, path.join(noRole, "kintone", "dev-x.cybozu.com", "101-見積書", "fields.json"), "fields"), /環境「dev」に role が無い.*role（development か production）を書く/);
    denied(() => assertChangeAllowed(noRole, path.join(noRole, "kintone", "dev-x.cybozu.com", "101-見積書", SNAP), "snapshot"), /role が無い/);
    denied(() => assertChangeAllowed(noEnvs, path.join(noEnvs, "kintone", "x.cybozu.com", "3740-見積書", "a.json"), "settings"), /environments\.json が無い/);
    denied(() => assertChangeAllowed(work, path.join(work, "kintone", "other.cybozu.com", "5-x", "a.json"), "settings"), /どの環境のものか/);
    denied(() => assertChangeAllowed(work, path.join(work, "kintone", "x.cybozu.com", "a.json"), "settings"), /アプリのフォルダー/);
  } finally {
    for (const w of [noRole, noEnvs, work]) rmSync(w, { recursive: true, force: true });
  }
});

test("kintone/ の外は環境に依らない（settings/ fields/ records/ out/ temp/）", () => {
  const noRole = makeWork({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com" } } });
  try {
    for (const [f, op] of [["settings/a.json", "settings"], ["fields/1.json", "fields"], ["records/1-1.json", "record"], ["out/a.html", "preview"], ["temp/a.json", "settings"]]) {
      assert.equal(roleOfTarget(noRole, path.join(noRole, f)), null);
      assertChangeAllowed(noRole, path.join(noRole, f), op);
    }
  } finally {
    rmSync(noRole, { recursive: true, force: true });
  }
});

test("environments.json は変える直前に読み直す（消すと本番の保護を外せない。role を production に変えれば次の判定から止まる）", () => {
  const work = makeWork(ENVS);
  try {
    const devFields = path.join(work, "kintone", "dev-x.cybozu.com", "101-見積書", "fields.json");
    assertChangeAllowed(work, devFields, "fields");
    writeFileSync(path.join(work, "environments.json"), JSON.stringify({ ...ENVS, environments: { ...ENVS.environments, dev: { ...ENVS.environments.dev, role: "production" } } }));
    denied(() => assertChangeAllowed(work, devFields, "fields"), /本番/);
    rmSync(path.join(work, "environments.json"));
    denied(() => assertChangeAllowed(work, devFields, "fields"), /environments\.json が無い/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
