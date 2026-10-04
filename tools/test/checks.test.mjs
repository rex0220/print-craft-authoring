/** HTML / CSS の検査と承認（policy）の単体テスト */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, classifyUrl, extractUrls, stripCssComments } from "../src/normalize/css-check.ts";
import { checkHtml, expressionsOf } from "../src/normalize/html-check.ts";
import { isAllowed } from "../src/normalize/policy.ts";

test("classifyUrl: 置き換えタグ、data:image、https、相対、使えないもの", () => {
  assert.equal(classifyUrl("#{&f(2025ABC)}"), "placeholder");
  assert.equal(classifyUrl("#{&q(https://a)}"), "placeholder");
  assert.equal(classifyUrl("data:image/png;base64,AAAA"), "data-image");
  assert.equal(classifyUrl(" 'https://x.example.com/a.png' "), "https");
  assert.equal(classifyUrl("img/a.png"), "relative");
  assert.equal(classifyUrl("#top"), "fragment");
  assert.equal(classifyUrl("javascript:alert(1)"), "bad");
  assert.equal(classifyUrl("JavaScript:alert(1)"), "bad");
  assert.equal(classifyUrl("data:text/html,<script>"), "bad");
  assert.equal(classifyUrl("http://plain.example.com/a.png"), "bad");
  assert.equal(classifyUrl("//cdn.example.com/a.png"), "bad");
  assert.equal(classifyUrl("vbscript:x"), "bad");
});

test("CSS: コメントと文字列を区別して url() / image-set / @import を拾う。#{&f(…)} は )} まで", () => {
  assert.equal(stripCssComments('a{content:"/* not */"} /* c */ b{}'), 'a{content:"/* not */"}   b{}');
  const urls = extractUrls(`.a{background:url(#{&f(2025ABC)}) no-repeat}
    .b{background-image:url("https://cdn.example.com/x.png")}
    .c{background:image-set("https://cdn.example.com/y.png" 1x, 'z.png' 2x)}
    /* url(https://comment.example.com) */
    @import "https://imp.example.com/a.css";`);
  assert.deepEqual(urls.map((u) => [u.url, u.via]), [
    ["#{&f(2025ABC)}", "url()"],
    ["https://cdn.example.com/x.png", "url()"],
    ["https://cdn.example.com/y.png", "image-set"],
    ["z.png", "image-set"],
    ["https://imp.example.com/a.css", "@import"]
  ]);
  const r = checkCss(`@import url(x.css); .a{width:expression(1)} .b{background:url(javascript:x)} .c{background:url(https://ok.example.com/a.png)}`);
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.externals.map((u) => u.url), ["https://ok.example.com/a.png"]);
  assert.deepEqual(checkCss(".x{color:red}").errors, []);
});

test("HTML: 禁止の要素と属性、属性値の ${式}、URL の形、style の url()、iframe のオリジン、外部 URL の収集", async () => {
  const r = await checkHtml(
    `<div class="a" style="background:url(https://bg.example.com/x.png)" onload="x()">
       <script>1</script><object data="x"></object><base href="/">
       <img src="data:image/png;base64,AA" srcset="https://s.example.com/a.png 1x, javascript:alert(1) 2x">
       <a href="https://link.example.com/">l</a>
       <p title="\${宛名}">t</p>
       <svg><use xlink:href="javascript:alert(1)"></use><image href="#{&f(KEY)}"></image></svg>
       <iframe src="https://x.cybozu.com/k/1/report/portlet?report=2"></iframe>
       <iframe src="https://y.cybozu.com/k/1/report/portlet?report=2"></iframe>
       <iframe srcdoc="<script>1</script>"></iframe>
       <style>.q{background:url(https://st.example.com/a.png)} @import "b.css";</style>
       <form><input></form>
     </div>`,
    { baseUrl: "https://x.cybozu.com" }
  );
  const e = r.errors.join("\n");
  assert.match(e, /onload/);
  assert.match(e, /<script>/);
  assert.match(e, /<object>/);
  assert.match(e, /<base>/);
  assert.match(e, /srcset の URL が使えない形: javascript/);
  assert.match(e, /属性値に \$\{式\}/);
  assert.match(e, /xlink:href の URL が使えない形/);
  assert.match(e, /iframe の src は利用者の kintone/);
  assert.match(e, /srcdoc/);
  assert.match(e, /<style>: @import/);
  assert.match(e, /<form>/);
  assert.equal(r.errors.filter((m) => m.includes("iframe の src")).length, 1, "同じオリジンの iframe はエラーにならない");
  assert.deepEqual(r.externals.map((u) => u.url).sort(), ["https://bg.example.com/x.png", "https://link.example.com/", "https://s.example.com/a.png", "https://st.example.com/a.png"]);
  assert.deepEqual(await checkHtml(""), { errors: [], warnings: [], externals: [] });
  const ok = await checkHtml(`<div class="rex0220-pcraft-page"><p>\${ESC_HTML(宛名)}</p><img width="10" src="#{&f(ABC)}"><span style="color:red">x</span></div>`);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.externals, []);
});

test("HTML: #{&q(…)} の中にレコードの値をつなぐと警告、許可一覧に無い要素は警告", async () => {
  const r = await checkHtml(`<img src="#{&q(https://a.example.com/?q=\${名称})}"><marquee>x</marquee>`);
  assert.ok(r.errors.some((m) => m.includes("属性値に ${式}")), "${} は属性値にあるのでエラーにもなる");
  assert.ok(r.warnings.some((m) => m.includes("<marquee>")));
});

test("expressionsOf: ${式} を列挙", () => {
  assert.deepEqual(expressionsOf('<p>${ESC_HTML(宛名)} ${ FVAL(合計) }</p>'), ["ESC_HTML(宛名)", "FVAL(合計)"]);
});

test("policy: Google Fonts は既定で許す。origin / url / files で照合", () => {
  const p = { allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/a.json"] }, { url: "https://img.example.com/logo.png" }] };
  assert.equal(isAllowed(p, "https://fonts.googleapis.com/css2?family=X"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings/a.json"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", ".\\settings\\a.json"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings/b.json"), false);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png"), false, "files があるのに設定ファイルが分からなければ許さない");
  assert.equal(isAllowed(p, "https://img.example.com/logo.png"), true);
  assert.equal(isAllowed(p, "https://img.example.com/other.png"), false);
  assert.equal(isAllowed({ allowExternal: [] }, "https://x.example.com/"), false);
});
