/**
 * 関数の文書を作る（docs/authoring-plan.md 12.4、12.9 の 7。Takashi「関数に関しては、計算式プラグインの下記を参考に」）。
 *   docs/関数一覧.md … 印刷屋の計算式ライブラリ（lib/KintoneFormulaPCraft.js）が持つ関数の説明表 p.desc（設定画面の関数入力支援の文言。
 *                      日本語、引数の形と説明と例）から、lib にある関数だけを分類ごとに並べたもの。分類は functions.json（Qiita 記事の「関数」章の見出し）。
 *                      AI が常に読む。印刷屋固有の関数の詳しい説明は 帳票関数リファレンス.md（手書き）
 *   docs/関数の使い方（計算式プラグインの記事）.md … formula/doc/qiita_計算式プラグイン.md の「関数」章から、lib に無い関数の項目を外した写し（例が多い）
 *   docs/関数リファレンス（詳細）.md … formula/doc_gpts/関数リファレンス.md をそのまま（先頭に注記）。要る関数の節だけ grep で読む
 *   docs/フィールドタイプ別仕様.md  … formula/doc_gpts/フィールドタイプ別仕様.md をそのまま
 * 実行: tools/ で `npm run gen-docs`（Node 22.6 以上）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(here, "..");
const repo = path.resolve(tools, "..");
const { PRINT_CRAFT_ROOT } = await import(pathToFileURL(path.join(tools, "src", "paths.ts")).href);
const FORMULA_DOC = path.resolve(PRINT_CRAFT_ROOT, "..", "formula");
const docs = path.join(repo, "docs");
mkdirSync(docs, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const functions = JSON.parse(readFileSync(path.join(tools, "functions.json"), "utf8"));
const libNames = Object.keys(functions.functions);
const libSet = new Set(libNames);

// ---- lib の説明表 p.desc を取り出す（文字列と配列だけのオブジェクトリテラル。vm の別コンテキストで評価） --------------------------
const lib = readFileSync(path.join(PRINT_CRAFT_ROOT, "lib", "KintoneFormulaPCraft.js"), "utf8").split(/\r?\n/);
function extractObject(startPattern) {
  const start = lib.findIndex((l) => startPattern.test(l));
  if (start < 0) throw new Error(`not found: ${startPattern}`);
  const indent = lib[start].match(/^\s*/)[0];
  const end = lib.findIndex((l, i) => i > start && l.startsWith(indent + "}"));
  const body = lib.slice(start + 1, end).join("\n");
  return vm.runInNewContext(`({${body}})`, {}, { timeout: 2000 });
}
const desc = extractObject(/^\s*p\.desc = \{\s*$/);
const descNames = new Set(Object.keys(desc));
console.log(`lib の説明表 p.desc: ${descNames.size} 件。lib の関数 ${libNames.length} のうち説明が無い: ${libNames.filter((n) => !descNames.has(n)).join(" ") || "なし"}`);

// ---- 分類（functions.json の category = Qiita の見出し。順序は Qiita の章の並び） ---------------------------------------------
const qiita = readFileSync(path.join(FORMULA_DOC, "doc", "qiita_計算式プラグイン.md"), "utf8").split(/\r?\n/);
const start = qiita.findIndex((l) => /^# 関数/.test(l));
const end = qiita.findIndex((l, i) => i > start && /^# /.test(l));
const chapter = qiita.slice(start + 1, end);
const categoryOrder = [];
for (const line of chapter) {
  const h = line.match(/^## (.+)$/);
  if (h && !categoryOrder.includes(h[1].trim())) categoryOrder.push(h[1].trim());
}
const byCategory = new Map();
for (const name of libNames) {
  const cat = functions.functions[name].category || "未分類";
  if (!byCategory.has(cat)) byCategory.set(cat, []);
  byCategory.get(cat).push(name);
}
// 記事で最初の ## 見出しより前にある項目の分類（gen-functions.mjs の BASIC_CATEGORY）を先頭に
const BASIC_CATEGORY = "基本関数（数値・集計・配列・条件）";
const orderedCategories = [...(byCategory.has(BASIC_CATEGORY) ? [BASIC_CATEGORY] : []), ...categoryOrder.filter((c) => byCategory.has(c)), ...[...byCategory.keys()].filter((c) => c !== BASIC_CATEGORY && !categoryOrder.includes(c))];

// ---- 関数一覧.md -----------------------------------------------------------------------------------------------------
// 説明表は dialog に innerHTML で出す前提で 1 段エスケープされている。1 段だけ戻す（&amp;lt; → &lt; のまま、&lt; → <）
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"' };
const esc = (s) => s.replace(/&(amp|lt|gt|quot);/g, (_m, e) => ENTITIES[e]).trim();
const out = [];
out.push("# 印刷屋プラグインで使える計算式の関数一覧");
out.push("");
out.push(`印刷屋プラグイン Ver.6 の計算式ライブラリ（KintoneFormulaPCraft）が持つ **${libNames.length} 関数**の一覧。説明はライブラリ自身の説明表（設定画面の関数入力支援の文言）から、分類は計算式プラグインの Qiita 記事「関数」章の見出しに合わせて、\`tools/scripts/gen-function-list.mjs\` が ${today} に生成した（手で直さない。ライブラリの SHA-256 ${functions.engineSha256.slice(0, 12)}）。`);
out.push("");
out.push("- 書式は `NAME(引数の形)` と説明と例。引数の形の `[...]` は省略可");
out.push("- **★ 印刷屋固有**（HTML 関連）の関数は、エスケープの扱いと使い方を `帳票関数リファレンス.md` で確かめる");
out.push("- **✕ 帳票では使わない**（ボタン・dialog・クリップボード・イベントの関数。authoring の tools は評価しない）");
out.push("- 例が多い説明は `関数の使い方（計算式プラグインの記事）.md`、1 関数ずつの詳しい説明は `関数リファレンス（詳細）.md`（印刷屋固有と TP* / R_* / M_* は無い）を検索して読む");
out.push("- **計算式プラグインにあって印刷屋に無い関数**（使えない）: {{REMOVED}}");
out.push("");
for (const cat of orderedCategories) {
  out.push(`## ${cat}`);
  out.push("");
  for (const name of byCategory.get(cat).sort()) {
    const f = functions.functions[name];
    const d = desc[name];
    const mark = f.kind === "print-craft" ? "★ " : f.node === "unsupported" ? "✕ " : "";
    if (!d) {
      out.push(`- ${mark}**${name}**: （説明表に無い）`);
      continue;
    }
    const lines = esc(String(d.ja)).split("\n").map((l) => l.replace(/^\s+/, ""));
    const sig = lines[0] ?? "";
    // 「ex:」より前が説明、後が例（ex: は行頭にも行の途中にも出る）
    const body = lines.slice(1).join("\n");
    const [descText, ...exParts] = body.split(/\n?\s*\bex:\s*\n?/i);
    const descLines = descText.split("\n").map((l) => l.trim()).filter(Boolean);
    const exLines = exParts.join("\n").split("\n").map((l) => l.trim()).filter(Boolean);
    out.push(`- ${mark}**${name}**(${sig}): ${descLines.join(" ")}`);
    for (const e of exLines) out.push(`    - 例 \`${e.replace(/`/g, "'")}\``);
  }
  out.push("");
}
// 計算式プラグインの記事にあって lib に無い関数
const qiitaNames = [];
for (const line of chapter) {
  const m = line.match(/^-\s*・?\s*\[?([A-Z][A-Z0-9_]+)\]?\s*[:：]/);
  if (m && !qiitaNames.includes(m[1])) qiitaNames.push(m[1]);
}
const removed = qiitaNames.filter((n) => !libSet.has(n));
writeFileSync(path.join(docs, "関数一覧.md"), out.join("\n").replace("{{REMOVED}}", removed.length ? removed.map((n) => `\`${n}\``).join(" ") : "なし") + "\n", "utf8");
console.log(`docs/関数一覧.md: ${libNames.length} 関数、分類 ${orderedCategories.length}。計算式プラグインにあって lib に無い: ${removed.join(" ") || "なし"}`);

// ---- 関数の使い方（計算式プラグインの記事）.md（lib に無い項目を外した写し） ------------------------------------------------
const copy = [];
copy.push("# 計算式の関数の使い方（計算式プラグインの記事の「関数」章の写し）");
copy.push("");
copy.push(`\`formula/doc/qiita_計算式プラグイン.md\` の「関数」章を、印刷屋プラグインのライブラリに無い関数の項目（${removed.map((n) => `\`${n}\``).join(" ") || "なし"}）を外して ${today} に \`tools/scripts/gen-function-list.mjs\` が写したもの（手で直さない）。例が多いので、\`関数一覧.md\` で名前を見つけてからここを検索する。HTML 関連の関数は \`帳票関数リファレンス.md\` を正とする。`);
copy.push("");
let skipping = false;
for (const line of chapter) {
  const item = line.match(/^-\s*・?\s*\[?([A-Z][A-Z0-9_]+)\]?\s*[:：]/);
  const heading = /^#{2,3} /.test(line);
  if (heading) skipping = false;
  if (item) skipping = !libSet.has(item[1]);
  if (skipping) continue;
  copy.push(heading ? line.replace(/^(#{2,3}) /, "## ") : line);
}
writeFileSync(path.join(docs, "関数の使い方（計算式プラグインの記事）.md"), copy.join("\n") + "\n", "utf8");
console.log(`docs/関数の使い方（計算式プラグインの記事）.md: ${copy.length} 行`);

// ---- 詳細リファレンスとフィールドタイプ別仕様（そのまま + 注記） ---------------------------------------------------------
const copies = [
  ["doc_gpts/関数リファレンス.md", "関数リファレンス（詳細）.md", "計算式プラグインの関数リファレンス（詳細）をそのまま置いたもの。印刷屋固有の関数（HTML 関連、TABLE_HTML など）と TP*・R_*・M_* の関数はこの文書には無い（`関数一覧.md` と `帳票関数リファレンス.md` を見る）。この文書に載っていて印刷屋に無い関数は `関数一覧.md` の先頭に書いてある。大きいので、要る関数の節（### 関数名）だけ検索して読む。"],
  ["doc_gpts/フィールドタイプ別仕様.md", "フィールドタイプ別仕様.md", "計算式プラグインの文書をそのまま置いたもの。項目の型ごとに計算式で取れる値の形。"]
];
for (const [src, dst, note] of copies) {
  const file = path.join(FORMULA_DOC, src);
  if (!existsSync(file)) {
    console.warn(`無い: ${file}`);
    continue;
  }
  const body = readFileSync(file, "utf8");
  writeFileSync(path.join(docs, dst), `<!-- ${today} に tools/scripts/gen-function-list.mjs が ${src} から複写。手で直さない -->\n> ${note}\n\n${body}`, "utf8");
  console.log(`docs/${dst}: ${Buffer.byteLength(body).toLocaleString()} bytes`);
}

// ---- 印刷屋固有（HTML 関連）の説明を表示（帳票関数リファレンス.md を書くときの参考） ------------------------------------------
if (process.argv.includes("--show-html")) {
  for (const name of libNames.filter((n) => functions.functions[n].kind === "print-craft")) {
    console.log(`\n### ${name}\n${esc(String(desc[name]?.ja ?? "（無し）"))}`);
  }
}
