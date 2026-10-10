/**
 * 帳票 HTML のプレビュー（docs/authoring-plan.md 12.2 の preview、Codex BLOCKER 1 / MAJOR 4 の反映。1-10 レビュー BLOCKER 4）。印刷屋のコードは API（engine.api）から。
 *   - CSS は印刷屋と同じ buildReportCss（ページの基本 → 共通 CSS → 行の CSS）。文書に入れる前に `<` を CSS のエスケープ（\3c）にして、CSS から </style> で抜けられないようにする
 *   - HTML は authoring 専用の行単位レンダラー: ${式} ごと・行の計算式ごとに catch し、失敗した式はエスケープして赤字で埋めて続ける
 *   - #{&f(…)} / #{&q(…)} はダミー画像、#{&p} / #{&n} はページ番号（印刷屋の replaceTags を happy-dom の DOM で動かす）
 *   - 描いた DOM から、動きや通信や遷移の元になる要素と属性を外す（script / meta / link / form / iframe / SMIL …、on*、href、srcdoc …）。
 *     レコードの値が TABLE_HTML などで HTML として入る経路があるため、テンプレートの検査（html-check）とは別にここでも外す。
 *     描いた DOM の <style> の中身と style 属性は、外へ読み込むもの（@import、@font-face、data: でない url() など）があれば外す（tools 2.0.1。
 *     承認済みの Web フォントの配信元は CSP で許すので、レコードの値から作った CSS でその配信元へ値を送れないように。print-craft MCP の MCP App のレビュー BLOCKER 1）
 *   - happy-dom の HTML の解析は仕様と違うところがあり（<!-->、<![CDATA[…、<?…、<noembed> の中の <!-- など）、掃除した DOM を文字にした HTML を
 *     Chrome が読むと、掃除していない <style> などができる（tools 2.0.1）。そこで、注釈・SVG・中身を文字として読む要素・使えない名前を外し、
 *     文字にした HTML を HTML の仕様の字句解析（Chrome と同じ規則）で読み直して、開始タグ・属性・<style> の中身が掃除した DOM と同じかを確かめる
 *     （verifyPreviewHtml）。違えば帳票を出さない
 *   - 出力は 2 層の HTML: 外側の文書の中に sandbox 属性だけの iframe を置き、帳票の文書を srcdoc で入れる。帳票の文書にも CSP（img は data: だけ）
 *   - Web フォント（Takashi 2026-10-05「preview で、指定した WEB フォントを利用できるようにすることは可能か？」→ Go）: 配信元が承認済み（Google Fonts は既定、
 *     他は policy の allowExternal）のときだけ、帳票の文書に <link rel="stylesheet"> を入れ、CSP の style-src / font-src にその配信元を足す
 *     （Google Fonts は fonts.googleapis.com と fonts.gstatic.com）。preview の外部通信はこれだけで、送るのは設定に書いた固定の URL。未承認なら読まない（OS の書体）
 */
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import type { MenuRow, TagRow } from "print-craft/src/config/schema.ts";
import type { Engine, FormulaInstance } from "../engine.ts";
import type { Model } from "../normalize/model.ts";
import type { KintoneRecord } from "../commands/record.ts";
import { hasCssFetch } from "../normalize/css-check.ts";

export const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const OUTER_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'";

/** 帳票の文書に入れる Web フォント（印刷屋の webFontOf と同じ family / cssUrl） */
export interface PreviewFont {
  family: string;
  cssUrl: string;
}

/** Web フォントの CSS とフォント本体の配信元（CSP に書く）。Google Fonts は CSS が fonts.googleapis.com、本体が fonts.gstatic.com。https 以外は null */
export function fontOrigins(cssUrl: string): { style: string[]; font: string[] } | null {
  let origin: string;
  try {
    const u = new URL(cssUrl);
    if (u.protocol !== "https:") return null;
    origin = u.origin;
  } catch {
    return null;
  }
  const font = [origin];
  if (origin === "https://fonts.googleapis.com") font.push("https://fonts.gstatic.com");
  return { style: [origin], font };
}

/** 帳票の文書の CSP。承認済みの Web フォントがあれば、その配信元だけを style-src / font-src に足す */
export function previewCsp(font: PreviewFont | null): string {
  const o = font ? fontOrigins(font.cssUrl) : null;
  if (!o) return PREVIEW_CSP;
  return `default-src 'none'; img-src data:; style-src 'unsafe-inline' ${o.style.join(" ")}; font-src data: ${o.font.join(" ")}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}

/**
 * プレビューの DOM から外す要素（動き・通信・遷移の元。描画には要らない）。svg と、中身を文字として読む要素（xmp、noembed、noframes、plaintext、title）、
 * frameset も外す（happy-dom と Chrome で読み方が違う。インラインの svg はテンプレートの検査でも使えない。tools 2.0.1）
 */
export const PREVIEW_REMOVE_SELECTOR = "script,meta,link,base,form,input,button,select,textarea,iframe,frame,frameset,object,embed,applet,noscript,template,video,audio,source,track,canvas,map,area,svg,animate,animatemotion,animatetransform,animatecolor,set,foreignobject,math,xmp,noembed,noframes,plaintext,title";
/** プレビューの DOM から外す属性（attributionsrc は Chrome の Attribution Reporting の通信） */
const REMOVE_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "target", "download", "background", "poster", "manifest", "attributionsrc"]);
/** 残してよい要素と属性の名前（Chrome の字句解析が名前を切る空白・/・>・= や引用符を含まない） */
const SAFE_TAG = /^[a-z][a-z0-9-]*$/;
const SAFE_ATTR = /^[a-z_:][a-z0-9_.:-]*$/;
const HTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * 帳票の文書の基本の CSS。印刷屋の PC 画面では帳票は kintone の body の文字の設定（font-size 16px、line-height 1.5、書体）を継ぐので、同じ値を置く。
 * line-height を置かないと「normal」になり、BIZ UD など行間の無い書体では行が詰まって、印鑑（.pcraft-inv-seal は右の列の下端に絶対配置）や
 * 表の行の高さが印刷屋と変わった（Takashi 2026-10-05「かなり表示が異なる」）
 */
const PAGES_CSS = `body { margin: 0; background: #f7f7f7; }
.xp-rex0220-print-craft-overlay-pages { display: block; width: fit-content; font-size: 16px; line-height: 1.5; font-family: "メイリオ", Meiryo, "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN W3", "ＭＳ Ｐゴシック", "Lucida Grande", "Lucida Sans Unicode", Arial, Verdana, sans-serif; -webkit-text-size-adjust: 100%; }
.pcraft-authoring-error { color: #b00020; background: #fde7e9; border: 1px solid #b00020; border-radius: 3px; padding: 0 4px; font-size: 12px; font-family: monospace; }`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** <style> の中に入れる CSS: `<` を CSS のエスケープにして、</style> や <!-- で文書を壊せないようにする（文字列の中の < も同じ見た目になる） */
export function escapeCssText(css: string): string {
  return css.replace(/</g, "\\3c ").replace(/-->/g, "--\\3e ");
}

export interface RenderedButton {
  menu: string;
  fileName: string;
  pageSize: string;
  orientation: string;
  dpi: string;
  pages: number;
  errors: string[];
  /** 帳票の文書に入れた Web フォントの CSS の URL（承認済みのときだけ。無ければ null） */
  webFont: string | null;
  inner: string;
  html: string;
}

function errorSpan(expression: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return `<span class="pcraft-authoring-error">式のエラー: ${escapeHtml(expression)} — ${escapeHtml(message)}</span>`;
}

/** authoring 専用の行単位レンダラー（印刷屋の buildReportHtml と同じ順序・同じ \ → &yen; の置き換え。失敗しても続ける） */
export function renderRows(api: PrintCraftAuthoringApi, row: MenuRow, record: KintoneRecord, kf: FormulaInstance, errors: string[]): string {
  const rows: TagRow[] = row.tagsInfo?.fieldsInfo ?? [];
  let html = "";
  for (let index = 2; index < rows.length; index++) {
    const info = rows[index];
    if (!info.state) continue;
    let tmp = info.html
      ? info.html.replace(/\$\{(.*?)\}/g, (_m, key: string) => {
          try {
            const v = kf.dq(key);
            return v == null ? "" : String(v);
          } catch (e) {
            errors.push(`HTML 設定 ${index + 1} 行目 \${${key}}: ${e instanceof Error ? e.message : String(e)}`);
            return errorSpan(`\${${key}}`, e);
          }
        })
      : "";
    const formula = api.formulaOf(info);
    if (formula) {
      (record as Record<string, unknown>).$html = { value: tmp, type: "MULTI_LINE_TEXT" };
      try {
        const v = kf.dq(formula);
        tmp = v == null ? "" : String(v);
      } catch (e) {
        errors.push(`HTML 設定 ${index + 1} 行目の計算式: ${e instanceof Error ? e.message : String(e)}`);
        tmp += errorSpan(formula.length > 120 ? formula.slice(0, 120) + "…" : formula, e);
      }
    }
    html += tmp;
  }
  return html.replace(/\\/g, "&yen;");
}

interface DomNode {
  nodeType: number;
  childNodes: ArrayLike<DomNode>;
  remove(): void;
}

interface DomElement extends DomNode {
  tagName: string;
  namespaceURI: string | null;
  attributes: ArrayLike<{ name: string; value: string }>;
  textContent: string | null;
  innerHTML: string;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  removeAttribute(name: string): void;
}

/** 描いた DOM から動き・通信・遷移の元を外す。外した数を返す */
export function sanitizePreviewDom(host: DomElement): { removedElements: number; removedAttributes: number } {
  let removedElements = 0;
  let removedAttributes = 0;
  for (const el of Array.from(host.querySelectorAll(PREVIEW_REMOVE_SELECTOR))) {
    el.remove();
    removedElements++;
  }
  // 要素と文字でない節（注釈・CDATA・処理命令）を外す。happy-dom は <!-->、<![CDATA[…、<?… を Chrome と違う範囲の注釈にする
  const stack: DomNode[] = [host];
  while (stack.length) {
    for (const child of Array.from(stack.pop()!.childNodes)) {
      if (child.nodeType === 1) stack.push(child);
      else if (child.nodeType !== 3) {
        child.remove();
        removedElements++;
      }
    }
  }
  for (const el of Array.from(host.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (el.namespaceURI !== HTML_NS || !SAFE_TAG.test(tag)) {
      el.remove();
      removedElements++;
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const value = String(a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      const isLink = name === "href" || name === "xlink:href";
      const fetches = name === "style" && hasCssFetch(`x{${a.value ?? ""}}`);
      if (!SAFE_ATTR.test(name) || name.startsWith("on") || REMOVE_ATTRS.has(name) || (isLink && !value.startsWith("#")) || /^[\u0000- ]*javascript:/i.test(value) || fetches) {
        el.removeAttribute(a.name);
        removedAttributes++;
      }
    }
    if (tag === "style") {
      const css = el.textContent ?? "";
      // 外へ読み込む <style> は中身ごと外す（承認済みの Web フォントの配信元へも、レコードの値を載せて送らない）
      if (hasCssFetch(css)) {
        el.textContent = "";
        removedElements++;
      } else el.textContent = escapeCssText(css);
    }
  }
  return { removedElements, removedAttributes };
}

/** 掃除した DOM の開始タグ（verifyPreviewHtml と照らし合わせる。属性の値と <style> の中身は Chrome の入力の前処理と同じく改行を LF に、NUL を U+FFFD に） */
export interface PreviewStartTag {
  tag: string;
  attrs: Array<[string, string]>;
  /** <style> の中身 */
  text?: string;
}

const normalizeInput = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/\0/g, "\ufffd");

/** 掃除した DOM の要素を、文字にしたときの開始タグの順（文書の順）に並べる */
export function previewStartTags(host: DomElement): PreviewStartTag[] {
  return Array.from(host.querySelectorAll("*")).map((el) => {
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes).map((a): [string, string] => [a.name.toLowerCase(), normalizeInput(String(a.value ?? ""))]);
    return tag === "style" ? { tag, attrs, text: normalizeInput(el.textContent ?? "") } : { tag, attrs };
  });
}

/**
 * Chrome の読み方がほかと変わる要素（中身を文字・RCDATA として読む、外の名前空間、別の文書の断片、select や frameset の挿入モード）。
 * 掃除で外してあるはずなので、残っていれば確かめを止める
 */
const VERIFY_FORBIDDEN = new Set(["script", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext", "textarea", "title", "svg", "math", "template", "select", "frameset"]);
/** happy-dom が属性の値を文字にするときの文字参照（ほかの & があれば確かめを止める） */
const ATTR_REFS: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": "\u00a0", "&#39;": "'" };
const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";
const isAlpha = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z]$/.test(c);

function decodeAttrValue(raw: string): string | null {
  let known = true;
  const value = raw.replace(/&[^;&]*;?/g, (m) => {
    const r = ATTR_REFS[m];
    if (r === undefined) known = false;
    return r ?? m;
  });
  return known ? normalizeInput(value) : null;
}

/** タグの名前の後ろ（属性と >）を HTML の仕様の字句解析（before attribute name state から）で読む。タグが閉じていなければ null */
function readTagRest(html: string, j: number): { end: number; attrs: Array<[string, string]> } | null {
  const n = html.length;
  const attrs: Array<[string, string]> = [];
  for (;;) {
    while (j < n && isSpace(html[j])) j++;
    if (j >= n) return null;
    if (html[j] === ">") return { end: j + 1, attrs };
    if (html[j] === "/") {
      // self-closing start tag state: > でなければ before attribute name state で読み直す
      j++;
      if (j >= n) return null;
      if (html[j] === ">") return { end: j + 1, attrs };
      continue;
    }
    // attribute name state（先頭の = は名前に入る）
    let name = html[j++];
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">" && html[j] !== "=") name += html[j++];
    while (j < n && isSpace(html[j])) j++;
    if (j >= n) return null;
    let raw = "";
    if (html[j] === "=") {
      j++;
      while (j < n && isSpace(html[j])) j++;
      if (j >= n) return null;
      const q = html[j];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1);
        if (close < 0) return null;
        raw = html.slice(j + 1, close);
        j = close + 1;
      } else if (q !== ">") {
        const start = j;
        while (j < n && !isSpace(html[j]) && html[j] !== ">") j++;
        raw = html.slice(start, j);
      }
    }
    attrs.push([name.toLowerCase(), raw]);
  }
}

/**
 * 掃除した DOM を文字にした HTML（host.innerHTML）を、HTML の仕様の字句解析（Chrome と同じ規則）で読み直して確かめる（tools 2.0.1）。
 * タグでない < （注釈・CDATA・処理命令）や読み方の変わる要素が無く、開始タグ・属性・<style> の中身が掃除した DOM（expected）と同じで、
 * style 属性と <style> が外へ読み込まないこと。違えば理由（決まった文。レコードの値は入れない）を返す
 */
export function verifyPreviewHtml(html: string, expected: readonly PreviewStartTag[]): string | null {
  const n = html.length;
  let i = 0;
  let k = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html[lt + 1] === "/" && isAlpha(html[lt + 2])) {
      let j = lt + 2;
      while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
      const rest = readTagRest(html, j);
      if (!rest) return "閉じていないタグがある";
      i = rest.end;
      continue;
    }
    if (!isAlpha(html[lt + 1])) return "タグでない「<」がある（注釈・CDATA・処理命令など）";
    let j = lt + 1;
    while (j < n && !isSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
    const tag = normalizeInput(html.slice(lt + 1, j)).toLowerCase();
    const rest = readTagRest(html, j);
    if (!rest) return "閉じていないタグがある";
    if (VERIFY_FORBIDDEN.has(tag)) return "中身を文字として読む要素か、SVG・MathML などがある";
    const want = expected[k++];
    if (!want || want.tag !== tag) return "要素の並びが掃除した DOM と違う";
    if (rest.attrs.length !== want.attrs.length) return "属性が掃除した DOM と違う";
    for (let x = 0; x < rest.attrs.length; x++) {
      const [name, raw] = rest.attrs[x];
      const value = decodeAttrValue(raw);
      if (value === null || name !== want.attrs[x][0] || value !== want.attrs[x][1]) return "属性が掃除した DOM と違う";
      if (name === "style" && hasCssFetch(`x{${value}}`)) return "style 属性が外へ読み込む";
    }
    i = rest.end;
    if (tag === "style") {
      // RAWTEXT: </style の後が空白・/・> のところまで（無ければ文書の終わりまで）
      const close = /<\/style[\t\n\f\r />]/gi;
      close.lastIndex = i;
      const m = close.exec(html);
      const css = html.slice(i, m ? m.index : n);
      if (css.includes("<")) return "<style> の中に「<」がある";
      if (normalizeInput(css) !== want.text) return "<style> の中身が掃除した DOM と違う";
      if (hasCssFetch(css)) return "<style> が外へ読み込む";
      i = m ? m.index : n;
    }
  }
  return k === expected.length ? null : "要素の数が掃除した DOM と違う";
}

/** 確かめが通らなかったときに帳票の代わりに出す文 */
export const PREVIEW_WITHHELD = `<p class="pcraft-authoring-error">帳票を表示しません（ブラウザーと読み方の違う HTML があります。誤りの一覧を見てください）</p>`;

/**
 * 掃除した DOM を文字にし、Chrome が読んでも掃除した DOM と同じになるかを確かめる。違えば帳票の代わりの決まった文と理由
 * （理由は決まった文。レコードの値を誤りの文に入れない）
 */
export function previewContent(host: DomElement): { content: string; mismatch: string | null } {
  const html = host.innerHTML;
  const mismatch = verifyPreviewHtml(html, previewStartTags(host));
  return mismatch ? { content: PREVIEW_WITHHELD, mismatch } : { content: html, mismatch: null };
}

export interface RenderInput {
  body: Record<string, unknown>;
  row: MenuRow;
  model: Model;
  engine: Engine;
  record: KintoneRecord;
  /** 設定の Web フォント（有効なとき）と、配信元が承認済みか（policy。Google Fonts は既定で承認） */
  webFont?: { font: PreviewFont; approved: boolean } | null;
}

export function renderButton(input: RenderInput): RenderedButton {
  const { row, model, engine, body } = input;
  const api = model.api;
  const tags = row.tagsInfo;
  if (!tags) throw new Error(`${row.menu}: HTML 設定が無い`);
  const errors: string[] = [];
  const record = JSON.parse(JSON.stringify(input.record)) as KintoneRecord;
  const paper = api.getPaperSize(tags.pageSize || "A4", tags.orientation || "p", Number(tags.dpi) || 96);
  const kf = engine.runner(model.ppRun, record);
  const fileName = api.fileNameOf(row, kf as unknown as Parameters<PrintCraftAuthoringApi["fileNameOf"]>[1]);
  const font = api.webFontOf(body.fontInfo);
  // 共通 CSS が無い設定は、印刷屋の設定画面が既定の 4 行で保存する（全置換）ので、その形で見せる（一部置換・追加では取り込み先のアプリの共通 CSS が使われる）
  const cssBody = Array.isArray(body.cssInfo) ? body : { ...body, cssInfo: api.defaultCssRows() };
  const css = api.buildReportCss(cssBody as Parameters<PrintCraftAuthoringApi["buildReportCss"]>[0], row, paper.scr, font);
  const html = renderRows(api, row, record, kf, errors);

  const doc = (engine.window as { document: Document }).document;
  const host = doc.createElement("div");
  // 印刷屋 Ver.6 の mountReportHtml は既定で kintone 以外への読み込みとスクリプトを除く（共通の設定「外部参照」が "allow" なら除かない）。
  // プレビューも同じにする（happy-dom の origin は authoring.local なので、kintone の URL も「外部」になる。帳票の iframe は下の sanitizePreviewDom が外す）
  const pages = api.mountReportHtml(host as unknown as HTMLElement, html, { sanitize: body.externalRefs !== "allow" });
  api.replaceTags(pages, {}, {}, api.DUMMY_IMAGE);
  if (pages.length === 0) errors.push("ページ要素（class=\"rex0220-pcraft-page\"）が無い。印刷屋は 0 ページの PDF を作る");
  sanitizePreviewDom(host as unknown as DomElement);
  const { content, mismatch } = previewContent(host as unknown as DomElement);
  if (mismatch) errors.push(`帳票を表示しない: 掃除した帳票の HTML をブラウザーが読むと、掃除の結果と違う形になる（${mismatch}）。レコードの値や HTML 設定に、注釈・CDATA・SVG などの書き方が無いか確かめる`);
  // Web フォント: 承認済みのときだけ <link> を入れて CSP に配信元を足す（preview の唯一の外部通信）
  const wf = input.webFont ?? null;
  const useFont = wf && wf.approved && fontOrigins(wf.font.cssUrl) ? wf.font : null;
  const fontLink = useFont ? `\n<link rel="stylesheet" href="${escapeHtml(useFont.cssUrl)}">` : "";
  const inner = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${previewCsp(useFont)}">${fontLink}
<title>${escapeHtml(row.menu)}</title>
<style>${PAGES_CSS}</style>
<style class="xp-rex0220-print-craft-page-style">${escapeCssText(css)}</style>
</head><body><div class="xp-rex0220-print-craft-overlay-pages">${content}</div></body></html>`;

  const width = paper.scr.width + 40;
  const height = Math.max(1, pages.length) * (paper.scr.height + 40) + 40;
  const errorList = errors.length ? `<ul class="errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
  const fontNote = useFont
    ? `Web フォント「${escapeHtml(useFont.family)}」は ${escapeHtml(fontOrigins(useFont.cssUrl)!.style[0])} から読みます（承認済み。preview の外部通信はこれだけ）。`
    : wf
      ? `Web フォント「${escapeHtml(wf.font.family)}」は配信元が未承認のため読みません（OS の書体で代替。利用者が policy/authoring-policy.json の allowExternal に書けば読みます）。`
      : "Web フォントは使いません。";
  const outer = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${OUTER_CSP}">
<title>preview: ${escapeHtml(row.menu)}</title>
<style>
body { margin: 0; font-family: system-ui, sans-serif; background: #e9ecef; color: #222; }
header { padding: 12px 16px; background: #fff; border-bottom: 1px solid #ccc; }
h1 { margin: 0 0 4px; font-size: 18px; }
header p { margin: 2px 0; font-size: 13px; color: #555; }
.errors { margin: 8px 0 0; padding: 8px 12px 8px 28px; background: #fde7e9; border: 1px solid #b00020; color: #b00020; font-size: 13px; }
iframe { display: block; margin: 12px auto; border: 0; background: #f7f7f7; }
</style></head><body>
<header>
<h1>${escapeHtml(row.menu)}</h1>
<p>ファイル名: ${escapeHtml(fileName)} / 用紙: ${escapeHtml(tags.pageSize)} ${tags.orientation === "l" ? "横" : "縦"} ${escapeHtml(String(tags.dpi))} dpi / ページ: ${pages.length}</p>
<p>これは近似のプレビューです。添付ファイルの画像と QR はダミーです。${fontNote} PDF の見た目は印刷屋プラグインで確かめてください。帳票は sandbox の iframe の中に置き、スクリプトと外部への通信（承認した Web フォントの配信元を除く）は CSP と sandbox で止め、リンクと埋め込みの要素は外してあります（文字だけ残る）。</p>
${errorList}
</header>
<iframe sandbox="" title="${escapeHtml(row.menu)}" width="${width}" height="${height}" srcdoc="${escapeHtml(inner)}"></iframe>
</body></html>
`;
  return { menu: row.menu, fileName, pageSize: tags.pageSize, orientation: tags.orientation, dpi: String(tags.dpi), pages: pages.length, errors, webFont: useFont ? useFont.cssUrl : null, inner, html: outer };
}
