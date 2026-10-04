# AI による印刷屋プラグイン設定オーサリング手順

Claude Code（VSCode）と kintone 公式 MCP、tools（`pcraft-authoring`）で、印刷屋プラグイン Ver.6 の設定 JSON を作る・変える手順。AI への常設指示は `CLAUDE.md`、JSON の形式は `設定ファイル仕様.md`、帳票の書き方は `帳票レシピ集.md` と `帳票関数リファレンス.md`。

## 1. 全体像

| 役割 | 何をするか |
| --- | --- |
| 利用者 | 要件を書く（アプリ番号、帳票の内容、保存先、見た目）。プレビューと差分を見る。インポートして反映する。外部 URL を承認する |
| AI（Claude Code） | 項目定義とレコードを確かめ、HTML / CSS / 計算式を組み、封筒形式の JSON を書き、tools で検査・プレビューし、反映手順を伝える |
| kintone MCP（`@kintone/mcp-server`） | AI の探索（アプリ一覧、アプリ情報、項目定義、レイアウト、レコード）。読み取りだけ許可 |
| tools（`pcraft-authoring`） | `fields` / `record`（GET で取ってファイルに）、`normalize`（派生値の生成と検査）、`preview`（帳票 HTML）、`diff`（差分） |

AI が書くのは設定 JSON と要件の整理だけで、kintone には何も書き込まない。反映は利用者が設定画面でインポートする。

## 2. 準備

### 2.1 MCP サーバーの登録（このリポジトリでは設定済み）

`.mcp.json` が kintone 公式 MCP を `node --env-file=.env node_modules/@kintone/mcp-server/dist/index.js` で起動する。認証は `.env`（`KINTONE_BASE_URL` と `KINTONE_API_TOKEN`、または `KINTONE_USERNAME` / `KINTONE_PASSWORD`）。tools も同じ `.env` を読み、加えて `PCRAFT_PLUGIN_ZIP`（印刷屋プラグインの zip）から計算式エンジンと印刷屋の設定画面・帳票のコード（authoring API）を実行時に読む。tools 自体にはそれらは入っていない。

### 2.2 read-only を担保する

- `.claude/settings.json` の `deny` に kintone MCP の書き込みツール全部（records の add / update / delete、update-statuses、add-record-comment、form-fields の add / update / delete、update-form-layout、update-general-settings、add-app、deploy-app、space の作成 / 更新）と `kintone-download-file` を並べてある。`allow` は読み取りツールと、`settings/` `requirements/` `fields/` `records/` `out/` への書き込み、`npx pcraft-authoring …` の実行だけ
- tools の HTTP 層は GET 専用で、呼べる API は `/k/v1/app`、`/k/v1/app/form/fields`、`/k/v1/app/form/layout`、`/k/v1/record`（と preview 版）に固定
- 推奨は**レコード閲覧だけの API トークン**（サーバー側で書き込みができない）。ゲストスペースのアプリは MCP では見えない（tools の `--guest <spaceId>` は使える）

### 2.3 疎通確認

```
npx pcraft-authoring version
```

tools の版と、zip から読んだ印刷屋の版（6）・authoring API の版・計算式エンジンの SHA-256（既知）が出れば OK。Claude Code に「kintone-get-apps を実行して」→ アプリ一覧が返れば MCP も OK。

## 3. 作業手順（AI に指示する流れ）

### ステップ 1 — 対象アプリと項目を確定する

- アプリは**番号**で指定する（URL `/k/番号/`）。名前だけのときは `kintone-get-apps` で探し、同名・類似名があれば利用者に確認する
- `npx pcraft-authoring fields --app N` → `fields/N.json`。項目コード・型・テーブルの子・レイアウト・アプリ名が入る。帳票と計算式には**コード**を書く（ラベルではない）
- 要件がラベルで書かれていたら、どのコードに対応させたかを利用者に示す。「合計」と「合計金額」のように似たラベルがあれば推測しない
- 添付ファイル項目（保存先）、テーブル（明細）、ユーザー選択（担当者）などの型を確かめる

### ステップ 2 — レコードを見る

- `kintone-get-records` で数件を見て、日付の形、数値の桁と単位、テーブルの行数、添付ファイルの有無、複数行の改行を確かめる
- プレビュー用に代表的な 1 件を選ぶ（明細が複数行、備考に改行、添付あり、が揃うものがよい）。設定を書いた後に `npx pcraft-authoring record --app N --id R --fields-from settings/<ファイル>.json` で取る（使う項目だけ残る）

### ステップ 3 — 帳票を組む

- `帳票レシピ集.md` の既定の形: **HTML テンプレート + `${ESC_HTML(項目)}` + テーブルは `TABLE_HTML`** を `LET(table, TABLE_HTML(…), REPLACE($html, "##table##", table))` で差し込む
- CSS は共通 CSS（既定の 4 行 `table` / `card` / `comm` / `invoice`）の class を使い、帳票の CSS には差分だけ書く
- 金額は `${FVAL(項目)}`（桁区切りと単位）、日付は `${DATE_FORMAT(項目, "YYYY年M月D日")}`、複数行は `${REPLACE(ESC_HTML(項目), "\n", "<br>")}`（`FVAL` でもよいが生の HTML）
- 1 ページは `<div class="rex0220-pcraft-page">…</div>`。A4 縦 96 dpi は 794 × 1123 px で、内側の余白は上下 40px・左 60px・右 40px。はみ出た部分は切れるので、テーブルが長いときは `TABLE_HTML` の `pagination`
- 社印などの画像は小さな SVG（data URL）か、添付ファイルの `#{&f(fileKey)}`。外部の URL は利用者の承認が要る

### ステップ 4 — 設定 JSON を組み立てて検査する

- `設定ファイル仕様.md` に従い封筒形式で `settings/<アプリ名>-<帳票名>.json` に保存する。書くのは「AI」の列のキーだけ
- `npx pcraft-authoring normalize settings/<ファイル>.json --fields fields/N.json` → エラー 0 にする。エラーの規則名: `envelope.*`（封筒）、`schema`、`tags.*`（列挙・保存先・行の並び）、`calc.ineligible`（更新できない項目）、`formula.syntax`（計算式）、`field.unknown`（無い項目）、`html.rule` / `css.rule`（危険な書き方）、`size`（256 KB）
- **警告は消さずに利用者に伝える**: `html.rawExpression`（`${式}` が ESC_HTML を通していない）、`formula.rawHtml`（生の HTML を入れる関数）、`formula.attr`（属性にレコードの値）、`external.url`（外部 URL。承認は利用者が `policy/` に書く）
- `--check` は、エクスポートした設定を戻すときに派生値が一致することの確認。`--dry-run` は書き戻さない

### ステップ 5 — プレビューと反映

- `npx pcraft-authoring preview settings/<ファイル>.json --fields fields/N.json --record records/N-R.json` → `out/<ボタン名>.html`。利用者が Chrome で開く。帳票は sandbox の iframe の中で、画像はダミー、Web フォントは読まない（近似）
- 式のエラーは帳票に赤字で入り、終了コードが 1 になる。直してやり直す
- 一覧帳票（`list: true`）は 1 レコードでは確認できない。印刷屋で見る
- 反映: アプリの設定 → プラグイン → 印刷屋プラグインの設定 → ツール → インポート → 保存する → 運用環境に反映 → 詳細画面でボタンを押す。保存先があれば添付ファイル項目に PDF が入る

### 既存設定の変更

1. 利用者が設定画面で **ツール → エクスポート** した JSON を `settings/` に置く
2. `npx pcraft-authoring normalize <ファイル> --fields fields/N.json --check --dry-run` で「入力の派生値と生成した値は一致」を確かめる（一致しなければ fields が古い）
3. 設定本体だけを編集し、`normalize` を通す
4. `npx pcraft-authoring diff <前> <後>` の差分を利用者に見せ、よければ反映を案内する

## 4. AI への指示テンプレート

新規:
```
アプリ 3740（見積書）に、A4 縦の見積書を作るボタン「見積書」を作って。
- 見積ファイルに保存。既にファイルがあればボタンを出さない。押したら確認してから作成
- 上部に宛名（御中）、見積金額、有効期限（見積日の 1 か月後）。右に見積書番号、発行日、自社名「株式会社サンプル」、担当者
- 明細は見積明細テーブル（商品名・数量・単価・金額）。下に備考と小計・消費税・合計
- 共通 CSS の見積書のデザインをベースに、明細の見出し行を濃い色に
- 作ったら「発行済み」チェックボックスに「済」を入れる
```

変更:
```
settings/見積書-見積書.json の見積書に、右上の自社情報の下に住所「〇〇県〇〇市…」と電話「TEL: 00-0000-0000」を足して。
```

一覧帳票:
```
アプリ 381（案件管理）の一覧画面に、表示中のレコードを表にした「案件一覧」ボタン（A4 横）を作って。顧客名・部署名・案件名・確度・プラン費用・オプション費用・合計費用。費用の合計欄も。
```

## 5. git 管理

- `settings/` は固定名で上書き。コミットメッセージに何を変えたかを書く
- `fields/` はコミットしてよい（項目定義。アプリの構造が入るので private）。`records/` と `out/` はコミットしない
- 設定画面で直した設定は、エクスポートして `settings/` に戻し `normalize --check` で確かめてからコミット（git が正）
- `policy/authoring-policy.json` は利用者が編集してコミット

## 6. 確認済みの環境

- 印刷屋プラグイン Ver.6、tools 6.0.0、kintone 公式 MCP 1.8.2、Node 20 以上（開発は Node 24）
- Windows 11 の Claude Code（VSCode）。macOS でも手順は同じ（`.env` の置き方は README）
