<!--
title: rex0220 印刷屋プラグイン - AI に番付表用の相撲字風の書体を作らせる（OFL の書体を加工）
tags:
  - kintone
  - Claude
  - フォント
  - Python
  - OFL
private: false
url: https://qiita.com/rex0220/items/ffb7caf61c570045d968（2026-10-15 公開）
-->

[前回の記事](https://qiita.com/rex0220/items/de341ab43b4c40bf61c1) では、業務データから大相撲の番付表のような PDF を作りました。その番付表の字は、PC に入れた相撲字風の書体「Sumo Trial」で描いています。今回は、**その書体を AI に作らせた話**です。

できあがったのは、下の書体です。左が元にした Noto Serif JP Bold、右が加工した Sumo Trial です。字を太らせて、画と画のすき間を細い白線だけにしています。JIS X 0208 の字（第 1・第 2 水準の漢字と、かな・記号）を中心に、6,884 字を収めました。

![左: 元の Noto Serif JP Bold、右: 加工した Sumo Trial](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/11ad2965-e4a4-427b-a218-681ac9606d69.png)

番付表を作ろうとしたところ、相撲字に向いた無料の書体が見つかりませんでした。そこで、**OFL（SIL Open Font License）の書体を Python で加工して作れないか**を AI に聞くところから始めました。チャットで頼んだことと結果は、次のとおりです。

| # | 頼んだこと | 結果 |
| :--- | :--- | :--- |
| 1 | 「番付に向いたフォントがない」「Google Fonts で、サンプルを表示してみて」 | 毛筆・極太・古風な明朝など 10 書体で、番付の一段を縦書きに組んだ見本のページを作った。どれも「あまりパッとしない」 |
| 2 | 「フォントを作成可能か？」と、ライセンスの質問（Noto・Google Fonts・記事に使うだけなら・加工のスクリプトを配るなら） | OFL の書体なら、加工した書体を作ってよいこと、作った PDF や画像には条件が無いこと、配るときの条件を整理した（2 章） |
| 3 | 「相撲字に加工しやすそうなフォントは？」→ しっぽり明朝と Kaisei Tokumin の zip を渡した | 太い明朝を太らせ、すき間に白線を残す加工を試作した |
| 4 | 「少し太すぎる」→「B で」 | 太らせる量を 4 段階で比べ、B（1em を 360px で描いて 25px）にした |
| 5 | 「太 の字が少し不自然」「継ぎ目が隙間になっている」「大は OK、太はまだ気になる」 | 白線の引き方を何度も直した。「太」の点は、「大」との差から取り出して置き直した |
| 6 | 「元の字で、継ぎ目を補正してから太くしたらどうか？」 | 太らせる前に、元の字の継ぎ目を埋めるようにした。継ぎ目の切れ込みが消えた（3 章） |
| 7 | 「元のフォントをクセのないもので変換するとどうか？」 | 6 書体を同じ加工で比べ、Noto Serif JP Bold に決めた |
| 8 | 「フォントを全て変換するとどのくらいの時間か？」→「Go」 | 1 字 0.08 秒と見積もり、JIS X 0208 の字を並列で約 7 分で作った。口・日・田の中がつぶれる字を直した（4 章） |
| 9 | 「一覧で見るには？」 | 見本のページに全字の一覧を付けた。字を押すと元の書体と並べて拡大する |
| 10 | 「一部が浮いて見える字がある。自動判定できるか？ 個別に修復できるか？」 | 囲みの中身が白線で縁取られる字を直し、手直しが要りそうな字を自動で数えるようにした。字ごとの設定でその字だけ作り直せるようにした（5 章） |
| 11 | 「一箇所だけ浮いて見える」（鴎）→「もとの方がいい」→「V05 の形で」 | 字ごとの設定で直したが、元の形の方がよかったので戻した（5.4） |
| 12 | 「フォントの使い方は？」「PC 単独で、Sumo Trial を使った帳票例を作成するプロンプトを」 | 印刷屋での使い方を整理し、前回の番付表の記事のプロンプトを書いた |

使ったのは、Claude（Claude デスクトップアプリ）です。加工は AI が Claude の作業環境の Python（Pillow、OpenCV、scikit-image、fontTools）で行い、できた書体とスクリプトを Mac の「ダウンロード」に置きました。人が行ったのは、見た目を見て「ここが気になる」と伝えることでした。「少し太すぎる」「太の字が不自然」「継ぎ目が気になる」「もとの方がいい」といった短い言葉を、AI が画像処理の手順の変更に置き換えて試作し直す、という進め方です。

---

# 1. 相撲字と、今回作ったもの

相撲字は、番付表や相撲の看板に使われる、太く丸みのある書き文字です。画を太く書いて、字の中の白い所をできるだけ詰めます。番付表では、たくさんの字が隙間なく並びます。

今回作った Sumo Trial は、相撲字そのものではなく、**明朝体を機械的に加工して相撲字の雰囲気に寄せた試作の書体**です。

| 項目 | 内容 |
| :--- | :--- |
| 元の書体 | Noto Serif JP Bold（Noto Serif CJK JP Bold。SIL Open Font License 1.1） |
| 収録 | JIS X 0208 の 6,877 字（非漢字 522 字、第 1 水準漢字 2,965 字、第 2 水準漢字 3,390 字）と、「ゔゕゖヷヸヹヺ」の 7 字の計 6,884 字。JIS X 0208 の 6,879 字のうち、全角空白と、元の書体に無い「≒」（U+2252）は入っていない |
| 形式 | TrueType（約 5.0MB）と WOFF2（約 2.7MB）。Regular だけ |
| 作る時間 | 約 6〜8 分（作業環境の 2 コアで並列。1 コアなら 1 字あたり約 0.08 秒） |
| 名前 | Sumo Trial（元の書体の名前は使わない） |

---

# 2. ライセンス（OFL）

加工を始める前に、AI にライセンスを確かめさせました。

- **元の書体**: Noto Serif CJK（Noto Serif JP）、しっぽり明朝、Kaisei Tokumin はどれも SIL Open Font License 1.1 です。OFL は、加工した書体を作ることを認めています
- **予約された名前**: OFL では、著作者が「この名前は加工版に使わないで」と決めた名前（Reserved Font Name）を加工版に付けられません。Noto CJK のライセンス文（[noto-cjk の Serif/LICENSE](https://github.com/notofonts/noto-cjk/blob/main/Serif/LICENSE)）には、予約された名前の指定はありませんでした。ただし「Noto」は Google の商標なので、加工版の名前には使いません
- **作ったもの（PDF や画像）**: 書体で作った文書や画像には、OFL の条件はかかりません。印刷屋の PDF は画像（JPEG）なので、書体ファイルが PDF に入ることもありません
- **書体を配るとき**: 元の著作権表示と OFL の全文を付ける、加工版も OFL で配る、書体だけを売らない、が条件です。Sumo Trial は試作なので配っていません。書体ファイルの著作権表示には、元の表示（© 2017-2023 Adobe）に「Modified 2026 (trial, not for distribution).」を足しています
- **加工のスクリプトを配るとき**: スクリプトには書体のデータが入らないので、OFL の条件はかかりません。この記事の最後に載せています。使う人が、自分で元の書体を用意して動かします

---

# 3. 加工のしかた

## 3.1 1 字ずつ画像にして加工し、輪郭に戻す

書体を直接いじるのではなく、**1 字ずつ大きな画像に描き、画像を加工してから輪郭線に戻す**方法にしました。

1. 元の書体で、1 字を 1em = 360px の白黒画像に描く（Pillow）
2. 画像を加工する（OpenCV、scikit-image）
3. 加工した画像の輪郭を多角形にし（`cv2.findContours`）、TrueType の字形にまとめる（fontTools の `FontBuilder`）。外側の輪郭は時計回り、穴は反時計回りにする

画像の加工は、次の順です。下の図の上の段は「園」、下の段は「太」です。

![加工の手順（上: 園、下: 太）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/ac3359af-c012-4ca8-874b-cb061634d951.png)

| 段階 | すること | ねらい |
| :--- | :--- | :--- |
| ① | 元の字を描く | |
| ② | 画が交わる角の細い切れ込みを、クロージング（13px）で埋める | 太らせたあとに、継ぎ目が白い切れ込みとして残らないように（3.3） |
| ③ | 字全体を太らせる（膨張 25px） | 相撲字の太さにする。このままだと、すき間が全部埋まる |
| ④ | 元の字のすき間の中心線（骨格）と、別々の部品の境目に白線を引き、輪郭を少しにじませる | 画と画の区別を細い白線だけで残す。にじみで、筆で書いたような揺れを出す |
| ⑤ | 画に囲まれたすき間（口・日・田の中など）に、太めの白線を入れ直す | 画数の多い字がつぶれないように（4.2） |
| ⑥ | 囲みの中身を縁取る白線を、元のすき間が狭いところで黒くつなぐ | 中身が浮いて見えないように（5 章） |
| ⑦ | 「太」「犬」「玉」の点を、似た字との差から取り出して置き直す | 点が太った画に埋もれないように（3.4） |

## 3.2 太さを決める

太らせる量を 4 段階で比べ、B（1em を 360px で描いたときに 25px）にしました。最初に見せた D（37px）は「少し太すぎる」でした。太くするほど相撲字らしくなりますが、画数の多い字（綱・鈴・藤）の中がつぶれます。

![太らせる量の比較（今の手順で Noto Serif JP Bold を加工）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/31fa6721-1679-4c3d-ac0b-7731ef466f51.png)

## 3.3 継ぎ目の切れ込み

最初は、太らせてから白線を引いていました。すると、「大」「木」の画が交わる所に、白い切れ込みが残りました。元の字が細いので、画と画の継ぎ目にもすき間の中心線ができ、そこに白線が引かれるためです。

白線の太さをすき間の幅に合わせる、継ぎ目から開くくさび形のすき間には引かない、など何度か直しましたが、「拡大すると気になる」が残りました。そこで、「**元の字で、継ぎ目を補正してから太くしたらどうか？**」と頼みました。太らせる前に、元の字にクロージング（膨張してから縮める処理）をかけて、角の細い切れ込みだけを埋める方法です。これで、継ぎ目の切れ込みが消えました。

![継ぎ目の補正（左: 元、中: そのまま太らせる、右: 継ぎ目を埋めてから太らせる）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/3a62027a-42ae-46d5-bc22-44fe820a279e.png)

## 3.4 「太」の点

「太」の点は、元の字では細い首で払いにつながっています。太らせると払いと一体になり、点に見えません。点だけを画像から見つける方法は、ほかの字（「大」の払いの先など）も点と間違えました。

そこで、**「太」から「大」を引く**ことにしました。同じ位置に描いた 2 字の画像の差で、一番大きい部分が点です。取り出した点を太らせ、周りに白い縁を付けて置き直します。同じ形の「犬」（大との差）と「玉」（王との差）にも使っています。

## 3.5 元の書体を選び直す

最初は、太い明朝のしっぽり明朝 ExtraBold を元にしていました。筆の勢いが残る書体ですが、画の太い細いの差が大きく、加工すると荒く見える字がありました。そこで「**元のフォントをクセのないもので変換するとどうか？**」と頼み、6 書体を同じ加工で比べました。

![元の書体 6 種を同じ加工で比べた](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/3cbd0559-d905-40a8-959b-50020de67878.png)

- **Noto Serif JP Bold**: 継ぎ目がきれいに埋まり、画数の多い字も欠けが少ない。明朝の払いが残るので、相撲字らしさもある
- **Noto Serif JP Black**: 元が太すぎて、「関」「綱」の中がつぶれる
- **Noto Sans JP Bold・IPA ゴシック**: 形は整うが、画の端が四角いので、丸ゴシックを太らせた感じになる

見比べて、Noto Serif JP Bold に決めました。

![しっぽり明朝から作った字と、Noto Serif JP Bold から作った字](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/09d8c827-665e-4d01-84e0-eccf036ddc77.png)

---

# 4. 全字を作る

## 4.1 時間と大きさ

288 字の試作は約 30 秒でした（1 字あたり約 0.08 秒）。この速さで、AI は次のように見積もりました。

| 範囲 | 字数 | 時間（1 コア） | WOFF2 |
| :--- | :--- | :--- | :--- |
| JIS X 0208（非漢字と第 1・第 2 水準の漢字） | 6,879 | 約 10 分 | 約 3MB |
| JIS X 0213 第 1 面 | 約 8,600 | 約 12 分 | 約 4MB |
| Noto Serif JP の全字 | 44,777 | 約 1 時間 | 約 19MB |

番付表の日本語なら第 1・第 2 水準で足ります。全字にすると、中国語用の漢字が大半になり、ファイルも Web で読むには重すぎます。「Go」と頼み、JIS X 0208 の字を作りました。スクリプトは CPU のコアの数だけ並列で動くようにし、作業環境（2 コア）で約 6〜8 分でした。

## 4.2 口・日・田の中がつぶれる

全字を作ると、町・無・映・曹のように、小さな囲みの多い字 470 字で、中のすき間が埋まって黒くつぶれました。288 字の試作では目立たなかった問題です。

継ぎ目を埋める処理（3.3）は囲まれたすき間を避けるようにしましたが、ほとんど変わりませんでした。つぶれる原因は、太らせたときに小さな囲みが埋まることでした。そこで、**画に囲まれたすき間にだけ、太めの白線（11px）を入れ直す**ようにしました。15px にすると「綱」にひびのような線が出たので、11px にしています。

![上: 白線を入れ直す前、中: 囲まれたすき間に 11px の白線、下: 15px](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/993556d7-8db8-4f9b-a40c-4e6459d9fd89.png)

---

# 5. 浮いて見える字を直す

## 5.1 原因

全字の一覧を見ると、**一部が浮いて見える字**がありました。園・因・咽・恩・奥・箇などで、囲みの中身だけが白線で縁取られ、切り抜きを置いたように見えます。

元の字で、囲みと中身が離れている（または、わずかに触れているだけの）字です。中身の周りのすき間に、中心線の白線がぐるりと一周します。さらに、離れた部品の境目には、点を分けるための太めの白線（13px）も引かれていました。

## 5.2 直し方

次の 2 つで直しました。

1. 囲みの中に離れて置かれた部品は、囲みと同じ部品とみなし、境目の太い白線を引かない
2. 画に囲まれたすき間ごとに、元の幅を測る。**幅がふだん（中央値）の 0.75 倍より狭いところでは、白線を黒でつなぐ**

2 によって、中身と囲みが近いところでくっつき、白線が一周しなくなります。つなぐ割合を 0.7・0.85・1.0 と比べ、1.0 では「回」の中の口が囲みとくっつきすぎたので、0.75 にしました。

![上: 直す前、下: 直した後](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/5d9be4ce-c725-447b-b720-4cd5011daeb8.png)

## 5.3 自動判定

作るたびに、字ごとに次の 2 つを数え、表（`*-report.tsv`）に書き出すようにしました。

| 項目 | 数え方 | 当たったら |
| :--- | :--- | :--- |
| 内側のすき間 | 字の内側にある、ある程度の大きさの白い部分の数を、元の字と加工後で比べる | 減っていれば、中がつぶれたおそれ |
| 切り離された中身 | 穴の中にある黒い島の数を、元の字と加工後で比べる | 増えていれば、中身が切り離されて浮いて見えるおそれ |

当たった字は、元の字と並べた画像（要確認）にまとめます。要確認の字は、4.2 の対策の前は 470 字、後は 63 字でした。浮き対策と「切り離された中身」の判定を加えると 21 字になり、英数字の手直し（5.4）を入れた最後の版では 18 字です。

![要確認の字（左が元、右が加工後）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/af2e1468-a7fc-4e6d-b0c2-8a2b1fc8892e.png)

ただし、この判定は数を比べるだけです。「浮いて見える」という見た目の印象そのものは判定できません。最後は、全字の一覧を目で見て確かめます。

## 5.4 個別の手直し

スクリプトの `OVERRIDES` に字ごとの設定を書き、`--only=字字字` を付けて動かすと、**その字だけを作り直して、できている書体に差し替えます**。数十秒で終わります。

```python
OVERRIDES = {
    # 左半分だけ、外につながったすき間も、幅が狭いところでつなぐ
    "鴎": {"open": 9, "open_box": [(0, 0.48, 0, 1)]},
}
```

```sh
python3 sumo_font.py "NotoSerifCJK-Bold.ttc#0" SumoTrial.ttf JIS "Sumo Trial" --only=鴎
```

| 項目 | 内容 |
| :--- | :--- |
| `dil` | 太らせる量 |
| `hole_gap` | 囲まれたすき間に入れる白線の太さ |
| `bridge` | つなぐ割合（0 でつながない） |
| `open` | 外につながったすき間でも、幅がこの値（中心から画まで px）以下のところをつなぐ |
| `open_box` | `open` を効かせる範囲。（左, 右, 上, 下）を字の枠に対する割合で書く。5 つ目の数で、その範囲だけ強さを変えられる |

全角の英数字・ギリシャ文字・キリル文字は、この設定で太らせる量を減らし、つなぐ処理を止めています。漢字と同じ加工では、Ｏ・Ｂ・δ の中が点になったためです。

![英数字（上: 漢字と同じ加工、下: 太らせる量を減らした）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/ead1234f-b251-467e-9416-2d530f590bfe.png)

「鴎」は、左の「区」の中の「乂」が縁取られて浮いて見えると指摘がありました。区は右側が開いているので、乂の周りのすき間は外とつながっていて、5.2 の処理が効きません。`open` で左半分だけつなぐと乂は区になじみましたが、続けて右下（鳥の下の部分）も直すと、見比べて「**もとの方がいい**」となりました。結局、鴎は直す前の形に戻しています。機械で決めた手直しが、いつも見た目をよくするとは限りません。

![鴎の手直し（左から: 手直しなし（採用）、左だけつなぐ、右下も強くつなぐ、右下を弱めにつなぐ）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/e6790765-dc3d-4218-9ff4-3ff769fd22f8.png)

---

# 6. 確かめる

AI は、作るたびに確認用の画像を作りました。

- **全字の一覧**: 1 枚 1,000 字の画像を 7 枚
- **要確認**: 5.3 で当たった字を、元の字と並べた画像
- **見本のページ**: 番付の一段を縦書きに組んだ見本に、全字の一覧を付けた。字を押すと元の書体と並べて拡大し、文字コードと水準も出す

![全字の一覧の一部（2001〜2400 字目）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/0214ff0f-1eb0-4ee9-8c58-3d32a5bdc955.png)

---

# 7. 印刷屋で使う

使い方は 2 とおりです。前回の番付表は 1 の方法で作りました。

1. **PC に入れる**: 書体ファイルを PC にインストールし、帳票の CSS で `font-family: "Sumo Trial", "Noto Serif JP", serif;` と指定する。印刷屋の Web フォントの設定はオフのまま。書体が要るのは PDF を作る PC だけで、ほかの PC では後ろの書体で描かれる
2. **Web フォントとして配信する**: 印刷屋（Ver.6 以降）の Web フォントの設定で「その他」を選び、`@font-face` を書いた CSS の URL と書体名を入れる。配信元は https と CORS が要る。公開の場所に置くと書体の配布になるので、2 章の条件を満たす。2.7MB を 1 つで置くと重いので、文字の範囲ごとに小さなファイルに分けるとよい

帳票の CSS では、Sumo Trial に太字（`font-weight: bold`）を指定しないでください。Regular だけの書体なので、ブラウザーが合成の太字にして、さらに太くなります。

---

# 8. スクリプト

1 つのファイルで動きます。必要なのは、Python 3.10 以降と、`pip install pillow numpy opencv-python scikit-image fonttools brotli` です。元の書体は、[noto-cjk](https://github.com/notofonts/noto-cjk) の Serif から `NotoSerifCJK-Bold.ttc` を取ります（`#0` で日本語の書体を選びます）。Google Fonts の Noto Serif JP の Bold（静的な ttf）でも動きます。

```sh
# JIS X 0208 の字と「ゔゕゖヷヸヹヺ」を作る（SumoTrial.ttf、SumoTrial.woff2、SumoTrial-report.tsv ができる）
python3 sumo_font.py "NotoSerifCJK-Bold.ttc#0" SumoTrial.ttf JIS "Sumo Trial"

# 字の一覧を書いたファイルを渡すと、その字だけの書体を作る
python3 sumo_font.py "NotoSerifCJK-Bold.ttc#0" SumoTrialMini.ttf chars.txt "Sumo Trial"
```

作った書体を自分の PC で使うだけなら、条件はありません。**人に配る・Web で配信する**ときは、次を守ってください（2 章）。

- 元の書体の著作権表示を残す。スクリプトは、元の書体の著作権表示（name テーブルの著作権の欄）を引き継ぎ、加工した旨を書き足しています。OFL の表示（ライセンスの説明と URL の欄）も入れています
- OFL の全文（OFL.txt。noto-cjk のリポジトリにある LICENSE）を書体ファイルと一緒に置く
- 加工版も OFL で配る。書体だけを売らない
- 書体名に「Noto」を使わない
- スクリプトは著作権表示に「trial, not for distribution」と書き足しています。配るときは、この文言を書き換えてください

<details><summary>sumo_font.py（451 行）</summary>

```python:sumo_font.py
# 相撲字風の試作書体「Sumo Trial」を作る（Noto Serif JP Bold を加工。OFL 1.1）
# 必要なもの: Python 3.10 以降、pip install pillow numpy opencv-python scikit-image fonttools brotli
# 手順: 1 字ずつ大きく描く → 元の字の継ぎ目（画が交わる角の細い切れ込み）を先に埋める
#       → 太らせる → すき間の中心線と、別々の画（点など）の境目を白線で残す → 輪郭をにじませる
#       → 囲まれたすき間（口・日・田の中など）には太めの白線を入れ直して、字がつぶれないようにする
#       → 囲みの中に離れて置かれた部分（園の袁、因の大など）は、元のすき間が狭いところで囲みとつなぐ
#         （白線がぐるりと一周すると、中身が浮いて見えるため）
#       → 輪郭線（多角形）に直す → TrueType / WOFF2 にまとめる
#
# 使い方: python3 sumo_font.py <元の書体(.ttf/.otf/.ttc#番号)> <出力.ttf> <文字一覧.txt または JIS> [書体名] [並列数]
#   例:   python3 sumo_font.py "NotoSerifCJK-Bold.ttc#0" SumoTrial.ttf JIS "Sumo Trial"
#         文字一覧に JIS と書くと、JIS X 0208 の字（非漢字と第 1・第 2 水準の漢字）と「ゔゕゖヷヸヹヺ」を作る（元の書体にある字だけ。全角空白は除く）
#   出力: <出力.ttf>、<出力.woff2>、<出力>-report.tsv
#         （字ごとの「内側のすき間」の数と「加工で切り離された中身」の数。手直しが要りそうな字を探す目安）
#
# 一部の字だけ作り直す: 末尾に --only=字字字 を付ける（既にある <出力.ttf> のその字だけ差し替える）
#   例:   python3 sumo_font.py "NotoSerifCJK-Bold.ttc#0" SumoTrial.ttf JIS "Sumo Trial" --only=園因
#   字ごとの設定は下の OVERRIDES に書く
import os, sys, time
import numpy as np, cv2
from multiprocessing import Pool, cpu_count
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import skeletonize
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


PX = 360                                    # 1em を 360px で描く
DIL = 25                                    # 太らせる量
GAP = 7                                     # すき間の中心線の白線の太さ
GAP_PART = 13                               # 別々の画（点など）の境目の白線の太さ
SMOOTH = 31                                 # 画の境目をなめらかにする強さ
PRECLOSE = 13                               # 太らせる前に、元の字の継ぎ目を埋める強さ
HOLE_GAP = 11                               # 囲まれたすき間（口・日・田の中など）に残す白線の太さ
DOT_FROM = {"太": "大", "犬": "大", "玉": "王"}  # 点を、似た字との差から取り出して置き直す字
HALO = 11                                   # 置き直した点の周りの白い縁
DOT_DIL = 19                                # 置き直した点を太らせる量
BRIDGE = 0.75                               # 浮いた部分と囲みをつなぐ強さ（元のすき間がふだんの何割より狭いところでつなぐか）
MIN_SPECK = 120                             # これより小さい白い粒（px）は消す
# 字ごとの手直し（使える項目）
#   dil 太らせる量 / hole_gap 囲まれたすき間の白線の太さ / bridge つなぐ強さ / merge 浮いた部分を囲みと同じ部品とみなすか
#   open 外につながったすき間でも、幅がこの値（中心から画まで px）以下のところをつなぐ
#   open_box open を効かせる範囲。(左, 右, 上, 下) を字の枠に対する割合で書き、複数並べられる
#            例 [(0, 0.48, 0, 1)] で左半分、[(0.5, 1, 0.55, 1)] で右下。
#            5 つ目に数を書くと、その範囲だけ open の値を変えられる（例 (0.5, 1, 0.55, 1, 5)）
OVERRIDES = {
    # 例: "鴎": {"open": 9, "open_box": [(0, 0.48, 0, 1)]},   # 左半分だけ、外につながったすき間もつなぐ
}
# 全角の英数字・ギリシャ文字・キリル文字は、太らせすぎると中のすき間（Ｏ・Ｂ・δ など）が点になるので控えめにする
for _c in ([chr(c) for c in range(0xFF10, 0xFF1A)] + [chr(c) for c in range(0xFF21, 0xFF3B)] + [chr(c) for c in range(0xFF41, 0xFF5B)]
           + [chr(c) for c in range(0x0391, 0x03CA)] + [chr(c) for c in range(0x0401, 0x0452)]):
    OVERRIDES.setdefault(_c, {"dil": 11, "hole_gap": 7, "bridge": 0})
BLUR = 3.0
NOISE = 5.0
PAD = DIL
MIN_HOLE = 150                              # 「内側のすき間」と数える最小の面積（px）
el = lambda m: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (m, m))

# ---- 画像の加工 ----

def enclosed_parts(ink):
    """囲みの中に浮いている部分を探す。戻り値: {部分の番号: 囲んでいる部分の番号}, 部分の番号の画像"""
    n, comp = cv2.connectedComponents(ink, connectivity=8)
    bg = (1 - ink).astype(np.uint8)
    _, blab = cv2.connectedComponents(bg, connectivity=4)
    outer = set(np.unique(np.r_[blab[0], blab[-1], blab[:, 0], blab[:, -1]]).tolist())
    k3 = np.ones((3, 3), np.uint8)
    res = {}
    for c in range(1, n):
        m = (comp == c).astype(np.uint8)
        ring = (cv2.dilate(m, k3) > 0) & (bg > 0)
        touch = set(np.unique(blab[ring]).tolist())
        if touch & outer or not touch:
            continue                                  # 外の白地に接している → 浮いていない
        # 接している白地（穴）に、ほかに接している部分のうち一番大きいものを囲みとみなす
        hole = np.isin(blab, list(touch))
        near = cv2.dilate(hole.astype(np.uint8), k3) > 0
        cand = [x for x in np.unique(comp[near & (ink > 0)]).tolist() if x not in (0, c)]
        if cand:
            res[c] = max(cand, key=lambda x: int((comp == x).sum()))
    return res, comp

def sumo_base(a, dil, gap, gap_part, blur, noise_s, seed=0, smooth=31, merge_enclosed=True):
    ink = (a > 127).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dil, dil))
    fat = cv2.dilate(ink * 255, k) > 127
    sk = skeletonize(ink == 0) & fat
    _, lab = cv2.distanceTransformWithLabels((1 - ink).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP)
    n_enc = 0
    if merge_enclosed:
        enc, comp = enclosed_parts(ink)
        n_enc = len(enc)
        if enc:
            # 部分の番号 → 距離変換の番号 の対応を取り、浮いた部分の領域を囲みの番号に塗り替える
            def dl(c):
                ys, xs = np.nonzero(comp == c); return lab[ys[0], xs[0]]
            for c, p in enc.items():
                # 囲みが別の囲みに入っている場合もたどる
                while p in enc: p = enc[p]
                lab[lab == dl(c)] = dl(p)
    lab = cv2.medianBlur(np.clip(lab, 0, 255).astype(np.uint8), smooth)
    edge = np.zeros_like(fat)
    edge[:, 1:] |= lab[:, 1:] != lab[:, :-1]
    edge[1:, :] |= lab[1:, :] != lab[:-1, :]
    edge &= fat
    g = (cv2.dilate(sk.astype(np.uint8) * 255, el(gap)) > 127) | (cv2.dilate(edge.astype(np.uint8) * 255, el(gap_part)) > 127)
    out = (fat & ~g).astype(np.uint8) * 255
    rng = np.random.default_rng(seed)
    nz = cv2.GaussianBlur((rng.random(out.shape) * 255).astype(np.uint8), (0, 0), noise_s).astype(np.float32) - 128
    b = cv2.GaussianBlur(out, (0, 0), blur).astype(np.float32) + nz * 0.5
    return (b > 128).astype(np.uint8) * 255, n_enc


def bridge_enclosed(a, out, ratio=0.8, width=21):
    """囲みの中に浮いた部分と囲みの間の白線を、元のすき間が狭いところで黒くつなぐ。戻り値: 画像, 浮いた部分の数"""
    ink = (a > 127).astype(np.uint8)
    enc, comp = enclosed_parts(ink)
    if not enc: return out, 0
    bg = (1 - ink).astype(np.uint8)
    _, blab = cv2.connectedComponents(bg, connectivity=4)
    k3 = np.ones((3, 3), np.uint8)
    out = out.copy()
    for c in enc:
        m = (comp == c).astype(np.uint8)
        ringlabs = np.unique(blab[(cv2.dilate(m, k3) > 0) & (bg > 0)])
        ring = np.isin(blab, ringlabs).astype(np.uint8)
        D = cv2.distanceTransform(ring, cv2.DIST_L2, 5)
        sk = skeletonize(ring > 0)
        # 浮いた部分の近くの中心線だけ（ほかの穴に伸びる枝は除く）
        dm = cv2.distanceTransform((1 - m).astype(np.uint8), cv2.DIST_L2, 5)
        sk &= dm < D.max() * 2.5 + 2
        d = D[sk]
        if d.size == 0: continue
        thr = np.median(d) * ratio
        narrow = (sk & (D <= thr)).astype(np.uint8) * 255
        br = cv2.dilate(narrow, el(width)) > 127
        br &= cv2.dilate(ring * 255, el(9)) > 127          # すき間とその縁だけ
        out[br] = 255
    return out, len(enc)

def bridge_holes(a, out, ratio=0.75, width=21, min_area=400):
    """囲まれたすき間ごとに、元の幅がふだんより狭いところの白線を黒でつなぐ（中身が縁取られて浮いて見えるのを防ぐ）。
    戻り値: 画像, つないだすき間の数"""
    ink = (a > 127).astype(np.uint8)
    bg = (1 - ink).astype(np.uint8)
    n, blab, st, _ = cv2.connectedComponentsWithStats(bg, connectivity=4)
    border = set(np.unique(np.r_[blab[0], blab[-1], blab[:, 0], blab[:, -1]]).tolist())
    out = out.copy(); cnt = 0
    for h in range(1, n):
        if h in border or st[h, cv2.CC_STAT_AREA] < min_area:
            continue
        x, y, w, hh = st[h, :4]
        x0, y0, x1, y1 = max(x - 12, 0), max(y - 12, 0), x + w + 12, y + hh + 12
        ring = (blab[y0:y1, x0:x1] == h).astype(np.uint8)
        D = cv2.distanceTransform(ring, cv2.DIST_L2, 5)
        sk = skeletonize(ring > 0)
        d = D[sk]
        if d.size < 10:
            continue
        thr = np.median(d) * ratio
        narrow = (sk & (D <= thr)).astype(np.uint8) * 255
        if not narrow.any():
            continue
        br = cv2.dilate(narrow, el(width)) > 127
        br &= cv2.dilate(ring * 255, el(9)) > 127
        sub = out[y0:y1, x0:x1]; sub[br] = 255; cnt += 1
    return out, cnt

def bridge_open(a, out, max_half, width=21, region=None):
    """外につながったすき間でも、元の幅が狭い（中心から画まで max_half px 以下の）ところの白線を黒でつなぐ。
    字ごとの手直し用。region（真偽の画像）を渡すと、その範囲だけに効かせる。"""
    ink = (a > 127).astype(np.uint8)
    bg = (1 - ink).astype(np.uint8)
    D = cv2.distanceTransform(bg, cv2.DIST_L2, 5)
    sk = skeletonize(bg > 0)
    hull = np.zeros_like(bg)
    cs, _ = cv2.findContours(ink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if cs:
        cv2.fillPoly(hull, [cv2.convexHull(np.vstack(cs))], 1)
    narrow = sk & (D <= max_half) & (cv2.erode(hull, el(15)) > 0)
    if region is not None:
        narrow &= region
    br = cv2.dilate(narrow.astype(np.uint8) * 255, el(width)) > 127
    br &= cv2.dilate(bg * 255, el(9)) > 127
    out = out.copy(); out[br] = 255
    return out

def dot_by_difference(a, base, shrink=5):
    """「太」から「大」を引くように、似た字との差から点を取り出す（同じ位置に描いた画像どうし）"""
    diff = (a > 127) & ~(cv2.dilate((base > 127).astype(np.uint8) * 255, el(shrink)) > 127)
    n, lab, st, _ = cv2.connectedComponentsWithStats(diff.astype(np.uint8), connectivity=8)
    if n <= 1:
        return []
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    comp = (lab == i).astype(np.uint8)
    return [cv2.dilate(comp, el(shrink)) & (a > 127)]

# ---- 子プロセスでも使う設定（init で読み込む） ----
G = {}

def init(src_path, idx):
    f = TTFont(src_path, fontNumber=idx, lazy=True)
    G["UPEM"] = f["head"].unitsPerEm
    G["SC"] = PX / G["UPEM"]
    G["cmap"] = f.getBestCmap()
    G["hmtx"] = dict(f["hmtx"].metrics)
    G["asc"], G["desc"] = f["hhea"].ascent, f["hhea"].descent
    G["pil"] = ImageFont.truetype(src_path, PX, index=idx)

def inner_holes(a):
    # 画に囲まれたすき間（外につながっていない白い部分）
    bg = (a <= 127).astype(np.uint8)
    _, lab = cv2.connectedComponents(bg, connectivity=4)
    border = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    return (lab > 0) & ~np.isin(lab, border)

def preclose(a, holes_mask):
    # 画が交わる角の細い切れ込みを、太らせる前に埋めておく（囲まれたすき間はそのまま残す）
    o = cv2.morphologyEx(a, cv2.MORPH_CLOSE, el(PRECLOSE))
    o[holes_mask] = 0
    return o

def keep_holes(out, holes_mask, hole_gap=HOLE_GAP):
    # 囲まれたすき間の中心に白線を入れ直す（太らせたときに埋まって、字がつぶれるのを防ぐ）
    sk = skeletonize(holes_mask).astype(np.uint8) * 255
    line = cv2.GaussianBlur(cv2.dilate(sk, el(hole_gap)), (0, 0), 2) > 100
    return ((out > 127) & ~line).astype(np.uint8) * 255

def remove_specks(out):
    # 字の内側に残った小さな白い粒を黒で埋める
    inv = (out <= 127).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    border = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]]).tolist())
    small = [k for k in range(1, n) if st[k, cv2.CC_STAT_AREA] < MIN_SPECK and k not in border]
    if small:
        out = out.copy(); out[np.isin(lab, small)] = 255
    return out

def put_dots(out, dots):
    # 取り出した点を少し太らせ、周りに白い縁を付けて置き直す
    out = out > 127
    for comp in dots:
        dot = cv2.dilate(comp.astype(np.uint8) * 255, el(DOT_DIL))
        dot = cv2.GaussianBlur(dot, (0, 0), BLUR) > 128
        ring = cv2.dilate(dot.astype(np.uint8) * 255, el(HALO)) > 127
        out = (out & ~ring) | dot
    return out.astype(np.uint8) * 255

def holes(img):
    # 字の内側にある、ある程度の大きさの白い部分の数
    cs, hier = cv2.findContours((img > 127).astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is None:
        return 0
    return sum(1 for c, h in zip(cs, hier[0]) if h[3] != -1 and cv2.contourArea(c) >= MIN_HOLE)

def islands(img):
    # 穴の中にある黒の島の数（中身が囲みから切り離されている部分）
    cs, h = cv2.findContours((img > 127).astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if h is None:
        return 0
    h = h[0]; n = 0
    for k, c in enumerate(cs):
        d, p = 0, h[k][3]
        while p != -1:
            d += 1; p = h[p][3]
        if d >= 2 and d % 2 == 0 and cv2.contourArea(c) > 200:
            n += 1
    return n

def draw(ch, W, H, base_y):
    im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).text((PAD, base_y), ch, font=G["pil"], fill=255, anchor="ls")
    return np.array(im)

def to_contours(img, base_y):
    # 輪郭線をフォント単位の点列に直す（外側は時計回り、穴は反時計回り）
    SC = G["SC"]
    cs, hier = cv2.findContours(img, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    res = []
    if hier is None:
        return res
    for i, c in enumerate(cs):
        if len(c) < 8:
            continue
        c = cv2.approxPolyDP(c, 0.8, True)[:, 0, :]
        if len(c) < 3:
            continue
        pts = [(int(round((x - PAD) / SC)), int(round((base_y - y) / SC))) for x, y in c]
        area = sum(pts[j][0] * pts[(j + 1) % len(pts)][1] - pts[(j + 1) % len(pts)][0] * pts[j][1] for j in range(len(pts)))
        is_hole = hier[0][i][3] != -1
        if (not is_hole and area > 0) or (is_hole and area < 0):
            pts = pts[::-1]
        res.append(pts)
    return res

def process(args):
    i, ch = args
    cmap, hmtx, SC = G["cmap"], G["hmtx"], G["SC"]
    adv = hmtx[cmap[ord(ch)]][0]
    W = int(adv * SC) + 2 * PAD
    H = int((G["asc"] - G["desc"]) * SC) + 2 * PAD
    base_y = PAD + int(G["asc"] * SC)
    a = draw(ch, W, H, base_y)
    dots = []
    if ch in DOT_FROM and ord(DOT_FROM[ch]) in cmap:
        dots = dot_by_difference(a, draw(DOT_FROM[ch], W, H, base_y))
    o = OVERRIDES.get(ch, {})
    hm = inner_holes(a)
    out, _ = sumo_base(preclose(a, hm), o.get("dil", DIL), GAP, GAP_PART, BLUR, NOISE, i, SMOOTH, o.get("merge", True))
    out = keep_holes(out, hm, o.get("hole_gap", HOLE_GAP))
    out, _ = bridge_enclosed(a, out, o.get("bridge", BRIDGE))
    out, _ = bridge_holes(a, out, o.get("bridge", BRIDGE))
    if "open" in o:
        if "open_box" in o:
            # 字の枠（横: 字幅、縦: 上端〜下端）に対する割合で範囲を決め、範囲ごとにつなぐ
            top, em_h = PAD, (G["asc"] - G["desc"]) * SC
            for box in o["open_box"]:
                x0, x1, y0, y1 = box[:4]
                region = np.zeros(a.shape, bool)
                region[int(top + em_h * y0):int(top + em_h * y1), int(PAD + adv * SC * x0):int(PAD + adv * SC * x1)] = True
                out = bridge_open(a, out, box[4] if len(box) > 4 else o["open"], region=region)
        else:
            out = bridge_open(a, out, o["open"])
    out = remove_specks(out)
    if dots:
        out = put_dots(out, dots)
    # 判定用: 内側のすき間の数（元 → 加工後）、切り離された中身の数（加工後 − 元。1 以上なら浮いて見えるおそれ）
    return ch, adv, to_contours(out, base_y), holes(a), holes(out), max(0, islands(out) - islands(a))

def jis_chars():
    # JIS X 0208 の字を、区点の順（非漢字 → 第 1 水準 → 第 2 水準）に並べる
    out = []
    for a in range(0xA1, 0xFF):
        for b in range(0xA1, 0xFF):
            try:
                out.append(bytes([a, b]).decode("euc_jp"))
            except UnicodeDecodeError:
                pass
    return "".join(out) + "ゔゕゖヷヸヹヺ"

def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    only = next((x[len("--only="):] for x in sys.argv[1:] if x.startswith("--only=")), None)
    src_arg, OUT, CHARS_FILE = args[0], args[1], args[2]
    FAMILY = args[3] if len(args) > 3 else "Sumo Trial"
    NPROC = int(args[4]) if len(args) > 4 else cpu_count()
    SRC, IDX = (src_arg.split("#")[0], int(src_arg.split("#")[1])) if "#" in src_arg else (src_arg, 0)
    init(SRC, IDX)
    src = TTFont(SRC, fontNumber=IDX)
    UPEM, cmap, hmtx, asc, desc = G["UPEM"], G["cmap"], G["hmtx"], G["asc"], G["desc"]

    chars = []
    seen = set()
    source = only if only else (jis_chars() if CHARS_FILE == "JIS" else open(CHARS_FILE, encoding="utf-8").read())
    for ch in source:
        if ch.strip() and ord(ch) in cmap and ch not in seen:
            chars.append(ch); seen.add(ch)

    # 1 字ずつ加工（並列）
    results = []
    t0 = time.time()
    with Pool(NPROC, initializer=init, initargs=(SRC, IDX)) as pool:
        for n, r in enumerate(pool.imap(process, enumerate(chars), chunksize=8), 1):
            results.append(r)
            if n % 500 == 0:
                el_t = time.time() - t0
                print(f"{n}/{len(chars)} 字 {el_t:.0f} 秒（残り約 {el_t / n * (len(chars) - n):.0f} 秒）", flush=True)
    print(f"{len(chars)} 字を {time.time() - t0:.1f} 秒で加工（{NPROC} 並列）", flush=True)

    def make_glyph(contours):
        pen = TTGlyphPen(None)
        for pts in contours:
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()
        return pen.glyph()

    stem = OUT.rsplit(".", 1)[0]
    report_path = stem + "-report.tsv"
    head = "字\t元のすき間\t加工後のすき間\t切り離された中身\n"

    if only:
        # 既にある書体の、その字だけ差し替える
        font = TTFont(OUT)
        glyf, hm_t, cm_t = font["glyf"], font["hmtx"], font.getBestCmap()
        for ch, adv, contours, h0, h1, ne in results:
            name = cm_t.get(ord(ch)) or ("uni%04X" % ord(ch))
            if ord(ch) not in cm_t:
                print("収録されていない字なので飛ばします:", ch); continue
            g = make_glyph(contours); glyf[name] = g; g.recalcBounds(glyf)
            hm_t[name] = (adv, getattr(g, "xMin", 0))
        font.save(OUT)
        font.flavor = "woff2"; font.save(stem + ".woff2")
        rows = {}
        if os.path.exists(report_path):
            for l in open(report_path, encoding="utf-8").read().splitlines()[1:]:
                rows[l.split("\t")[0]] = l
        for ch, adv, contours, h0, h1, ne in results:
            rows[ch] = f"{ch}\t{h0}\t{h1}\t{ne}"
        open(report_path, "w", encoding="utf-8").write(head + "".join(v + "\n" for v in rows.values()))
        print("updated", OUT, "".join(r[0] for r in results), flush=True)
        return

    glyph_order = [".notdef", "space"]
    glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (UPEM, 0), "space": (hmtx[cmap[32]][0] if 32 in cmap else UPEM // 4, 0)}
    cmap_out = {32: "space"}
    for ch, adv, contours, h0, h1, ne in results:
        name = "uni%04X" % ord(ch)
        glyph_order.append(name)
        glyphs[name] = make_glyph(contours)
        metrics[name] = (adv, 0)
        cmap_out[ord(ch)] = name

    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap_out)
    fb.setupGlyf(glyphs)
    for n in glyph_order:
        g = glyphs[n]
        g.recalcBounds(fb.font["glyf"])
        metrics[n] = (metrics[n][0], getattr(g, "xMin", 0))
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=asc, descent=desc)
    copyright_src = src["name"].getDebugName(0) or ""
    fb.setupNameTable({
        "copyright": copyright_src + " Modified 2026 (trial, not for distribution).",
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": FAMILY + " Regular trial",
        "fullName": FAMILY + " Regular",
        "psName": FAMILY.replace(" ", "") + "-Regular",
        "version": "Version 0.5",
        "licenseDescription": "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
        "licenseInfoURL": "https://openfontlicense.org",
    })
    fb.setupOS2(sTypoAscender=asc, sTypoDescender=desc, usWinAscent=asc, usWinDescent=-desc)
    fb.setupPost()
    fb.font.save(OUT)
    fb.font.flavor = "woff2"
    fb.font.save(stem + ".woff2")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(head)
        for ch, adv, contours, h0, h1, ne in results:
            f.write(f"{ch}\t{h0}\t{h1}\t{ne}\n")
    print("saved", OUT, flush=True)

if __name__ == "__main__":
    main()
```

</details>

---

# 気を付ける点

- OFL の書体を加工するときは、ライセンス文で予約された名前を確かめ、元の名前（と商標）を使わない名前を付ける
- 書体で作った PDF や画像には OFL の条件はかからない。書体ファイルを配るときだけ、著作権表示と OFL の全文を付け、OFL で配る
- 画像に描いて加工し、輪郭に戻す方法なら、書体の内部（輪郭の点やヒント）を知らなくても形を変えられる。そのかわり、輪郭は細かい多角形になり、ファイルは大きくなる
- 少ない字で試して決めた加工が、全字ではつぶれることがある。全字を作り、一覧で確かめる
- 自動判定は「数」しか見ない。見た目の印象は人が一覧を見て確かめる
- 字ごとの手直しは、元の形の方がよいこともある。手直しの前後を並べて比べる

---

# まとめ

- 番付表に向いた無料の書体が無かったので、OFL の Noto Serif JP Bold を加工して、相撲字風の試作書体「Sumo Trial」を作った。JIS X 0208 の字を中心に 6,884 字で、作るのに約 6〜8 分
- 加工は、1 字ずつ画像に描き、継ぎ目を埋めてから太らせ、すき間を細い白線で残し、輪郭に戻す方法にした
- 継ぎ目の切れ込み、「太」の点、小さな囲みのつぶれ、囲みの中身の浮きを、見た目の指摘を受けて 1 つずつ直した
- 手直しが要りそうな字を自動で数え、字ごとの設定でその字だけ作り直せるようにした
- 加工の設計・試作・全字の生成・確認用の画像づくりは AI に任せた。人が行ったのは、コードを書くことではなく、できたものの違和感を短い言葉で伝えることと、どちらがよいかを決めることだった

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
11. [業務データから「番付表」を作らせる](https://qiita.com/rex0220/items/de341ab43b4c40bf61c1)
12. **番付表用の相撲字風の書体を作らせる（この記事）**

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [帳票レシピ集とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
