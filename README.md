# 印刷屋プラグイン — AI 設定オーサリング環境（準備中）

kintone プラグイン「印刷屋プラグイン（rex0220 Print craft）」の設定 JSON を、AI（Claude Code + kSQL MCP + tools）で作る・確かめるためのテンプレートです。
利用者向けの README、CLAUDE.md、docs/（設定ファイル仕様・帳票関数リファレンス・レシピ集・samples）は段階 1 の 1-5〜1-7 で入ります。

- `tools/` … npm パッケージ `@rex0220/print-craft-authoring-tools` のソース（開発メモは `tools/README.md`）。利用者は公開レジストリのパッケージを使うので、ここをビルドする必要はありません
- 計画と決定: print-craft の `docs/authoring-plan.md` 12 章
