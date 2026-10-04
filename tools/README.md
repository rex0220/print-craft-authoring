# print-craft authoring tools（開発メモ）

印刷屋プラグイン（print-craft）の設定 JSON を AI で作る・確かめるための tools。npm パッケージ `@rex0220/print-craft-authoring-tools`（MIT。版は `6.0.x`。先頭が対応する印刷屋プラグインの版）のソース。リポジトリのルートがテンプレート（利用者が "Use this template" で使う側）。計画と決定は print-craft の `docs/authoring-plan.md` 12 章。

**tools は印刷屋のコードを含まない。** 計算式エンジン（`desktop_js/KintoneFormulaPCraft.min.js`）と印刷屋の設定画面・帳票のコード + kit（`config_js/print-craft-authoring-api.js`。Ver.6 から zip に同梱。print-craft の `src/authoring/api.ts`）は、利用者の印刷屋 zip（`.env` の `PCRAFT_PLUGIN_ZIP`）から実行のたびにメモリに読む（`src/plugin-zip.ts`、`src/engine.ts`）。開発中は隣の print-craft の `prod/` からも読める。ビルド（`scripts/build.mjs`）は bundle に印刷屋 / kit のコードが入っていないことを確かめて止まる。

**ビルドとテストには、隣に印刷屋のリポジトリ（非公開）と plugin-config-kit / rexgrid が要る**（`package.json` の devDependencies が `file:` で参照する。型の import と、テストの fixture の zip `print-craft/dist/print-craft-plugin6.zip` のため。公開レジストリの tools を使うだけなら要らない）。

```
Projects/
  plugin-config-kit/
  rexgrid/
  kintone-plugin/
    print-craft/              ← 型を import。テストは dist/print-craft-plugin6.zip を利用者の zip の代わりに読む
    print-craft-authoring/    ← このリポジトリ（ルート = テンプレート、tools/ = パッケージ）
```

## 構成

- `src/cli.ts` … `pcraft-authoring <command>`（version / fields / record / normalize / preview / diff）
- `src/plugin-zip.ts` … 印刷屋の zip（contents.zip の 2 層）を Node の zlib だけで読む
- `src/engine.ts` … zip のエンジンと authoring API を happy-dom + スタブで動かす。版の照合（印刷屋の版、API の版、エンジンの SHA-256）
- `src/env.ts` / `src/kintone-rest.ts` … `.env`（kintone 公式 MCP と同じ `KINTONE_*` + `PCRAFT_PLUGIN_ZIP`）と GET 専用・許可 API 固定の REST
- `src/commands/` … 各コマンド。`src/normalize/` … 派生値の生成、検査（HTML / CSS / policy / 大きさ）、行の差分。`src/preview/` … 帳票 HTML
- `src/meta.ts` … tools の版、対応する印刷屋の版と API の版、既知のエンジンの SHA-256
- `scripts/vendor.mjs` … moment 2.24.0 を CDN から `vendor/` に取る（`vendor/moment.json` の SHA-256 と照合）
- `scripts/build.mjs` … esbuild で `dist/cli.mjs`（Node 20、ESM。印刷屋 / kit のコードが入ったら失敗）
- `scripts/gen-schema-manifest.mjs` … `docs/schema-manifest.json` と `docs/defaults/*.json`（API の CONFIG_SCHEMA から）
- `scripts/gen-functions.mjs` … `functions.json`（関数の分類）。`scripts/gen-function-list.mjs` … `docs/関数一覧.md` ほか（lib の説明表 p.desc から）
- `test/` … `node --test`（Node 22.6 以上。src の .ts を直接読む。`test/helpers.mjs` が fixture の zip を PCRAFT_PLUGIN_ZIP に置く）

## 使い方（開発）

```
cd tools
npm install         # happy-dom、esbuild、typescript と、隣の print-craft / plugin-config-kit / rexgrid への junction
npm run vendor      # 初回。moment を vendor/ に
npm test
npm run build       # dist/cli.mjs（prepack でも走る）
node dist/cli.mjs version --plugin-zip ../../print-craft/dist/print-craft-plugin6.zip
npm pack --dry-run  # 公開前に中身を確かめる（dist、vendor、LICENSE、THIRD_PARTY_NOTICES、README だけ）
```

## 決まり

- 印刷屋の関数は `engine.api`（zip の authoring API）経由で使う。`src/` から print-craft を import するのは **型だけ**（`import type`）。実行コードを import すると build が止まる
- 印刷屋の `src/authoring/api.ts` の名前や引数を変えるときは `AUTHORING_API_VERSION` を上げ、tools の `SUPPORTED_API_VERSION` と合わせる。印刷屋の版を上げたら `SUPPORTED_PLUGIN_VERSIONS` と `KNOWN_ENGINE_SHA256` を足し、tools の版も上げる
- kintone への書き込みは行わない。HTTP 層は GET 専用で、送れるパスを固定する
- `vendor/*.js`、`dist/`、`out/`、`node_modules/` はコミットしない
