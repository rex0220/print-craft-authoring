/**
 * 帳票 HTML のプレビュー（docs/authoring-plan.md 12.2 の preview、Codex BLOCKER 1 / MAJOR 4 の反映。1-10 レビュー BLOCKER 4）。印刷屋のコードは API（engine.api）から。
 *   - CSS は印刷屋と同じ buildReportCss（ページの基本 → 共通 CSS → 行の CSS）。文書に入れる前に `<` を CSS のエスケープ（\3c）にして、CSS から </style> で抜けられないようにする
 *   - HTML は authoring 専用の行単位レンダラー: ${式} ごと・行の計算式ごとに catch し、失敗した式はエスケープして赤字で埋めて続ける
 *   - #{&f(…)} / #{&q(…)} はダミー画像、#{&p} / #{&n} はページ番号（印刷屋の replaceTags を happy-dom の DOM で動かす）
 *   - 描いた DOM から、動きや通信や遷移の元になる要素と属性を外す（script / meta / link / form / iframe / SMIL …、on*、href、srcdoc …）。
 *     レコードの値が TABLE_HTML などで HTML として入る経路があるため、テンプレートの検査（html-check）とは別にここでも外す
 *   - 出力は 2 層の HTML: 外側の文書の中に sandbox 属性だけの iframe を置き、帳票の文書を srcdoc で入れる。帳票の文書にも CSP（img は data: だけ）
 */
import type { PrintCraftAuthoringApi } from "print-craft/src/authoring/api.ts";
import type { MenuRow, TagRow } from "print-craft/src/config/schema.ts";
import type { Engine, FormulaInstance } from "../engine.ts";
import type { Model } from "../normalize/model.ts";
import type { KintoneRecord } from "../commands/record.ts";

export const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const OUTER_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'";

/** プレビューの DOM から外す要素（動き・通信・遷移の元。描画には要らない） */
export const PREVIEW_REMOVE_SELECTOR = "script,meta,link,base,form,input,button,select,textarea,iframe,frame,object,embed,applet,noscript,template,video,audio,source,track,canvas,map,area,animate,animatemotion,animatetransform,animatecolor,set,foreignobject,math";
/** プレビューの DOM から外す属性 */
const REMOVE_ATTRS = new Set(["srcdoc", "formaction", "action", "ping", "target", "download", "background", "poster", "manifest"]);

const PAGES_CSS = `body { margin: 0; background: #f7f7f7; }
.xp-rex0220-print-craft-overlay-pages { display: block; width: fit-content; font-size: 16px; font-family: "メイリオ", Meiryo, "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN W3", "ＭＳ Ｐゴシック", "Lucida Grande", "Lucida Sans Unicode", Arial, Verdana, sans-serif; -webkit-text-size-adjust: 100%; }
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

interface DomElement {
  tagName: string;
  attributes: ArrayLike<{ name: string; value: string }>;
  textContent: string | null;
  innerHTML: string;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  removeAttribute(name: string): void;
  remove(): void;
}

/** 描いた DOM から動き・通信・遷移の元を外す。外した数を返す */
export function sanitizePreviewDom(host: DomElement): { removedElements: number; removedAttributes: number } {
  let removedElements = 0;
  let removedAttributes = 0;
  for (const el of Array.from(host.querySelectorAll(PREVIEW_REMOVE_SELECTOR))) {
    el.remove();
    removedElements++;
  }
  for (const el of Array.from(host.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) {
      const name = a.name.toLowerCase();
      const value = String(a.value ?? "").replace(/[\t\n\r]/g, "").trim();
      const isLink = name === "href" || name === "xlink:href";
      if (name.startsWith("on") || REMOVE_ATTRS.has(name) || (isLink && !value.startsWith("#")) || /^[\u0000- ]*javascript:/i.test(value)) {
        el.removeAttribute(a.name);
        removedAttributes++;
      }
    }
    if (el.tagName.toLowerCase() === "style") el.textContent = escapeCssText(el.textContent ?? "");
  }
  return { removedElements, removedAttributes };
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
  const css = api.buildReportCss(body as Parameters<PrintCraftAuthoringApi["buildReportCss"]>[0], row, paper.scr, font);
  const html = renderRows(api, row, record, kf, errors);

  const doc = (engine.window as { document: Document }).document;
  const host = doc.createElement("div");
  // 印刷屋 Ver.6 の mountReportHtml は既定で kintone 以外への読み込みとスクリプトを除く（共通の設定「外部参照」が "allow" なら除かない）。
  // プレビューも同じにする（happy-dom の origin は authoring.local なので、kintone の URL も「外部」になる。帳票の iframe は下の sanitizePreviewDom が外す）
  const pages = api.mountReportHtml(host as unknown as HTMLElement, html, { sanitize: body.externalRefs !== "allow" });
  api.replaceTags(pages, {}, {}, api.DUMMY_IMAGE);
  if (pages.length === 0) errors.push("ページ要素（class=\"rex0220-pcraft-page\"）が無い。印刷屋は 0 ページの PDF を作る");
  sanitizePreviewDom(host as unknown as DomElement);
  const inner = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<title>${escapeHtml(row.menu)}</title>
<style>${PAGES_CSS}</style>
<style class="xp-rex0220-print-craft-page-style">${escapeCssText(css)}</style>
</head><body><div class="xp-rex0220-print-craft-overlay-pages">${host.innerHTML}</div></body></html>`;

  const width = paper.scr.width + 40;
  const height = Math.max(1, pages.length) * (paper.scr.height + 40) + 40;
  const errorList = errors.length ? `<ul class="errors">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
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
<p>これは近似のプレビューです。添付ファイルの画像と QR はダミー、Web フォントは読みません（OS の書体で代替）。PDF の見た目は印刷屋プラグインで確かめてください。帳票は sandbox の iframe の中に置き、スクリプトと外部への通信は CSP と sandbox で止め、リンクと埋め込みの要素は外してあります（文字だけ残る）。</p>
${errorList}
</header>
<iframe sandbox="" title="${escapeHtml(row.menu)}" width="${width}" height="${height}" srcdoc="${escapeHtml(inner)}"></iframe>
</body></html>
`;
  return { menu: row.menu, fileName, pageSize: tags.pageSize, orientation: tags.orientation, dpi: String(tags.dpi), pages: pages.length, errors, inner, html: outer };
}
