# sample: 工程表（関連レコード一覧 → 親子の階層、1 ページ目にプロジェクト情報）

`docs/帳票レシピ集.md` の R8 を、rex0220 のガントチャートアプリ（プロジェクトとタスクが同じアプリ 4121。関連レコード一覧 `task_list` が「`uuid` = タスクの `project_id`」でプロジェクトのタスクを指し、`task_delete not in ("ON")` で絞り、`display_order asc` で並ぶ）の項目定義で作った、実機で確認済み（2026-10-12。10 / 31 / 55 / 58 タスク）のサンプル。印刷屋 **Ver.8**（authoring API 3）と tools 2.1.0 以降が要る。

| ファイル | 内容 |
| --- | --- |
| `settings-source.json` | AI が書く形（派生値なし）。雛形にするならこちらを複製する |
| `settings.json` | `normalize` を通した形（派生値あり）。そのままインポートできる（アプリ番号 4121 は読み替える） |
| `fields.json` | `pcraft-authoring fields --app 4121` の出力（49 項目。`related` に関連レコード一覧 2 つの参照先の項目定義。接続先は `https://example.cybozu.com` に置き換えてある） |
| `record.json` | プレビュー用の見本のレコード（架空の値。プロジェクト 1 件 + 仮のテーブル `task_list` 30 行 = 5 フェーズ × 子 5。`record --fields-from` の出力と同じ形） |
| `preview.html` | `pcraft-authoring preview` の出力（Chrome で開くと帳票の見た目が分かる。2 ページ） |

```
npx @rex0220/print-craft-authoring-tools normalize docs/samples/工程表/settings-source.json --fields docs/samples/工程表/fields.json --out temp/工程表.json
npx @rex0220/print-craft-authoring-tools preview docs/samples/工程表/settings.json --fields docs/samples/工程表/fields.json --record docs/samples/工程表/record.json --out-dir out
```

要点:

- 1 行目 `$out` = `record_type = "project"`（プロジェクトのレコードだけに出す。**1 行目で関連レコード一覧は使えない**）、2 行目 `$fname` = `"工程表-" & project_name & ".pdf"`
- 3 行目は HTML 欄を空にして、計算式だけで組む: 1 ページ目は自分で `<div class='rex0220-pcraft-page'>` を書き、見出し + プロジェクト情報の表（本体の項目）+ `TABLE_HTML(task_list, OPT("filter", ROWNO(task_list) < 24), …)` の 24 行。2 ページ目以降は `TABLE_HTML(task_list, OPT("filter", ROWNO(task_list) >= 24, "pagination", "Y", "perPage", "28", …), …)`。タスクが 24 件以下なら 1 ページ
- 親子の階層: `parents, TABLE_DIC(task_list, task_list$uuid, task_list$parent_task_id)` で uuid → 親タスク ID の表を作り、タスク名の列で `DIC_ITEM(parents, …)` を親の親まで辿って、親は太字、子は `└` で字下げ（3 段まで）
- 概要: `COUNTROW(task_list)`（件数）、`SUM(IF(task_list$task_situation = "done", 1, 0))`（完了）、`MIN(SUBTABLE(task_list$start_date))` 〜 `MAX(SUBTABLE(task_list$end_date))`（期間）
- 進捗バーは `<div class='pcraft-gantt-bar'><div class='pcraft-gantt-fill' style='width:NN%'></div></div>`（計算式の文字列の中の属性は `'` で囲む）
- `fontInfo` を有効（Noto Sans JP）にして、モバイルの詳細画面にもボタンを出す
