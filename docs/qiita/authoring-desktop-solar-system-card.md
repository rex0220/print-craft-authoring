<!--
title: rex0220 印刷屋プラグイン - AI に「あなたが生まれた日の太陽系」カードを作らせる（惑星の位置の計算と誕生星座の図）
tags:
  - kintone
  - Claude
  - MCP
private: false
url: https://qiita.com/rex0220/items/acc7467aef9bb6a37325（2026-10-15 公開）
-->

[前回の記事](https://qiita.com/rex0220/items/bb2649ca3d70264b8242) では、作文を原稿用紙の PDF にしました。今回は、**生年月日から、その日の惑星の位置を計算して「あなたが生まれた日の太陽系」を描く誕生日カード**です。

できあがったのは、下のカードです。左に、生まれた日の 8 惑星の位置を描いています。右には、名前・生年月日・メッセージと、惑星ごとの年齢（生まれてからの日数 ÷ 公転周期）を並べました。右下は、太陽の位置から求めた誕生星座の図です。

![2000 年 1 月 1 日生まれのカード（A5 横、150 dpi。印刷屋と同じ html2canvas で描いたもの）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/21c42e08-9eff-4f0e-976f-01f5e9ca4176.jpeg)

なお、右下の星座の図は、正直なところデザインがイマイチだと思っています。図は Claude Design で AI に描かせたもので、描かせ方は 5.2 に書いています。

この記事の見どころは、次の 3 つです。

- 三角関数が使えない計算式で、惑星の位置を求めた（1 章）
- 見本を増やして見つけた惑星の名前の重なりを、隣の軌道だけを調べる判定で減らした（4 章）
- 実機の PDF で図の線がにじむ原因を、AI が html2canvas の描き方に見つけて直した（6 章）

記事の最後に、1 枚用のボタンの設定 JSON を載せています。12 星座の SVG は含まないので星座の図は出ませんが、惑星の位置の計算とカードの配置は試せます。

元にしたのは、次のような依頼文です（要約）。

> kintone のアプリ「誕生日カード」と、印刷屋の帳票「あなたが生まれた日の太陽系」を作る。
> - 生年月日から 8 惑星の日心黄経を、JPL の近似軌道要素（J2000）で計算する
> - 軌道は等間隔にデフォルメし、黄経 0°（春分点）を右、反時計回りに描く
> - 右側に名前・生年月日・メッセージ・惑星年齢の表・「生まれてから ◯◯,◯◯◯ 日」
> - `<svg>` は使わない。html2canvas で描けない CSS（グラデーション、filter など）も使わない
> - 使う関数は資料で確かめ、計算式を書く前に小さな式で試す
> - 見本のレコード 3 件で、黄経を検算表と比べる（±3° 以内）

この依頼文を AI に渡すところから始めました。チャットで頼んだことと結果は、次のとおりです。

| # | 頼んだこと | 結果 |
| :--- | :--- | :--- |
| 1 | 上の依頼文 | 設計を示してから、アプリ・見本のレコード 3 件・設定ファイル（A5 横）を作った。**三角関数が使えない**ことが分かり、四則演算の sin で代えた。黄経は 24 個とも検算表と一致 |
| 2 | （実機の PDF 3 件を見せて）「OK」 | 作業中に出していた検算用の欄を消した |
| 3 | 「一覧画面から A4 に 2 レコード配置するボタンを追加して。A4 印刷で紙を使いたい」 | 一覧帳票のボタンを足した。枚数が多いと**評価回数の上限**に当たるので、1 回 30 件までにして案内のページを付けた |
| 4 | 「96DPI の調整版を追加して」 | 1 枚用と A4 用に 96 dpi 版を足し、ボタンを 4 つにした |
| 5 | 「レコード追加」 | 見本を 30 件足した。**惑星の名前が隣の惑星に隠れる**カードが見つかった |
| 6 | 「直して」 | 名前を左に回す判定を足した。評価回数が増えたので、A4 版の上限を 24 件に下げた |
| 7 | 「右下に空きがあるが、誕生日の星座ごとに星座のデザイン図を表示したらどうか？ 評価して」 | 星座の決め方（星占いと実際の星座のずれ）と置き場所を評価した |
| 8 | 「SVG で各星座をデザインして埋め込むのはどうか？」 | `<svg>` 要素は使えないが、data URL の画像なら使えると評価した |
| 9 | 「Claude design に頼んで」と、図の方向の指示（5.2） | Claude Design のキャンバスで、12 星座の線画を描いた |
| 10 | 「Go」 | 12 星座の SVG を共通 CSS に入れ、4 つのボタンに星座の欄を足した |
| 11 | （実機の PDF を見せる） | 図の線がにじむ原因を html2canvas の描き方に見つけ、CSS で直した |
| 12 | 「惑星直列として話題になった日は？」 | 1962・1982・2000・2025 年の 4 つの日を挙げ、太陽から見た並びか、空での並びかを説明した |
| 13 | 「レコード追加」 | 4 つの日の見本を足した |
| 14 | （実機の PDF を見せて）「直して」 | 2025 年のカードで海王星の名前が春分点の印とぶつかっていたので、黄経 0° の近くでは名前を左に回すようにした |

使ったのは、印刷屋プラグイン Ver.8、Claude Code（Claude デスクトップアプリの Code タブ）、印刷屋 MCP 0.2.0（資料・検査・プレビュー。中核は tools 2.1.0）、Claude Design（星座の図）です。アプリの作成とレコードの登録は、kintone の MCP サーバーで AI が行いました。

---

# 1. 惑星の位置を計算式で求める

## 1.1 近似式

惑星の位置は、JPL（NASA ジェット推進研究所）が公開している近似軌道要素（J2000。1800〜2050 年向けの表）のうち、平均黄経 L0、その 1 世紀あたりの変化 ΔL、近日点黄経 ϖ0、離心率 e の 4 つを使って求めます。

| 量 | 式 |
| :--- | :--- |
| 経過時間 T（世紀） | `DATE_DIFF("2000-01-01", 生年月日, "days") / 36525` |
| 平均近点角 M | L0 + ΔL·T − ϖ0 |
| 日心黄経 θ | ϖ0 + M + 2e·sin M + 1.25e²·sin 2M |

θ は、太陽から見た惑星の方向（黄道の上の角度）です。最後の 2 項は中心差と呼ばれる補正で、軌道が円でない分を直します。

なお、これは JPL の計算手順そのものではありません。JPL の手順では、軌道傾斜角や昇交点黄経も使い、ケプラー方程式を解いて 3 次元の位置を求めます。今回は、それらを省き、軌道を黄道面の上にあるものとして、中心差の 2 項で日心黄経を近似しています。カードに描くための、簡略化した計算です。

計算式では、8 惑星の値を **8 本の並列配列**で持ち、`ARRAY_FOR(8, i, …)` で回しています。印刷屋の `ARRAY` は入れ子を平坦にする（`ARRAY(配列8, 配列8)` は 16 個の配列になる）ので、表の形にせず、`ARRAY_GET(配列, i)` で引きます。

```text
l0, ARRAY(252.250, 181.979, 100.465, -4.553, 34.396, 49.954, 313.238, -55.120),
dl, ARRAY(149472.674, 58517.815, 35999.372, 19140.303, 3034.746, 1222.494, 428.482, 218.459),
w0, ARRAY(77.458, 131.602, 102.938, -23.944, 14.728, 92.599, 170.954, 44.965),
ec, ARRAY(0.2056, 0.0068, 0.0167, 0.0934, 0.0484, 0.0539, 0.0473, 0.0086),
tc, DATE_DIFF("2000-01-01", 生年月日, "days") / 36525,
md, ARRAY_FOR(8, i, ARRAY_GET(l0, i) + ARRAY_GET(dl, i) * tc - ARRAY_GET(w0, i)),
```

## 1.2 sin は四則演算で作る

資料の関数一覧には `M_SIN`・`M_COS` が載っています。ところが、印刷屋 Ver.8 の計算式で使うと、検査（normalize）が `M_SIN() is not available.` で止まりました。計算式のエンジンを調べると、`M_` で始まる関数は decimal.js を使う作りで、Ver.8 の zip はそれを読み込んでいませんでした。

そこで、sin を四則演算で作りました。角度を −90°〜90° に折りたたんでから、テイラー展開を 11 次まで計算します（誤差は 6×10⁻⁸ ほど）。sin M と sin 2M をまとめて 16 個の配列にし、1 つの式で計算しています。cos は sin(θ + 90°) です。

```text
sm, ARRAY_MAP(ARRAY(md, ARRAY_MAP(md, m, 2 * m)), d, LET(
  a, MOD(MOD(d, 360) + 360, 360), b, IF(a > 180, a - 360, a),
  c, IF(b > 90, 180 - b, IF(b < -90, -180 - b, b)),
  x, c * PI() / 180, x2, x * x,
  x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110))))))),
```

A4 に何枚も並べる版（3 章）では、評価回数を減らすため、Bhaskara の近似式 `4b(180 − b) / (40500 − b(180 − b))`（b は 0〜180°）に代えました。誤差は 0.0016 ほどで、3 件の黄経は整数にすると同じでした。

## 1.3 検算

見本の 3 件で、黄経（度、整数に丸めたもの）を検算表と比べました。24 個とも一致しています。

| 生年月日 | 水星 | 金星 | 地球 | 火星 | 木星 | 土星 | 天王星 | 海王星 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1990-05-15 | 256 | 306 | 235 | 307 | 108 | 290 | 277 | 283 |
| 2000-01-01 | 254 | 183 | 100 | 359 | 36 | 46 | 316 | 304 |
| 2026-10-14 | 307 | 15 | 21 | 92 | 132 | 11 | 63 | 3 |

天文計算のライブラリの値とも比べ、この 3 つの日付では、差は最大で 2°（水星）でした。カードには「惑星の位置は日心黄経（近似、誤差 ±2° 程度）。軌道の大きさはデフォルメ」と書いていますが、この「±2°」は、比べた範囲での目安です。

---

# 2. 図を描く

`<svg>` は使わず、div を絶対位置で置いて描いています。

- **軌道**: 半径 60 + 40i（i = 0〜7）の円を等間隔に並べる。実際の比率では内側の 4 惑星が太陽に重なるので、デフォルメした。軌道傾斜角や太陽からの実際の距離は反映しない、平面の模式図
- **惑星の位置**: x = 380 + r·cos θ、y = 436 − r·sin θ。黄経 0° が右、反時計回り（画面の y は下向きなので引く）
- **土星の環**: 楕円の枠線を `transform: rotate(-20deg)` で傾ける。html2canvas でも回転はそのまま描かれた
- **春分点**: 右端に ♈ と「春分点」。♈ は `&#xFE0E;` を付けて、絵文字ではなく文字で出す
- **惑星の名前**: 惑星の右に置き、地の色の背景を付けて軌道の線を隠す

計算式は、惑星と名前の div を 8 つ分つなげた HTML を作り、雛形の `##planets##` と置き換えます。

---

# 3. A4 に 2 枚並べる（一覧帳票）

カードは A5 横なので、A4 縦の用紙に 2 枚並べれば、紙を半分にできます。一覧画面のボタンにして、一覧に出ているレコードを 2 枚ずつ並べ、間に切り取り線を引きました。

![A4 に 2 枚（96 dpi 版、実機の PDF の 11 ページ目）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/00f1f539-7ca5-4dc3-975f-85537ed99891.jpeg)

一覧帳票では、`RECS_MAP` で一覧のレコードを 1 件ずつ計算します。式の外の `LET` の変数も中から見えるので、レコードによらない値（軌道要素から作る係数など）は外で 1 回だけ計算しています。

```text
lim, 24,
cards, RECS_MAP(rk, IF(rk < lim, LET(
    …カード 1 枚の計算（1 章・2 章）…,
    REPLACE(…REPLACEALL(tpl, "##bd##", …)…, "##name##", nmv)), "")),
all, ARRAY_COUNT(cards),
n, MIN(all, lim),
CONCAT(
  JOIN(ARRAY_FOR(CEIL(n / 2, 0), p, CONCAT(
    "<div class='rex0220-pcraft-page sc-a4'>", ARRAY_GET(cards, p * 2),
    IF(p * 2 + 1 < n, CONCAT("<div class='sc-cut'></div>", ARRAY_GET(cards, p * 2 + 1)), ""),
    "</div>")), ""),
  IF(all > lim, …案内のページ…, ""))
```

## 3.1 1 回に作る枚数の上限

[原稿用紙の記事](https://qiita.com/rex0220/items/bb2649ca3d70264b8242) で分かったとおり、印刷屋の計算式のエンジンは、1 つの式の評価が 10 万回を超えると止まります（エラーの文から読み取った値で、資料では確かめていません）。`RECS_MAP` で回すと、**全カードの評価回数の合計**が 10 万回までになります。

一覧帳票は 1 件のプレビューの対象外なので、AI は、同じ式を `ARRAY_FOR(N, rk, …)` にした詳細画面用の作業ボタンを作り、N を変えて上限を測りました。次の表は、印刷屋 Ver.8 の今回の環境で測った値です。

| 段階 | 1 枚の評価回数 | 通った枚数 | 止まった枚数 | 上限にした件数 |
| :--- | :--- | ---: | ---: | ---: |
| sin を Bhaskara にし、係数を外に出した後 | 約 2,000〜2,500 | 40 | 50 | 30 |
| 名前の向きの判定（4 章）を足した後 | 約 2,800〜3,300 | 30 | 36 | 24 |

上限の件数は、止まった枚数ちょうどではなく、余裕を持たせた値にしています（30 枚が通り 36 枚で止まったので 24 件）。星座の欄（5 章）を足した後も、24 件で止まらないことを測り直しました。

上限を超えた分は `IF(rk < lim, …, "")` で計算しないので、一覧が何件あっても式は止まりません。最後に「一覧に 33 件あります。1 回に作れるのは 24 件（A4 で 12 枚）までなので、先頭の 24 件だけを作りました」という案内のページを付けます。

なお、「選択したレコードのみ一括処理」のチェックは、一覧画面にいつも出ます。チェックを入れてレコードを選べば、その分だけを作れます。

## 3.2 96 dpi 版

150 dpi 版の px をすべて 0.64 倍した 96 dpi 版も作りました（線は 1px 未満にしない）。計算式の中の座標（中心、半径、名前の幅）も 0.64 倍にしています。

| PDF | ページ | 大きさ |
| :--- | ---: | ---: |
| A4 に 2 枚（150 dpi） | 1 | 293KB |
| A4 に 2 枚（96 dpi） | 1 | 152KB |
| A4 に 24 枚 + 案内（96 dpi、星座の図つき） | 13 | 約 2.1MB |

---

# 4. 惑星の名前が隣の惑星に隠れる

見本を 30 件に増やして A4 版を作ると、隣の軌道の惑星が同じ方向にあるときに、名前が隣の惑星に隠れるカードがありました。

![直す前: 地球の名前が火星に隠れている（1956 年 9 月 3 日、実機の PDF）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/b10e81b3-5c30-42ad-a794-e41f489e404f.jpeg)

そこで、名前はふつう右に置き、**右に置くと隣の軌道の惑星（i − 1 と i + 1）に掛かり、左なら空いているときだけ左に置く**ことにしました。

![直した後: 地球の名前を左に回した（同じ日付。印刷屋と同じ html2canvas で描いたもの）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/0717c141-5106-4e58-82a0-4183b86ec6ce.jpeg)

判定では、惑星の配列の前後に遠い点（-9999）を足した配列を作り、i の内側の隣を `i`、外側の隣を `i + 2` で引いています。こうすると、水星と海王星で端の判定が要りません。縦が離れていれば 1 回の比較で済ませ、評価回数を抑えました。

```text
pxs, ARRAY(-9999, px, -9999),
pys, ARRAY(-9999, py, -9999),
lf, ARRAY_FOR(8, i, LET(
  qx, ARRAY_GET(px, i), qy, ARRAY_GET(py, i), ex, ARRAY_GET(ew, i),
  // 隣の惑星ごとに 1: 右の名前に掛かる、2: 左に置いた名前に掛かる
  va, IF(ABS(ARRAY_GET(pys, i) - qy) > 9 + ARRAY_GET(hws, i), 0, LET(hj, ARRAY_GET(hws, i), dx, ARRAY_GET(pxs, i) - qx,
    IF(dx > 0 - hj, IF(dx < ex + hj, 1, 0), 0) + IF(dx < hj, IF(dx > 0 - ex - hj, 2, 0), 0))),
  vb, …（i + 2 で同じ計算）…,
  // 右が掛からなければ右。右が掛かり、左が空いていれば左
  IF(MOD(va, 2) + MOD(vb, 2) = 0, 0, IF(va > 1, 0, IF(vb > 1, 0, 1))))),
```

左に置く名前は、CSS の `right` で位置を決めます（名前の長さが惑星ごとに違うため）。

AI が 3,000 日分の日付で同じ判定を試算したところ、名前が隣の惑星に重なるカードは、右に置くだけでは 8.0%、左に回すと 0.3% になりました（名前を下に置く案は 1.8%）。実機の PDF でも、左に回るはずの 5 枚がすべて左に出ていました。

---

# 5. 誕生星座の図を足す

## 5.1 AI の評価

カードの右下に空きがあったので、「誕生日の星座ごとに星座のデザイン図を表示したらどうか」と AI に評価を頼みました。AI の評価の要点は、次のとおりです。

- **計算で決められる**: 地球から見た太陽の方向は「地球の日心黄経 + 180°」。これを 30° ごとに区切れば 12 星座が決まり、日付の表は要らない
- **星占いの星座と、天文学の星座は一致しないことが多い**: 星占いの 12 星座は、春分点から 30° ずつの区画。天文学の星座は、境界が 30° ずつではなく、地軸の首振り（歳差）で春分点も動いてきたため、その日に太陽が実際に重なっている星座とは一致しないことが多い。見本の 3 件でも 2 件が違う（2000-01-01 は星占いではやぎ座だが、太陽はいて座の方向。2026-10-14 は、てんびん座とおとめ座）
- **置き場所**: 右の列の下。ただし、メッセージや名前が長いと空きが減るので、メッセージの行数と名前の大きさを抑える

天文のカードなので、表示は「星占いの 12 星座」であることをはっきり書くことにしました。

## 5.2 Claude Design で 12 星座を描く

図は、Claude Design（Claude のデザイン用のキャンバス）で AI に描かせました。

1. 「とりあえず 1 星座の案を」で、みずがめ座を 1 枚
2. 「星の位置は無関係で単にイメージ図で良いのでは？」で、星の並びではなく、水がめの絵に
3. 「線画で水瓶のようなイメージに」で、塗りをやめて線画に
4. 「模様をへらす」で、帯の模様や溝を消す
5. 「OK」で、同じ描き方で残りの 11 星座を描く
6. キャンバスのスクリーンショットを見せると、AI が「いて座の矢羽根が箱に見える」「やぎ座が鳥に見える」「おとめ座が頭巾に見える」を挙げて描き直した

![Claude Design のキャンバス（12 星座）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/4387beae-f805-4ef9-895e-91c29ff34072.png)

12 枚とも、金の二重丸の台紙、紺の輪郭線（中は白抜き）、金と青のアクセントでそろえています。

## 5.3 星座を決める計算

星座は、地球の日心黄経（配列 `th` の添字 2。添字は 0 始まり）から決めます。JPL の近似軌道要素は 2000 年の春分点が基準なので、歳差（1 世紀に約 1.397°）を足して、生まれた年の春分点から測る角度に直しています。

```text
lam, MOD(MOD(ARRAY_GET(th, 2) + 180 + 1.397 * tc, 360) + 360, 360),
zi, ROUNDDOWN(lam / 30, 0),
zh, CONCAT("<div class='sc-zd-box'><div class='sc-zd sc-zd", zi, "'></div><div class='sc-zd-txt'>",
  "<div class='sc-zd-h'>誕生星座</div><div class='sc-zd-nm'>", ARRAY_GET(zn, zi), "</div>",
  "<div class='sc-zd-dt'>", ARRAY_GET(zd, zi), "</div>",
  "<div class='sc-zd-nt'>太陽の黄経 ", MOD(ROUND(lam, 0), 360), "° から求めた<br>星占いの 12 星座</div></div></div>"),
```

歳差は、1 世紀あたり 1.397° の一次式で近似しています。星座が変わる日の前後は、この近似と、生まれた時刻が分からないことの両方で、どちらの星座にもなりえます（8 章）。

`zn` は星座の名前、`zd` は「4月20日〜5月20日ごろ」のような期間の配列です。図は、class の `sc-zd0`〜`sc-zd11` に CSS で割り当てています。見本の 3 件は、おうし座（54°）、やぎ座（280°）、てんびん座（201°）になりました。

星座の欄を置く場所を空けるため、メッセージは 5 行まで（内側の箱で切り、半端な行がのぞかないようにする）、名前は 9 字から字を小さくするようにしました。

## 5.4 印刷屋に SVG を入れる

印刷屋の HTML では、`<svg>` 要素をそのまま書くと検査がエラーにします。図は、資料の見積書の社印と同じく、**data URL の画像**にします。

12 枚の SVG を 4 つのボタンに 1 回ずつ入れると、同じ図を 4 回持つことになります。そこで、**共通 CSS（cssInfo）に 1 回だけ**置き、各ボタンからは class で参照しました。

```css
.sc-zd10 { background-image: url("data:image/svg+xml;charset=utf8,%3Csvg … %3C/svg%3E"); }
```

- SVG は、色や線の太さを SVG の中の `<style>` にまとめて、1 枚 2〜3KB にした
- 印刷屋 MCP のツールはボタン単位で差し替えるので、**既にある設定ファイルの共通 CSS は変えられない**。共通 CSS（既定の 4 行 + 星座の 2 行）を入れた新しい設定ファイルを保存し、ボタンはそこへ 1 つずつ入れた
- 設定の保存値は、圧縮後 46,837 バイト（上限 262,144 バイトの 18%）
- 共通 CSS を含むので、取り込むときは「全置換」にする

---

# 6. 実機の PDF で、図の線がにじむ

A4 版を実機で作ると、星座の図は出ましたが、拡大すると線がにじみ、点線のように欠けていました。文字はくっきりしているのに、図だけがぼやけています。

![直す前: 線がにじんで欠ける（実機の PDF、96 dpi 版）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/679eb7ef-b7a2-4992-a4d1-0063ed038cd1.jpeg)

AI が印刷屋の zip に入っている html2canvas（1.4.1）を調べると、印刷屋は `html2canvas(content, { scale: 2 })` で呼んでいました。この html2canvas 1.4.1 の実装では、**背景画像を、いったん CSS の大きさ（倍率を掛けない px）の画像に縮めてから、2 倍に引き伸ばして**描きます。400×400 の SVG を 107px に縮めるときに細い線が欠け、それを 2 倍にするのでにじみます。

そこで、図の箱を SVG の原寸（400px）のまま置き、CSS の `transform` で縮めました。背景の大きさと画像の大きさが同じなので、縮める処理を通りません。

```css
.sc-zd-box { position: absolute; left: 820px; top: 666px; width: 380px; height: 180px; overflow: hidden; }
.sc-zd { position: absolute; left: 0; top: 6px; width: 400px; height: 400px;
  background-repeat: no-repeat; background-size: 400px 400px;
  transform: scale(0.42); transform-origin: 0 0; }   /* 150 dpi で 168px。96 dpi 版は scale(0.2688) */
```

AI は、印刷屋の zip の html2canvas を手元の Chrome で動かし、直す前と後を描き比べてから設定を直しました。実機で作り直すと、線は文字と同じようにくっきり出ました。

![直した後（実機の PDF、96 dpi 版）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/6537cdb3-1e9c-442a-bf24-9136a78d5e01.jpeg)

---

# 7. 惑星直列の日を描く

「惑星直列として話題になった日は？」と AI に聞き、挙がった 4 つの日を見本のレコードにしてカードを作りました。下の画像は、A4 版（96 dpi）の実機の PDF から 4 枚を切り出して並べたものです。

![惑星直列で話題になった 4 つの日（左上から 1962・1982・2000・2025 年。実機の PDF、96 dpi 版）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/c81eda2b-286a-418c-9e93-53a06974fc6a.jpeg)

| 日付 | 話題になった並び | カードの図（太陽から見た位置） |
| :--- | :--- | :--- |
| 1962 年 2 月 5 日 | 日食の日に、地球から見て水星・金星・火星・木星・土星が太陽の近くに集まって見えた | 金星・火星・木星・土星は太陽の向こう側、水星は地球と太陽の間 |
| 1982 年 3 月 10 日 | 「ジュピター効果」として、惑星直列が災害を起こすと騒がれた | 8 惑星が太陽の片側、95° の幅に集まる |
| 2000 年 5 月 5 日 | 水星・金星・火星・木星・土星が太陽の向こう側に集まった | 5 惑星が太陽の向こう側の 50° ほどに入り、地球はその反対側 |
| 2025 年 2 月 28 日 | 夕方の空に 7 つの惑星が並んだ（惑星パレード） | 太陽から見ると散らばっていて、一直線ではない |

「惑星直列」は、太陽から見て惑星が同じ向きに集まることにも、地球から見て空で惑星が並ぶことにも使われます。カードは太陽から見た位置を描くので、1982 年は片側に集まり、2025 年は散らばって見えます。

2025 年のカードでは、海王星が春分点（黄経 0°）のすぐ近くにあり、右に置いた名前が ♈ の印とぶつかりました。そこで、4 章の判定に、海王星の黄経が 0° の前後 8° なら名前を左に回す条件を足しました。この近似式では、2021 年 12 月から 2029 年 2 月ごろに生まれた人のカードが当たります。

```text
  // 海王星が春分点（黄経 0°）の前後 8° にいると、右の名前が春分点の印とぶつかる
  nr, IF(i = 7, IF(ABS(MOD(ARRAY_GET(th, 7) + 180, 360) - 180) < 8, 1, 0), 0),
  // 右が掛からず春分点にも近くなければ右。それ以外は、左が空いていれば左
  IF(MOD(va, 2) + MOD(vb, 2) + nr = 0, 0, IF(va > 1, 0, IF(vb > 1, 0, 1))))),
```

---

# 8. つまずき（計算式のエンジンの性質）

印刷屋 Ver.8 の zip に入っている計算式のエンジンを、tools から動かして確かめたものです。ほかの版でも同じかは確かめていません。

## 8.1 `REPLACE` は最初の 1 か所だけ置き換える

メッセージの改行を `<br>` にするのに、資料の例どおり `REPLACE(ESC_HTML(メッセージ), NEWLINE(), "<br>")` と書くと、2 つ目からの改行が消えました。`REPLACE` は最初の 1 か所だけを置き換えます。すべて置き換えるには `REPLACEALL` を使います。

```text
${REPLACEALL(ESC_HTML(メッセージ), NEWLINE(), "<br>")}
```

検査（normalize）はこの形に html.rawExpression の警告を出しますが、`ESC_HTML` で文字を直してから改行を置き換えているので、そのままにしました。

また、`REPLACE` の置き換える文字列では、`$&` などが特別な意味を持ちます。A4 版では、名前とメッセージを `REPLACE` で雛形に差し込むので、先に `REPLACEALL(…, "$", "&#36;")` で `$` を文字参照にしています。

## 8.2 そのほか

| 式 | 結果 | 対処 |
| :--- | :--- | :--- |
| `MOD(-10, 360)` | -10 | 0〜360 にするなら `MOD(MOD(x, 360) + 360, 360)` |
| `FIXED(12, 1, 0)` | `12` | 小数 1 桁にそろえるなら、整数部と小数部を組む |
| `FIXED(686.980)` | `686.98` | 公転周期の表示は文字列の配列で持つ |
| `"_" & 生年月日`（日付の項目） | `_642697200` のような数 | ファイル名では `DATE_FORMAT(生年月日, "YYYY-MM-DD")` |

日付の項目を `&` でつなぐと、Unix 時刻（秒）になりました。最初のファイル名が「太陽系カード_星野 みらい_642697200.pdf」のようになり、気づきました。

---

# 9. 対応していないこと・気を付けること

- **黄経の精度**: 簡略化した近似式なので、今回比べた 3 つの日付で差は最大 2°。軌道要素の表は 1800〜2050 年向けなので、その外の生年月日では誤差が大きくなる
- **星座の境目の日**: 生まれた時刻が分からないので、星座が変わる日に生まれた人は、どちらにもなりうる。表示は星占いの 12 星座で、実際に太陽が重なっていた星座ではない
- **メッセージ**: 5 行まで（それより長い分は出ない）
- **名前**: 9〜11 字は字を小さくして 1 行、12 字からはさらに小さくして 2 行
- **A4 版**: 1 回に作れるのは 24 件まで
- **書体**: 実機で確かめたのは Mac だけ。Windows の書体では確かめていない

---

# 10. 設定ファイル

掲載したのは、1 枚用（A5 横、150 dpi）のボタン 1 つです。試作では、これに A4 に 2 枚の一覧帳票と、それぞれの 96 dpi 版を足して 4 つにしました。

星座の図（12 枚の SVG）は共通 CSS に入れているので、ここでは省いています。図を使うときは、共通 CSS に `.sc-zd0`〜`.sc-zd11`（0 がおひつじ座、11 がうお座）の `background-image` を書いてください。書かない場合、星座の名前と期間だけが出ます。

使うアプリには、`名前`（文字列 1 行）、`生年月日`（日付）、`メッセージ`（文字列複数行）、`カードPDF`（添付ファイル）のフィールドコードが要ります。`appId`・`appName` は今回のアプリの値です。

<details><summary>太陽系カード.json（1 枚用のボタン。クリックで開く）</summary>

```json
{
  "date": "2026-10-15 00:00:00",
  "pluginName": "印刷屋プラグイン",
  "pluginID": "rex0220 Print craft plugin",
  "PluginVersion": "8",
  "appId": 4324,
  "appName": "誕生日カード",
  "pluginEnable": true,
  "commonCssEnable": true,
  "externalRefs": "block",
  "pluginInfos": [
    {
      "state": true,
      "menu": "太陽系カード",
      "menu_en": "Solar System Card",
      "mcheck": true,
      "list": false,
      "authority": false,
      "desc": "太陽系カードの PDF を作ります",
      "desc_en": "Create the solar system birthday card",
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
            "formulaSet": "\"太陽系カード_\" & 名前 & \"_\" & DATE_FORMAT(生年月日, \"YYYY-MM-DD\") & \".pdf\""
          },
          {
            "state": true,
            "desc": "カード",
            "css": ".rex0220-pcraft-page.sc-page { padding: 0; background: #f7f3e8; color: #3b3428;\n  font-family: \"Hiragino Maru Gothic ProN\", \"Hiragino Sans\", \"BIZ UDPGothic\", \"Yu Gothic\", \"Meiryo\", sans-serif; }\n.sc-frame { position: absolute; left: 16px; top: 16px; right: 16px; bottom: 16px; border: 2px solid #e4dac2; border-radius: 18px; }\n.sc-title { position: absolute; left: 40px; top: 30px; font-size: 30px; line-height: 40px; font-weight: bold; color: #2f4b7c; letter-spacing: 0.04em; }\n.sc-orbit { position: absolute; box-sizing: border-box; border: 1.5px solid #d3c9b1; border-radius: 50%; }\n.sc-sun-halo { position: absolute; left: 346px; top: 402px; width: 68px; height: 68px; border-radius: 50%; background: #fbe6b0; }\n.sc-sun { position: absolute; left: 356px; top: 412px; width: 48px; height: 48px; border-radius: 50%; box-sizing: border-box; background: #f4a52a; border: 2px solid #e98b12; }\n.sc-aries-tick { position: absolute; left: 724px; top: 435px; width: 56px; height: 2px; background: #8b7f63; }\n.sc-aries { position: absolute; left: 784px; top: 422px; font-size: 22px; line-height: 26px; color: #8b7f63; }\n.sc-aries-lb { position: absolute; left: 778px; top: 448px; font-size: 11px; line-height: 14px; color: #8b7f63; white-space: nowrap; }\n.sc-pl { position: absolute; border-radius: 50%; box-sizing: border-box; border: 1px solid rgba(60, 50, 30, 0.35); }\n.sc-p0 { width: 12px; height: 12px; margin: -6px 0 0 -6px; }\n.sc-p1 { width: 16px; height: 16px; margin: -8px 0 0 -8px; }\n.sc-p2 { width: 18px; height: 18px; margin: -9px 0 0 -9px; }\n.sc-p3 { width: 14px; height: 14px; margin: -7px 0 0 -7px; }\n.sc-p4 { width: 32px; height: 32px; margin: -16px 0 0 -16px; }\n.sc-p5 { width: 26px; height: 26px; margin: -13px 0 0 -13px; }\n.sc-p6 { width: 20px; height: 20px; margin: -10px 0 0 -10px; }\n.sc-p7 { width: 20px; height: 20px; margin: -10px 0 0 -10px; }\n.sc-c0 { background: #9a948c; }\n.sc-c1 { background: #e3b54d; }\n.sc-c2 { background: #3b7dd8; }\n.sc-c3 { background: #d4553a; }\n.sc-c4 { background: #c98c5a; }\n.sc-c5 { background: #dcbf72; }\n.sc-c6 { background: #69c3cf; }\n.sc-c7 { background: #3e5cc0; }\n.sc-ring { position: absolute; width: 48px; height: 14px; margin: -7px 0 0 -24px; box-sizing: border-box; border: 2.5px solid #a7864a; border-radius: 50%; transform: rotate(-20deg); }\n.sc-lb { position: absolute; margin-top: -8px; padding: 0 2px; border-radius: 3px; background: #f7f3e8; font-size: 13px; line-height: 16px; color: #5b5141; white-space: nowrap; }\n.sc-l0 { margin-left: 8px; }\n.sc-l1 { margin-left: 10px; }\n.sc-l2 { margin-left: 11px; }\n.sc-l3 { margin-left: 9px; }\n.sc-l4 { margin-left: 18px; }\n.sc-l5 { margin-left: 26px; }\n.sc-l6 { margin-left: 12px; }\n.sc-l7 { margin-left: 12px; }\n.sc-note { position: absolute; left: 40px; top: 808px; width: 720px; font-size: 14px; line-height: 20px; color: #7d735f; }\n.sc-side { position: absolute; left: 820px; top: 46px; width: 380px; }\n.sc-hb { font-size: 15px; letter-spacing: 0.3em; color: #b8873a; font-weight: bold; }\n.sc-name { margin-top: 8px; font-size: 38px; line-height: 48px; font-weight: bold; color: #2f4b7c; word-break: break-all; }\n.sc-name small { margin-left: 8px; font-size: 20px; color: #3b3428; }\n.sc-birth { margin-top: 6px; font-size: 18px; line-height: 26px; }\n.sc-days { margin-top: 2px; font-size: 16px; line-height: 28px; color: #5b5141; }\n.sc-days b { font-size: 22px; color: #2f4b7c; }\n.sc-days span { font-size: 12px; color: #7d735f; }\n.sc-msg { margin-top: 14px; padding: 12px 16px; background: #fffdf7; border: 1px solid #e4dac2; border-radius: 12px; font-size: 17px; line-height: 27px; min-height: 54px; word-break: break-all; }\n.sc-age-h { margin-top: 16px; font-size: 16px; font-weight: bold; color: #2f4b7c; }\n.sc-tbl { width: 100%; margin-top: 4px; border-collapse: collapse; font-size: 15px; }\n.sc-tbl th { padding: 2px 6px; border-bottom: 1px solid #d3c9b1; font-size: 12px; font-weight: normal; color: #7d735f; text-align: right; }\n.sc-tbl th:first-child { text-align: left; }\n.sc-tbl td { padding: 2px 6px; border-bottom: 1px solid #ece4d1; line-height: 20px; }\n.sc-num { text-align: right; }\n.sc-yr { font-size: 17px; font-weight: bold; color: #2f4b7c; }\n.sc-dot { display: inline-block; width: 11px; height: 11px; margin-right: 8px; vertical-align: -1px; border-radius: 50%; box-sizing: border-box; border: 1px solid rgba(60, 50, 30, 0.35); }\n.sc-cap { margin-top: 4px; font-size: 11px; color: #7d735f; }\n\n/* 誕生星座（右の列の下。図は 12 星座の SVG を背景に） */\n.sc-zd-box { position: absolute; left: 820px; top: 666px; width: 380px; height: 180px; overflow: hidden; }\n/* 図は原寸（400 × 400）のまま置いて transform で縮める（html2canvas は背景を CSS の大きさに縮めてから 2 倍にするので、線がにじむ） */\n.sc-zd { position: absolute; left: 0; top: 6px; width: 400px; height: 400px; background-repeat: no-repeat; background-size: 400px 400px; transform: scale(0.42); transform-origin: 0 0; }\n.sc-zd-txt { position: absolute; left: 184px; top: 26px; width: 196px; }\n.sc-zd-h { font-size: 13px; line-height: 18px; font-weight: bold; letter-spacing: 0.3em; color: #b8873a; }\n.sc-zd-nm { margin-top: 4px; font-size: 28px; line-height: 36px; font-weight: bold; color: #2f4b7c; }\n.sc-zd-dt { margin-top: 2px; font-size: 15px; line-height: 22px; }\n.sc-zd-nt { margin-top: 10px; font-size: 12px; line-height: 18px; color: #7d735f; }\n/* メッセージは 5 行まで（27px × 5） */\n.sc-msg-in { max-height: 135px; overflow: hidden; }\n/* 長い名前（9〜11 字は 1 行に、12 字からは 2 行に） */\n.sc-name.sc-name-s { font-size: 28px; }\n.sc-name.sc-name-xs { font-size: 20px; line-height: 24px; }\n",
            "html": "<div class=\"rex0220-pcraft-page sc-page\">\n  <div class=\"sc-frame\"></div>\n  <div class=\"sc-title\">${DATE_FORMAT(生年月日, \"YYYY年M月D日\")}の太陽系</div>\n  <div class=\"sc-orbit\" style=\"left:320px;top:376px;width:120px;height:120px\"></div><div class=\"sc-orbit\" style=\"left:280px;top:336px;width:200px;height:200px\"></div><div class=\"sc-orbit\" style=\"left:240px;top:296px;width:280px;height:280px\"></div><div class=\"sc-orbit\" style=\"left:200px;top:256px;width:360px;height:360px\"></div><div class=\"sc-orbit\" style=\"left:160px;top:216px;width:440px;height:440px\"></div><div class=\"sc-orbit\" style=\"left:120px;top:176px;width:520px;height:520px\"></div><div class=\"sc-orbit\" style=\"left:80px;top:136px;width:600px;height:600px\"></div><div class=\"sc-orbit\" style=\"left:40px;top:96px;width:680px;height:680px\"></div>\n  <div class=\"sc-sun-halo\"></div>\n  <div class=\"sc-sun\"></div>\n  <div class=\"sc-aries-tick\"></div>\n  <div class=\"sc-aries\">♈&#xFE0E;</div>\n  <div class=\"sc-aries-lb\">春分点</div>\n  ##planets##\n  ##zodiac##\n  <div class=\"sc-note\">惑星の位置は日心黄経（近似、誤差 ±2° 程度）。軌道の大きさはデフォルメ</div>\n  <div class=\"sc-side\">\n    <div class=\"sc-hb\">HAPPY BIRTHDAY</div>\n    <div class=\"sc-name ##namecls##\">${ESC_HTML(名前)}<small>さん</small></div>\n    <div class=\"sc-birth\">${DATE_FORMAT(生年月日, \"YYYY年M月D日\")} 生まれ</div>\n    <div class=\"sc-days\">生まれてから <b>##days##</b> 日<span>（${DATE_FORMAT(TODAY(), \"YYYY年M月D日\")} 現在）</span></div>\n    <div class=\"sc-msg\"><div class=\"sc-msg-in\">${REPLACEALL(ESC_HTML(メッセージ), NEWLINE(), \"<br>\")}</div></div>\n    <div class=\"sc-age-h\">惑星年齢</div>\n    <table class=\"sc-tbl\">\n      <thead><tr><th>惑星</th><th>公転周期（日）</th><th>年齢（歳）</th></tr></thead>\n      <tbody>##ages##</tbody>\n    </table>\n    <div class=\"sc-cap\">惑星年齢 = 生まれてからの日数 ÷ 公転周期</div>\n  </div>\n</div>",
            "formulaSet": "LET(\n  // 惑星ごとの値は 8 本の並列配列（0 水星、1 金星、2 地球、3 火星、4 木星、5 土星、6 天王星、7 海王星）\n  // ARRAY は入れ子を平坦にするので、表にせず ARRAY_GET(配列, i) で引く\n  nm, ARRAY(\"水星\", \"金星\", \"地球\", \"火星\", \"木星\", \"土星\", \"天王星\", \"海王星\"),\n  // JPL の近似軌道要素（J2000）: 平均黄経 L0、その変化（度/世紀）、近日点黄経、離心率\n  l0, ARRAY(252.250, 181.979, 100.465, -4.553, 34.396, 49.954, 313.238, -55.120),\n  dl, ARRAY(149472.674, 58517.815, 35999.372, 19140.303, 3034.746, 1222.494, 428.482, 218.459),\n  w0, ARRAY(77.458, 131.602, 102.938, -23.944, 14.728, 92.599, 170.954, 44.965),\n  ec, ARRAY(0.2056, 0.0068, 0.0167, 0.0934, 0.0484, 0.0539, 0.0473, 0.0086),\n  // 公転周期（日）\n  per, ARRAY(87.969, 224.701, 365.256, 686.980, 4332.59, 10759.22, 30688.5, 60182),\n  // 表に出す公転周期（FIXED は 686.980 を 686.98 にするので、文字で持つ）\n  pertx, ARRAY(\"87.969\", \"224.701\", \"365.256\", \"686.980\", \"4,332.59\", \"10,759.22\", \"30,688.5\", \"60,182\"),\n  // 2000-01-01 からのユリウス世紀数\n  tc, DATE_DIFF(\"2000-01-01\", 生年月日, \"days\") / 36525,\n  // 平均近点角 M（度）\n  md, ARRAY_FOR(8, i, ARRAY_GET(l0, i) + ARRAY_GET(dl, i) * tc - ARRAY_GET(w0, i)),\n  // sin M（0〜7）と sin 2M（8〜15）をまとめて\n  sm, ARRAY_MAP(ARRAY(md, ARRAY_MAP(md, m, 2 * m)), d, LET(a, MOD(MOD(d, 360) + 360, 360), b, IF(a > 180, a - 360, a), c, IF(b > 90, 180 - b, IF(b < -90, -180 - b, b)), x, c * PI() / 180, x2, x * x, x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110))))))),\n  // 日心黄経 θ = ϖ0 + M + 2e·sin M + 1.25e²·sin 2M（右の 2 項はラジアンなので度に直す）。0〜360 度\n  // MOD は負の数に負の余りを返すので、360 を足してもう一度 MOD\n  th, ARRAY_FOR(8, i, LET(ee, ARRAY_GET(ec, i),\n    MOD(MOD(ARRAY_GET(w0, i) + ARRAY_GET(md, i)\n      + (2 * ee * ARRAY_GET(sm, i) + 1.25 * ee * ee * ARRAY_GET(sm, i + 8)) * 180 / PI(), 360) + 360, 360))),\n  // cos θ（0〜7。sin(θ+90°)）と sin θ（8〜15）\n  cs, ARRAY_MAP(ARRAY(ARRAY_MAP(th, t, t + 90), th), d, LET(a, MOD(MOD(d, 360) + 360, 360), b, IF(a > 180, a - 360, a), c, IF(b > 90, 180 - b, IF(b < -90, -180 - b, b)), x, c * PI() / 180, x2, x * x, x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110))))))),\n  // 惑星の中心。軌道は等間隔（半径 60 + 40i）、中心は (380, 436)。黄経 0° を右、反時計回り（y は下向きなので引く）\n  px, ARRAY_FOR(8, i, 380 + (60 + 40 * i) * ARRAY_GET(cs, i)),\n  py, ARRAY_FOR(8, i, 436 - (60 + 40 * i) * ARRAY_GET(cs, i + 8)),\n  // 名前の置き場所。ふつうは右。右に置くと隣の軌道の惑星（i−1、i+1）に掛かり、左なら空いているときだけ左\n  //   hw: 惑星の半分の幅（土星は環を含む）、og: 惑星の中心から名前まで、ew: 惑星の中心から名前の端まで\n  hw, ARRAY(6, 8, 9, 7, 16, 24, 10, 10),\n  hws, ARRAY(0, hw, 0),\n  og, ARRAY(8, 10, 11, 9, 18, 26, 12, 12),\n  ew, ARRAY(38, 40, 41, 39, 48, 56, 55, 55),\n  // 前後にダミー（遠い点）を入れた並び。i の内側の隣は i、外側の隣は i + 2 で引ける（端の判定が要らない）\n  pxs, ARRAY(-9999, px, -9999),\n  pys, ARRAY(-9999, py, -9999),\n  lf, ARRAY_FOR(8, i, LET(\n    qx, ARRAY_GET(px, i), qy, ARRAY_GET(py, i), ex, ARRAY_GET(ew, i),\n    // 隣の惑星ごとに 1: 右の名前に掛かる、2: 左に置いた名前に掛かる（縦が離れていれば 1 回の比較で 0）\n    va, IF(ABS(ARRAY_GET(pys, i) - qy) > 9 + ARRAY_GET(hws, i), 0, LET(hj, ARRAY_GET(hws, i), dx, ARRAY_GET(pxs, i) - qx,\n      IF(dx > 0 - hj, IF(dx < ex + hj, 1, 0), 0) + IF(dx < hj, IF(dx > 0 - ex - hj, 2, 0), 0))),\n    vb, IF(ABS(ARRAY_GET(pys, i + 2) - qy) > 9 + ARRAY_GET(hws, i + 2), 0, LET(hj, ARRAY_GET(hws, i + 2), dx, ARRAY_GET(pxs, i + 2) - qx,\n      IF(dx > 0 - hj, IF(dx < ex + hj, 1, 0), 0) + IF(dx < hj, IF(dx > 0 - ex - hj, 2, 0), 0))),\n    // 海王星が春分点（黄経 0°）の前後 8° にいると、右の名前が春分点の印とぶつかる\n    nr, IF(i = 7, IF(ABS(MOD(ARRAY_GET(th, 7) + 180, 360) - 180) < 8, 1, 0), 0),\n    // 右が掛からず春分点にも近くなければ右。それ以外は、左が空いていれば左\n    IF(MOD(va, 2) + MOD(vb, 2) + nr = 0, 0, IF(va > 1, 0, IF(vb > 1, 0, 1))))),\n  // 惑星と名前を描く（左に置く名前は right で位置を決める。1240 は帳票の箱の幅）\n  pl, JOIN(ARRAY_FOR(8, i, LET(\n    qy, ROUND(ARRAY_GET(py, i), 1),\n    pos, CONCAT(\"left:\", ROUND(ARRAY_GET(px, i), 1), \"px;top:\", qy, \"px\"),\n    CONCAT(\n      \"<div class='sc-pl sc-c\", i, \" sc-p\", i, \"' style='\", pos, \"'></div>\",\n      IF(i = 5, CONCAT(\"<div class='sc-ring' style='\", pos, \"'></div>\"), \"\"),\n      IF(ARRAY_GET(lf, i) = 1,\n        CONCAT(\"<div class='sc-lb' style='right:\", ROUND(1240 - ARRAY_GET(px, i) + ARRAY_GET(og, i), 1), \"px;top:\", qy, \"px'>\"),\n        CONCAT(\"<div class='sc-lb sc-l\", i, \"' style='\", pos, \"'>\")),\n      ARRAY_GET(nm, i), \"</div>\"))), \"\"),\n  // 生まれてからの日数（基準日は帳票を作った日）\n  days, MAX(DATE_DIFF(生年月日, TODAY(), \"days\"), 0),\n  // 惑星年齢 = 日数 ÷ 公転周期。小数 1 桁（FIXED(12, 1, 0) は \"12\" になるので、整数部と小数部を組む）\n  ag, JOIN(ARRAY_FOR(8, i, LET(\n    v10, ROUND(days * 10 / ARRAY_GET(per, i), 0),\n    ip, ROUNDDOWN(v10 / 10, 0),\n    CONCAT(\"<tr><td><span class='sc-dot sc-c\", i, \"'></span>\", ARRAY_GET(nm, i), \"</td>\",\n      \"<td class='sc-num'>\", ARRAY_GET(pertx, i), \"</td>\",\n      \"<td class='sc-num sc-yr'>\", ip, \".\", v10 - ip * 10, \"</td></tr>\"))), \"\"),\n  // 12 星座の名前と、星占いの期間（年によって 1 日ずれる）\n  zn, ARRAY(\"おひつじ座\", \"おうし座\", \"ふたご座\", \"かに座\", \"しし座\", \"おとめ座\", \"てんびん座\", \"さそり座\", \"いて座\", \"やぎ座\", \"みずがめ座\", \"うお座\"),\n  zd, ARRAY(\"3月21日〜4月19日ごろ\", \"4月20日〜5月20日ごろ\", \"5月21日〜6月21日ごろ\", \"6月22日〜7月22日ごろ\", \"7月23日〜8月22日ごろ\", \"8月23日〜9月22日ごろ\", \"9月23日〜10月23日ごろ\", \"10月24日〜11月22日ごろ\", \"11月23日〜12月21日ごろ\", \"12月22日〜1月19日ごろ\", \"1月20日〜2月18日ごろ\", \"2月19日〜3月20日ごろ\"),\n  // 誕生星座（星占いの 12 星座）。太陽の黄経 = 地球の日心黄経 + 180°。歳差（1.397°/世紀）を足して、その年の春分点から測る\n  lam, MOD(MOD(ARRAY_GET(th, 2) + 180 + 1.397 * tc, 360) + 360, 360),\n  zi, ROUNDDOWN(lam / 30, 0),\n  // 図は CSS の背景（sc-zd0〜sc-zd11 に 12 星座の SVG）\n  zh, CONCAT(\"<div class='sc-zd-box'><div class='sc-zd sc-zd\", zi, \"'></div><div class='sc-zd-txt'>\",\n    \"<div class='sc-zd-h'>誕生星座</div><div class='sc-zd-nm'>\", ARRAY_GET(zn, zi), \"</div>\",\n    \"<div class='sc-zd-dt'>\", ARRAY_GET(zd, zi), \"</div>\",\n    \"<div class='sc-zd-nt'>太陽の黄経 \", MOD(ROUND(lam, 0), 360), \"° から求めた<br>星占いの 12 星座</div></div></div>\"),\n  // 長い名前は字を小さく（38px で 1 行 8 字まで。11 字までは 28px、それより長ければ 20px で 2 行）\n  namecls, IF(LENGTH(名前) > 11, \"sc-name-xs\", IF(LENGTH(名前) > 8, \"sc-name-s\", \"\")),\n  // 利用者の文字（名前・メッセージ）は ${} で先に入っているので、目印は雛形でそれより前に置く\n  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE($html,\n    \"##namecls##\", namecls),\n    \"##zodiac##\", zh),\n    \"##planets##\", pl),\n    \"##days##\", FIXED(days)),\n    \"##ages##\", ag)\n)",
            "fieldcode": ""
          }
        ],
        "filecode": "カードPDF",
        "pageSize": "A5",
        "orientation": "l",
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

- `M_SIN` などの `M_` 関数は、資料に載っていても Ver.8 では使えない。三角関数は四則演算で作る
- 惑星の配列は並列配列にして `ARRAY_GET` で引く（`ARRAY` は入れ子を平坦にする）
- 一覧帳票の `RECS_MAP` は、全カードで評価回数（10 万回）を分け合う。レコードによらない値は外で計算し、上限を超えた分は `IF` で計算しない
- 名前の重なりのような見た目の不具合は、見本のレコードを増やして初めて見つかる
- 印刷屋で SVG の図を使うときは data URL にし、複数のボタンで使うなら共通 CSS に 1 回だけ置く
- 背景画像の SVG は、箱を原寸のまま置いて `transform` で縮める。CSS の大きさに合わせると、html2canvas 1.4.1 では縮めてから引き伸ばされ、線がにじむ
- 改行を `<br>` にするときは `REPLACEALL` を使う

---

# まとめ

- 生年月日から 8 惑星の日心黄経を、JPL の近似軌道要素を使った簡略化した式で計算し、「あなたが生まれた日の太陽系」を描く誕生日カードを作った。見本の 3 つの日付で、黄経は検算表と全一致し、天文計算のライブラリとの差は最大 2° だった
- `M_SIN` が使えなかったので、sin はテイラー展開（A4 版は Bhaskara の近似）で作った
- 一覧から A4 に 2 枚ずつ並べる版では、評価回数の上限に合わせて 1 回 24 件までにし、超えたときは案内のページを付けた
- 惑星の名前が隣の惑星に隠れる問題は、右が掛かって左が空いていれば左に回す判定で直した
- 誕生星座の図は Claude Design で描き、SVG を共通 CSS に入れた。実機で線がにじむ原因を html2canvas に見つけ、`transform` で直した
- 設計・計算式・図・不具合の調査と直しは AI に任せた。人が行ったのは、作りたいものと直したいことを頼むことと、実機の PDF を見て確かめることだった

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
10. **「あなたが生まれた日の太陽系」カードを作らせる（この記事）**
11. [業務データから「番付表」を作らせる](https://qiita.com/rex0220/items/de341ab43b4c40bf61c1)
12. [番付表用の相撲字風の書体を作らせる](https://qiita.com/rex0220/items/ffb7caf61c570045d968)

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [帳票レシピ集とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
