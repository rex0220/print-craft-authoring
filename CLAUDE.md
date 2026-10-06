# 印刷屋プラグイン — 設定ファイルのオーサリング環境

このリポジトリは、**要件から kintone プラグイン「印刷屋プラグイン（rex0220 Print craft）Ver.6」の設定 JSON を AI が生成・変更する**ための環境です。
生成した JSON は、利用者がプラグイン設定画面の **設定をアップロード → 取り込み方を選ぶ → 保存する** で反映します。帳票は HTML + CSS + 計算式で書きます。
コマンドは `npx @rex0220/print-craft-authoring-tools <command>`（tools。kintone には GET しか送らない）。短い `npx pcraft-authoring` は使わない（`npm ci` の前だと npm の公開レジストリの同じ名前のパッケージを取りに行く。許可の規則もパッケージ名の形だけ）。`npm ci` をしていない（tools が無い）と分かったら、何かを入れようとせず利用者に `npm ci` を頼む。
利用者への返答は、途中の経過も含めて利用者の言語で書く（日本語の指示には日本語）。
tools のコマンドは 1 回に 1 つ実行する（`;`、`&&`、`if (…) { … }` でつながない。つなぐと許可の規則が合わず、毎回確認が出る）。

## 読むもの（要るところだけ。全部を順に読まない）

| 知りたいこと | 読むもの |
| --- | --- |
| 帳票の書き方（既定の形） | [docs/帳票レシピ集.md](docs/帳票レシピ集.md) の 0 章。題材は該当の章だけ（R1 見積書、R2 CSS、R3 請求書、R4 複数ページ、R5 一覧帳票、R6 表示条件・ファイル名・更新項目、R7 Web フォント） |
| 雛形（派生値なし。新しいボタンはこれを写す） | [docs/samples/見積書/settings-source.json](docs/samples/見積書/settings-source.json)（詳細画面）、[docs/samples/一覧帳票/settings-source.json](docs/samples/一覧帳票/settings-source.json)。同じフォルダーの `settings.json` は normalize 後の形なので読まない |
| キーの意味・列挙・上限 | [docs/設定ファイル仕様.md](docs/設定ファイル仕様.md) をキー名で検索する（大きい。全部は読まない） |
| 印刷屋の関数・置き換えタグ・エスケープ | [docs/帳票関数リファレンス.md](docs/帳票関数リファレンス.md) |
| 一般の計算式の関数 | [docs/関数一覧.md](docs/関数一覧.md) を関数名で検索。例と詳しい説明は `docs/関数の使い方（計算式プラグインの記事）.md`、`docs/関数リファレンス（詳細）.md` を検索する（どちらも大きい） |
| 共通 CSS の既定の class | [docs/defaults/cssInfo.json](docs/defaults/cssInfo.json) |
| 項目定義・レコード・既存の設定 | 下の要約コマンド（`fields/` `records/` `settings/` の JSON を丸ごと読まない） |

`docs/AI設定オーサリング手順.md` と `README.md` は利用者向け（準備、指示の例、git の運用）で、作業には要らない。

## 要約コマンド（通信しない）

| コマンド | 出すもの |
| --- | --- |
| `npx @rex0220/print-craft-authoring-tools fields --app N --summary` | `fields/N.json` を 1 項目 1 行で（レイアウトの順。型、ラベル、書式・単位、選択肢、ルックアップ、テーブルの子、保存先にできる添付ファイル） |
| `npx @rex0220/print-craft-authoring-tools record --app N --id R --summary` | `records/N-R.json` の形（文字数・行数・数値の桁・テーブルの行数・添付の件数と種類。値は出さない） |
| `npx @rex0220/print-craft-authoring-tools buttons settings/<ファイル>.json` | ボタン一覧（出す画面、保存先、用紙、押したとき、表示条件、ファイル名、帳票の行、更新項目） |
| `npx @rex0220/print-craft-authoring-tools buttons settings/<ファイル>.json --button <名前>` | そのボタンの HTML / CSS / 計算式と更新項目（data: の URL は先頭と長さだけ） |

## 開発と本番（作業フォルダーに environments.json があるとき）

`environments.json`（利用者が書く。AI は書かない）に環境（開発 / 本番。ドメインが違っても、同じドメインでアプリが違ってもよい）とアプリの番号がある。このときは次のとおり（無ければこの節は使わない）。

- コマンドは `--env <環境>`（省略は既定の環境）と `--app <番号か apps の名前>`。保存先は `kintone/<ホスト名>/<番号>-<アプリ名>/` に決まる（`--out` は使わない）
- アプリのフォルダー: `fields.json`、`records/<番号>.json`、`out/`、設定のダウンロード / pull（`rex0220-print-craft-app<番号>-<日時>.json`。名前はそのまま。一番新しいものが今の設定）、直したもの（`…-edit.json`）、新しい帳票（その他の `*.json`。1 ファイル 1 帳票）
- 利用者が `inbox/` に置いたダウンロードは `take` でアプリのフォルダーへ移す。中身は `files --app <アプリ>` と `buttons --app <アプリ>` で見る
- **ダウンロード / pull のファイルは書き換えない**。直すときは `edit --app <アプリ>` で `-edit.json` に写し、それを直す（normalize もこちらに）。差分は `diff <ダウンロード> <-edit.json>`
- アプリのフォルダーの中のファイルなら、`normalize` の `--fields` は要らない（同じフォルダーの `fields.json`）。`preview` は `--record 3` で `records/3.json`
- 作るのも直すのも開発の環境のアプリ。本番へは、利用者が開発で確かめた同じファイルを本番の設定画面でアップロードする（「追加」か「一部置換」。アプリが違うという注意は出るが取り込める。項目が合わなければ保存のときに止まる）。本番のフォルダーは、本番の今の設定を見る（pull / ダウンロード）ためだけに使う
- **一覧 ID はアプリごとに違う**ので、開発で作るボタンの `viewsCsv` は空（詳細画面とすべての一覧）か `"-"`（詳細画面だけ）にする。特定の一覧に出したいボタンは、本番にアップロードした後に本番の設定画面で一覧を選ぶよう、反映方法を伝えるときに添える

## 新しい設定を作る

要件は `requirements/` のファイル、またはチャットで受け取る。

1. **アプリ番号** — 要件に番号があればそれを使う。名前だけなら kintone MCP の `kintone-get-apps` に `name`（部分一致）と `limit`（10 程度）を付けて探すが（条件なしで一覧を取らない。100 件で 2 万トークンほど）、**同名・類似名の候補が複数あれば推測せず、番号（かアプリの URL）を利用者に聞く**
2. **項目** — `fields --app N` → `fields --app N --summary`。計算式と HTML には**ラベルでなくフィールドコード**を書く。要件のラベルをどのコードに対応させたかを利用者に示す。似たラベル（「合計」「合計金額」など）は**推測しない**
3. **レコード** — `kintone-get-records` で数件を見て、プレビュー用に代表の 1 件（明細が複数行、備考に改行、添付あり）を選ぶ。設定を書いた後に `record --app N --id R --fields-from settings/<ファイル>.json` → `record --app N --id R --summary` で形を確かめる
4. **帳票** — レシピ集 0 章の既定の形: **HTML テンプレート + `${ESC_HTML(項目)}` + テーブルは `TABLE_HTML`**。CSS は共通 CSS の差分だけ書く
5. **設定 JSON** — 雛形を写して**封筒形式**で `settings/APP<アプリ番号>-<アプリ名>-<帳票名>.json` に書く（例 `settings/APP3740-見積書-ご提案書.json`。アプリ名は記号を除いた短い名前。1 ファイルに 1 帳票）。`pluginID` は `"rex0220 Print craft plugin"`、`PluginVersion` は `"6"`、`externalRefs` は `"block"`。`filecode`（保存先。空ならダウンロード）、`pageSize`、`orientation`、`dpi`、`printMode` を明示する。派生値（`formula` / `usedFields` / `id` / `views` / `pluginUOG`、更新項目の `type` などのメタデータ）は書かない。`cssInfo`（共通 CSS）は共通 CSS を変えるときだけ書く（書くと、アップロードの一部置換・追加でアプリの共通 CSS を丸ごと置き換えるかを利用者が選ぶ。既定は置き換えない。帳票の CSS は行の `css` に書く）
6. **normalize** — `normalize settings/<ファイル>.json --fields fields/N.json`。エラーを 0 にする（下の表）。**警告は消さずに利用者に伝える**
7. **preview** — `preview settings/<ファイル>.json --fields fields/N.json --record records/N-R.json [--button <名前>]` → `out/<ボタン名>.html`。利用者に Chrome で開いてもらい、印刷屋のプレビューと比べてもらう（近似。画像はダミー）。**AI はブラウザーを起動しない（headless のスクリーンショットも撮らない）。帳票の文書を `out/*.html` の iframe から取り出して開かない**（sandbox と CSP が外れる）。ページ数と式のエラーは preview の出力で、置き換わった文字（ページ番号など）は `out/*.html` を Grep で確かめる
8. **反映方法を伝える** — アプリの設定 → プラグイン → 印刷屋プラグインの設定 → **設定をアップロード** → 取り込み方を選ぶ → **保存する** → **運用環境に反映** → 詳細画面でボタンを押して PDF を確かめる。取り込み方は、印刷屋の設定がまだ無いアプリなら「全置換」、既存の設定があるアプリにボタンを足すなら「追加」（同じ名前があれば「名前 (2)」）、既存のボタンを差し替えるなら「一部置換」（ボタンごとに置き換え先を選ぶ）。一部置換と追加では外部参照・Web フォント・メニューなどはアプリの今の設定のまま。取り込んだボタンは保存のときに印刷屋が検査し、項目が合わなければ保存されない。確かめてほしい点（見た目、改行、ファイル名、保存先）を添える

## 既存の設定を変える（ボタンの追加・修正）

ボタンを足す・丸ごと差し替えるだけなら、エクスポートを使わずに「新しい設定を作る」の流れで新しいボタンだけのファイルを作り、アップロードの「追加」か「一部置換」で取り込める。既存のボタンの一部を直すときは次の手順。

1. 利用者がエクスポートした JSON（封筒形式）を `settings/` に置いてもらう。kintone の API ラボ（プラグインの設定情報を取得する REST API）を有効にした環境なら `pull --app N` で取れる（運用中の設定。保存して未反映の設定は `--preview`。権限が足りない・API が無効のエラーなら利用者にダウンロードを頼む。既にあるファイルを `--force` で上書きするのは利用者が良いと言ったときだけ）。以後は**同じファイルを上書き**する（新しいファイルを増やさない。履歴は git）
2. `buttons settings/<ファイル>.json` で構成を見る。直すボタンの中身は `--button <名前>`。**設定ファイルそのものを Read / Get-Content / head / node で表示しない**（エクスポートは 1 行の JSON なので、先頭の数行でも全体が出る）。書き戻すときの整形は気にしない（normalize が 2 スペースのインデントで書き直す）
3. `normalize settings/<ファイル>.json --fields fields/N.json --check --dry-run` で「入力の派生値と生成した値は一致」を確かめる（一致しなければ fields が古い）
4. 変える前の控えを `temp/<名前>-before.json` にコピーする（diff に使う）
5. 設定本体だけを編集する。**ボタンを足す**ときは雛形（`docs/samples/見積書/settings-source.json` の `pluginInfos[0]`）か既存のボタンを写し、`menu`（設定の中で一意）、HTML、`filecode` などを変えて `pluginInfos` の末尾に足す。足したボタンに派生値は書かない（既存のボタンの派生値は残してよい。normalize が作り直す）。ボタンの JSON の形（キー）は雛形で見て、既存のボタンの構造を出力しない。社印などの data URL を既存のボタンから写すときは、スクリプトの中で取り出して使う（表示しない）
6. `normalize`（エラー 0）→ `diff temp/<名前>-before.json settings/<ファイル>.json` の差分を利用者に見せる → `preview … --button <名前>`

## normalize の結果

`[エラー]` が 1 つでもあると書き戻さず終了コード 1（preview も書かない）。規則名は各行の末尾の（…）。

| エラー | 意味と直し方 |
| --- | --- |
| `json` / `schema` | JSON として読めない、型・上限が合わない。設定ファイル仕様のキー表で確かめる |
| `envelope.pluginID` / `envelope.version` / `envelope.appId` | 封筒の誤り。封筒なしの素の設定は作らない |
| `tags.rows` | HTML 設定の行の並び（1 行目 `$out`、2 行目 `$fname`、3 行目以降が帳票）、有効なボタンに HTML 設定が無い |
| `tags.pageSize` / `tags.orientation` / `tags.dpi` / `tags.printMode` | 列挙に無い値 |
| `tags.filecode` | 保存先がテーブルの外の添付ファイル項目でない |
| `menu.duplicate` | 有効なボタンの名前が重複している |
| `field.unknown` | fields に無い項目（ラベルで書いた、綴りの違い、別アプリの項目） |
| `formula.syntax` | 計算式を評価できない（実エンジンのメッセージを読む） |
| `formula.comment` | 計算式の文字列の中に `//`（`"https://…"` など）。印刷屋は文字列の中でも `//` 以降を捨てる。URL は HTML の属性か `##目印##` に置く |
| `calc.ineligible` / `calc.duplicate` | 更新できない項目（計算項目、ルックアップのコピー先、テーブルの中、更新できない型）、同じ項目が 2 回 |
| `html.rule` / `css.rule` | 許可されていない要素・属性・URL・CSS の書き方（下の制約） |
| `external.blocked` | `"block"` の設定の HTML / CSS の外部 URL（印刷屋が除くので帳票に出ない）。添付ファイルの `#{&f(…)}` か `data:image/` にする |
| `externalRefs.unapproved` / `externalRefs.value` | `"allow"`（キーが無い既存の設定も）は利用者の承認（policy の `allowExternalRefs`）が要る。AI は policy を書かず利用者に頼む。値は `block` か `allow` |
| `font.url` | Web フォントの `cssUrl` が https でない |
| `size` | 保存値が 256 KB を超えた。data URL の画像を小さくするか添付ファイルにする |

| 警告（消さずに利用者に伝える） | 意味 |
| --- | --- |
| `html.rawExpression` | `${式}` が文字列を `ESC_HTML` なしで差し込んでいる。新しく書いた式なら `${ESC_HTML(項目)}` に直す |
| `formula.escape` | 計算式の文字列に `\n` など。`\` は解釈されないので改行にならない。`NEWLINE()` に直す |
| `formula.rawHtml` | 生の HTML を入れる関数（`TABLE_HTML`、`FVAL` など）。想定どおりなら伝えるだけ |
| `formula.attr` / `formula.html` | 要素名・属性にレコードの値や式を入れている、計算式の文字列の HTML / CSS の危険な書き方 |
| `preview.record` | 設定が使う項目がプレビューのレコードに無い（帳票では空になる）。`record --app N --id R --fields-from <この設定>` で取り直す |
| `external.url` / `external.blocked` | `"allow"` の設定の未承認の外部 URL（承認は利用者が policy の `allowExternal` に書く）/ 計算式の文字列の外部 URL（帳票に入れば除かれる） |
| その他（`tags.rows`、`tags.pageSize`、`envelope.appId`、`fields.baseUrl`、`html.rule`） | 帳票の行が無い、設定画面の候補に無い用紙、appId が fields と違う、fields の接続先が `.env` と違う、HTML の注意 |

`[情報]`（保存値の大きさ、保存先なし、`externalRefs.legacy` など）は要るときだけ伝える。

## 制約（守らないと動かない・壊れる）

- **封筒なし（素の設定だけ）の JSON は誤り。** `pluginID` / `PluginVersion` が違うとインポートできない・tools が止まる
- HTML 設定の行は 1 行目 `$out`（ボタン表示条件。計算式が空か `state: false` なら常に出す）、2 行目 `$fname`（ファイル名）、3 行目以降が帳票（上から連結）。`<div class="rex0220-pcraft-page">…</div>` が 1 ページ（用紙に固定。はみ出しは切れる。長い表は `TABLE_HTML` の `pagination`）
- `${式}` は**エスケープされない**。文字列は `${ESC_HTML(項目)}`、金額や日付は `${FVAL(項目)}` / `${DATE_FORMAT(項目, "YYYY年M月D日")}`、複数行は `${REPLACE(ESC_HTML(項目), NEWLINE(), "<br>")}`
- 計算式の文字列は `\` を解釈しない（`"\n"` は改行でなく `\` と `n` の 2 文字）。改行は `NEWLINE()`
- 計算式の文字列の中に `//` を書かない（`"https://…"` など）
- **`${式}` を属性値の中に置かない**（`src` / `href` / `style` / `title` / `class` …。`ESC_HTML` は引用符を逃がさない）。計算式で `ATTR("…", 項目)` のようにレコードの値を属性に入れない
- `HTML()` / `FVAL()` / `TABLE_HTML()` / `RECS_HTML()` / `FIELDS_HTML()` / `ADD_TAGS()` はレコードの値を生の HTML として入れる。使うときは利用者にその旨を伝える。`${ESC_HTML(項目)} & HTML(…)` のように `&` でつないだ式も生の HTML
- HTML は**許可された要素と属性だけ**（文章・表・画像の要素。`class` `id` `style` `title` `colspan` `src` `alt` `width` `height` `data-*` など）。`<script>` `<object>` `<embed>` `<link>` `<base>` `<meta>` `<form>` 系、インラインの `<svg>` / `<math>`、`on*` 属性、`javascript:` の URL は使えない。図は `<img src="data:image/svg+xml,…">` か添付ファイルの `#{&f(…)}`。CSS の `@import` / `expression(` も使えない
- **外部参照**（ルートの `externalRefs`）: 新しい設定は `"block"`（印刷屋 Ver.6 が描画の前に kintone 以外への読み込みとスクリプトを除く）で、その HTML / CSS に外部の URL を書かない。`"allow"`（何も除かない。自己責任）と、キーが無い既存の設定（印刷屋は許可で動く）は利用者の承認（`policy/authoring-policy.json` の `allowExternalRefs`）が要る。外部の URL の承認は `allowExternal`。**AI は policy/ を書かない**。Google Fonts は承認済み
- 更新項目（`calcInfo`）は更新できる型だけ（文字列、数値、日付、日時、時刻、選択系、ユーザー / 組織 / グループ選択、リンク）。計算項目・ルックアップのコピー先・テーブルの中は不可。使う行だけ書く
- 一覧帳票（`list: true`）は PDF のダウンロードだけ（`filecode` は空）、`printMode` は効かない、`RECS_HTML` を使う。1 レコードの `preview` では確認できないので印刷屋で見る
- `viewsCsv` が空なら詳細画面とすべての一覧に出る（一覧帳票でないボタンは、一覧では 1 件ずつ PDF にする一括処理）。詳細画面だけなら `"-"`
- 一覧 ID（`viewsCsv`）、権限のユーザー / 組織 / グループのコード、ゲストのメールアドレス、他アプリの画像の fileKey は**推測しない**。利用者に聞く
- 画像を data URL で埋め込むと保存値（256 KB）を圧迫する。社印程度の小さな SVG にとどめ、写真は添付ファイル + `#{&f(…)}`

## 使えるもの（積極的に使ってよい）

- `TABLE_HTML(テーブル, OPT("pref","pcraft-inv-item-"), ARRAY("#", ROWNO(テーブル)+1), 商品名, 数量, 単価, 金額)` — テーブルを表に。`OPT("pagination","Y","perPage","20")` で複数ページ、`OPT("type","card")` でカード形式
- `LET(table, TABLE_HTML(…), REPLACE($html, "##table##", table))` — HTML テンプレートの目印を計算式で置き換える形
- `FIELDS_HTML(項目, …)` — 項目をラベル付きで縦に並べるカード
- 共通 CSS の既定の class: `pcraft-table-*`（表）、`pcraft-card-*`（カード）、`pcraft-inv-*`（見積書・請求書）
- 置き換えタグ `#{&p}` / `#{&n}`（ページ番号）、`#{&f(fileKey)}`（添付ファイルの画像）、`#{&q(文字列)}`（QR）
- Web フォント: `fontInfo`（`enabled`、`preset`、`family`、`cssUrl`）。Google Fonts の URL は承認済み。PC・Mac・スマホで同じ字形にしたいときだけ
  - スマホの詳細画面のボタンは Web フォントが有効なとき（`enabled` が真で、`family` と https の `cssUrl` が正しい）だけ出る。スマホでも使う帳票なら有効にする
- 「ボタンを押したとき」 `printMode`: `preview`（既定）/ `confirm` / `direct`
- 多言語のボタン名 `menu_en` / `menu_zh`、説明 `desc_*`
  - 説明（`desc`）はプレビューの見出しに 24px の太字で出る。**16 文字前後の 1 行**にする（例「ご提案書の PDF を作ります」。英語の `desc_en` は 32 文字前後）。長いと折り返して見出しの右の表示と重なる。帳票の中身の説明は書かない
- 計算式の `//` コメント（`formulaSet` に書ける。tools が除いた `formula` を作る）

## このリポジトリのルール

- 封筒形式で出力する。`settings/` は固定名で上書きし、履歴は git で追う
- **kintone への書き込みは行わない。** kintone MCP の書き込みツールと `kintone-download-file` は使わない（`.claude/settings.json` で拒否してある）。tools も GET しか送らない
- `records/` と `out/` はレコードの値を含む。コミットしない（`.gitignore` 済み）。作業が終わったら消してよい
- 認証情報（`.env`）をファイルやチャットに書かない。`policy/` と `.env` を AI が編集しない
- tools は `.env` の `PCRAFT_PLUGIN_ZIP`（印刷屋プラグインの zip）から計算式エンジンと印刷屋のコードを読む。「印刷屋の zip の場所が分からない」「版 … には対応していない」「zip の中身が tools の既知の一覧と違う」と出たら、利用者に zip の場所と版（アプリに入れたものと同じ。配布元から入手したもの）を確かめてもらう。`PCRAFT_ALLOW_UNKNOWN_PLUGIN` を AI が書いたり勧めたりしない
- tools が読むファイルは作業フォルダーの中、書く先は `fields/` `records/` `settings/` `temp/` `out/` `kintone/` の下だけ。`docs/samples/` は読める（`normalize … --dry-run` / `--check`、`--out temp/<名前>.json`、`preview`、`buttons`）が書き戻せないので、元にするときは `settings/` にコピーするか `--out` で `settings/` か `temp/` に出す
