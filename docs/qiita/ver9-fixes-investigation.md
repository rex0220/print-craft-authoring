# 調査: 印刷屋 Ver.9 の計算式エンジン（記事「Ver.9 で何が直ったか」の材料）

2026-10-21。[ver9-fixes-verification.md](ver9-fixes-verification.md)（以下「メモ」）の 5 点を、エンジンのコードを読み、tools の `try` で動かして調べた。コードは直していない。

**その後（2026-10-21）**: この調べから、リリース前の印刷屋 Ver.9 と計算式プラグイン Ver.102 のエンジンに次の直しを入れた（formula `705ae4d`。`formula/doc/計算式エンジン_Ver.102_追加の計画.md`。印刷屋は枝 `ver9-engine-operand`、未コミット）。下の本文は直す前の Ver.9（`fd3910f`）の調べのまま。

- 1 章: LET と、RECS_MAP・ARRAY_* など 9 関数の「… name is already defined.」に変数名を出す（`LET() variable name (abc) is already defined.`）。DIC_MAP の名前のエラーの文の関数名（`ARRAY_MAP()` → `DIC_MAP()`）と、値の名前のエラーの後にキーの変数が残る不具合も直した
- 4a 章: `&` などでつないだ関数の結果を式として読み直さない。値が `(` で始まる・関数名の字面を含む・真偽値のときのエラーと値の化けが直る（`"<td>" & ESC_HTML("(株)山田") & "</td>"` → `<td>(株)山田</td>`）。**前後の空白を削るのは残した**（`"[" & IF(1=1, " a ", "") & "]"` は Ver.9 でも `[a]`）
- 新しく分かったこと: 式全体・関数の引数全体を括弧で包むと、中の値を式として読み直していた（`IF((1=1), "a", "b")` がエラー、`("test")` が項目 test の値、`("1+2")` が 3）。これも直した（計画 3.4）
- 4b・4c 章（ARRAY_SORT の副作用、テーブルの印の持ち越し）は直していない（Ver.104 以降で決める）

## 調べ方

- **エンジンの原本と zip の対応**（確かめた）
  - Ver.8 の zip の `desktop_js/KintoneFormulaPCraft.min.js` は、print-craft の `2739c90`（Ver.4）の `prod/desktop_js/KintoneFormulaPCraft.min.js` と同じ（CR を除いて md5 が一致。Ver.4 から Ver.8 までエンジンは変わっていない）。原本は `git -C print-craft show 2739c90:lib/KintoneFormulaPCraft.js`（先頭の日付 2025.09.02。以下「**v8 原本**」）。formula `74ba04c`（Ver.95）の `lib/KintoneFormula.js` と、見出しの 1 行と `window.` の 1 か所を除いて同じ。
  - Ver.9 の zip のエンジンは、print-craft の今の `prod/desktop_js/KintoneFormulaPCraft.min.js` と同じ（md5 が一致）。原本は `print-craft/lib/KintoneFormulaPCraft.js`（2026.10.20。以下「**v9 原本**」）。formula `fd3910f` の `lib/KintoneFormula.js` と、見出しの 1 行とグローバル名だけが違い、**行番号は同じ**。
  - そのため、Ver.8 → Ver.9 の差は formula の `74ba04c..fd3910f` の `lib/KintoneFormula.js` のコミットで追える。print-craft 側のコミットは `d7227a3`（formula `cb6835b` = Ver.101 の版を写す）と `8d76848`（formula `fd3910f` = Ver.102 の実装に写し直す）。
- **行番号**: 「v8 原本 10849」のように書く。v9 原本の行番号は formula の `lib/KintoneFormula.js`（fd3910f）でもそのまま使える。
- **try**: tools 2.3.2、お試しアプリ formula-sample のレコード 1（チェック1 = A, C、テーブル1 = 3 行、T1_文字列 = 「行 1」「行 2」「行 3」）。入力は `out/v9inv/F〜M.json`（J・K はボタンの形）、結果は `out/v9inv/r8*.json` / `r9*.json`（`out/` は git に入らない）。try は式ごとにエンジンを作り直すので、帳票の中で前の `${}` が後の `${}` に残す影響は、ボタンの形（J・K）で確かめた。
- 根拠の後の（コード）（try）は確かめた方法。（推測）は確かめていない。

---

## 1. LET のエラー文の `(0)`

**結論**: `(0)` は変数名ではなく、**LET の引数の位置**（0 から数え、値の引数も数えるので 0, 2, 4…）。2 つ目の変数が重なれば `(2)` になる。名前を出すつもりだった形跡はコード・計画・履歴・回帰確認のどこにも無い。名前を出すように直すなら、エンジンは 1 行で済む。ただし回帰確認の期待値なども合わせて直す。

**根拠**

- v9 原本 11078–11128 が LET。名前の検査は 11085 の `for (var i = 0; i < arg.length - 1; i += 2)` の中で、11094–11096 が `if (pp.hasOwnProperty(vn)) throw new Error('LET() variable name (' + i + ') is already defined.');`。`i` は引数の添字、`vn` は名前（コード）。
- 同じ形の文がすぐ上に 2 つある: 11088 `LET() variable name (' + i + ') is blank.`、11091 `LET() Bad variable name (' + i + ')`。どちらも v8 原本（10834・10837）からある。名前が空のときは位置しか出せないので位置にした形を、2026-10-17 に足した 3 つ目が写したと読める（推測）。
- 足したのは formula `f05fa44`（2026-10-17「LET の変数名が項目のフィールドコードと同じときはエラーに」）。計画（`formula/doc/internal/設定画面テンプレート対応_実装計画.md` の Ver.101 の進捗の段落）に「`LET() variable name (i) is already defined.`」、`formula/lib/history.txt` の 2026/10/17 に「LET(数値, 5, 数値*2) -> エラー LET() variable name (0) is already defined.」、回帰確認 `work-link/formula-engine-check.mjs:58` の期待値も `(0)` と書いてある（コード）。
- 検査は `pp`（項目と、外の LET・ループの変数）だけを見る。同じ LET の前の組で作った名前は、検査の時点では `pp` にまだ無いので、`LET(x, 1, x, x + 1, x)` は今までどおり 2 になる（コード・try）。
- 直すなら: v9 原本 11095（formula の `lib/KintoneFormula.js` も同じ行）の `' + i + '` を `' + vn + '` にする 1 行。ほかに合わせるもの: `work-link/formula-engine-check.mjs:58` の期待値、`formula/lib/history.txt` の例、`npm run build-engine` で min を作り直し、print-craft へ写して zip を作り直す。エラー文を読んで分岐しているコードは無い（print-craft-authoring、print-craft-authoring-mcp、formula-authoring、formula-authoring-mcp を grep。print-craft-authoring の `docs/AI作業手順.md:138` が「(…)」と書くだけで、名前とも位置とも読める）。

**再現式と結果**（try）

| 式 | Ver.8 | Ver.9 |
| --- | --- | --- |
| `LET(abc, 1, ARRAY_FOR(2, k, LET(abc, 2, abc)))` | `2,2` | `LET() variable name (0) is already defined.` |
| `LET(文字列1, "x", 文字列1)` | `x` | 同上 `(0)` |
| `LET(p, 1, q, LET(p, 2, p), q)` | `2` | 同上 `(0)` |
| `LET(a, 1, LET(b, 2, a, 3, a))`（内側の 2 つ目の変数が重なる） | `3` | `LET() variable name (2) is already defined.` |
| `LET(a, 1, b, 2, c, LET(z, 1, y, 2, b, 3, b), c)`（3 つ目） | `3` | `LET() variable name (4) is already defined.` |
| `LET(x, 1, x, x + 1, x)`（同じ LET の中で付け直す） | `2` | `2` |
| `LET( , 1, 2)` | `LET() variable name (0) is blank.` | 同じ |

メモの 3 つの例は、どれも重なった名前がその LET の 1 つ目の変数なので、どれも `(0)` になる。

---

## 2. Ver.8 の REPLACEALL の誤りの文

**結論**: REPLACEALL 自身の引数の数の検査の文の**書き間違い**。REPLACERE と処理は共有していない。Ver.9 では `REPLACEALL() arguments count.` に直っている（置換の組の配列を足した formula `64a3bf9` で一緒に）。

**根拠**（コード）

- v8 原本 6534–6544 の REPLACEALL は独立した関数で、6536 の `arg.length !== 3` のときに 6537 で `throw new Error('REPLACEREALL() arguments count.')`。直前の REPLACERE（6514–6533）は自分の文 `REPLACERE() arguments count.` を出す。Ver.8 の REPLACEALL は 3 引数しか受けないので、2 引数（配列）の形は数の誤りになる。
- v9 原本 6716–6736 の REPLACEALL は 2 引数（配列）と 3 引数を受ける。数の誤りは 6719 `REPLACEALL() arguments count.`、2 引数で配列でないときは 6726 `REPLACEALL() 2nd argument must be ARRAY(pattern, replacement, ...).`。
- `git -C formula show 64a3bf9` で、`REPLACEREALL() arguments count.` の行が `REPLACEALL() arguments count.` に変わっている。

**再現式と結果**（try）

| 式 | Ver.8 | Ver.9 |
| --- | --- | --- |
| `REPLACEALL("(株)A", ARRAY("(株)", "株式会社"))` | `REPLACEREALL() arguments count.` | `株式会社A` |
| `REPLACEALL("abc", "b")`（配列でない 2 引数） | `REPLACEREALL() arguments count.` | `REPLACEALL() 2nd argument must be ARRAY(pattern, replacement, ...).` |
| `REPLACEALL("abc")` | `REPLACEREALL() arguments count.` | `REPLACEALL() arguments count.` |

---

## 3. Ver.8 で配列を渡した REPLACERE

**結論**: Ver.8 は 3 引数を「項目, パターン, 置換文字列」と読む。配列は文字列にされてカンマでつながった 1 つのパターン（`-,_,\\s,`）になり、flag のつもりの `"g"` が置換文字列になる。そのパターンが元の文字列に無いので、何も置き換わらない。**tools の normalize は、Ver.8 の zip でもこの書き方を検出しない**。

**根拠**

- v8 原本 6514–6533: 6520 で `tmp2 = '' + p.dq(arg[1])`、6521 で `tmp3 = '' + p.dq(arg[2])`、3 引数の枝（6522–6526）で `tmp1.replace(new RegExp(tmp2), tmp3)`。ARRAY の値は JavaScript の配列で、`'' + 配列` は要素をカンマでつなぐ（コード）。
- つないだパターンに当たれば置き換わることを try で確かめた: `REPLACERE("-,_,x,", ARRAY("-", "_", "x", ""), "g")` は Ver.8 で `g`（文字列全体が `-,_,x,` に当たり、`"g"` に置き換わった）。配列が文字列になる形は `CONCAT("[", ARRAY("-", "_", "x", ""), "]")` → `[-,_,x,]` で見える（try）。
- 黙って動くのは flag を付けた 3 引数の形だけ。flag の無い 2 引数の形は Ver.8 では `REPLACERE() arguments count.` のエラーになる（try）。
- **メモの式の `\\s` について**: メモの式は計算式の文字列に `\\s`（\ が 2 つ。`out/v9cmp/B.json` の JSON では `\\\\s`）と書いている。計算式の文字列は \ を解釈しないので（dq は `"…"` の中身をそのまま値の表に入れる。v9 原本 12179–12188）、正規表現は「\ と s」の 2 文字に当たり、**Ver.9 でも空白は消えない**（`a_b c`）。空白を消すつもりなら計算式に `\s`（\ が 1 つ。JSON では `\\s`）と書く。Ver.9 で `a_bc` になる（try）。

**normalize が検出するか**（コードを読んだ。normalize は動かしていない）

- 式の評価は `tools/src/normalize/derive.ts` の `evaluateFormula`（32–43 行）。zip のエンジンの検証用のインスタンス（`tools/src/engine.ts:314` の `checker`）で評価し、**例外が出たときだけ**エラーにする。Ver.8 の REPLACERE の 3 引数の形は例外にならないので、ここでは出ない。つないだパターンが正規表現として壊れているとき（例 `ARRAY("(", "x")` → `(,x`）だけ例外になるはず（推測）。
- 静的な検査（`tools/src/normalize/checks.ts`）に、REPLACERE・REPLACEALL の配列の形を見るものは無い。REPLACE / REPLACEALL を見るのは HTML の安全の判定（`isSafeExpression`、198 行〜。REPLACE の行は 209）だけ。Ver.9 から使える関数の一言（`derive.ts` の `sinceV9Hint`、63–69 行）は、文が `<M_ か R_ の名前>() is not available.` のときだけ。
- Ver.8 の zip でも、REPLACEALL の配列の形（2 引数）と REPLACERE の 2 引数の形は評価で例外になるので、normalize のエラーとしては出るはず（推測）。ただし文（`REPLACEREALL() arguments count.` など）からは「Ver.9 の形だから」とは分からない。

**検出する場所の候補**

1. `checks.ts` の `escapeFinding`（243 行。HTML 設定の行は 395 行、更新項目は 426 行から呼ぶ）と並べて、`callsOf(formula, "REPLACERE")`（145 行）で「3 引数で、2 つ目が `ARRAY(` で始まる」呼び出しを、zip の印刷屋の版が 9 より前なら警告にする。版を渡すには `CheckOptions`（24 行）に版を足す（`commands/normalize.ts:75` に `api.pluginVersion` がある）。黙る形を見つけられるのはここだけ。
2. `derive.ts` の `sinceV9Hint` に、`REPLACEREALL() arguments count.` と「式に ARRAY がある `REPLACERE() arguments count.`」を足す。エラーになる 2 つの形に「置換の組の配列は Ver.9 から」と添える。
3. `commands/try.ts` の `evaluateTryFormulas`（366 行〜）にも 1 と同じ判定を入れる。try は normalize を通らないので、Ver.8 の zip で試すと `a-b c` が黙って返る。

限界: 2 つ目が変数（`LET(p, ARRAY(…), REPLACERE(x, p, "g"))`）や配列を返す関数のときは、静的には分からない。

**再現式と結果**（try）

| 式 | Ver.8 | Ver.9 |
| --- | --- | --- |
| `REPLACERE("a-b c", ARRAY("-", "_", "\\s", ""), "g")`（メモの式。\ が 2 つ） | `a-b c` | `a_b c` |
| `REPLACERE("a-b c", ARRAY("-", "_", "\s", ""), "g")`（\ が 1 つ） | `a-b c` | `a_bc` |
| `REPLACERE("-,_,x,", ARRAY("-", "_", "x", ""), "g")` | `g` | `_,_,,` |
| `REPLACERE("a-b", ARRAY("-", "_"))`（flag なし） | `REPLACERE() arguments count.` | `a_b` |
| `CONCAT("[", ARRAY("-", "_", "x", ""), "]")` | `[-,_,x,]` | `[-,_,x,]` |
| `REPLACERE("a-b-c", "-", "g", "_")`（今までの 4 引数の形） | `a_b_c` | `a_b_c` |

---

## 4. Ver.9 でも変わらない 3 つの動き

### 4a. `&` が関数の結果の前後の空白を削る

**結論**: `&` そのものは削らない。演算子の項に関数の結果があると、エンジンがその**結果の文字列をもう一度「式の字面」として読み直し**（`p.convert`）、読み直しの最初で前後の空白を削る。読み直しは関数の名前や括弧も評価するので、関数が `"ABS(-5)"` を返すと `&` の中では 5 になる。意図した設計とは読めない（2019 年の Ver.17 からある動き）。

**空白より重い影響（2026-10-21 追記。try）**: 値が `(` で始まる、または値の中に関数名と `(` の並びがあると、`&` の中でエラーになるか、値が黙って変わる。`"<td>" & ESC_HTML("(株)山田") & "</td>"` → `traverse tree operator: 株`、`"[" & TRIM("見積 ROUND(1.5) 件") & "]"` → `[見積 2 件]`、`"[" & TRIM("LOGIN(x)") & "]"` → `IN() arguments count.`（`LOGIN(` の中の `IN(` を関数とみなす）。会社名の半角の `(株)` のようなレコードの値で帳票がエラーになる。`帳票レシピ集.md` と `samples/工程表` に `& ESC_HTML(` の形がある。CONCAT と LET の変数では起きない。

**根拠**

- `&` の本体（v9 原本 11994–11999）は、両方を文字列にしてつなぐだけ（コード）。
- dq（12175–）は、文字列を `#n`、関数の呼び出しを `$n`（字面のまま）に置き換えてから式の木を作る。葉が `$n` のとき、traverse（12062–12076）は `p.convert(arrayStr['$n'])` で関数を評価して結果のキー `#k` を得たあと、12068 で `tmp = p.convert(arrayStr[tmp])` と**結果の値**を convert に渡す。convert（12282–）は式の字面を評価する関数で、12285 の `if (str !== '\n') str = pStr.trim();` で前後の空白を削り、`(` で始まれば中を式として評価し、関数の名前を探して評価する（コード）。v8 原本も同じ（11793・12010）。
- 削られない形: 式全体が 1 つの関数（`IF(1=1, " a ", "")` だけ）、CONCAT の引数、LET の変数。どれも dq の最後の convert が `$n` を `#k` まで解いてから葉になるので、12068 を通らない。関数を括弧で包む `"[" & (IF(…)) & "]"` も、括弧の中を dq で評価した値が返るので削られない（コード・try）。
- 2019-03-20 の formula `8e41468`（NEWLINE を足したコミット）で、convert の `var str = pStr.trim();` を `if (str !== '\n') str = pStr.trim();` に変えている。NEWLINE() の結果が削られるのに気づいて、改行 1 字だけを例外にしたと読める（推測）。改行 2 つ（`REPEAT(NEWLINE(), 2)`）は今も削られる（try）。traverse の 2 回目の convert は、formula の最初の lib のコミット `9b65c4a`（2019-01-28 Ver.17）からある（コード）。
- 資料: `&` の説明（エンジンの関数の説明、`formula/doc/文字列計算について.txt` 31–36 行）に空白を削る記述は無い。回帰確認 `work-link/formula-engine-check.mjs` にもこの形の式は無い。

**直すと**（推測。試していない）: 12068 を `tmp = arrayStr[tmp]`（値をそのまま返す）にする 1 行の案が考えられる。変わる結果は、`&` の中の関数の結果の前後の空白・改行が残る、関数が関数の字面や `(…)` を返したときに評価されなくなる、の 2 つ。HTML の中の空白は表示ではほとんど変わらないが、比べる式（`… & "" = "a"` のような形）や、`white-space: pre` などで空白を見せる帳票の結果は変わる。直すなら、説明文の使用例 410 件、engine-check、手元の設定 506 行（`print-craft/docs/ver9-plan.md` 245 行）で比べる。

**再現式と結果**（try。Ver.8・Ver.9 とも同じ）

| 式 | 結果 |
| --- | --- |
| `"[" & IF(1=1, " a ", "") & "]"` | `[a]` |
| `"[" & (IF(1=1, " a ", "")) & "]"`（括弧で包む） | `[ a ]` |
| `"[" & " a " & "]"`（字面） | `[ a ]` |
| `LET(v, IF(1=1, " a ", ""), "[" & v & "]")` | `[ a ]` |
| `IF(1=1, " a ", "")`（式全体が 1 つの関数） | 前後の空白は残る |
| `"[" & IF(1=1, "ABS(-5)", "") & "]"` | `[5]`（結果の字面を関数として評価） |
| `"[" & IF(1=1, "(1+2)", "") & "]"` | `[3]` |
| `"[" & REPEAT(NEWLINE(), 2) & "]"` | `[]`（改行 2 つが消える） |
| `CONCAT("[", REPEAT(NEWLINE(), 2), "]")` | `[`改行 2 つ`]` |
| `"[" & NEWLINE() & "]"` | `[`改行`]`（改行 1 字だけは例外） |
| `"<td>" & ESC_HTML("(株)山田") & "</td>"`（Ver.9 で確かめた。以下同じ） | エラー `traverse tree operator: 株` |
| `CONCAT("[", TRIM("(株)山田"), "]")` | `[(株)山田]` |
| `LET(v, "(株)山田", "[" & v & "]")` | `[(株)山田]` |
| `"[" & TRIM("株式会社(本社)") & "]"` | `[株式会社(本社)]`（`(` が先頭でなく、関数名も無い） |
| `"[" & TRIM("見積 ROUND(1.5) 件") & "]"` | `[見積 2 件]` |
| `"[" & TRIM("ABS(樹脂)") & "]"` | エラー `getVal FIELD CODE NOT FOUND: 樹脂` |
| `"[" & TRIM("LOGIN(x)") & "]"` | エラー `IN() arguments count.` |
| `"<td>" & REPLACEALL(ESC_HTML("(注) 納期" & NEWLINE() & "未定"), NEWLINE(), "<br>") & "</td>"` | エラー `traverse tree operator: 注` |

### 4b. ARRAY_SORT が、渡した配列そのものも並べ替える

**結論**: 渡された配列に JavaScript の `sort` をそのまま使っているため。1 つ目が LET の変数や項目のときは、その値の配列そのもの（参照）を受け取るので、変数や項目の値が並び替わる。**REVERSE も同じ**。意図した設計と読める根拠は無い（関数の説明の例は `ARRAY(…)` の直書きだけ。資料で触れているのは番付表の記事 6.3 だけ）。

**根拠**（コード）

- v9 原本 5251–5281: 1 つ目が `pp` にある名前（項目・変数）なら 5259 で `p.getVal(arg[0], "obj")`、配列なら写さずに 5269 で `tmp.sort(…)`。getVal の `"obj"` は、チェックボックス・複数選択では `dataField.value`（11792）、LET の変数（`SINGLE_TEXT_LINE`）でも `dataField.value`（11826）をそのまま返す。v8 原本も同じ（5092・5102）。
- REVERSE（v9 原本 6749–6767）も 6761 で `tmp.reverse()`。
- 印刷屋は帳票 1 件で 1 つのエンジンとレコードを使い回す（`print-craft/src/shared/report.ts:68`）ので、並び替えた項目の順は後の `${}` にも見える（ボタンの形の try で確かめた）。
- 回り道: `ARRAY_SORT(ARRAY(k))`。ARRAY は新しい配列を作る（v9 原本 4673–4693）。

**直すと**（推測）: 並べ替える前に写す 1 行（`tmp = tmp.slice()`。REVERSE も同じ）。ARRAY_SORT の結果は変わらず、元の配列が変わらなくなるだけ。変わるのは、元が並び替わることに頼った式（結果を使わずに元の変数・項目を後で読む）と、帳票の後の `${}` の項目の順。計算式プラグインでも同じエンジンなので、レコードの項目の値を並べ替えている可能性がある（デスクトップの record が kintone のイベントの record そのものかは見ていない）。

**再現式と結果**（try。Ver.8・Ver.9 とも同じ）

| 式 | 結果 |
| --- | --- |
| `LET(k, ARRAY(3, 1, 2), s, ARRAY_SORT(k), JOIN(k, ","))` | `1,2,3`（k が並び替わる） |
| `LET(k, ARRAY(3, 1, 2), s, ARRAY_SORT(ARRAY(k)), CONCAT(JOIN(k, ","), " / ", JOIN(s, ",")))` | `3,1,2 / 1,2,3` |
| `LET(s, ARRAY_SORT(チェック1, 0), JOIN(チェック1, ","))` | `C,A`（項目が並び替わる。元は A, C） |
| `LET(k, ARRAY(1, 2, 3), r, REVERSE(k), JOIN(k, ","))` | `3,2,1` |
| ボタン: `${ARRAY_SORT(チェック1, 0)}` の後の `${JOIN(チェック1, ",")}` | `C,A` |

### 4c. テーブルの子の項目を書くと、結果が行の数だけつながる

**結論**: 「式全体」が繰り返されるのではない。テーブルの子の項目を読むと、エンジンの変数 `currTable` にテーブルのコードが入り、**関数が終わっても空に戻さない**。CONCAT・SUM など「テーブルの子なら全部の行で回す」関数は、1 つ目の引数を評価した後に `currTable` を見て、入っていれば全部の行で引数を評価してつなぐ。メモの式では、前の TARRAY が残した `currTable` を最後の CONCAT が見て、行の数だけ `n=3;` をつないだ。式の最後が CONCAT なので、式全体が繰り返されたように見える。印刷屋では、前の `${}` が残した `currTable` が帳票の後の `${}` にも効く。

**根拠**

- `currTable` は v9 原本 33 のモジュールの変数。getVal のテーブルの子の枝（11636–11637 `currTable = tcode;`）などで入る。空に戻すのはコンストラクタ（73）と `initTableInfo`（12340–12354）だけ（コード）。印刷屋の帳票は `initTableInfo` を呼ばない。呼ぶのは更新項目の `applyUpdateFormulas`（`print-craft/src/shared/formula.ts:92`）だけ（コード）。
- CONCAT（v9 原本 7546–7572）は 7553 で 1 つ目を評価し、7554 の `if (currTable)` なら全部の行で全部の引数を評価してつなぐ。TARRAY（4624–4672）は `currRow` を戻すが `currTable` は戻さない。`if (currTable) {` の分かれはエンジン全体で 44 か所ある（コード。全部が行ごとに回すかは見ていない）。SUM が `currTable` を残すこと、SUM も残った `currTable` で行ごとに回ることは try で確かめた。COUNTROW と OTVAL は残さない（try）。
- 設計と読めるか: CONCAT が「1 つ目がテーブルの子なら全部の行をつなぐ」こと自体は設計（関数の説明「テーブル内項目の文字連結」、例 `CONCAT(文字列T)`。v9 原本 1209–1214）。**前の関数が残した `currTable` で行ごとになることには、説明・資料・テストのどこにも根拠が無く**、意図した動きとは読めない（推測）。
- 直すと影響が出る: CONCAT は 1 つ目の引数でしかテーブルの子を見分けない。`CONCAT("<", T1_文字列, ">")` だけなら 1 行目だけ（`<行 1>`）だが、前にテーブルの子を読んでいると全部の行になる（try）。今の帳票に、前の `${}` や LET が残した `currTable` のおかげで全部の行が出ている式があれば、直すと 1 行目だけになる。直し方の候補は、関数ごとに `currTable` を退避して戻す（エンジン）か、印刷屋の `evaluate`（`src/shared/formula.ts:24`）で `${}` ごとに `initTableInfo("")` を呼ぶ（帳票の式の間の持ち越しだけを止める。式の中の持ち越しは残る）か（どちらも推測）。どちらも、手元の設定 506 行などを直した写しと比べてからにする。
- 参考（try で分かったこと）: CONCAT のテーブルの枝は、1 つ目の引数を先に 1 回評価してから行ごとにも評価する。Ver.9 でも同じで、`LET(s, 0, a, TARRAY(T1_文字列), b, CONCAT(FSET(s, s + 1)), s)` → `4`（3 行 + 1）。

**再現式と結果**（try。Ver.8・Ver.9 とも同じ）

| 式 | 結果 |
| --- | --- |
| `LET(a, TARRAY(T1_文字列), CONCAT("n=", ARRAY_COUNT(a), ";"))` | `n=3;n=3;n=3;` |
| `CONCAT("n=", ARRAY_COUNT(TARRAY(T1_文字列)), ";")`（CONCAT の 1 つ目を評価する時点では空） | `n=3;` |
| `LET(a, TARRAY(T1_文字列), "n=" & ARRAY_COUNT(a) & ";")` | `n=3;` |
| `LET(a, TARRAY(T1_文字列), JOIN(ARRAY("n=", ARRAY_COUNT(a), ";"), ""))` | `n=3;` |
| `LET(a, TARRAY(T1_文字列), CONCAT("x"))` | `xxx` |
| `LET(a, SUM(T1_数値), CONCAT("x"))` | `xxx` |
| `LET(a, TARRAY(T1_文字列), SUM(1))` | `3` |
| `LET(a, TARRAY(T1_文字列), JOIN(ARRAY_MAP(ARRAY("x"), v, CONCAT(v, "y")), ","))` | `xyxyxy`（ループの中でも） |
| `LET(a, COUNTROW(テーブル1), CONCAT("x"))` | `x` |
| `LET(a, OTVAL(テーブル1, TPOUT(T1_文字列)), CONCAT("x"))` | `x`（番付表の記事の読み方） |
| `CONCAT(T1_文字列, "/")`（設計どおりの使い方） | `行 1/行 2/行 3/` |
| `CONCAT("<", T1_文字列, ">")`（1 つ目が定数） | `<行 1>` |
| `LET(a, T1_文字列, CONCAT("<", T1_文字列, ">"))` | `<行 1><行 2><行 3>` |
| ボタン: `${TARRAY(T1_文字列)}` の後の `${CONCAT("x")}` | `xxx` |

---

## 5. Ver.8 → Ver.9 の差分の裏付け

どれも formula の 2026-10-17〜20 のコミットで直り、print-craft `d7227a3` / `8d76848` で Ver.9 に入った（コード）。結果はメモの r8* / r9*。

| メモの行 | Ver.8 の原因（v8 原本） | Ver.9 の直し（v9 原本） | formula のコミット |
| --- | --- | --- | --- |
| 0 が空になる（`[],[1],[2]`）。資産ラベルの 1 ページ目が白紙（`0,12`）。盤面図の FSET の 0（`[]`） | 変数の型 `SINGLE_TEXT_LINE` が getVal の既定の枝 11567 `return dataField.value ? dataField.value : ''` に落ち、0 が `''` になる。白紙の式は vP = 0 が `''` になり、`'' * 12` も `''` で比べが偽。`FSET(s, 0)` は 0 を入れるが、読むと `''` | 11824–11826 の `SINGLE_TEXT_LINE` の枝で値をそのまま返す | `f0dfa99`（10-17） |
| 盤面図の FSET の累積（`,,,,`） | LET が数値を文字列にして入れる（10849。s = `"0"`）。`s + k` は数の 0 を返し、FSET が数の 0 を入れ、読むと `''`。以後 `'' + k` は `''`（`+` は空なら空）で s は空のまま | 同上。LET も値をそのまま入れる（11107 のコメント） | `f0dfa99` |
| 番付表の LET の偽 | 10849 `if (!Array.isArray(tmp) && !isNaN(Number(tmp))) tmp = '' + tmp;` で false が `"false"`（`Number(false)` は 0 なので数とみなす）、0 が `"0"` になり、IF は空でない文字列を真とする | 同上 | `f0dfa99` |
| 盤面図の CONCAT の中の FSET（6 → 3） | CONCAT（7324–）が 1 つ目を 7331 で評価し、テーブルの外の枝（7341–7346）で i = 0 から評価し直す | 7563–7569 で 1 つ目は先の結果を使う | `ab90d90`（10-17） |
| 五線譜・盤面図の 101 個目 | dq（11900–）の関数の置き換えが 1 つの名前につき 100 回まで（11920 `j < 100`。文字列と括弧は 11904・11931 で 1,000 回）。101 個目の `ARRAY_GET(a, k)` が字のまま残り、`ARRAY_FOR(…)` の字面ごと保存される。その字面を convert が評価するとき、関数の名前を定義の順に探し、ARRAY_GET（4590）が ARRAY_FOR（4927）より前なので、内側を先に評価して k が無い | `PARSE_OVER = 200000`（32）を 3 か所（12179・12195・12206）で使う | `ab90d90` |
| 原稿用紙の評価回数 | `COUNT_OVER = 100000`（29） | `COUNT_OVER = 10000000`（29） | `ab90d90` |
| 番付表 6.4 の ARRAY_FOR の打ち切り | 4940 `if (tmp > 1000) tmp = 1000;` | `ARRAY_FOR_MAX = 100000`（31。5107） | `ab90d90` |
| 盤面図のループの中の LET、LET と項目コード | LET（10824–10868）は名前を検査せず、終わりに `excludeVnames`（11087–11099）で `pp`・`record` から消す。外の変数や項目が消える | 11094–11096 で `pp` にある名前ならエラー | `f05fa44`（10-17） |
| 速さ（関数の呼び出しの 2 乗） | `getKeyOfValue`（136–140）が値を入れるたびに `Object.keys(arrayStr).length` で表全体のキーを数えた（dq の文字列・関数の置き換えなど 11 か所も同じ）。表は帳票 1 件のエンジンの間ずっと増える | 表の大きさを持つ（`putValue` と `arrayStrSize`、42–47。`getKeyOfValue` は 167–171） | `fd3910f`（10-20） |

確かめたこと（try）:

- 「LET と項目コード」の Ver.8 の「以後の式で項目が使えなくなる」: ボタンの形で、Ver.8 は `${LET(数値1, 5, 数値1 * 2)}` の後の `${数値1}` が `getVal FIELD CODE NOT FOUND: 数値1` になった。Ver.9 は 1 つ目の `${}` で `LET() variable name (0) is already defined.`。
- 「盤面図のループの中の LET」の Ver.8 の文は、正確には `Error: Error: getVal FIELD CODE NOT FOUND: s`。頭の `Error: ` の重なりは `fd3910f` の `rethrowError`（v9 原本 50–52）で無くなった。
- ARRAY_FOR: `ARRAY_COUNT(ARRAY_FOR(100001, i, i))` は Ver.8 `1000`、Ver.9 `100000`。

### メモと食い違う点・補う点

1. **ARRAY_FOR の上限**: Ver.9 は上限が 1,000 から 100,000 に上がっただけで、**超えた分は今も黙って切り詰める**。記事では「3,000 が通るようになった」ではなく「上限が 100,000 に上がった」と書く。
2. **CONCAT の 2 回評価**: 直ったのはテーブルの外だけ。テーブルの子で回るときは、今も 1 つ目を 1 回多く評価する（4c の参考）。メモの式（テーブルの外）の 6 → 3 は正しい。
3. **テーブルの子の繰り返し**: メモ 3 章と番付表の記事（`authoring-desktop-banzuke.md` 389 行の式のコメント「式全体がテーブルの行の数だけ繰り返される」、428 行）の「式全体」は、正確には「テーブルの子を読んだ後の CONCAT や SUM が全部の行で回る」（4c）。番付表の式は最後が CONCAT なので、ページ全体が繰り返されたように見えた。
4. **REPLACERE の例**: メモ 2 章の `REPLACERE("a-b c", ARRAY("-", "_", "\\s", ""), "g")` の Ver.9 の結果 `a_b c` は、`\\s` が空白に当たらないため（3 章）。記事の式は `\s` にして `a_bc` を載せるか、`-` だけが置き換わると説明する。
5. **0 が空になる**: 「資産ラベルの 1 ページ目が白紙」も同じ原因（vP = 0 が空になる）。記事では 1 つの原因としてまとめられる。
6. **関数の呼び出しの 2 乗**: 正確には「値の表に値を入れる回数の 2 乗」。関数の結果のほか、式の中の文字列の字面や関数の呼び出しの字面を入れるときにも数えていた。演算子（`&`・`+`・比べ）と変数を読むのは表を増やさない（`print-craft/docs/計算式エンジンの改善案.md` の付録）。記事で「関数の呼び出しが多いほど 2 乗で遅くなった」と書いても大きくは外れない。
7. **改善案の文書の注記**: `print-craft/docs/計算式エンジンの改善案.md` の冒頭の「その後（2026-10-19）」は「1（値の表のキーを連番）は入らない」のまま。`print-craft/docs/ver9-plan.md` の J1 は同日に変わっていて、Ver.9 は連番キーの入った formula `fd3910f` のエンジンを写した。記事でこの文書を引くときは注意する。

---

## 記事に書いてよい言い方

| 項目 | 言い方 |
| --- | --- |
| 1. LET のエラー文 | 「Ver.9 で、外の変数や項目コードと同じ名前の LET はエラーになった。エラーの文に変数名が出る（`LET() variable name (abc) is already defined.`）」（2026-10-21 の直しの後。直す前は `(0)` が引数の位置だった） |
| 2. REPLACEALL の文 | 「Ver.8 の `REPLACEREALL()` は REPLACEALL の文の書き間違い。Ver.9 で直った」 |
| 3. Ver.8 の REPLACERE と配列 | 「置換の組の配列は Ver.9 から。Ver.8 で flag 付きの REPLACERE に配列を渡すと、エラーにならずに何も置き換えない。今の normalize はこれを見つけない」 |
| 4a. `&` の空白 | 「Ver.9 でも、`&` でつないだ関数の結果の前後の空白は削られる（意図した仕様ではない）。回り道は CONCAT か、関数を括弧で包む `"[" & (IF(…)) & "]"`。値が `(` で始まるときのエラー（`(株)` など）は Ver.9 で直った」（2026-10-21 の直しの後） |
| 括弧で包んだ式 | 「Ver.8 では `IF((条件), …)` のように式全体や引数全体を括弧で包むとエラーや別の値になった。Ver.9 で直った」（2026-10-21 の直しの後） |
| 4b. ARRAY_SORT | 「Ver.9 でも、ARRAY_SORT と REVERSE は渡した配列や項目も並べ替える。回り道は `ARRAY_SORT(ARRAY(k))`」 |
| 4c. テーブルの子 | 「Ver.9 でも残る動き: テーブルの子を読んだ後の CONCAT や SUM は全部の行で回る（式全体ではない）。回り道は `&` や `JOIN(ARRAY(…), "")` でつなぐか、テーブルを OTVAL でまとめて読む」 |
| 5. 差分 | 「Ver.9 で直った（計算式プラグイン Ver.101・Ver.102 と同じ直し）」。ARRAY_FOR だけは「上限が 1,000 から 100,000 に（超えた分は今も切り詰める）」 |

直すかどうか（1 の名前、4a〜4c）は Takashi 判断。「Ver.10 で直す」とは、決まるまで書かない。
