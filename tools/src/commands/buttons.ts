/**
 * buttons <settings.json> [--button <名前>]
 * 設定 JSON（封筒形式。normalize の前でも後でも）のボタンを 1 ボタン数行で一覧にする。--button でそのボタンの HTML 設定と更新項目の中身を出す
 * （data: の URL は先頭と長さだけ。ファイルには元のまま）。通信しない・印刷屋の zip を読まない。
 * 既存の設定（数十 KB。社印の data URL を含む）を AI が丸ごと読まずに済むように（2026-10-05、試用の納品書の計測で AI が node -e で同じ一覧を作っていた）
 */

interface TagRowLike {
  state?: boolean;
  desc?: string;
  fieldcode?: string;
  formulaSet?: string;
  formula?: string;
  html?: string;
  css?: string;
  remark?: string;
}

interface CalcRowLike {
  state?: boolean;
  fieldcode?: string;
  formulaSet?: string;
  remark?: string;
}

interface ButtonLike {
  state?: boolean;
  menu?: string;
  list?: boolean;
  viewsCsv?: string;
  authority?: boolean;
  tagsInfo?: { fieldsInfo?: TagRowLike[]; filecode?: string; pageSize?: string; orientation?: string; dpi?: string; printMode?: string };
  calcInfo?: { fieldsInfo?: CalcRowLike[] };
  [key: string]: unknown;
}

export class ButtonNotFoundError extends Error {}

const kb = (v: unknown): string => `${(Buffer.byteLength(JSON.stringify(v) ?? "", "utf8") / 1024).toFixed(1)} KB`;
const oneLine = (s: string, max = 160): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const chars = (s: string | undefined): number => [...(s ?? "")].length;

/** data: の URL を先頭と長さだけにする（社印の SVG などで数 KB〜数十 KB になる） */
export function shortenDataUrls(s: string): string {
  return s.replace(/data:[^"'\s)<>]{120,}/g, (m) => `${m.slice(0, 40)}…（data URL ${m.length.toLocaleString()} 文字）`);
}

/**
 * ボタンを出す画面（印刷屋の shared/rows.ts と同じ判定）。viewsCsv が空ならすべて、"-" は詳細画面、数字は一覧の ID。
 * 一覧帳票でないボタンが一覧画面に出ると、表示中のレコードを 1 件ずつ PDF にする一括処理になる
 */
function screensOf(b: ButtonLike): string {
  const ids = (b.viewsCsv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const lists = ids.filter((x) => x !== "-");
  const listText = ids.length === 0 ? "すべての一覧" : lists.length ? `一覧 ${lists.join(",")}` : "";
  if (b.list) return `一覧帳票（${listText || "どの一覧にも出ない"}）`;
  const detail = ids.length === 0 || ids.includes("-");
  return [detail ? "詳細画面" : "", listText ? `${listText}で一括処理` : ""].filter(Boolean).join(" + ") || "どの画面にも出ない";
}

function headline(b: ButtonLike, i: number): string {
  const t = b.tagsInfo ?? {};
  const parts = [
    b.state ? "有効" : "無効",
    screensOf(b),
    t.filecode ? `保存先 ${t.filecode}` : "保存先なし（ダウンロード）",
    `${t.pageSize ?? "?"} ${t.orientation === "l" ? "横" : t.orientation === "p" ? "縦" : t.orientation ?? "?"} ${t.dpi ?? "?"} dpi`,
    `押したとき ${t.printMode ?? "preview"}`,
    ...(b.authority ? ["権限で絞る"] : []),
    kb(b)
  ];
  return `${i + 1}. ${b.menu ?? "(名前なし)"}（${parts.join("、")}）`;
}

function overview(b: ButtonLike): string[] {
  const rows = b.tagsInfo?.fieldsInfo ?? [];
  const [out, fname, ...body] = rows;
  const lines: string[] = [];
  lines.push(`   表示条件: ${out ? (out.state && out.formulaSet?.trim() ? oneLine(out.formulaSet) : "なし（常に出す）") : "（1 行目が無い）"}`);
  lines.push(`   ファイル名: ${fname ? (fname.state && fname.formulaSet?.trim() ? oneLine(fname.formulaSet) : "なし") : "（2 行目が無い）"}`);
  const bodies = body.map((r, j) => `${j + 3} 行目 ${r.desc || "(説明なし)"}${r.state ? "" : "（無効）"}: HTML ${chars(r.html).toLocaleString()} 文字、CSS ${chars(r.css).toLocaleString()} 文字、計算式 ${(r.formulaSet ?? "").trim() ? (r.formulaSet ?? "").split("\n").length : 0} 行`);
  lines.push(`   帳票: ${bodies.length ? bodies.join(" / ") : "なし"}`);
  const calc = (b.calcInfo?.fieldsInfo ?? []).filter((c) => c.fieldcode !== "$out");
  lines.push(`   更新項目: ${calc.length ? calc.map((c) => `${c.fieldcode}${c.state ? "" : "（無効）"}`).join(", ") : "なし"}`);
  return lines;
}

function detail(b: ButtonLike, i: number): string[] {
  const lines = [headline(b, i)];
  for (const k of ["menu_en", "menu_ja", "menu_zh", "desc", "desc_en", "desc_ja", "desc_zh", "remark", "users", "organizations", "groups", "guest"]) {
    const v = b[k];
    if (typeof v === "string" && v) lines.push(`${k}: ${oneLine(v, 400)}`);
  }
  for (const [j, r] of (b.tagsInfo?.fieldsInfo ?? []).entries()) {
    const role = j === 0 ? "$out ボタン表示条件" : j === 1 ? "$fname ファイル名" : "帳票";
    lines.push(`--- HTML 設定 ${j + 1} 行目 ${role}（${r.state ? "有効" : "無効"}）${r.desc ? ` ${r.desc}` : ""}${r.remark ? ` 備考: ${oneLine(r.remark, 200)}` : ""}`);
    // 1・2 行目の css は設定画面が見出しを入れる欄（dialogs.ts の buildTagRows）。html も使わない
    if (j >= 2 && r.css) lines.push("CSS:", shortenDataUrls(r.css));
    if (j >= 2 && r.html) lines.push("HTML:", shortenDataUrls(r.html));
    if (r.formulaSet) lines.push("計算式:", shortenDataUrls(r.formulaSet));
  }
  const calc = b.calcInfo?.fieldsInfo ?? [];
  lines.push(`--- 更新項目 ${calc.length ? `${calc.length} 行` : "なし"}`);
  for (const [j, c] of calc.entries()) lines.push(`${j + 1} 行目 ${c.fieldcode}（${c.state ? "有効" : "無効"}）: ${shortenDataUrls(c.formulaSet ?? "")}${c.remark ? `  備考: ${oneLine(c.remark, 200)}` : ""}`);
  return lines;
}

export interface ButtonsOptions {
  /** 画面に出すファイル名 */
  file: string;
  /** この名前のボタンの中身を出す（同じ名前が複数あればすべて） */
  button?: string;
}

export function listButtons(settings: Record<string, unknown>, opt: ButtonsOptions): string {
  const buttons = (Array.isArray(settings.pluginInfos) ? settings.pluginInfos : []) as ButtonLike[];
  if (opt.button !== undefined) {
    const hits = buttons.map((b, i) => ({ b, i })).filter(({ b }) => b.menu === opt.button);
    if (!hits.length) throw new ButtonNotFoundError(`ボタン「${opt.button}」は ${opt.file} に無い（${buttons.map((b) => b.menu).join(", ") || "ボタンなし"}）`);
    return [...hits.flatMap(({ b, i }) => detail(b, i)), "（data: の URL は先頭と長さだけ。ファイルには元のまま）"].join("\n");
  }
  const normalized = buttons.some((b) => (b.tagsInfo?.fieldsInfo ?? []).some((r) => typeof r.formula === "string"));
  const font = settings.fontInfo as { enabled?: boolean; family?: string } | undefined;
  const css = Array.isArray(settings.cssInfo) ? settings.cssInfo.length : 0;
  const ext = settings.externalRefs;
  const header = [
    settings.appId !== undefined ? `アプリ ${String(settings.appId)} ${typeof settings.appName === "string" ? settings.appName : ""}`.trim() : "アプリ不明",
    `ボタン ${buttons.length}（有効 ${buttons.filter((b) => b.state).length}）`,
    `外部参照 ${ext === "block" || ext === "allow" ? ext : ext === undefined ? "キー無し（印刷屋は allow で動く）" : JSON.stringify(ext)}`,
    `共通 CSS ${settings.commonCssEnable === false ? "無効" : css ? `${css} 行` : "既定（省略）"}`,
    `Web フォント ${font?.enabled ? font.family ?? "有効" : "なし"}`,
    normalized ? "派生値あり（normalize 済み）" : "派生値なし",
    kb(settings)
  ];
  const lines = [`${opt.file}（${header.join("、")}）`];
  for (const [i, b] of buttons.entries()) lines.push(headline(b, i), ...overview(b));
  lines.push("中身は --button <名前>");
  return lines.join("\n");
}
