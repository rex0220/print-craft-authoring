/**
 * お試しアプリの帳票のパターン（quote / list / gantt）の項目定義と固定のレコード 3 件（1 = 典型、2 = 端、3 = 空）を作る（print-craft の docs/authoring-try-plan.md 4.1、P1・P2、T1）。
 *   - 項目定義はテンプレートの docs/samples の fields.json をそのまま写す（見積書 3740、一覧帳票 381、工程表 4121。どれも架空の値で作ったもの）
 *   - 典型は docs/samples の record.json があればそのまま（見積書は明細 3 行、工程表はプロジェクト 1 件 + タスク 30 行）、無ければ値の表（src/try-apps/generate.ts）の i = 1
 *   - 端・空はこのスクリプトの決まった値（何度作っても同じ）。空は値の表の i = 11（空の印）
 *   - 書いたものの元と sha256 を src/try-apps/SOURCE.json の reports に書く（テストが照合する）
 * 使い方: node scripts/gen-try-apps.mjs [--write]（既定は比べるだけ）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = path.resolve(tools, "..", "docs", "samples");
const OUT = path.join(tools, "src", "try-apps");
const SOURCE = path.join(OUT, "SOURCE.json");
const WRITE = process.argv.includes("--write");
const { recordOf, LONG_TEXT } = await import(pathToFileURL(path.join(OUT, "generate.ts")).href);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const v = (type, value) => ({ type, value });
const recordFile = (fields, id, record) => ({ tool: "pcraft-authoring try-app", fetchedAt: "", baseUrl: "https://example.cybozu.com", appId: fields.appId, id, record });

const APPS = {
  quote: {
    sample: "見積書",
    records(fields, sample) {
      const typical = sample.record;
      const edge = {
        ...structuredClone(typical),
        $id: v("__ID__", "1002"),
        見積番号: v("SINGLE_LINE_TEXT", ""),
        宛名: v("SINGLE_LINE_TEXT", `株式会社テスト${LONG_TEXT}`),
        見積日: v("DATE", "2026-01-31"),
        担当者: v("USER_SELECT", []),
        備考: v("MULTI_LINE_TEXT", "1 行目\n2 行目\n3 行目"),
        小計: v("CALC", "-1000"),
        消費税: v("CALC", "-100"),
        合計: v("CALC", "-1100"),
        見積明細: v("SUBTABLE", [
          { id: "900001", value: { 型番: v("SINGLE_LINE_TEXT", ""), 商品名: v("SINGLE_LINE_TEXT", `長い品名${LONG_TEXT}`), 数量: v("NUMBER", "0"), 単価: v("NUMBER", "1000"), 金額: v("CALC", "0") } },
          { id: "900002", value: { 型番: v("SINGLE_LINE_TEXT", "D-01"), 商品名: v("SINGLE_LINE_TEXT", "値引き"), 数量: v("NUMBER", "1"), 単価: v("NUMBER", "-1000"), 金額: v("CALC", "-1000") } }
        ])
      };
      return [typical, edge, recordOf(fields, 11)];
    }
  },
  list: {
    sample: "一覧帳票",
    records(fields) {
      const typical = recordOf(fields, 1);
      const edge = {
        ...recordOf(fields, 2),
        顧客名: v("SINGLE_LINE_TEXT", `株式会社テスト${LONG_TEXT}`),
        部署名: v("SINGLE_LINE_TEXT", ""),
        プラン費用: v("NUMBER", "0"),
        オプション費用: v("NUMBER", "-500"),
        合計費用: v("CALC", "-500"),
        担当者: v("USER_SELECT", [])
      };
      return [typical, edge, recordOf(fields, 11)];
    }
  },
  gantt: {
    sample: "工程表",
    records(fields, sample) {
      const typical = sample.record;
      const noTasks = { ...structuredClone(typical), $id: v("__ID__", "1002"), project_name: v("SINGLE_LINE_TEXT", "タスクの無いプロジェクト"), task_list: v("SUBTABLE", []) };
      return [typical, noTasks, recordOf(fields, 11)];
    }
  }
};

const reports = {};
const outputs = [];
for (const [key, app] of Object.entries(APPS)) {
  const dir = path.join(SAMPLES, app.sample);
  const fieldsText = readFileSync(path.join(dir, "fields.json"), "utf8");
  const fields = JSON.parse(fieldsText);
  const sampleRecord = existsSync(path.join(dir, "record.json")) ? readJson(path.join(dir, "record.json")) : undefined;
  const recs = app.records(fields, sampleRecord);
  const files = [{ to: `${key}/fields.json`, text: fieldsText, from: `docs/samples/${app.sample}/fields.json` }];
  recs.forEach((rec, k) => {
    const n = k + 1;
    const fromSample = k === 0 && sampleRecord && rec === sampleRecord.record;
    files.push({ to: `${key}/record-${n}.json`, text: `${JSON.stringify(recordFile(fields, n, rec), null, 2)}\n`, from: fromSample ? `docs/samples/${app.sample}/record.json（record を写した）` : "scripts/gen-try-apps.mjs" });
  });
  reports[key] = { sample: `docs/samples/${app.sample}`, sourceFieldsSha256: sha256(fieldsText), files: files.map((f) => ({ to: f.to, from: f.from, sha256: sha256(f.text) })) };
  outputs.push(...files);
}
for (const f of outputs) {
  const dest = path.join(OUT, f.to);
  const state = !existsSync(dest) ? "new" : readFileSync(dest, "utf8") === f.text ? "same" : "changed";
  console.log(`  ${state.padEnd(7)} ${f.to}（${Buffer.byteLength(f.text).toLocaleString()} bytes）`);
}
if (!WRITE) {
  console.log("比べるだけ（--write で書く）");
  process.exit(0);
}
for (const f of outputs) {
  mkdirSync(path.dirname(path.join(OUT, f.to)), { recursive: true });
  writeFileSync(path.join(OUT, f.to), f.text);
}
const prev = existsSync(SOURCE) ? readJson(SOURCE) : {};
prev.reports = { note: "帳票のパターンの項目定義（docs/samples の写し）と固定のレコード（1 = 典型、2 = 端、3 = 空）。scripts/gen-try-apps.mjs が作った。手で直さない", ...reports };
writeFileSync(SOURCE, `${JSON.stringify(prev, null, 2)}\n`);
console.log("書いた。記録: src/try-apps/SOURCE.json");
