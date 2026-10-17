<!--
title: rex0220 印刷屋プラグイン - AI に業務データから「番付表」を作らせる（PC に入れた相撲字の書体と縦書き）
tags:
  - kintone
  - Claude
  - MCP
private: false
url: https://qiita.com/rex0220/items/de341ab43b4c40bf61c1（2026-10-15 公開）
-->

[前回の記事](https://qiita.com/rex0220/items/acc7467aef9bb6a37325) では、生年月日から惑星の位置を計算して誕生日カードを描きました。今回は、**部署の違う社員を目標達成率で格付けし、大相撲の番付表のような PDF にする帳票**です。

できあがったのは、下の番付表です。達成率の高い順に、東横綱・西横綱・東大関…と割り当て、地位が上ほどしこ名を大きく太く描いています。書体は、PC に入れた相撲字風の書体「Sumo Trial」です。

![令和八年 秋場所（21 人。A3 横、実機の PDF）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/5ec41be3-0132-49bd-b5d6-bdbf3936436b.jpeg)

この記事の見どころは、次の 3 つです。

- 達成率で並べる・東西に分ける・同じ達成率の順を決める・成績を漢数字にする、をすべて計算式で行った（2 章）
- Web フォントを使わず、PC に入れた書体を帳票の CSS で指定した。入っていない PC での見え方も確かめた（4 章）
- テーブルを読む式が「行の数だけ繰り返される」など、計算式のエンジンの性質を小さな式で突き止めた（6 章）

記事の最後に、番付表のボタンの設定 JSON を載せています。書体が入っていない PC でも、明朝体の番付表として試せます。

元にしたのは、次のような依頼文です（要約）。

> 印刷屋プラグインで、業務データから「番付表」を作る帳票例を作って。書体は、この PC に入れた相撲字風の書体「Sumo Trial」を使う（Web フォントの配信はしない）。
> - 部署の違う社員を、目標達成率で格付けする。テストデータは架空の名前と数値
> - アプリは 1 レコード = 1 場所（例: 令和八年 秋場所 = 2026 年 7〜9 月）。テーブルに氏名・しこ名・部署（＝部屋）・目標・実績。テストレコードは 20 人前後と、人数の少ない場所の 2 件
> - 達成率の高い順に、東横綱・西横綱・東大関・西大関・関脇・小結・前頭筆頭・前頭二枚目…。東西は交互。同じ達成率のときの決め方も決める。成績は漢数字（百二十％）
> - A3 横。右が東、左が西、中央に「蒙御免」と場所名。縦書きは 1 字ずつ縦に並べる（html2canvas は writing-mode に対応しない）
> - 地位が上ほど大きく太く。前頭は下の段に小さく。部署はしこ名の上に小さく。人数が少なくても空きが不自然にならないように
> - 割り当てを計算式で試し、エンジンで確かめてから帳票に組む。プレビューの PDF で、重なり・はみ出し・縦の並びを確かめる

この依頼文を AI に渡すところから始めました。チャットで頼んだことと結果は、次のとおりです。

| # | 頼んだこと | 結果 |
| :--- | :--- | :--- |
| 1 | 上の依頼文 | アプリを作るスペースの URL が空欄だったので、AI が聞いてきた（前回までと同じスペースにした）。アプリ・テストレコード 2 件・割り当ての確かめ用の設定・番付表の設定を作った。途中で、**テーブルを読む式が評価回数の上限に掛かる**、**LET に入れた偽が真になる**ことを見つけて直した。手元で印刷屋と同じ手順の PDF を作り、重なり・はみ出しを確かめた |
| 2 | （実機の PDF 2 件を見せる） | 手元で作った PDF と画素で比べ、同じに描かれていることを確かめた |
| 3 | 「qiita 記事を作成して」 | この記事 |

使ったのは、印刷屋プラグイン Ver.8、Claude Code（Claude デスクトップアプリの Code タブ）、印刷屋 MCP 0.2.0（資料・検査・プレビュー。中核は tools 2.1.0）です。アプリの作成とレコードの登録は、kintone の MCP サーバーで AI が行いました。

---

# 1. アプリとテストデータ

アプリは「番付表（目標達成率）」です。1 レコードが 1 場所（四半期）です。

| フィールドコード | 型 | 中身 |
| :--- | :--- | :--- |
| `場所名` | 文字列 1 行（12 字まで） | 令和八年　秋場所 |
| `期間開始`・`期間終了` | 日付 | 2026-07-01、2026-09-30 |
| `社員` | テーブル | 氏名、しこ名（5 字まで）、部署（5 字まで）、単位、目標、実績 |
| `番付表PDF` | 添付ファイル | PDF の保存先 |

「単位」は帳票に出しません。営業は売上（万円）、製造は生産数（個）、総務と開発は件数、物流は箱数と、部署ごとに目標の単位が違うことを、アプリの画面で見せるために置きました。

達成率で比べると単位の違いはそろいますが、100％ を達成する難しさは部署ごとに違います。この記事の番付は帳票の見本で、データは架空です（7 章）。

テストレコードは 2 件です。

- **令和八年 秋場所**: 21 人、6 部署（営業・製造・総務・開発・物流・品質保証）。わざと次のような人を入れた
  - 同じ達成率（115％）の 2 人（受注錦が 2 行目、出荷富士が 17 行目）
  - 表示がどちらも「百四％」になる 2 人（備品丸 104.58％、新規海 104.2％）
  - 5 字のしこ名（再発防止山）、5 字の部署（品質保証部）、ちょうど百％の人
- **令和八年 夏場所**: 6 行。うち 1 人は目標が空（番付外になる）。番付に載るのは 5 人

名前と数値は架空です。しこ名は、実在の力士と一致しないことを検索で確かめました。氏名も検索し、作曲家と同姓同名だった 1 人を替えました（氏名は帳票には出しません）。

---

# 2. 番付を決める計算式

## 2.1 達成率の高い順に並べる

印刷屋の計算式の `ARRAY_SORT` は、配列の値そのものを並べ替えます。達成率で並べたうえで「何行目の人か」を知りたいので、**並べ替えのキーに、行の番号を埋め込みました**。

```text
keys, ARRAY_FOR(n0, i, LET(tg, ARRAY_GET(tgA, i),
  IF(tg > 0, ROUNDDOWN(ARRAY_GET(acA, i) * 10000 / tg, 0) * 1000 + 999 - i, -1))),
nOk, SUM(ARRAY_MAP(keys, x, IF(x >= 0, 1, 0))),
srt, ARRAY_SORT(ARRAY(keys), 0),
n, MIN(nOk, 32),
ord, ARRAY_FOR(n, k, 999 - MOD(ARRAY_GET(srt, k), 1000)),
```

| 部分 | 意味 |
| :--- | :--- |
| `ROUNDDOWN(実績 * 10000 / 目標, 0)` | 達成率を 0.01％ 単位の整数に（131.25％ → 13125） |
| `* 1000 + 999 - i` | 下 3 桁に行の番号を入れる。同じ達成率なら、上の行（i が小さい）ほどキーが大きい |
| `-1` | 目標が空か 0 の行。番付外 |
| `ARRAY_SORT(ARRAY(keys), 0)` | キーを大きい順に（`ARRAY()` で写してから渡す理由は 6.3） |
| `999 - MOD(キー, 1000)` | 並べた後のキーから、行の番号を取り出す |

**同じ達成率のときは、テーブルの上の行を上位**にしました。部署ごとに単位が違うので、「実績の大きい方」では比べられないからです。達成率は 0.01％ 単位で比べるので、表示が同じ「百四％」でも、104.58％ の人が 104.2％ の人より上になります。

達成率は `実績 × 10000 ÷ 目標` の順に計算します。JavaScript の数では、`実績 ÷ 目標 × 10000` の順だと、たとえば 57 ÷ 100 × 10000 が 5699.999… になり、切り捨てで 1 つずれます（目標 100 の場合だけでも、実績 57・69・113 などがずれました）。先に 10,000 倍してから目標で割る順にすると、確かめた値（整数の実績と目標の組 約 47 万通り、小数 1 桁の実績 10 万通り）では、ずれませんでした。ただし浮動小数点の計算なので、すべての値で保証されるわけではありません。印刷屋のエンジンで同じになるかも確かめていません（今回のテストデータの達成率は、2.4 の確かめ表でずれていませんでした）。

このキーには、次の前提があります。ほかの帳票で使うときは確かめてください。

- テーブルは 1,000 行まで（行の番号を下 3 桁に入れるため。`ARRAY_FOR` も 1,000 個で打ち切る。6.4）
- 達成率は 0.01％ 単位で比べる。それより小さな差は同じ達成率として、上の行を上位にする
- 目標と実績は 0 以上（アプリの数値の項目で、最小値を 0 にしている）。負の実績を許すと、キーが負になって番付外（−1）と同じく外れてしまう（ごくわずかな負の値は、切り捨てで 0％ 扱い）
- キーの値は、達成率 100％ でおよそ 1,000 万。JavaScript の数で正確に扱える範囲（約 9×10^15）に十分収まる

## 2.2 東西と地位

上から k 番目（0 始まり）の人を、次のように割り当てます。

| k | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | … |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 東西（k が偶数なら東） | 東 | 西 | 東 | 西 | 東 | 西 | 東 | 西 | 東 | 西 | 東 | … |
| 地位（k ÷ 2 の切り捨て） | 横綱 | 横綱 | 大関 | 大関 | 関脇 | 関脇 | 小結 | 小結 | 前頭筆頭 | 前頭筆頭 | 前頭二枚目 | … |

同じ地位なら東が上位です。秋場所の 115％ の 2 人は、上の行の受注錦が東関脇、出荷富士が西関脇になりました。

## 2.3 成績を漢数字にする

成績は、達成率を切り捨てた整数を漢数字にします。切り捨てにしたのは、99.6％ を「百％」と書かないためです。

```text
kd, "〇一二三四五六七八九",
kanA, ARRAY_MAP(ARRAY(pct, …), x, LET(
  q1, ROUNDDOWN(x / 1000, 0), q2, MOD(ROUNDDOWN(x / 100, 0), 10), q3, MOD(ROUNDDOWN(x / 10, 0), 10), q4, MOD(x, 10),
  IF(x <= 0, "〇", CONCAT(
    IF(q1 = 0, "", CONCAT(IF(q1 = 1, "", MID(kd, q1 + 1, 1)), "千")),
    IF(q2 = 0, "", CONCAT(IF(q2 = 1, "", MID(kd, q2 + 1, 1)), "百")),
    IF(q3 = 0, "", CONCAT(IF(q3 = 1, "", MID(kd, q3 + 1, 1)), "十")),
    IF(q4 = 0, "", MID(kd, q4 + 1, 1)))))),
```

千・百・十の位が 1 のときは「一」を書きません（「一百十八」でなく「百十八」）。計算式には関数を自分で定義する仕組みがないので、成績と、期間の年月日（令和八年七月一日）と人数をまとめて 1 つの配列にして、`ARRAY_MAP` を 1 回だけ書いています。

## 2.4 エンジンで確かめる

帳票に組む前に、割り当てだけを表にする作業用のボタンを作り、印刷屋 MCP のプレビュー（印刷屋と同じ計算式のエンジン）で確かめました。

![割り当ての確かめ表（秋場所）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/bc042d7a-3874-45d7-a2fb-f1fc86918c40.png)

表の上の `keys` は、行の順に並んでいるはずの値です。それが `sorted` と同じ順になっているのは、6.3 の性質のためです（帳票の式では直しています）。

---

# 3. 番付表を組む

## 3.1 紙面の割り付け

A3 横、96 dpi（1587 × 1123px）です。

- 右半分が東、左半分が西。本物の番付表と同じく、**どちらも外側（紙の端）が上位**で、中央に近いほど下位
- 中央に「蒙御免」、場所名、期間（「自 令和八年七月一日」「至 令和八年九月三十日」）、人数、「千穐万歳大々叶」
- 列の上に地位。前頭の 2 人目からは、本物の番付表と同じく「同」と書く
- 部署はしこ名の上に小さく、成績は列の下に
- 片側 8 人までは 1 段。9 人からは前頭を下の段に置く（2 段）

人数の少ない夏場所（5 人）は 1 段です。字が大きくなり、紙面が埋まります。

![令和八年 夏場所（5 人。目標が空の 1 人は番付外。実機の PDF）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/701463f5-a58e-458c-8f29-467a9b657b23.jpeg)

片側 8 人までを 1 段にしたのは、本物の番付表でも、最上段には横綱から前頭まで（幕内）が並ぶからです。人数の少ない場所で前頭だけを下の段に分けると、下の段がほとんど空になります。

## 3.2 字の大きさと太さ

しこ名の字の大きさは、計算式で段ごとに決めます。

- **高さ**: 段の高さから、地位・部署・成績の分を引き、その段でいちばん長いしこ名が入る大きさ
- **幅**: 上の段は、列の幅を地位の比（横綱 1、大関 0.87、関脇 0.77、小結 0.69、前頭 0.62 から 0.03 ずつ小さく）で分ける。下の段は等分
- 下の段（前頭）は、小結の 0.85 倍まで。枚目が下がるごとに 3％ ずつ小さく

秋場所（2 段）では、横綱 80px、大関 70px、関脇 62px、小結 54px、前頭 40〜34px になりました。夏場所（1 段）では、横綱 168px、大関 146px、関脇 128px です。

印刷屋の HTML では、`${式}` を `style` などの属性の中に書けません。そこで、字の大きさ（`fs-80`）、太さ（`sk-5`）、列の幅（`fg-87`）は **class 名を計算式が選び**、CSS に class を並べておきました。

```css
.fs-14 { font-size: 14px; } .fs-16 { font-size: 16px; } … .fs-168 { font-size: 168px; }
.sk-1 { -webkit-text-stroke: 0.5px #1a1410; } … .sk-6 { -webkit-text-stroke: 3.0px #1a1410; }
.fg-100 { flex-grow: 1; } .fg-87 { flex-grow: 0.87; } .fg-77 { flex-grow: 0.77; } …
```

太さは、`font-weight` でなく**縁取り（`-webkit-text-stroke`）**で付けました。理由は 4.3 に書きます。縁取りの幅は、横綱が字の大きさの 3.5％、大関 2.8％、関脇 2.2％、小結 1.6％、前頭はなしです。168px の字に 5.5px の縁取りを付けたら字が潰れたので、3px までにしています。

## 3.3 縦書き

印刷屋の PDF は、html2canvas で描いた画像です。html2canvas は `writing-mode` に対応しないので、[原稿用紙の記事](https://qiita.com/rex0220/items/bb2649ca3d70264b8242) と同じく、1 字ずつ `<span>`（`display: block`）にして縦に積みます。

今回は、組み上がった HTML の全体に、`REPLACERE` を 1 回だけ掛けました。

```text
v1, REPLACEALL(REPLACERE(frame, "(<[^>]*>)|(&[#0-9a-zA-Z]+;|[^<&])", "gu", "$1<span>$2</span>"), "<span></span>", ""),
v2, REPLACERE(v1, "<span>[ 　]</span>", "g", "<span class='sp'></span>"),
v3, REPLACERE(v2, "<span>([ー－―〜～…‥])</span>", "gu", "<span class='r'>$1</span>"),
```

| 部分 | 意味 |
| :--- | :--- |
| `(<[^>]*>)` | タグ。そのまま残す（後ろに空の `<span></span>` ができるので、`REPLACEALL` で消す） |
| `(&[#0-9a-zA-Z]+;\|[^<&])` | 文字（`&amp;` などの文字参照は 1 字）。`<span>` で囲む |
| `"gu"` | `u` フラグで、𠮷 のような字も 1 字に数える |
| `v2`・`v3` | 空白は半分の高さの空きに、「ー」などは 90° 回す |

字ごとに関数を呼ばないので、人数が増えても評価回数はあまり増えません。注記（下の 1 行）は横書きなので、この置き換えの後に足しています。

## 3.4 人数による組み方

人数を変えた仮のデータで、1 段と 2 段の切り替わりと上限を確かめました（しこ名は「試一ノ海」のような仮のもの）。

![人数による組み方（左上から 40 人、18 人、17 人、9 人。どれも目標なしの 1 人を含む）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/8424f2cb-5e03-44bf-a267-7c3d6bf02e75.jpeg)

- 40 人: 載せるのは上位 32 人（東西 16 人ずつ）まで。中央に「上位三十二名まで 七名は番付外」
- 18 人（番付は 17 人）: 片側 9 人になるので 2 段
- 17 人（番付は 16 人）: 片側 8 人で、1 段の上限
- 9 人（番付は 8 人）: 三役だけ

---

# 4. PC に入れた書体を使う

## 4.1 指定のしかた

書体は、PC に入れた相撲字風の書体「Sumo Trial」です（Noto Serif JP Bold を加工した OFL の試作書体。JIS 第 1・第 2 水準 6,884 字）。書体の作り方は、[次の記事](https://qiita.com/rex0220/items/ffb7caf61c570045d968) にまとめました。印刷屋の Web フォントの設定はオフのままにし、帳票の CSS で指定しました。

```css
.bz-page { box-sizing: border-box; padding: 18px 20px 0; background: #fff; color: #1a1410;
  font-family: "Sumo Trial", "Noto Serif JP", serif; }
```

帳票の右下には、「書体: Sumo Trial（この PC に無いときは Noto Serif JP か明朝体で表示）」と書いています。

## 4.2 Sumo Trial で描かれたか確かめる

印刷屋 MCP のプレビューは Web フォントを読みませんが、PC に入れた書体はそのまま使われます。AI は、プレビューの HTML を Chrome で開き、開発用の機能（CDP の `CSS.getPlatformFontsForNode`）で、**実際に描くのに使われた書体**を数えました。秋場所では、しこ名 70 字・地位・部署・成績・蒙御免・場所名が、すべて「Sumo Trial」で描かれていました。

書体の名前だけを存在しない名前に変えて（入っていない PC のまねをして）描くと、この Mac では「ヒラギノ明朝 ProN」になりました（Noto Serif JP はこの Mac に入っていません）。組み方は同じで、字が細い明朝になります。

![左: Sumo Trial が入っている PC、右: 入っていない PC（この Mac ではヒラギノ明朝）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/3320f7e6-61fe-42a4-bc0e-17db355683a1.jpeg)

## 4.3 書体で気を付けたこと

- **書体が要るのは、PDF を作る PC だけ**: 印刷屋の PDF は、html2canvas が描いた画像（JPEG）です。作った PDF は、書体の入っていない PC で開いても相撲字のままです。逆に、書体の入っていない PC でボタンを押すと、明朝の番付表になります
- **太字にしない**: Sumo Trial は Regular だけの書体です。`font-weight: bold` にすると、ブラウザーが合成の太字にして、さらに太くなります。地位による太さは縁取りで付けました（html2canvas 1.4.1 は `-webkit-text-stroke` に対応しています）
- **字の間を少し空ける**: 相撲字は 1em の枠いっぱいに描かれているので、1em で積むと上下の字が付きました（「稼働錦」）。1.04em にしています
- **配信しない**: Sumo Trial は配布しない試作書体なので、Web フォントとしては配信していません。OFL の書体を加工したものは、名前の付け方や配布のしかたに条件があります（元の書体の予約された名前を使わない、など）。将来、配布や配信をするなら、OFL の条件を確かめる必要があります

---

# 5. 実機の PDF

kintone の印刷屋（Ver.8、Mac）で、2 件の PDF を作りました。

| 場所 | ファイル（番付表PDF に保存） | 大きさ |
| :--- | :--- | :--- |
| 令和八年 秋場所 | 番付表_令和八年　秋場所.pdf | 345KB |
| 令和八年 夏場所 | 番付表_令和八年　夏場所.pdf | 258KB |

どちらも A3 横 1 ページ、画像は 3174 × 2246 で、Sumo Trial の字で出ました。場所名の全角空白も、ファイル名にそのまま入りました。

AI は、手元でも印刷屋と同じ手順（html2canvas 1.4.1、scale 2 → JPEG 品質 0.5 → jsPDF の A3 横）で PDF を作っていました。実機の PDF の画像と比べると、画素の差は平均 3.8（秋場所）と 2.3（夏場所）でした（0〜255）。書体のない版との差（14.8）よりずっと小さく、原寸で並べても字の位置と形は同じでした。

画素の比べで分かるのは、描かれ方（字の形と位置）が同じことです。誰がどの地位かという中身は、2.4 の確かめ表で確かめています。

---

# 6. つまずき（計算式のエンジンの性質）

印刷屋 Ver.8 の zip に入っている計算式のエンジンを、印刷屋 MCP のプレビューから動かして確かめたものです。ほかの版でも同じかは確かめていません。

## 6.1 テーブルの子の項目を書くと、式全体が行の数だけ繰り返される

最初の割り当ての式は、テーブルの列を `TARRAY(しこ名)` で配列にしていました。これが、21 行のレコードで評価回数の上限（10 万回）を超えて止まりました。

小さな式で試すと、テーブルの子の項目を書いた式は、**式全体がテーブルの行の数だけ評価され、結果がつながって**出ていました。

| 式 | レコード | 結果 |
| :--- | :--- | :--- |
| `LET(a, TARRAY(しこ名), CONCAT("n=", ARRAY_COUNT(a), …))` | 秋場所（21 行） | 21 回つながる |
| `LET(a, SUBTABLE(しこ名), CONCAT("[", ARRAY_COUNT(a), "] ", JOIN(a, ",")))` | 夏場所（6 行） | 6 回つながる |
| `LET(a, TABLE_MAP(社員, TPDIC("n", しこ名, "t", 目標)), …)` | 夏場所（6 行） | 6 回つながる |
| `CONCAT("[", SUM(IF(目標 > 0, 1, 0)), "]")` | 夏場所（6 行） | 1 回（`[5]`） |
| `CONCAT("[", COUNTROW(社員), "]")` | 夏場所（6 行） | 1 回（`[6]`） |
| `CONCAT("[", OTVAL(社員, TPOUT(しこ名, 目標)), "]")` | 夏場所（6 行） | 1 回（JSON の文字列） |

そこで、テーブルは `OTVAL` で JSON の文字列にし、`JSON_P` で配列に戻して、1 回だけ読み込むようにしました。

```text
tbl, JSON_P(OTVAL(社員, TPOUT(しこ名, 氏名, 部署, 目標, 実績)), 0),
n0, ARRAY_COUNT(tbl),
tgA, ARRAY_MAP(tbl, rw, DIC_ITEM(rw, "目標")),
acA, ARRAY_MAP(tbl, rw, DIC_ITEM(rw, "実績")),
```

## 6.2 LET に入れた偽が、IF と AND では真になる

人数の少ない夏場所が、なぜか 2 段組みになりました。片側の人数が 8 を超えるかを `two, cE > 8` で LET に入れ、`IF(two, …)` で分けていたところです。

| 式 | 結果 |
| :--- | :--- |
| `IF(3 > 8, "真", "偽")` | 偽 |
| `LET(a, 3 > 8, IF(a, "真", "偽"))` | **真** |
| `LET(a, 0, IF(a, "真", "偽"))` | **真** |
| `LET(a, 3 > 8, IF(AND(a, 1 = 1), "真", "偽"))` | **真** |
| `LET(a, 3 > 8, CONCAT("[", a, "]"))` | `[false]` |

`a` の値そのものは false ですが、`IF` や `AND` にそのまま渡すと真として扱われました。印刷屋 Ver.8 の zip のエンジンで確かめた結果で、型の変換によるものか、変数の評価のしかたによるものかは分かっていません。今回は、1 / 0 にして、比べる形に直しました。

```text
two, IF(cE > 8, 1, 0),
tA, ARRAY_MAP(rA, r, IF(AND(two = 1, r >= 4), 2, 1)),
```

## 6.3 `ARRAY_SORT` は渡した配列そのものも並べ替える

2.4 の確かめ表で、行の順のはずの `keys` が、並べ替えた後の順になっていました。`ARRAY_SORT` は、JavaScript の `sort` と同じく、渡した配列そのものも並べ替えます。`ARRAY_SORT(ARRAY(keys), 0)` と、`ARRAY()` で写してから渡せば、元の配列は変わりません。

## 6.4 そのほか

| 式 | 結果 |
| :--- | :--- |
| `ARRAY_FOR(3000, i, i * 2)` の個数 | 1000（打ち切り） |
| `ARRAY_SORT(ARRAY(9, 10, 100, 25, 3), 0)` | `100,25,10,9,3`（数として並ぶ） |
| `MAX(2, ARRAY(5, 1, 3))` | 5（配列の中も比べる） |
| 1,000 個の配列を作る LET の変数を 40 回参照 | 通る（同じ計算を 40 回書くと、評価回数の上限に掛かる）。LET の変数は 1 回だけ計算される |

---

# 7. 対応していないこと・気を付けること

- **比べ方**: 達成率で比べると単位の違いはそろうが、100％ を達成する難しさは部署ごとに違う。この記事の番付は帳票の見本（データは架空）で、実際の人事評価に使うなら、目標の決め方まで含めて考える必要がある
- **人数**: 載せるのは上位 32 人（東西 16 人ずつ）まで。超えた人数は中央に書く
- **字数**: しこ名は 5 字、部署は 5 字、場所名は 12 字まで（アプリの入力の上限と、計算式の `LEFT`）
- **元号**: 期間は令和で書く。2019 年より前は西暦の漢数字
- **書体**: 確かめたのは Mac だけ。書体の入っていない PC で押したときは、手元のまね（ヒラギノ明朝）でしか確かめていない。Windows では確かめていない
- **スマホ**: 印刷屋の Web フォントがオフの設定は、スマホの詳細画面には印刷ボタンが出ない（印刷屋の仕様）
- **dpi**: 96 dpi だけ。画像は 3174 × 2246（scale 2）で、A3 に対して約 190 ppi。掲示には足りるが、細かな線や小さな字をきれいに印刷するなら、150 dpi 版を作る余地がある

---

# 8. 設定ファイル

番付表のボタン 1 つです。共通 CSS は使っていません（帳票の CSS に全部書いています）。

使うアプリには、`場所名`（文字列 1 行）、`期間開始`・`期間終了`（日付）、`社員`（テーブル。中に `氏名`・`しこ名`・`部署`・`目標`・`実績`）、`番付表PDF`（添付ファイル）のフィールドコードが要ります。`appId`・`appName` は今回のアプリの値です。

<details><summary>番付表.json（クリックで開く）</summary>

```json
{
  "date": "2026-10-15 15:00:00",
  "pluginName": "印刷屋プラグイン",
  "pluginID": "rex0220 Print craft plugin",
  "PluginVersion": "8",
  "appId": 4325,
  "appName": "番付表（目標達成率）",
  "pluginEnable": true,
  "commonCssEnable": true,
  "externalRefs": "block",
  "pluginComment": "番付表（A3 横）。書体 Sumo Trial はこの PC に入れたものを使う（入っていない PC では Noto Serif JP か明朝体）",
  "pluginInfos": [
    {
      "state": true,
      "menu": "番付表",
      "desc": "番付表（A3 横）",
      "mcheck": true,
      "list": false,
      "authority": false,
      "viewsCsv": "-",
      "remark": "達成率（実績 ÷ 目標）の高い順に、東西交互に横綱・大関・関脇・小結・前頭を割り当てる。書体は PC に入れた Sumo Trial（Web フォントは使わない）",
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
            "formulaSet": "\"番付表_\" & 場所名 & \".pdf\""
          },
          {
            "state": true,
            "desc": "番付表（HTML 欄は空。計算式だけで 1 ページを組む）",
            "fieldcode": "",
            "css": "/* 番付表（A3 横 96 dpi = 1587×1123px）。書体は PC に入れた Sumo Trial（Web フォントは使わない） */\n.bz-page { box-sizing: border-box; padding: 18px 20px 0; background: #fff; color: #1a1410;\n  font-family: \"Sumo Trial\", \"Noto Serif JP\", serif; }\n/* 縦書き: 1 字 1 行（span）で縦に積む */\n.bz-page span { display: block; height: 1em; line-height: 1; text-align: center; }\n.bz-page span.sp { height: 0.5em; }\n.bz-page span.r { transform: rotate(90deg); }\n.bz-frame { box-sizing: border-box; width: 1547px; height: 1060px; border: 5px double #1a1410; display: flex; }\n/* 東は右、西は左。どちらも外側（端）が上位 */\n.bz-side { width: 671px; display: flex; }\n.bz-east { flex-direction: row-reverse; }\n.bz-band { width: 55px; flex: none; display: flex; flex-direction: column; align-items: center; padding-top: 14px;\n  font-size: 46px; -webkit-text-stroke: 1px #1a1410; }\n.bz-tiers { width: 616px; display: flex; flex-direction: column; }\n.bz-tier { display: flex; height: 1050px; }\n.bz-two .bz-t1 { height: 606px; }\n.bz-two .bz-t2 { height: 441px; border-top: 3px solid #1a1410; }\n.bz-east .bz-tier { flex-direction: row-reverse; }\n.bz-col { flex: 1 1 0; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; padding: 0 0 10px; }\n.bz-east .bz-col { border-right: 1px solid #1a1410; }\n.bz-west .bz-col { border-left: 1px solid #1a1410; }\n.bz-lb { box-sizing: border-box; width: 100%; height: 68px; flex: none; border-bottom: 1px solid #1a1410;\n  display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 26px; }\n.bz-dp { margin-top: 10px; font-size: 18px; color: #5a4c40; }\n.bz-nm { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; margin: 8px 0; }\n.bz-nm span { height: 1.04em; }\n.bz-sc { font-size: 18px; }\n.bz-few .bz-dp, .bz-few .bz-sc { font-size: 22px; }\n.bz-two .bz-t1 .bz-dp, .bz-two .bz-t1 .bz-sc { font-size: 16px; }\n.bz-t2 .bz-lb { height: 56px; font-size: 20px; }\n.bz-t2 .bz-dp, .bz-t2 .bz-sc { font-size: 14px; }\n.bz-center { box-sizing: border-box; width: 195px; flex: none; border-left: 3px solid #1a1410; border-right: 3px solid #1a1410;\n  display: flex; flex-direction: column; align-items: center; padding: 28px 0 24px; }\n.bz-gomen { font-size: 58px; -webkit-text-stroke: 1.5px #1a1410; }\n.bz-basho { flex: 1 1 auto; display: flex; flex-direction: row-reverse; justify-content: center; align-items: flex-start; gap: 10px; margin-top: 30px; }\n.bz-name { font-size: 46px; -webkit-text-stroke: 1px #1a1410; }\n.bz-date { font-size: 17px; margin-top: 8px; color: #3a3028; }\n.bz-notes { display: flex; flex-direction: row-reverse; gap: 6px; margin-bottom: 18px; font-size: 14px; color: #5a4c40; }\n.bz-senshu { font-size: 28px; -webkit-text-stroke: 0.5px #1a1410; }\n/* 注記は横書き（ふつうの書体） */\n.bz-foot { display: flex; justify-content: space-between; padding: 6px 4px 0; font: 12px/1.4 \"Hiragino Sans\", \"Yu Gothic\", sans-serif; color: #5a4c40; }\n.bz-page .bz-foot span { display: inline; height: auto; text-align: left; }\n/* しこ名の大きさ（計算式が選ぶ） */\n.fs-14 { font-size: 14px; } .fs-16 { font-size: 16px; } .fs-18 { font-size: 18px; } .fs-20 { font-size: 20px; } .fs-22 { font-size: 22px; } .fs-24 { font-size: 24px; } .fs-26 { font-size: 26px; } .fs-28 { font-size: 28px; } .fs-30 { font-size: 30px; } .fs-32 { font-size: 32px; } .fs-34 { font-size: 34px; } .fs-36 { font-size: 36px; } .fs-38 { font-size: 38px; } .fs-40 { font-size: 40px; } .fs-42 { font-size: 42px; } .fs-44 { font-size: 44px; } .fs-46 { font-size: 46px; } .fs-48 { font-size: 48px; } .fs-50 { font-size: 50px; } .fs-52 { font-size: 52px; } .fs-54 { font-size: 54px; } .fs-56 { font-size: 56px; } .fs-58 { font-size: 58px; } .fs-60 { font-size: 60px; } .fs-62 { font-size: 62px; } .fs-64 { font-size: 64px; } .fs-66 { font-size: 66px; } .fs-68 { font-size: 68px; } .fs-70 { font-size: 70px; } .fs-72 { font-size: 72px; } .fs-74 { font-size: 74px; } .fs-76 { font-size: 76px; } .fs-78 { font-size: 78px; } .fs-80 { font-size: 80px; } .fs-82 { font-size: 82px; } .fs-84 { font-size: 84px; } .fs-86 { font-size: 86px; } .fs-88 { font-size: 88px; } .fs-90 { font-size: 90px; } .fs-92 { font-size: 92px; } .fs-94 { font-size: 94px; } .fs-96 { font-size: 96px; } .fs-98 { font-size: 98px; } .fs-100 { font-size: 100px; } .fs-102 { font-size: 102px; } .fs-104 { font-size: 104px; } .fs-106 { font-size: 106px; } .fs-108 { font-size: 108px; } .fs-110 { font-size: 110px; } .fs-112 { font-size: 112px; } .fs-114 { font-size: 114px; } .fs-116 { font-size: 116px; } .fs-118 { font-size: 118px; } .fs-120 { font-size: 120px; } .fs-122 { font-size: 122px; } .fs-124 { font-size: 124px; } .fs-126 { font-size: 126px; } .fs-128 { font-size: 128px; } .fs-130 { font-size: 130px; } .fs-132 { font-size: 132px; } .fs-134 { font-size: 134px; } .fs-136 { font-size: 136px; } .fs-138 { font-size: 138px; } .fs-140 { font-size: 140px; } .fs-142 { font-size: 142px; } .fs-144 { font-size: 144px; } .fs-146 { font-size: 146px; } .fs-148 { font-size: 148px; } .fs-150 { font-size: 150px; } .fs-152 { font-size: 152px; } .fs-154 { font-size: 154px; } .fs-156 { font-size: 156px; } .fs-158 { font-size: 158px; } .fs-160 { font-size: 160px; } .fs-162 { font-size: 162px; } .fs-164 { font-size: 164px; } .fs-166 { font-size: 166px; } .fs-168 { font-size: 168px; }\n/* 縁取り = 字の太さ（0.5px 単位） */\n.sk-1 { -webkit-text-stroke: 0.5px #1a1410; } .sk-2 { -webkit-text-stroke: 1.0px #1a1410; } .sk-3 { -webkit-text-stroke: 1.5px #1a1410; } .sk-4 { -webkit-text-stroke: 2.0px #1a1410; } .sk-5 { -webkit-text-stroke: 2.5px #1a1410; } .sk-6 { -webkit-text-stroke: 3.0px #1a1410; }\n/* 上の段の列の幅（地位ほど広く） */\n.fg-100 { flex-grow: 1; } .fg-87 { flex-grow: 0.87; } .fg-77 { flex-grow: 0.77; } .fg-69 { flex-grow: 0.69; } .fg-62 { flex-grow: 0.62; } .fg-59 { flex-grow: 0.59; } .fg-56 { flex-grow: 0.56; } .fg-53 { flex-grow: 0.53; }",
            "html": "",
            "formulaSet": "LET(\n  // 1. テーブルを 1 回で読み込む（行の順。0 始まり）\n  //    TARRAY(しこ名) のように子の項目を直に書くと、式全体がテーブルの行の数だけ繰り返される。OTVAL は 1 回\n  tbl, JSON_P(OTVAL(社員, TPOUT(しこ名, 氏名, 部署, 目標, 実績)), 0),\n  n0, ARRAY_COUNT(tbl),\n  tgA, ARRAY_MAP(tbl, rw, DIC_ITEM(rw, \"目標\")),\n  acA, ARRAY_MAP(tbl, rw, DIC_ITEM(rw, \"実績\")),\n  // 2. 達成率の高い順に並べる。キー = 達成率（0.01% 単位で切り捨て）× 1000 + (999 − 行)\n  //    同じ達成率なら上の行が上位。目標が空か 0 の行は −1（番付外）\n  //    ARRAY_SORT は渡した配列そのものも並べ替えるので、ARRAY() で写してから渡す\n  keys, ARRAY_FOR(n0, i, LET(tg, ARRAY_GET(tgA, i),\n    IF(tg > 0, ROUNDDOWN(ARRAY_GET(acA, i) * 10000 / tg, 0) * 1000 + 999 - i, -1))),\n  nOk, SUM(ARRAY_MAP(keys, x, IF(x >= 0, 1, 0))),\n  srt, ARRAY_SORT(ARRAY(keys), 0),\n  // 載せるのは上位 32 人まで（東西 16 人ずつ）\n  n, MIN(nOk, 32),\n  ord, ARRAY_FOR(n, k, 999 - MOD(ARRAY_GET(srt, k), 1000)),\n  // 3. 上から k 番目: 偶数が東、奇数が西。r = 0 横綱、1 大関、2 関脇、3 小結、4〜 前頭\n  //    片側 9 人からは、前頭を下の段に置く（2 段）。two は 1 / 0\n  //    （LET に入れた真偽を IF(two, …) や AND(two, …) にそのまま渡すと、偽でも真になる。= 1 と比べる）\n  cE, CEIL(n / 2, 0),\n  two, IF(cE > 8, 1, 0),\n  rA, ARRAY_FOR(n, k, ROUNDDOWN(k / 2, 0)),\n  tA, ARRAY_MAP(rA, r, IF(AND(two = 1, r >= 4), 2, 1)),\n  // 字の大きさの比（上の段）と、字の太さ（縁取り）の比\n  fA, ARRAY_MAP(rA, r, IF(r < 4, ARRAY_GET(ARRAY(1, 0.87, 0.77, 0.69), r), 0.62 - 0.03 * (r - 4))),\n  nmA, ARRAY_MAP(ord, i, LET(rw, ARRAY_GET(tbl, i), s, TRIM(DIC_ITEM(rw, \"しこ名\")),\n    LEFT(IF(s = \"\", REPLACEALL(REPLACEALL(DIC_ITEM(rw, \"氏名\"), \" \", \"\"), \"　\", \"\"), s), 5))),\n  dpA, ARRAY_MAP(ord, i, LEFT(TRIM(DIC_ITEM(ARRAY_GET(tbl, i), \"部署\")), 5)),\n  pct, ARRAY_MAP(ord, i, MIN(9999, ROUNDDOWN(ARRAY_GET(acA, i) * 100 / ARRAY_GET(tgA, i), 0))),\n  // 4. 漢数字（0〜9999）。成績 n 個のあとに、期間の年月日（令和と西暦）と人数\n  ys, DATE_FORMAT(期間開始, \"YYYY\") * 1, ye, DATE_FORMAT(期間終了, \"YYYY\") * 1,\n  kd, \"〇一二三四五六七八九\",\n  kanA, ARRAY_MAP(ARRAY(pct, ys - 2018, DATE_FORMAT(期間開始, \"M\") * 1, DATE_FORMAT(期間開始, \"D\") * 1,\n      ye - 2018, DATE_FORMAT(期間終了, \"M\") * 1, DATE_FORMAT(期間終了, \"D\") * 1, n, nOk - n, n0 - nOk, 32, ys, ye), x, LET(\n    q1, ROUNDDOWN(x / 1000, 0), q2, MOD(ROUNDDOWN(x / 100, 0), 10), q3, MOD(ROUNDDOWN(x / 10, 0), 10), q4, MOD(x, 10),\n    IF(x <= 0, \"〇\", CONCAT(\n      IF(q1 = 0, \"\", CONCAT(IF(q1 = 1, \"\", MID(kd, q1 + 1, 1)), \"千\")),\n      IF(q2 = 0, \"\", CONCAT(IF(q2 = 1, \"\", MID(kd, q2 + 1, 1)), \"百\")),\n      IF(q3 = 0, \"\", CONCAT(IF(q3 = 1, \"\", MID(kd, q3 + 1, 1)), \"十\")),\n      IF(q4 = 0, \"\", MID(kd, q4 + 1, 1)))))),\n  scA, ARRAY_FOR(n, k, CONCAT(ARRAY_GET(kanA, k), \"％\")),\n  // 5. 段ごとの字の大きさ（A3 横 96 dpi の px。片側の列の幅 616、段の高さ 1050、2 段は 606 と 441）\n  //    高さ: 段の高さから地位・部署・成績の分を引き、いちばん長いしこ名が入る大きさ\n  //    幅: 上の段は列の幅を字の大きさの比で分け、下の段は等分\n  geo, ARRAY_MAP(ARRAY(1, 2), t, LET(\n    mN, MAX(2, ARRAY_FOR(n, k, IF(ARRAY_GET(tA, k) = t, LENGTH(ARRAY_GET(nmA, k)), 0))),\n    mD, MAX(0, ARRAY_FOR(n, k, IF(ARRAY_GET(tA, k) = t, LENGTH(ARRAY_GET(dpA, k)), 0))),\n    mS, MAX(0, ARRAY_FOR(n, k, IF(ARRAY_GET(tA, k) = t, LENGTH(ARRAY_GET(scA, k)), 0))),\n    hh, IF(t = 2, 441, IF(two = 1, 606, 1050)),\n    lh, IF(t = 2, 56, 68),\n    dd, IF(t = 2, 14, IF(two = 1, 16, IF(cE <= 4, 22, 18))),\n    capH, (hh - lh - (mD + mS) * dd - 42) / (mN * 1.04),\n    capW, IF(t = 1,\n      616 * 0.82 / MAX(0.5, SUM(ARRAY_FOR(n, k, IF(AND(ARRAY_GET(tA, k) = 1, MOD(k, 2) = 0), ARRAY_GET(fA, k), 0))),\n        SUM(ARRAY_FOR(n, k, IF(AND(ARRAY_GET(tA, k) = 1, MOD(k, 2) = 1), ARRAY_GET(fA, k), 0)))),\n      616 * 0.82 / MAX(1, SUM(ARRAY_FOR(n, k, IF(AND(ARRAY_GET(tA, k) = 2, MOD(k, 2) = 0), 1, 0))))),\n    MIN(capH, capW, 168))),\n  b1, ARRAY_GET(geo, 0), b2, ARRAY_GET(geo, 1),\n  // 下の段（前頭）は、小結の 0.85 倍まで。枚目が下がるごとに 3% 小さく\n  s3, ROUNDDOWN(b1 * 0.69 / 2, 0) * 2,\n  fsA, ARRAY_FOR(n, k, LET(r, ARRAY_GET(rA, k),\n    MAX(14, ROUNDDOWN(IF(ARRAY_GET(tA, k) = 1, b1 * ARRAY_GET(fA, k), MIN(b2 * (1 - 0.03 * (r - 4)), s3 * 0.85)) / 2, 0) * 2))),\n  // 縁取り（0.5px 単位、3px まで）: 横綱 3.5%、大関 2.8%、関脇 2.2%、小結 1.6%、前頭なし\n  skA, ARRAY_FOR(n, k, LET(r, ARRAY_GET(rA, k),\n    IF(r < 4, MIN(6, ROUNDDOWN(ARRAY_GET(fsA, k) * ARRAY_GET(ARRAY(0.035, 0.028, 0.022, 0.016), r) * 2, 0)), 0))),\n  // 6. 1 人 1 列の HTML（字は後でまとめて 1 字ずつに分ける）。地位は前頭の 2 人目から「同」\n  colA, ARRAY_FOR(n, k, LET(r, ARRAY_GET(rA, k), CONCAT(\n    \"<div class='bz-col fg-\", IF(ARRAY_GET(tA, k) = 1, ROUND(ARRAY_GET(fA, k) * 100, 0), 100), \"'><div class='bz-lb'>\",\n    IF(r < 4, MID(\"横綱大関関脇小結\", r * 2 + 1, 2), IF(r = 4, \"前頭\", \"同\")),\n    \"</div><div class='bz-dp'>\", ESC_HTML(ARRAY_GET(dpA, k)),\n    \"</div><div class='bz-nm fs-\", ARRAY_GET(fsA, k), \" sk-\", ARRAY_GET(skA, k), \"'>\", ESC_HTML(ARRAY_GET(nmA, k)),\n    \"</div><div class='bz-sc'>\", ARRAY_GET(scA, k), \"</div></div>\"))),\n  sideA, ARRAY_MAP(ARRAY(0, 1), s, CONCAT(\n    \"<div class='bz-side \", IF(s = 0, \"bz-east\", \"bz-west\"), \"'><div class='bz-band'>\", IF(s = 0, \"東\", \"西\"),\n    \"</div><div class='bz-tiers'><div class='bz-tier bz-t1'>\",\n    JOIN(ARRAY_FOR(n, k, IF(AND(MOD(k, 2) = s, ARRAY_GET(tA, k) = 1), ARRAY_GET(colA, k), \"\")), \"\"), \"</div>\",\n    IF(two = 1, CONCAT(\"<div class='bz-tier bz-t2'>\",\n      JOIN(ARRAY_FOR(n, k, IF(AND(MOD(k, 2) = s, ARRAY_GET(tA, k) = 2), ARRAY_GET(colA, k), \"\")), \"\"), \"</div>\"), \"\"),\n    \"</div></div>\")),\n  // 7. 中央: 蒙御免、場所名、期間（令和。2019 年より前は西暦）、人数、千穐万歳大々叶\n  wa1, CONCAT(\"自 \", IF(ys >= 2019, CONCAT(\"令和\", IF(ys = 2019, \"元\", ARRAY_GET(kanA, n))), ARRAY_GET(kanA, n + 11)), \"年\",\n    ARRAY_GET(kanA, n + 1), \"月\", ARRAY_GET(kanA, n + 2), \"日\"),\n  wa2, CONCAT(\"至 \", IF(ye >= 2019, CONCAT(\"令和\", IF(ye = 2019, \"元\", ARRAY_GET(kanA, n + 3))), ARRAY_GET(kanA, n + 12)), \"年\",\n    ARRAY_GET(kanA, n + 4), \"月\", ARRAY_GET(kanA, n + 5), \"日\"),\n  notes, CONCAT(\"<div class='bz-note'>番付 \", ARRAY_GET(kanA, n + 6), \"名</div>\",\n    IF(nOk > n, CONCAT(\"<div class='bz-note'>上位\", ARRAY_GET(kanA, n + 9), \"名まで \", ARRAY_GET(kanA, n + 7), \"名は番付外</div>\"), \"\"),\n    IF(n0 > nOk, CONCAT(\"<div class='bz-note'>目標なし \", ARRAY_GET(kanA, n + 8), \"名は番付外</div>\"), \"\")),\n  center, CONCAT(\"<div class='bz-center'><div class='bz-gomen'>蒙御免</div><div class='bz-basho'><div class='bz-name'>\",\n    ESC_HTML(LEFT(場所名, 12)), \"</div><div class='bz-date'>\", wa1, \"</div><div class='bz-date'>\", wa2,\n    \"</div></div><div class='bz-notes'>\", notes, \"</div><div class='bz-senshu'>千穐万歳大々叶</div></div>\"),\n  frame, CONCAT(\"<div class='bz-frame'>\", ARRAY_GET(sideA, 1), center, ARRAY_GET(sideA, 0), \"</div>\"),\n  // 8. 縦書き: html2canvas は writing-mode に対応しないので、字を 1 つずつ span にして縦に積む\n  //    タグの直後に空の span ができるので消す。u フラグで 𠮷 なども 1 字。空白は半分の空き、ー などは回す\n  v1, REPLACEALL(REPLACERE(frame, \"(<[^>]*>)|(&[#0-9a-zA-Z]+;|[^<&])\", \"gu\", \"$1<span>$2</span>\"), \"<span></span>\", \"\"),\n  v2, REPLACERE(v1, \"<span>[ 　]</span>\", \"g\", \"<span class='sp'></span>\"),\n  v3, REPLACERE(v2, \"<span>([ー－―〜～…‥])</span>\", \"gu\", \"<span class='r'>$1</span>\"),\n  CONCAT(\"<div class='rex0220-pcraft-page bz-page\", IF(two = 1, \" bz-two\", IF(cE <= 4, \" bz-few\", \"\")), \"'>\", v3,\n    \"<div class='bz-foot'><span>※ 部署ごとに目標の単位（売上・生産数・件数など）が違うため、実績ではなく達成率（実績 ÷ 目標）で比べています。同じ達成率は表の上の行が上位、成績の％は小数を切り捨て</span>\",\n    \"<span>書体: Sumo Trial（この PC に無いときは Noto Serif JP か明朝体で表示）</span></div></div>\")\n)"
          }
        ],
        "filecode": "番付表PDF",
        "pageSize": "A3",
        "orientation": "l",
        "dpi": "96",
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

- テーブルを集計以外で使う式は、`JSON_P(OTVAL(テーブル, TPOUT(…)), 0)` で 1 回だけ読み込む。子の項目を直に書くと、式全体が行の数だけ繰り返される
- 印刷屋 Ver.8 では、LET に入れた真偽（や 0）を `IF` / `AND` の条件にそのまま使うと、偽でも真になった。1 / 0 にして `= 1` と比べる
- `ARRAY_SORT` に渡す配列は、`ARRAY()` で写してから
- 別の値で並べ替えたいときは、キーに行の番号を埋め込む（行数・比べる精度・負の値の前提を確かめる）
- 縦書きは、組み上がった HTML に `REPLACERE` を 1 回掛けて、1 字ずつ `<span>` にする
- `${式}` を属性に書けないので、大きさや太さは class を計算式で選ぶ
- PC に入れた書体は、印刷屋の Web フォントを使わなくても帳票の CSS で使える。PDF は画像なので、書体が要るのは PDF を作る PC だけ

---

# まとめ

- 部署の違う社員を目標達成率で格付けし、大相撲の番付表のような PDF（A3 横）にする帳票を作った。並べ替え・東西・同じ達成率の決め方・漢数字の成績は、すべて計算式で行った
- 部署ごとに目標の単位が違うので、実績でなく達成率で比べ、同じ達成率はテーブルの上の行を上位にした
- 書体は、PC に入れた相撲字風の書体を帳票の CSS で指定した。プレビューで Sumo Trial で描かれたことを確かめ、入っていない PC での見え方も画像にした
- 人数によって 1 段と 2 段を切り替え、字の大きさを計算式で決めたので、5 人の場所でも紙面が埋まった
- テーブルを読む式が行の数だけ繰り返される、LET に入れた偽が真になる、`ARRAY_SORT` が元の配列も並べ替える、というエンジンの性質を、小さな式で突き止めた
- 設計・計算式・確かめ・不具合の調査と直しは AI に任せた。人が行ったのは、作りたいものを頼むことと、実機の PDF を見せることだった

シリーズ「rex0220 印刷屋プラグイン - AI(Claude Desktop)に〜」:

1. [チャットで帳票を作らせる](https://qiita.com/rex0220/items/8cbebab5a5f8a9c21b1f)
2. [帳票のデザインを作り込ませる](https://qiita.com/rex0220/items/43ceafa584690b4b0a5b)
3. [見積書から注文書・請求書を作らせる](https://qiita.com/rex0220/items/eae546dc726e7c61512f)
4. [組織図を設計させてから、アプリを作らせる](https://qiita.com/rex0220/items/6e739ace80cffd2ad70a)
5. [QRコード付きの資産ラベルを作らせる](https://qiita.com/rex0220/items/a649d70314361b964cd2)
6. [写真付きの点検報告書を作らせる](https://qiita.com/rex0220/items/b10502d8d23373820aab)
7. [ガントチャートアプリの工程表を作らせる（関連レコード一覧に対応した Ver.8）](https://qiita.com/rex0220/items/f48cf8d9a89cb1971e41)
8. [休日アプリから年間カレンダーを作らせる](https://qiita.com/rex0220/items/0a6be4bdb34ebb2986c6)
9. [作文を原稿用紙（400 字詰め）の PDF にさせる](https://qiita.com/rex0220/items/bb2649ca3d70264b8242)
10. [「あなたが生まれた日の太陽系」カードを作らせる](https://qiita.com/rex0220/items/acc7467aef9bb6a37325)
11. **業務データから「番付表」を作らせる（この記事）**
12. [番付表用の相撲字風の書体を作らせる](https://qiita.com/rex0220/items/ffb7caf61c570045d968)
13. [ABC 記法の曲から「五線譜」を作らせる](https://qiita.com/rex0220/items/6b3fa929652fcee66c6e)
14. [将棋の棋譜から「盤面図」を作らせる](https://qiita.com/rex0220/items/3663c9bb983abb2d15b3)

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [帳票レシピ集とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
