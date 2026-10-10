/** preview: 行単位のレンダラー（失敗しても続ける）、ページ番号とダミー画像、sandbox の iframe + CSP、一覧帳票は対象外、--button */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "./helpers.mjs";
import { runPreview, extractRecord } from "../src/commands/preview.ts";
import { InputError } from "../src/commands/normalize.ts";
import { PREVIEW_CSP, PREVIEW_KEEP_TAGS, PREVIEW_WITHHELD, escapeHtml, previewContent, verifyPreviewHtml } from "../src/preview/render.ts";
import { FIELDS_FILE, aiSettings } from "./fixtures.mjs";

const engine = await loadEngine();
const v = (type, value) => ({ type, value });
const RECORD = {
  $id: v("RECORD_NUMBER", "3"),
  $revision: v("__REVISION__", "7"),
  宛名: v("SINGLE_LINE_TEXT", '□□□□株式会社 <b>&"\'</b>'),
  見積番号: v("SINGLE_LINE_TEXT", "S-0000003"),
  見積日: v("DATE", "2026-02-12"),
  小計金額: v("NUMBER", "7994000"),
  消費税: v("NUMBER", "799400"),
  合計金額: v("NUMBER", "8793400"),
  備考: v("MULTI_LINE_TEXT", "月額費用のお見積りです。<b>太字</b>\n合計3,000ユーザー"),
  担当者: v("USER_SELECT", [{ code: "authoring", name: "authoring" }]),
  見積ファイル: v("FILE", []),
  発行済み: v("CHECK_BOX", []),
  見積明細: v("SUBTABLE", [
    { id: "1", value: { 商品名: v("SINGLE_LINE_TEXT", "kintone ワイドコース"), 数量: v("NUMBER", "1"), 単価: v("NUMBER", "3000000"), 金額: v("CALC", "3000000") } },
    { id: "2", value: { 商品名: v("SINGLE_LINE_TEXT", "セキュアアクセス <script>x</script>"), 数量: v("NUMBER", "1000"), 単価: v("NUMBER", "250"), 金額: v("CALC", "250000") } }
  ])
};
const recordFile = { tool: "pcraft-authoring record", fetchedAt: "", baseUrl: "https://x.cybozu.com", appId: 3740, id: 3, record: RECORD };
const run = (settings, extra = {}) => runPreview({ settingsText: JSON.stringify(settings), settingsFile: "settings/見積書.json", fields: FIELDS_FILE, recordFile, engine, ...extra });

test("見積書のプレビュー: 1 ページ、sandbox の iframe、CSP、テーブルと値、##table## は置き換わる", async () => {
  const r = await run(aiSettings());
  assert.ok(!r.findings.hasErrors, r.findings.format());
  assert.equal(r.results.length, 1);
  const b = r.results[0];
  assert.equal(b.menu, "見積書");
  assert.equal(b.pages, 1);
  assert.deepEqual(b.errors, []);
  assert.equal(b.fileName, "見積書-S-0000003.pdf");
  assert.equal(b.file, "見積書.html");
  assert.ok(b.html.includes('<iframe sandbox="" '), "sandbox 属性だけの iframe");
  assert.ok(b.html.includes(`srcdoc="${escapeHtml("<!doctype html>")}`), "帳票は srcdoc");
  assert.ok(b.inner.includes(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`));
  assert.ok(b.inner.includes("□□□□株式会社 &lt;b&gt;&amp;"), "ESC_HTML の差し込み");
  assert.ok(b.inner.includes("kintone ワイドコース"), "TABLE_HTML の行");
  assert.ok(b.inner.includes("pcraft-inv-item-"), "TABLE_HTML の pref");
  assert.ok(!b.inner.includes("##table##"));
  assert.ok(b.inner.includes("rex0220-print-craft-page-css"), "印刷屋と同じページの基本 CSS");
  assert.ok(b.inner.includes("font-size: 16px; line-height: 1.5;"), "kintone の body と同じ文字の設定（line-height が無いと BIZ UD などで行が詰まる）");
  assert.ok(b.inner.includes("width: 794px"), "A4 96 dpi の幅");
  assert.match(r.summary, /プレビュー 1 件/);
});

test("ページ番号と添付ファイルの画像の置き換えタグ、\\ → &yen;", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  row.html = row.html.replace("##table##", '<p class="pn">#{&p} / #{&n}</p><img class="seal" width="10" src="#{&f(ABCDEF)}">##table## C:\\dir');
  const r = await run(s);
  const b = r.results[0];
  assert.deepEqual(b.errors, []);
  assert.ok(b.inner.includes('<p class="pn">1 / 1</p>'));
  assert.ok(/<img class="seal" width="10" src="data:image\/svg\+xml,/.test(b.inner), "ダミー画像");
  assert.ok(b.inner.includes("C:¥dir") || b.inner.includes("C:&yen;dir"));
});

test("式の失敗は赤字で埋めて続け、エラーに記録する", async () => {
  const s = aiSettings();
  const row = s.pluginInfos[0].tagsInfo.fieldsInfo[2];
  row.html = row.html.replace("見積書</div>", '見積書 ${NOFUNC(1)}</div><p>${ESC_HTML(宛名)}</p>');
  const r = await run(s);
  const b = r.results[0];
  assert.equal(b.errors.length, 1);
  assert.match(b.errors[0], /\$\{NOFUNC\(1\)\}/);
  assert.ok(b.inner.includes('<span class="pcraft-authoring-error">式のエラー: ${NOFUNC(1)}'));
  assert.ok(b.inner.includes("kintone ワイドコース"), "他の部分は描けている");
  assert.ok(b.html.includes('<ul class="errors">'));
});

test("一覧帳票は対象外、--button で絞る、設定にエラーがあれば描かない", async () => {
  const s = aiSettings();
  s.pluginInfos.push({ ...JSON.parse(JSON.stringify(s.pluginInfos[0])), menu: "一覧", list: true });
  const r = await run(s);
  assert.equal(r.results.length, 1);
  assert.deepEqual(r.skipped, ["一覧: 一覧帳票は 1 レコードのプレビューの対象外（段階 2）"]);
  const only = await run(s, { button: "見積書" });
  assert.equal(only.results.length, 1);
  const none = await run(s, { button: "無い" });
  assert.equal(none.results.length, 0);
  assert.ok(none.findings.items.some((f) => f.rule === "preview.button"));
  const bad = aiSettings({ PluginVersion: "5" });
  const rb = await run(bad);
  assert.ok(rb.findings.hasErrors);
  assert.equal(rb.results.length, 0);
});

test("preview の文書は閉じている: CSS の </style> で抜けられない、レコードの値の <a href> / <meta> / on* / <iframe> は外す、img-src は data: だけ", async () => {
  const s = aiSettings({ cssInfo: [{ state: true, name: "x", desc: "", css: '.a{color:red} </style><meta http-equiv="refresh" content="0;url=https://evil.example/"><style>.b{content:"<"}' }] });
  const rec = JSON.parse(JSON.stringify(recordFile));
  rec.record.見積明細.value[0].value.商品名.value = '<a href="https://evil.example/">link</a><img src="x" onerror="alert(1)"><meta http-equiv="refresh" content="0;url=https://evil.example/"><iframe src="https://evil.example/"></iframe><style></style><meta></style><span onclick="x()">t</span><a href="#top">in</a>';
  const r = await run(s, { recordFile: rec });
  assert.ok(!r.findings.hasErrors, r.findings.format());
  const inner = r.results[0].inner;
  assert.ok(!inner.includes("</style><meta"), "CSS から </style> で抜けられない");
  assert.ok(inner.includes("\\3c /style>") || inner.includes("\\3c /style&gt;"), "CSS の < はエスケープ");
  assert.ok(!/<meta http-equiv="refresh"/.test(inner), "meta refresh は外す");
  assert.ok(!/<iframe/.test(inner.replace(/<iframe sandbox=""/g, "")), "帳票の中の iframe は外す");
  assert.ok(!/onerror=|onclick=/.test(inner), "イベント属性は外す");
  assert.ok(!/href="https:\/\/evil/.test(inner), "外部へのリンクは外す");
  assert.ok(inner.includes('href="#top"'), "文書内のリンクは残る");
  assert.ok(inner.includes(">link</a>") && inner.includes("in</a>"), "リンクの文字は残る");
  assert.ok(!PREVIEW_CSP.includes("blob:"));
  assert.match(PREVIEW_CSP, /img-src data:;/);
});

const GOOGLE_FONT = { enabled: true, preset: "biz-udpmincho", family: "BIZ UDPMincho", cssUrl: "https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&display=swap" };
/** 外部参照を "allow" にした設定は、利用者が policy で承認する（印刷屋の除去は働かない。preview の掃除だけが守る） */
const ALLOW_REFS = { allowExternalRefs: ["settings/見積書.json"] };
/** 明細の 1 行目の商品名を value にしたレコード（TABLE_HTML でレコードの値が HTML として入る） */
const withItemName = (value) => {
  const rec = JSON.parse(JSON.stringify(recordFile));
  rec.record.見積明細.value[0].value.商品名.value = value;
  return rec;
};
/** 帳票の文書の body の中身（掃除した帳票の HTML。文書自身の <body> の後ろから） */
const bodyOf = (inner) => inner.slice(inner.indexOf("<body>") + "<body>".length);
/** <style> の中身（Chrome の RAWTEXT と同じく、最初の </style（後ろが空白・/・>）まで） */
const styleTexts = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)(?=<\/style[\t\n\f\r />]|$)/gi)].map((m) => m[1]);

test("レコードの値から作った CSS で外へ読み込まない（tools 2.0.1。Web フォントの配信元を CSP で許していても、<style> の @import・@font-face・外の url() と style 属性の外の url() は外す。外部参照が block でも allow でも。print-craft MCP の MCP App のレビュー BLOCKER 1）", async () => {
  const value = [
    '<style>@import url("https://fonts.googleapis.com/css2?family=LEAK1");.x{color:red}</style>',
    "<style>@font-face{font-family:y;src:url(https://fonts.gstatic.com/LEAK2)}</style>",
    "<style>@\\69mport url(https://fonts.googleapis.com/LEAK3);</style>",
    "<style>.z{background:\\75rl(https://fonts.gstatic.com/LEAK4)}</style>",
    '<span style="background:url(https://fonts.gstatic.com/LEAK5)">s</span>',
    '<style>@import "https://fonts.googleapis.com/LEAK7";</style>',
    '<i style="background-image:image-set(&quot;https://fonts.gstatic.com/LEAK8&quot; 1x)">i</i>',
    '<style>:root{--u:"https://fonts.gstatic.com/LEAK9"}.v{background-image:image-set(var(--u) 1x)}</style>',
    '<style>.w{background-image:image-set("https://fonts.gstatic.com/LEAK10" type(var(--m)))}</style>',
    '<b style="--u:&quot;https://fonts.gstatic.com/LEAK11&quot;;background-image:src(var(--u))">b</b>',
    "<style>.keep{color:blue}</style>",
    '<span style="color:green">g</span>',
    "<svg><style>@import url(https://fonts.googleapis.com/LEAK6);</style></svg>"
  ].join("");
  for (const externalRefs of ["block", "allow"]) {
    const r = await run(aiSettings({ externalRefs, fontInfo: GOOGLE_FONT }), { recordFile: withItemName(value), policy: ALLOW_REFS });
    assert.ok(!r.findings.hasErrors, r.findings.format());
    const b = r.results[0];
    assert.deepEqual(b.errors, [], externalRefs);
    const body = bodyOf(b.inner);
    for (const css of styleTexts(body)) assert.doesNotMatch(css, /@import|@font-face|url\(|image-set\(|src\(/i, `${externalRefs}: 外へ読み込む <style> を残さない: ${css}`);
    assert.doesNotMatch(body, /style="[^"]*(?:url\(|image-set\(|src\()/i, `${externalRefs}: 外へ読み込む style 属性を残さない`);
    assert.doesNotMatch(body, /LEAK(?:[1235678]|9|1[01])\b/, externalRefs);
    // \ は描く前に &yen; になる（印刷屋と同じ）ので、\75rl( は url( にならず文字として残る
    assert.ok(!body.includes("\\"), "\\ は残らない");
    assert.ok(!/LEAK4/.test(body) || body.includes("&yen;75rl(https://fonts.gstatic.com/LEAK4)"), externalRefs);
    assert.ok(body.includes("<style>.keep{color:blue}</style>"), `${externalRefs}: 読み込まない <style> は残す`);
    assert.match(body, /<span style="color:\s*green;?">g<\/span>/, `${externalRefs}: 読み込まない style 属性は残す`);
    assert.ok(b.inner.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPMincho'), "設定の Web フォントの <link>（固定の URL）は残る");
  }
});

test("happy-dom と Chrome で読み方の違う書き方（<!-->、<![CDATA[、<?、<noembed> の中の <!-- など）でも、掃除していない <style> や <link> はできない（tools 2.0.1）", async () => {
  const G = "https://fonts.googleapis.com/";
  const cases = [
    `<!--><style>@import url(${G}LEAKX1);</style>-->`,
    `<!---><style>@import url(${G}LEAKX2);</style>-->`,
    `<![CDATA[x--><style >@import url(${G}LEAKX3);</style>]]>`,
    `<!x--><style >@import url(${G}LEAKX4);</style>`,
    `<?x--><style >@import url(${G}LEAKX5);</style>`,
    `<!--x--!><style>@import url(${G}LEAKX6);</style>-->`,
    `<noembed><!--</noembed><style>@import url(${G}LEAKX7);</style>--></noembed>`,
    `<noframes><!--</noframes><link rel="stylesheet" href="${G}css2?family=LEAKX8">--></noframes>`,
    `<xmp><!--</xmp><style>@import url(${G}LEAKX9);</style>--></xmp>`,
    `<svg><![CDATA[x--><style >@import url(${G}LEAKX10);</style>]]></svg>`,
    `<svg><style>&#64;import "${G}LEAKX11";</style></svg>`,
    `<!--><link rel="preload" as="font" href="https://fonts.gstatic.com/LEAKX12">-->`,
    `<title><!--</title><style>@import url(${G}LEAKX13);</style>--></title>`,
    `<math><mtext><table><mglyph><style><img src=x>@import url(${G}LEAKX14);</style>`,
    // Chrome の木の構築が名前を変える（image → img）、noscript（sandbox の文書は scripting が無効で中を要素として読む）
    `<image src="https://fonts.gstatic.com/LEAKX15">`,
    `<noscript><style>@import url(${G}LEAKX16);</style></noscript>`,
    // 表の foster parenting、書式の要素の作り直し、html / body の属性の合流（happy-dom の断片では捨てられる）
    `<table><b style="color:red"><style>@import url(${G}LEAKX17);</style>x<td>y</table>`,
    `<a><table><a id="x">z<style>@import url(${G}LEAKX18);</style></a></table></a>`,
    `<body style="background:url(https://fonts.gstatic.com/LEAKX19)"><html style="background:url(https://fonts.gstatic.com/LEAKX20)">`
  ];
  for (const value of cases) {
    const r = await run(aiSettings({ externalRefs: "allow", fontInfo: GOOGLE_FONT }), { recordFile: withItemName(value), policy: ALLOW_REFS });
    assert.ok(!r.findings.hasErrors, r.findings.format());
    const b = r.results[0];
    assert.deepEqual(b.errors, [], value);
    const body = bodyOf(b.inner);
    assert.doesNotMatch(body, /<[!?]/, `注釈・CDATA・処理命令を残さない: ${value}`);
    assert.doesNotMatch(body, /<(?:svg|math|noembed|noframes|xmp|title|plaintext|link|meta|template|noscript|textarea|script|iframe|image|html|head|body)[\t\n\f\r />]/i, value);
    for (const css of styleTexts(body)) assert.doesNotMatch(css, /@import|@font-face|url\(|LEAKX/i, value);
    for (const [tag] of body.matchAll(/<[a-z][^>]*>/gi)) assert.ok(!tag.includes("LEAKX"), `${value}: ${tag}`);
  }
});

test("残す要素はテンプレートの検査と同じ一覧（PREVIEW_KEEP_TAGS）だけ。一覧に無い要素は外して中身を残し、中身も同じように掃除する（Codex の tools 2.0.1 のレビュー MAJOR 2）", async () => {
  assert.ok(!PREVIEW_KEEP_TAGS.has("iframe") && !PREVIEW_KEEP_TAGS.has("image") && PREVIEW_KEEP_TAGS.has("style") && PREVIEW_KEEP_TAGS.has("table"));
  const value = '<custom-el style="color:red">中身<span style="background:url(https://fonts.gstatic.com/LEAKY1)">s</span></custom-el><marquee>m<style>@import url(https://fonts.googleapis.com/LEAKY2);</style></marquee><image>画</image>';
  const r = await run(aiSettings({ externalRefs: "allow", fontInfo: GOOGLE_FONT }), { recordFile: withItemName(value), policy: ALLOW_REFS });
  const b = r.results[0];
  assert.deepEqual(b.errors, []);
  const body = bodyOf(b.inner);
  assert.doesNotMatch(body, /<(?:custom-el|marquee|image)[\t\n\f\r />]/i, "一覧に無い要素は残さない");
  assert.ok(body.includes("中身<span>s</span>m<style></style>画"), "中身は残し、中身の要素も掃除する");
  assert.doesNotMatch(body, /LEAKY/);
});

test("verifyPreviewHtml: 文字にした HTML を HTML の仕様の字句解析で読み直し、掃除した DOM と違えば理由を返す。previewContent は違えば帳票を出さない（tools 2.0.1）", () => {
  const t = (tag, attrs = [], text) => (text === undefined ? { tag, attrs } : { tag, attrs, text });
  assert.equal(verifyPreviewHtml('<p class="a">x &amp; y &lt;b&gt;</p><style>.a{}</style>', [t("p", [["class", "a"]]), t("style", [], ".a{}")]), null);
  assert.equal(verifyPreviewHtml('<p title="a&quot;b&amp;c<d>\r\ne">t</p>', [t("p", [["title", 'a"b&c<d>\ne']])]), null, "属性の < > はそのまま、&quot; &amp; は文字参照、CRLF は LF");
  assert.equal(verifyPreviewHtml('<br/><img src="data:image/png;base64,AA"><p title="x" / class="y"></p>', [t("br"), t("img", [["src", "data:image/png;base64,AA"]]), t("p", [["title", "x"], ["class", "y"]])]), null);
  assert.equal(verifyPreviewHtml("<style>a{}</stylex></style ><p></p>", [t("style", [], "a{}</stylex>"), t("p")]), "<style> の中に「<」がある", "</stylex は <style> の終わりでない");
  assert.equal(verifyPreviewHtml("<style>a{}</style ><p></p>", [t("style", [], "a{}"), t("p")]), null, "</style の後の空白で終わる");
  for (const html of ["<!--><style>@import url(https://fonts.googleapis.com/x)</style>-->", "<![CDATA[x]]>", "<?x>", "</ x>", "a < b", "<"]) assert.equal(verifyPreviewHtml(html, []), "タグでない「<」がある（注釈・CDATA・処理命令など）", html);
  for (const tag of ["noembed", "noframes", "xmp", "title", "textarea", "plaintext", "noscript", "script", "iframe", "svg", "math", "template", "select", "frameset", "image", "custom-el"]) assert.equal(verifyPreviewHtml(`<${tag}></${tag}>`, [t(tag)]), "残す一覧に無い要素がある（中身を文字として読む要素、SVG・MathML など）", tag);
  assert.equal(verifyPreviewHtml('<p title="a\u0000b"></p>', [t("p", [["title", "a\ufffdb"]])]), null, "NUL は U+FFFD（Chrome の入力の前処理と同じ）");
  assert.equal(verifyPreviewHtml('<p class="a" class="b"></p>', [t("p", [["class", "a"]])]), "属性が掃除した DOM と違う", "重複した属性（Chrome は後ろを捨てる）は止める");
  assert.equal(verifyPreviewHtml("<p></p><b></b>", [t("p"), t("i")]), "要素の並びが掃除した DOM と違う");
  assert.equal(verifyPreviewHtml("<p></p>", [t("p"), t("b")]), "要素の数が掃除した DOM と違う");
  assert.equal(verifyPreviewHtml('<p a="1" b="2"></p>', [t("p", [["a", "1"]])]), "属性が掃除した DOM と違う");
  assert.equal(verifyPreviewHtml('<p a="javascript&colon;x"></p>', [t("p", [["a", "javascript&colon;x"]])]), "属性が掃除した DOM と違う", "知らない文字参照（Chrome は : にする）");
  assert.equal(verifyPreviewHtml('<p class="a', [t("p", [["class", "a"]])]), "閉じていないタグがある");
  assert.equal(verifyPreviewHtml('<span style="background:url(https://fonts.gstatic.com/x)"></span>', [t("span", [["style", "background:url(https://fonts.gstatic.com/x)"]])]), "style 属性が外へ読み込む");
  assert.equal(verifyPreviewHtml("<style>@import url(https://fonts.googleapis.com/x);</style>", [t("style", [], "@import url(https://fonts.googleapis.com/x);")]), "<style> が外へ読み込む");
  assert.equal(verifyPreviewHtml("<style>a{}</style>", [t("style", [], "b{}")]), "<style> の中身が掃除した DOM と違う");
  // previewContent: 確かめが通らなければ、帳票の代わりに決まった文
  const fake = (innerHTML, elements = []) => ({ innerHTML, querySelectorAll: () => elements });
  assert.deepEqual(previewContent(fake("<!--><style>@import url(https://fonts.googleapis.com/x)</style>-->")), { content: PREVIEW_WITHHELD, mismatch: "タグでない「<」がある（注釈・CDATA・処理命令など）" });
  assert.deepEqual(previewContent(fake("<b>ok</b>", [{ tagName: "B", attributes: [], textContent: "ok" }])), { content: "<b>ok</b>", mismatch: null });
});

test("Web フォント: 承認済み（Google Fonts は既定）なら帳票の文書に <link> と CSP の配信元、未承認なら読まない（OS の書体）、policy で承認すれば読む", async () => {
  const google = aiSettings({ fontInfo: { enabled: true, preset: "biz-udpmincho", family: "BIZ UDPMincho", cssUrl: "https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&display=swap" } });
  const r = await run(google);
  assert.ok(!r.findings.hasErrors, r.findings.format());
  const b = r.results[0];
  assert.equal(b.webFont, "https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&display=swap");
  assert.ok(b.inner.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPMincho:wght@400;700&amp;display=swap">'), "帳票の文書に <link>");
  assert.ok(b.inner.includes("style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.googleapis.com https://fonts.gstatic.com;"), "CSP に CSS とフォント本体の配信元");
  assert.ok(b.inner.includes('"BIZ UDPMincho"'), "ページの CSS に font-family");
  assert.ok(b.html.includes("承認済み") && b.html.includes("BIZ UDPMincho"), "ヘッダーの注記");
  assert.ok(!b.inner.includes("connect-src 'self'") && b.inner.includes("connect-src 'none'"), "通信の許可はフォントだけ");
  // 未承認の配信元 → 読まない（normalize は警告 external.url。preview は止まらない）
  const other = aiSettings({ fontInfo: { enabled: true, preset: "custom", family: "My Font", cssUrl: "https://fonts.example.com/my.css" } });
  const r2 = await run(other);
  assert.ok(!r2.findings.hasErrors, r2.findings.format());
  assert.ok(r2.findings.items.some((f) => f.rule === "external.url"));
  const b2 = r2.results[0];
  assert.equal(b2.webFont, null);
  assert.ok(!b2.inner.includes("<link"), "未承認は <link> を入れない");
  assert.ok(b2.inner.includes(`content="${PREVIEW_CSP}"`), "CSP は基本のまま");
  assert.ok(b2.html.includes("未承認"), "ヘッダーの注記");
  // policy で承認 → 読む（その他の配信元は CSS とフォント本体に同じ origin）
  const r3 = await run(other, { policy: { allowExternal: [{ origin: "https://fonts.example.com" }] } });
  const b3 = r3.results[0];
  assert.equal(b3.webFont, "https://fonts.example.com/my.css");
  assert.ok(b3.inner.includes('<link rel="stylesheet" href="https://fonts.example.com/my.css">'));
  assert.ok(b3.inner.includes("style-src 'unsafe-inline' https://fonts.example.com; font-src data: https://fonts.example.com;"));
  // Web フォント無し → <link> も配信元も無し
  const none = await run(aiSettings());
  assert.equal(none.results[0].webFont, null);
  assert.ok(!none.results[0].inner.includes("<link") && none.results[0].html.includes("Web フォントは使いません"));
});

test("extractRecord: record コマンドの出力、API の応答、レコードそのもの", () => {
  assert.equal(extractRecord(recordFile), RECORD);
  assert.equal(extractRecord({ record: RECORD }), RECORD);
  assert.equal(extractRecord(RECORD), RECORD);
  assert.throws(() => extractRecord({ foo: 1 }), (e) => e instanceof InputError && /形が分からない/.test(e.message), "入力の誤り（決まった文）");
  assert.throws(() => extractRecord(null), InputError);
});

test("検査でエラーがある設定は描かない（例外で止まらず findings のエラーを返す。不正な用紙の大きさ）", async () => {
  const base = aiSettings();
  const r = await run({ ...base, pluginInfos: [{ ...base.pluginInfos[0], tagsInfo: { ...base.pluginInfos[0].tagsInfo, pageSize: "X9" } }] });
  assert.ok(r.findings.hasErrors);
  assert.ok(r.findings.items.some((f) => f.level === "error" && /pageSize/.test(f.rule)));
  assert.deepEqual(r.results, []);
});
