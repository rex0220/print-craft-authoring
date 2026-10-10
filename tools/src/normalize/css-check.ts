/**
 * CSS の検査（docs/authoring-plan.md 12.3、Codex BLOCKER 1。1-10 レビュー BLOCKER 3 と再レビュー BLOCKER 2 / MINOR 1 で Chrome の解釈に合わせた）。
 * 簡易トークナイザー（tokenizeCss）で、
 *   1. コメントを外す（文字列の中の /* は壊さない。エスケープで /* を作っても注釈にはならない）
 *   2. 文字列を番号の印（\u0001N\u0001）に置き換えて別に持つ（文字列の中の url( や @import を禁止構文と誤認しない。再レビュー MINOR 1）
 *   3. CSS のエスケープを復号する（\75rl → url、@\69mport → @import。16 進の後ろの空白は改行・CR・FF・CRLF も 1 つ消費する = 仕様どおり。再レビュー BLOCKER 2）
 * その上で、外部に接続する手段をすべて拾って URL を分類する: url()、image-set() / -webkit-image-set() / image() / src() の文字列、@import の文字列。
 * 禁止: @import、expression(、behavior:、-moz-binding:（文字列の外だけ見る）。
 * URL の分類は Chrome の URL パーサーに合わせる: タブ・改行を捨て、両端の制御文字と空白を外し、\ は / と同じ（\\evil はスキーム相対）。
 * 印刷屋の置き換えタグ #{&f(…)} は添付ファイルの画像（data URL に置き換わる）なので許す。
 */

export interface CssUrl {
  url: string;
  /** url() / @import / image-set / image / src */
  via: string;
}

export interface CssCheckResult {
  errors: string[];
  /** https の外部 URL（承認の対象） */
  externals: CssUrl[];
}

export type UrlKind = "placeholder" | "data-image" | "data-svg" | "https" | "relative" | "fragment" | "bad";

/** 置き換えタグの形（#{&p} #{&n} #{&f(fileKey)} #{&q(文字列)}） */
export const PLACEHOLDER_RE = /^#\{&(?:p|n|f\([^{}]*\)|q\([^{}]*\))\}$/s;

const STR_MARK = "\u0001";
const STR_TOKEN = /\u0001(\d+)\u0001/g;

/**
 * URL を Chrome の URL パーサーと同じ前処理で整える: 両端の引用符、両端の C0 制御文字と空白を外し、途中のタブ・改行・復帰を捨てる。
 * 分類（classifyUrl）と承認の照合（policy）の両方でこれを使う。
 */
export function cleanUrl(raw: string): string {
  let v = String(raw ?? "").replace(/[\t\n\r]/g, "");
  v = v.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
}

/** URL の分類（HTML の属性と共通） */
export function classifyUrl(raw: string): UrlKind {
  const v = cleanUrl(raw);
  if (v === "") return "relative";
  if (v.startsWith("#{&")) return PLACEHOLDER_RE.test(v) ? "placeholder" : "bad";
  if (v.startsWith("#")) return "fragment";
  if (/[\u0000-\u001f\u007f]/.test(v)) return "bad";
  const scheme = v.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (!scheme) return v.replace(/\\/g, "/").startsWith("//") ? "bad" : "relative";
  if (scheme === "https") return "https";
  if (scheme === "data") {
    if (/^data:image\/svg\+xml[;,]/i.test(v)) return "data-svg";
    return /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) ? "data-image" : "bad";
  }
  return "bad";
}

/**
 * srcset の候補から URL だけを取り出す（HTML の仕様の手順を簡略化: 空白と , を読み飛ばし、URL は空白まで、
 * URL の末尾の , は区切り。記述子は次の , まで（括弧の中の , は除く）。data: URL の中の , で壊れない）
 */
export function parseSrcsetUrls(value: string): string[] {
  const urls: string[] = [];
  const n = value.length;
  let i = 0;
  while (i < n) {
    while (i < n && /[\s,]/.test(value[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !/\s/.test(value[i])) i++;
    let url = value.slice(start, i);
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      if (url) urls.push(url);
      continue;
    }
    if (url) urls.push(url);
    let depth = 0;
    while (i < n) {
      const c = value[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth <= 0) {
        i++;
        break;
      }
      i++;
    }
  }
  return urls;
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

export interface CssTokens {
  /** コメント無し・文字列は \u0001N\u0001 の印・エスケープは復号済み */
  code: string;
  /** 印の番号 → 文字列の中身（復号済み） */
  strings: string[];
}

/** CSS の簡易トークナイザー（コメント、文字列、エスケープ） */
export function tokenizeCss(css: string): CssTokens {
  const strings: string[] = [];
  let code = "";
  let i = 0;
  const n = css.length;
  const readEscape = (): string => {
    // css[i] === "\\"
    const hex = css.slice(i + 1, i + 7).match(/^[0-9a-fA-F]{1,6}/);
    if (hex) {
      i += 1 + hex[0].length;
      if (css.startsWith("\r\n", i)) i += 2;
      else if (i < n && /[ \t\r\n\f]/.test(css[i])) i++;
      const cp = parseInt(hex[0], 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
    }
    const c = css[i + 1];
    if (c === undefined) {
      i += 1;
      return "�";
    }
    if (c === "\r" && css[i + 2] === "\n") {
      i += 3;
      return "";
    }
    if (c === "\n" || c === "\r" || c === "\f") {
      i += 2;
      return "";
    }
    i += 2;
    return c;
  };
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      code += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      let s = "";
      while (i < n) {
        const d = css[i];
        if (d === "\\") {
          s += readEscape();
          continue;
        }
        if (d === q) {
          i++;
          break;
        }
        if (d === "\n" || d === "\r" || d === "\f") break; // 未終端の文字列は改行で終わる（bad-string）
        s += d;
        i++;
      }
      strings.push(s);
      code += `${STR_MARK}${strings.length - 1}${STR_MARK}`;
      continue;
    }
    if (c === "\\") {
      code += readEscape();
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings };
}

/** CSS のエスケープを復号する（文字列の外の走査用。tokenizeCss と同じ規則） */
export function decodeCssEscapes(text: string): string {
  return tokenizeCss(text.replace(/\/\*[\s\S]*?\*\//g, " ")).code.replace(STR_TOKEN, '""');
}

/** 検査用の本文（デバッグ用。コメント無し・復号済み。文字列は "" に） */
export function prepareCss(css: string): string {
  return tokenizeCss(css).code.replace(STR_TOKEN, '""');
}

/** url(...) と URL を持てる関数・@import の中身を取り出す（引用符あり / なし。#{&f(...)} を含むときは )} まで） */
export function extractUrls(css: string): CssUrl[] {
  const out: CssUrl[] = [];
  const t = tokenizeCss(css);
  const code = t.code;
  const str = (token: string): string => t.strings[Number(token.slice(1, -1))] ?? "";
  const re = /\burl\(\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const i = m.index + m[0].length;
    const ph = code.slice(i).match(/^\u0001\d+\u0001/);
    let value = "";
    if (ph) value = str(ph[0]);
    else if (code.startsWith("#{&", i)) {
      const end = code.indexOf(")}", i);
      value = code.slice(i, end < 0 ? code.length : end + 2);
    } else {
      const end = code.indexOf(")", i);
      value = code.slice(i, end < 0 ? code.length : end);
    }
    out.push({ url: value.trim(), via: "url()" });
  }
  // image-set("a.png" 1x, …) / -webkit-image-set(…) / image("x") / src("x") の文字列
  const fns = /\b(?:-webkit-)?(image-set|image|src)\(((?:[^()]|\([^()]*\))*)\)/gi;
  while ((m = fns.exec(code))) {
    for (const s of m[2].matchAll(STR_TOKEN)) out.push({ url: str(s[0]).trim(), via: m[1].toLowerCase() });
  }
  // @import "x" / @import url(x)（url() は上で拾っているので文字列だけ）
  const imp = /@import\s+(?:url\([^)]*\)|(\u0001\d+\u0001))/gi;
  while ((m = imp.exec(code))) if (m[1] !== undefined) out.push({ url: str(m[1]).trim(), via: "@import" });
  return out;
}

export function checkCss(css: string): CssCheckResult {
  const errors: string[] = [];
  const externals: CssUrl[] = [];
  const { code } = tokenizeCss(css);
  if (/@import\b/i.test(code)) errors.push("@import は使えない（外部の CSS を読む）");
  if (/\bexpression\s*\(/i.test(code)) errors.push("expression( は使えない");
  if (/\bbehavior\s*:/i.test(code)) errors.push("behavior: は使えない");
  if (/-moz-binding\s*:/i.test(code)) errors.push("-moz-binding: は使えない");
  for (const u of extractUrls(css)) {
    const kind = classifyUrl(u.url);
    if (kind === "https") externals.push({ url: cleanUrl(u.url), via: u.via });
    else if (kind === "bad") errors.push(`${u.via} の URL が使えない形: ${u.url.slice(0, 80)}（https:、data:image/、#{&f(…)} だけ）`);
  }
  return { errors, externals };
}

/**
 * CSS が外へ読み込みをするか（preview の掃除用。tools 2.0.1。print-craft MCP の MCP App のレビュー BLOCKER 1）: @import、@font-face、
 * data: の画像・# の参照・置き換えタグでない url() / image-set() / image() / src() の URL（https、相対、使えない形）。
 * コメント・文字列・エスケープ（@\69mport、\75rl など）は tokenizeCss で解いてから見る
 */
export function hasCssFetch(css: string): boolean {
  const { code } = tokenizeCss(css);
  if (/@import\b/i.test(code) || /@font-face\b/i.test(code)) return true;
  return extractUrls(css).some((u) => {
    const kind = classifyUrl(u.url);
    return kind !== "data-image" && kind !== "data-svg" && kind !== "fragment" && kind !== "placeholder";
  });
}
