/**
 * 帳票 HTML のプレビュー（docs/authoring-plan.md 12.2 の preview、Codex BLOCKER 1 / MAJOR 4 の反映。1-10 レビュー BLOCKER 4）。印刷屋のコードは API（engine.api）から。
 *   - CSS は印刷屋と同じ buildReportCss（ページの基本 → 共通 CSS → 行の CSS）。文書に入れる前に `<` を CSS のエスケープ（\3c）にして、CSS から </style> で抜けられないようにする
 *   - HTML は authoring 専用の行単位レンダラー: ${式} ごと・行の計算式ごとに catch し、失敗した式はエスケープして赤字で埋めて続ける
 *   - #{&f(…)} / #{&q(…)} はダミー画像、#{&p} / #{&n} はページ番号（印刷屋の replaceTags を happy-dom の DOM で動かす）
 *   - 描いた DOM から、動きや通信や遷移の元になる要素と属性を外す（script / meta / link / form / iframe / SMIL …、on*、href、srcdoc …）。
 *     レコードの値が TABLE_HTML などで HTML として入る経路があるため、テンプレートの検査（html-check）とは別にここでも外す。
 *     描いた DOM の <style> の中身と style 属性は、外へ読み込むもの（@import、@font-face、data: でない url() など）があれば外す（tools 2.0.1。
 *     帳票の文書の CSP でも止まるが、レコードの値から作った CSS で外へ値を送れないように掃除でも外す。print-craft MCP の MCP App のレビュー BLOCKER 1）
 *   - happy-dom の HTML の解析は仕様と違うところがあり（<!-->、<![CDATA[…、<?…、<noembed> の中の <!-- など）、掃除した DOM を文字にした HTML を
 *     Chrome が読むと、掃除していない <style> などができる（tools 2.0.1）。そこで、注釈・SVG・中身を文字として読む要素・使えない名前を外し、
 *     残す要素はテンプレートの検査と同じ一覧（ALLOWED_TAGS。iframe を除く）に限る（ほかの要素は外して中身を残す。Chrome の木の構築が名前を変える
 *     <image> などは残らない）。文字にした HTML を HTML の仕様の字句解析（Chrome と同じ規則）で読み直して、開始タグ・属性・<style> の中身が
 *     掃除した DOM と同じかを確かめる（verifyPreviewHtml）。違えば帳票を出さない
 *   - 出力は 2 層の HTML: 外側の文書の中に sandbox 属性だけの iframe を置き、帳票の文書を srcdoc で入れる。帳票の文書にも CSP（img は data: だけ）
 *   - Web フォントは読まない（tools 2.0.1。2026-10-10 Takashi「Web フォントの読み込みは、印刷屋プラグインで処理。tools には読み込み処理なし」
 *     「プラグイン設定の共通部分で切り替え」。2026-10-05 に足した読み込み（<link> と CSP の配信元）はやめた）。ページの CSS の font-family は印刷屋のまま
 *     （その書体が PC に入っていれば使われる。無ければ OS の書体）。preview は外部と通信しない（帳票の文書の CSP は PREVIEW_CSP だけ）
 */
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import type { MenuRow, TagRow } from "print-craft/src/config/schema.ts";
import type { Engine, FormulaInstance } from "../engine.ts";
import type { Model } from "../normalize/model.ts";
import type { KintoneRecord } from "../commands/record.ts";
import { hasCssFetch } from "../normalize/css-check.ts";
import { ALLOWED_TAGS } from "../normalize/html-check.ts";

export const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const OUTER_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'";

/**
 * プレビューの DOM から外す要素（動き・通信・遷移の元。描画には要らない）。svg と、中身を文字として読む要素（xmp、noembed、noframes、plaintext、title）、
 * frameset も外す（happy-dom と Chrome で読み方が違う。インラインの svg はテンプレートの検査でも使えない。tools 2.0.1）
 */
export const PREVIEW_REMOVE_SELECTOR = "script,meta,link,base,form,input,button,select,textarea,iframe,frame,frameset,object,embed,applet,noscript,template,video,audio,source,track,canvas,map,area,svg,animate,animatemotion,animatetransform,animatecolor,set,foreignobject,math,xmp,noembed,noframes,plaintext,title";
/** プレビューの DOM から外す属性（attributionsrc は Chrome の Attribution Reporting の通信） */
const REMOVE_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "target", "download", "background", "poster", "manifest", "attributionsrc"]);
/**
 * 描いた DOM に残す要素（テンプレートの検査の ALLOWED_TAGS から、外す iframe を除いたもの）。ほかの要素は外して中身（掃除したもの）を残す。
 * Chrome の木の構築が特別に扱う要素を知っているものに限る（名前を変える image、挿入モードを変える select・frameset・template、外の名前空間など。
 * Codex の tools 2.0.1 のレビュー MAJOR 2）
 */
export const PREVIEW_KEEP_TAGS: ReadonlySet<string> = new Set([...ALLOWED_TAGS].filter((t) => t !== "iframe"));
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
  /** 帳票の文書に入れた Web フォントの CSS の URL。2.0.1 から常に null（preview は Web フォントを読まない。読むのは印刷屋プラグイン） */
  webFont: string | null;
  /** 外へ読み込む書き方（url()・@import・@font-face など）があって preview で外した、HTML の行の <style> の中身と style 属性の数（2.0.1） */
  removedStyles: number;
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
  replaceWith(...nodes: DomNode[]): void;
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

/** 描いた DOM から動き・通信・遷移の元を外す。外した数を返す（removedStyles は、外へ読み込む書き方で外した <style> の中身と style 属性の数） */
export function sanitizePreviewDom(host: DomElement): { removedElements: number; removedAttributes: number; removedStyles: number } {
  let removedElements = 0;
  let removedAttributes = 0;
  let removedStyles = 0;
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
    // 一覧に無い要素は外して中身を残す（中身の要素はこの後の順で同じように掃除する）
    if (!PREVIEW_KEEP_TAGS.has(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
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
        if (fetches) removedStyles++;
      }
    }
    if (tag === "style") {
      const css = el.textContent ?? "";
      // 外へ読み込む <style> は中身ごと外す（CSP でも止まるが、レコードの値を載せて外へ送る書き方を残さない）
      if (hasCssFetch(css)) {
        el.textContent = "";
        removedElements++;
        removedStyles++;
      } else el.textContent = escapeCssText(css);
    }
  }
  return { removedElements, removedAttributes, removedStyles };
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
 * タグでない < （注釈・CDATA・処理命令）や残す一覧（PREVIEW_KEEP_TAGS）に無い要素が無く、開始タグ・属性・<style> の中身が掃除した DOM（expected）と
 * 同じで、style 属性と <style> が外へ読み込まないこと。違えば理由（決まった文。レコードの値は入れない）を返す。
 * 確かめるのは字句（開始タグの並び）で、木の形（親子）は見ない。残す一覧の要素について Chrome の木の構築がするのは、要素を補う（tbody・p など。属性は無い）、
 * 書式の要素を属性ごと写す（属性は確かめたもの）、置き場所を変える（table の foster parenting など）、トークンを捨てることだけで、名前を変えたり
 * 確かめていない要素・属性・CSS を作ったりしない（名前を変える image、字句解析の状態を変える要素や外の名前空間は一覧に無い。<style> は RAWTEXT のまま）
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
    if (!PREVIEW_KEEP_TAGS.has(tag)) return "残す一覧に無い要素がある（中身を文字として読む要素、SVG・MathML など）";
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
  const { removedStyles } = sanitizePreviewDom(host as unknown as DomElement);
  const { content, mismatch } = previewContent(host as unknown as DomElement);
  if (mismatch) errors.push(`帳票を表示しない: 掃除した帳票の HTML をブラウザーが読むと、掃除の結果と違う形になる（${mismatch}）。レコードの値や HTML 設定に、注釈・CDATA・SVG などの書き方が無いか確かめる`);
  const inner = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<title>${escapeHtml(row.menu)}</title>
<style>${PAGES_CSS}</style>
<style class="xp-rex0220-print-craft-page-style">${escapeCssText(css)}</style>
</head><body><div class="xp-rex0220-print-craft-overlay-pages">${content}</div></body></html>`;

  const width = paper.scr.width + 40;
  const height = Math.max(1, pages.length) * (paper.scr.height + 40) + 40;
  const errorList = errors.length ? `<ul class="errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
  const fontNote = font
    ? `Web フォント「${escapeHtml(font.family)}」は preview では読みません（その書体が PC に入っていなければ OS の書体で近似。PDF では印刷屋プラグインが読みます）。`
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
<p>これは近似のプレビューです。添付ファイルの画像と QR はダミーです。${fontNote} PDF の見た目は印刷屋プラグインで確かめてください。帳票は sandbox の iframe の中に置き、スクリプトと外部への通信は CSP と sandbox で止め、リンクと埋め込みの要素は外してあります（文字だけ残る）。</p>
${errorList}
</header>
<iframe sandbox="" title="${escapeHtml(row.menu)}" width="${width}" height="${height}" srcdoc="${escapeHtml(inner)}"></iframe>
</body></html>
`;
  return { menu: row.menu, fileName, pageSize: tags.pageSize, orientation: tags.orientation, dpi: String(tags.dpi), pages: pages.length, errors, webFont: null, removedStyles, inner, html: outer };
}
