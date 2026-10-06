# settings/ — 生成した設定 JSON

- ファイル名は `APP<アプリ番号>-<アプリ名>-<帳票名>.json`（例 `APP3740-見積書-ご提案書.json`）。アプリ番号を入れて、同じ名前のアプリを取り違えないようにする。アプリ名は記号を除いた短い名前でよい。アプリが増えたら `APP<アプリ番号>-<アプリ名>/<帳票名>.json` のフォルダー置きにしてよいが、**同じアプリで混在させない**
- **固定名で上書き**し、履歴は git の diff で追う（日時付きの名前を増やさない）
- 常に**封筒形式**（`date` / `pluginName` / `pluginID` / `PluginVersion` / `appId` / `appName` + 設定本体）
- **git が正**。設定画面で直したら、「設定をダウンロード」したファイルをここへ戻し、`npx @rex0220/print-craft-authoring-tools normalize <ファイル> --fields fields/<app>.json --check` で派生値が一致することを確かめてコミットする
- 反映の前に `npx @rex0220/print-craft-authoring-tools diff <前の版> <今の版>` で差分を見る（HTML / CSS / 計算式の行の差分）

このフォルダーのファイルにはアプリの項目コードや業務用語が入ります。リポジトリは private にしてください。
