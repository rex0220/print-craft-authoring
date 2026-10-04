/**
 * functions.json（関数の分類の正本。docs/authoring-plan.md 12.4、12.7）を lib の関数表と計算式プラグインの文書から作る・更新する。
 *   - 名前: lib（KintoneFormulaPCraft.min.js）の関数表 Object.keys(kf.funs)
 *   - category: formula/doc/qiita_計算式プラグイン.md の「関数」章の ## 見出し（日付関数、文字列関数、HTML 関連 …）
 *   - kind: print-craft（印刷屋固有 = HTML 関連）/ general
 *   - node: node（Node で決定的に評価できる）/ dom（happy-dom のスタブで評価できる）/ kintone-meta（kintone のメタデータのスタブが要る）/ unsupported（authoring では使えない）
 *   - doc: qiita / html / none（どの文書に項目があるか）
 * 既にある functions.json の値は残し、新しい関数だけ既定の分類で足す（lib から消えた関数は removed に書く）。
 * 分類の見直しは 1-6 で手で行う（このスクリプトは既定を与えるだけ）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const { loadEngine } = await import(pathToFileURL(path.join(root, "src", "engine.ts")).href);
const { PRINT_CRAFT_ROOT } = await import(pathToFileURL(path.join(root, "src", "paths.ts")).href);

const FORMULA_DOC = path.resolve(PRINT_CRAFT_ROOT, "..", "formula");
const qiita = readFileSync(path.join(FORMULA_DOC, "doc", "qiita_計算式プラグイン.md"), "utf8").split("\n");
const htmlDoc = readFileSync(path.join(FORMULA_DOC, "doc", "HTML 関連関数.md"), "utf8");

// 「関数」章の ## 見出しごとに「- NAME:」を拾う
const start = qiita.findIndex((l) => /^# 関数/.test(l));
const end = qiita.findIndex((l, i) => i > start && /^# /.test(l));
const categoryOf = new Map();
let category = "";
for (const line of qiita.slice(start, end)) {
  const h = line.match(/^## (.+)$/);
  if (h) {
    category = h[1].trim();
    continue;
  }
  const m = line.match(/^-\s*・?\s*\[?([A-Z][A-Z0-9_]+)\]?\s*[:：]/);
  if (m && !categoryOf.has(m[1])) categoryOf.set(m[1], category);
}
const htmlNames = new Set([...htmlDoc.matchAll(/^[-_]\s*([A-Z][A-Z0-9_]+)\s*[:：,]/gm)].map((m) => m[1]));
const PRINT_CRAFT_EXTRA = new Set(["HTML", "OPT", "PAGE_HTML", "TAGS_HTML", "TABLE_HTML", "RECS_HTML", "RECS_MAP", "RECS_SUM", "FIELDS_HTML", "IMGSRC", "FVAL", "FILE", "FSIZE", "TAG", "VTAG", "ATTR", "BATTR", "STYLE", "URL", "ESC_HTML", "UNESC_HTML", "ADD_TAGS", "STRIP_TAGS", "HTML_TAGS"]);
const UNSUPPORTED = new Set(["CLIPBORD_WRITE", "BUTTON", "BOPT", "DIALOG", "EV_SET"]);
const KINTONE_META = new Set(["APP_URL", "LOOKUP_GETID", "RELATED_GETID"]);
const UNSUPPORTED_CATEGORIES = new Set(["ボタン関連", "イベント情報"]);

const engine = await loadEngine();
const names = engine.functionNames();
const file = path.join(root, "functions.json");
const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { functions: {} };
const out = { note: "関数の分類の正本（docs/authoring-plan.md 12.4、12.7）。scripts/gen-functions.mjs が lib と文書から既定を作り、見直しは手で行う", engineSha256: engine.engineSha256, functions: {}, removed: [] };
for (const name of names) {
  const prev = existing.functions?.[name];
  const cat = categoryOf.get(name) ?? (htmlNames.has(name) || PRINT_CRAFT_EXTRA.has(name) ? "HTML 関連" : "未分類");
  const kind = cat === "HTML 関連" || htmlNames.has(name) || PRINT_CRAFT_EXTRA.has(name) ? "print-craft" : "general";
  const node = UNSUPPORTED.has(name) || UNSUPPORTED_CATEGORIES.has(cat) ? "unsupported" : KINTONE_META.has(name) ? "kintone-meta" : kind === "print-craft" ? "dom" : "node";
  const doc = categoryOf.has(name) ? "qiita" : htmlNames.has(name) ? "html" : "none";
  out.functions[name] = prev ? { ...{ category: cat, kind, node, doc }, ...prev, doc } : { category: cat, kind, node, doc };
}
for (const name of Object.keys(existing.functions ?? {})) if (!names.includes(name)) out.removed.push(name);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
const count = (k, v) => Object.values(out.functions).filter((f) => f[k] === v).length;
console.log(`functions.json: ${names.length} 関数（print-craft ${count("kind", "print-craft")} / general ${count("kind", "general")}。node ${count("node", "node")} / dom ${count("node", "dom")} / kintone-meta ${count("node", "kintone-meta")} / unsupported ${count("node", "unsupported")}。文書に無い: ${count("doc", "none")}${out.removed.length ? `。lib から消えた: ${out.removed.join(" ")}` : ""}）`);
