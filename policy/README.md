# policy/ — 利用者が承認する外部 URL

帳票の HTML / CSS / Web フォントが外部の URL（`https://…` の画像、CSS、フォント）を参照すると、`pcraft-authoring normalize` が**警告**します。接続先を確かめて使うと決めたら、**利用者が**この `authoring-policy.json` に書きます。AI はこのフォルダーを編集しません（`.claude/settings.json` で拒否してあります。AI が自分で警告を消せないようにするためです）。

```json
{
  "allowExternal": [
    { "origin": "https://cdn.example.com", "files": ["settings/見積書.json"], "note": "社印の画像" },
    { "url": "https://example.com/logo.png" }
  ]
}
```

- `origin` はそのオリジン（`https://host`）の全部、`url` はその URL だけを許す
- `files` を書くと、その設定ファイル（リポジトリからの相対パス）に限る。無ければ全部の設定
- Google Fonts（`fonts.googleapis.com` / `fonts.gstatic.com`）は書かなくても承認済み
- 外部の URL は kintone の画面と PDF の作成時に読み込まれます。接続先が信頼できるか、利用者の環境から届くか（China 版など）を確かめてください
