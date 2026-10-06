# AI による印刷屋プラグイン設定オーサリング手順（利用者向け）

Claude Code（VSCode）と kintone 公式 MCP、tools（`pcraft-authoring`）で、印刷屋プラグイン Ver.6 の設定 JSON を作る・変えるときの、利用者がすることの手順です。
AI の作業手順と規則（読む文書、コマンドの使い方、normalize のエラーの規則名と直し方）は `CLAUDE.md` にあり、このリポジトリを開いた Claude Code が自動で読みます。セットアップは `README.md`。

## 1. 全体像

| 役割 | 何をするか |
| --- | --- |
| 利用者 | 要件を書く（アプリ番号、帳票の内容、保存先、見た目）。プレビューと差分を見る。インポートして反映する。外部 URL を承認する |
| AI（Claude Code） | 項目定義とレコードを確かめ、HTML / CSS / 計算式を組み、封筒形式の JSON を書き、tools で検査・プレビューし、反映手順を伝える |
| kintone MCP（`@kintone/mcp-server`） | AI の探索（アプリ一覧、アプリ情報、項目定義、レイアウト、レコード）。読み取りだけ許可 |
| tools（`pcraft-authoring`） | `fields` / `record`（GET で取ってファイルに）、`normalize`（派生値の生成と検査）、`preview`（帳票 HTML）、`diff`（差分）、`buttons` と `--summary`（要約） |

AI が書くのは設定 JSON と要件の整理だけで、kintone には何も書き込みません。反映は利用者が設定画面でインポートします。

## 2. 準備

### 2.1 MCP サーバーの登録（このリポジトリでは設定済み）

`.mcp.json` が kintone 公式 MCP を `node --env-file=.env node_modules/@kintone/mcp-server/dist/index.js` で起動します。認証は `.env` か OS の環境変数（`KINTONE_BASE_URL` と、`KINTONE_USERNAME` / `KINTONE_PASSWORD`、または `KINTONE_API_TOKEN`）。tools も同じ `.env` を読み、加えて `PCRAFT_PLUGIN_ZIP`（印刷屋プラグインの zip）から計算式エンジンと印刷屋の設定画面・帳票のコード（authoring API）を実行時に読みます。tools 自体にはそれらは入っていません。

### 2.2 read-only を担保する

- `.claude/settings.json` の `deny` に kintone MCP の書き込みツール全部（records の add / update / delete、update-statuses、add-record-comment、form-fields の add / update / delete、update-form-layout、update-general-settings、add-app、deploy-app、space の作成 / 更新）と `kintone-download-file` を並べてあります。`allow` は読み取りツールと、`settings/` `requirements/` `fields/` `records/` `out/` `temp/` への書き込み、`npx @rex0220/print-craft-authoring-tools …` の実行だけです
- tools の HTTP 層は GET 専用で、呼べる API は `/k/v1/app`、`/k/v1/app/form/fields`、`/k/v1/app/form/layout`、`/k/v1/record`（と preview 版）に固定しています
- 始めるときはログインユーザー（パスワード認証。2 要素認証なし）で足ります。サーバー側でも書き込めなくするなら、**閲覧権限だけのアカウント**か、**レコード閲覧だけの API トークン**（運用での推奨）を使います。ゲストスペースのアプリは MCP では見えません（tools の `--guest <spaceId>` は使えます）

### 2.3 疎通確認

```
npx @rex0220/print-craft-authoring-tools version
```

tools の版と、zip から読んだ印刷屋の版（6）・authoring API の版・計算式エンジンの SHA-256（既知）が出れば OK です。Claude Code に「kintone-get-app でアプリ 3740 を見て」（番号は自分のアプリ）→ アプリ名が返れば MCP も OK です。

## 3. 利用者がすること

### 新しい帳票

1. 要件を `requirements/` に書くか（例: `requirements/example.md`）、チャットで伝える。**アプリ番号**、保存先の添付ファイル項目、用紙と向き、ボタンを押したときの動き（プレビュー / 確認してから作成 / すぐに作成）を書くと早い
2. AI が項目のコードの対応（要件のラベル → フィールドコード）を示したら確かめる。似た項目の選び方を聞かれたら答える
3. AI が `out/<ボタン名>.html` を作ったら Chrome で開いて見た目を確かめる（近似。画像はダミー。Web フォントは承認済みの配信元だけ読む）。プレビュー用のレコードは、明細が複数行、備考に改行、添付あり、が揃うものがよい
4. AI が伝える**警告**を読む（生の HTML を入れる関数、外部 URL など）
5. 反映: アプリの設定 → プラグイン → 印刷屋プラグインの設定 → 設定をアップロード → `settings/` のファイル → 取り込み方を選ぶ → 保存する → 運用環境に反映 → 詳細画面でボタンを押して PDF を確かめる。保存先があれば添付ファイル項目に PDF が入る
   - 取り込み方（印刷屋 Ver.6）: 印刷屋の設定がまだ無いアプリは「全置換」。既存の設定があるアプリにボタンを足すなら「追加」（同じ名前があれば「名前 (2)」）、既存のボタンを差し替えるなら「一部置換」（ボタンごとに置き換え先を選ぶ）。一部置換と追加では、外部参照・Web フォント・メニュー・NOTE・説明・ゲストは今の設定のまま。ファイルに共通 CSS があるときは、共通 CSS を丸ごと置き換えるかをチェックで選ぶ（既定は置き換えない）
   - 取り込んだボタンにこのアプリで使えない設定（無い項目など）があると、保存のときにエラーになり保存されない

一覧帳票（`list: true`）は 1 レコードのプレビューでは確かめられないので、印刷屋の一覧画面で見てください。

### 既存の設定の変更

ボタンを足すだけなら、新しい帳票と同じく新しいファイルを作ってもらい、アップロードの「追加」で取り込めます（エクスポートは要りません）。既存のボタンを直すときは:

1. 設定画面で **設定をダウンロード** した JSON を `settings/` に置き、変えたいことを伝える。kintone の API ラボで「アプリに追加されているプラグインの設定情報を取得または更新するREST API」を有効にしている環境では、`npx @rex0220/print-craft-authoring-tools pull --app N` で今の設定を取れる（GET だけ。運用中の設定はレコード閲覧＋追加、`--preview` で保存して未反映の設定はアプリ管理の権限が要る。API ラボは開発を検討中の API なので、仕様が変わったり無くなったりすることがある）
2. AI が見せる `diff` の差分（HTML / CSS / 計算式）を確かめる
3. 上と同じ手順でアップロードして反映する（ファイル全体なら「全置換」、直したボタンだけなら「一部置換」）

### 開発と本番を分けるとき（environments.json）

開発用の環境（ドメイン）や開発用のアプリがあるときは、README の「開発と本番を分ける」のとおり `environments.json` と認証のファイル（`env/<名前>.env`）を用意します。

1. 設定画面でダウンロードしたファイルは名前を変えずに `inbox/` に置き、AI に「take して」と頼む（またはブラウザーのダウンロード先を `inbox/` にしておく）
2. AI は開発の環境のアプリで作り・直します。ダウンロードしたファイルは書き換えず、直したものは `…-edit.json` にできます
3. 開発のアプリにアップロードして確かめたら、同じファイルを本番のアプリにアップロードします（取り込み方は「追加」か「一部置換」。「別のアプリの設定です」の注意が出ますが取り込めます）。本番の今の設定は、本番でダウンロードして `inbox/` に置くか、`pull --env prod` で取れます
4. 一覧 ID はアプリごとに違うので、特定の一覧に出すボタンは、本番にアップロードした後に本番の設定画面で一覧を選び直します

### 利用者だけが書くもの

- `environments.json` と `env/`（開発と本番を分けるとき）: 環境、アプリの番号、認証。AI は書きません
- `policy/authoring-policy.json`: 外部参照を「許可」（`externalRefs: "allow"`）にする設定ファイル（`allowExternalRefs`）と、外部 URL の承認（`allowExternal`）。AI は書きません。書き方は `policy/README.md`
- `.env`: 接続先と認証、印刷屋の zip の場所

### tools の要約コマンド（利用者も使えます）

- `npx @rex0220/print-craft-authoring-tools buttons settings/<ファイル>.json` — 設定のボタン一覧。`--button <名前>` でそのボタンの HTML / CSS / 計算式
- `npx @rex0220/print-craft-authoring-tools fields --app N --summary` — 取得済みの項目定義を 1 項目 1 行で
- `npx @rex0220/print-craft-authoring-tools record --app N --id R --summary` — 取得済みのレコードの形（値は出しません）

## 4. AI への指示の例

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
settings/APP3740-見積書-見積書.json の見積書に、右上の自社情報の下に住所「〇〇県〇〇市…」と電話「TEL: 00-0000-0000」を足して。
```

ボタンの追加:
```
requirements/納品書.md の要件で、settings/APP3740-見積書.json に「納品書」のボタンを追加して。normalize と preview まで
```

一覧帳票:
```
アプリ 381（案件管理）の一覧画面に、表示中のレコードを表にした「案件一覧」ボタン（A4 横）を作って。顧客名・部署名・案件名・確度・プラン費用・オプション費用・合計費用。費用の合計欄も。
```

## 5. git 管理

- `settings/` は固定名で上書き。コミットメッセージに何を変えたかを書く
- `fields/` はコミットしてよい（項目定義。アプリの構造が入るので private）。`records/` と `out/` はコミットしない
- 設定画面で直した設定は、エクスポートして `settings/` に戻し `npx @rex0220/print-craft-authoring-tools normalize <ファイル> --fields fields/N.json --check --dry-run` で派生値が一致することを確かめてからコミット（git が正）
- `policy/authoring-policy.json` は利用者が編集してコミット

## 6. 確認済みの環境

- 印刷屋プラグイン Ver.6、tools 0.1.0、kintone 公式 MCP 1.8.2、Node 20 以上（開発は Node 24）
- Windows 11 の Claude Code（VSCode）。macOS でも手順は同じ（`.env` の置き方は README）
