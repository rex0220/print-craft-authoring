# print-craft authoring tools（開発メモ）

印刷屋プラグイン（print-craft）の設定 JSON を AI で作る・確かめるための tools。npm パッケージ `@rex0220/print-craft-authoring-tools`（版は `6.0.x`。先頭が対応する印刷屋プラグインの版）。このフォルダーはパッケージのソースで、リポジトリのルートがテンプレート（利用者が "Use this template" で使う側）。計画と決定は print-craft の `docs/authoring-plan.md` 12 章。

**ビルドとテストには、隣に印刷屋のリポジトリ（非公開）と plugin-config-kit / rexgrid が要る**（`package.json` の devDependencies が `file:` で参照する。公開レジストリの tools を使うだけなら要らない）。

```
Projects/
  plugin-config-kit/
  rexgrid/
  kintone-plugin/
    print-craft/              ← src/shared、src/config、prod/desktop_js（計算式エンジン min.js）を import する
    print-craft-authoring/    ← このリポジトリ（ルート = テンプレート、tools/ = パッケージ）
```

## 構成

- `src/cli.ts` … `pcraft-authoring <command>`（version / fields / record / normalize / diff。preview は段階 1 の 1-4）
- `src/engine.ts` … 計算式エンジン（print-craft の `prod/desktop_js/KintoneFormulaPCraft.min.js`。zip と同じファイル）を Node + happy-dom + スタブで動かす
- `src/env.ts` / `src/kintone-rest.ts` … `.env`（kintone 公式 MCP と同じ `KINTONE_BASE_URL` / `KINTONE_API_TOKEN` / `KINTONE_USERNAME` / `KINTONE_PASSWORD`。dashboard の `KSQL_*` も読む）と GET 専用・許可 API 固定の REST
- `src/commands/` … 各コマンド。`src/normalize/` … 派生値の生成、検査（HTML / CSS / policy / 大きさ）、行の差分
- `src/meta.ts` / `src/paths.ts` … 版の情報と置き場所
- `scripts/vendor.mjs` … moment 2.24.0 を CDN から `vendor/` に取る（`vendor/moment.json` の SHA-256 と照合）
- `scripts/build.mjs` … esbuild で `dist/cli.mjs`（Node 20、ESM）。lib を `dist/lib/` に複写し、版の情報を埋める
- `scripts/gen-functions.mjs` … `functions.json`（関数の分類）を lib の関数表と計算式プラグインの文書から作る・更新する
- `test/` … `node --test`（Node 22.6 以上。src の .ts を直接読む）

## 使い方（開発）

```
cd tools
npm install         # happy-dom、esbuild、typescript と、隣の print-craft / plugin-config-kit / rexgrid への junction
npm run vendor      # 初回。moment を vendor/ に
npm test
npm run build       # dist/cli.mjs と dist/lib/
node dist/cli.mjs version
```

## 決まり

- 印刷屋の `src/shared` / `src/config` の関数を import する。印刷屋側で export の名前を変えたらここのテストを流す（print-craft の CLAUDE.md）
- 印刷屋の版を上げたら tools の版も上げる（`package.json` の version。先頭 = PluginVersion）
- kintone への書き込みは行わない。HTTP 層は GET 専用で、送れるパスを固定する
- `vendor/*.js`、`dist/`、`out/`、`node_modules/` はコミットしない
- 公開するのは npm のパッケージ（`npm pack --dry-run` で中身を確かめる）。このソースも公開リポジトリにあるが、印刷屋の src と lib は入っていないので第三者はビルドできない
