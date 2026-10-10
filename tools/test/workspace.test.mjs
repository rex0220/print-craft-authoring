/**
 * 作業フォルダーの形とアプリのフォルダー（tools 2.0.0。print-craft-authoring-mcp の実装案 15 章）: 動く形の決め方（接続のファイル、environments.json）、
 * kintone/<profile>/<番号>-<アプリ名>/、アプリのフォルダーの印、take、作業フォルダーの外を指すフォルダー、CLI の流れ
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine, PLUGIN_ZIP } from "./helpers.mjs";
import {
  APP_MARKER,
  EDIT_RE,
  SNAPSHOT_RE,
  appDirFor,
  appFolderOfFile,
  appFoldersOf,
  assertInsideWorkspace,
  assertUsableInKintone,
  editNameOf,
  ensureAppFolder,
  findAppDir,
  folderNameOf,
  listAppFolder,
  modeOf,
  readAppMark,
  requireProfiles,
  snapshotNameOf,
  unusedProfileDirs
} from "../src/workspace.ts";
import { ConnectionError, pickProfile } from "../src/connections.ts";
import { PermissionError } from "../src/permission.ts";
import { PathError } from "../src/safe-path.ts";
import { takeInbox } from "../src/commands/take.ts";
import { MAX_INPUT_BYTES, normalizeSettings } from "../src/commands/normalize.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";
import { CONN, makeConnWorkspace } from "./conn-helper.mjs";

const engine = await loadEngine();
const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));
const run = (args, cwd, env = {}) => spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { encoding: "utf8", env: { ...baseEnv, PCRAFT_PLUGIN_ZIP: PLUGIN_ZIP, ...env }, cwd });
const DL = "rex0220-print-craft-app3740-20261005-125115.json";
const code = (c) => (e) => e instanceof ConnectionError && e.code === c;

/** 印刷屋の設定のダウンロードと同じ形（封筒の appId） */
async function snapshotText(appId = 3740) {
  const r = await normalizeSettings({ settingsText: JSON.stringify(aiSettings({ appId })), settingsFile: "x.json", fields: { ...FIELDS_FILE, appId }, engine });
  return JSON.stringify(r.output, null, 2) + "\n";
}

test("フォルダーの名前: 番号-アプリ名、名前が使えなければ番号だけ。ファイルの置き場所から profile と番号を知る。ダウンロードと同じ名前", () => {
  assert.equal(folderNameOf(3740, "見積書(印刷屋)"), "3740-見積書(印刷屋)");
  assert.equal(folderNameOf(3740, "a/b"), "3740-a_b");
  assert.equal(folderNameOf(3740, ""), "3740");
  for (const bad of ["CON", "NUL", ".", ".."]) assert.ok(!/^3740-(CON|NUL|\.|\.\.)$/.test(folderNameOf(3740, bad)), bad);
  assert.ok(folderNameOf(3740, "あ".repeat(300)).length < 260, "長い名前は切る");
  const root = "/w";
  assert.deepEqual(appFolderOfFile(root, "/w/kintone/dev/3740-見積書/records/3.json"), { dir: path.join(root, "kintone", "dev", "3740-見積書"), profile: "dev", appId: 3740 });
  assert.equal(appFolderOfFile(root, "/w/settings/a.json"), null);
  assert.equal(appFolderOfFile(root, "/w/kintone/dev/a.json"), null);
  assert.equal(appFolderOfFile(root, "/w/kintone/x.cybozu.com/3740-見積書/a.json"), null, "1.x のホスト名のフォルダーは profile の形でない");
  assert.equal(appFolderOfFile(root, "/w/kintone/dev/0123-x/a.json"), null);
  const name = snapshotNameOf(3740, new Date(2026, 9, 5, 12, 51, 15));
  assert.equal(name, DL, "設定画面のダウンロードと同じ名前");
  assert.ok(SNAPSHOT_RE.test(name) && EDIT_RE.test(editNameOf(name)) && !SNAPSHOT_RE.test(editNameOf(name)));
});

test("動く形（15.4）: 接続のファイルがあれば profiles、空・読めないのは誤り（1 接続に戻らない）、無くて environments.json があれば legacy-blocked、無ければ CLI は single・MCP は not-configured", () => {
  const t = makeConnWorkspace();
  try {
    const opt = (configFile, surface = "cli") => ({ configFile, workspaceRoots: [t.root], env: {}, surface });
    assert.equal(modeOf(t.root, opt(t.connFile)).kind, "profiles");
    assert.throws(() => modeOf(t.root, opt("")), code("unreadable"));
    assert.throws(() => modeOf(t.root, opt(path.join(t.base, "無い.json"))), code("unreadable"));
    assert.equal(modeOf(t.root, opt(undefined)).kind, "single");
    assert.equal(modeOf(t.root, opt(undefined, "mcp")).kind, "not-configured");
    writeFileSync(path.join(t.root, "environments.json"), "{}");
    assert.equal(modeOf(t.root, opt(undefined)).kind, "legacy-blocked");
    assert.equal(modeOf(t.root, opt(undefined, "mcp")).kind, "legacy-blocked");
    assert.equal(modeOf(t.root, opt(t.connFile)).kind, "profiles", "接続のファイルがあれば environments.json は読まない");
    assert.throws(() => requireProfiles({ kind: "legacy-blocked" }, "fields"), code("legacy-config-present"));
    assert.throws(() => requireProfiles({ kind: "not-configured" }, "fields"), code("not-configured"));
    assert.throws(() => requireProfiles({ kind: "single" }, "take"), (e) => code("not-configured")(e) && /take は kintone の接続のファイル/.test(e.message));
    assert.ok(requireProfiles(t.mode(), "x").set.profiles.has("dev"));
  } finally {
    t.cleanup();
  }
});

test("アプリのフォルダー: 番号で探す（名前が変わっても）、同じ番号が 2 つなら止まる、. で始まるもの（一時フォルダー）は数えない。作るときは印を先に置く（一時フォルダーから付け替え）", () => {
  const t = makeConnWorkspace();
  try {
    const def = pickProfile(t.mode().connections.set, "dev");
    assert.equal(findAppDir(t.root, "dev", 3740), null);
    const dir = appDirFor(t.root, "dev", 3740, "見積書(印刷屋)");
    assert.equal(dir, path.join(t.root, "kintone", "dev", "3740-見積書(印刷屋)"));
    ensureAppFolder(dir, def, 3740);
    assert.deepEqual(readAppMark(dir), { state: "ok", mark: { schemaVersion: 1, profile: "dev", origin: "https://dev-x.cybozu.com", guestSpaceId: null, appId: 3740 } });
    assert.deepEqual(readdirSync(path.join(t.root, "kintone", "dev")), ["3740-見積書(印刷屋)"], "一時フォルダーを残さない");
    assert.equal(appDirFor(t.root, "dev", 3740, "新しい名前"), dir, "番号で探す");
    ensureAppFolder(dir, def, 3740);
    assert.throws(() => ensureAppFolder(dir, def, 101), code("app-identity-conflict"), "番号の違う印");
    mkdirSync(path.join(t.root, "kintone", "dev", ".3740-x.abc.tmp"));
    assert.equal(findAppDir(t.root, "dev", 3740), dir, "途中で止まった一時フォルダーは数えない");
    assert.equal(findAppDir(t.root, "dev", 374), null, "374 は 3740 と区別する");
    mkdirSync(path.join(t.root, "kintone", "dev", "3740"));
    assert.throws(() => findAppDir(t.root, "dev", 3740), /フォルダーが 2 つある/);
    rmSync(path.join(t.root, "kintone", "dev", "3740"), { recursive: true });
    // 印の無いフォルダー（ほかで作った、1.x から移した）は採用しない
    const bare = path.join(t.root, "kintone", "dev", "101-手で作った");
    mkdirSync(bare);
    assert.throws(() => ensureAppFolder(bare, def, 101), code("app-marker-missing"));
    assert.equal(existsSync(path.join(bare, APP_MARKER)), false, "後から印を置かない");
  } finally {
    t.cleanup();
  }
});

test("通常の操作で kintone/ の下を読む前（15.5）: profile の形だけ、接続のファイルにある profile、印が合うフォルダーだけ。診断は名前と印の状態だけ", () => {
  const t = makeConnWorkspace();
  try {
    const mode = t.mode();
    const dir = t.appFolder("dev", 3740, "見積書", FIELDS_FILE);
    assertUsableInKintone(t.root, path.join(dir, "fields.json"), mode);
    assertUsableInKintone(t.root, path.join(t.root, "settings", "a.json"), { kind: "single" });
    assert.throws(() => assertUsableInKintone(t.root, path.join(dir, "fields.json"), { kind: "single" }), PermissionError);
    assert.throws(() => assertUsableInKintone(t.root, path.join(dir, "fields.json"), { kind: "legacy-blocked" }), code("legacy-config-present"));
    const stage = path.join(t.root, "kintone", "stage", "3740-x");
    mkdirSync(stage, { recursive: true });
    assert.throws(() => assertUsableInKintone(t.root, path.join(stage, "a.json"), mode), (e) => e instanceof PermissionError && /profile「stage」/.test(e.message));
    const bare = path.join(t.root, "kintone", "dev", "101-手で作った");
    mkdirSync(bare);
    assert.throws(() => assertUsableInKintone(t.root, path.join(bare, "a.json"), mode), code("app-marker-missing"));
    const def = pickProfile(mode.connections.set, "dev");
    assert.deepEqual(appFoldersOf(t.root, def), [
      { name: "101-手で作った", appId: 101, mark: "missing" },
      { name: "3740-見積書", appId: 3740, mark: "ok" }
    ]);
    assert.deepEqual(unusedProfileDirs(t.root, mode.connections.set), ["stage"]);
  } finally {
    t.cleanup();
  }
});

test("take: inbox のダウンロードを、封筒の appId で profile（--profile か defaultProfile）のアプリのフォルダーへ名前のまま移す。印を先に置く。印刷屋でないもの・名前と appId が違うもの・印が合わないフォルダーには移さない", async () => {
  const t = makeConnWorkspace();
  const inbox = path.join(t.root, "inbox");
  mkdirSync(inbox);
  try {
    const text = await snapshotText(3740);
    writeFileSync(path.join(inbox, DL), text);
    writeFileSync(path.join(inbox, "other.json"), JSON.stringify({ pluginID: "other" }));
    writeFileSync(path.join(inbox, "rex0220-print-craft-app101-20261005-125115.json"), text);
    const r = takeInbox(t.root, t.mode());
    assert.deepEqual(r.moved.map((m) => m.to.replace(/\\/g, "/")), [`kintone/dev/3740-見積書(印刷屋)/${DL}`], JSON.stringify(r));
    const dir = path.join(t.root, "kintone", "dev", "3740-見積書(印刷屋)");
    assert.equal(readFileSync(path.join(dir, DL), "utf8"), text, "中身も名前もそのまま");
    assert.equal(readAppMark(dir).state, "ok", "印を置いた");
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.file, s.reason]));
    assert.match(reasons["inbox/other.json"], /印刷屋の設定のファイルではない/);
    assert.match(reasons["inbox/rex0220-print-craft-app101-20261005-125115.json"], /ファイル名のアプリ 101 と封筒の appId 3740 が違う/);
    // --profile prod は prod のフォルダーへ
    writeFileSync(path.join(inbox, DL), text);
    const p = takeInbox(t.root, t.mode(), "prod");
    assert.deepEqual(p.moved.map((m) => m.to.replace(/\\/g, "/")), [`kintone/prod/3740-見積書(印刷屋)/${DL}`]);
    // 同じものをもう一度置いたら inbox から消すだけ、違う中身なら移さない
    writeFileSync(path.join(inbox, DL), text);
    assert.deepEqual(takeInbox(t.root, t.mode()).moved.map((m) => m.same), [true]);
    writeFileSync(path.join(inbox, DL), text.replace("見積書を PDF", "別の説明"));
    assert.match(takeInbox(t.root, t.mode()).skipped.find((s) => s.file.endsWith(DL)).reason, /同じ名前の別の中身がある/);
    // 印が合わないフォルダー（接続先を変えた profile）: skipped にせず、何も変えずに止める（conflict。中のファイルとも比べない。15.5、Codex の実装レビュー MAJOR 4）
    t.writeConn({ ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, baseUrl: "https://dev-z.cybozu.com" } } });
    const dl2 = DL.replace("20261005-125115", "20261006-090000");
    writeFileSync(path.join(inbox, dl2), text);
    writeFileSync(path.join(inbox, DL), text);
    assert.throws(() => takeInbox(t.root, t.mode()), code("app-identity-conflict"));
    assert.ok(!existsSync(path.join(dir, dl2)), "置かない");
    assert.ok(existsSync(path.join(inbox, dl2)) && existsSync(path.join(inbox, DL)), "同じものでも inbox から消さない");
    assert.throws(() => takeInbox(t.root, { kind: "single" }), code("not-configured"));
  } finally {
    t.cleanup();
  }
});

test("take: 呼び出しの途中で選んだ profile の接続が変われば止める（同じものが既にあるときも inbox から消さない）。ほかの profile だけの書き換えでは続ける（Codex の実装レビュー MAJOR 4）", async () => {
  const t = makeConnWorkspace();
  const inbox = path.join(t.root, "inbox");
  mkdirSync(inbox);
  const rotated = (token) => ({ ...CONN, profiles: { ...CONN.profiles, dev: { ...CONN.profiles.dev, tokenMap: { ...CONN.profiles.dev.tokenMap, APP3740: token } } } });
  try {
    const text = await snapshotText(3740);
    writeFileSync(path.join(inbox, DL), text);
    assert.equal(takeInbox(t.root, t.mode()).moved.length, 1);
    const dir = path.join(t.root, "kintone", "dev", "3740-見積書(印刷屋)");
    // 同じものが既にある: 消す前に接続を確かめ直す
    writeFileSync(path.join(inbox, DL), text);
    const before = t.mode();
    t.writeConn(rotated("rotated-1"));
    assert.throws(() => takeInbox(t.root, before), code("connection-changed"));
    assert.ok(existsSync(path.join(inbox, DL)), "同じものでも消さない");
    rmSync(path.join(inbox, DL));
    // 新しいファイル: 確定の前に接続を確かめ直す
    const dl2 = DL.replace("20261005-125115", "20261006-090000");
    writeFileSync(path.join(inbox, dl2), text);
    const before2 = t.mode();
    t.writeConn(rotated("rotated-2"));
    assert.throws(() => takeInbox(t.root, before2), (e) => code("connection-changed")(e) && /この呼び出しで移したのは 0 件/.test(e.message));
    assert.ok(!existsSync(path.join(dir, dl2)) && existsSync(path.join(inbox, dl2)));
    // ほかの profile だけの書き換え
    const before3 = t.mode();
    t.writeConn({ ...rotated("rotated-2"), profiles: { ...rotated("rotated-2").profiles, prod: { ...CONN.profiles.prod, baseUrl: "https://y.cybozu.com" } } });
    assert.deepEqual(takeInbox(t.root, before3).moved.map((m) => path.basename(m.to)), [dl2]);
  } finally {
    t.cleanup();
  }
});

test("take: 読めない inbox のファイルの理由は決まった文（JSON の断片・秘密の値・環境変数の名前・絶対パスを出さない。Codex の実装レビュー BLOCKER 1）。CLI の出力にも出さない", async () => {
  const t = makeConnWorkspace();
  const inbox = path.join(t.root, "inbox");
  mkdirSync(inbox);
  const SENTINEL = "SECRET-tok-0123456789";
  try {
    writeFileSync(path.join(inbox, DL), `{"pluginID":"rex0220 Print craft plugin","token":${SENTINEL},"ref":"env:MY_SECRET_VAR"}`);
    writeFileSync(path.join(inbox, "rex0220-print-craft-app3740-20261005-125116.json"), `{"password": "${SENTINEL}" `);
    writeFileSync(path.join(inbox, "big.json"), Buffer.alloc(MAX_INPUT_BYTES + 10, 0x20));
    writeFileSync(path.join(inbox, "array.json"), "[1, 2]");
    const r = takeInbox(t.root, t.mode());
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.file, s.reason]));
    assert.match(reasons[`inbox/${DL}`], /^JSON として読めない.*（中身は返さない）$/);
    assert.match(reasons["inbox/rex0220-print-craft-app3740-20261005-125116.json"], /^JSON として読めない/);
    assert.match(reasons["inbox/big.json"], /^大きすぎる/);
    assert.equal(reasons["inbox/array.json"], "JSON の最上位がオブジェクトでない");
    const text = JSON.stringify(r);
    for (const v of [SENTINEL, "MY_SECRET_VAR", t.root, t.base]) assert.ok(!text.includes(v), `返さない: ${v}`);
    const cli = run(["take"], t.root, { PCRAFT_KINTONE_CONFIG: t.connFile });
    assert.equal(cli.status, 1);
    for (const v of [SENTINEL, "MY_SECRET_VAR"]) assert.ok(!cli.stderr.includes(v) && !cli.stdout.includes(v), `CLI に出さない: ${v}`);
    assert.match(cli.stderr, /移さない: inbox\/rex0220-print-craft-app3740-20261005-125115\.json（JSON として読めない/);
  } finally {
    t.cleanup();
  }
});

test("アプリのフォルダーを作る途中で止まった・同時に作った（15.5）: . で始まる一時フォルダーは採用も一覧もしない。別のプロセスと同時に作っても印は 1 つで、一時フォルダーを残さない", async () => {
  const t = makeConnWorkspace();
  try {
    const def = pickProfile(t.mode().connections.set, "dev");
    const profileDir = path.join(t.root, "kintone", "dev");
    // 途中で止まった（一時フォルダーに印を置いた後、名前を付け替える前）
    mkdirSync(path.join(profileDir, ".3740-見積書.abcdef.tmp"), { recursive: true });
    writeFileSync(path.join(profileDir, ".3740-見積書.abcdef.tmp", APP_MARKER), JSON.stringify({ schemaVersion: 1, profile: "dev", origin: "https://dev-x.cybozu.com", guestSpaceId: null, appId: 3740 }));
    assert.equal(findAppDir(t.root, "dev", 3740), null, "一時フォルダーを採用しない");
    assert.deepEqual(appFoldersOf(t.root, def), [], "一覧に出さない");
    const dir = path.join(profileDir, "3740-見積書");
    ensureAppFolder(dir, def, 3740);
    assert.equal(readAppMark(dir).state, "ok");
    assert.equal(findAppDir(t.root, "dev", 3740), dir);
    // 同時に作る: 別のプロセスで同じフォルダーを 4 つ同時に
    const target = path.join(profileDir, "101-同時");
    const script = [
      `import { ensureAppFolder } from ${JSON.stringify(new URL("../src/workspace.ts", import.meta.url).href)};`,
      `import { loadConnections, pickProfile } from ${JSON.stringify(new URL("../src/connections.ts", import.meta.url).href)};`,
      `const [file, dir] = process.argv.slice(1);`,
      `const def = pickProfile(loadConnections(file, { workspaceRoots: [], env: {} }), "dev");`,
      `ensureAppFolder(dir, def, 101);`
    ].join("\n");
    const { spawn } = await import("node:child_process");
    const runs = Array.from({ length: 4 }, () => new Promise((resolve) => {
      const c = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", script, t.connFile, target], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      c.stderr.on("data", (d) => (err += d));
      c.on("close", (code) => resolve({ code, err }));
    }));
    for (const r of await Promise.all(runs)) assert.equal(r.code, 0, r.err);
    assert.equal(readAppMark(target).state, "ok");
    assert.deepEqual(readdirSync(profileDir).filter((n) => n.startsWith(".101-")), [], "一時フォルダーを残さない");
  } finally {
    t.cleanup();
  }
});

test("take: 行き先に置いた後に inbox の元を消せなくても、置いたことを返す（leftInInbox と注意。Codex 再々レビュー MINOR 3）", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const t = makeConnWorkspace();
  const inbox = path.join(t.root, "inbox");
  mkdirSync(inbox);
  try {
    writeFileSync(path.join(inbox, DL), await snapshotText(3740));
    chmodSync(inbox, 0o555);
    const r = takeInbox(t.root, t.mode());
    assert.deepEqual(r.moved.map((m) => [m.same, m.leftInInbox]), [[false, true]]);
    assert.match(r.warnings.join("\n"), /行き先に置いたが、inbox から消せなかった/);
    assert.deepEqual(takeInbox(t.root, t.mode()).moved.map((m) => [m.same, m.leftInInbox]), [[true, true]], "同じものの経路も消せなければそう返す");
    chmodSync(inbox, 0o755);
    assert.deepEqual(takeInbox(t.root, t.mode()).moved.map((m) => [m.same, m.leftInInbox]), [[true, undefined]], "次の take で消す");
    assert.deepEqual(readdirSync(inbox), []);
  } finally {
    chmodSync(inbox, 0o755);
    t.cleanup();
  }
});

test("listAppFolder: ダウンロード / pull は新しい順、-edit.json と新しい帳票は分ける。. で始まるもの（印）は出さない", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-ws-"));
  try {
    for (const n of ["rex0220-print-craft-app1-20261001-090000.json", "rex0220-print-craft-app1-20261005-125115.json", "rex0220-print-craft-app1-20261001-090000-edit.json", "納品書.json", "fields.json", APP_MARKER]) writeFileSync(path.join(work, n), "{}");
    const l = listAppFolder(work);
    assert.deepEqual(l.snapshots, ["rex0220-print-craft-app1-20261005-125115.json", "rex0220-print-craft-app1-20261001-090000.json"]);
    assert.deepEqual(l.edits, ["rex0220-print-craft-app1-20261001-090000-edit.json"]);
    assert.deepEqual(l.reports, ["納品書.json"]);
    assert.equal(l.hasFields, true);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("フォルダーの実体が作業フォルダーの外（symlink / junction）なら一覧しない: kintone/ と profile のフォルダー、アプリのフォルダーと records / out、inbox（B1 の Codex レビュー BLOCKER 1）", (t2) => {
  const t = makeConnWorkspace();
  const outside = mkdtempSync(path.join(os.tmpdir(), "pcraft-outside-"));
  const link = (target, at) => symlinkSync(target, at, "junction");
  try {
    mkdirSync(path.join(outside, "dev", "3740-外"), { recursive: true });
    writeFileSync(path.join(outside, "99.json"), "{}");
    try {
      link(outside, path.join(t.root, "kintone"));
    } catch (e) {
      t2.skip(`symlink を作れない: ${e.message}`);
      return;
    }
    assert.throws(() => findAppDir(t.root, "dev", 3740), PathError, "kintone/ が外");
    assert.throws(() => assertInsideWorkspace(t.root, path.join(t.root, "kintone")), /kintone の実体が作業フォルダーの外を指している/);
    rmSync(path.join(t.root, "kintone"));
    mkdirSync(path.join(t.root, "kintone"));
    link(path.join(outside, "dev"), path.join(t.root, "kintone", "dev"));
    assert.throws(() => findAppDir(t.root, "dev", 3740), PathError, "profile のフォルダーが外");
    rmSync(path.join(t.root, "kintone", "dev"));
    const app = t.appFolder("dev", 3740, "見積書");
    assert.equal(findAppDir(t.root, "dev", 3740), app, "中なら今までどおり");
    link(outside, path.join(app, "records"));
    assert.throws(() => listAppFolder(app, t.root), PathError, "records が外");
    const files = run(["files", "--app", "3740"], t.root, { PCRAFT_KINTONE_CONFIG: t.connFile });
    assert.equal(files.status, 2, files.stderr);
    assert.match(files.stderr, /作業フォルダーの外を指している/);
    assert.ok(!files.stdout.includes("99.json") && !files.stderr.includes("99.json"), "外のファイルの名前を出さない");
    rmSync(path.join(app, "records"));
    link(outside, path.join(app, "out"));
    assert.throws(() => listAppFolder(app, t.root), PathError, "out が外");
    link(outside, path.join(t.root, "inbox"));
    assert.throws(() => takeInbox(t.root, t.mode()), PathError, "inbox が外");
    const take = run(["take"], t.root, { PCRAFT_KINTONE_CONFIG: t.connFile });
    assert.equal(take.status, 2, take.stderr);
    assert.match(take.stderr, /inbox の実体が作業フォルダーの外を指している（symlink など）/);
  } finally {
    t.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("CLI（接続のファイルあり）: take → files → fields --summary → buttons --app → normalize は fields.json を同じフォルダーから、ダウンロードは書き換えない → edit → normalize → preview --record 3。--profile で prod", async () => {
  const t = makeConnWorkspace();
  const env = { PCRAFT_KINTONE_CONFIG: t.connFile };
  try {
    mkdirSync(path.join(t.root, "inbox"));
    writeFileSync(path.join(t.root, "inbox", DL), await snapshotText(3740));
    const tk = run(["take"], t.root, env);
    assert.equal(tk.status, 0, tk.stderr);
    const dir = path.join(t.root, "kintone", "dev", "3740-見積書(印刷屋)");
    writeFileSync(path.join(dir, "fields.json"), JSON.stringify(FIELDS_FILE));
    mkdirSync(path.join(dir, "records"));
    writeFileSync(path.join(dir, "records", "3.json"), JSON.stringify({ record: { 見積番号: { type: "SINGLE_LINE_TEXT", value: "S-1" } } }));
    const snap = path.join("kintone", "dev", "3740-見積書(印刷屋)", DL);
    const f = run(["files", "--app", "3740"], t.root, env);
    assert.equal(f.status, 0, f.stderr);
    assert.match(f.stdout, new RegExp(`${DL}  ← 今の設定`));
    assert.match(f.stdout, /profile dev、https:\/\/dev-x\.cybozu\.com/);
    const s = run(["fields", "--app", "3740", "--summary"], t.root, env);
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /^アプリ 3740 /);
    const b = run(["buttons", "--app", "3740"], t.root, env);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /1\. 見積書（有効/);
    const n1 = run(["normalize", snap], t.root, env);
    assert.equal(n1.status, 2);
    assert.match(n1.stderr, /ダウンロード \/ pull のファイルは書き換えない/);
    const n2 = run(["normalize", snap, "--dry-run", "--check"], t.root, env);
    assert.equal(n2.status, 0, n2.stderr + n2.stdout);
    assert.match(n2.stdout, /--check: 入力の派生値と生成した値は一致/);
    const e = run(["edit", "--app", "3740"], t.root, env);
    assert.equal(e.status, 0, e.stderr);
    const editFile = path.join("kintone", "dev", "3740-見積書(印刷屋)", DL.replace(".json", "-edit.json"));
    assert.equal(readFileSync(path.join(t.root, editFile), "utf8"), readFileSync(path.join(t.root, snap), "utf8"));
    const n3 = run(["normalize", editFile], t.root, env);
    assert.equal(n3.status, 0, n3.stderr + n3.stdout);
    assert.equal(run(["normalize", editFile, "--profile", "prod"], t.root, env).status, 2, "--profile とフォルダーの profile が違う");
    // アプリのフォルダーの中のファイルは同じフォルダーの fields.json だけ（別の fields で検査しない。Codex の実装レビュー MAJOR 3）
    mkdirSync(path.join(t.root, "fields"), { recursive: true });
    writeFileSync(path.join(t.root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    for (const cmd of [["normalize", editFile, "--dry-run", "--fields", "fields/3740.json"], ["preview", editFile, "--record", "3", "--fields", "fields/3740.json"]]) {
      const r = run(cmd, t.root, env);
      assert.equal(r.status, 1, `${cmd[0]}: ${r.stderr}`);
      assert.match(r.stderr, /同じフォルダーの fields\.json で検査する/);
    }
    assert.equal(run(["normalize", editFile, "--dry-run", "--fields", path.join("kintone", "dev", "3740-見積書(印刷屋)", "fields.json")], t.root, env).status, 0, "同じフォルダーの fields.json なら付けてもよい");
    const p = run(["preview", editFile, "--record", "3"], t.root, env);
    assert.notEqual(p.status, 2, p.stderr);
    assert.match(p.stdout, /見積書: 1 ページ/);
    assert.deepEqual(readdirSync(path.join(dir, "out")), ["見積書.html"], "out/ はアプリのフォルダーの中");
    // --profile prod のフォルダーはまだ無い
    const fp = run(["files", "--app", "3740", "--profile", "prod"], t.root, env);
    assert.equal(fp.status, 1);
    assert.match(fp.stderr, /kintone\/prod\/3740-…）が無い。先に .* fields --app 3740 --profile prod/);
  } finally {
    t.cleanup();
  }
});

test("CLI: --profile と --guest と --out の決まり、environments.json が残っていれば kintone を使うコマンドは止まる（settings/ の作業は動く）、接続のファイルの設定が空・相対パス（OS）は誤り、.env の相対パスは使える", () => {
  const t = makeConnWorkspace();
  try {
    const env = { PCRAFT_KINTONE_CONFIG: t.connFile };
    const g = run(["fields", "--app", "3740", "--guest", "1"], t.root, env);
    assert.equal(g.status, 2);
    assert.match(g.stderr, /--guest を使わない/);
    const o = run(["fields", "--app", "3740", "--out", "fields/x.json"], t.root, env);
    assert.equal(o.status, 2);
    assert.match(o.stderr, /--out を使わない/);
    const unknown = run(["files", "--app", "3740", "--profile", "stage"], t.root, env);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /profile「stage」は接続のファイル（connections\.json）に無い/);
    // 接続のファイルが無いとき（1 接続の形）
    const np = run(["fields", "--app", "3740", "--profile", "dev", "--summary"], t.root);
    assert.equal(np.status, 2);
    assert.match(np.stderr, /--profile は kintone の接続のファイル/);
    for (const cmd of [["take"], ["edit", "--app", "1"], ["files", "--app", "1"], ["buttons", "--app", "1"]]) {
      const r = run(cmd, t.root);
      assert.equal(r.status, 2, cmd.join(" "));
      assert.match(r.stderr, /接続のファイル（PCRAFT_KINTONE_CONFIG）があるときだけ使える/);
    }
    // 設定が空・OS の相対パス
    const empty = run(["files", "--app", "1"], t.root, { PCRAFT_KINTONE_CONFIG: "" });
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /接続のファイル（PCRAFT_KINTONE_CONFIG）が空/);
    const relOs = run(["files", "--app", "1"], t.root, { PCRAFT_KINTONE_CONFIG: "../connections.json" });
    assert.equal(relOs.status, 1);
    assert.match(relOs.stderr, /絶対パスで書く/);
    // .env の相対パス（.env のフォルダーから）は使える
    writeFileSync(path.join(t.root, ".env"), "PCRAFT_KINTONE_CONFIG=../connections.json\n");
    const relEnv = run(["files", "--app", "3740"], t.root);
    assert.equal(relEnv.status, 1, relEnv.stderr);
    assert.match(relEnv.stderr, /kintone\/dev\/3740-…）が無い/, "接続のファイルを読めた（フォルダーがまだ無いと言う）");
    rmSync(path.join(t.root, ".env"));
    // environments.json が残っている
    writeFileSync(path.join(t.root, "environments.json"), JSON.stringify({ environments: {} }));
    const legacy = run(["fields", "--app", "3740", "--summary"], t.root);
    assert.equal(legacy.status, 1);
    assert.match(legacy.stderr, /environments\.json は tools 2\.0\.0 から使わない/);
    mkdirSync(path.join(t.root, "settings"));
    mkdirSync(path.join(t.root, "fields"));
    writeFileSync(path.join(t.root, "settings", "a.json"), JSON.stringify(aiSettings()));
    writeFileSync(path.join(t.root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    const local = run(["normalize", "settings/a.json", "--fields", "fields/3740.json", "--dry-run"], t.root);
    assert.equal(local.status, 0, local.stderr + local.stdout);
    const withConn = run(["files", "--app", "3740"], t.root, env);
    assert.match(withConn.stderr, /3740-…）が無い/, "接続のファイルがあれば environments.json は読まない");
  } finally {
    t.cleanup();
  }
});
