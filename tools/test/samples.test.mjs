/**
 * docs/samples/<名前>/ の整合（docs/authoring-plan.md 12.4 の「samples が normalize --check で差 0」）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { REPO_ROOT } from "../src/paths.ts";
import { normalizeSettings, jsonDiff } from "../src/commands/normalize.ts";
import { runPreview } from "../src/commands/preview.ts";

const samplesDir = path.join(REPO_ROOT, "docs", "samples");
const samples = existsSync(samplesDir) ? readdirSync(samplesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
const engine = await loadEngine();
const stripDate = (o) => {
  const { date, ...rest } = o;
  return rest;
};

test("samples がある", () => {
  assert.ok(samples.length >= 2, `docs/samples に 2 つ以上: ${samples.join(", ")}`);
});

for (const name of samples) {
  const dir = path.join(samplesDir, name);
  test(`sample ${name}: settings-source → normalize はエラー 0 で settings.json と一致、再正規化で差 0`, async () => {
    const fields = JSON.parse(readFileSync(path.join(dir, "fields.json"), "utf8"));
    const source = readFileSync(path.join(dir, "settings-source.json"), "utf8");
    const r = await normalizeSettings({ settingsText: source, settingsFile: `docs/samples/${name}/settings-source.json`, fields, engine });
    assert.ok(!r.findings.hasErrors, r.findings.format());
    assert.ok(r.output);
    const committed = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"));
    const diffs = [];
    jsonDiff(stripDate(committed), stripDate(r.output), "$", diffs);
    assert.deepEqual(diffs, [], "settings.json が settings-source.json の正規化結果と違う（normalize をやり直してコミット）");
    const again = await normalizeSettings({ settingsText: JSON.stringify(committed), fields, engine, check: true });
    assert.deepEqual(again.checkDiffs, []);
  });
  if (existsSync(path.join(dir, "record.json"))) {
    test(`sample ${name}: preview が通る`, async () => {
      const fields = JSON.parse(readFileSync(path.join(dir, "fields.json"), "utf8"));
      const recordFile = JSON.parse(readFileSync(path.join(dir, "record.json"), "utf8"));
      const r = await runPreview({ settingsText: readFileSync(path.join(dir, "settings.json"), "utf8"), fields, recordFile, engine });
      assert.ok(!r.findings.hasErrors, r.findings.format());
      assert.ok(r.results.length >= 1);
      for (const b of r.results) {
        assert.deepEqual(b.errors, [], `${b.menu} の式のエラー`);
        assert.ok(b.pages >= 1, `${b.menu} のページ`);
      }
    });
  }
}
