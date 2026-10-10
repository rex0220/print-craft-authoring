/** HTML / CSS の検査、承認（policy）、${式} の安全判定の単体テスト */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCss, classifyUrl, extractUrls, hasCssFetch, stripCssComments } from "../src/normalize/css-check.ts";
import { checkHtml, expressionsOf } from "../src/normalize/html-check.ts";
import { isAllowed, isExternalRefsAllowed, parsePolicy, PolicyError } from "../src/normalize/policy.ts";
import { backslashEscapes, callsOf, commentInsideString, isSafeExpression, parseCall, splitTopLevel, stringLiterals } from "../src/normalize/checks.ts";

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
  assert.match(e, /<svg> は使えない/);
  assert.match(e, /iframe の src は利用者の kintone/);
  assert.match(e, /srcdoc/);
  assert.match(e, /<style>: @import/);
  assert.match(e, /<form>/);
  assert.equal(r.errors.filter((m) => m.includes("iframe の src")).length, 1, "同じオリジンの iframe はエラーにならない");
  assert.deepEqual(r.externals.map((u) => u.url).sort(), ["https://bg.example.com/x.png", "https://link.example.com/", "https://s.example.com/a.png", "https://st.example.com/a.png"]);
  assert.deepEqual(await checkHtml(""), { errors: [], warnings: [], externals: [] });
  const ok = await checkHtml(`<div class="rex0220-pcraft-page"><p>\${ESC_HTML(宛名)}</p><img width="10" src="#{&f(ABC)}"><span style="color:red">x</span><img src="#{&q(https://a.example.com/?q=1)}" width="10"></div>`);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.externals, []);
});

test("HTML: 属性値の ${式} はエラー、許可一覧に無い要素もエラー", async () => {
  const r = await checkHtml(`<img src="#{&q(https://a.example.com/?q=\${名称})}"><marquee>x</marquee>`);
  assert.ok(r.errors.some((m) => m.includes("属性値に ${式}")));
  assert.ok(r.errors.some((m) => m.includes("<marquee> は使えない")));
  assert.deepEqual(r.warnings, []);
});

test("expressionsOf: ${式} を列挙", () => {
  assert.deepEqual(expressionsOf('<p>${ESC_HTML(宛名)} ${ FVAL(合計) }</p>'), ["ESC_HTML(宛名)", "FVAL(合計)"]);
});

test("isSafeExpression: 式全体で判定する（& でつないだ項がすべて安全なら安全。REPLACE の置換は <br> か記号無しの定数だけ）", () => {
  const pp = { 宛名: { type: "SINGLE_LINE_TEXT" }, 備考: { type: "MULTI_LINE_TEXT" }, 合計: { type: "NUMBER" }, 税: { type: "CALC" }, 見積日: { type: "DATE" } };
  for (const ok of ["ESC_HTML(宛名)", "ESC_HTML(宛名 & 備考)", 'REPLACE(ESC_HTML(備考), NEWLINE(), "<br>")', 'REPLACE(ESC_HTML(備考), "\\n", "<br>")', 'REPLACE(ESC_HTML(備考), "\\n", "<br/>")', 'REPLACE(ESC_HTML(備考), "x", "y")', "合計", "FVAL(合計)", "FVAL(合計 * 1.1)", "ROUND(合計 + 税, 0)", 'DATE_FORMAT(見積日, "YYYY年M月D日")', 'DATE_FORMAT(DATE_ADD(見積日, 1, "days"), "YYYY-MM-DD")', "TODAY()", "NOW()", "123", '"御中"', 'ESC_HTML(宛名) & " 御中"', 'FVAL(合計) & " 円（税込 " & FVAL(税) & "）"']) {
    assert.equal(isSafeExpression(ok, pp), true, ok);
  }
  for (const bad of ["宛名", "FVAL(備考)", "FVAL(宛名)", 'ESC_HTML(宛名) & UNESC_HTML("<img onerror=x>")', 'REPLACE(ESC_HTML(備考), "\\n", "<br>") & HTML(備考)', "TODAY() & HTML(備考)", '"</div><img onerror=alert(1)>"', "HTML(備考)", 'REPLACE(ESC_HTML(備考), 宛名, "<br>")', 'REPLACE(ESC_HTML(備考), NEWLINE(宛名), "<br>")', 'REPLACE(ESC_HTML(備考), "x", "<img src=\'https://evil.example/pixel\'>")', 'REPLACE(ESC_HTML(備考), "x", "<b>")', "FVAL(合計, 宛名)", "ESC_HTML(宛名", "TODAY(宛名)", "DATE_FORMAT(宛名, \"YYYY\")", 'ESC_HTML(宛名) & 宛名', "&", 'ESC_HTML(宛名) &']) {
    assert.equal(isSafeExpression(bad, pp), false, bad);
  }
  assert.deepEqual(stringLiterals('REPLACE(x, "a\\"b", \'c\') & "<img src=\\"x\\">"'), ['a"b', "c", '<img src="x">']);
  assert.deepEqual(callsOf('TAG("img", ATTR("src", URL項目), "x") & ATTR("a", "b")', "ATTR"), [['"src"', "URL項目"], ['"a"', '"b"']]);
  assert.deepEqual(callsOf("ATTR()", "ATTR"), [[]]);
  assert.deepEqual(splitTopLevel('a, "x, y", F(1, 2), c'), ["a", '"x, y"', "F(1, 2)", "c"]);
  assert.equal(splitTopLevel("a, (b"), null);
  assert.deepEqual(parseCall("F(1, G(2, 3))"), { name: "F", args: ["1", "G(2, 3)"] });
  assert.equal(parseCall("A(1) & B(2)"), null);
  assert.deepEqual(parseCall("TODAY()"), { name: "TODAY", args: [] });
});

test("backslashEscapes: 文字列の定数の \\n / \\r / \\t（実エンジンは解釈しないので改行にならない）。\\\" は対象外", () => {
  assert.deepEqual(backslashEscapes('REPLACE(ESC_HTML(備考), "\\n", "<br>") & "a\\tb" & "\\n"'), ['"\\n"', '"a\\tb"']);
  assert.deepEqual(backslashEscapes('REPLACE(ESC_HTML(備考), NEWLINE(), "<br>") & "say \\"hi\\""'), []);
  assert.deepEqual(backslashEscapes("ESC_HTML(備考)"), []);
});

test("commentInsideString: 実エンジンの文字列の規則（二重引用符だけ、直前の \\ がある \" はエスケープ）で // を見る", () => {
  assert.equal(commentInsideString('"https://x.example.com/" & 見積番号'), true);
  assert.equal(commentInsideString('"a" & b // https://x'), false, "文字列の外の // はコメント");
  assert.equal(commentInsideString("'https://x'"), false, "' は文字列でないので // は文字列の外（コメント）");
  assert.equal(commentInsideString('"a\\\\"//x"'), true, "\\\\\" も閉じない（実エンジンの規則）");
  assert.equal(commentInsideString('"a\\"b" // c'), false);
  assert.equal(commentInsideString('"x" // https://a\n"https://b"'), true, "2 行目の文字列の中");
  assert.equal(commentInsideString(""), false);
});

test("policy: Google Fonts は既定で許す。origin / url / files で照合。URL はタブなどを捨てて比べる", () => {
  const p = parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com", files: ["settings/a.json"] }, { url: "https://img.example.com/logo.png" }] }), "policy.json");
  assert.equal(isAllowed(p, "https://fonts.googleapis.com/css2?family=X"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings/a.json"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", ".\\settings\\a.json"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings//a.json"), true);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings/b.json"), false);
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "settings/../settings/a.json"), false, ".. は照合しない");
  assert.equal(isAllowed(p, "https://cdn.example.com/x.png"), false, "files があるのに設定ファイルが分からなければ許さない");
  assert.equal(isAllowed(p, "https://img.example.com/logo.png"), true);
  assert.equal(isAllowed(p, "https://img.example.com/logo.png?x=1"), false);
  assert.equal(isAllowed(p, "https://img.example.com/other.png"), false);
  assert.equal(isAllowed({ allowExternal: [] }, "https://x.example.com/"), false);
  if (process.platform === "win32") assert.equal(isAllowed(p, "https://cdn.example.com/x.png", "Settings/A.json"), true, "Windows は大文字小文字を区別しない");
});

test("policy: 形を検証する（未知のキー、origin の形、files の .. と絶対パス）", () => {
  assert.throws(() => parsePolicy("{", "p"), PolicyError);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [], extra: 1 }), "p"), /使えるキーは allowExternal/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com/path" }] }), "p"), /https のオリジンだけ/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ origin: "http://cdn.example.com" }] }), "p"), /https のオリジンだけ/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ url: "https://u:p@cdn.example.com/x" }] }), "p"), /https の完全な URL/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ note: "x" }] }), "p"), /origin か url/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com", files: ["../x.json"] }] }), "p"), /相対パス/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com", files: ["C:/x.json"] }] }), "p"), /相対パス/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com", bogus: 1 }] }), "p"), /使えるキーは origin/);
  const ok = parsePolicy(JSON.stringify({ allowExternal: [{ origin: "https://cdn.example.com/", files: [".\\settings\\a.json"], note: "n" }] }), "p");
  assert.deepEqual(ok.allowExternal, [{ origin: "https://cdn.example.com", files: ["settings/a.json"], note: "n" }]);
  assert.deepEqual(parsePolicy("{}", "p").allowExternal, []);
  assert.equal(parsePolicy("{}", "p").allowExternalRefs, undefined);
});

test("policy: allowExternalRefs は externalRefs: \"allow\"（印刷屋が何も除かない。自己責任）を使ってよい設定ファイルの一覧。パスは正規化して照合、分からなければ許さない", () => {
  const p = parsePolicy(JSON.stringify({ allowExternal: [], allowExternalRefs: [".\\settings\\a.json", "settings//b.json"] }), "p");
  assert.deepEqual(p.allowExternalRefs, ["settings/a.json", "settings/b.json"]);
  assert.equal(isExternalRefsAllowed(p, "settings/a.json"), true);
  assert.equal(isExternalRefsAllowed(p, ".\\settings\\b.json"), true);
  assert.equal(isExternalRefsAllowed(p, "settings/c.json"), false);
  assert.equal(isExternalRefsAllowed(p, undefined), false, "設定ファイルが分からなければ許さない");
  assert.equal(isExternalRefsAllowed(p, "settings/../settings/a.json"), false, ".. は照合しない");
  assert.equal(isExternalRefsAllowed({ allowExternal: [] }, "settings/a.json"), false, "一覧が無ければ許さない");
  if (process.platform === "win32") assert.equal(isExternalRefsAllowed(p, "Settings/A.json"), true);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternalRefs: "settings/a.json" }), "p"), /相対パスの配列/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternalRefs: [1] }), "p"), /相対パスの配列/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternalRefs: ["../x.json"] }), "p"), /相対パス/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternalRefs: ["C:/x.json"] }), "p"), /相対パス/);
  assert.throws(() => parsePolicy(JSON.stringify({ allowExternalRef: [] }), "p"), /使えるキーは allowExternal と allowExternalRefs/);
});

test("hasCssFetch（preview の掃除。tools 2.0.1）: @import・@font-face・外の url() / image-set() は読み込み。data: の画像・# の参照・置き換えタグ・文字列の中・コメントは読み込みでない。エスケープを解いて見る", () => {
  const fetch = [
    '@import url("https://fonts.googleapis.com/css2?family=X");',
    "@import 'https://fonts.googleapis.com/css2?family=X';",
    "@IMPORT url(https://a.example/x.css);",
    "@\\69mport url(https://fonts.googleapis.com/x);",
    "@\\000069mport url(x.css);",
    "@font-face{font-family:x;src:url(https://fonts.gstatic.com/x.woff2)}",
    "@font-face{font-family:x;src:local(x)}",
    "@\\66 ont-face{font-family:x}",
    ".a{background:url(https://fonts.gstatic.com/LEAK)}",
    ".a{background:\\75rl(https://fonts.gstatic.com/LEAK)}",
    ".a{background:url(/relative.png)}",
    ".a{background:url(//evil.example/x)}",
    '.a{background-image:image-set("https://fonts.gstatic.com/x.png" 1x)}',
    '.a{background-image:-webkit-image-set("x.png" 1x)}',
    ".a{cursor:url(javascript:x),auto}"
  ];
  for (const css of fetch) assert.equal(hasCssFetch(css), true, css);
  const quiet = [
    ".a{color:red;font-family:'BIZ UDPMincho'}",
    ".a{background:url(data:image/png;base64,AAAA)}",
    '.a{background:url("data:image/svg+xml,%3Csvg%3E")}',
    ".a{fill:url(#grad)}",
    ".a{background:url(#{&f(abc)})}",
    '.a{content:"@import url(https://x.example/)"}',
    ".a{color:red} /* @import url(https://x.example/) */",
    ""
  ];
  for (const css of quiet) assert.equal(hasCssFetch(css), false, css);
});
