/**
 * 帳票の HTML の検査（docs/authoring-plan.md 12.3、Codex BLOCKER 1。1-10 レビュー BLOCKER 3 で allowlist にした）。
 * happy-dom で DOM 化して全要素・全属性を走査する。**許可した要素と属性だけ通し、一覧に無いものはエラー**（警告で通さない）。
 *   - 要素: 文章と表と画像の要素だけ（ALLOWED_TAGS）。script / object / embed / link / base / meta / form 系 / template などは理由を添えてエラー、
 *     インラインの <svg> と <math> もエラー（SMIL や foreignObject など動的に変わる経路が多い。図は <img src="data:image/svg+xml,…"> で入れる）
 *   - 属性: 共通の属性（class id style title lang dir …）+ 要素ごとの属性（img の src srcset alt、td の colspan …）+ data-* / aria-*。on* などはエラー
 *   - URL 属性（src href srcset cite）は Chrome と同じ前処理（タブ・改行・制御文字・\）で分類し、https: / data:image/ / 置き換えタグ / 相対だけ。
 *     a の href は data: も不可、iframe の src は利用者の kintone と同じオリジンだけ（印刷屋はグラフの iframe の中身を同一オリジンで読んで画像にする）
 *   - style 属性と <style> の中身は CSS と同じ検査（エスケープの復号、url() など）
 *   - ${式} を属性値に置くのはエラー（ESC_HTML は引用符を逃がさない）
 * 外部の https の URL は承認の対象として返す（policy で許す）。
 */
import { checkCss, classifyUrl, cleanUrl, parseSrcsetUrls } from "./css-check.ts";
export { parseSrcsetUrls } from "./css-check.ts";

export interface HtmlExternal {
  url: string;
  /** 例 >div>img[src]、iframe[src]、<style> url() */
  via: string;
}

export interface HtmlCheckResult {
  errors: string[];
  warnings: string[];
  externals: HtmlExternal[];
}

export const ALLOWED_TAGS = new Set([
  "div", "span", "p", "br", "hr", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "ul", "ol", "li", "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark", "del", "ins",
  "a", "section", "article", "header", "footer", "main", "nav", "aside", "figure", "figcaption", "pre", "code", "blockquote", "q", "cite", "abbr", "time", "address", "label", "wbr",
  "iframe", "style", "ruby", "rt", "rp", "bdi", "bdo", "big", "center", "font", "tt", "kbd", "samp", "var", "dfn"
]);

/** 使えない要素とその理由（一覧に無い要素もエラーになるが、よく出るものは理由を添える） */
const DENIED_REASON: Record<string, string> = {
  script: "スクリプト", object: "外部の内容を埋め込む", embed: "外部の内容を埋め込む", applet: "外部の内容を埋め込む",
  link: "外部の CSS を読む", base: "リンクの基準を変える", meta: "文書の動きを変える（refresh など）",
  noscript: "", template: "", slot: "", portal: "",
  form: "送信の経路", input: "入力欄", button: "入力欄", select: "入力欄", textarea: "入力欄", option: "入力欄", optgroup: "入力欄",
  frame: "", frameset: "",
  svg: "インラインの SVG は使わない（図は <img src=\"data:image/svg+xml,…\"> か添付ファイルの #{&f(…)} で入れる）",
  math: "MathML は使わない",
  video: "動画は PDF にならない", audio: "音声は PDF にならない", source: "", track: "", picture: "<img src> だけ使う", canvas: "",
  map: "", area: "", dialog: "", details: "", summary: "", marquee: "", xmp: "", plaintext: "", listing: "",
  html: "", head: "", body: "", title: ""
};

const GLOBAL_ATTRS = new Set(["class", "id", "style", "title", "lang", "dir", "hidden", "translate", "role", "align", "valign", "bgcolor", "border", "width", "height", "color", "nowrap", "char", "charoff"]);
const TAG_ATTRS: Record<string, string[]> = {
  img: ["src", "srcset", "alt", "loading", "decoding", "sizes"],
  a: ["href", "target", "rel", "name"],
  td: ["colspan", "rowspan", "headers", "scope", "abbr"],
  th: ["colspan", "rowspan", "headers", "scope", "abbr"],
  col: ["span"],
  colgroup: ["span"],
  table: ["cellpadding", "cellspacing", "summary", "rules", "frame"],
  ol: ["start", "reversed", "type"],
  ul: ["type"],
  li: ["value"],
  time: ["datetime"],
  q: ["cite"],
  blockquote: ["cite"],
  ins: ["cite", "datetime"],
  del: ["cite", "datetime"],
  iframe: ["src", "name", "frameborder", "scrolling"],
  label: ["for"],
  style: ["media", "type"],
  font: ["face", "size"]
};
/** URL として分類する属性 */
export const URL_ATTRS = new Set(["src", "srcset", "href", "cite"]);

/** 要素が使えないときの文言（使えれば null）。計算式の TAG / VTAG の要素名の検査にも使う */
export function tagError(tag: string, where = ""): string | null {
  const t = tag.toLowerCase();
  if (ALLOWED_TAGS.has(t)) return null;
  const reason = DENIED_REASON[t];
  return `<${t}> は使えない（${where}${where ? "。" : ""}${reason ? reason : "許可の一覧に無い要素"}）`;
}

/** 属性が使えるか（tag が分からないときは、どの要素でも使える属性か、どれかの要素で使える属性か） */
export function attrAllowed(tag: string | undefined, name: string): boolean {
  if (GLOBAL_ATTRS.has(name)) return true;
  if (name.startsWith("data-") || name.startsWith("aria-")) return true;
  if (tag === undefined) return Object.values(TAG_ATTRS).some((list) => list.includes(name));
  return (TAG_ATTRS[tag] ?? []).includes(name);
}

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
    const denied = tagError(tag, here);
    if (denied) {
      errors.push(denied);
      return;
    }
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
      if (!attrAllowed(tag, name)) {
        errors.push(`${name} 属性は使えない（${here}。許可の一覧に無い属性）`);
        continue;
      }
      if (value.includes("${")) {
        errors.push(`属性値に \${式} を置けない（${here}[${name}]。ESC_HTML は引用符を逃がさないので属性が壊れる。属性の値は固定にする）`);
        continue;
      }
      if (name === "style") {
        const r = checkCss(`x{${value}}`);
        for (const e of r.errors) errors.push(`style 属性: ${e}（${here}）`);
        for (const u of r.externals) externals.push({ url: u.url, via: `${here}[style] ${u.via}` });
        continue;
      }
      if (URL_ATTRS.has(name)) {
        const urls = name === "srcset" ? parseSrcsetUrls(value) : [value];
        for (const u of urls) {
          const kind = classifyUrl(u);
          const shown = cleanUrl(u).slice(0, 80);
          if (kind === "bad") {
            errors.push(`${name} の URL が使えない形: ${shown}（${here}。https:、data:image/、#{&f(…)}、相対だけ）`);
            continue;
          }
          if (tag === "a" && (kind === "data-image" || kind === "data-svg")) {
            errors.push(`href に data: は使えない（${here}）`);
            continue;
          }
          if (tag === "iframe" && name === "src") {
            if (kind !== "https" || !sameOrigin(cleanUrl(u), opt.baseUrl)) errors.push(`iframe の src は利用者の kintone（${opt.baseUrl ?? ".env の KINTONE_BASE_URL。未設定なので iframe は使えない"}）だけ: ${shown}（${here}）`);
            continue; // 同一オリジンの iframe は外部 URL として扱わない
          }
          if (kind === "https") externals.push({ url: cleanUrl(u), via: `${here}[${name}]` });
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
