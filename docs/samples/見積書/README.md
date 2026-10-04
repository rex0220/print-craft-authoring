# sample: 見積書（詳細画面、添付ファイル項目に保存）

`docs/帳票レシピ集.md` の R1 を、rex0220 の見積書アプリ（kintone アプリストア「商品見積書パック」を元にしたもの。Qiita「見積書の作成手順」の例）の項目定義で作った動作確認済みのサンプル。

| ファイル | 内容 |
| --- | --- |
| `settings-source.json` | AI が書く形（派生値なし）。雛形にするならこちらを複製する |
| `settings.json` | `normalize` を通した形（派生値あり）。そのままインポートできる（アプリ番号 3740 は読み替える） |
| `fields.json` | `pcraft-authoring fields --app 3740` の出力（19 項目。接続先は `https://example.cybozu.com` に置き換えてある） |
| `record.json` | プレビュー用の見本のレコード（架空の値） |
| `preview.html` | `pcraft-authoring preview` の出力（Chrome で開くと帳票の見た目が分かる。画像はダミー） |

```
npx pcraft-authoring normalize docs/samples/見積書/settings-source.json --fields docs/samples/見積書/fields.json --out temp/見積書.json
npx pcraft-authoring preview docs/samples/見積書/settings.json --fields docs/samples/見積書/fields.json --record docs/samples/見積書/record.json --out-dir out
```

要点: 封筒形式、1 行目 `$out` = `NOT(見積ファイル)`、2 行目 `$fname`、3 行目に HTML テンプレート（`${ESC_HTML(宛名)}`、`${FVAL(合計)}`、`##table##`）と `LET(table, TABLE_HTML(…), REPLACE($html, "##table##", table))`、`filecode` に見積ファイル、`printMode: confirm`。社印は data URL の SVG。
