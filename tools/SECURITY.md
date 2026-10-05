# セキュリティ（@rex0220/print-craft-authoring-tools と print-craft-authoring テンプレート）

## 脆弱性の報告

- GitHub リポジトリ [rex0220/print-craft-authoring](https://github.com/rex0220/print-craft-authoring) の **Security → Report a vulnerability**（非公開の報告）で知らせてください。公開の Issue には書かないでください
- 報告には、tools の版（`npx pcraft-authoring version`）、再現する設定 JSON（レコードの値と認証情報を除いたもの）、期待した動きを添えてください
- 対応するのは tools の最新の 6.x 系です。修正は新しい版として npm と GitHub に出し、`tools/README.md` の履歴に書きます

## 範囲

| 対象 | 報告先 |
| :--- | :--- |
| tools（`pcraft-authoring` の fields / record / pull / normalize / preview / diff / buttons / version）、テンプレート（CLAUDE.md、`.claude/settings.json`、`.mcp.json`、docs） | このリポジトリ |
| 印刷屋プラグイン本体（zip の中の計算式エンジン、設定画面、帳票の生成） | 印刷屋プラグインの配布元（製品紹介: https://qiita.com/rex0220/items/9be2d9b20a3a1f016c76 ） |
| kintone 公式 MCP サーバー（`@kintone/mcp-server`） | [kintone/mcp-server](https://github.com/kintone/mcp-server) |

## 前提（信頼の境界）

- テンプレートでは AI（Claude Code）が `npx pcraft-authoring …` を確認なしに実行でき、`settings/` `fields/` `records/` `out/` `temp/` に書けます。AI は `.env` と `policy/` を書けません（`.claude/settings.json`）。tools はこの前提で、**AI が書けるファイルを認証情報・承認・実行コードとして読まない**ように作ってあります
- 利用者が置く印刷屋プラグインの zip の中のコード（計算式エンジン、設定画面・帳票のコード）は、tools を動かした **OS ユーザーと同じ権限の Node のプロセスで実行**されます。happy-dom の window は DOM の代用で、セキュリティの境界（sandbox）ではありません

## tools が守ること

- **kintone には GET しか送らない。** 呼べる API は `app`、`app/form/fields`、`app/form/layout`、`record`、`app/plugin/config` と、その preview 版に固定している（ゲストスペースの `/k/guest/<id>/v1/` も同じ一覧）。それ以外のパスやメソッドは送信前に止まる。`app/plugin/config`（`pull`）は kintone の API ラボ「アプリに追加されているプラグインの設定情報を取得する」で、印刷屋のプラグイン ID（zip の公開鍵から）の設定だけを読む。同じ API ラボの設定の変更（PUT）は呼ばない。`pull` は運用中の設定にレコード閲覧＋レコード追加、`--preview` にアプリ管理の権限が要るので、使うときだけその権限のトークン（またはログインユーザー）にする
- **開発と本番（environments.json）でも、場所は CLI から指定できない。** `--env` で選べるのは `environments.json` の環境の名前だけで、認証のファイルの場所（`.env` か `env/<名前>.env` の形だけ）と接続先は `environments.json` に書く。テンプレートでは AI は `environments.json` と `env/` を書けない（`.claude/settings.json`）。このときの認証はその環境の認証のファイルだけから読み、OS の環境変数の `KINTONE_*` / `KSQL_*` は読まない（開発と本番の取り違えを防ぐ）。認証のファイルの `KINTONE_BASE_URL` が `environments.json` の接続先と違えば止まる。iframe の同一オリジンの判定には `environments.json` の接続先を使い、`kintone/<ホスト名>/` のフォルダー名（AI が作れる）は使わない
- **送信先は kintone のドメインだけ。** `KINTONE_BASE_URL` は `https://<サブドメイン>.cybozu.com` / `.kintone.com` / `.cybozu.cn`（`*.s.cybozu.com` を含む）だけを受け付け、ユーザー情報（`user@`）・ポート・パス・クエリが付いた URL は使わない。URL は `new URL(path, base)` で組み、送信直前にも origin が同じか確かめる
- **kintone 以外とは通信しない。** `normalize` / `preview` / `diff` / `buttons` / `version` と、`fields` / `record` の `--summary` はネットワークを使わない。利用状況の送信（テレメトリ）は無い
- **認証情報を出力しない。** `.env` または OS の環境変数から読み、API トークン・パスワード・ユーザー名は画面・ファイル・エラーの文言に出さない。エラーの文言は HTTP の状態と kintone のエラーコードと固定のヒントだけ（サーバーの message は出さない）。出すのは接続先の URL と「API トークン / ログインユーザー」の区別だけ
- **レコードの値を標準出力に出さない。** `record` は項目の数とテーブルの行数だけ表示し、値は `records/<app>-<id>.json` に書く（テンプレートの `.gitignore` でコミット対象外）。`--fields-from` で設定が使う項目だけに絞れる。`record --summary` も形（文字数・行数・数値の桁・件数・添付の種類）だけで、値・ファイル名・ユーザー名は出さない
- **印刷屋の zip の中身が既知でなければ実行しない（fail closed）。** 計算式エンジン、authoring API、bignumber、moment-timezone の 4 ファイルの SHA-256 が tools の既知のリリース（`src/meta.ts` の `KNOWN_PLUGIN_RELEASES`。4 つの組み合わせ単位）と一致し、zip の `manifest.json` の版が対応する版で、API の版と印刷屋の版と tools の版が合い、tools が使う API のキーと型がそろっているときだけ実行する。どれか違えば **コードを実行する前に止まる**。zip の読み取りでは、外側と中身の大きさ・entry の数・展開後の大きさの上限、central directory と local header の名前の一致、CRC-32、同名 entry の重複を確かめる（zip bomb と改変の対策）。新しい修正版の zip を使うなど、違いを理解した上で続けるときだけ、**利用者が** `.env` に `PCRAFT_ALLOW_UNKNOWN_PLUGIN=1` を書く（警告を出して続ける。AI は `.env` を書けない）。公開ビルド（npm の `dist/cli.mjs`）が読むのは `PCRAFT_PLUGIN_ZIP` の zip だけで、`node_modules` や隣のフォルダーのファイルは読まない（開発者がソースから動かし、環境変数 `PCRAFT_ALLOW_DEV_PLUGIN=1` を置いたときだけ、隣の print-craft の `prod/` を警告付きで読む）
- **印刷屋のコードを含まない。** エンジンと API は利用者の zip からメモリへ読むだけで、コピーや書き出しはしない。ビルドは、npm に入る `dist/cli.mjs` に印刷屋 / plugin-config-kit / rexgrid の実行コードが混ざっていないことを検査する
- **CLI が読む・書く場所を限る。** 読むのは作業フォルダーの中のファイルだけ（`.env` と `node_modules` は読まない）、書くのは `fields/` `records/` `settings/` `temp/` `out/` `kintone/` の下だけ（realpath で判定。junction / symlink で外へは出られない。Windows の予約名は使わない）。`.env`、`policy/authoring-policy.json`、印刷屋の zip の場所（`PCRAFT_PLUGIN_ZIP`）は作業フォルダーのものに固定で、`--env` / `--policy` / `--plugin-zip` のようなオプションは無い。iframe の同一オリジンの判定は `.env` の `KINTONE_BASE_URL` **だけ**を使い、AI が書き換えられる `fields/*.json` の値は使わない（`.env` に接続先が無ければ iframe は使えない）。パスの検査から書き込みまでの間にリンクが差し替えられる競合（TOCTOU）は残るが、AI と同じ OS ユーザーの範囲の話であり、この tools では防がない
- **`normalize` は許可した書き方だけ通す（allowlist）。** 要素は文章・表・画像の要素だけ、属性は共通の属性（class / id / style …）と要素ごとの属性（img の src / srcset / alt、td の colspan …）と `data-*` / `aria-*` だけで、一覧に無い要素・属性、`on*` 属性、インラインの `<svg>` / `<math>`、`<script>` `<object>` `<embed>` `<link>` `<base>` `<meta>` `<form>` 系、`<template>` などはエラー。URL は Chrome の URL パーサーと同じ前処理（タブ・改行・制御文字を捨てる、`\` は `/`）をしてから `https:` / `data:image/` / 置き換えタグ / 相対だけを通す（`a` の `href` は `data:` も不可、`iframe` は利用者の kintone と同じオリジンだけ）。CSS はコメントを外してエスケープを復号してから、`url()` / `image-set()` / `image()` / `src()` / `@import` の URL を分類し、`@import` / `expression(` / `behavior:` / `-moz-binding:` を止める。属性値の `${式}` はエラー。**kintone 以外への読み込みとスクリプトは印刷屋 Ver.6 が描画の前に除く**（共通の設定「外部参照」`externalRefs: "block"`。帳票の HTML / CSS を DOMParser で DOM 化して、外部へ向く URL 属性・CSS の `url()` / `@import`・`script` などの要素・`on*` 属性を外してから画面に入れる）ので、tools はそれを前提にする: `"block"` の設定の HTML / CSS のテンプレートにある外部 URL は**エラー**（帳票に出ない。添付ファイルか `data:image/` にする）。`"allow"`（Ver.5 と同じく何も除かない。自己責任。キーが無い Ver.5 の設定も印刷屋は `allow` で動くので tools も `allow` とみなす）は、利用者が AI の書けない `policy/authoring-policy.json` の `allowExternalRefs` にその設定ファイルを書いていなければ**エラー**。`allow` の設定の外部 URL と、外部参照の設定に関わらず Web フォント（印刷屋は除かない）は `allowExternal`（形を検証する）で承認し、承認済みは情報、無ければ**警告**。帳票の行の**計算式が作る HTML** は静的に追い切れない（計算式のインタープリターを tools に二重に持たない。Codex レビュー 5 回の結論）ので**警告だけ**: HTML を作る関数の使用、`TAG` の要素名や `ATTR` / `STYLE` / `BATTR` の値が定数でない、文字列の定数に HTML / CSS があれば HTML / CSS と同じ検査を警告として出す。`${式}` の安全判定は式全体で行い、`&` でつないだ項がすべて安全なときだけ警告しない。エラーがあれば書き戻さない
- **`preview` の HTML は閉じている。** 帳票は `sandbox=""` だけの iframe に `srcdoc` で入れ、外側と帳票の両方の文書に CSP（帳票は `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`）。CSS は `<` を CSS のエスケープ（`\3c`）にして `</style>` で文書を壊せないようにし、描いた DOM から `script` / `meta` / `link` / `form` 系 / `iframe` / `object` / `embed` / SVG のアニメーション要素と、`on*` 属性・`href`（文書内の `#` 以外）・`srcdoc` などを外す（レコードの値が `TABLE_HTML` などで HTML として入る経路があるため）。画像は印刷屋のダミー画像。Web フォントは、配信元が承認済み（Google Fonts は既定、他は `policy/authoring-policy.json` の `allowExternal`）のときだけ帳票の文書に `<link>` を入れ、CSP の `style-src` / `font-src` にその配信元（Google Fonts は `fonts.googleapis.com` と `fonts.gstatic.com`）を足す。これが preview の唯一の外部通信で、送るのは設定に書いた固定の URL だけ（レコードの値は入らない）。未承認なら読まない（OS の書体）。出力には**レコードの値が入る**ので `out/` はコミット対象外

## tools がしないこと（利用者が守ること）

- **zip は印刷屋プラグインの配布元から入手したものを使う。** 出所の分からない zip を `PCRAFT_PLUGIN_ZIP` に書かない。`PCRAFT_ALLOW_UNKNOWN_PLUGIN=1` は、tools の既知の一覧より新しい修正版の zip だと分かっているときだけ、理由を理解して書く（その zip のコードがこの PC の権限で動く）
- `normalize` は HTML / CSS / 計算式の**静的な**検査で、計算式の**実行結果**（レコードの値が HTML として差し込まれること、関数が組み立てる HTML）は見ない。`TABLE_HTML` などの生の HTML を入れる関数、`TAG` / `ATTR` / `STYLE`、ESC_HTML を通さない `${式}` は警告にとどまる。外部への読み込みとスクリプトを止めるのは印刷屋 Ver.6 の描画前の掃除（`externalRefs: "block"`）で、文章や表の崩れは防げない。`"allow"` の設定ではその掃除も無い（利用者の承認と責任）。**インポートする前に `diff` の差分を人が見る**
- preview の「承認した Web フォントの配信元以外と通信・遷移が起きない」ことは、CSP と sandbox と DOM からの除去の組み合わせで担保している。Chromium を自動で動かして確かめる試験はまだ無い（Chrome の DevTools の Network で確かめられる）
- kintone への書き込みは、テンプレートの `.claude/settings.json` が kintone MCP の書き込みツール 15 個と読み取り 3 個（検索・スペース・コメント）を拒否し、CLAUDE.md が禁じているが、最終的な担保は **レコード閲覧だけの API トークン**（サーバー側の権限）。設定・権限・API トークンの管理は利用者の責任
- `.env`（認証情報）はコミットしない。設定 JSON にはアプリ番号・項目コード・業務用語が入るので、設定を置くリポジトリは **private** にする。`records/` と `out/` は作業が終わったら消す
- 依存パッケージ（`happy-dom`、同梱の `moment`）の脆弱性は `npm audit` と新しい版への更新で対応する。第三者のソフトウェアの一覧は `THIRD_PARTY_NOTICES.md`
