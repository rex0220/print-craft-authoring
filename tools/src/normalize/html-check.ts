/**
 * 帳票の HTML の検査（docs/authoring-plan.md 12.3、Codex BLOCKER 1）。happy-dom で DOM 化して全要素・全属性を走査し、許可した要素と属性だけ通す。
 *   - 禁止する要素: script object embed link base meta[http-equiv] iframe[srcdoc] noscript applet frame frameset form input button select textarea
 *   - 禁止する属性: on*、srcdoc、formaction、action、ping、background
 *   - URL 属性（src href xlink:href srcset poster data cite longdesc usemap）は正規化して https: / data:image/ / 置き換えタグ / 相対だけ
 *   - style 属性は CSS と同じ検査（url() など）
 *   - ${式} を属性値に置くのはエラー（ESC_HTML は引用符を逃がさない）
 *   - iframe の src は利用者の kintone と同じオリジンだけ（印刷屋はグラフの iframe の中身を同一オリジンで読んで画像にする）
 *   - <style> の中身は CSS の検査に回す
 * 外部の https の URL は承認の対象として返す（policy で許す）。
 */
import { checkCss, classifyUrl } from "./css-check.ts";

export interface HtmlExternal {
  url: string;
  /** 例 img[src]、iframe[src]、style url() */
  via: string;
}

export interface HtmlCheckResult {
  errors: string[];
  warnings: string[];
  externals: HtmlExternal[];
}

const ALLOWED_TAGS = new Set([
  "div", "span", "p", "br", "hr", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark", "del", "ins",
  "a", "section", "article", "header", "footer", "main", "nav", "aside", "figure", "figcaption", "pre", "code", "blockquote", "q", "cite", "abbr", "time", "address", "label", "wbr",
  "iframe", "style", "ruby", "rt", "rp", "bdi", "bdo",
  // svg（社印などの図）
  "svg", "g", "defs", "use", "symbol", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "textpath", "image", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "title", "desc", "filter", "fegaussianblur", "feoffset", "femerge", "femergenode", "feblend", "fecolormatrix"
]);
const DENIED_TAGS = new Set(["script", "object", "embed", "link", "base", "meta", "noscript", "applet", "frame", "frameset", "form", "input", "button", "select", "textarea", "template", "slot", "portal", "math"]);
const DENIED_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "background", "dynsrc", "lowsrc", "codebase", "classid", "archive", "data", "manifest"]);
const URL_ATTRS = new Set(["src", "href", "xlink:href", "srcset", "poster", "cite", "longdesc", "usemap", "formaction", "action", "data"]);

interface DomLike {
  DOMParser: new () => { parseFromString(html: string, type: string): { documentElement: ElementLike | null; body: ElementLike | null } };
}
interface ElementLike {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  children: ArrayLike<ElementLike>;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

let windowPromise: Promise<DomLike> | null = null;
async function dom(): Promise<DomLike> {
  if (!windowPromise) {
    windowPromise = (async () => {
      const { Window } = (await import("happy-dom")) as unknown as { Window: new (opt: { url: string }) => DomLike };
      return new Window({ url: "https://authoring.local/" });
    })();
  }
  return windowPromise;
}

function sameOrigin(url: string, baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/** srcset は「URL 幅, URL 幅」。URL だけ取り出す */
function srcsetUrls(value: string): string[] {
  return value.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
}

export async function checkHtml(html: string, opt: { baseUrl?: string } = {}): Promise<HtmlCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const externals: HtmlExternal[] = [];
  if (!html.trim()) return { errors, warnings, externals };
  const w = await dom();
  const doc = new w.DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
  const root = doc.body ?? doc.documentElement;
  if (!root) return { errors, warnings, externals };
  const walk = (el: ElementLike, path: string): void => {
    const tag = el.tagName.toLowerCase();
    const here = `${path}>${tag}`;
    if (DENIED_TAGS.has(tag)) {
      errors.push(`<${tag}> は使えない（${here}）`);
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) warnings.push(`<${tag}> は許可の一覧に無い（${here}）。必要なら authoring tools の一覧に足す`);
    if (tag === "style") {
      const r = checkCss(el.textContent ?? "");
      for (const e of r.errors) errors.push(`<style>: ${e}`);
      for (const u of r.externals) externals.push({ url: u.url, via: `<style> ${u.via}` });
    }
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const value = a.value ?? "";
      if (name.startsWith("on")) {
        errors.push(`${name} 属性（イベント）は使えない（${here}）`);
        continue;
      }
      if (DENIED_ATTRS.has(name) && !(tag === "object" || tag === "embed")) {
        errors.push(`${name} 属性は使えない（${here}）`);
        continue;
      }
      if (value.includes("${")) {
        errors.push(`属性値に \${式} を置けない（${here}[${name}]。ESC_HTML は引用符を逃がさないので属性が壊れる。属性の値は固定にするか、計算式で TAG / ATTR を組む）`);
        continue;
      }
      if (name === "style") {
        const r = checkCss(`x{${value}}`);
        for (const e of r.errors) errors.push(`style 属性: ${e}（${here}）`);
        for (const u of r.externals) externals.push({ url: u.url, via: `${here}[style] ${u.via}` });
        continue;
      }
      if (URL_ATTRS.has(name)) {
        const urls = name === "srcset" ? srcsetUrls(value) : [value];
        for (const u of urls) {
          const kind = classifyUrl(u);
          if (kind === "bad") {
            errors.push(`${name} の URL が使えない形: ${u.slice(0, 80)}（${here}。https:、data:image/、#{&f(…)}、相対だけ）`);
            continue;
          }
          if (kind === "placeholder" && /^#\{&q\(/.test(u.trim()) && /&|\$\{/.test(u)) {
            warnings.push(`#{&q(…)} の中にレコードの値を直接つないでいる（${here}[${name}]。) や ' で壊れる）`);
          }
          if (tag === "iframe" && name === "src") {
            if (kind !== "https" || !sameOrigin(u, opt.baseUrl)) errors.push(`iframe の src は利用者の kintone（${opt.baseUrl ?? "fields の baseUrl"}）だけ: ${u.slice(0, 80)}（${here}）`);
            continue; // 同一オリジンの iframe は外部 URL として扱わない
          }
          if (kind === "https") externals.push({ url: u.trim(), via: `${here}[${name}]` });
        }
      }
    }
    for (const c of Array.from(el.children)) walk(c, here);
  };
  for (const c of Array.from(root.children)) walk(c, "");
  return { errors, warnings, externals };
}

/** HTML の ${式} を列挙する（生の差し込みの警告用） */
export function expressionsOf(html: string): string[] {
  return [...html.matchAll(/\$\{(.*?)\}/g)].map((m) => m[1].trim());
}
