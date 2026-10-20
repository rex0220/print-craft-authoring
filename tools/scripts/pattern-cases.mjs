/**
 * 計算パターン（docs/計算パターン.md）の例を、お試しアプリ formula-sample（計算式サンプル）に項目を足し、架空の値のレコードで評価する検証ケース
 * （print-craft の docs/authoring-try-plan.md T5。formula-authoring の tools/scripts/pattern-cases.mjs の帳票でも使う節を写した）。
 * scripts/verify-patterns.mjs が try と同じ評価（evaluateTryFormulas）で評価して docs/計算パターン_検証.md を作る。test/patterns.test.mjs が「生成物が最新」と「全部一致」を確かめる。
 *   - 1 ケース = 架空の値のレコード（data。土台はレコード 3 = 空）と式。fields は formula-sample に足す項目（{ code, type }。テーブルの外だけ）
 *   - expect はレコードごとの、帳票の ${…} に差し込む文字（エンジンの値を String にしたもの。空は ""）
 *   - note は検証の文書に添える説明。値はすべて架空（実在の人・組織・取引先・連絡先を入れない）
 */

const T1_ROWS = [{ T1_数値: 100, T1_文字列: "a", T1_ドロップダウン: "B" }, { T1_数値: 200, T1_文字列: "b", T1_ドロップダウン: "A" }, { T1_数値: 300, T1_文字列: "c", T1_ドロップダウン: "A" }];
const ERA_STARTS = 'IFS(fDate >= "2019-05-01", "2019-01-01", fDate >= "1989-01-08", "1989-01-01", fDate >= "1926-12-25", "1926-01-01", fDate >= "1912-07-30", "1912-01-01", fDate >= "1868-01-25", "1868-01-01", "")';
const ERA_NAMES = 'IFS(fDate >= "2019-05-01", "令和", fDate >= "1989-01-08", "平成", fDate >= "1926-12-25", "昭和", fDate >= "1912-07-30", "大正", fDate >= "1868-01-25", "明治", "")';

export const PATTERN_CASES = [
  // ---- 帳票に差し込む ----
  {
    section: "帳票に差し込む", pattern: "文字列・複数行・金額", fields: [{ code: "備考", type: "MULTI_LINE_TEXT" }],
    data: [{ 文字列1: "株式会社<テスト>", 備考: "1 行目\n2 行目 & 3", 数値1: 1234.567 }, { 文字列1: "", 備考: "", 数値1: "" }],
    formulas: [
      { formula: "ESC_HTML(文字列1)", expect: ["株式会社&lt;テスト&gt;", ""], note: "文字列は ESC_HTML（< > & をエスケープ）" },
      { formula: 'REPLACE(ESC_HTML(備考), NEWLINE(), "<br>")', expect: ["1 行目<br>2 行目 &amp; 3", ""], note: "複数行は ESC_HTML してから改行を <br> に" },
      { formula: "YEN(数値1)", expect: ["\\1,234.567", ""], note: "YEN は \\ 付きの桁区切り。印刷屋が帳票の \\ を &yen; に置き換えるので ¥ に見える。空は空" },
      { formula: "YEN(数値1, 0)", expect: ["\\1,235", ""], note: "2 つ目の引数で小数の桁数（四捨五入）" }
    ]
  },
  {
    section: "帳票に差し込む", pattern: "日付・日時・時刻の項目をそのまま書くと",
    data: [{ 日付1: "2026-01-15", 日時1: "2026-01-15T00:30:00Z", 時刻1: "09:30" }, { 日付1: "", 日時1: "", 時刻1: "" }],
    formulas: [
      { formula: "日付1", expect: ["1768402800", ""], note: "日付の項目をそのまま書くと数（epoch 秒。タイムゾーンで変わる）。DATE_FORMAT か FVAL で" },
      { formula: "DATE_FORMAT(日付1)", expect: ["2026-01-15", ""], note: "書式を省くと YYYY-MM-DD" },
      { formula: "FVAL(日付1)", expect: ["2026-01-15", ""], note: "FVAL は項目の型の書式" },
      { formula: "日時1", expect: ["2026-01-15 09:30", ""], note: "日時の項目は YYYY-MM-DD HH:mm（タイムゾーンで）" },
      { formula: "時刻1", expect: ["09:30", ""] }
    ]
  },
  // ---- 空・比較・端数 ----
  {
    section: "空・比較・端数", pattern: "空の数値（計算は空のまま、比較は偽、空の判定）",
    data: [{ 数値1: "", 数値2: "" }, { 数値1: 0, 数値2: 0 }, { 数値1: 2.5, 数値2: "" }],
    formulas: [
      { formula: "数値1 + 1", expect: ["", "1", "3.5"], note: "空の数値を計算すると空のまま" },
      { formula: "NVL(数値1, 0) + 1", expect: ["1", "1", "3.5"] },
      { formula: "数値1 > 0", expect: ["false", "false", "true"], note: "空との比較は偽" },
      { formula: 'IF(数値1, "あり", "なし")', expect: ["なし", "なし", "あり"], note: "IF(項目, …) は 0 も偽" },
      { formula: '数値1 = ""', expect: ["true", "true", "false"], note: "数値の 0 も = \"\" で真" },
      { formula: "ISBLANK(数値1)", expect: ["true", "false", "false"], note: "空だけを見分けるなら ISBLANK" },
      { formula: "ISBLANK(数値1, 数値2)", expect: ["true", "false", "false"], note: "全部空で true" }
    ]
  },
  {
    section: "空・比較・端数", pattern: "ゼロ除算・比較の決まり", data: [{ 数値1: 10, 数値2: 0, 文字列1: "abc" }],
    formulas: [
      { formula: "数値1 / 数値2", expect: [""], note: "ゼロ除算は空（エラーにならない）" },
      { formula: '"2" > "10"', expect: ["false"], note: "両方が数に見えれば数として比べる" },
      { formula: '"2" > "10a"', expect: ["true"], note: "そうでなければ文字順" },
      { formula: "文字列1 * 1", expect: [""], note: "数でない文字に * 1 は空" }
    ]
  },
  {
    section: "空・比較・端数", pattern: "端数と小数（10 進で計算）", data: [{}],
    formulas: [
      { formula: 'ROUND(2.5) & "/" & ROUND(-2.5) & "/" & ROUNDDOWN(-2.5) & "/" & ROUNDUP(-2.5) & "/" & INT(-2.5)', expect: ["3/-3/-2/-3/-3"], note: "ROUND と ROUNDUP は 0 から遠い方、ROUNDDOWN は 0 へ、INT は小さい方へ" },
      { formula: "MOD(-7, 3)", expect: ["-1"], note: "MOD の符号は割られる数" },
      { formula: 'ROUND(1.005, 2) & "/" & (0.1 + 0.2)', expect: ["1.01/0.3"], note: "10 進で計算" },
      { formula: "1 / 3 * 3", expect: ["0.99999999999999999999"], note: "割り切れない値は 20 桁。割った後は ROUND" },
      { formula: "ROUNDDOWN(12345 * 0.1)", expect: ["1234"], note: "消費税の切り捨て" }
    ]
  },
  // ---- 日付・時刻 ----
  {
    section: "日付・時刻", pattern: "曜日（英語の略と日本語、休日の判定）", data: [{ 日付1: "2026-10-18" }, { 日付1: "2026-10-19" }, { 日付1: "" }],
    formulas: [
      { formula: 'DATE_FORMAT(日付1, "ddd")', expect: ["Sun", "Mon", ""], note: "曜日の名前は英語" },
      { formula: 'IF(日付1, ARRAY_GET(ARRAY("日", "月", "火", "水", "木", "金", "土"), DATE_FORMAT(日付1, "d") * 1), "")', expect: ["日", "月", ""], note: "\"d\" は 0（日曜）〜6。空は分ける" },
      { formula: 'IF(日付1, DATE_FORMAT(日付1, "YYYY年M月D日") & "（" & ARRAY_GET(ARRAY("日", "月", "火", "水", "木", "金", "土"), DATE_FORMAT(日付1, "d") * 1) & "）", "")', expect: ["2026年10月18日（日）", "2026年10月19日（月）", ""] },
      { formula: 'IF(日付1, IF(IN(DATE_FORMAT(日付1, "d") * 1, 0, 6), "休日", "平日"), "")', expect: ["休日", "平日", ""] }
    ]
  },
  {
    section: "日付・時刻", pattern: "年度（4 月始まり）と和暦",
    data: [{ 日付1: "2026-10-18" }, { 日付1: "2026-03-31" }, { 日付1: "2019-04-30" }, { 日付1: "2019-05-01" }, { 日付1: "" }],
    formulas: [
      { formula: 'FISCAL_YEAR(日付1, "04-01")', expect: ["2026", "2025", "2019", "2019", ""], note: "年度の始まりは月日で指定" },
      {
        formula: `LET(fDate, DATE_FORMAT(日付1), eDate, ${ERA_STARTS}, gengo, ${ERA_NAMES}, IF(eDate, gengo & (DATE_DIFF(eDate, fDate, "years") + 1) & "年", ""))`,
        expect: ["令和8年", "令和8年", "平成31年", "令和1年", ""], note: "formula の計算パターンと同じ式（記事 9f8eb7607fec4f22060a）。元号の開始日以上で判定、年は開始年の 1 月 1 日との差 + 1"
      },
      {
        formula: `LET(fDate, DATE_FORMAT(日付1), eDate, ${ERA_STARTS}, gengo, ${ERA_NAMES}, y, DATE_DIFF(eDate, fDate, "years") + 1, IF(eDate, gengo & IF(y = 1, "元", y) & "年" & DATE_FORMAT(日付1, "M月D日"), ""))`,
        expect: ["令和8年10月18日", "令和8年3月31日", "平成31年4月30日", "令和元年5月1日", ""], note: "帳票の日付の形（元年、月日まで）"
      }
    ]
  },
  {
    section: "日付・時刻", pattern: "日付の書式・加算・差（支払期限など）",
    data: [{ 日付1: "2026-01-31", 日付2: "2026-03-01" }, { 日付1: "2027-12-15" }, { 日付1: "2028-01-31" }, { 日付1: "" }],
    formulas: [
      { formula: 'DATE_FORMAT(日付1, "YYYY/MM/DD")', expect: ["2026/01/31", "2027/12/15", "2028/01/31", ""] },
      { formula: 'DATE_FORMAT(DATE_ENDOF(DATE_ADD(日付1, 1, "month"), "month"), "YYYY年M月D日")', expect: ["2026年2月28日", "2028年1月31日", "2028年2月29日", ""], note: "翌月末日（1 か月足してから月末。年またぎ、うるう年、空）" },
      { formula: 'DATE_FORMAT(DATE_STARTOF(DATE_ADD(日付1, 1, "month"), "month"))', expect: ["2026-02-01", "2028-01-01", "2028-02-01", ""], note: "翌月初" },
      { formula: 'DATE_ADD(日付1, 30, "days")', expect: ["2026-03-02", "2028-01-14", "2028-03-01", ""], note: "30 日後。DATE_ADD などの結果は YYYY-MM-DD（日付の項目そのものと違い、数にならない）" },
      { formula: 'DATE_DIFF(日付1, 日付2, "days")', expect: ["29", "-21166", "-21213", "0"], note: "（前, 後）の順。空の日付は 1970-01-01 として数えられる（両方空なら 0）" },
      { formula: 'IF(AND(日付1, 日付2), DATE_DIFF(日付1, 日付2, "days"), "")', expect: ["29", "", "", ""], note: "空を分けた形" }
    ]
  },
  {
    section: "日付・時刻", pattern: "時刻項目の差（勤務時間など。日をまたぐとき）",
    data: [{ 時刻1: "09:30", 時刻2: "18:15" }, { 時刻1: "22:00", 時刻2: "06:00" }, { 時刻1: "", 時刻2: "" }],
    formulas: [
      { formula: 'DATE_DIFF(時刻1, 時刻2, "minutes")', expect: ["NaN", "NaN", "0"], note: "時刻の項目を DATE_DIFF に渡すと NaN（日付が無い）" },
      { formula: 'MOD(DURATION_AS(時刻2, "minutes") - DURATION_AS(時刻1, "minutes") + 1440, 1440)', expect: ["525", "480", "0"], note: "DURATION_AS で分に。日をまたぐなら 1440 を足して MOD。空は 0 になるので IF で分ける" },
      { formula: 'DURATION_FORMAT(DURATION(MOD(DURATION_AS(時刻2, "minutes") - DURATION_AS(時刻1, "minutes") + 1440, 1440), "minutes"), "%H時間 @m分")', expect: ["8時間 45分", "8時間 0分", "0時間 0分"] }
    ]
  },
  {
    section: "日付・時刻", pattern: "日時の表示はタイムゾーンで変わる", data: [{ 日時1: "2026-10-18T09:30:00Z" }],
    formulas: [
      { formula: 'DATE_FORMAT(日時1, "YYYY-MM-DD HH:mm")', expect: ["2026-10-18 18:30"], note: "既定はタイムゾーン（検証は Asia/Tokyo。PDF は作る PC のタイムゾーン）" },
      { formula: 'DATE_FORMAT(日時1, "YYYY-MM-DD HH:mm", "UTC")', expect: ["2026-10-18 09:30"], note: "3 つ目の引数でタイムゾーン" },
      { formula: 'DATE_FORMAT(日時1, "YYYY年M月D日 H時m分", "Asia/Tokyo")', expect: ["2026年10月18日 18時30分"], note: "PDF を作る PC のタイムゾーンに依らず日本時間で" }
    ]
  },
  // ---- 値・文字列 ----
  {
    section: "値・文字列", pattern: "条件で値を変える", data: [{ ドロップダウン1: "A", 数値1: 5 }, { ドロップダウン1: "B", 数値1: 5 }, { ドロップダウン1: "C", 数値1: 5 }],
    formulas: [
      { formula: 'IF(ドロップダウン1 = "A", 数値1, "")', expect: ["5", "", ""] },
      { formula: 'SWITCH(ドロップダウン1, "A", 1, "B", 2, 0)', expect: ["1", "2", "0"] },
      { formula: 'IN(ドロップダウン1, "A", "B")', expect: ["true", "true", "false"] },
      { formula: 'IFS(ドロップダウン1 = "A", "甲", ドロップダウン1 = "B", "乙", "他")', expect: ["甲", "乙", "他"] }
    ]
  },
  {
    section: "値・文字列", pattern: "空のときの既定", data: [{ テーブル1: T1_ROWS }, { テーブル1: [] }],
    formulas: [
      { formula: "SUMIF(T1_数値 > 1000, T1_数値)", expect: ["0", "0"], note: "SUMIF は該当なしで 0" },
      { formula: "LASTIF(T1_数値 > 1000, T1_数値)", expect: ["", ""], note: "LASTIF は該当なしで空" },
      { formula: "NVL(LASTIF(T1_数値 > 1000, T1_数値), 0)", expect: ["0", "0"] }
    ]
  },
  {
    section: "値・文字列", pattern: "選択した値・名前を文字列にする（ユーザー・組織、チェックボックス・複数選択）", fields: [{ code: "担当者", type: "USER_SELECT" }],
    data: [{ 担当者: ["demo_user02", "demo_user03"], 組織1: ["demo_hq", "demo_sales"], チェック1: ["A", "C"], 複数選択1: ["B", "C"], 作業者: ["demo_user04"] }, { 担当者: [], チェック1: [] }],
    formulas: [
      { formula: "担当者", expect: ["架空 営業部長, 架空 開発部長", ""], note: "名前を「, 」（カンマと空白）で" },
      { formula: "組織1", expect: ["架空本社, 架空営業部", ""] },
      { formula: 'SEL_NAME(担当者, "text", "、")', expect: ["架空 営業部長、架空 開発部長", ""] },
      { formula: 'SEL_NAME(担当者, "text", "<br>")', expect: ["架空 営業部長<br>架空 開発部長", ""], note: "帳票で改行して並べる" },
      { formula: 'SEL_CODE(担当者, "text")', expect: ["demo_user02,demo_user03", ""] },
      { formula: "チェック1", expect: ["A,C", ""], note: "値を「,」で" },
      { formula: 'JOIN(チェック1, "、")', expect: ["A、C", ""] },
      { formula: "複数選択1", expect: ["B,C", ""] },
      { formula: 'SEL_NAME(作業者, "text")', expect: ["架空 営業一郎", ""] }
    ]
  },
  {
    section: "値・文字列", pattern: "テーブルの文字列を 1 つにまとめる",
    data: [{ テーブル1: [{ T1_文字列: "りんご" }, { T1_文字列: "" }, { T1_文字列: "みかん" }, { T1_文字列: "りんご" }] }, { テーブル1: [] }],
    formulas: [
      { formula: 'JOIN(TARRAYIF(T1_文字列 <> "", T1_文字列), "、")', expect: ["りんご、みかん、りんご", ""], note: "空の行を除き、順はそのまま、末尾に区切りは付かない" },
      { formula: "CONCAT(T1_文字列)", expect: ["りんごみかんりんご", ""] },
      { formula: 'CONCAT(T1_文字列, "、")', expect: ["りんご、、みかん、りんご、", ""], note: "区切りは各行の後ろ（最後にも）。空の行は空のまま" },
      { formula: 'JOIN(TDS(T1_文字列), "、")', expect: ["みかん、りんご", ""], note: "重複を除いて並べ替える" },
      { formula: 'TEXTJOIN("、", 1, T1_文字列)', expect: ["りんご", ""], note: "テーブルの列には使えない（1 行目だけ）" }
    ]
  },
  {
    section: "値・文字列", pattern: "文字をつなぐ・変数で式を短く", data: [{ 数値1: 5, テーブル1: T1_ROWS }, { 数値1: "" }],
    formulas: [
      { formula: '"合計 " & SUM(T1_数値) & " 円（" & COUNTROW(テーブル1) & " 行）"', expect: ["合計 600 円（3 行）", "合計 0 円（0 行）"] },
      { formula: '"sun" & IF(数値1, " today", "")', expect: ["suntoday", "sun"], note: "& は関数の結果の前後の空白を落とす" },
      { formula: 'IF(数値1, "sun today", "sun")', expect: ["sun today", "sun"], note: "空白ごと返すなら全体を 1 つの文字列に" },
      { formula: "LET(x, 数値1 * 2, y, x + 1, y)", expect: ["11", ""], note: "1 つの LET に変数を並べる。後の式で前の変数を使える" }
    ]
  },
  {
    section: "値・文字列", pattern: "長さ・切り出し・検索（位置の数え方に注意）", data: [{ 文字列2: "東京都千代田区" }],
    formulas: [
      { formula: 'LENGTH(文字列2) & "/" & LEFT(文字列2, 3) & "/" & RIGHT(文字列2, 3)', expect: ["7/東京都/代田区"], note: "長さは LENGTH（LEN は無い）" },
      { formula: 'MID(文字列2, 3, 4) & "/" & SUBSTR(文字列2, 3, 4)', expect: ["都千代田/千代田区"], note: "MID の位置は 1 から、SUBSTR は 0 から" },
      { formula: 'FIND(文字列2, "千代田") & "/" & FIND(文字列2, "大阪") & "/" & TEST(文字列2, "千代田")', expect: ["3/-1/true"], note: "FIND は 0 から数えた位置、無ければ -1。TEST は文字の有無（正規表現ではない）" }
    ]
  },
  {
    section: "値・文字列", pattern: "全角半角・空白・ゼロ埋め・分割・置換", data: [{ 文字列1: " ＡＢＣ-123-ｱｲｳ ", 文字列2: "(株)甲 （株）乙", 数値1: 42 }],
    formulas: [
      { formula: 'ASC(文字列1) & "|" & JIS(文字列1)', expect: ["ABC-123-ｱｲｳ|ＡＢＣ－１２３－アイウ"], note: "ASC は全角 → 半角、JIS は半角 → 全角" },
      { formula: 'TRIM(文字列1) & "|" & UPPER("abc") & "|" & LOWER("ABC")', expect: ["ＡＢＣ-123-ｱｲｳ|ABC|abc"] },
      { formula: 'RIGHT("0000" & 数値1, 4)', expect: ["0042"], note: "ゼロ埋めは 0 を足して右から取る" },
      { formula: 'ARRAY_GET(SPLIT(TRIM(文字列1), "-"), 1)', expect: ["123"], note: "SPLIT で配列にして ARRAY_GET（0 から）" },
      { formula: 'REPLACEALL(文字列2, ARRAY("(株)", "株式会社", "（株）", "株式会社"))', expect: ["株式会社甲 株式会社乙"], note: "置換の組を並べる" }
    ]
  },
  {
    section: "値・文字列", pattern: "正規表現（形の検査・取り出し・置換）",
    fields: [{ code: "郵便番号", type: "SINGLE_LINE_TEXT" }, { code: "電話番号", type: "SINGLE_LINE_TEXT" }, { code: "備考", type: "SINGLE_LINE_TEXT" }],
    data: [{ 郵便番号: "100-0005", 電話番号: "03-1234-5678", 備考: "注文番号 A-1023 と A-2048、至急" }, { 郵便番号: "1000005", 電話番号: "０３－１２３４－５６７８", 備考: "番号なし" }, { 郵便番号: "", 電話番号: "", 備考: "" }],
    formulas: [
      { formula: 'TESTRE(郵便番号, "^[0-9]{3}-[0-9]{4}$")', expect: ["true", "false", "false"], note: "true / false。空も false なので空を先に分ける" },
      { formula: 'MATCH(備考, "A-[0-9]+")', expect: ["A-1023", "", ""], note: "最初の 1 つ。無ければ空" },
      { formula: 'JOIN(MATCH(備考, "A-[0-9]+", "g"), "、")', expect: ["A-1023、A-2048", "", ""], note: "\"g\" で全部を配列に" },
      { formula: 'REPLACERE(ASC(電話番号), "-", "g", "")', expect: ["0312345678", "0312345678", ""], note: "\"g\" で全部。全角は ASC で半角に" },
      { formula: 'REPLACERE(電話番号, "-", "")', expect: ["031234-5678", "０３－１２３４－５６７８", ""], note: "\"g\" が無いと最初の 1 つだけ" }
    ]
  },
  // ---- 大きい帳票の式（印刷屋 Ver.9） ----
  {
    section: "大きい帳票の式（印刷屋 Ver.9）", pattern: "置換の組の配列（入れ子の REPLACERE を 1 回に）", data: [{ 文字列1: "(株)甲 （株）乙" }],
    formulas: [
      { formula: 'REPLACERE("a-b c-d", ARRAY("-", "_", "\\s", ""), "g")', expect: ["a_bc_d"], note: "先頭の組から順に置換（入れ子と同じ）。flag は全部の組に共通" },
      { formula: 'REPLACERE(REPLACERE("a-b c-d", "-", "g", "_"), "\\s", "g", "")', expect: ["a_bc_d"], note: "同じ結果の入れ子の形" },
      { formula: 'REPLACERE("a-b-c", ARRAY("-", "_"))', expect: ["a_b-c"], note: "flag を省くと、どの組も最初の 1 つだけ" },
      { formula: 'REPLACEALL(文字列1, ARRAY("(株)", "株式会社", "（株）", "株式会社"))', expect: ["株式会社甲 株式会社乙"], note: "REPLACEALL も同じ（正規表現ではない）" }
    ]
  },
  {
    section: "大きい帳票の式（印刷屋 Ver.9）", pattern: "ループで前の回の結果を使う（LET の変数を FSET で書き換える）", data: [{}],
    formulas: [
      { formula: 'LET(s, "x", a, ARRAY_FOR(3, k, FSET(s, CONCAT(s, k))), s)', expect: ["x012"], note: "ループの前の LET で決めた変数は、ループの中の FSET で書き換えられ、次の回で読める" },
      { formula: 'LET(s, 0, t, "", a, ARRAY_FOR(4, k, ARRAY(FSET(s, s + k), FSET(t, CONCAT(t, s, ",")))), t)', expect: ["0,1,3,6,"], note: "1 回に複数の FSET は ARRAY(…) に並べる（前から順に 1 回ずつ）。Ver.9 では 0 が 0 のまま" }
    ]
  }
];
