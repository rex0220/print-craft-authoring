# 検証メモ: 記事で見つかった問題と印刷屋 Ver.9（記事「Ver.9 で何が直ったか」の材料）

2026-10-21。tools 2.3.2 の `try`（お試しアプリ formula-sample、レコード 1）で、同じ式を `print-craft-plugin8.zip` と `print-craft-plugin9.zip` に評価させた。式の入力は `out/v9cmp/A〜E.json`、結果は `out/v9cmp/r8*.json` / `r9*.json`。
コマンド: `PCRAFT_PLUGIN_ZIP=…/print-craft-plugin<版>.zip npx @rex0220/print-craft-authoring-tools try --input out/v9cmp/A.json --json`

## 1. Ver.9 で直ったもの

| 記事 | 式 | Ver.8 | Ver.9 |
| --- | --- | --- | --- |
| 資産ラベル（#5）・五線譜 | `ARRAY_MAP(ARRAY_FOR(3, i, i), p, CONCAT("[", p, "]"))` | `[],[1],[2]` | `[0],[1],[2]` |
| 資産ラベル（#5） 1 ページ目が白紙 | `ARRAY_MAP(ARRAY_FOR(2, vI, vI), vP, ARRAY_COUNT(ARRAY_FIL(ARRAY_FOR(24, j, j), vA, vIx, vIx >= vP * 12 && vIx < (vP + 1) * 12)))` | `0,12` | `12,12` |
| 盤面図（#14） FSET の 0 | `LET(s, 5, a, ARRAY_FOR(1, k, FSET(s, 0)), CONCAT("[", s, "]"))` | `[]` | `[0]` |
| 盤面図 FSET の累積 | `LET(s, 0, t, "", a, ARRAY_FOR(4, k, ARRAY(FSET(s, s + k), FSET(t, CONCAT(t, s, ",")))), t)` | `,,,,` | `0,1,3,6,` |
| 盤面図 CONCAT の中の FSET | `LET(s, 0, a, ARRAY_FOR(3, k, CONCAT(FSET(s, s + 1))), s)` | `6`（2 回評価） | `3`（直ったのはテーブルの外だけ。テーブルの子で回るときは今も 1 つ目を 1 回多く評価する） |
| **番付表（#11） LET の偽** | `LET(a, 3 > 8, IF(a, "真", "偽"))` | 真 | **偽** |
| 番付表 | `LET(a, 0, IF(a, "真", "偽"))` | 真 | **偽** |
| 番付表 | `LET(a, 3 > 8, IF(AND(a, 1 = 1), "真", "偽"))` | 真 | **偽** |
| 五線譜（#13）・盤面図 101 個目 | `ARRAY_GET(a, 0)` を 100 個置いた後の `ARRAY_FOR(3, k, ARRAY_GET(a, k))` | エラー「getVal FIELD CODE NOT FOUND: k」 | `1,2,3` |
| 原稿用紙（#9） 評価回数 | `ARRAY_COUNT(ARRAY_FOR(500, i, ARRAY_COUNT(ARRAY_FOR(500, j, j * 2))))` | エラー「traverse tree check count > 100000 over.」 | `500` |
| 番付表 6.4 ARRAY_FOR の打ち切り | `ARRAY_COUNT(ARRAY_FOR(3000, i, i * 2))` | `1000`（黙って打ち切り） | `3000`（上限が 100,000 に上がっただけで、超えた分は今も黙って切り詰める） |
| 盤面図 ループの中の LET | `LET(s, "x", ARRAY_FOR(3, k, LET(s, CONCAT(s, k), s)))` | エラー「… NOT FOUND: s」（原因が分からない文） | エラー「LET() variable name (0) is already defined.」（書いた時点で止まる） |
| LET と項目コード | `LET(数値1, 5, 数値1 * 2)` | `10`（以後の式で項目が使えなくなる） | エラー（同上） |

番付表の記事では「原因は分かっていない」としていた LET の偽は、Ver.9 で直っている（記事の 1 / 0 に直す回り道は要らなくなった）。

## 2. Ver.9 で増えた書き方・関数（Ver.8 では使えない）

| 式 | Ver.8 | Ver.9 |
| --- | --- | --- |
| `REPLACERE("a-b c", ARRAY("-", "_", "\s", ""), "g")`（計算式に `\s`。\ は 1 つ） | `a-b c`（**エラーにならず、何も置き換えない**） | `a_bc` |
| `REPLACEALL("(株)A（株）", ARRAY("(株)", "株式会社", "（株）", "株式会社"))` | エラー「REPLACEREALL() arguments count.」 | `株式会社A株式会社` |
| `M_SIN(1.5707963267948966)` | エラー「M_SIN() is not available.（… Ver.9 から …）」（tools の文） | `1` |
| `MEDIAN(T1_数値)`（100, 200, 300） | エラー（無い関数） | `200` |
| `LENGTH(UUID())` / `LENGTH(UUID("N"))` | — | `36` / `32` |

置換の組の配列を Ver.8 に持ち込むと、**黙って何もしない**のが危ない（配列がカンマでつながった 1 つのパターンになり、`"g"` が置換文字列になる）。今の normalize はこれを見つけない（ver9-fixes-investigation.md の 3 章）。

## 3. Ver.9 でも変わらないもの（仕様として書く）

| 記事 | 式 | Ver.8・Ver.9 とも |
| --- | --- | --- |
| 原稿用紙（#9） `&` の空白 | `"[" & IF(1=1, " a ", "") & "]"` | `[a]`（削られる） |
| 同 | `"[" & LEFT(" a ", 3) & "]"` | `[a]` |
| 同（回り道） | `CONCAT("[", IF(1=1, " a ", ""), "]")` | `[ a ]` |
| 番付表 ARRAY_SORT | `LET(k, ARRAY(3, 1, 2), s, ARRAY_SORT(k, 0), CONCAT(JOIN(k, ","), " / ", JOIN(s, ",")))` | `3,2,1 / 3,2,1`（元の `k` も並び替わる） |
| 番付表 テーブルの子 | `LET(a, TARRAY(T1_文字列), CONCAT("n=", ARRAY_COUNT(a), ";"))`（3 行） | `n=3;n=3;n=3;`（式全体ではなく、テーブルの子を読んだ後の CONCAT・SUM が全部の行で回る） |
| 同 | `CONCAT("[", COUNTROW(テーブル1), "]")` | `[3]` |
| 太陽系（#10） REPLACE | `REPLACE("a-b-c", "-", "_")` | `a_b-c`（最初の 1 か所。全部は REPLACEALL） |

## 4. 速さ（関数の呼び出しの 2 乗）

`ARRAY_COUNT(ARRAY_FOR(n, i, IF(MAX(i, 1) > 0, MIN(i, 2), 0)))` の try 1 回の時間（子プロセスの起動を含む。2 回測って同じ値）。起動だけで約 0.45 秒。

| n | Ver.8 | Ver.9 |
| ---: | ---: | ---: |
| 250 | 0.49 秒 | 0.49 秒 |
| 1,000 | 0.85 秒 | 0.53〜0.57 秒 |

起動の分を引くと、n を 4 倍にして Ver.8 は約 10 倍（2 乗に近い）、Ver.9 は約 2〜3 倍。大きい帳票の実測は samples の README（五線譜 3.5〜4.0 秒 → 0.3〜0.7 秒・3.1 GB → 約 300 MB、盤面図 1,000 手 11 秒 → 0.7 秒）を使う。

## 5. 開発者に確かめること（調べた結果は ver9-fixes-investigation.md。2026-10-21）

- Ver.9 の LET のエラー文の `(0)` → 名前ではなく LET の引数の位置（0, 2, 4…）。名前を出すように直すかは未定
- Ver.8 の REPLACEALL の配列の誤りの文が `REPLACEREALL()` になっている（Ver.8 なので記事で触れる程度）
- `&` の空白、`ARRAY_SORT`（REVERSE も）、テーブルの子 → どれも意図した仕様と読める根拠は無い。直すかは未定（直すと既存の帳票に影響が出うる）
