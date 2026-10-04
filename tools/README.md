# print-craft authoring tools（開発メモ）

印刷屋プラグイン（print-craft）の設定 JSON を AI で作る・確かめるための tools。npm パッケージ `@rex0220/print-craft-authoring-tools`（MIT。版は `6.0.x`。先頭が対応する印刷屋プラグインの版）のソース。リポジトリのルートがテンプレート（利用者が "Use this template" で使う側）。計画と決定は print-craft の `docs/authoring-plan.md` 12 章。

**tools は印刷屋のコードを含まない。** 計算式エンジン（`desktop_js/KintoneFormulaPCraft.min.js`）と印刷屋の設定画面・帳票のコード + kit（`config_js/print-craft-authoring-api.js`。Ver.6 から zip に同梱。print-craft の `src/authoring/api.ts`）は、利用者の印刷屋 zip（`.env` の `PCRAFT_PLUGIN_ZIP`）から実行のたびにメモリに読む（`src/plugin-zip.ts`、`src/engine.ts`）。zip の中身の SHA-256 が `src/meta.ts` の既知のリリース（4 ファイルの組み合わせ）と違えば実行せずに止まる（fail closed。`SECURITY.md`）。開発中にソースから動かすとき（`node src/cli.ts …`）だけ、環境変数 `PCRAFT_ALLOW_DEV_PLUGIN=1` を置けば隣の print-craft の `prod/` からも読める（この場合は既知でなくても警告で続く。ビルドした `dist/cli.mjs` では読まない）。ビルド（`scripts/build.mjs`）は bundle に印刷屋 / kit のコードが入っていないことを確かめて止まる。

**ビルドとテストには、隣に印刷屋のリポジトリ（非公開）と plugin-config-kit / rexgrid が要る**（`package.json` の devDependencies が `file:` で参照する。型の import と、テストの fixture の zip `print-craft/dist/print-craft-plugin6.zip` のため。公開レジストリの tools を使うだけなら要らない）。zip の読み取りと版の照合のテスト（`test/plugin-zip-synthetic.test.mjs`、`test/engine-contract.test.mjs`）は印刷屋のコードを含まない合成 zip（`test/zip-helper.mjs`）でも動く。

```
Projects/
  plugin-config-kit/
  rexgrid/
  kintone-plugin/
    print-craft/              ← 型を import。テストは dist/print-craft-plugin6.zip を利用者の zip の代わりに読む
    print-craft-authoring/    ← このリポジトリ（ルート = テンプレート、tools/ = パッケージ）
```

## 構成

- `src/cli.ts` … `pcraft-authoring <command>`（version / fields / record / normalize / preview / diff）。読むのは cwd の中、書くのは fields/ records/ settings/ temp/ out/ の下だけ（`src/safe-path.ts`）。`.env` / policy / zip の場所は固定
- `src/plugin-zip.ts` … 印刷屋の zip（contents.zip の 2 層）を Node の zlib だけで読む。大きさ・entry 数・展開後の上限、CRC-32、名前の一致、重複を検査
- `src/engine.ts` … zip のエンジンと authoring API を happy-dom + スタブで動かす。版の照合（印刷屋の版、API の版と pluginVersion、tools の版の先頭、4 ファイルの SHA-256、API のキーと型）
- `src/kintone-url.ts` … 接続先の検証（`*.cybozu.com` / `*.kintone.com` / `*.cybozu.cn`、ユーザー情報・パス・ポート無し）
- `src/env.ts` / `src/kintone-rest.ts` … `.env`（kintone 公式 MCP と同じ `KINTONE_*` + `PCRAFT_PLUGIN_ZIP` + `PCRAFT_ALLOW_UNKNOWN_PLUGIN`）と GET 専用・許可 API 固定・送信先固定の REST
- `src/commands/` … 各コマンド。`src/normalize/` … 派生値の生成、検査（HTML / CSS の allowlist、policy、大きさ）、行の差分。`src/preview/` … 帳票 HTML（sandbox + CSP + DOM の無害化）
- `src/meta.ts` … tools の版、対応する印刷屋の版と API の版、既知の zip の中身の SHA-256（`KNOWN_PLUGIN_HASHES`）、API の契約（`REQUIRED_API`）
- `scripts/vendor.mjs` … moment 2.24.0 を CDN から `vendor/` に取る（`vendor/moment.json` の SHA-256 と照合）
- `scripts/build.mjs` … esbuild で `dist/cli.mjs`（Node 20、ESM。印刷屋 / kit のコードが入ったら失敗）
- `scripts/gen-schema-manifest.mjs` … `docs/schema-manifest.json` と `docs/defaults/*.json`（API の CONFIG_SCHEMA から）
- `scripts/gen-functions.mjs` … `functions.json`（関数の分類）。`scripts/gen-function-list.mjs` … `docs/関数一覧.md` ほか（lib の説明表 p.desc から）
- `test/` … `node --test`（src の .ts を直接読む。`test/helpers.mjs` が fixture の zip を PCRAFT_PLUGIN_ZIP に置く）

## 使い方（開発）

公開パッケージの実行は Node 20 以上。**ビルドとテストは Node 22.6 以上**（型の除去で `.ts` を直接読む。`scripts/build.mjs` も `.ts` を import する）。

```
cd tools
npm install         # happy-dom、esbuild、typescript と、隣の print-craft / plugin-config-kit / rexgrid への junction
npm run vendor      # 初回。moment を vendor/ に
npm test
npm run build       # dist/cli.mjs（prepack でも走る）
set PCRAFT_PLUGIN_ZIP=..\..\print-craft\dist\print-craft-plugin6.zip && node dist/cli.mjs version
npm pack --dry-run  # 公開前に中身を確かめる（dist、vendor、LICENSE、THIRD_PARTY_NOTICES、SECURITY、README だけ）
```

## 決まり

- 印刷屋の関数は `engine.api`（zip の authoring API）経由で使う。`src/` から print-craft を import するのは **型だけ**（`import type`）。実行コードを import すると build が止まる
- 印刷屋の `src/authoring/api.ts` の名前や引数を変えるときは `AUTHORING_API_VERSION` を上げ、tools の `SUPPORTED_API_VERSION` と `REQUIRED_API` を合わせる。印刷屋の zip の中身を変えたら `KNOWN_PLUGIN_RELEASES` にリリースの tuple（エンジン・API・bignumber・moment-timezone の 4 つの SHA-256。zip から計算）を足し、版を上げたら `SUPPORTED_PLUGIN_VERSIONS` と tools の版の先頭も上げる
- kintone への書き込みは行わない。HTTP 層は GET 専用で、送れるパスと送信先を固定する
- CLI に `.env` / policy / zip の場所を変えるオプションを足さない（AI が書けるファイルを読ませない）。書き込み先を増やすなら `src/safe-path.ts` の `WRITE_ROOTS`
- `vendor/*.js`、`dist/`、`out/`、`node_modules/` はコミットしない
