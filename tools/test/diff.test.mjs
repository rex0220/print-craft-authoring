/** diff: ボタン単位の差分（HTML / CSS / 式は行の差分）、派生値は既定で除く */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSettings } from "../src/commands/diff.ts";
import { lineDiff, formatDiff } from "../src/normalize/line-diff.ts";
import { aiSettings } from "./fixtures.mjs";

test("lineDiff / formatDiff", () => {
  const d = lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne");
  assert.deepEqual(d.map((l) => l.kind + l.text), [" a", "-b", "+B", " c", " d", "+e"]);
  assert.equal(formatDiff(d, 0), "  …\n- b\n+ B\n  …\n+ e");
});

test("diffSettings: 変わったボタンの項目・行・更新項目だけ。派生値は --derived", () => {
  const a = aiSettings();
  const b = aiSettings();
  b.pluginInfos[0].tagsInfo.printMode = "direct";
  b.pluginInfos[0].tagsInfo.fieldsInfo[2].html = b.pluginInfos[0].tagsInfo.fieldsInfo[2].html.replace("見積書</div>", "御見積書</div>");
  b.pluginInfos[0].calcInfo.fieldsInfo[1].formulaSet = 'ARRAY("済","済2")';
  b.pluginInfos[0].tagsInfo.fieldsInfo[0].usedFields = { 見積ファイル: 1 };
  b.pluginInfos.push({ state: false, menu: "請求書", tagsInfo: { fieldsInfo: [], filecode: "", pageSize: "A4", orientation: "p", dpi: "96" }, calcInfo: { fieldsInfo: [] } });
  const text = diffSettings(a, b);
  assert.match(text, /ボタン 見積書 \/ HTML 設定 \/ printMode: "confirm" → "direct"/);
  assert.match(text, /HTML 設定 3 行目 \/ html:/);
  // 行の差分は「印 + 空白 + 元の行」。元の行の先頭の 2 つの空白が残る
  assert.match(text, /^- {3}<div class="pcraft-inv-header">見積書<\/div>$/m);
  assert.match(text, /^\+ {3}<div class="pcraft-inv-header">御見積書<\/div>$/m);
  assert.match(text, /更新項目 発行済み \/ formulaSet:/);
  assert.match(text, /ボタン 請求書: 追加/);
  assert.ok(!/派生 usedFields/.test(text), "派生値は既定で出ない（末尾の注記に名前が出るだけ）");
  assert.match(diffSettings(a, b, { derived: true }), /派生 usedFields/);
  assert.match(diffSettings(a, a), /^差分なし/);
});
