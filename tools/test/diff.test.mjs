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

test("diffSettings: data: の URL は先頭・長さ・sha256 の先頭だけ（社印で数千文字。2026-10-05）。同じ長さでも中身が違えば見分けられる", () => {
  const seal = (c) => `data:image/svg+xml;base64,${c.repeat(3000)}`;
  const withSeal = (src, before = "") => {
    const s = aiSettings();
    const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
    row.html = row.html.replace(/<img class="pcraft-inv-seal"[^>]*src="data:[^"]+">/, (img) => `${before}${img.replace(/src="data:[^"]+"/, `src="${src}"`)}`);
    return s;
  };
  // 社印は変えずに、社印のすぐ上に 1 行足す（試用で TEL を足したときと同じ）: 前後の行に出る社印は短くなる
  const out1 = diffSettings(withSeal(seal("A")), withSeal(seal("A"), "<p>TEL</p>\n      "));
  assert.match(out1, /^\+\s+<p>TEL<\/p>$/m);
  assert.ok(!out1.includes("A".repeat(100)), "data URL をそのまま出さない");
  assert.match(out1, /…（data URL 3,026 文字、sha256 [0-9a-f]{8}）/);
  assert.ok(out1.includes("（data: の URL は先頭・長さ・sha256 の先頭だけ）"));
  // 社印の中身だけが変わる（長さは同じ）: - と + の行が sha256 で見分けられる
  const out2 = diffSettings(withSeal(seal("A")), withSeal(seal("B")));
  const hashes = [...out2.matchAll(/sha256 ([0-9a-f]{8})/g)].map((m) => m[1]);
  assert.equal(new Set(hashes).size, 2, out2);
  assert.equal(diffSettings(withSeal(seal("A")), withSeal(seal("A"))), "差分なし（派生値 formula / usedFields / id / views / pluginUOG は除く。--derived で含める）");
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
