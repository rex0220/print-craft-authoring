# sample: 一覧帳票（一覧画面のレコードを表に、PDF をダウンロード）

`docs/帳票レシピ集.md` の R5。架空の案件管理アプリ（`fields.json` は手で作った項目定義）で、一覧画面に表示中のレコード（「選択したレコードのみ一括処理」で選んだレコード）を A4 横の表にして PDF をダウンロードする。Qiita「一覧画面のPDF作成」「一覧画面の合計欄」を既定の形に合わせたもの。

| ファイル | 内容 |
| --- | --- |
| `settings-source.json` | AI が書く形（派生値なし） |
| `settings.json` | `normalize` を通した形（派生値あり） |
| `fields.json` | 架空の項目定義（`pcraft-authoring fields` の出力の形） |

要点: `list: true`、`filecode: ""`（一覧帳票はダウンロードだけ）、`orientation: "l"`、HTML 欄は空で計算式に `RECS_HTML(OPT("pagination","Y","perPage","15","footer","Y"), ARRAY("#", $rseq + 1), …, ARRAY("プラン費用", YEN(プラン費用), "value-right", "YEN(RECS_SUM(プラン費用))"))`。`menuInfo.recselect: true` で一覧に「選択したレコードのみ一括処理」のチェックを出す。

一覧帳票は 1 レコードの `preview` では確認できない（`RECS_HTML` は一覧のレコードが要る）。インポート後に一覧画面で確かめる。
