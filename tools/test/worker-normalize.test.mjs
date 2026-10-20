/**
 * normalize と保存の検査を子プロセスで（tools 2.3.0。print-craft の docs/authoring-try-plan.md 4.6、T0b）:
 *   - normalizeInChild は、このプロセスの normalizeSettings と同じ結果（findings、派生値、--check の差。封筒の date は時刻なので除く）。pid は親と違う
 *   - saveNewSettings / updateButton は evaluator を渡せば子プロセスで検査する（答えない子プロセスは時間の上限で止め、保存しない。status failed、code EvalTimeoutError）
 *   - normalize の検査は検証用のモード（fieldCheck）で、重い繰り返しも回さない。重いのは preview の描画（T0c）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";
import { normalizeSettings } from "../src/commands/normalize.ts";
import { normalizeInChild } from "../src/worker/evaluator.ts";
import { saveNewSettings, updateButton, digestOf } from "../src/commands/save.ts";
import { realResolve } from "../src/safe-path.ts";

const ZIP = process.env.PCRAFT_PLUGIN_ZIP;
const skip = ZIP && existsSync(ZIP) ? false : "テストの印刷屋の zip が無い";
const policy = { allowExternal: [] };
const withoutDate = (o) => (o ? { ...o, date: undefined } : o);

test("normalizeInChild はこのプロセスの normalizeSettings と同じ結果（findings・派生値・--check）。pid は親と違う", { skip }, async () => {
  const engine = await loadEngine();
  engine.setContext({ baseUrl: "https://x.cybozu.com", appId: FIELDS_FILE.appId });
  for (const check of [false, true]) {
    const input = { settingsText: JSON.stringify(aiSettings()), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, policy, check, baseUrl: "https://x.cybozu.com" };
    const local = await normalizeSettings({ ...input, engine });
    const child = await normalizeInChild({ pluginZip: ZIP }, input);
    assert.notEqual(child.diag.pid, process.pid);
    assert.deepEqual(child.findings.items, local.findings.items, `check ${check}`);
    assert.equal(child.summary, local.summary);
    assert.deepEqual(withoutDate(child.output), withoutDate(local.output));
    assert.deepEqual(child.body, local.body);
    assert.deepEqual(child.size, local.size);
    assert.deepEqual(child.checkDiffs, local.checkDiffs);
    assert.equal(child.findings.hasErrors, false);
  }
  // エラーのある設定（JSON でない）も同じ findings
  const bad = await normalizeInChild({ pluginZip: ZIP }, { settingsText: "{", settingsFile: "settings/x.json", fields: FIELDS_FILE, policy });
  assert.equal(bad.findings.hasErrors, true);
  assert.equal(bad.output, undefined);
});

function makeWork() {
  const root = realResolve(".", mkdtempSync(path.join(os.tmpdir(), "pcraft-save-child-")));
  mkdirSync(path.join(root, "settings"));
  mkdirSync(path.join(root, "fields"));
  writeFileSync(path.join(root, "fields", "3740.json"), JSON.stringify(FIELDS_FILE));
  return root;
}

test("saveNewSettings / updateButton は evaluator を渡せば子プロセスで検査して保存する", { skip }, async () => {
  const root = makeWork();
  const ctx = { root, evaluator: { pluginZip: ZIP }, policy };
  try {
    const r = await saveNewSettings(ctx, { path: "settings/見積書.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.equal(r.status, "ok", r.message);
    const file = path.join(root, "settings", "見積書.json");
    const out = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(out.usedFields && out.pluginInfos[0].tagsInfo.fieldsInfo[2].formula, "派生値を作って書いた（子プロセスの normalize の出力）");
    const button = { ...aiSettings().pluginInfos[0], desc: "子プロセスで検査した差し替え" };
    const u = await updateButton(ctx, { path: "settings/見積書.json", button: "見積書", expectedDigest: digestOf(readFileSync(file)), replacement: JSON.stringify(button), fields: "fields/3740.json" });
    assert.equal(u.status, "ok", u.message);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).pluginInfos[0].desc, "子プロセスで検査した差し替え");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("保存の検査も子プロセスの上限の中で動く: 答えない子プロセスは時間の上限で止め、保存しない（status failed、code EvalTimeoutError）", { skip }, async () => {
  // normalize の検査は検証用のモードで、重い繰り返しも回さない（上限 1,000 万回の式も 1 ms）。上限を試すため、答えない入口に差し替える
  const dir = mkdtempSync(path.join(os.tmpdir(), "pcraft-silent-"));
  const entry = path.join(dir, "silent.mjs");
  writeFileSync(entry, "process.once('message', () => setInterval(() => {}, 1000));");
  const root = makeWork();
  try {
    const r = await saveNewSettings({ root, evaluator: { pluginZip: ZIP, run: { timeoutSec: 1, workerFile: entry } }, policy }, { path: "settings/止まる.json", content: JSON.stringify(aiSettings()), fields: "fields/3740.json", expectedAbsent: true });
    assert.deepEqual([r.status, r.code], ["failed", "EvalTimeoutError"], JSON.stringify(r));
    assert.match(r.message, /1 秒を超えた/);
    assert.equal(existsSync(path.join(root, "settings", "止まる.json")), false, "保存しない");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
