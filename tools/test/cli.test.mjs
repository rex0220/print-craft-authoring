/** CLI を子プロセスで動かす: version の終了コードと --expect、外したオプションの拒否、書き込み先の制限 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_ZIP } from "./helpers.mjs";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/** OS の環境変数の KINTONE_* / KSQL_*（開発者の PC に入っていることがある）は子プロセスに渡さない */
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(KINTONE_|KSQL_|PCRAFT_)/.test(k)));

function run(args, opt = {}) {
  const r = spawnSync(process.execPath, ["--no-warnings", CLI, ...args], {
    encoding: "utf8",
    env: { ...baseEnv, PCRAFT_PLUGIN_ZIP: PLUGIN_ZIP, ...(opt.env ?? {}) },
    cwd: opt.cwd ?? path.dirname(CLI)
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("version: zip の版・API・エンジンの SHA-256 を出して 0。--expect が zip の版と同じなら 0", () => {
  const r = run(["version"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /印刷屋プラグイン: 版 6、authoring API 1/);
  assert.match(r.stdout, /プラグイン ID: lcapkanpjdabgphknkabojmcfhonhkhp/);
  assert.match(r.stdout, /計算式エンジン: sha256 [0-9a-f]{64}/);
  assert.match(r.stdout, /扱う印刷屋 Ver\.6 以降、API 1, 2/);
  const ok = run(["version", "--expect", "6"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /--expect 6: 一致/);
});

test("version --expect: zip の版と違えば 1（tools が対応しない版も 1）。--json は ok: false と error", () => {
  const r = run(["version", "--expect", "5"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--expect 5/);
  const j = JSON.parse(run(["version", "--json", "--expect", "5"]).stdout);
  assert.equal(j.ok, false);
  assert.equal(j.expected, "5");
  assert.equal(j.plugin.pluginVersion, "6");
  assert.equal(j.plugin.pluginId, "lcapkanpjdabgphknkabojmcfhonhkhp");
  assert.match(j.error, /--expect 5: tools .* が扱う印刷屋の版は Ver\.6 以降/);
  const v7 = JSON.parse(run(["version", "--json", "--expect", "7"]).stdout);
  assert.equal(v7.ok, false, "tools は Ver.7 を扱えるが、zip（Ver.6）の版と違う");
  assert.match(v7.error, /zip の印刷屋の版は 6/);
  const same = JSON.parse(run(["version", "--json", "--expect", "6"]).stdout);
  assert.equal(same.ok, true);
  assert.equal(same.error, undefined);
});

test("version: zip が読めなければ 1 で理由を出す。--plugin-zip / --env / --policy は使えない（2）", () => {
  const r = run(["version"], { env: { PCRAFT_PLUGIN_ZIP: path.join(path.dirname(CLI), "no-such-plugin.zip") } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /印刷屋の zip/);
  for (const opt of ["--plugin-zip", "--policy"]) {
    const x = run(["version", opt, "x"]);
    assert.equal(x.status, 2, opt);
    assert.match(x.stderr, /は使えない/);
  }
  // --env は 2.0.0 からいつも断る（environments.json の形をやめた。--profile にする）。--profile は名前の形を確かめる
  for (const v of ["x", "../.env"]) {
    const e = run(["version", "--env", v]);
    assert.equal(e.status, 2);
    assert.match(e.stderr, /--env は tools 2\.0\.0 から使わない。.*--profile/);
  }
  const p = run(["version", "--profile", "../x"]);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /--profile には接続のファイルの profile の名前/);
});

test("normalize / preview: 読むのは作業フォルダーの中、書くのは settings/ temp/ out/ の下だけ", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-cli-"));
  try {
    mkdirSync(path.join(work, "settings"));
    mkdirSync(path.join(work, "fields"));
    mkdirSync(path.join(work, "docs"));
    writeFileSync(path.join(work, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    writeFileSync(path.join(work, "settings", "a.json"), JSON.stringify(aiSettings()));
    writeFileSync(path.join(work, "docs", "b.json"), JSON.stringify(aiSettings()));
    const outside = path.join(os.tmpdir(), "pcraft-outside.json");
    // 作業フォルダーの外の入力は読まない
    const r1 = run(["normalize", outside, "--fields", "fields/3740.json", "--dry-run"], { cwd: work });
    assert.equal(r1.status, 2, r1.stderr);
    assert.match(r1.stderr, /作業フォルダーの中/);
    // settings/ の下に書き戻せる
    const r2 = run(["normalize", "settings/a.json", "--fields", "fields/3740.json"], { cwd: work });
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    assert.match(r2.stdout, /出力: settings[\\/]a\.json/);
    // docs/ の下には書き戻せない（--dry-run なら読める）
    const r3 = run(["normalize", "docs/b.json", "--fields", "fields/3740.json"], { cwd: work });
    assert.equal(r3.status, 2, r3.stderr);
    assert.match(r3.stderr, /書き込み先は settings\/ か temp\/ か kintone\/ の下/);
    const r4 = run(["normalize", "docs/b.json", "--fields", "fields/3740.json", "--dry-run"], { cwd: work });
    assert.equal(r4.status, 0, r4.stderr + r4.stdout);
    // --out で policy/ や .env には書けない
    for (const bad of ["policy/authoring-policy.json", ".env", "../x.json", "README.md"]) {
      const r = run(["normalize", "settings/a.json", "--fields", "fields/3740.json", "--out", bad], { cwd: work });
      assert.equal(r.status, 2, `${bad}: ${r.stderr}`);
    }
    assert.ok(!existsSync(path.join(work, ".env")));
    assert.ok(!existsSync(path.join(work, "policy")));
    // preview の --out-dir は out/ の下だけ
    writeFileSync(path.join(work, "settings", "r.json"), JSON.stringify({ record: { 見積番号: { type: "SINGLE_LINE_TEXT", value: "S-1" } } }));
    const r5 = run(["preview", "settings/a.json", "--fields", "fields/3740.json", "--record", "settings/r.json", "--out-dir", "docs"], { cwd: work });
    assert.equal(r5.status, 2, r5.stderr);
    assert.match(r5.stderr, /出力フォルダーは out\//);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

const ZIP9 = path.join(path.dirname(PLUGIN_ZIP), "print-craft-plugin9.zip");
test("preview: 重い式は評価の子プロセスの時間の上限（PCRAFT_EVAL_TIMEOUT_SEC）で止まり、終了コード 1 で描かない（tools 2.3.0、T0d）", { skip: existsSync(ZIP9) ? false : `Ver.9 の zip が無い: ${ZIP9}` }, () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-cli-"));
  try {
    mkdirSync(path.join(work, "settings"));
    mkdirSync(path.join(work, "fields"));
    mkdirSync(path.join(work, "records"));
    writeFileSync(path.join(work, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    const s = aiSettings();
    s.pluginInfos[0].tagsInfo.fieldsInfo[2].formulaSet = "ARRAY_COUNT(ARRAY_FOR(100000, i, ARRAY_COUNT(ARRAY_FOR(100000, j, i))))";
    writeFileSync(path.join(work, "settings", "a.json"), JSON.stringify(s));
    writeFileSync(path.join(work, "records", "r.json"), JSON.stringify({ record: { $id: { type: "__ID__", value: "1" } } }));
    const t0 = Date.now();
    const r = run(["preview", "settings/a.json", "--fields", "fields/3740.json", "--record", "records/r.json"], { cwd: work, env: { PCRAFT_PLUGIN_ZIP: ZIP9, PCRAFT_EVAL_TIMEOUT_SEC: "1" } });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /1 秒を超えたので止めた/);
    assert.ok(Date.now() - t0 < 15_000, `止めるのが遅い（${Date.now() - t0} ms）`);
    assert.ok(!existsSync(path.join(work, "out")), "描かない");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("preview: レコードの形が分からないときは決まった文で終了コード 1（中核の InputError。B1 の Codex 3 回目）", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-cli-"));
  try {
    mkdirSync(path.join(work, "settings"));
    mkdirSync(path.join(work, "fields"));
    mkdirSync(path.join(work, "records"));
    writeFileSync(path.join(work, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
    writeFileSync(path.join(work, "settings", "a.json"), JSON.stringify(aiSettings()));
    writeFileSync(path.join(work, "records", "bad.json"), JSON.stringify({ foo: 1 }));
    const r = run(["preview", "settings/a.json", "--fields", "fields/3740.json", "--record", "records/bad.json"], { cwd: work });
    assert.equal(r.status, 1, r.stderr + r.stdout);
    assert.match(r.stderr, /レコードの JSON の形が分からない/);
    assert.ok(!existsSync(path.join(work, "out")), "描かない");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("try: お試しアプリで式と 1 ボタンを試す。帳票は out/try/<app>-<番号>.html（毎回上書き）、描けなかった対象（関連レコード一覧の上限）は古いファイルを消して終了コード 1（tools 2.3.0、T3）", { skip: existsSync(ZIP9) ? false : `Ver.9 の zip が無い: ${ZIP9}` }, () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "pcraft-cli-try-"));
  const env = { PCRAFT_PLUGIN_ZIP: ZIP9 };
  try {
    const f = run(["try", "--formula", 'DATE_FORMAT(日付1, "YYYY/MM/DD")', "--formula", "zz"], { cwd: work, env });
    assert.equal(f.status, 0, f.stderr);
    assert.match(f.stdout, /レコード 1: "2026\/01\/15"/);
    assert.match(f.stdout, /エラー: getVal FIELD CODE NOT FOUND: zz/);
    writeFileSync(path.join(work, "b.json"), JSON.stringify({ html: '<div class="rex0220-pcraft-page">${ESC_HTML(宛名)} 様</div>' }));
    const b = run(["try", "--app", "quote", "--records", "1", "--button", "b.json", "--json"], { cwd: work, env });
    assert.equal(b.status, 0, b.stderr);
    const out = JSON.parse(b.stdout);
    assert.deepEqual(out.written, ["out/try/quote-1.html"]);
    assert.match(readFileSync(path.join(work, "out", "try", "quote-1.html"), "utf8"), /株式会社あれこれ/);
    // 前の結果を置いてから、作らない対象（gantt の 1,001 行）で試す → 消す
    mkdirSync(path.join(work, "out", "try"), { recursive: true });
    writeFileSync(path.join(work, "out", "try", "gantt-rows.html"), "old");
    writeFileSync(path.join(work, "g.json"), JSON.stringify({ html: '<div class="rex0220-pcraft-page">${COUNTROW(task_list)}</div>' }));
    const g = run(["try", "--app", "gantt", "--rows", "1001", "--button", "g.json"], { cwd: work, env });
    assert.equal(g.status, 1, g.stdout + g.stderr);
    assert.match(g.stdout, /作らない: .*1,001 件/);
    assert.match(g.stdout, /消した（前の結果）: out\/try\/gantt-rows.html/);
    assert.equal(existsSync(path.join(work, "out", "try", "gantt-rows.html")), false);
    const bad = run(["try", "--count", "3", "--formula", "1"], { cwd: work, env });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /count を使えない/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
