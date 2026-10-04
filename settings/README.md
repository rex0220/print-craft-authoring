# settings/ — 生成した設定 JSON

- ファイル名は `<アプリ名>-<帳票名>.json`（例 `見積書-見積書.json`）。アプリが増えたら `<アプリ名>/<帳票名>.json` のフォルダー置きにしてよいが、**同じアプリで混在させない**
- **固定名で上書き**し、履歴は git の diff で追う（日時付きの名前を増やさない）
- 常に**封筒形式**（`date` / `pluginName` / `pluginID` / `PluginVersion` / `appId` / `appName` + 設定本体）
- **git が正**。設定画面で直したら、ツール → エクスポートしてここへ戻し、`npx pcraft-authoring normalize <ファイル> --fields fields/<app>.json --check` で派生値が一致することを確かめてコミットする
- 反映の前に `npx pcraft-authoring diff <前の版> <今の版>` で差分を見る（HTML / CSS / 計算式の行の差分）

このフォルダーのファイルにはアプリの項目コードや業務用語が入ります。リポジトリは private にしてください。
