# 印刷屋プラグイン — 設定ファイルのオーサリング環境

このリポジトリは、**要件から kintone プラグイン「印刷屋プラグイン（rex0220 Print craft）Ver.6」の設定 JSON を AI が生成・変更する**ための環境です。
生成した JSON は、プラグイン設定画面の **ツール → インポート → 保存する** で反映します。帳票は HTML + CSS + 計算式で書きます。

## 正本ドキュメント（必ずこの順で参照）

1. [docs/設定ファイル仕様.md](docs/設定ファイル仕様.md) — 設定 JSON の形式の正本（封筒、キー、誰が書くか、列挙、制約）
2. [docs/帳票関数リファレンス.md](docs/帳票関数リファレンス.md) — 帳票の評価の流れ、置き換えタグ、印刷屋固有の関数と**エスケープの扱い**
3. [docs/帳票レシピ集.md](docs/帳票レシピ集.md) — 帳票の書き方（既定の形）とレシピ
4. [docs/関数一覧.md](docs/関数一覧.md) — 使える計算式の関数 243 個（名前と引数）。例は [docs/関数の使い方（計算式プラグインの記事）.md](docs/関数の使い方（計算式プラグインの記事）.md)、1 関数ずつの詳しい説明は [docs/関数リファレンス（詳細）.md](docs/関数リファレンス（詳細）.md) を**検索して**読む（大きい）
5. [docs/AI設定オーサリング手順.md](docs/AI設定オーサリング手順.md) — 作業手順の詳細
6. [docs/samples/見積書/settings.json](docs/samples/見積書/settings.json) — 雛形（動作確認済み）

## 作業の流れ

要件は `requirements/` のファイル、またはチャットで受け取る。コマンドは `npx pcraft-authoring <command>`（tools。kintone には GET しか送らない）。

1. **対象アプリの番号を特定する** — 要件に番号があればそれを使う。名前しか無ければ kintone MCP の `kintone-get-apps` で探すが、**同名・類似名の候補が複数あるときは推測せず、番号（またはアプリの URL）を利用者に確認する**
2. **項目定義を取る** — `npx pcraft-authoring fields --app N` → `fields/N.json`（項目コード・型・テーブル・レイアウト・アプリ名）。計算式と HTML には**ラベルでなくフィールドコード**を書く。要件がラベルで書かれていたら、どのコードに対応させたかを利用者に示す。似たラベル（「合計」「合計金額」など）があるときは**推測しない**
3. **レコードを見る** — `kintone-get-records` で数件を見て値の形（日付、数値の桁、テーブルの行数、添付ファイルの有無）を確かめる。プレビュー用に 1 件を `npx pcraft-authoring record --app N --id R --fields-from settings/<ファイル>.json` → `records/N-R.json`（個人情報を含む。コミットしない。設定を書いた後に取ると項目を絞れる）
4. **帳票を組む** — [docs/帳票レシピ集.md](docs/帳票レシピ集.md) の既定の形: **HTML テンプレート + `${ESC_HTML(項目)}` + テーブルは `TABLE_HTML`**。CSS は共通 CSS（既定の 4 行）の差分だけ書く。社印などの画像は `<img src="data:image/svg+xml,…">`（data URL の SVG）か添付ファイルの `#{&f(fileKey)}`
5. **設定 JSON を組み立てる** — [docs/設定ファイル仕様.md](docs/設定ファイル仕様.md) に従い、**封筒形式**で `settings/<アプリ名>-<帳票名>.json` に保存する。`pluginID` は `"rex0220 Print craft plugin"`、`PluginVersion` は `"6"`。`filecode`（保存先の添付ファイル項目）、`pageSize`、`orientation`、`dpi`、`printMode` を明示する。派生値（`formula` / `usedFields` / `id` / `views` / `pluginUOG`、更新項目のメタデータ）は書かない
6. **正規化と検査** — `npx pcraft-authoring normalize settings/<ファイル>.json --fields fields/N.json`。エラーが 0 になるまで直す。**警告は消さずに利用者に伝える**（生の HTML を入れる関数、外部 URL など）。保存値の大きさ（256 KB）も出る
7. **プレビュー** — `npx pcraft-authoring preview settings/<ファイル>.json --fields fields/N.json --record records/N-R.json` → `out/<ボタン名>.html`。利用者に Chrome で開いてもらい、印刷屋のプレビューと比べる（近似。画像はダミー、Web フォントは読まない）
8. **反映方法と確認ポイントを利用者に伝える** — アプリの設定 → プラグイン → 印刷屋プラグインの設定 → ツール → インポート → **保存する** → **運用環境に反映** → 詳細画面でボタンを押して PDF を確かめる

既存設定の変更は、利用者がエクスポートした JSON（封筒形式）を受け取り、まず `normalize --check` で派生値が一致することを確かめてから設定本体だけを編集し、`normalize` の後に `npx pcraft-authoring diff <前> <後>` の差分を利用者に見せてから反映を案内する。**同じファイルへの上書き**（新規ファイルを増やさない。履歴は git）。

## 制約（守らないと動かない・壊れる）

- **封筒なし（素の設定だけ）の JSON は誤り。** `pluginID` / `PluginVersion` が違うとインポートできない・tools が止まる
- HTML 設定の行の並びは固定: 1 行目 `$out`（ボタン表示条件）、2 行目 `$fname`（ファイル名）、3 行目以降が帳票。`<div class="rex0220-pcraft-page">…</div>` が 1 ページ（用紙に固定。はみ出しは切れる）
- `${式}` は**エスケープされない**。文字列は `${ESC_HTML(項目)}`、金額や日付は `${FVAL(項目)}` / `${DATE_FORMAT(項目, "YYYY年M月D日")}`。複数行は `REPLACE(ESC_HTML(項目), "\n", "<br>")`
- **`${式}` を属性値の中に置かない**（`src` / `href` / `style` / `title` / `class` …）。`ESC_HTML` は引用符を逃がさない。属性の値は固定にする
- `HTML()` / `FVAL()` / `TABLE_HTML()` / `RECS_HTML()` / `FIELDS_HTML()` / `ADD_TAGS()` はレコードの値を生の HTML として入れる。使うときは利用者にその旨を伝える（`normalize` が警告する）。`${ESC_HTML(項目)} & HTML(…)` のように `&` でつないだ式も生の HTML（警告）
- 計算式で `ATTR("…", 項目)` のようにレコードの値を属性に入れない
- HTML は**許可された要素と属性だけ**（文章・表・画像の要素。`class` `id` `style` `title` `colspan` `src` `alt` `width` `height` `data-*` など）。一覧に無い要素・属性、`<script>` `<object>` `<embed>` `<link>` `<base>` `<meta>` `<form>` 系、インラインの `<svg>` / `<math>`、`on*` 属性、`javascript:` の URL は使えない（`normalize` がエラー）。図は `<img src="data:image/svg+xml,…">` か添付ファイルの `#{&f(…)}`。CSS の `@import` / `expression(` もエラー、外部の `url()` は `externalRefs: "block"` の設定ではエラー（印刷屋が除く）
- **外部参照**（ルートの `externalRefs`）: 新しい設定は `"block"` を書く（印刷屋 Ver.6 が描画の前に kintone 以外への読み込みとスクリプトを除く）。`"block"` の設定の HTML / CSS に外部の URL（画像、CSS）を書かない（`normalize` がエラー。帳票に出ない。添付ファイルの `#{&f(…)}` か `data:image/` にする）。`"allow"`（Ver.5 と同じく何も除かない。自己責任）と、キーが無い既存の設定（印刷屋は許可で動く）は **利用者の承認**が要る: 利用者が `policy/authoring-policy.json` の `allowExternalRefs` に設定ファイルを書く。外部の URL（`"allow"` の設定の画像・CSS、Google Fonts 以外の Web フォント）の承認は `allowExternal`。**AI は policy/ を書かない**（エラー・警告のまま利用者に伝える）。Google Fonts は承認済み
- 更新項目（`calcInfo`）は更新できる型だけ（文字列、数値、日付、日時、時刻、選択系、ユーザー / 組織 / グループ選択、リンク）。計算項目・ルックアップのコピー先・テーブルの中は不可。使う行だけ書く
- 一覧帳票（`list: true`）は PDF のダウンロードだけ（`filecode` は空）、`printMode` は効かない、`RECS_HTML` を使う。1 レコードの `preview` では確認できないので印刷屋で見る
- 一覧 ID（`viewsCsv`）、権限のユーザー / 組織 / グループのコード、ゲストのメールアドレス、他アプリの画像の fileKey は**推測しない**。利用者に聞く
- 画像を data URL で埋め込むと保存値（256 KB）を圧迫する。社印程度の小さな SVG にとどめ、写真は添付ファイル + `#{&f(…)}`
- 計算式の文字列の中に `//` を書かない（`"https://…"` など）。印刷屋は文字列の中でも `//` 以降をコメントとして捨てる（`normalize` がエラー）。URL は HTML の属性か `##目印##` に置く

## 使えるもの（積極的に使ってよい）

- `TABLE_HTML(テーブル, OPT("pref","pcraft-inv-item-"), ARRAY("#", ROWNO(テーブル)+1), 商品名, 数量, 単価, 金額)` — テーブルを表に。`OPT("pagination","Y","perPage","20")` で複数ページ、`OPT("type","card")` でカード形式
- `FIELDS_HTML(項目, …)` — 項目をラベル付きで縦に並べるカード
- 共通 CSS の既定の class: `pcraft-table-*`（表）、`pcraft-card-*`（カード）、`pcraft-inv-*`（見積書・請求書）。既定の CSS は `docs/defaults/cssInfo.json`
- `LET(table, TABLE_HTML(…), REPLACE($html, "##table##", table))` — HTML テンプレートの目印を計算式で置き換える形
- 置き換えタグ `#{&p}` / `#{&n}`（ページ番号）、`#{&f(fileKey)}`（添付ファイルの画像）、`#{&q(文字列)}`（QR）
- Web フォント: `fontInfo`（`enabled`、`preset`、`family`、`cssUrl`）。Google Fonts の URL は承認済み。PC・Mac・スマホで同じ字形にしたいときだけ
- 「ボタンを押したとき」 `printMode`: `preview`（既定）/ `confirm` / `direct`
- 多言語のボタン名 `menu_en` / `menu_zh`、説明 `desc_*`
- 計算式の `//` コメント（`formulaSet` に書ける。tools が除いた `formula` を作る）

## このリポジトリのルール

- 封筒形式で出力する。`settings/` は固定名で上書きし、履歴は git で追う
- **kintone への書き込みは行わない。** kintone MCP の書き込みツール（records の add / update / delete、form-fields の add / update / delete、update-form-layout、update-general-settings、deploy-app、add-app、update-statuses、add-record-comment、space の作成 / 更新）と `kintone-download-file` は使わない（`.claude/settings.json` で拒否してある）。tools も GET しか送らない
- `records/` と `out/` はレコードの値を含む。コミットしない（`.gitignore` 済み）。作業が終わったら消してよい
- 認証情報（`.env`）をファイルやチャットに書かない
- tools は `.env` の `PCRAFT_PLUGIN_ZIP`（印刷屋プラグインの zip）から計算式エンジンと印刷屋のコードを読む。「印刷屋の zip の場所が分からない」「版 … には対応していない」「zip の中身が tools の既知の一覧と違う」と出たら、利用者に zip の場所と版（アプリに入れたものと同じ。配布元から入手したもの）を確かめてもらう。`PCRAFT_ALLOW_UNKNOWN_PLUGIN` を AI が書いたり勧めたりしない
- tools が読むファイルは作業フォルダーの中、書く先は `fields/` `records/` `settings/` `temp/` `out/` の下だけ。`docs/samples/` のファイルは読める（`normalize … --dry-run` / `--check`、`--out temp/<名前>.json`、`preview`）が書き戻せないので、元にするときは `settings/` にコピーするか `--out` で `settings/` か `temp/` に出す
- 生成 JSON は `normalize` でエラー 0 にしてから保存する。警告は利用者に伝える
- `policy/` と `.env` を AI が編集しない
