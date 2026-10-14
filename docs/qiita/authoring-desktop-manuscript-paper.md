<!--
title: rex0220 印刷屋プラグイン - AI に作文を原稿用紙（400 字詰め）の PDF にさせる（禁則処理と縦書き）
tags:
  - kintone
  - Claude
  - MCP
private: false
url: https://qiita.com/rex0220/items/bb2649ca3d70264b8242（2026-10-14 公開）
-->

[前回の記事](https://qiita.com/rex0220/items/0a6be4bdb34ebb2986c6) では、休日アプリから年間カレンダーを作りました。今回は、**kintone に書いた作文や日報を、400 字詰めの原稿用紙の PDF にする**話です。

できあがったのは、下の帳票です。20×20 のマスに、本文を 1 字ずつ流し込んでいます。1 行目に題名、2 行目に氏名を書き、改行で段落を分け、行の頭に来る句読点は前の行にぶら下げます。縦書き（A4 横）と横書き（A4 縦）のボタンがあり、本文が 1 枚に収まらないときは次の用紙に続きます。

![夏休みの日記（縦書き、1 ページ目）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/1fea1bb9-c730-4ead-89ce-6538064ee7b1.jpeg)

元にしたのは、次のような思いつきのメモです。

> 原稿用紙（400 字詰め）: `ARRAY_FOR(400, ...)` でマス目を作り、本文を 1 文字ずつ流し込みます。日報や作文を原稿用紙で出すネタ枠です。改行と禁則処理をどこまでやるかで難易度を調整できます。

このメモを AI に渡して「検討して」と頼むところから始めました。チャットで頼んだことと結果は、次のとおりです。

| # | 頼んだこと | 結果 |
| :--- | :--- | :--- |
| 1 | 上のメモを「検討して」 | `ARRAY_FOR(400)` だけでは改行と禁則を扱えないので、**先に正規表現で行に分ける**方式を提案した。縦書きも含めて試作し、計算式のエンジンで確かめた |
| 2 | 「試作アプリを作成して」（スペースの URL） | アプリ（作文）と項目、テストレコード 3 件、設定ファイル（縦書き・横書きのボタン）を作った |
| 3 | 「用紙１０枚のテストレコードを追加」 | 10 枚分では計算式が**エンジンの評価回数の上限**で止まった。1 行分のマスをまとめて作る形に直した |
| 4 | 「対応していないことをテストレコードに追加して」 | 未対応の 6 項目を 1 件ずつのレコードにした。**𠮷 や絵文字で枠がはみ出す**ことが見つかった |
| 5 | 「設定ファイルを作り直し」 | 正規表現に `u` フラグを付けて、𠮷 や絵文字を 1 マスに出せるようにした |
| 6 | 「96 dpi 版を追加して」 | ボタンを 4 つにした。20 枚の PDF が約 10.0MB から約 5.1MB になった |
| 7 | 「版権の切れた小説を追加できるか？ 吾輩は猫であるの冒頭など」 | 青空文庫から『吾輩は猫である』と『羅生門』の冒頭を取り出し、テストレコードにした |

使ったのは、印刷屋プラグイン Ver.7、Claude Code（Claude デスクトップアプリの Code タブ）、印刷屋 MCP 0.2.0（資料を引く）、tools 2.0.2（検査とプレビュー）です。アプリの作成とレコードの登録は、kintone の MCP サーバーで AI が行いました。

---

# 1. 1 文字ずつ流し込むだけでは足りない

メモの `ARRAY_FOR(400, …)` は、400 マスを 1 つずつ作る関数です。改行も禁則も無ければ、本文の n 文字目を n 番目のマスに入れるだけで済みます。

ところが、改行や禁則があると、**ある文字がどのマスに入るかは、それより前の行の折り返し方で決まります**。段落の終わりで行が余ったり、句読点を前の行にぶら下げたりするたびに、後ろの文字の位置がずれていくからです。マスごとに独立して計算する `ARRAY_FOR` だけでは、このずれを扱えません。

そこで AI は、次の 2 段に分けることを提案しました。

1. 本文を、正規表現で **1 行（20 マス）ずつの配列**に分ける。改行と禁則はここで扱う
2. 行の配列を 20 行ずつ用紙に並べ、各行を 20 マスにする

難しさは、1 段目の正規表現を差し替えるだけで変えられます。

| 段階 | できること | 1 段目の正規表現 |
| :--- | :--- | :--- |
| 1 | 改行を無視して流し込む | （正規表現を使わず、`SPLIT(本文, "")` を並べる） |
| 2 | 改行で段落を分ける（空行も残す） | `.{1,20}\|^$` |
| 3 | 行の頭に来る句読点・閉じ括弧を、前の行にぶら下げる | `.{1,20}[、。」』）]{0,2}\|^$` |
| 4 | 3 に加え、20 マス目の開き括弧を次の行へ送る | 2 章の式 |

今回は段階 4 まで作りました。

---

# 2. 正規表現 1 本で行に分ける

行に分ける式は、次のとおりです。

```text
kin, ".{1,19}(?:(?![「『（【〔]).)?[、。，．」』）】〕]{0,2}|^$",
lines, ARRAY(CONCAT("　　", tt), CONCAT(JOIN(ARRAY_FOR(19 - LENGTH(nm), "　"), ""), nm), "", MATCH(body, kin, "gmu")),
```

`MATCH` に `g` フラグを付けると、合った部分がすべて配列で返ります。正規表現の意味は次のとおりです。

| 部分 | 意味 |
| :--- | :--- |
| `.{1,19}` | 1〜19 文字。`.` は改行に合わないので、段落の終わりで行が切れる |
| `(?:(?![「『（【〔]).)?` | 20 文字目。ただし開き括弧なら取らない（次の行へ送る） |
| `[、。，．」』）】〕]{0,2}` | 続く句読点・閉じ括弧を 2 つまで、同じ行に入れる（ぶら下げ） |
| `\|^$` | 空行（`m` フラグで、行の頭と終わりに合う） |

次の 3 つの例で、行の分かれ方は次のようになります（1 マス目の全角空白は字下げ）。

| 本文 | 分かれ方 |
| :--- | :--- |
| `　ぼくは朝ごはんにパンと目玉焼きを食べた。それから…` | 21 文字目の「。」を前の行にぶら下げる |
| `　ぼくが「おはよう」と言うと妹は笑って「おそいよ」…` | 20 マス目に来る「「」を次の行へ送り、20 マス目は空ける |
| `「今日はとてもいい天気だから公園に行こう。」と…` | 21・22 文字目の「。」」を 2 つともぶら下げる |

ぶら下げた文字（21・22 文字目）は、マスの外に置きます。縦書きなら行の下、横書きなら行の右で、どちらも外枠の内側です。

![ぶら下げと開き括弧の送り（縦書き、tools のプレビュー）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/f48096aa-58f6-4db8-b39a-ac675575eab0.jpeg)

![ぶら下げと開き括弧の送り（横書き、tools のプレビュー）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/f3528874-2a43-48d0-ad93-3d1686568fa1.jpeg)

テストレコード 1 を tools のプレビューで開いたものです。縦書きでは行の下、横書きでは行の右に、ぶら下げた「。」と「。」」が出ています。「「おそいよ」」の「「」は次の行の頭に送られ、前の行の 20 マス目は空いています。

ほかに、次の 3 つを式の頭で済ませています。

- 本文は `JIS(本文, "anms")` で、半角の英数字・記号・空白を全角にする（1 マス 1 文字にするため）
- 1 行目は題名で、頭を 2 マス空ける。2 行目は氏名で、下を 1 マス空けて寄せる。3 行目は空ける（このため、1 枚目の本文は 17 行・340 マスまで。改行や禁則があれば、入る字数はもっと減る）
- 用紙の枚数は `CEIL(行数 / 20, 0)`。1 枚の HTML を雛形にして、枚数だけ並べる

なお、この禁則処理は簡易なものです。ぶら下げるのは 2 文字まで、対象は正規表現に並べた句読点と括弧だけで、「……」「――」のような 2 マスで一組の記号も扱いません（7 章）。

---

# 3. 縦書きは、マスを右から並べて字を動かす

印刷屋は、ページを html2canvas で画像にしてから PDF にします。html2canvas は CSS の `writing-mode`（縦書き）に対応していないので、使いませんでした。代わりに、次のようにしています。

- **行の並べ方**: 行を `display: flex; flex-direction: row-reverse` で右から左へ並べ、行の中のマスは上から下へ並べる
- **字の向き**: 字は 1 字ずつ横書きのまま置き、縦書きで向きや位置が変わる字だけ CSS で直す

| 字 | 縦書きでの直し方 | CSS |
| :--- | :--- | :--- |
| 、。，． | マスの右上へ動かす | `transform: translate(0.58em, -0.55em)` |
| ー…「」（）【】など | 90 度回す | `transform: rotate(90deg)` |
| ぁぃぅっゃゅょ など | 少し右上へ動かす | `transform: translate(0.12em, -0.12em)` |

どの字を直すかは、計算式の最後に `REPLACERE` で class を付けて決めます。

```text
REPLACERE(REPLACERE(REPLACERE(pages,
  "<span class='gk-ch'>([、。，．])", "g", "<span class='gk-ch gk-p'>$1"),
  "<span class='gk-ch'>([ー－―‐…‥〜～「」『』（）【】〔〕［］＝：；])", "g", "<span class='gk-ch gk-r'>$1"),
  "<span class='gk-ch'>([ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ])", "g", "<span class='gk-ch gk-s'>$1")
```

計算式は縦書きと横書きで同じで、違うのは CSS だけです。横書きの CSS には `gk-p` などの直しを書いていないので、class が付いていても字はそのままです。縦書きには、10 行目と 11 行目の間に柱（◆）も付けました。

```css
.gk-sheet { flex-direction: row-reverse; padding-bottom: calc(9 * var(--mm)); }
.gk-line { flex-direction: column; }
.gk-line:nth-child(10) { margin-left: calc(12 * var(--mm)); }
.gk-p { transform: translate(0.58em, -0.55em); }
.gk-r { transform: rotate(90deg); }
.gk-s { transform: translate(0.12em, -0.12em); }
```

実機の PDF でも、回した字と動かした字はそのまま描かれました（6 章の画像）。

---

# 4. 150 dpi では CSS の mm が実寸にならない

最初の試作は、マスの大きさを `9mm` のように mm で書いていました。ところが、tools のプレビューで、マス目は用紙の 6 割ほどの大きさにしかなりませんでした。

印刷屋のページは、dpi で決まる px の大きさです。A4 横は、150 dpi で 1754×1240px になります。一方、CSS の `1mm` は 96 dpi で換算した 3.78px なので、**150 dpi では実寸の約 64%** になります。

そこで、1 mm を表す変数 `--mm` を置き、寸法をすべて `calc(N * var(--mm))` で書きました。

| dpi | `--mm` | A4 横のページ |
| :--- | :--- | :--- |
| 150 | `5.906px` | 1754×1240px |
| 96 | `3.78px` | 1123×794px |

96 dpi 版のボタンは、計算式も HTML も 150 dpi 版と同じで、dpi と `--mm` だけを変えています。

---

# 5. つまずき（計算式のエンジンの性質）

ここからは、帳票の見た目ではなく、実際に作って動かしてみないと分からなかった計算式のエンジンの性質と、その対処です。どれも、印刷屋 Ver.7 の zip に入っている計算式のエンジンを tools から動かして確かめたもので、ほかの版でも同じかは確かめていません。

## 5.1 印刷屋の計算式では、`&` が関数の結果の前後の空白を削る

氏名を下に寄せるため、氏名の前に全角空白を詰めていました。ところが、氏名が上に寄ったままでした。小さな式で確かめると、印刷屋の計算式の `&` は**関数の結果を直接つなぐとき、前後の空白を削ります**（空白だけなら空になる）。一般の文字列の連結とは違う動きです。

| 式 | 結果 |
| :--- | :--- |
| `"[" & IF(1=1, " a ", "") & "]"` | `[a]` |
| `"[" & LEFT(" a ", 3) & "]"` | `[a]` |
| `"[" & " a " & "]"` | `[ a ]` |
| `LET(v, IF(1=1, " a ", ""), "[" & v & "]")` | `[ a ]` |
| `CONCAT("[", IF(1=1, " a ", ""), "]")` | `[ a ]` |

文字列をそのまま書いた場合、LET の変数を通した場合、`CONCAT` でつないだ場合は削られません。

同じ原因で、class 名の区切りの空白も消えていました。`"<div class='gk-cell" & IF(…, " gk-out", "")` が `gk-cellgk-out` になり、ぶら下げた文字が普通のマスとして並んだため、ぶら下げのある 1 ページ目だけ枠が縦に伸び、フッターが切れていました。

直し方は 2 つです。

- 空白で詰めるところは `CONCAT` でつなぐ
- class の区切りの空白は文字列の側に書く（`"<div class='gk-cell " & IF(…, "gk-out", "")`）

## 5.2 10 枚で、エンジンの評価回数の上限に当たる

最初の式は、1 マスごとに `MID` で 1 文字を取り出し、`IF` と `FIND` で縦書きの直しが要る字かを調べていました。2 枚までは通りましたが、10 枚（4,000 マス）のレコードで次のエラーになりました。

```text
traverse tree check count > 100000 over.
```

今回のエンジンでは、1 つの式の評価回数に 10 万回の上限があるようです（エラーの文から読み取ったもので、資料では確かめていません）。tools のプレビューでは、エラーになるまでに約 2 分かかりました。

そこで、**1 行分のマスを `REPLACERE` でまとめて作る**形に変えました。置き換える文字列には `$1`（合った部分）が使えます。

```text
cell, "<div class='gk-cell'><span class='gk-ch'>$1</span></div>",
rows, ARRAY_MAP(lines, ln, CONCAT(
  REPLACERE(ESC_HTML(LEFT(CONCAT(ln, sp), 20)), "(&[#0-9a-zA-Z]+;|.)", "gu", cell),
  REPLACERE(ESC_HTML(MID(ln, 21, 2)), "(&[#0-9a-zA-Z]+;|.)", "gu", hang))),
```

- `sp` は 20 マス分の全角空白で、短い行の残りのマスを埋める
- `ESC_HTML` の後の `&lt;` などは 1 マスとして扱う（`&[#0-9a-zA-Z]+;`）
- 縦書きの直しの class は、3 章のとおり最後にまとめて付ける

繰り返しは「用紙 × 20 行」までになり、tools のプレビューは 10 枚で約 1.3 秒、20 枚で約 4.4 秒になりました。

## 5.3 𠮷 や絵文字が、2 マスに割れる

未対応のテストとして、𠮷・𩸽・😀 を入れたレコードを作りました。tools のプレビューで確かめると、1 字が 2 マスの「�」に割れて字が消え、横書きでは枠が用紙の右にはみ出していました。

調べると、**数え方が関数によって違って**いました。

| 式 | 結果 | 数え方 |
| :--- | :--- | :--- |
| `LENGTH("𠮷田")` | 2 | 𠮷 を 1 文字 |
| `ARRAY_COUNT(MATCH("𠮷田𩸽", ".", "g"))` | 5 | 𠮷 を 2 文字 |
| `ARRAY_COUNT(MATCH("𠮷田𩸽", ".", "gu"))` | 3 | 𠮷 を 1 文字 |

`LENGTH`・`LEFT`・`MID` は 𠮷 を 1 文字と数えますが、正規表現は `u` フラグが無いと 2 文字と数えます。行に分ける正規表現が 𠮷 を 2 文字と数え、空白で詰める `LEFT` は 1 文字と数えたので、その行のマスが 20 を超えていました。

`MATCH` を `"gmu"`、マスを作る `REPLACERE` を `"gu"` にすると、𠮷・𩸽・😀 は 1 マスに出るようになりました。

ただし、`u` フラグで 1 マスになるのは、1 つのコードポイント（Unicode の文字番号）でできた字だけです。複数のコードポイントでできた字は、コードポイントの数だけマスに分かれます。

| 字 | マスの数 |
| :--- | ---: |
| 家族の絵文字（👨‍👩‍👧） | 5 |
| 国旗（🇯🇵） | 2 |
| 異体字セレクター付きの字（葛󠄀） | 2 |
| 結合文字の濁点（か゛を 2 つのコードポイントで書いたもの） | 2 |

![𠮷・𩸽・😀 が 1 マスずつ出ている（直したあと、実機の PDF）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/4a171d50-9af6-453a-b96f-b2f496cd5af5.png)

---

# 6. テストレコードと実機の PDF

## 6.1 アプリ

アプリは AI が作りました。項目は次のとおりです。

| フィールドコード | 種類 | 内容 |
| :--- | :--- | :--- |
| `日付` | 日付 | フッターに出す |
| `題名` | 文字列（1 行） | 18 字まで（頭を 2 マス空けるため） |
| `氏名` | 文字列（1 行） | 19 字まで（下を 1 マス空けるため） |
| `本文` | 文字列（複数行） | 段落の頭の字下げは、全角の空白で入れる |

## 6.2 テストレコード

| # | 題名 | ねらい |
| :--- | :--- | :--- |
| 1 | 早起きした日 | ぶら下げと開き括弧の送り（2 章の 3 つの例）。2 枚 |
| 2 | 業務日報　１０月１４日 | 【】と「・」が入った日報 |
| 3 | 空 | 氏名が空、本文が 1 行 |
| 4 | 夏休みの日記 | 10 枚（35 日分、3,333 字） |
| 5 | 未対応１　数字の書き方 | 全角・半角の数字と、比べるための漢数字 |
| 6 | 未対応２　２マスの記号 | 「……」「――」が 20・21 マス目にまたがる |
| 7 | 未対応３　閉じる記号の連続 | 21〜23 文字目が「。』」」 |
| 8 | 修正確認４　特殊な文字 | 𠮷・𩸽・😀（5.3 の確認用） |
| 9 | 未対応５　改行と字下げ | 字下げしない段落と、最後の改行 |
| 10 | 未対応６　長い本文 | 20 枚（71 日分、6,734 字） |
| 11 | 吾輩は猫である（冒頭） | 実際の小説の文章。6 枚（2,273 字）。6.4 |
| 12 | 羅生門（冒頭） | 実際の小説の文章。「――」と半角の英字が入る。4 枚（1,212 字）。6.4 |

1〜10 の本文も AI が作りました。禁則が起きる位置に字がちょうど来るよう、文字数を合わせています。11・12 は小説の冒頭です（6.4）。

## 6.3 実機の PDF

10 枚の日記は、10 ページ目が最後の日の「夏休みは、まだまだ続く。」で終わり、フッターは「10 / 10」です。

![夏休みの日記（10 ページ目）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/9a10ce9c-4f70-42e6-b63e-183d9261aa5c.jpeg)

未対応のレコードは、予想どおりに出ました。

![未対応１: 数字は縦書きでも 1 字ずつ縦に並ぶ。半角も全角に直り、1 字 1 マス](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/4f74a3b6-b247-45e7-93da-5ff09ea707be.jpeg)

![未対応３: 「。』」はぶら下がり、3 つ目の「」」は次の行の頭に来る](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/4ee4e960-de8e-4de3-98a9-22ab8dc4c114.jpeg)

![未対応５（1 ページ目）: 字下げしない段落は 1 マス目から書かれる](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/be77ed0a-e8e1-4e2d-9ffa-b16fbfff5cdb.jpeg)

![未対応５（2 ページ目）: 最後の改行のせいで、2 枚目が白紙で出る](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/12884c76-b46b-4112-9743-b1a24d196865.jpeg)

![未対応２: 「……」「――」が行をまたいで割れる（tools のプレビュー）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/f8b99ae9-a7f3-4a95-a30d-bb8c270c59fb.jpeg)

20 枚のレコードで、150 dpi と 96 dpi を比べました。時間は今回の検証環境での値で、端末やブラウザーによって変わります。

| 版 | 20 枚の PDF | プレビュー | PDF の作成 |
| :--- | :--- | :--- | :--- |
| 150 dpi | 約 10.0MB | 4 秒 | 5 秒 |
| 96 dpi | 約 5.1MB | 3 秒 | 5 秒 |

96 dpi でも、罫線・句読点・回した括弧・フッターは問題なく読めました。150 dpi の PDF に入っていたページの画像は 3508×2480px で、ページ（1754×1240px）の 2 倍の大きさでした。

![96 dpi 版（20 枚の 1 ページ目）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/9ae9c81e-abdd-462e-9f62-591304c81cbc.png)

時間は、今回の検証環境では、20 枚でもプレビュー 3〜4 秒、PDF の作成 5 秒でした。ページ数の上限は設定していませんが、実機で確かめたのは 20 枚までです。

## 6.4 著作権の切れた小説

AI が作った文章だけでなく、実際の小説でも試すため、著作権の保護期間が切れた小説の冒頭を 2 件、テストレコードに加えました。作品は、作者の没年（夏目漱石 1916 年、芥川龍之介 1927 年）と初出の年（1905 年、1915 年）から、保護期間が切れているものを選んでいます。本文は青空文庫が公開しているテキストを使いました。

| # | 作品 | 範囲 | 字数 | 用紙 |
| :--- | :--- | :--- | ---: | ---: |
| 11 | 夏目漱石『吾輩は猫である』 | 冒頭の 6 段落（「吾輩は猫である。名前はまだ無い。」から） | 2,273 | 6 枚 |
| 12 | 芥川龍之介『羅生門』 | 冒頭の 5 段落（「ある日の暮方の事である。」から） | 1,212 | 4 枚 |

本文は、青空文庫の XHTML 版の本文から、ふりがな（`rt`・`rp` 要素）を除き、空でない段落を改行でつないで取り出しました。kintone に登録した本文が、この取り出した文字列と 1 文字も違わないことは、SHA-256 のハッシュ値と字数で確かめています。

![吾輩は猫である（冒頭、縦書き、1 ページ目、tools のプレビュー）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/25fe2f00-821e-4fbd-8b8b-a1e5a3b50516.jpeg)

題名の（）は回り、「ニャーニャー」の長音は縦の棒になっています。氏名は下を 1 マス空けて寄せています。

![羅生門（冒頭、縦書き、3 ページ目、tools のプレビュー）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/eccdd223-3f93-4979-9650-2e519903d63b.jpeg)

半角の英字「Sentimentalisme」は、全角に直って 1 字 1 マスで縦に並びます（前後の空白は空きマス）。行の頭に来る「。」「、」は、前の行の下にぶら下がっています。

本文の出典: 青空文庫の[吾輩は猫である](https://www.aozora.gr.jp/cards/000148/card789.html)・[羅生門](https://www.aozora.gr.jp/cards/000879/card127.html)（底本は、ちくま文庫『夏目漱石全集1』『芥川龍之介全集1』。入力・校正は青空文庫の作品ページのとおり）

---

# 7. 対応していないこと

テストレコード 5〜7・9 で確かめた、対応していない点です。

- **数字**: 縦書きでも、数字は 1 字ずつそのまま縦に並ぶ（漢数字にしない）。横書きの「半角 2 字で 1 マス」もしない
- **2 マスの記号**: 「……」「――」が行をまたいで割れる
- **閉じる記号の連続**: ぶら下げるのは 2 つまでで、3 つ目は次の行の頭に来る
- **字下げ**: 段落の頭の字下げは入力まかせ（全角でも半角でも、空白を 1 つ入れれば字下げになる）
- **最後の改行**: 本文の最後が改行だと、空の行が 1 行増える
- **複数のコードポイントでできた字**: 家族の絵文字・国旗・異体字セレクター付きの字などは、複数のマスに分かれる（5.3）
- **そのほかの禁則**: 行頭に来る「ー」や小さい「っ」などは、前の行に送らない（句読点と閉じ括弧だけをぶら下げる）

---

# 8. 設定ファイル

掲載したのは、150 dpi 版の縦書き・横書きのボタン 2 つです。試作では、これに 96 dpi 版を足して 4 つにしました。96 dpi 版は、ボタンを複製して、`dpi` を `"96"` に、CSS の `--mm: 5.906px` を `--mm: 3.78px` に変えると作れます。

使うアプリには、6.1 のフィールドコードが要ります。違う場合は、計算式と HTML の中を書き換えてください。`appId`・`appName` は今回のアプリの値です。

<details><summary>原稿用紙.json（クリックで開く）</summary>

```json
{
  "date": "2026-10-14 00:00:00",
  "pluginName": "印刷屋プラグイン",
  "pluginID": "rex0220 Print craft plugin",
  "PluginVersion": "7",
  "appId": 4323,
  "appName": "作文（原稿用紙）",
  "pluginEnable": true,
  "commonCssEnable": true,
  "externalRefs": "block",
  "pluginInfos": [
    {
      "state": true,
      "menu": "原稿用紙（縦書き）",
      "desc": "作文を原稿用紙に出します",
      "mcheck": true,
      "list": false,
      "authority": false,
      "viewsCsv": "-",
      "tagsInfo": {
        "fieldsInfo": [
          {
            "state": true,
            "desc": "ボタン表示条件",
            "fieldcode": "$out",
            "formulaSet": ""
          },
          {
            "state": true,
            "desc": "ファイル名",
            "fieldcode": "$fname",
            "formulaSet": "\"作文-\" & 題名 & \".pdf\""
          },
          {
            "state": true,
            "desc": "原稿用紙（1 ページの雛形を計算式でページ数だけ並べる）",
            "fieldcode": "",
            "css": "\n.gk-page { --mm: 5.906px; /* 1 mm（150 dpi。96 dpi なら 3.78px） */ --gk-line: #b0563f; --gk-cell: calc(9 * var(--mm)); --gk-gap: calc(3 * var(--mm)); color: #222;\n  font-family: \"Yu Mincho\", \"YuMincho\", \"Hiragino Mincho ProN\", \"MS Mincho\", serif; }\n.gk-wrap { width: fit-content; margin: 0 auto; }\n.gk-sheet { display: flex; gap: var(--gk-gap); border: calc(0.6 * var(--mm)) solid var(--gk-line); padding: calc(2.5 * var(--mm)); }\n.gk-line { display: flex; position: relative; border: calc(0.25 * var(--mm)) solid var(--gk-line); }\n.gk-cell { width: var(--gk-cell); height: var(--gk-cell); display: flex; align-items: center; justify-content: center;\n  font-size: calc(6.4 * var(--mm)); line-height: 1; box-sizing: border-box; }\n.gk-out { position: absolute; border: none !important; }\n.gk-ch { display: inline-block; }\n.gk-foot { display: flex; justify-content: space-between; font-size: calc(3 * var(--mm)); color: var(--gk-line); padding: calc(1.5 * var(--mm)) calc(1 * var(--mm)) 0; }\n\n.gk-page { padding: calc(9 * var(--mm)) 0 0; --gk-cell: calc(8.5 * var(--mm)); }\n.gk-cell { font-size: calc(6 * var(--mm)); }\n/* 1 行目を右に。行は右から左へ。下の余白はぶら下げの分 */\n.gk-sheet { flex-direction: row-reverse; padding-bottom: calc(9 * var(--mm)); }\n.gk-line { flex-direction: column; }\n.gk-cell + .gk-cell { border-top: calc(0.25 * var(--mm)) solid var(--gk-line); }\n/* 柱（10 行目と 11 行目の間） */\n.gk-line:nth-child(10) { margin-left: calc(12 * var(--mm)); }\n.gk-line:nth-child(10)::after { content: \"◆\"; position: absolute; left: calc(-7.6 * var(--mm)); top: 50%; transform: translateY(-50%);\n  font-size: calc(3 * var(--mm)); color: var(--gk-line); }\n/* ぶら下げ: 行の下の外（外枠の内） */\n.gk-out { left: 0; top: calc(var(--gk-cell) * 20); height: calc(var(--gk-cell) * 0.5); align-items: flex-start; }\n.gk-out + .gk-out { top: calc(var(--gk-cell) * 20.45); }\n/* 縦書きの字形（html2canvas は writing-mode を描かないので、横書きの字を動かす・回す） */\n.gk-p { transform: translate(0.58em, -0.55em); }\n.gk-r { transform: rotate(90deg); }\n.gk-s { transform: translate(0.12em, -0.12em); }\n.gk-foot { flex-direction: row-reverse; }\n",
            "html": "<div class=\"rex0220-pcraft-page gk-page\">\n  <div class=\"gk-wrap\">\n    <div class=\"gk-sheet\">##sheet##</div>\n    <div class=\"gk-foot\"><span>${DATE_FORMAT(日付, \"YYYY年M月D日\")}</span><span>20×20</span><span>#{&p} / #{&n}</span></div>\n  </div>\n</div>",
            "formulaSet": "LET(\n  // 半角の英数字・記号・空白を全角に（1 マス 1 文字）\n  body, JIS(本文, \"anms\"),\n  // 1 行 20 マス。改行で段落を分け、20 字で折る。\n  //   行末禁則: 20 マス目の開き括弧は次の行へ送る\n  //   行頭禁則: 次の行の頭に来る句読点・閉じ括弧（2 つまで）は前の行にぶら下げる（21・22 文字目）\n  //   ^$ は空行（m フラグ）。u フラグで 𠮷 や絵文字を 1 文字と数える（LEFT / MID / LENGTH と同じ数え方）\n  kin, \".{1,19}(?:(?![「『（【〔]).)?[、。，．」』）】〕]{0,2}|^$\",\n  tt, LEFT(JIS(題名, \"anms\"), 18),\n  nm, LEFT(JIS(氏名, \"anms\"), 19),\n  // 1 行目は題名（2 マス空ける）、2 行目は氏名（下を 1 マス空ける）、3 行目を空けて本文\n  // & は関数の結果の前後の空白を削る（空白だけなら空になる）ので、空白を詰めるところは CONCAT でつなぐ\n  lines, ARRAY(CONCAT(\"　　\", tt), CONCAT(JOIN(ARRAY_FOR(19 - LENGTH(nm), \"　\"), \"\"), nm), \"\", MATCH(body, kin, \"gmu\")),\n  cnt, ARRAY_COUNT(lines),\n  np, CEIL(cnt / 20, 0),\n  // 20 マス分の全角空白（行の足りないマスを埋める）\n  sp, \"　　　　　　　　　　　　　　　　　　　　\",\n  // 1 行の HTML を REPLACERE でまとめて作る（1 マスずつ作ると、10 枚ほどでエンジンの評価回数の上限 10 万に掛かる）\n  //   1〜20 文字目はマス、21・22 文字目（ぶら下げ）は gk-out。ESC_HTML の後の &…; は 1 マス\n  ch1, \"(&[#0-9a-zA-Z]+;|.)\",\n  cell, \"<div class='gk-cell'><span class='gk-ch'>$1</span></div>\",\n  hang, \"<div class='gk-cell gk-out'><span class='gk-ch'>$1</span></div>\",\n  rows, ARRAY_MAP(lines, ln, CONCAT(\n    REPLACERE(ESC_HTML(LEFT(CONCAT(ln, sp), 20)), ch1, \"gu\", cell),\n    REPLACERE(ESC_HTML(MID(ln, 21, 2)), ch1, \"gu\", hang))),\n  blank, REPLACERE(sp, \"(.)\", \"g\", cell),\n  pages, JOIN(ARRAY_FOR(np, pg, REPLACE($html, \"##sheet##\",\n    JOIN(ARRAY_FOR(20, li, \"<div class='gk-line'>\" & IF(pg * 20 + li < cnt, ARRAY_GET(rows, pg * 20 + li), blank) & \"</div>\"), \"\"))), \"\"),\n  // 縦書きで向き・位置を変える文字の印（横書きの CSS は使わない）\n  REPLACERE(REPLACERE(REPLACERE(pages,\n    \"<span class='gk-ch'>([、。，．])\", \"g\", \"<span class='gk-ch gk-p'>$1\"),\n    \"<span class='gk-ch'>([ー－―‐…‥〜～「」『』（）【】〔〕［］＝：；])\", \"g\", \"<span class='gk-ch gk-r'>$1\"),\n    \"<span class='gk-ch'>([ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ])\", \"g\", \"<span class='gk-ch gk-s'>$1\")\n)"
          }
        ],
        "filecode": "",
        "pageSize": "A4",
        "orientation": "l",
        "dpi": "150",
        "printMode": "preview"
      },
      "calcInfo": {
        "fieldsInfo": []
      }
    },
    {
      "state": true,
      "menu": "原稿用紙（横書き）",
      "desc": "作文を原稿用紙に出します",
      "mcheck": true,
      "list": false,
      "authority": false,
      "viewsCsv": "-",
      "tagsInfo": {
        "fieldsInfo": [
          {
            "state": true,
            "desc": "ボタン表示条件",
            "fieldcode": "$out",
            "formulaSet": ""
          },
          {
            "state": true,
            "desc": "ファイル名",
            "fieldcode": "$fname",
            "formulaSet": "\"作文-\" & 題名 & \".pdf\""
          },
          {
            "state": true,
            "desc": "原稿用紙（1 ページの雛形を計算式でページ数だけ並べる）",
            "fieldcode": "",
            "css": "\n.gk-page { --mm: 5.906px; /* 1 mm（150 dpi。96 dpi なら 3.78px） */ --gk-line: #b0563f; --gk-cell: calc(9 * var(--mm)); --gk-gap: calc(3 * var(--mm)); color: #222;\n  font-family: \"Yu Mincho\", \"YuMincho\", \"Hiragino Mincho ProN\", \"MS Mincho\", serif; }\n.gk-wrap { width: fit-content; margin: 0 auto; }\n.gk-sheet { display: flex; gap: var(--gk-gap); border: calc(0.6 * var(--mm)) solid var(--gk-line); padding: calc(2.5 * var(--mm)); }\n.gk-line { display: flex; position: relative; border: calc(0.25 * var(--mm)) solid var(--gk-line); }\n.gk-cell { width: var(--gk-cell); height: var(--gk-cell); display: flex; align-items: center; justify-content: center;\n  font-size: calc(6.4 * var(--mm)); line-height: 1; box-sizing: border-box; }\n.gk-out { position: absolute; border: none !important; }\n.gk-ch { display: inline-block; }\n.gk-foot { display: flex; justify-content: space-between; font-size: calc(3 * var(--mm)); color: var(--gk-line); padding: calc(1.5 * var(--mm)) calc(1 * var(--mm)) 0; }\n\n.gk-page { padding: calc(14 * var(--mm)) 0 0; }\n/* 右の余白はぶら下げの分 */\n.gk-sheet { flex-direction: column; padding-right: calc(10 * var(--mm)); }\n.gk-line { flex-direction: row; }\n.gk-cell + .gk-cell { border-left: calc(0.25 * var(--mm)) solid var(--gk-line); }\n/* ぶら下げ: 行の右の外（外枠の内） */\n.gk-out { top: 0; left: calc(var(--gk-cell) * 20); width: calc(var(--gk-cell) * 0.5); justify-content: flex-start; }\n.gk-out + .gk-out { left: calc(var(--gk-cell) * 20.5); }\n",
            "html": "<div class=\"rex0220-pcraft-page gk-page\">\n  <div class=\"gk-wrap\">\n    <div class=\"gk-sheet\">##sheet##</div>\n    <div class=\"gk-foot\"><span>${DATE_FORMAT(日付, \"YYYY年M月D日\")}</span><span>20×20</span><span>#{&p} / #{&n}</span></div>\n  </div>\n</div>",
            "formulaSet": "LET(\n  // 半角の英数字・記号・空白を全角に（1 マス 1 文字）\n  body, JIS(本文, \"anms\"),\n  // 1 行 20 マス。改行で段落を分け、20 字で折る。\n  //   行末禁則: 20 マス目の開き括弧は次の行へ送る\n  //   行頭禁則: 次の行の頭に来る句読点・閉じ括弧（2 つまで）は前の行にぶら下げる（21・22 文字目）\n  //   ^$ は空行（m フラグ）。u フラグで 𠮷 や絵文字を 1 文字と数える（LEFT / MID / LENGTH と同じ数え方）\n  kin, \".{1,19}(?:(?![「『（【〔]).)?[、。，．」』）】〕]{0,2}|^$\",\n  tt, LEFT(JIS(題名, \"anms\"), 18),\n  nm, LEFT(JIS(氏名, \"anms\"), 19),\n  // 1 行目は題名（2 マス空ける）、2 行目は氏名（下を 1 マス空ける）、3 行目を空けて本文\n  // & は関数の結果の前後の空白を削る（空白だけなら空になる）ので、空白を詰めるところは CONCAT でつなぐ\n  lines, ARRAY(CONCAT(\"　　\", tt), CONCAT(JOIN(ARRAY_FOR(19 - LENGTH(nm), \"　\"), \"\"), nm), \"\", MATCH(body, kin, \"gmu\")),\n  cnt, ARRAY_COUNT(lines),\n  np, CEIL(cnt / 20, 0),\n  // 20 マス分の全角空白（行の足りないマスを埋める）\n  sp, \"　　　　　　　　　　　　　　　　　　　　\",\n  // 1 行の HTML を REPLACERE でまとめて作る（1 マスずつ作ると、10 枚ほどでエンジンの評価回数の上限 10 万に掛かる）\n  //   1〜20 文字目はマス、21・22 文字目（ぶら下げ）は gk-out。ESC_HTML の後の &…; は 1 マス\n  ch1, \"(&[#0-9a-zA-Z]+;|.)\",\n  cell, \"<div class='gk-cell'><span class='gk-ch'>$1</span></div>\",\n  hang, \"<div class='gk-cell gk-out'><span class='gk-ch'>$1</span></div>\",\n  rows, ARRAY_MAP(lines, ln, CONCAT(\n    REPLACERE(ESC_HTML(LEFT(CONCAT(ln, sp), 20)), ch1, \"gu\", cell),\n    REPLACERE(ESC_HTML(MID(ln, 21, 2)), ch1, \"gu\", hang))),\n  blank, REPLACERE(sp, \"(.)\", \"g\", cell),\n  pages, JOIN(ARRAY_FOR(np, pg, REPLACE($html, \"##sheet##\",\n    JOIN(ARRAY_FOR(20, li, \"<div class='gk-line'>\" & IF(pg * 20 + li < cnt, ARRAY_GET(rows, pg * 20 + li), blank) & \"</div>\"), \"\"))), \"\"),\n  // 縦書きで向き・位置を変える文字の印（横書きの CSS は使わない）\n  REPLACERE(REPLACERE(REPLACERE(pages,\n    \"<span class='gk-ch'>([、。，．])\", \"g\", \"<span class='gk-ch gk-p'>$1\"),\n    \"<span class='gk-ch'>([ー－―‐…‥〜～「」『』（）【】〔〕［］＝：；])\", \"g\", \"<span class='gk-ch gk-r'>$1\"),\n    \"<span class='gk-ch'>([ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ])\", \"g\", \"<span class='gk-ch gk-s'>$1\")\n)"
          }
        ],
        "filecode": "",
        "pageSize": "A4",
        "orientation": "p",
        "dpi": "150",
        "printMode": "preview"
      },
      "calcInfo": {
        "fieldsInfo": []
      }
    }
  ]
}
```

</details>

---

# 気を付ける点

- 改行や禁則で後ろの文字の位置が変わるときは、マスごとに計算しない。正規表現で行に分けてから並べる
- 縦書きは `writing-mode` を使わず、マスを右から並べ、句読点や括弧を CSS の `transform` で動かす・回す
- 150 dpi のページでは、CSS の mm は実寸にならない。`--mm` のような変数で換算する
- 印刷屋の計算式の `&` は、関数の結果の前後の空白を削る。空白を残したいときは `CONCAT` でつなぐか、空白を文字列の側に書く
- 1 文字・1 マスごとに関数を呼ぶ繰り返しは、長い本文でエンジンの評価回数の上限（10 万）に当たる。`REPLACERE` で行ごとにまとめる
- 正規表現で 1 文字ずつ数えるときは `u` フラグを付ける（`LENGTH`・`LEFT`・`MID` と数え方をそろえる）。それでも、複数のコードポイントでできた字は 1 マスにならない
- 検査とプレビューが通っても、長い本文や特殊な文字は、テストレコードを作って確かめる

---

# まとめ

- 作文・日報の本文を、20×20 の原稿用紙の PDF にした。縦書き（A4 横）と横書き（A4 縦）、150 dpi と 96 dpi のボタンを用意した
- `ARRAY_FOR(400)` で 1 文字ずつ流し込む代わりに、正規表現 1 本で行に分け、改行・行頭のぶら下げ・行末の開き括弧の送りを扱った
- 縦書きは、マスを右から並べ、句読点や括弧を CSS で動かす・回すことで、html2canvas でも描けた
- 試作の中で、印刷屋の計算式について、`&` が空白を削ること、評価回数の上限が 10 万回であること、正規表現の数え方が違うこと（`u` フラグ）が分かった
- 20 枚の PDF は、150 dpi で約 10MB、96 dpi で約 5MB。作成は、今回の検証環境ではどちらも 5 秒ほどだった。数字の漢数字化や 2 マスの記号は、今回は対応していない
- メモから完成まで、設計・アプリと設定の作成・テストデータ・不具合の調査と直しは AI に任せた。人が行ったのは、作りたいものとテストの条件を頼むことと、実機の PDF を見て確かめることだった

シリーズ「rex0220 印刷屋プラグイン - AI(Claude Desktop)に〜」:

1. [チャットで帳票を作らせる](https://qiita.com/rex0220/items/8cbebab5a5f8a9c21b1f)
2. [帳票のデザインを作り込ませる](https://qiita.com/rex0220/items/43ceafa584690b4b0a5b)
3. [見積書から注文書・請求書を作らせる](https://qiita.com/rex0220/items/eae546dc726e7c61512f)
4. [組織図を設計させてから、アプリを作らせる](https://qiita.com/rex0220/items/6e739ace80cffd2ad70a)
5. [QRコード付きの資産ラベルを作らせる](https://qiita.com/rex0220/items/a649d70314361b964cd2)
6. [写真付きの点検報告書を作らせる](https://qiita.com/rex0220/items/b10502d8d23373820aab)
7. [ガントチャートアプリの工程表を作らせる（関連レコード一覧に対応した Ver.8）](https://qiita.com/rex0220/items/f48cf8d9a89cb1971e41)
8. [休日アプリから年間カレンダーを作らせる](https://qiita.com/rex0220/items/0a6be4bdb34ebb2986c6)
9. **作文を原稿用紙（400 字詰め）の PDF にさせる（この記事）**
10. [「あなたが生まれた日の太陽系」カードを作らせる](https://qiita.com/rex0220/items/acc7467aef9bb6a37325)

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [帳票レシピ集とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
