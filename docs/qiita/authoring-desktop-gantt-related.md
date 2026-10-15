<!--
title: rex0220 印刷屋プラグイン - AI にガントチャートアプリの工程表を作らせる（関連レコード一覧に対応した Ver.8）
tags:
  - kintone
  - Claude
  - MCP
private: false
url: https://qiita.com/rex0220/items/f48cf8d9a89cb1971e41（2026-10-12 公開。Qiita に貼るときは、このコメントを除く）
-->

[前回の記事](https://qiita.com/rex0220/items/b10502d8d23373820aab) では、写真付きの点検報告書を作りました。今回は、**ガントチャートアプリのタスクを「工程表」として PDF にする**話です。

できあがったのは、下の帳票です。横軸に時間を取るガントチャートそのものではなく、**プロジェクトの情報と、タスクの一覧表**（親子の階層、担当者、期間、状況、進捗バー）を A4 横に並べた工程表です。

![スクリーンショット 2026-10-12 20.06.21.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/e265ab12-be0c-4cb7-9dba-a1b57e8b1559.png)


ただし、これまでの記事のように「頼んだら帳票ができた」では終わりませんでした。タスクは**関連レコード一覧**で見せているレコードで、印刷屋プラグイン Ver.7 までは帳票の計算式から見えません。そこで、**プラグインを Ver.8 に上げて関連レコード一覧に対応させ、AI 用の tools と拡張機能も合わせて更新してから**、工程表を作りました。この記事は、その一連の流れのまとめです。

| # | やったこと | 結果 |
| :--- | :--- | :--- |
| 1 | 関連レコード一覧を帳票で使う仕様案を AI（Claude Code）に評価させ、仕様書にまとめて Codex にもレビューさせた | 方式の作り直しは不要、直す点 3 つ（3 章）を反映して実装へ |
| 2 | 印刷屋プラグイン Ver.8 を実装し、AI 用の tools（2.1.0）も対応 | テストと実機で確認 |
| 3 | 工程表の設定を tools で作り、実機の PDF を見ながら直した | 「平均進捗は意味がない」「親子を分かりやすく」「1 ページ目にプロジェクト情報を」「スマホにボタンが出ない」 |
| 4 | 設定画面の使いにくさも直した | 入力補完の並び、「広く編集」、計算式の検証と色付け |
| 5 | tools 2.1.0 を npm に、Claude Desktop の拡張機能 0.2.0 を GitHub に公開 | Desktop のチャットから、同じ工程表を会話の中でプレビューできた |

既存の基盤（印刷屋プラグイン Ver.7、計算式エンジン、tools 2.0、拡張機能 0.1.5）の上で、**新機能の仕様の評価から公開までを 1 日**（2026-10-12）で行いました。開発は Claude Code（AI）と進め、仕様のレビューには Codex も使っています。

---

# 1. なぜ Ver.8 が要ったか

使ったのは rex0220 のガントチャートアプリ（アプリ番号 4121）です。**プロジェクトとタスクが同じアプリのレコード**で、`record_type`（project / task）で区別しています。プロジェクトのレコードには関連レコード一覧 `task_list` があり、次の条件でそのプロジェクトのタスクを表示します。

| 項目 | 条件 | 絞り込み | 並び |
| :--- | :--- | :--- | :--- |
| `task_list` | プロジェクトの `uuid` = タスクの `project_id` | `task_delete not in ("ON")` | `display_order asc` |

![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/39e11cee-fc3f-4c6e-b1a7-0f4beda53e44.png)


関連レコード一覧は、画面には表示されますが、**レコードを取る API（`record.json`）の応答には含まれません**。印刷屋プラグインの帳票は自分のレコードの値を計算式に差し込む作りなので、Ver.7 までは「このプロジェクトのタスク」を帳票に並べる手段がありませんでした。

---

# 2. Ver.8 のしくみ — 仮のテーブル `親$子`

Ver.8 では、ボタンを押したときに、関連レコード一覧の条件・絞り込み・並び順で参照先のレコードを取り、**テーブル（サブテーブル）と同じ形で計算式に渡す**ようにしました。

参照先の項目は、計算式では **`関連レコード一覧のフィールドコード$参照先のフィールドコード`**（半角の `$`）で書きます。たとえば `task_list$task_name`、`task_list$start_date` です。`$` は kintone のフィールドコードに使えない文字なので、本体の項目と衝突しません。

プラグインは、取った参照先のレコードを `task_list` という**仮のテーブル**（SUBTABLE）としてレコードに足し、計算式エンジンにはテーブルとして見せます。**計算式エンジン（KintoneFormulaPCraft）は変えていません。** そのため、テーブルで使える関数がそのまま使え、関連レコード一覧のための関数を増やす必要もありません。

- `TABLE_HTML(task_list, …)` — 明細の表
- `TABLE_DIC(task_list, task_list$uuid, task_list$parent_task_id)` — 辞書（親子の階層に使う）
- `SUM(…)`、`COUNTROW(task_list)`、`ROWNO(task_list)`、`SUBTABLE(task_list$start_date)` — 集計と列の配列

設定画面の計算式の入力補完（`:`）にも「関連レコード一覧のラベル.項目のラベル」で候補が出ます。

取り方と制限は次のとおりです。

- **取るのはボタンを押したとき**（詳細画面の個別帳票）。関連レコード一覧の条件・絞り込み・並び順で `records` の API を 500 件ずつ取ります（画面の表示件数は使いません）。関連レコード一覧を使っていないボタンでは何も取りません
- **1 つの関連レコード一覧につき 1,000 件まで**。超えるとエラーを表示して帳票を作りません（部分的な帳票は作りません）。利用者に参照先のアプリを見る権限が要り、取れないときもエラーで止まります
- **使えない所**: ボタン表示条件・更新条件（1 行目）、一覧画面のボタン（一覧帳票・一括処理）、`FSET` / `FSET_TADD` での書き込み。設定の保存のときにエラーになります（1 行目は画面を開いたときに評価するもので、参照先のレコードはボタンを押したときに取るため。一覧画面のボタンは今回の対象外）
- 参照先のレコードの中のテーブルは対象外です
- 参照先の値は自アプリの項目と同じ扱いです

---

# 3. AI による仕様レビューと実装

仕様案を Claude Code に評価させ、実装できるかの判定とレビューを仕様案に書き足してから、仕様書にまとめました。その仕様書を Codex にレビューさせた結論は「方式の作り直しは不要」で、直す点が 3 つありました。

1. 計算式が関連レコード一覧を使っているかの判定を、文字の境界でなく**字句（トークン）単位**にする（`task_list2` や文字列リテラルの中の `task_list` を拾わない）
2. 条件の項目がレコード番号のとき、参照先は `$id` で照合する（アプリコード付きのレコード番号を扱う）
3. 1,000 件を超えたときは、部分的な帳票を作らずに**エラーにする**

このほかに決めたことが 1 つあります。

- **AI 用の API の版を 3 に**: tools が関連レコード一覧の仮の項目を知らないと、設定の検査で「項目が無い」になるためです。tools は印刷屋の zip の関数を呼んで動くので、取り方（条件・クエリ・500 件ずつの取得・上限）は本体と同じコードです

実装は Claude Code で行い、設定画面の部品（plugin-config-kit）のテストに関連レコード一覧の判定・展開・クエリ・取得・エラーのテストを足しました。

---

# 4. 工程表の設定

設定は、Claude Code から tools（`@rex0220/print-craft-authoring-tools`）で作り、実機の PDF を見ながら直しました。全体はテンプレートの [docs/samples/工程表](https://github.com/rex0220/print-craft-authoring/tree/main/docs/samples/%E5%B7%A5%E7%A8%8B%E8%A1%A8)（設定・項目定義・見本のレコード・プレビュー）にあるので、ここでは特徴のある所だけ載せます。

## ボタン表示条件とファイル名

1 行目（ボタン表示条件）では関連レコード一覧を使えないので、本体の項目で書きます。

```text
$out:   record_type = "project"
$fname: "工程表-" & project_name & ".pdf"
```

## 概要と期間

`COUNTROW` で件数、`SUM(IF(…))` で完了数、`MIN(SUBTABLE(…))` 〜 `MAX(SUBTABLE(…))` で期間。どれも仮のテーブルで動きます。タスクが 0 件なら期間は空にし、開始日や終了日が空のタスクがあっても、期間は空でない日付から出ます。開始日が全件空なら「 〜 2026-09-22」のように片側が空で出て、エラーにはなりません（tools の preview で確認）。

```text
total, COUNTROW(task_list),
done, SUM(IF(task_list$task_situation = "done", 1, 0)),
starts, SUBTABLE(task_list$start_date),
ends, SUBTABLE(task_list$end_date),
period, IF(total > 0, DATE_FORMAT(MIN(starts), "YYYY-MM-DD") & " 〜 " & DATE_FORMAT(MAX(ends), "YYYY-MM-DD"), ""),
```

## 親子の階層

`TABLE_DIC` で「uuid → 親タスク ID」の辞書を作り、タスク名の列で `DIC_ITEM` を使って親の親まで辿ります。親は `<b>`、子は深さの分だけ `└` で字下げします（3 段まで。4 段目以降は 3 段目と同じ字下げ）。並びが `display_order` なので、親の下に子が並びます。親が一覧に無いタスクは、1 段目の子として出ます（preview で確認）。

```text
parents, TABLE_DIC(task_list, task_list$uuid, task_list$parent_task_id),
…
ARRAY("タスク名", LET(
  p1, task_list$parent_task_id,
  p2, IF(p1 = "", "", DIC_ITEM(parents, p1)),
  p3, IF(p2 = "", "", DIC_ITEM(parents, p2)),
  name, ESC_HTML(task_list$task_name),
  IF(p1 = "", "<b>" & name & "</b>", IF(p2 = "", "　└ " & name, IF(p3 = "", "　　└ " & name, "　　　└ " & name))))),
```

## 1 ページ目と 2 ページ目以降

HTML 欄は空にして、計算式だけで組みました。1 ページ目は自分で `rex0220-pcraft-page` を書き、プロジェクト情報の表（本体の項目）と、`OPT("filter", ROWNO(task_list) < 24)` で絞ったタスク 24 行を置きます。残りは `OPT("filter", ROWNO(task_list) >= 24, "pagination", "Y", "perPage", "28", "maxPages", "40")` で、`TABLE_HTML` に 28 行ずつのページを作らせます（`filter` は行ごとに評価されます。24 + 28 × 40 = 1,144 行で、1,000 件の上限を超えません）。

```text
page1, "<div class='rex0220-pcraft-page'>" & 見出し & info
  & TABLE_HTML(task_list,
    OPT("filter", ROWNO(task_list) < 24, "pref", "pcraft-gantt-"),
    ARRAY("#", ROWNO(task_list) + 1), ARRAY("タスク名", …), ARRAY("担当者", ESC_HTML(task_list$assignee_name)),
    task_list$start_date, task_list$end_date, ARRAY("状況", task_list$task_situation),
    ARRAY("進捗", "<div class='pcraft-gantt-bar'><div class='pcraft-gantt-fill' style='width:" & IF(task_list$progress = "", 0, task_list$progress) & "%'></div></div>" & IF(task_list$progress = "", 0, task_list$progress) & "%"),
    ARRAY("MS", IF(task_list$milestone = "ON", "◆", "")), ARRAY("レコード", task_list$レコード番号))
  & "</div>",
rest, IF(total <= 24, "",
  TABLE_HTML(task_list,
    OPT("title", title, "filter", ROWNO(task_list) >= 24, "pagination", "Y", "perPage", "28", "maxPages", "40", "pref", "pcraft-gantt-"),
    … 1 ページ目と同じ列 …)),
page1 & rest
```

進捗バーは `<div class='pcraft-gantt-bar'><div class='pcraft-gantt-fill' style='width:NN%'></div></div>` です。進捗はアプリの数値項目（0〜100）をそのまま使います。計算式の文字列の中では、HTML の属性を **`'` で囲みます**（6 章のつまずき）。

文字列の項目（タスク名、担当者、プロジェクト名、責任者、メンバー、概要）は `ESC_HTML` で囲んで差し込みます（これまでの記事と同じ決まりです）。

![工程表-スマホゲームアプリの計画（詳細） (2)_縦連結.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/7ebcfb05-c89e-4e06-84e1-759822bbde8b.png)


---

# 5. 実機で直したこと

| 言ったこと | 直したこと |
| :--- | :--- |
| `進捗平均は意味がないのでは？` | 概要から平均進捗を外した（親タスクと子タスクの進捗が重なるため） |
| `親タスク・子タスクの識別や分かりやすく表示できるか？` | `TABLE_DIC` + `DIC_ITEM` の階層表示にした |
| `最初のページに、プロジェクト情報とタスクを表示できるか？` | 1 ページ目をプロジェクト情報 + 24 行、2 ページ目以降を 28 行ずつにした |
| `モバイルにボタンが表示されない` | 設定に Web フォント（Noto Sans JP）を足した |

スマートフォンの詳細画面のボタンは、設定の「Web フォント」が有効なときだけ出ます（Ver.6 からの決まり）。スマートフォンは PC と入っている書体が違い、Web フォント無しで PDF を作ると、PC で整えた帳票が崩れることがあるためです。今回の設定は PC で確かめながら作ったので Web フォントを入れておらず、スマートフォンにボタンが出ませんでした。Web フォントを足した後、スマートフォンの詳細画面からも工程表を作れることを確かめました。

実機で確かめたのは、タスク 10 / 13 / 31 / 55 / 58 件のプロジェクトです。タスクが 1,000 件のプロジェクトは無かったので、1,000 件の上限は合成データで確かめました（手元の Mac の Node.js で tools の preview を使った測定。1,000 行で 16 秒・36 ページ。ブラウザーで PDF にする時間は含みません）。実用は数百件までで、多いときは関連レコード一覧の「さらに絞り込む条件」で減らします。

## 設定画面も直した

工程表の計算式は長く、設定画面のセルでは全体が見えません。あわせて設定画面を直しました（Ver.8）。

- **入力補完の並び**: `:` の候補を「疑似項目 → 本体の項目 → テーブルの子 → 関連レコード一覧の子」の順にし、テーブルの子のラベルやフィールドコードの先頭でも絞り込めるようにしました（関連レコード一覧の項目が先頭に並んで、本体の項目を選びにくかったため）
- **広く編集**: CSS / HTML / 計算式のセルを編集中に、右上の ⤢（またはダブルクリック、Ctrl+Shift+E）で画面いっぱいの編集画面を開けます
- **検証と色付け**: 広く編集の計算式は、入力が止まると検証されて結果が下に出ます（エラーがあれば保存で閉じません）。関数・項目・文字列・コメントに色が付き、一覧に無い関数名は赤の下線、カーソルの隣の括弧は相手と一緒に黄色になります（表示だけで、計算式の中身は変わりません）

![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/28754510-0aea-4f33-a535-69ef891a0d99.png)


---

# 6. tools 2.1.0 と Claude Desktop の拡張機能 0.2.0

AI 用の tools（`@rex0220/print-craft-authoring-tools` 2.1.0）と、Claude Desktop の拡張機能 / Claude Code のプラグイン（print-craft MCP 0.2.0）も、関連レコード一覧に合わせました。

- **項目定義**（`fields` / `pcraft_fields`）: 関連レコード一覧の参照先の項目定義も取り、要約に `task_list$task_name` のように字下げで出します。API トークンの接続では、参照先のアプリのトークンも接続のファイルの `tokenMap` に書きます（取れなかった関連レコード一覧は理由を返します）
- **レコード**（`record` / `pcraft_record`）: 参照先のレコードも、印刷屋の zip の同じ関数で取り、仮のテーブルとして保存します。これで `preview` が印刷屋と同じ帳票を描けます
- **検査**（`normalize` / `pcraft_normalize`）: 使えない所（1 行目・一覧用・`FSET`）や、項目定義に参照先が無いときをエラーにします

拡張機能 0.2.0 を入れた Claude Desktop で、同じガントチャートアプリに対して `pcraft_fields` → `pcraft_record` → `pcraft_normalize` → `pcraft_preview` の流れを試しました。項目定義を取ると、AI は関連レコード一覧の 2 つ（`task_list` と `related_project`）の条件・絞り込み・並びを表にして、「帳票の計算式では `task_list$task_name` のように書けます」「1 行目用と一覧用の式では使えません」と説明してきました。レコードを取ると、値は返さず「`task_list`: 13 行」のような形だけが返ります。preview では、会話の中に工程表（1 ページ、13 行）が表示されました。

![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/100572/ef8e955f-3377-4b46-8772-e198ccefd3c8.png)

---

# 7. つまずき

- **計算式の文字列の中の `\"`**: `"<div class=\"bar\">"` と書くと `\` が残って `class="\"bar\""` になり、CSS が効きません（進捗バーが出なかった原因）。HTML の属性は `'` で囲みます
- **同じ名前のプロジェクト**: 実機で「タスク 13 件のはずが 10 件」と見えたのは、同じ名前の別プロジェクトのレコードでした。不具合ではありません
- **スマートフォンにボタンが出ない**: 設定に Web フォントが無いためでした（5 章）

---

# 気を付ける点

- 関連レコード一覧を使う帳票は **Ver.8 以降**で、AI 用の tools は 2.1.0 以降、拡張機能は 0.2.0 以降が要ります
- **1,000 件まで**。超えると帳票を作りません。利用者に参照先のアプリを見る権限が要ります
- 使えるのは**詳細画面の個別帳票の本文と計算項目**だけです。ボタン表示条件・更新条件・一覧画面のボタンでは使えません。参照先のレコードの中のテーブルは使えません
- 文字列の項目は `ESC_HTML` で囲み、共通の設定「外部参照」は新しい設定の既定（除く）のままにすることを勧めます
- スマートフォンでも使うなら、設定に Web フォントを入れます

---

# まとめ

- 関連レコード一覧のレコードは API の応答に含まれないため、**印刷屋プラグイン Ver.8 で、ボタンを押したときに参照先のレコードを取って仮のテーブル `親$子` として計算式に渡す**ようにした。計算式エンジンは変えず、テーブルの関数がそのまま使える
- 仕様は Claude Code と Codex のレビューで固め、既存の基盤の上で、仕様の評価から公開までを 1 日で終えた
- 工程表は `TABLE_DIC` + `DIC_ITEM` で親子の階層、`OPT("filter", …)` と `pagination` で 1 ページ目と 2 ページ目以降を分けた
- tools 2.1.0 と拡張機能 0.2.0 で、AI も参照先の項目定義とレコードを使って帳票を作り、会話の中でプレビューできる
- 今回確かめたのは工程表だけですが、同じしくみなので、案件とその受注明細、設備とその点検記録のような「レコードと関連レコード一覧」の帳票にも使えるはずです

シリーズ「rex0220 印刷屋プラグイン - AI(Claude Desktop)に〜」:

1. [チャットで帳票を作らせる](https://qiita.com/rex0220/items/8cbebab5a5f8a9c21b1f)
2. [帳票のデザインを作り込ませる](https://qiita.com/rex0220/items/43ceafa584690b4b0a5b)
3. [見積書から注文書・請求書を作らせる](https://qiita.com/rex0220/items/eae546dc726e7c61512f)
4. [組織図を設計させてから、アプリを作らせる](https://qiita.com/rex0220/items/6e739ace80cffd2ad70a)
5. [QRコード付きの資産ラベルを作らせる](https://qiita.com/rex0220/items/a649d70314361b964cd2)
6. [写真付きの点検報告書を作らせる](https://qiita.com/rex0220/items/b10502d8d23373820aab)
7. **ガントチャートアプリの工程表を作らせる（関連レコード一覧に対応した Ver.8。この記事）**
8. [休日アプリから年間カレンダーを作らせる](https://qiita.com/rex0220/items/0a6be4bdb34ebb2986c6)
9. [作文を原稿用紙（400 字詰め）の PDF にさせる](https://qiita.com/rex0220/items/bb2649ca3d70264b8242)
10. [「あなたが生まれた日の太陽系」カードを作らせる](https://qiita.com/rex0220/items/acc7467aef9bb6a37325)
11. [業務データから「番付表」を作らせる](https://qiita.com/rex0220/items/de341ab43b4c40bf61c1)

関連リンク:

- [製品紹介記事](https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76)（「関連レコード一覧（Ver.8 から）」の節）
- [FAQ](https://qiita.com/rex0220/items/a866440c50c1028acb4f)
- [帳票レシピ集 R8（工程表）とサンプル](https://github.com/rex0220/print-craft-authoring/blob/main/docs/%E5%B8%B3%E7%A5%A8%E3%83%AC%E3%82%B7%E3%83%94%E9%9B%86.md)
- [拡張機能（GitHub）](https://github.com/rex0220/print-craft-authoring-mcp) / [最新のリリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)
- [tools（npm）](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)
