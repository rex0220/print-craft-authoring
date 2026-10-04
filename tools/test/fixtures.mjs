/** テスト用の項目定義（/k/v1/app/form/fields の properties の形）、レイアウト、fields ファイル、AI が書く形の設定（Qiita の見積書HTML を既定の書き方に直したもの） */

export const FIELDS = {
  宛名: { type: "SINGLE_LINE_TEXT", code: "宛名", label: "宛名" },
  見積番号: { type: "SINGLE_LINE_TEXT", code: "見積番号", label: "見積番号" },
  見積日: { type: "DATE", code: "見積日", label: "見積日" },
  小計金額: { type: "NUMBER", code: "小計金額", label: "小計金額", unit: "¥", unitPosition: "BEFORE", digit: true },
  消費税: { type: "NUMBER", code: "消費税", label: "消費税", unit: "¥", unitPosition: "BEFORE", digit: true },
  合計金額: { type: "NUMBER", code: "合計金額", label: "合計金額", unit: "¥", unitPosition: "BEFORE", digit: true },
  備考: { type: "MULTI_LINE_TEXT", code: "備考", label: "備考" },
  担当者: { type: "USER_SELECT", code: "担当者", label: "担当者" },
  見積ファイル: { type: "FILE", code: "見積ファイル", label: "見積ファイル" },
  発行済み: { type: "CHECK_BOX", code: "発行済み", label: "発行済み", options: { 済: { label: "済", index: "0" } } },
  見積明細: {
    type: "SUBTABLE", code: "見積明細", label: "見積明細",
    fields: {
      商品名: { type: "SINGLE_LINE_TEXT", code: "商品名", label: "商品名" },
      数量: { type: "NUMBER", code: "数量", label: "数量", digit: true },
      単価: { type: "NUMBER", code: "単価", label: "単価", unit: "¥", unitPosition: "BEFORE", digit: true },
      金額: { type: "CALC", code: "金額", label: "金額", expression: "数量*単価", format: "NUMBER_DIGIT", unit: "¥", unitPosition: "BEFORE" }
    }
  }
};

export const LAYOUT = [
  { type: "ROW", fields: [{ type: "SINGLE_LINE_TEXT", code: "宛名" }, { type: "SINGLE_LINE_TEXT", code: "見積番号" }] },
  { type: "ROW", fields: [{ type: "DATE", code: "見積日" }, { type: "USER_SELECT", code: "担当者" }] },
  { type: "SUBTABLE", code: "見積明細", fields: [{ type: "SINGLE_LINE_TEXT", code: "商品名" }, { type: "NUMBER", code: "数量" }, { type: "NUMBER", code: "単価" }, { type: "CALC", code: "金額" }] },
  { type: "ROW", fields: [{ type: "NUMBER", code: "小計金額" }, { type: "NUMBER", code: "消費税" }, { type: "NUMBER", code: "合計金額" }] },
  { type: "GROUP", code: "グループ", layout: [{ type: "ROW", fields: [{ type: "MULTI_LINE_TEXT", code: "備考" }, { type: "CHECK_BOX", code: "発行済み" }] }] },
  { type: "ROW", fields: [{ type: "FILE", code: "見積ファイル" }, { type: "SPACER", elementId: "sp" }] }
];

export const FIELDS_FILE = {
  tool: "pcraft-authoring fields",
  fetchedAt: "2026-10-04T00:00:00.000Z",
  baseUrl: "https://x.cybozu.com",
  appId: 3740,
  appName: "見積書(印刷屋)",
  preview: false,
  lang: "ja",
  revision: "12",
  properties: FIELDS,
  layout: LAYOUT
};

export const HTML_TEMPLATE = `<div class="rex0220-pcraft-page">
  <div class="pcraft-inv-header">見積書</div>
  <div class="pcraft-inv-info">
    <div class="pcraft-inv-left">
      <p>\${ESC_HTML(宛名)} 御中</p>
      <p class="pcraft-inv-estimate-amount">見積金額:<span>\${FVAL(合計金額)}</span></p>
    </div>
    <div class="pcraft-inv-right">
      <p>見積書番号: \${ESC_HTML(見積番号)}</p>
      <p>発行日: \${DATE_FORMAT(見積日, "YYYY年M月D日")}</p>
      <img class="pcraft-inv-seal" width="250" height="120" src="data:image/svg+xml;charset=utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E">
    </div>
  </div>
  ##table##
  <div class="pcraft-inv-summary-section">
    <div class="pcraft-inv-remarks-section"><strong>備考:</strong><br><span>##備考##</span></div>
    <div class="pcraft-inv-total-section"><table><tbody>
      <tr><th>小計</th><td>\${FVAL(小計金額)}</td></tr>
      <tr><th>消費税 (10%)</th><td>\${FVAL(消費税)}</td></tr>
      <tr><th><strong>合計</strong></th><td><strong>\${FVAL(合計金額)}</strong></td></tr>
    </tbody></table></div>
  </div>
</div>`;

export const QIITA_FORMULA = `LET(
  table, TABLE_HTML(見積明細,
    OPT("pref","pcraft-inv-item-"),
    ARRAY("#",ROWNO(見積明細)+1),
    商品名,数量,単価,金額
  ),
  html,$html,
  html,REPLACE(html, "##table##", table),
  html,REPLACE(html, "##備考##", REPLACE(ESC_HTML(備考), "\\n", "<br>")), // 複数行
  html
)`;

export const CSS = `.pcraft-inv-seal {
  left: -40px;
  width: 120px;
}
.pcraft-inv-item-table thead { background-color: #2c3e50; color: white; }`;

/** AI が書く形（派生値と更新項目のメタデータは無い） */
export function aiSettings(overrides = {}) {
  const base = {
    date: "2026-10-04 10:00:00",
    pluginName: "印刷屋プラグイン",
    pluginID: "rex0220 Print craft plugin",
    PluginVersion: "6",
    appId: 3740,
    appName: "見積書(印刷屋)",
    pluginEnable: true,
    commonCssEnable: true,
    pluginInfos: [
      {
        state: true,
        menu: "見積書",
        desc: "見積書を PDF にして見積ファイルに保存します",
        tagsInfo: {
          fieldsInfo: [
            { state: true, desc: "ボタン表示条件", fieldcode: "$out", formulaSet: "NOT(見積ファイル)" },
            { state: true, desc: "ファイル名", fieldcode: "$fname", formulaSet: '"見積書-" & 見積番号 & ".pdf"' },
            { state: true, desc: "本文", css: CSS, html: HTML_TEMPLATE, formulaSet: QIITA_FORMULA }
          ],
          filecode: "見積ファイル",
          pageSize: "A4",
          orientation: "p",
          dpi: "96",
          printMode: "confirm"
        },
        calcInfo: {
          fieldsInfo: [
            { state: true, fieldcode: "$out", formulaSet: "1" },
            { state: true, fieldcode: "発行済み", formulaSet: 'ARRAY("済")', remark: "発行したら印を付ける" }
          ]
        }
      }
    ]
  };
  return { ...base, ...overrides };
}
