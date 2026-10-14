<!--
title: rex0220 印刷屋プラグイン - AI に休日アプリから年間カレンダーを作らせる（計算式で HTML を組み立てる）
tags:
  - kintone
  - Claude
  - MCP
private: false
url: https://qiita.com/rex0220/items/0a6be4bdb34ebb2986c6（2026-10-13 公開）
-->

[前回の記事](https://qiita.com/rex0220/items/f48cf8d9a89cb1971e41) では、ガントチャートアプリの工程表を作りました。今回は、**休日アプリのレコードから、その年の年間カレンダーを PDF にする**話です。

できあがったのは、下の帳票です。A4 横 1 枚に 12 か月を 4 列×3 段で並べ、日曜（赤字）・土曜（青字）と、休日アプリに登録された日を区分ごとに色分けしています（祝日は赤、休日はオレンジ、その他は緑の背景）。同じ設定のまま、レコードの年を変えれば、その年のカレンダーになります。

![2026 年の年間カレンダー](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/79638ce5-7f2d-4aeb-8018-bca1c9149490.png)

![2027 年の年間カレンダー](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/0065fdb9-793f-44a7-bb0b-abcc6ad04544.png)

上が 2026 年、下が 2027 年のレコードから作った PDF です。2027 年のカレンダーの元にしたレコードは、次のとおりです。区分（祝日・休日・その他）ごとに色が付きます。

![2027 年の休日アプリのレコード](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/5188962f-a375-4c59-83ed-911ce481169b.png)

今回作ったのは、日本語の年間カレンダーと、休日の区分の色分けまでです。最初に依頼した凡例・休日の名前の一覧・稼働日数・言語の切り替えは入れていません。タイトルも「カレンダー名＋年」ではなく「年＋年間カレンダー」で、`cal_name` は使っていません。

また、最初の依頼どおりには進みませんでした。言語の切り替え・凡例・祝日の一覧・月ごとの稼働日まで一度に作らせたところ、計算式が通らず、**1 月だけ・日本語だけの月カレンダーから作り直しました**。この記事は、その分かれ道と、うまくいかなかった点のまとめです。

| # | やったこと | 結果 |
| :--- | :--- | :--- |
| 1 | 休日アプリのレコードから直接作るか、出力用のアプリを作るかを決めた | レコードから直接（A）を選んだ |
| 2 | 要件を全部入れた年間カレンダーを作らせた | 計算式の検証や実機でエラー。原因を切り分けきれず、方針を変えた |
| 3 | 1 月だけ → 12 か月 → A4 横 4 列×3 段 と積み上げた | 静的な HTML で形を決めてから、計算式で HTML を組み立てる形にした |
| 4 | 休日の色分けを DIC で引くようにした | 各マスで配列を探す処理が無くなった |
| 5 | 実機の PDF を見て直した | 月の範囲外の日付（0 以下、月末より後）が出ていたのを直した |
| 6 | LOG で処理時間を測った | 約 6 秒。年に数回しか作らないので、このままとした |

使ったのは、印刷屋プラグイン Ver.8、Claude Desktop の拡張機能（印刷屋 MCP）0.2.0、tools 2.1.0 です。

---

# 1. 依頼と最初の分かれ道

使ったのは rex0220 休日プラグインの休日アプリ（アプリ 845）です。1 レコードが 1 年分で、項目は次のとおりです。

| 項目 | 内容 |
| :--- | :--- |
| `cal_name` | カレンダー名 |
| `year` | 年（数値） |
| `Table` | 休日の一覧（`date` 日付、`name` 名前、`type` 区分 = 祝日 / 休日 / その他 など） |

最初の依頼は、次のとおりでした。

- A4 横 1 枚（A3 も選べる）に 12 か月
- 日曜・土曜・祝日・休日・その他を色分けし、凡例を付ける
- 休日の名前の一覧、月ごとの稼働日数、年間の休日数
- 日本語・英語・中国語の切り替え
- タイトルは「カレンダー名＋年」

AI には、作る前に方針を 2 つ出させました。

| 方針 | 内容 |
| :--- | :--- |
| A | 休日アプリのレコードから、印刷屋の計算式で直接作る |
| B | 出力用のアプリを別に作り、kintone の計算式で日付を用意してから印刷屋で並べる |

アプリを増やしたくないので **A** を選び、稼働日は「土日・祝日・休日を除いた日（その他は稼働日）」としました。

---

# 2. 全部入れたら、通らなかった

要件を全部入れた設定を作らせたところ、次のようなエラーが続きました。

| 症状 | 分かったこと |
| :--- | :--- |
| 検証で `traverse tree operator $NN` | IF を 5 段入れ子にし、その中で ARRAY_SOME を 3 つ使っていた。MAX で順位を付ける形に変えると通った |
| 実機で帳票が作られない | ループの中で、ARRAY_SOME を 3 つ含む MAX を使っていた。原因は切り分けきれなかった |
| `e.trim is not a function` | REPLACE に数値を渡していた。`"" & work` で文字列にすると直った |
| ページの体裁が崩れた | 試しに付けた目印の文字 `x` が class 名 `rex0220-pcraft-page` に混ざっていた |

一つ直すと次が出る状態で、どこが原因かを AI と話しても絞り切れませんでした。そこで、**要件を減らして 1 か月から作り直す**ことにしました。

> 方針の変更: 1 月の月カレンダーだけ、日本語だけ。祝日の表記なし。

---

# 3. 1 月から積み上げる

## 3.1 空白の配列と日付の配列

月カレンダーの組み方は、以前の記事 [印刷屋プラグイン CSV_TVAL でカレンダー](https://qiita.com/rex0220/items/fca35db47d1858b53156) を参考にさせました。

- 1 日の曜日の数だけ空白を並べた配列と、1〜月末の配列をつなぐ
- 7 個ごとに `</tr><tr>` で折り返す

最初は「アプリを見ずに、2026 年 1 月」を静的に作らせ、形が決まってから 12 か月に広げました。

## 3.2 A4 横 4 列×3 段

12 か月を並べたら、A4 横 1 枚に 4 列×3 段で収めます。デザインは Claude のデザイン（Design）で案を作り、それを印刷屋の CSS に移しました。

![Claude のデザインで作った案](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/12bab8a7-e128-42a9-9244-891543954a4f.png)

Claude のデザインで作った案です。この形を、印刷屋の CSS に移しました。

```css
.cal .grid { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 28px; row-gap: 14px; }
.cal .g td { font-size: 14px; height: 22px; text-align: center; }
.cal .sun { color: #c0392b; }
.cal .sat { color: #1f5fa8; }
```

各月を 6 週×7 日 = 42 マスに固定したので、月によって段の高さが変わりません。

## 3.3 年をレコードから取り、HTML を計算式で組み立てる

ここまでは 2026 年の HTML を静的に持っていました。次に、**レコードの `year` からその年のカレンダーを計算式で組み立てる**形にしました。

![計算式で組み立てた 2026 年（休日の色分けの前）](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/7b9bf125-3175-45a3-8772-b958d6066bfc.png)

この段階では、曜日の色だけで、休日の色分けはまだ入れていません。

ループは 12 か月×42 マス = **504 回の 1 回だけ**にし、`k`（0〜503）から月とマスを出します。

```text
i  = MOD(k, 42)          マス（0〜41）
mi = (k - i) / 42        月（0〜11）
w  = MOD(i, 7)           曜日（0 = 日）
dd = i - 1 日の曜日 + 1   日付（1 未満と月末より後は空白）
```

月ごとの「1 日の曜日」「日数」「年初からの日数」は、ループの前に 12 個の配列にしておきます。

```text
offs, ARRAY_FOR(12, mi, MOD(DATE_DIFF("1970-01-04", DATE_ADD(base, mi, "month"), "days"), 7)),
lens, ARRAY_FOR(12, mi, DATE_DIFF(DATE_ADD(base, mi, "month"), DATE_ADD(base, mi + 1, "month"), "days")),
msts, ARRAY_FOR(12, mi, DATE_DIFF(base, DATE_ADD(base, mi, "month"), "days")),
```

1970-01-04 は日曜日なので、そこからの日数を 7 で割った余りが曜日になります。

---

# 4. 休日の色分けは DIC で引く

祝日・休日・その他の色分けは、最初はマスごとに `ARRAY_SOME` で休日の日付の配列を探していました。2 章のエラーもこの形で出ています。

ここで、**必要なデータをキーで DIC に入れておき、各マスでは 1 回引くだけにする**よう指示しました。キーは年初からの日数、値は class 名です。

```text
base, year & "-01-01",
kd, DIC_ASSIGN(
  ARRAY_DIC(TARRAYIF(type = "その他", date), vv, DIC("" & DATE_DIFF(base, vv, "days"), "oth")),
  ARRAY_DIC(TARRAYIF(type = "休日", date), vv, DIC("" & DATE_DIFF(base, vv, "days"), "kyu")),
  ARRAY_DIC(TARRAYIF(type = "祝日", date), vv, DIC("" & DATE_DIFF(base, vv, "days"), "hol"))),
```

`DIC_ASSIGN` は後のものが上書きするので、**その他 → 休日 → 祝日 の順に重ねると、同じ日なら 祝日 > 休日 > その他** になります。また、休日アプリに区分が登録されている日は、曜日（日曜の赤・土曜の青）よりも区分の色を優先しています。

なお、ARRAY_SOME で探していた版はエラーで完成していないので、2 つの方式の処理時間は比べていません。

504 マスのループは次のとおりです。

```text
months, JOIN(ARRAY_FOR(504, k, LET(
  i, MOD(k, 42),
  mi, (k - i) / 42,
  w, MOD(i, 7),
  dd, i - ARRAY_GET(offs, mi) + 1,
  inm, IF(dd < 1, 0, IF(dd > ARRAY_GET(lens, mi), 0, 1)),
  kc, IF(inm = 1, DIC_ITEM(kd, "" & (ARRAY_GET(msts, mi) + dd - 1)), ""),
  IF(i = 0, "<div class='m'><div class='mh'><span class='mn'>" & (mi + 1) & "</span><span class='mu'>月</span></div><table class='g'>" & head & "<tbody><tr>", "") &
  IF(AND(w = 0, i > 0), "</tr><tr>", "") &
  "<td class='" & IF(kc != "", kc, IF(w = 0, "sun", IF(w = 6, "sat", "d"))) & "'>" &
  IF(inm = 1, "" & dd, "") & "</td>" &
  IF(i = 41, "</tr></tbody></table></div>", ""))), ""),
```

ループの中の `LET` は、マスごとの値（月・曜日・日付・区分）を 1 回だけ計算するためです。

---

# 5. 実機の PDF で見つかった誤り

tools の検証は「エラー 0」でしたが、実機の PDF では**月の前後に `-3`〜`0` や `32`〜`42` が表示**されていました。

![範囲外の日付が出ている PDF](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/bec4604a-d51f-4d50-ba9b-fa380f71dbde.png)

範囲外のマスでも休日の DIC を引いていたため、4 月の「33〜36」のように、翌月の祝日（5 月 3〜6 日）の色まで付いていました。

その月の日かどうかを `AND(…)` で求めて LET の変数に入れ、`IF(変数, …)` と使っていたのが原因です。あとで小さな式で確かめると、**LET の変数に入れた偽や 0 は、IF の条件にそのまま使うと真として扱われました**（IF の条件に直接書けば正しく動きます）。

| 式 | 結果 | 期待 |
| :--- | :--- | :--- |
| `LET(c, 1 = 0, IF(c, "T", "F"))` | T | F |
| `LET(c, 0, IF(c, "T", "F"))` | T | F |
| `LET(c, "", IF(c, "T", "F"))` | F | F |
| `IF(AND(a >= 1, a <= 31), "T", "F")`（a = -3） | F | F |

そこで、1 / 0 で持ち、`inm = 1` と比べて書くようにしました。

```text
inm, IF(dd < 1, 0, IF(dd > ARRAY_GET(lens, mi), 0, 1)),
kc, IF(inm = 1, DIC_ITEM(kd, "" & (ARRAY_GET(msts, mi) + dd - 1)), ""),
```

直したあと、2023〜2027 年のレコードで PDF を作って確かめました。下は 2023 年と、2024 年（うるう年で、2 月 29 日まで出ている）です。どちらも、祝日・休日・その他がそれぞれの色で出ています。

![2023 年](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/8b4f14c8-a58c-4e0f-92de-6626bb9e9329.png)

![2024 年](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/7ed1ee34-ba70-4c5f-91a8-b71b06e378fd.png)

---

# 6. 処理時間を測る

ボタンを押してから PDF ができるまでが長いので、`LOG` で処理時間をコンソールに出しました。時刻は `NOW()` で取り、前の段階の値に依存させて、順序を保つことをねらいました。ただし、依存させることで `NOW()` が実際にその時点で評価されることまでは確かめていません。以下の値は、今回の環境での参考値です。

```text
t0, NOW(),
lg0, LOG("年間カレンダー 開始", DATE_FORMAT(t0, "YYYY-MM-DD HH:mm:ss")),
…
t_mon, IF(months = "", NOW(), NOW()),
…
t1, IF(out = "", NOW(), NOW()),
lg1, LOG("年間カレンダー 終了", DATE_FORMAT(t1, "YYYY-MM-DD HH:mm:ss"),
  "504マス", ROUND(DATE_DIFF(t_arr, t_mon, "milliseconds") / 1000, 3) & " 秒",
  "合計", ROUND(DATE_DIFF(t0, t1, "milliseconds") / 1000, 3) & " 秒"),
```

`DATE_FORMAT` は、タイムゾーンを指定しなくても日本時間で出ました。結果は次のとおりです。

| 段階 | 秒 |
| :--- | ---: |
| DIC | 0.013 |
| 月の配列 | 0.013 |
| 504 マス | 5.967 |
| 仕上げ | 0.002 |
| 合計 | 5.995 |

ほぼ全部が 504 マスのループです。ループの中身を変えて、それぞれ 504 回を測りました。計測用のボタンを別に作り、A〜G を 1 つの計算式の中で順に計算して、1 回だけ実行した値です。

| # | ループの中身 | 秒 |
| :--- | :--- | ---: |
| A | `k` | 0.006 |
| B | `MOD(k, 42) + 1` | 0.049 |
| C | `LET` で変数 1 つ | 0.189 |
| D | `LET` で変数 6 つ（月・曜日・日付・範囲・区分の計算） | 2.348 |
| E | `DIC_ITEM` 1 回 | 0.264 |
| F | 文字列をつなぐだけ | 0.007 |
| G | 本番と同じ中身 | 15.47 |

中身が増えるほど時間が増えることは分かりますが、この結果から、関数 1 回あたりの時間や、本番の 1 マスあたりの計算の数までは決められません。

また、本番と同じ中身の G は 15.47 秒で、本番の式で測った 5.967 秒の約 2.6 倍になりました。計測用の式では A〜F の変数の計算がどこで行われているかを確かめておらず、評価の順序や計測の条件の影響を切り分けられていません。**この差の原因は分かっていません**。

今回の計測結果では、504 マスを組み立てる処理に当たる区間が、測った時間のほとんどを占めていました。

カレンダーの PDF を作るのは年に数回なので、**約 6 秒はこのままとしました**。

---

# 7. つまずき

- **一度に全部入れた**: 言語切り替え・凡例・一覧・稼働日を一度に入れると、エラーの原因を切り分けられませんでした。1 か月・日本語だけから積み上げるほうが早く進みました
- **検証が通っても値は確かめられない**: tools の検証とローカルのプレビューは「エラー 0」でも、範囲外の日付は実機の PDF を見るまで気づきませんでした
- **LET の変数に入れた真偽値**: 偽や 0 でも、IF の条件にそのまま使うと真になりました（5 章）。条件は IF に直接書くか、`変数 = 1` と比べて書きます
- **LOG の値**: 5 章の確認の途中で、LOG に出た値が式の結果と食い違うことがありました（結果では false の値が LOG では true、IF の結果が LOG では空）。6 章の処理時間も LOG の値なので、参考値として扱います
- **AI の説明の誤り**: AI は途中で「ループの中の LET の変数は、内側のループから見えない」と説明しましたが、誤りでした。**ループの中の LET の変数は内側のループから見え、LET の外側からは見えない**仕様です
- **会話の中のプレビュー**: リモートのセッションでは印刷屋 MCP のプレビューが表示されず、同じ HTML を手元で再現して確認しました

---

# 8. 設定ファイル

今回の設定（年間カレンダーのボタン 1 つ）です。6 章の処理時間を測る LOG と、計測用のボタン（A〜G）は除いています。

使うアプリには、次のフィールドコードが要ります。違う場合は計算式の中を書き換えてください。

| フィールドコード | 種類 | 内容 |
| :--- | :--- | :--- |
| `year` | 数値 | 年 |
| `date` | 日付（テーブル内） | 休日の日付 |
| `type` | ドロップダウンなど（テーブル内） | 祝日 / 休日 / その他 |

`appId`・`appName` は今回のアプリ（845「休日」）の値です。

<details><summary>年間カレンダー_DIC.json（クリックで開く）</summary>

```json
{
  "date": "2026-10-13 00:00:00",
  "pluginName": "印刷屋プラグイン",
  "pluginID": "rex0220 Print craft plugin",
  "PluginVersion": "8",
  "appId": 845,
  "appName": "休日",
  "pluginEnable": true,
  "commonCssEnable": true,
  "externalRefs": "block",
  "pluginComment": "レコードの年（year）の年間カレンダー（A4 横・4列×3段）。HTML は計算式で組み立て、区分は DIC で引く",
  "pluginDescription": "休日アプリの詳細画面で、レコードの年の年間カレンダーの PDF を作ります。",
  "pluginInfos": [
    {
      "state": true,
      "menu": "年間カレンダー（DIC）",
      "menu_en": "Annual calendar (DIC)",
      "mcheck": true,
      "list": false,
      "authority": false,
      "desc": "年間カレンダーを作ります",
      "desc_en": "Make the annual calendar",
      "viewsCsv": "-",
      "tagsInfo": {
        "fieldsInfo": [
          {
            "state": false,
            "desc": "ボタン表示条件",
            "fieldcode": "$out",
            "formulaSet": ""
          },
          {
            "state": true,
            "desc": "ファイル名",
            "fieldcode": "$fname",
            "formulaSet": "year & \"年_年間カレンダー.pdf\""
          },
          {
            "state": true,
            "desc": "年間カレンダー",
            "css": ".cal { box-sizing: border-box; padding: 40px 48px 36px; color: #1f1f1f; display: flex; flex-direction: column; gap: 18px; }\n.cal .hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1f1f1f; padding-bottom: 8px; }\n.cal .yr { font-size: 44px; font-weight: bold; line-height: 1; margin-right: 16px; }\n.cal .tt { font-size: 18px; letter-spacing: 0.3em; }\n.cal .era { font-size: 12px; color: #555; }\n.cal .grid { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 28px; row-gap: 14px; }\n.cal .mh { border-bottom: 1px solid #9a9a9a; padding-bottom: 2px; margin-bottom: 4px; }\n.cal .mn { font-size: 22px; font-weight: bold; margin-right: 6px; }\n.cal .mu { font-size: 12px; color: #555; }\n.cal .g { width: 100%; border-collapse: collapse; table-layout: fixed; }\n.cal .g th { font-size: 12px; font-weight: bold; padding: 1px 0; text-align: center; border: none; background: none; }\n.cal .g td { font-size: 14px; height: 22px; padding: 0; text-align: center; border: none; }\n.cal .sun { color: #c0392b; }\n.cal .sat { color: #1f5fa8; }\n.cal .hol { color: #ffffff; background: #d9534f; font-weight: bold; }\n.cal .kyu { color: #ffffff; background: #e67e22; font-weight: bold; }\n.cal .oth { color: #1e7b4a; background: #dff3e6; }",
            "html": "##page##",
            "formulaSet": "LET(\n  // 区分は DIC（キー = 年初からの日数、値 = class）に入れて、各マスでは DIC_ITEM で 1 回引く（ARRAY_SOME を使わない）\n  // DIC_ASSIGN は後のものが上書きするので、その他 → 休日 → 祝日 の順に重ねると 祝日 > 休日 > その他 になる\n  base, year & \"-01-01\",\n  kd, DIC_ASSIGN(\n    ARRAY_DIC(TARRAYIF(type = \"その他\", date), vv, DIC(\"\" & DATE_DIFF(base, vv, \"days\"), \"oth\")),\n    ARRAY_DIC(TARRAYIF(type = \"休日\", date), vv, DIC(\"\" & DATE_DIFF(base, vv, \"days\"), \"kyu\")),\n    ARRAY_DIC(TARRAYIF(type = \"祝日\", date), vv, DIC(\"\" & DATE_DIFF(base, vv, \"days\"), \"hol\"))),\n  // 月ごとの 年初からの日数・1 日の曜日（0=日）・日数\n  msts, ARRAY_FOR(12, mi, DATE_DIFF(base, DATE_ADD(base, mi, \"month\"), \"days\")),\n  offs, ARRAY_FOR(12, mi, MOD(DATE_DIFF(\"1970-01-04\", DATE_ADD(base, mi, \"month\"), \"days\"), 7)),\n  lens, ARRAY_FOR(12, mi, DATE_DIFF(DATE_ADD(base, mi, \"month\"), DATE_ADD(base, mi + 1, \"month\"), \"days\")),\n  head, \"<thead><tr><th class='sun'>日</th><th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th class='sat'>土</th></tr></thead>\",\n  era, IF(year >= 2019, \"令和\" & IF(year = 2019, \"元\", \"\" & (year - 2018)) & \"年\", \"\"),\n  // 12 か月 × 42 マス。マスごとの値は LET で 1 回だけ計算する\n  months, JOIN(ARRAY_FOR(504, k, LET(\n    i, MOD(k, 42),\n    mi, (k - i) / 42,\n    w, MOD(i, 7),\n    dd, i - ARRAY_GET(offs, mi) + 1,\n    // その月の日なら 1（LET 変数に入れた偽や 0 は IF の条件で真になるため、1 / 0 で持ち = 1 と比べる）\n    inm, IF(dd < 1, 0, IF(dd > ARRAY_GET(lens, mi), 0, 1)),\n    kc, IF(inm = 1, DIC_ITEM(kd, \"\" & (ARRAY_GET(msts, mi) + dd - 1)), \"\"),\n    IF(i = 0, \"<div class='m'><div class='mh'><span class='mn'>\" & (mi + 1) & \"</span><span class='mu'>月</span></div><table class='g'>\" & head & \"<tbody><tr>\", \"\") &\n    IF(AND(w = 0, i > 0), \"</tr><tr>\", \"\") &\n    \"<td class='\" & IF(kc != \"\", kc, IF(w = 0, \"sun\", IF(w = 6, \"sat\", \"d\"))) & \"'>\" &\n    IF(inm = 1, \"\" & dd, \"\") & \"</td>\" &\n    IF(i = 41, \"</tr></tbody></table></div>\", \"\"))), \"\"),\n  REPLACE($html, \"##page##\",\n    \"<div class='rex0220-pcraft-page cal'>\" &\n    \"<div class='hd'><div><span class='yr'>\" & year & \"</span><span class='tt'>年間カレンダー</span></div><span class='era'>\" & era & \"</span></div>\" &\n    \"<div class='grid'>\" & months & \"</div></div>\")\n)"
          }
        ],
        "filecode": "",
        "pageSize": "A4",
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

- 印刷屋の計算式で HTML を組み立てるときは、HTML の属性を `'` で囲み、`${式}` を属性の中に書かない
- REPLACE などに数値を渡すときは `"" & 値` で文字列にする
- LET の変数に入れた真偽値や 0 を、IF の条件にそのまま使わない。`変数 = 1` のように比べて書く
- ループの中で配列を探す（ARRAY_SOME など）代わりに、ループの前に DIC を作って DIC_ITEM で引く
- 今回の処理時間は、ほとんどが 504 マスのループだった。LOG と NOW() で段階ごとに測ると、どこに時間がかかっているかの目安になる（値は参考値）

---

# まとめ

- 休日アプリのレコードから、印刷屋の計算式だけで年間カレンダー（A4 横 4 列×3 段）を作った。出力用のアプリは作っていない
- 要件を一度に全部入れると通らず、1 月・日本語だけの月カレンダーから積み上げ直した
- 12 か月×42 マス = 504 回のループ 1 回で HTML を組み立て、休日の色分けは DIC で 1 回引くだけにした
- tools の検証が通っても、範囲外の日付は実機の PDF で見つかった。値の確認は実機で行う
- 処理時間は約 6 秒（参考値）で、ほぼ全部が 504 マスのループ。年に数回の帳票なのでこのままとした。凡例・祝日の一覧・稼働日・言語切り替えは今回は入れていない

シリーズ「rex0220 印刷屋プラグイン - AI(Claude Desktop)に〜」:

1. [チャットで帳票を作らせる](https://qiita.com/rex0220/items/8cbebab5a5f8a9c21b1f)
2. [帳票のデザインを作り込ませる](https://qiita.com/rex0220/items/43ceafa584690b4b0a5b)
3. [見積書から注文書・請求書を作らせる](https://qiita.com/rex0220/items/eae546dc726e7c61512f)
4. [組織図を設計させてから、アプリを作らせる](https://qiita.com/rex0220/items/6e739ace80cffd2ad70a)
5. [QRコード付きの資産ラベルを作らせる](https://qiita.com/rex0220/items/a649d70314361b964cd2)
6. [写真付きの点検報告書を作らせる](https://qiita.com/rex0220/items/b10502d8d23373820aab)
7. [ガントチャートアプリの工程表を作らせる（関連レコード一覧に対応した Ver.8）](https://qiita.com/rex0220/items/f48cf8d9a89cb1971e41)
8. **休日アプリから年間カレンダーを作らせる（この記事）**
9. [作文を原稿用紙（400 字詰め）の PDF にさせる](https://qiita.com/rex0220/items/bb2649ca3d70264b8242)
10. [「あなたが生まれた日の太陽系」カードを作らせる](https://qiita.com/rex0220/items/acc7467aef9bb6a37325)

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [印刷屋プラグイン CSV_TVAL でカレンダー](https://qiita.com/rex0220/items/fca35db47d1858b53156)
- [帳票レシピ集とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
