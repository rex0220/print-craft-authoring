/** kintone/ の下を変える前の許可（environments.json の role。段階 0-2 の段 3。print-craft-authoring-mcp の docs/permission-table.md 4.2） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertChangeAllowed, PermissionError, roleOfTarget } from "../src/permission.ts";
import { realResolve } from "../src/safe-path.ts";

const SNAP = "rex0220-print-craft-app3740-20261005-125115.json";
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

test("開発: 書ける。ただしダウンロード / pull のファイルの書き換えは拒否", () => {
  const work = makeWork(ENVS);
  try {
    const dir = path.join(work, "kintone", "dev-x.cybozu.com", "101-見積書");
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(roleOfTarget(work, path.join(dir, "fields.json")), { role: "development", envName: "dev" });
    assertChangeAllowed(work, path.join(dir, "fields.json"), "write");
    assertChangeAllowed(work, path.join(dir, "rex0220-print-craft-app101-20261005-125115-edit.json"), "write");
    assertChangeAllowed(work, path.join(dir, "rex0220-print-craft-app101-20261005-125115.json"), "add-snapshot");
    writeFileSync(path.join(dir, "rex0220-print-craft-app101-20261005-125115.json"), "{}");
    denied(() => assertChangeAllowed(work, path.join(dir, "rex0220-print-craft-app101-20261005-125115.json"), "write"), /ダウンロード \/ pull のファイルは書き換えない/);
    denied(() => assertChangeAllowed(work, path.join(dir, "rex0220-print-craft-app101-20261005-125115.json"), "add-snapshot"), /書き換えない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("本番: 新しい名前のダウンロード / pull を足すことだけ。直す・書く・上書きは拒否", () => {
  const work = makeWork(ENVS);
  try {
    const dir = path.join(work, "kintone", "x.cybozu.com", "3740-見積書");
    mkdirSync(dir, { recursive: true });
    assertChangeAllowed(work, path.join(dir, SNAP), "add-snapshot");
    for (const f of ["fields.json", SNAP.replace(".json", "-edit.json"), "新しい帳票.json", path.join("records", "3.json"), path.join("out", "見積書.html")]) {
      denied(() => assertChangeAllowed(work, path.join(dir, f), "write"), /本番（role: production）なので変更できない/);
    }
    writeFileSync(path.join(dir, SNAP), "{}");
    denied(() => assertChangeAllowed(work, path.join(dir, SNAP), "add-snapshot"), /本番/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("未分類: role が無い環境、environments.json が無い、どの環境にも合わない、アプリのフォルダーの外 → kintone/ の下は何も変えられない", () => {
  const noRole = makeWork({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com" } } });
  const noEnvs = makeWork(null);
  const work = makeWork(ENVS);
  try {
    denied(() => assertChangeAllowed(noRole, path.join(noRole, "kintone", "dev-x.cybozu.com", "101-見積書", "fields.json"), "write"), /環境「dev」に role が無い.*role（development か production）を書く/);
    denied(() => assertChangeAllowed(noRole, path.join(noRole, "kintone", "dev-x.cybozu.com", "101-見積書", SNAP), "add-snapshot"), /role が無い/);
    denied(() => assertChangeAllowed(noEnvs, path.join(noEnvs, "kintone", "x.cybozu.com", "3740-見積書", "a.json"), "write"), /environments\.json が無い/);
    denied(() => assertChangeAllowed(work, path.join(work, "kintone", "other.cybozu.com", "5-x", "a.json"), "write"), /どの環境のものか/);
    denied(() => assertChangeAllowed(work, path.join(work, "kintone", "x.cybozu.com", "a.json"), "write"), /アプリのフォルダー/);
  } finally {
    for (const w of [noRole, noEnvs, work]) rmSync(w, { recursive: true, force: true });
  }
});

test("kintone/ の外は環境に依らない（settings/ fields/ records/ out/ temp/）", () => {
  const noRole = makeWork({ environments: { dev: { baseUrl: "https://dev-x.cybozu.com" } } });
  try {
    for (const f of ["settings/a.json", "fields/1.json", "records/1-1.json", "out/a.html", "temp/a.json"]) {
      assert.equal(roleOfTarget(noRole, path.join(noRole, f)), null);
      assertChangeAllowed(noRole, path.join(noRole, f), "write");
    }
  } finally {
    rmSync(noRole, { recursive: true, force: true });
  }
});

test("environments.json は変える直前に読み直す（消すと本番の保護を外せない）", () => {
  const work = makeWork(ENVS);
  try {
    const target = path.join(work, "kintone", "x.cybozu.com", "3740-見積書", "fields.json");
    denied(() => assertChangeAllowed(work, target, "write"), /本番/);
    rmSync(path.join(work, "environments.json"));
    denied(() => assertChangeAllowed(work, target, "write"), /environments\.json が無い/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
