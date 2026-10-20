/**
 * 資料の例の検証（print-craft の docs/authoring-try-plan.md T5。formula-authoring の tools/scripts/verify-patterns.mjs と同じ考え）: docs/計算パターン_検証.md を作る。
 * 計算パターンのケース（scripts/pattern-cases.mjs）を、お試しアプリ formula-sample に項目を足した架空の値のレコードで、try と同じ評価（evaluateTryFormulas。
 * ユーザー情報は既定のテストデータ）に評価させ、期待と突き合わせる。タイムゾーンは Asia/Tokyo に固定する。
 * 実行: tools/ で `npm run gen-patterns`（Node 22.6 以上。印刷屋 Ver.9 の zip が要る: PCRAFT_PLUGIN_ZIP か print-craft の dist/print-craft-plugin9.zip）。
 * test/patterns.test.mjs が「生成物が最新」と「ケースが全部一致」を確かめる（エンジンの版が変わったときの回帰検査）
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PATTERN_CASES } from "./pattern-cases.mjs";

process.env.TZ = "Asia/Tokyo";
const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(here, "..");
const src = (p) => import(pathToFileURL(path.join(tools, "src", p)).href);

const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "\\n");
const code = (s) => `\`${esc(s).replace(/`/g, "'")}\``;
const json = (v) => JSON.stringify(v);

/** 検証に使う印刷屋の zip（Ver.9 から。M_* / R_* と decimal.js） */
export async function defaultZip() {
  const { PRINT_CRAFT_ROOT } = await src("dev-paths.ts");
  return process.env.PCRAFT_PLUGIN_ZIP ?? path.join(PRINT_CRAFT_ROOT, "dist", "print-craft-plugin9.zip");
}

/** エンジンの console の出力（moment の警告など）を捨てる（try の子プロセスも親に流さない） */
function quiet(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

/** 架空の値を kintone のレコードの値の形に（型は項目定義から） */
function kintoneValue(p, v, users) {
  const empty = v === "" || v == null;
  switch (p.type) {
    case "CHECK_BOX":
    case "MULTI_SELECT":
      return empty ? [] : Array.isArray(v) ? v.map(String) : [String(v)];
    case "USER_SELECT":
    case "STATUS_ASSIGNEE":
    case "ORGANIZATION_SELECT":
    case "GROUP_SELECT": {
      const list = p.type === "ORGANIZATION_SELECT" ? users.organizations : p.type === "GROUP_SELECT" ? users.groups : users.users;
      return (empty ? [] : Array.isArray(v) ? v : [v]).map((c) => {
        const x = list.find((y) => y.code === c);
        if (!x) throw new Error(`既定のテストデータに無いコード: ${c}`);
        return { code: x.code, name: x.name };
      });
    }
    case "DATE":
    case "TIME":
    case "DATETIME":
      return empty ? null : String(v);
    default:
      return empty ? "" : String(v);
  }
}

/** ケースの項目定義（formula-sample に fields を足したもの）とレコード（土台はレコード 3 = 空。data で上書き） */
function caseApp(c, deps) {
  const { tryApp, fixedRecord, valueOf } = deps;
  const app = tryApp("formula-sample");
  const fields = structuredClone(app.fields);
  for (const f of c.fields ?? []) {
    if (fields.properties[f.code]) throw new Error(`足す項目が formula-sample の項目と重なる: ${f.code}`);
    fields.properties[f.code] = { type: f.type, code: f.code, label: f.code };
  }
  const records = (c.data ?? [{}]).map((d, n) => {
    const rec = fixedRecord(app, 3);
    for (const f of c.fields ?? []) rec[f.code] = valueOf(fields.properties[f.code], 1, "empty");
    for (const [k, v] of Object.entries(d)) {
      const p = fields.properties[k];
      if (!p) throw new Error(`${c.pattern}: 項目が無い: ${k}`);
      if (p.type === "SUBTABLE") {
        rec[k] = {
          type: "SUBTABLE",
          value: v.map((row, i) => {
            const value = {};
            for (const child of Object.values(p.fields)) value[child.code] = valueOf(child, i + 1, "empty");
            for (const [ck, cv] of Object.entries(row)) {
              const cp = p.fields[ck];
              if (!cp) throw new Error(`${c.pattern}: ${k} の子が無い: ${ck}`);
              value[ck] = { type: cp.type, value: kintoneValue(cp, cv, deps.users) };
            }
            return { id: String(900_000 + i + 1), value };
          })
        };
      } else rec[k] = { type: p.type, value: kintoneValue(p, v, deps.users) };
    }
    return { label: `d${n + 1}`, record: rec };
  });
  return { fields, records };
}

/** すべてのケースを評価する。結果は ケースごとの { case, records, rows: [{ formula, got, expect, match, errors, note }] } */
export async function runPatternCases(pluginZip) {
  const { loadEngine, DEFAULT_CONTEXT_BASE_URL } = await src("engine.ts");
  const { setDefaultUsers } = await src("worker/eval-run.ts");
  const { evaluateTryFormulas } = await src("commands/try.ts");
  const { buildModel } = await src("normalize/model.ts");
  const { tryApp, fixedRecord } = await src("try-apps/index.ts");
  const { valueOf } = await src("try-apps/generate.ts");
  const { DEFAULT_USERS } = await src("try-apps/users/index.ts");
  const engine = await loadEngine({ pluginZip });
  setDefaultUsers(engine);
  const deps = { tryApp, fixedRecord, valueOf, users: DEFAULT_USERS };
  const out = [];
  for (const c of PATTERN_CASES) {
    const { fields, records } = caseApp(c, deps);
    const model = buildModel(fields, engine.api);
    engine.setContext({ baseUrl: DEFAULT_CONTEXT_BASE_URL, appId: fields.appId });
    const results = quiet(() => evaluateTryFormulas(engine, model.ppRun, records, c.formulas.map(({ formula }) => ({ formula }))));
    const rows = c.formulas.map((f, i) => {
      const values = results[i].values;
      const got = values.map((v) => (v.evaluationError !== undefined ? `（エラー）${v.evaluationError}` : v.text ?? null));
      const errors = values.map((v) => v.evaluationError).filter(Boolean);
      return { formula: f.formula, got, expect: f.expect, match: errors.length === 0 && json(got) === json(f.expect), errors, note: f.note };
    });
    out.push({ case: c, records, rows });
  }
  return { engine: { pluginVersion: engine.source.pluginVersion, engineSha256: engine.source.engineSha256 }, cases: out };
}

/** 検証の文書（docs/計算パターン_検証.md） */
export function renderDoc(r) {
  const total = r.cases.reduce((n, c) => n + c.rows.length, 0);
  const ok = r.cases.reduce((n, c) => n + c.rows.filter((x) => x.match).length, 0);
  const lines = [
    "# 計算パターンの検証（お試しアプリと架空の値で評価した結果）",
    "",
    `印刷屋 Ver.${r.engine.pluginVersion} の計算式エンジンで、[計算パターン.md](計算パターン.md) の式の例（\`tools/scripts/pattern-cases.mjs\`）を、` +
      "お試しアプリ `formula-sample`（計算式サンプル）に項目を足した架空の値のレコードで、`pcraft_try` / CLI の `try` と同じ評価（ユーザー情報は既定のテストデータ）に通し、期待と突き合わせたもの。" +
      "`tools/scripts/verify-patterns.mjs`（`npm run gen-patterns`）が作る。手で直さない。",
    `ケース ${r.cases.length}、式 ${total}、一致 ${ok}、不一致 ${total - ok}。結果は帳票の \`\${…}\` に差し込まれる文字（エンジンの値を文字にしたもの。空は ""）。タイムゾーンは Asia/Tokyo。`,
    ""
  ];
  let section = "";
  for (const c of r.cases) {
    if (c.case.section !== section) {
      section = c.case.section;
      lines.push(`## ${section}`, "");
    }
    lines.push(`### ${c.case.pattern}`, "");
    if (c.case.fields?.length) lines.push(`- 足した項目: ${c.case.fields.map((f) => `\`${f.code}\`（${f.type}）`).join("、")}`);
    lines.push(`- 架空の値: ${(c.case.data ?? [{}]).map((d, i) => `d${i + 1} = ${code(json(d))}`).join("、")}`, "");
    lines.push("| 式 | 結果（レコードごと） | 期待 | 一致 | 注 |", "| --- | --- | --- | --- | --- |");
    for (const x of c.rows) lines.push(`| ${code(x.formula)} | ${code(json(x.got))} | ${code(json(x.expect))} | ${x.match ? "✔" : "✖"} | ${esc(x.note ?? "")} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export const DOC_FILE = path.resolve(tools, "..", "docs", "計算パターン_検証.md");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const zip = await defaultZip();
  if (!existsSync(zip)) {
    console.error(`印刷屋 Ver.9 の zip が無い: ${zip}（PCRAFT_PLUGIN_ZIP で指定できる）`);
    process.exit(1);
  }
  const r = await runPatternCases(zip);
  writeFileSync(DOC_FILE, `${renderDoc(r)}\n`, "utf8");
  const bad = r.cases.flatMap((c) => c.rows.filter((x) => !x.match).map((x) => `${c.case.pattern}: ${x.formula}\n  結果 ${json(x.got)}\n  期待 ${json(x.expect)}`));
  console.log(`docs/計算パターン_検証.md: ケース ${r.cases.length}、式 ${r.cases.reduce((n, c) => n + c.rows.length, 0)}、不一致 ${bad.length}`);
  for (const b of bad) console.log(b);
  process.exit(bad.length ? 1 : 0);
}
