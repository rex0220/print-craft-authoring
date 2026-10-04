/**
 * CSS の検査（docs/authoring-plan.md 12.3、Codex BLOCKER 1）。
 * コメントと文字列を区別して走査する簡易スキャナー（正規表現だけで見ない）。CSS が外部に接続する手段は url() / @import / image-set() の文字列なので、
 * それらを全部拾って URL を分類する。禁止: @import、expression(、behavior:、-moz-binding。
 * 印刷屋の置き換えタグ #{&f(…)} は添付ファイルの画像（data URL に置き換わる）なので許す。
 */

export interface CssUrl {
  url: string;
  /** url() / @import / image-set */
  via: string;
}

export interface CssCheckResult {
  errors: string[];
  /** https の外部 URL（承認の対象） */
  externals: CssUrl[];
}

export type UrlKind = "placeholder" | "data-image" | "https" | "relative" | "fragment" | "bad";

/** URL の分類（HTML の属性と共通） */
export function classifyUrl(raw: string): UrlKind {
  const v = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  if (v === "") return "relative";
  if (/^#\{&[fqpn]/.test(v)) return "placeholder";
  if (v.startsWith("#")) return "fragment";
  const scheme = v.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (!scheme) return v.startsWith("//") ? "bad" : "relative";
  if (scheme === "https") return "https";
  if (scheme === "data") return /^data:image\//i.test(v) ? "data-image" : "bad";
  return "bad";
}

/** コメントを除く（文字列の中の /* は壊さない） */
export function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < css.length) {
    const c = css[i];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** url(...) の中身を取り出す（引用符あり / なし。#{&f(...)} を含むときは )} まで） */
export function extractUrls(css: string): CssUrl[] {
  const out: CssUrl[] = [];
  const text = stripCssComments(css);
  const re = /\burl\(\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    const q = text[i];
    let value = "";
    if (q === '"' || q === "'") {
      const end = text.indexOf(q, i + 1);
      value = text.slice(i + 1, end < 0 ? text.length : end);
    } else if (text.startsWith("#{&", i)) {
      const end = text.indexOf(")}", i);
      value = text.slice(i, end < 0 ? text.length : end + 2);
    } else {
      const end = text.indexOf(")", i);
      value = text.slice(i, end < 0 ? text.length : end);
    }
    out.push({ url: value.trim(), via: "url()" });
  }
  // image-set("a.png" 1x, …) の文字列
  const imageSet = /image-set\(([^)]*)\)/gi;
  while ((m = imageSet.exec(text))) {
    for (const s of m[1].matchAll(/["']([^"']+)["']/g)) out.push({ url: s[1].trim(), via: "image-set" });
  }
  // @import "x" / @import url(x)（url() は上で拾っているので文字列だけ）
  const imp = /@import\s+(?:url\([^)]*\)|["']([^"']+)["'])/gi;
  while ((m = imp.exec(text))) if (m[1]) out.push({ url: m[1].trim(), via: "@import" });
  return out;
}

export function checkCss(css: string): CssCheckResult {
  const errors: string[] = [];
  const externals: CssUrl[] = [];
  const text = stripCssComments(css);
  if (/@import\b/i.test(text)) errors.push("@import は使えない（外部の CSS を読む）");
  if (/\bexpression\s*\(/i.test(text)) errors.push("expression( は使えない");
  if (/\bbehavior\s*:/i.test(text)) errors.push("behavior: は使えない");
  if (/-moz-binding\s*:/i.test(text)) errors.push("-moz-binding: は使えない");
  for (const u of extractUrls(css)) {
    const kind = classifyUrl(u.url);
    if (kind === "https") externals.push(u);
    else if (kind === "bad") errors.push(`${u.via} の URL が使えない形: ${u.url.slice(0, 80)}（https:、data:image/、#{&f(…)} だけ）`);
  }
  return { errors, externals };
}
