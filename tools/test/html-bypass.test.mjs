/**
 * HTML / CSS の検査の抜け道（1-10 のレビューで足した。Chrome の URL / CSS の解釈と検査の分類がずれる書き方）。
 *   - Chrome の URL パーサーはタブ・改行を捨て、先頭と末尾の制御文字と空白を外す → java<TAB>script: は javascript:
 *   - 特別なスキームでは \ を / と扱う → \\evil.example.com/x はスキーム相対の外部 URL
 *   - CSS はエスケープで識別子を書ける → \75rl( は url(、@\69mport は @import（16 進は 6 桁まで続くので "\73 cript" のように空白で切る）
 *   - インラインの SVG（SMIL の animate / set、foreignObject、xlink:href …）は要素ごと使えない
 *   - happy-dom は iframe / xmp などの中の要素を Chrome と同じか、それより厳しく（要素として）読む（検査が走査する）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, classifyUrl, cleanUrl, parseSrcsetUrls } from "../src/normalize/css-check.ts";
import { checkHtml } from "../src/normalize/html-check.ts";

test("classifyUrl: タブ・改行・制御文字を捨てて判定する（Chrome の URL パーサーと同じ）", () => {
  assert.equal(classifyUrl("java\tscript:alert(1)"), "bad");
  assert.equal(classifyUrl("java\nscript:alert(1)"), "bad");
  assert.equal(classifyUrl("JAVA\r\nSCRIPT:alert(1)"), "bad");
  assert.equal(classifyUrl("\u0001javascript:alert(1)"), "bad");
  assert.equal(classifyUrl(" \t https://ok.example.com/a.png \n"), "https");
  assert.equal(classifyUrl("ht\ttps://ok.example.com/a.png"), "https");
  assert.equal(cleanUrl(" 'ht\ttps://ok.example.com/a.png' "), "https://ok.example.com/a.png");
  assert.equal(classifyUrl("data:image/svg+xml;base64,AAAA"), "data-svg");
  assert.equal(classifyUrl("data:image/png;base64,AAAA"), "data-image");
  assert.equal(classifyUrl("data:image/png"), "bad", "; か , が続かない data: は不正");
  assert.equal(classifyUrl("#{&f(KEY)}"), "placeholder");
  assert.equal(classifyUrl("#{&x(KEY)}"), "bad", "置き換えタグの形でない #{& は不正");
});

test("classifyUrl: バックスラッシュのスキーム相対 URL は外部（bad）", () => {
  assert.equal(classifyUrl("\\\\evil.example.com/x"), "bad");
  assert.equal(classifyUrl("/\\evil.example.com/x"), "bad");
  assert.equal(classifyUrl("\\/evil.example.com/x"), "bad");
  assert.equal(classifyUrl("//evil.example.com/x"), "bad");
  assert.equal(classifyUrl("images/a.png"), "relative");
  assert.equal(classifyUrl("/k/v1/file.json?fileKey=x"), "relative");
});

test("parseSrcsetUrls: data: URL の中の , で壊れず、記述子を読み飛ばす", () => {
  assert.deepEqual(parseSrcsetUrls("a.png 1x, b.png 2x"), ["a.png", "b.png"]);
  assert.deepEqual(parseSrcsetUrls("data:image/png;base64,AAAA 1x, https://s.example.com/a.png 2x"), ["data:image/png;base64,AAAA", "https://s.example.com/a.png"]);
  assert.deepEqual(parseSrcsetUrls("x.png, javascript:alert(1) 2x"), ["x.png", "javascript:alert(1)"]);
  assert.deepEqual(parseSrcsetUrls("  "), []);
});

test("checkCss: エスケープで隠した url( / @import / javascript: / expression( を見つける", () => {
  const r1 = checkCss(".a{background:\\75rl(https://evil.example.com/a.png)}");
  assert.deepEqual(r1.externals.map((u) => u.url), ["https://evil.example.com/a.png"]);
  const r2 = checkCss("@\\69mport url(x.css); .b{c:d}");
  assert.ok(r2.errors.some((e) => e.includes("@import")), r2.errors.join("\n"));
  const r3 = checkCss('.c{background:url("java\\73 cript:alert(1)")}');
  assert.ok(r3.errors.some((e) => e.includes("使えない形")), r3.errors.join("\n"));
  const r4 = checkCss(".d{width:e\\78pression(1)}");
  assert.ok(r4.errors.some((e) => e.includes("expression(")), r4.errors.join("\n"));
  // コメントは先に外す（エスケープで /* を作っても注釈にならない）
  const r5 = checkCss("/* \\75rl(https://a.example.com/x) */ .e{background:url(https://b.example.com/y)}");
  assert.deepEqual(r5.externals.map((u) => u.url), ["https://b.example.com/y"]);
  const r6 = checkCss(".f{b:\\2f\\2a} .g{background:url(https://c.example.com/z)}");
  assert.deepEqual(r6.externals.map((u) => u.url), ["https://c.example.com/z"]);
  // url() 以外で URL を持てる関数
  const r7 = checkCss('.h{background:image("https://d.example.com/i.png")} .i{background:-webkit-image-set("https://e.example.com/j.png" 1x)} @font-face{src:src("https://f.example.com/k.woff2")}');
  assert.deepEqual(r7.externals.map((u) => u.url).sort(), ["https://d.example.com/i.png", "https://e.example.com/j.png", "https://f.example.com/k.woff2"]);
});

test("checkCss: 16 進エスケープの終端の改行・CR・FF・CRLF を仕様どおり 1 つ消費する（\\75<改行>rl( は url(）", () => {
  for (const css of [".x{background:\\75\nrl(https://evil.example/pixel)}", ".x{background:\\75\r\nrl(https://evil.example/pixel)}", ".x{background:\\75\frl(https://evil.example/pixel)}", ".x{background:\\000075\nrl(https://evil.example/pixel)}", ".x{background:\\75\rrl(https://evil.example/pixel)}"]) {
    const r = checkCss(css);
    assert.deepEqual(r.externals.map((u) => u.url), ["https://evil.example/pixel"], JSON.stringify(css));
  }
  assert.ok(checkCss("@\\69\nmport \"https://evil.example/x.css\";").errors.some((e) => e.includes("@import")));
  const attr = checkCss("x{background:\\75\nrl(https://evil.example/a.png)}");
  assert.equal(attr.externals.length, 1, "style 属性と同じ形でも拾う");
});

test("checkCss: 文字列の中の url( / @import / expression( は禁止構文や外部 URL と見ない（content の文言など）", () => {
  const r = checkCss('.note::before { content: "url(https://example.com) @import expression("; }');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.externals, []);
  const r2 = checkCss(".a{background:url(\"https://ok.example.com/x.png\")} .b::after{content:\"@import\"}");
  assert.deepEqual(r2.errors, []);
  assert.deepEqual(r2.externals.map((u) => u.url), ["https://ok.example.com/x.png"], "url() の引用符付きの文字列は URL として拾う");
});

test("checkHtml: href の中のタブや \\\\、エンティティで書いた javascript:、srcset の \\\\ を止める。style の \\75rl( は外部 URL として拾う", async () => {
  const r = await checkHtml(`
    <a href="java\tscript:alert(1)">a</a>
    <a href="\\\\evil.example.com/x">b</a>
    <a href="&#106;avascript:alert(1)">c</a>
    <a href="data:text/html,x">d</a>
    <a href="data:image/png;base64,AA">e</a>
    <img src="x" srcset="x.png 1x, \\\\evil.example.com/y.png 2x">
    <div style="background:\\75rl(https://evil.example.com/bg.png)">e</div>
  `);
  const e = r.errors.join("\n");
  assert.equal(r.errors.filter((m) => m.includes("href の URL が使えない形: javascript:alert(1)")).length, 2, e);
  assert.match(e, /href の URL が使えない形: \\\\evil/);
  assert.match(e, /href の URL が使えない形: data:text/);
  assert.match(e, /href に data: は使えない/);
  assert.match(e, /srcset の URL が使えない形: \\\\evil/);
  assert.deepEqual(r.externals.map((u) => u.url), ["https://evil.example.com/bg.png"]);
});

test("checkHtml: インラインの SVG と MathML は要素ごと使えない（SMIL / foreignObject / xlink:href の経路を残さない）", async () => {
  for (const html of [
    '<svg><a href="#x"><animate attributeName="href" values="javascript:alert(1)"/>d</a></svg>',
    '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
    "<svg><title><img src=x onerror=alert(1)></title></svg>",
    "<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>",
    '<svg><use xlink:href="javascript:alert(1)"></use></svg>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'
  ]) {
    const r = await checkHtml(html);
    assert.ok(r.errors.some((m) => /<(svg|math)> は使えない/.test(m)), `${html}: ${r.errors.join(" / ")}`);
  }
  const img = await checkHtml('<img src="data:image/svg+xml;base64,AAAA" width="10">');
  assert.deepEqual(img.errors, [], "図は <img src=\"data:image/svg+xml,…\"> で入れる");
});

test("checkHtml: iframe / xmp / title / noscript の中の要素も走査する（happy-dom は要素として読む。Chrome ならただの文字）", async () => {
  for (const html of [
    "<iframe><img src=x onerror=alert(1)></iframe>",
    "<xmp><img src=x onerror=alert(1)></xmp>",
    "<p><img src=x ONERROR=alert(1)></p>"
  ]) {
    const r = await checkHtml(html);
    assert.ok(r.errors.some((e) => e.includes("onerror 属性") || e.includes("は使えない")), `${html}: ${r.errors.join(" / ")}`);
  }
});

test("checkHtml: 許可の一覧に無い要素と属性はエラー（警告で通さない）", async () => {
  const r = await checkHtml('<marquee>x</marquee><details><summary>y</summary></details><p contenteditable="true" draggable="true">z</p><video src="https://v.example.com/a.mp4"></video>');
  const e = r.errors.join("\n");
  assert.match(e, /<marquee> は使えない/);
  assert.match(e, /<details> は使えない/);
  assert.match(e, /contenteditable 属性は使えない/);
  assert.match(e, /draggable 属性は使えない/);
  assert.match(e, /<video> は使えない/);
  assert.deepEqual(r.externals, [], "使えない要素の URL は外部 URL として拾わない");
  const ok = await checkHtml('<table border="1" cellpadding="2"><tr><td colspan="2" align="right" data-x="1" aria-label="a">x</td></tr></table><img src="a.png" alt="" width="10" height="10" loading="lazy">');
  assert.deepEqual(ok.errors, []);
});
