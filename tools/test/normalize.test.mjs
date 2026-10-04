/** normalize: 派生値の生成（設定画面と同じ）、更新項目の行の再構成、検査、往復（--check）、出力の封筒 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEngine } from "./helpers.mjs";
import { PRINT_CRAFT_ROOT } from "../src/paths.ts";
import { normalizeSettings, jsonDiff } from "../src/commands/normalize.ts";
import { FIELDS_FILE, aiSettings, HTML_TEMPLATE } from "./fixtures.mjs";

const engine = await loadEngine();
const PLUGIN_ID = engine.api.pluginId;
const run = (settings, extra = {}) => normalizeSettings({ settingsText: JSON.stringify(settings), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, engine, now: () => new Date(2026, 9, 4, 12, 0, 0), ...extra });
const rules = (r, level) => r.findings.items.filter((f) => f.level === level).map((f) => f.rule);

test("API の pluginId は print-craft の設定画面の PLUGIN_ID_NAME と同じ", () => {
  assert.equal(PLUGIN_ID, "rex0220 Print craft plugin");
  const src = readFileSync(path.join(PRINT_CRAFT_ROOT, "src", "config", "plugin-id.ts"), "utf8");
  assert.ok(src.includes(`"${PLUGIN_ID}"`));
});

test("AI が書いた形から派生値を生成する（formula / usedFields / id / views / ルートの usedFields / pluginUOG）", async () => {
  const r = await run(aiSettings());
  assert.deepEqual(rules(r, "error"), []);
  assert.ok(r.output, "エラーが無いので出力がある");
  const row = r.output.pluginInfos[0];
  assert.equal(row.id, 1);
  assert.deepEqual(row.views, {});
  const tags = row.tagsInfo.fieldsInfo;
  assert.deepEqual(tags.map((t) => t.id), [1, 2, 3]);
  assert.deepEqual(tags[0].usedFields, { 見積ファイル: 1 });
  assert.equal(tags[0].formula, "NOT(見積ファイル)");
  assert.deepEqual(tags[1].usedFields, { 見積番号: 1 });
  assert.deepEqual(tags[2].usedFields, { 見積明細: 5, 商品名: 2, 数量: 2, 単価: 2, 金額: 2, $html: 1, 備考: 1 });
  assert.ok(!tags[2].formula.includes("// 複数行"), "formula はコメントを除いたもの");
  assert.equal(row.tagsInfo.printMode, "confirm");
  assert.deepEqual(r.output.usedFields, {});
  assert.equal(r.output.pluginUOG, false);
  assert.equal(r.output.pluginID, PLUGIN_ID);
  assert.equal(r.output.PluginVersion, "6");
  assert.equal(r.output.appId, 3740);
  assert.equal(r.output.date, "2026-10-04 12:00:00");
  assert.equal(r.output.cssInfo.length, 4);
  assert.deepEqual(r.output.guestsInfo, []);
  assert.ok(r.output.menuInfo);
});

test("更新項目の行は AI の行だけを残し、メタデータを fields + layout の一覧で上書きする（設定画面の「未使用を除く」の後の形）", async () => {
  const r = await run(aiSettings());
  const calc = r.output.pluginInfos[0].calcInfo;
  const codes = calc.fieldsInfo.map((c) => c.fieldcode);
  assert.deepEqual(codes, ["$out", "発行済み"], "一覧にあって入力に無い項目は足さない");
  const issued = calc.fieldsInfo[1];
  assert.equal(issued.state, true);
  assert.equal(issued.type, "CHECK_BOX");
  assert.equal(issued.fieldlabel, "発行済み");
  assert.equal(issued.row_type, "グループ", "グループの中の行は row_type がグループのコード");
  assert.equal(issued.remark, "発行したら印を付ける");
  assert.equal(issued.formula, 'ARRAY("済")');
  assert.equal(calc.fieldsInfo[0].type, "BOOL");
  assert.equal(calc.fieldsInfo[0].row_type, "更新条件");
  const s = aiSettings();
  s.pluginInfos[0].calcInfo = { fieldsInfo: [] };
  const r2 = await run(s);
  assert.deepEqual(r2.output.pluginInfos[0].calcInfo, { fieldsInfo: [], usedFields: {}, flinkage: false });
});

test("往復: 正規化した出力をもう一度正規化しても変わらない（--check の差 0）", async () => {
  const first = await run(aiSettings());
  const second = await run(first.output, { check: true });
  assert.deepEqual(second.checkDiffs, []);
  const diffs = [];
  jsonDiff(stripEnvelope(first.output), stripEnvelope(second.output), "$", diffs);
  assert.deepEqual(diffs, []);
});

function stripEnvelope(o) {
  const { date, pluginName, pluginID, PluginVersion, appId, appName, ...rest } = o;
  return rest;
}

test("警告と情報: 生の HTML を入れる関数、保存値の大きさ。数値・日付の FVAL / DATE_FORMAT と ESC_HTML は警告しない", async () => {
  const r = await run(aiSettings());
  const w = rules(r, "warning");
  assert.ok(!w.includes("html.rawExpression"), "${FVAL(合計金額)} ${DATE_FORMAT(見積日,…)} ${ESC_HTML(宛名)} は安全");
  assert.ok(w.includes("formula.rawHtml"), "TABLE_HTML / REPLACE … の生の HTML");
  assert.ok(rules(r, "info").includes("size"));
  assert.ok(r.size.ok);
  assert.ok(r.size.totalBytes > 1000 && r.size.totalBytes < 262144);
});

test("警告: 文字列の項目を ESC_HTML なしで差し込むと html.rawExpression（FVAL(文字列) も）", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  row.html = row.html.replace("${ESC_HTML(宛名)}", "${宛名} ${FVAL(備考)} ${合計金額} ${TODAY()} ${REPLACE(ESC_HTML(備考), \"\\n\", \"<br>\")}");
  const r = await run(s);
  const w = r.findings.items.find((f) => f.rule === "html.rawExpression");
  assert.ok(w, "警告が出る");
  assert.ok(w.message.includes("${宛名}") && w.message.includes("${FVAL(備考)}"));
  const listed = w.message.split("（文字列の項目は")[0];
  assert.ok(!listed.includes("${合計金額}") && !listed.includes("${TODAY()}") && !listed.includes("${REPLACE(ESC_HTML(備考)"), `数値・TODAY・REPLACE(ESC_HTML) は安全: ${listed}`);
});

test("封筒の誤りは止まる: pluginID、PluginVersion、JSON でない", async () => {
  assert.deepEqual(rules(await run(aiSettings({ pluginID: "other" })), "error"), ["envelope.pluginID"]);
  assert.deepEqual(rules(await run(aiSettings({ PluginVersion: "5" })), "error"), ["envelope.version"]);
  const bad = await normalizeSettings({ settingsText: "{", fields: FIELDS_FILE, engine });
  assert.deepEqual(rules(bad, "error"), ["json"]);
  const noEnvelope = await run({ pluginEnable: true, pluginInfos: [] });
  assert.ok(rules(noEnvelope, "error").includes("envelope.pluginID"));
});

test("検査: 列挙、保存先、更新項目にできない項目、無い項目、構文エラー", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0];
  row.tagsInfo.pageSize = "A7";
  row.tagsInfo.dpi = "72";
  row.tagsInfo.printMode = "now";
  row.tagsInfo.filecode = "宛名";
  row.tagsInfo.fieldsInfo[0].formulaSet = "NOT(見積ファイル";
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "金額", formulaSet: "1" });
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "見積ファイル", formulaSet: "1" });
  row.calcInfo.fieldsInfo.push({ state: true, fieldcode: "存在しない", formulaSet: "1" });
  const r = await run(s);
  const e = r.findings.items.filter((f) => f.level === "error");
  const by = (rule) => e.filter((f) => f.rule === rule).map((f) => f.message);
  assert.match(by("tags.pageSize")[0], /A7/);
  assert.match(by("tags.dpi")[0], /72/);
  assert.match(by("tags.printMode")[0], /now/);
  assert.match(by("tags.filecode")[0], /添付ファイル項目/);
  assert.match(by("formula.syntax")[0], /評価できない/);
  assert.equal(by("calc.ineligible").length, 3);
  assert.match(by("calc.ineligible").find((m) => m.includes("金額")), /テーブル 見積明細 の中/);
  assert.match(by("calc.ineligible").find((m) => m.includes("見積ファイル")), /更新できない型/);
  assert.match(by("calc.ineligible").find((m) => m.includes("存在しない")), /fields に無い/);
  assert.equal(r.output, undefined, "エラーがあれば書き出さない");
});

test("検査: HTML の危険な書き方はエラー。外部 URL は「除く」の設定ではエラー（印刷屋が除くので帳票に出ない）、「許可」の設定では承認（policy）が無ければ警告・あれば情報。.env の接続先と同じオリジンの iframe は許す", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0];
  row.tagsInfo.fieldsInfo[2].html = HTML_TEMPLATE.replace("##table##", `<script>alert(1)</script><p title="\${宛名}" onclick="x()">x</p><img src="https://cdn.example.com/seal.png"><iframe src="https://x.cybozu.com/k/3740/report/portlet?report=1"></iframe><iframe src="https://evil.example.com/"></iframe>##table##`);
  const env = { baseUrl: "https://x.cybozu.com" };
  const r = await run(s, env);
  const msgs = r.findings.items.filter((f) => f.rule === "html.rule" && f.level === "error").map((f) => f.message);
  assert.ok(msgs.some((m) => m.includes("<script>")));
  assert.ok(msgs.some((m) => m.includes("onclick")));
  assert.ok(msgs.some((m) => m.includes("${式}")));
  assert.equal(msgs.filter((m) => m.includes("iframe")).length, 1, "他のオリジンの iframe だけエラー");
  const blocked = r.findings.items.filter((f) => f.rule === "external.blocked" && f.level === "error");
  assert.ok(blocked.some((f) => f.message.includes("cdn.example.com") && f.message.includes("帳票に出ない")), r.findings.format());
  assert.ok(!r.findings.items.some((f) => f.rule === "external.url"), "「除く」の設定では承認の対象にしない（承認しても帳票に出ない）");
  // 「許可」（Ver.5 と同じ。自己責任）は利用者の承認（allowExternalRefs）が要る。承認があれば外部 URL は allowExternal の対象（警告 / 情報）
  const allow = { ...s, externalRefs: "allow" };
  const unapproved = await run(allow, env);
  assert.ok(unapproved.findings.items.some((f) => f.rule === "externalRefs.unapproved" && f.level === "error" && f.message.includes("settings/見積書.json")), unapproved.findings.format());
  assert.equal(unapproved.output, undefined);
  const approved = { allowExternal: [], allowExternalRefs: ["settings/見積書.json"] };
  const warn = await run(allow, { ...env, policy: approved });
  assert.ok(warn.findings.items.some((f) => f.rule === "externalRefs.allowed" && f.level === "info"));
  assert.ok(warn.findings.items.some((f) => f.rule === "external.url" && f.level === "warning" && f.message.includes("cdn.example.com")));
  assert.ok(!warn.findings.items.some((f) => f.rule === "external.blocked"));
  const ok = await run(allow, { ...env, policy: { ...approved, allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/見積書.json"] }] } });
  assert.ok(ok.findings.items.some((f) => f.rule === "external.allowed" && f.level === "info"));
  assert.ok(!ok.findings.items.some((f) => f.rule === "external.url"));
  const other = await run(allow, { ...env, policy: { ...approved, allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/other.json"] }] } });
  assert.ok(other.findings.items.some((f) => f.rule === "external.url"));
});

test("外部参照（externalRefs）: キーが無ければ印刷屋は許可で動くので \"allow\" を明示して承認を求める。不正な値はエラー。diff に出る", async () => {
  const legacy = aiSettings();
  delete legacy.externalRefs;
  const r = await run(legacy);
  assert.ok(rules(r, "info").includes("externalRefs.legacy"), r.findings.format());
  assert.ok(rules(r, "error").includes("externalRefs.unapproved"));
  assert.equal(r.output, undefined);
  const ok = await run(legacy, { policy: { allowExternal: [], allowExternalRefs: ["settings/見積書.json"] } });
  assert.deepEqual(rules(ok, "error"), [], ok.findings.format());
  assert.equal(ok.output.externalRefs, "allow", "出力には明示する（設定画面と同じ）");
  const bad = await run(aiSettings({ externalRefs: "yes" }));
  assert.ok(rules(bad, "error").includes("externalRefs.value"), bad.findings.format());
  const block = await run(aiSettings());
  assert.equal(block.output.externalRefs, "block");
  assert.ok(!block.findings.items.some((f) => f.rule.startsWith("externalRefs.")), "\"block\" は何も言わない");
  const { diffSettings } = await import("../src/commands/diff.ts");
  assert.match(diffSettings(block.output, ok.output), /externalRefs: "block" → "allow"/);
});

test("検査: 帳票の行の計算式が作る HTML は警告だけ（止めるのは印刷屋の描画前の掃除）: HTML を作る関数、定数でない要素名・属性、定数の HTML / CSS、外部 URL", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  // 文字列の中の // は印刷屋の stripComments が切るので（下のテスト）、ここでは https: の後に // を置かない形で書く
  row.formulaSet = `"<img src=https:evil.example/pixel>" & TAGS_HTML(TAG("div", STYLE("background", "url(https:evil2.example/bg.png)"), ATTR("title", 宛名), "x")) & "<script>1</script>"`;
  const r = await run(s);
  const by = (rule, level) => r.findings.items.filter((f) => f.rule === rule && f.level === level).map((f) => f.message);
  assert.ok(by("formula.rawHtml", "warning").some((m) => m.includes("TAG") && m.includes("ATTR") && m.includes("STYLE")), r.findings.format());
  assert.ok(by("formula.attr", "warning").some((m) => m.includes("ATTR の値 宛名")), "ATTR の値がレコードの項目は警告");
  assert.ok(by("formula.html", "warning").some((m) => m.includes("<script>")), "定数の HTML の禁止タグは警告");
  const blocked = by("external.blocked", "warning");
  assert.ok(blocked.some((m) => m.includes("evil.example/pixel")), "定数の HTML の外部 URL（除くの設定では除かれる。警告）");
  assert.ok(blocked.some((m) => m.includes("evil2.example/bg.png")), "STYLE の定数の url()");
  assert.ok(!r.findings.items.some((f) => f.level === "error"), `警告だけ: ${r.findings.format()}`);
  assert.ok(r.output, "警告だけなので書き出す");
  // 許可の設定（承認済み）では外部 URL は allowExternal の対象（警告 external.url）
  const allow = await run({ ...s, externalRefs: "allow" }, { policy: { allowExternal: [], allowExternalRefs: ["settings/見積書.json"] } });
  assert.ok(allow.findings.items.some((f) => f.rule === "external.url" && f.message.includes("evil.example/pixel")), allow.findings.format());
  assert.ok(!allow.findings.items.some((f) => f.rule === "external.blocked"));
  // 文字列の中の //（印刷屋の stripComments が切る）はエラー
  const c = aiSettings();
  c.pluginInfos[0].tagsInfo.fieldsInfo[1].formulaSet = '"https://x.example.com/" & 見積番号 // コメントは外でなら書ける';
  const rc = await run(c);
  assert.ok(rules(rc, "error").includes("formula.comment"), rc.findings.format());
  const ok = aiSettings();
  ok.pluginInfos[0].tagsInfo.fieldsInfo[1].formulaSet = '"見積書-" & 見積番号 & ".pdf" // https://… は外ならコメント';
  assert.ok(!rules(await run(ok), "error").includes("formula.comment"));
  const safe = aiSettings();
  const r2 = await run(safe);
  assert.ok(!r2.findings.items.some((f) => f.level === "error"), "既定の形（TABLE_HTML + REPLACE。##table## や <br>）はエラーにならない");
});

test("検査: 計算式が組む HTML は静的に追わない（断片の連結や分岐はエラーにしない。印刷屋が描画の前に除く）。定数でない要素名・属性は formula.attr の警告", async () => {
  const has = (r, rule, level, text) => r.findings.items.some((f) => f.rule === rule && f.level === level && f.message.includes(text));
  const cases = [
    // 断片の連結・分岐・LET は追わない（エラー無し。警告は HTML を作る関数が無ければ出ない）
    [`"<" & "img src=https:" & "/" & "/evil.example/pixel>"`, (r) => !r.findings.items.some((f) => f.level === "error")],
    [`LET(a, "<", b, "img src=x onerror=alert(1)>", a & b)`, (r) => !r.findings.items.some((f) => f.level === "error")],
    [Array.from({ length: 8 }, (_, i) => `IF(見積番号 = "${i}", "<b>${i}</b>", "")`).join(" & "), (r) => !r.findings.items.some((f) => f.level === "error" || f.rule === "formula.inspect")],
    // 定数の HTML / CSS は同じ検査を警告として出す
    [`"<" & "script>alert(1)</script>"`, (r) => !r.findings.items.some((f) => f.level === "error")],
    [`"<script>alert(1)</script>"`, (r) => has(r, "formula.html", "warning", "<script>")],
    [`TAGS_HTML(TAG("div", ATTR("title", "\\" onclick=\\"alert(1)"), "x"))`, (r) => !r.findings.items.some((f) => f.level === "error")],
    [`"<img src=x onerror=alert(1)>"`, (r) => has(r, "formula.html", "warning", "onerror")],
    [`TAGS_HTML(VTAG("img", ATTR("srcset", "data:image/png;base64,AAAA 1x, https:evil.example/pixel 2x")))`, (r) => has(r, "formula.rawHtml", "warning", "VTAG") && !r.findings.items.some((f) => f.level === "error")],
    [`"background:url(https:evil3.example/b.png)"`, (r) => has(r, "external.blocked", "warning", "evil3.example")],
    // 要素名・属性が定数でない
    [`TAGS_HTML(TAG("div", BATTR(備考), "x"))`, (r) => has(r, "formula.attr", "warning", "BATTR の属性名 備考")],
    [`TAGS_HTML(TAG("div", STYLE(備考), "x"))`, (r) => has(r, "formula.attr", "warning", "STYLE の名前 備考")],
    [`TAGS_HTML(TAG("img", ATTR("title", "x", "src", 見積番号)))`, (r) => has(r, "formula.attr", "warning", "ATTR の値 見積番号")],
    [`TAGS_HTML(TAG("div", ATTR("src", "https:" & "/" & "/evil.example/x"), "x"))`, (r) => has(r, "formula.attr", "warning", "ATTR の値")],
    [`TAGS_HTML(TAG(見積番号, "x"))`, (r) => has(r, "formula.attr", "warning", "TAG の要素名 見積番号")],
    [`"<p>" & 宛名 & "</p>"`, (r) => !r.findings.items.some((f) => f.level === "error")]
  ];
  for (const [formula, check] of cases) {
    const s = aiSettings();
    s.pluginInfos[0].tagsInfo.fieldsInfo[2].formulaSet = formula;
    const r = await run(s);
    assert.ok(check(r), `${formula}\n${r.findings.format()}`);
  }
  // 定数だけの書き方は formula.attr / formula.html の警告が出ない
  for (const formula of [
    `"<b>" & ESC_HTML(宛名) & "</b>"`,
    `TAGS_HTML(TAG("p", ATTR("class", "x"), ESC_HTML(宛名)))`,
    `TAGS_HTML(TAG("img", ATTR("src", "data:image/png;base64,AAAA", "width", "10")))`,
    `TAGS_HTML(VTAG("br"))`,
    `TAGS_HTML(TAG("div", STYLE("color", "red", "font-weight", "bold"), "x"))`,
    `LET(t, TABLE_HTML(見積明細, 商品名), REPLACE($html, "##table##", t))`,
    `REPLACE($html, "##x##", IF(見積番号 = "x", "<span class=\\"done\\">済</span>", ""))`,
    `"<td>" & FVAL(合計金額) & " 円</td>"`
  ]) {
    const s = aiSettings();
    s.pluginInfos[0].tagsInfo.fieldsInfo[2].formulaSet = formula;
    const r = await run(s);
    assert.ok(!r.findings.items.some((f) => f.level === "error" || f.rule === "formula.attr" || f.rule === "formula.html"), `${formula}\n${r.findings.format()}`);
  }
});

test("検査: 有効なボタンに HTML 設定が無ければエラー、無効なら情報", async () => {
  const s = aiSettings();
  delete s.pluginInfos[0].tagsInfo;
  const r = await run(s);
  assert.ok(rules(r, "error").includes("tags.rows"), r.findings.format());
  s.pluginInfos[0].state = false;
  const r2 = await run(s);
  assert.ok(!rules(r2, "error").includes("tags.rows"));
});

test("入力はスキーマで検証した値から派生させる: 緩い真偽値は型どおりに、appId は正の整数、4 MB を超える JSON は止まる", async () => {
  const s = aiSettings();
  s.pluginInfos[0].tagsInfo.fieldsInfo[2].state = "false";
  const r = await run(s);
  const st = r.output?.pluginInfos[0].tagsInfo.fieldsInfo[2].state ?? r.body?.pluginInfos[0].tagsInfo.fieldsInfo[2].state;
  assert.equal(typeof st, "boolean", `state は真偽値になる: ${JSON.stringify(st)}`);
  assert.deepEqual(rules(await run(aiSettings({ appId: "3740" })), "error"), ["envelope.appId"]);
  assert.deepEqual(rules(await run(aiSettings({ appId: 0 })), "error"), ["envelope.appId"]);
  assert.deepEqual(rules(await run(aiSettings({ appId: 3741 })), "error"), []);
  assert.ok(rules(await run(aiSettings({ appId: 3741 })), "warning").includes("envelope.appId"));
  const big = await normalizeSettings({ settingsText: JSON.stringify({ ...aiSettings(), pluginComment: "x".repeat(4 * 1024 * 1024 + 10) }), fields: FIELDS_FILE, engine });
  assert.deepEqual(rules(big, "error"), ["json"]);
  assert.match(big.findings.items[0].message, /大きすぎる/);
});

test("検査: HTML 設定の行の欠落、有効なボタン名の重複はエラー。guestsInfo の id は tools が振る", async () => {
  const s = aiSettings();
  s.pluginInfos[0].tagsInfo.fieldsInfo = [s.pluginInfos[0].tagsInfo.fieldsInfo[0]];
  const r = await run(s);
  assert.ok(rules(r, "error").includes("tags.rows"), r.findings.format());
  assert.equal(r.output, undefined);
  const d = aiSettings();
  d.pluginInfos.push(JSON.parse(JSON.stringify(d.pluginInfos[0])));
  const rd = await run(d);
  assert.ok(rules(rd, "error").includes("menu.duplicate"), rd.findings.format());
  d.pluginInfos[1].state = false;
  assert.ok(!rules(await run(d), "error").includes("menu.duplicate"), "無効なボタンの同名は許す");
  const g = await run(aiSettings({ guestsInfo: [{ state: true, email: "a@example.com", name: "a" }, { state: true, email: "b@example.com", name: "b" }] }));
  assert.deepEqual(g.output.guestsInfo.map((x) => x.id), [1, 2]);
});

test("iframe の同一オリジンの判定は .env の接続先（baseUrl）だけを使う。無ければ iframe は使えない。fields の baseUrl は判定に使わず、違えば警告", async () => {
  const s = aiSettings();
  s.pluginInfos[0].tagsInfo.fieldsInfo[2].html = HTML_TEMPLATE.replace("##table##", '<iframe src="https://x.cybozu.com/k/3740/report/portlet?report=1"></iframe>##table##');
  const noEnv = await run(s);
  assert.ok(noEnv.findings.items.some((f) => f.rule === "html.rule" && f.message.includes("iframe の src") && f.message.includes("未設定")), ".env が無ければ fields の baseUrl（x.cybozu.com）と同じでも止まる");
  const attacker = await run(s, { baseUrl: "https://env.cybozu.com" });
  assert.ok(attacker.findings.items.some((f) => f.rule === "html.rule" && f.message.includes("iframe の src")), ".env と違う iframe は fields と同じでも止まる");
  assert.ok(attacker.findings.items.some((f) => f.rule === "fields.baseUrl" && f.level === "warning"), "fields の baseUrl が .env と違う警告");
  const same = await run(s, { baseUrl: "https://x.cybozu.com" });
  assert.ok(!same.findings.items.some((f) => f.rule === "html.rule" && f.message.includes("iframe の src")), ".env の接続先と同じなら通る");
  assert.ok(!same.findings.items.some((f) => f.rule === "fields.baseUrl"));
});

test("検査: CSS の @import と使えない URL、共通 CSS、Web フォントの URL", async () => {
  const s = aiSettings({ cssInfo: [{ state: true, name: "x", desc: "", css: "@import url(https://evil.example.com/a.css); .a{background:url(javascript:alert(1))}" }], fontInfo: { enabled: true, preset: "other", family: "F", cssUrl: "https://fonts.googleapis.com/css2?family=F" } });
  const r = await run(s);
  const css = r.findings.items.filter((f) => f.rule === "css.rule");
  assert.ok(css.some((f) => f.message.includes("@import")));
  assert.ok(css.some((f) => f.message.includes("使えない形")));
  assert.ok(r.findings.items.some((f) => f.rule === "external.allowed" && f.where === "Web フォント"), "Google Fonts は既定で許す");
});
