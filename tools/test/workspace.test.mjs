/** 環境とアプリのフォルダー（environments.json、kintone/<ホスト名>/<番号>-<アプリ名>/、inbox と take、edit、files、ファイルの置き場所からの既定。2026-10-05） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine, PLUGIN_ZIP } from "./helpers.mjs";
import { appDirFor, appFolderOfFile, assertDirInside, EDIT_RE, editNameOf, findAppDir, folderNameOf, listAppFolder, parseWorkspace, pickEnv, resolveApp, SNAPSHOT_RE, snapshotNameOf, WorkspaceError } from "../src/workspace.ts";
import { AuthError, loadAuthForEnv } from "../src/env.ts";
import { PathError } from "../src/safe-path.ts";
import { takeInbox } from "../src/commands/take.ts";
import { normalizeSettings } from "../src/commands/normalize.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));
const run = (args, cwd) => spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { encoding: "utf8", env: { ...baseEnv, PCRAFT_PLUGIN_ZIP: PLUGIN_ZIP }, cwd });

/** 構成 1（ドメインが違う）と構成 2（同じドメインでアプリが違う） */
const WS1 = { default: "dev", environments: { dev: { baseUrl: "https://dev-x.cybozu.com", envFile: "env/dev.env", role: "development" }, prod: { baseUrl: "https://x.cybozu.com", envFile: "env/prod.env", role: "production" } }, apps: [{ name: "見積書", dev: 101, prod: 3740 }] };
const WS2 = { default: "dev", environments: { dev: { baseUrl: "https://x.cybozu.com", role: "development" }, prod: { baseUrl: "https://x.cybozu.com", role: "production" } }, apps: [{ name: "見積書", dev: 101, prod: 3740 }] };
/** 開発の環境だけ（アプリ 3740 を開発で直す流れの試験） */
const WS3 = { default: "dev", environments: { dev: { baseUrl: "https://x.cybozu.com", role: "development" } }, apps: [{ name: "見積書", dev: 3740 }] };

test("environments.json: 構成 1 と構成 2 を読む。envFile の既定は .env、ホスト名はフォルダー名に", () => {
  const w1 = parseWorkspace(JSON.stringify(WS1));
  assert.deepEqual(w1.environments.prod, { name: "prod", role: "production", baseUrl: "https://x.cybozu.com", host: "x.cybozu.com", envFile: "env/prod.env" });
  assert.equal(parseWorkspace(JSON.stringify({ environments: { only: { baseUrl: "https://a.cybozu.com" } } })).environments.only.role, "unclassified", "role が無ければ未分類（内部だけの状態）");
  assert.equal(w1.defaultEnv, "dev");
  assert.deepEqual(w1.apps, [{ name: "見積書", ids: { dev: 101, prod: 3740 } }]);
  const w2 = parseWorkspace(JSON.stringify(WS2));
  assert.deepEqual([w2.environments.dev.envFile, w2.environments.dev.host, w2.environments.prod.host], [".env", "x.cybozu.com", "x.cybozu.com"]);
  assert.equal(parseWorkspace(JSON.stringify({ environments: { only: { baseUrl: "https://a.cybozu.com" } } })).defaultEnv, "only", "default が無ければ最初の環境");
});

test("environments.json: 形を厳しく見る（未知のキー、名前、接続先、envFile の場所、default、apps の番号と名前）", () => {
  const bad = (o, re) => assert.throws(() => parseWorkspace(JSON.stringify(o)), (e) => e instanceof WorkspaceError && re.test(e.message), JSON.stringify(o));
  bad({ ...WS1, extra: 1 }, /使えるキーは default/);
  bad({ environments: { "dev env": { baseUrl: "https://a.cybozu.com" } } }, /環境の名前/);
  bad({ environments: { dev: { baseUrl: "https://evil.example.com" } } }, /baseUrl が不正/);
  bad({ environments: { dev: { baseUrl: "https://a.cybozu.com", envFile: "../secrets.env" } } }, /envFile は \.env か env\/<名前>\.env/);
  bad({ environments: { dev: { baseUrl: "https://a.cybozu.com", envFile: "settings/x.env" } } }, /envFile/);
  bad({ environments: { dev: { baseUrl: "https://a.cybozu.com", token: "x" } } }, /使えるキーは baseUrl \/ envFile \/ role/);
  bad({ environments: { dev: { baseUrl: "https://a.cybozu.com", role: "unclassified" } } }, /role は development（開発）か production（本番）/);
  bad({ environments: { dev: { baseUrl: "https://a.cybozu.com", role: "prod" } } }, /role は development/);
  bad({ default: "prod", environments: { dev: { baseUrl: "https://a.cybozu.com" } } }, /default の環境が environments に無い/);
  bad({ environments: {} }, /環境が 1 つも無い/);
  bad({ ...WS1, apps: [{ name: "見積書", dev: "101" }] }, /アプリ番号/);
  bad({ ...WS1, apps: [{ name: "見積書", stage: 1 }] }, /environments に無い環境/);
  bad({ ...WS1, apps: [{ name: "a", dev: 1 }, { name: "a", dev: 2 }] }, /重複/);
  bad({ ...WS1, apps: [{ name: "123", dev: 1 }] }, /数字だけは不可/);
  assert.throws(() => parseWorkspace("{"), /JSON として読めない/);
});

test("--app: 番号か apps の名前。名前はその環境の番号に", () => {
  const ws = parseWorkspace(JSON.stringify(WS1));
  assert.deepEqual(resolveApp(ws, pickEnv(ws), "見積書"), { appId: 101, name: "見積書" });
  assert.deepEqual(resolveApp(ws, pickEnv(ws, "prod"), "見積書"), { appId: 3740, name: "見積書" });
  assert.deepEqual(resolveApp(ws, pickEnv(ws, "prod"), "3740"), { appId: 3740, name: "見積書" });
  assert.deepEqual(resolveApp(ws, pickEnv(ws, "prod"), "55"), { appId: 55 });
  assert.throws(() => resolveApp(ws, pickEnv(ws), "請求書"), /apps に無い/);
  assert.throws(() => pickEnv(ws, "stage"), /environments\.json に無い/);
});

test("フォルダー: 番号-アプリ名、番号で探す（名前が変わっても）、同じ番号が 2 つなら止まる。ファイルの置き場所からアプリを知る。ダウンロードと同じ名前", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-ws-"));
  try {
    const ws = parseWorkspace(JSON.stringify(WS1));
    const prod = pickEnv(ws, "prod");
    assert.equal(folderNameOf(3740, "見積書(印刷屋)"), "3740-見積書(印刷屋)");
    assert.equal(folderNameOf(3740, "a/b"), "3740-a_b");
    assert.equal(folderNameOf(3740, ""), "3740");
    assert.equal(findAppDir(work, prod, 3740), null);
    assert.equal(appDirFor(work, prod, 3740, "見積書(印刷屋)"), path.join(work, "kintone", "x.cybozu.com", "3740-見積書(印刷屋)"));
    mkdirSync(path.join(work, "kintone", "x.cybozu.com", "3740-古い名前"), { recursive: true });
    assert.equal(appDirFor(work, prod, 3740, "新しい名前"), path.join(work, "kintone", "x.cybozu.com", "3740-古い名前"), "番号で探す");
    assert.equal(findAppDir(work, prod, 374), null, "374 は 3740 と区別する");
    mkdirSync(path.join(work, "kintone", "x.cybozu.com", "3740"), { recursive: true });
    assert.throws(() => findAppDir(work, prod, 3740), /フォルダーが 2 つある/);
    const f = path.join(work, "kintone", "x.cybozu.com", "3740-古い名前", "records", "3.json");
    assert.deepEqual(appFolderOfFile(work, f), { dir: path.join(work, "kintone", "x.cybozu.com", "3740-古い名前"), host: "x.cybozu.com", appId: 3740 });
    assert.equal(appFolderOfFile(work, path.join(work, "settings", "a.json")), null);
    assert.equal(appFolderOfFile(work, path.join(work, "kintone", "x.cybozu.com", "a.json")), null);
    const name = snapshotNameOf(3740, new Date(2026, 9, 5, 12, 51, 15));
    assert.equal(name, "rex0220-print-craft-app3740-20261005-125115.json", "設定画面のダウンロードと同じ名前");
    assert.ok(SNAPSHOT_RE.test(name) && EDIT_RE.test(editNameOf(name)) && !SNAPSHOT_RE.test(editNameOf(name)));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("認証: 環境の envFile だけを読む（OS の環境変数は読まない）。接続先が environments.json と違えば止まる", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-ws-"));
  try {
    const ws = parseWorkspace(JSON.stringify(WS1));
    const dev = pickEnv(ws);
    assert.throws(() => loadAuthForEnv(dev, work), (e) => e instanceof AuthError && /認証のファイルが無い: env\/dev\.env/.test(e.message));
    mkdirSync(path.join(work, "env"));
    writeFileSync(path.join(work, "env", "dev.env"), "KINTONE_API_TOKEN=tok\n");
    assert.deepEqual(loadAuthForEnv(dev, work), { baseUrl: "https://dev-x.cybozu.com", token: "tok", username: undefined, password: undefined });
    writeFileSync(path.join(work, "env", "dev.env"), "KINTONE_BASE_URL=https://x.cybozu.com\nKINTONE_API_TOKEN=tok\n");
    assert.throws(() => loadAuthForEnv(dev, work), /environments\.json の環境「dev」の baseUrl/);
    writeFileSync(path.join(work, "env", "dev.env"), "KINTONE_BASE_URL=https://dev-x.cybozu.com/\nKINTONE_USERNAME=u\n");
    assert.throws(() => loadAuthForEnv(dev, work), /OS の環境変数は読まない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

const engine = await loadEngine();
async function snapshotText(appId = 3740) {
  const r = await normalizeSettings({ settingsText: JSON.stringify(aiSettings({ appId })), settingsFile: "x.json", fields: { ...FIELDS_FILE, appId }, engine });
  return JSON.stringify(r.output, null, 2) + "\n";
}

function makeWorkspace(ws) {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-ws-"));
  writeFileSync(path.join(work, "environments.json"), JSON.stringify(ws));
  mkdirSync(path.join(work, "inbox"));
  return work;
}

test("take: inbox のダウンロードを、封筒の appId と apps からアプリのフォルダーへ名前のまま移す。分からないもの・印刷屋でないもの・名前と appId が違うものは移さない", async () => {
  const work = makeWorkspace(WS2);
  try {
    const ws = parseWorkspace(JSON.stringify(WS2));
    const text = await snapshotText(3740);
    const dl = "rex0220-print-craft-app3740-20261005-125115.json";
    writeFileSync(path.join(work, "inbox", dl), text);
    writeFileSync(path.join(work, "inbox", "rex0220-print-craft-app999-20261005-125115.json"), text.replace('"appId": 3740', '"appId": 999'));
    writeFileSync(path.join(work, "inbox", "other.json"), JSON.stringify({ pluginID: "other" }));
    writeFileSync(path.join(work, "inbox", "rex0220-print-craft-app101-20261005-125115.json"), text);
    const r = takeInbox(work, ws);
    assert.deepEqual(r.moved.map((m) => m.to.replace(/\\/g, "/")), [`kintone/x.cybozu.com/3740-見積書(印刷屋)/${dl}`]);
    assert.equal(readFileSync(path.join(work, "kintone", "x.cybozu.com", "3740-見積書(印刷屋)", dl), "utf8"), text, "中身も名前もそのまま");
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.file, s.reason]));
    assert.match(reasons["inbox/rex0220-print-craft-app999-20261005-125115.json"], /apps に無く、環境が 2 つ以上ある/);
    assert.match(reasons["inbox/other.json"], /印刷屋の設定のファイルではない/);
    assert.match(reasons["inbox/rex0220-print-craft-app101-20261005-125115.json"], /ファイル名のアプリ 101 と封筒の appId 3740 が違う/);
    // 同じホストの環境が 2 つ（構成 2）で apps に無い番号は、--env を付けても移さない（開発か本番か決まらない。--env では本番の保護を外せない。段階 0-2 の段 3）
    const r2 = takeInbox(work, ws, "dev");
    assert.deepEqual(r2.moved, []);
    assert.match(r2.skipped.find((s) => s.file.endsWith("app999-20261005-125115.json")).reason, /どの環境のものか.*apps にアプリの番号を足す/);
    // 同じものをもう一度置いたら inbox から消すだけ、違う中身なら移さない
    writeFileSync(path.join(work, "inbox", dl), text);
    assert.deepEqual(takeInbox(work, ws).moved.map((m) => m.same), [true]);
    writeFileSync(path.join(work, "inbox", dl), text.replace("見積書を PDF", "別の説明"));
    assert.match(takeInbox(work, ws).skipped.find((s) => s.file.endsWith(dl)).reason, /同じ名前の別の中身がある/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("take: 行き先に置いた後に inbox の元を消せなくても、置いたことを返す（leftInInbox と注意。Codex 再々レビュー MINOR 3）", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const work = makeWorkspace(WS3);
  const inbox = path.join(work, "inbox");
  try {
    const ws = parseWorkspace(JSON.stringify(WS3));
    const dl = "rex0220-print-craft-app3740-20261005-125115.json";
    writeFileSync(path.join(inbox, dl), await snapshotText(3740));
    chmodSync(inbox, 0o555);
    const r = takeInbox(work, ws);
    assert.deepEqual(r.moved.map((m) => [m.same, m.leftInInbox]), [[false, true]]);
    assert.ok(existsSync(path.join(work, "kintone", "x.cybozu.com", "3740-見積書(印刷屋)", dl)), "行き先には置いた");
    assert.match(r.warnings.join("\n"), /行き先に置いたが、inbox から消せなかった/);
    const again = takeInbox(work, ws);
    assert.deepEqual(again.moved.map((m) => [m.same, m.leftInInbox]), [[true, true]], "同じものの経路も消せなければそう返す");
    chmodSync(inbox, 0o755);
    assert.deepEqual(takeInbox(work, ws).moved.map((m) => [m.same, m.leftInInbox]), [[true, undefined]], "次の take で消す");
    assert.deepEqual(readdirSync(inbox), []);
  } finally {
    chmodSync(inbox, 0o755);
    rmSync(work, { recursive: true, force: true });
  }
});

test("CLI: environments.json があるときの pull は --force を使えない（ダウンロード / pull のファイルは上書きしない。通信の前に止まる）", () => {
  const work = makeWorkspace(WS1);
  try {
    const r = run(["pull", "--app", "見積書", "--force"], work);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--force は使えない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("CLI（environments.json あり、開発の環境）: take → files → buttons --app → normalize は fields.json を同じフォルダーから、ダウンロードは書き換えない → edit → normalize → preview --record 3", async () => {
  const work = makeWorkspace(WS3);
  try {
    const dir = path.join(work, "kintone", "x.cybozu.com", "3740-見積書(印刷屋)");
    mkdirSync(path.join(dir, "records"), { recursive: true });
    writeFileSync(path.join(dir, "fields.json"), JSON.stringify(FIELDS_FILE));
    writeFileSync(path.join(dir, "records", "3.json"), JSON.stringify({ record: { 見積番号: { type: "SINGLE_LINE_TEXT", value: "S-1" } } }));
    const dl = "rex0220-print-craft-app3740-20261005-125115.json";
    writeFileSync(path.join(work, "inbox", dl), await snapshotText(3740));
    const t = run(["take"], work);
    assert.equal(t.status, 0, t.stderr);
    const snap = path.join("kintone", "x.cybozu.com", "3740-見積書(印刷屋)", dl);
    assert.ok(existsSync(path.join(work, snap)));
    const f = run(["files", "--app", "見積書", "--env", "dev"], work);
    assert.equal(f.status, 0, f.stderr);
    assert.match(f.stdout, new RegExp(`${dl}  ← 今の設定`));
    const s = run(["fields", "--app", "見積書", "--env", "dev", "--summary"], work);
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /^アプリ 3740 /);
    const b = run(["buttons", "--app", "3740", "--env", "dev"], work);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /1\. 見積書（有効/);
    // ダウンロードのファイルは書き換えない（--dry-run なら検査できる。--fields は要らない）
    const n1 = run(["normalize", snap], work);
    assert.equal(n1.status, 2);
    assert.match(n1.stderr, /ダウンロード \/ pull のファイルは書き換えない/);
    const n2 = run(["normalize", snap, "--dry-run", "--check"], work);
    assert.equal(n2.status, 0, n2.stderr + n2.stdout);
    assert.match(n2.stdout, /--check: 入力の派生値と生成した値は一致/);
    // edit で写して直す
    const e = run(["edit", "--app", "見積書", "--env", "dev"], work);
    assert.equal(e.status, 0, e.stderr);
    const editFile = path.join("kintone", "x.cybozu.com", "3740-見積書(印刷屋)", dl.replace(".json", "-edit.json"));
    assert.equal(readFileSync(path.join(work, editFile), "utf8"), readFileSync(path.join(work, snap), "utf8"));
    assert.match(run(["edit", snap], work).stdout, /既にある（続けて直す）/);
    const n3 = run(["normalize", editFile], work);
    assert.equal(n3.status, 0, n3.stderr + n3.stdout);
    // --record 3 は同じフォルダーの records/3.json、out/ もアプリのフォルダーの中（見本のレコードは明細が無いので式のエラーで終了コード 1。場所の確かめだけ）
    const p = run(["preview", editFile, "--record", "3"], work);
    assert.notEqual(p.status, 2, p.stderr);
    assert.match(p.stdout, /見積書: 1 ページ/);
    assert.deepEqual(readdirSync(path.join(dir, "out")), ["見積書.html"], "out/ はアプリのフォルダーの中");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("CLI: --env は環境の名前だけ（場所は不可、environments.json が無ければ使えない）。environments.json があるときは --out を使わない。take / edit / files は environments.json が要る", () => {
  const work = makeWorkspace(WS1);
  const legacy = mkdtempSync(path.join(os.tmpdir(), "pcraft-legacy-"));
  try {
    const r1 = run(["fields", "--app", "見積書", "--env", "../env/prod.env", "--summary"], work);
    assert.equal(r1.status, 2);
    assert.match(r1.stderr, /環境の名前を続ける（ファイルの場所は指定できない）/);
    const r2 = run(["fields", "--app", "見積書", "--env", "stage", "--summary"], work);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /環境「stage」は environments\.json に無い/);
    const r3 = run(["fields", "--app", "見積書", "--out", "fields/x.json"], work);
    assert.equal(r3.status, 2);
    assert.match(r3.stderr, /--out を使わない/);
    const r4 = run(["fields", "--app", "見積書", "--summary"], work);
    assert.equal(r4.status, 1);
    assert.match(r4.stderr, /フォルダー（kintone\/dev-x\.cybozu\.com\/101-…）が無い。先に npx @rex0220\/print-craft-authoring-tools fields --app 101/);
    for (const cmd of [["take"], ["edit", "--app", "1"], ["files", "--app", "1"]]) {
      const r = run(cmd, legacy);
      assert.equal(r.status, 2, cmd.join(" "));
      assert.match(r.stderr, /environments\.json があるときだけ/);
    }
    const r5 = run(["fields", "--app", "1", "--env", "dev", "--summary"], legacy);
    assert.equal(r5.status, 2);
    assert.match(r5.stderr, /environments\.json があるときだけ使える/);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  }
});

test("listAppFolder: ダウンロード / pull は新しい順、-edit.json と新しい帳票は分ける", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-ws-"));
  try {
    for (const n of ["rex0220-print-craft-app1-20261001-090000.json", "rex0220-print-craft-app1-20261005-125115.json", "rex0220-print-craft-app1-20261001-090000-edit.json", "納品書.json", "fields.json"]) writeFileSync(path.join(work, n), "{}");
    const l = listAppFolder(work);
    assert.deepEqual(l.snapshots, ["rex0220-print-craft-app1-20261005-125115.json", "rex0220-print-craft-app1-20261001-090000.json"]);
    assert.deepEqual(l.edits, ["rex0220-print-craft-app1-20261001-090000-edit.json"]);
    assert.deepEqual(l.reports, ["納品書.json"]);
    assert.equal(l.hasFields, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("フォルダーの実体が作業フォルダーの外（symlink / junction）なら一覧しない: kintone/ とホストのフォルダー、アプリのフォルダーと records / out、inbox（B1 の Codex レビュー BLOCKER 1）", (t) => {
  const work = makeWorkspace(WS3);
  const outside = mkdtempSync(path.join(os.tmpdir(), "pcraft-outside-"));
  const link = (target, at) => symlinkSync(target, at, "junction");
  try {
    const ws = parseWorkspace(JSON.stringify(WS3));
    const dev = pickEnv(ws, "dev");
    mkdirSync(path.join(outside, "x.cybozu.com", "3740-外"), { recursive: true });
    writeFileSync(path.join(outside, "rex0220-print-craft-app3740-20261005-125115.json"), "{}");
    writeFileSync(path.join(outside, "99.json"), "{}");
    try {
      link(outside, path.join(work, "kintone"));
    } catch (e) {
      t.skip(`symlink を作れない: ${e.message}`);
      return;
    }
    assert.throws(() => findAppDir(work, dev, 3740), PathError, "kintone/ が外");
    assert.throws(() => assertDirInside(work, path.join(work, "kintone")), /作業フォルダーの外を指している/);
    rmSync(path.join(work, "kintone"));
    mkdirSync(path.join(work, "kintone"));
    link(path.join(outside, "x.cybozu.com"), path.join(work, "kintone", "x.cybozu.com"));
    assert.throws(() => findAppDir(work, dev, 3740), PathError, "ホストのフォルダーが外");
    rmSync(path.join(work, "kintone", "x.cybozu.com"));

    const app = path.join(work, "kintone", "x.cybozu.com", "3740-見積書");
    mkdirSync(app, { recursive: true });
    assert.equal(findAppDir(work, dev, 3740), app, "中なら今までどおり");
    assert.deepEqual(listAppFolder(app, work).snapshots, []);
    link(outside, path.join(app, "records"));
    assert.throws(() => listAppFolder(app, work), PathError, "records が外");
    assert.ok(Array.isArray(listAppFolder(app).records), "作業フォルダーを渡さない呼び方は今までどおり（互換）");
    const files = run(["files", "--app", "3740"], work);
    assert.equal(files.status, 2, files.stderr);
    assert.match(files.stderr, /作業フォルダーの外を指している/);
    assert.ok(!files.stdout.includes("99.json") && !files.stderr.includes("99.json"), "外のファイルの名前を出さない");
    rmSync(path.join(app, "records"));
    link(outside, path.join(app, "out"));
    assert.throws(() => listAppFolder(app, work), PathError, "out が外");
    assert.throws(() => listAppFolder(outside, work), PathError, "アプリのフォルダーそのものが外");

    rmSync(path.join(work, "inbox"), { recursive: true });
    link(outside, path.join(work, "inbox"));
    assert.throws(() => takeInbox(work, ws), PathError, "inbox が外");
    const take = run(["take"], work);
    assert.equal(take.status, 2, take.stderr);
    assert.match(take.stderr, /作業フォルダーの外を指している（symlink など）: inbox/);
    assert.ok(existsSync(path.join(outside, "rex0220-print-craft-app3740-20261005-125115.json")), "外のファイルは動かさない");
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
