/** 受け取る量の上限と、レコードを数件・形だけで見る（段階 0-2 の段 4。print-craft-authoring-mcp の docs/api-table.md、実装案 5.4） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_APIS, RECEIVE_LIMITS, RestError, createRestClient, readCapped } from "../src/kintone-rest.ts";
import { LIST_LIMIT, QueryError, listQueryOf, listRecordShapes } from "../src/commands/records.ts";
import { shapeLines } from "../src/commands/record.ts";

const tooLarge = (e) => e instanceof RestError && e.code === "LimitError" && /応答が大きすぎる/.test(e.message);

/** 試験用の応答: 本文をいくつかの塊で流す（Content-Length は任意） */
function streamed(chunks, { contentLength, cancelFails } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    ok: true,
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === "content-length" && contentLength !== undefined ? String(contentLength) : null) },
    body: {
      getReader: () => ({
        read: async () => (cancelled || i >= chunks.length ? { done: true } : { done: false, value: new TextEncoder().encode(chunks[i++]) }),
        cancel: async () => {
          cancelled = true;
          if (cancelFails) throw new Error("cancel に失敗");
        }
      })
    },
    get readCount() {
      return i;
    }
  };
}

test("readCapped: Content-Length が上限を超えれば読まずに止める。無くても読みながら上限 + 1 バイトで止める", async () => {
  await assert.rejects(readCapped(streamed(["{}"], { contentLength: 11 }), 10, "/k/v1/app.json"), tooLarge);
  const r = streamed(["12345", "67890", "x", "never"]);
  await assert.rejects(readCapped(r, 10, "/k/v1/app.json"), tooLarge);
  assert.equal(r.readCount, 3, "上限を超えた塊で止め、残りは読まない");
  assert.equal(await readCapped(streamed(["{\"a\":", "1}"], { contentLength: 7 }), 10, "/k/v1/app.json"), '{"a":1}');
  assert.equal(await readCapped(streamed(["{\"a\":", "1}"], { contentLength: 3 }), 10, "/k/v1/app.json"), '{"a":1}', "Content-Length が偽り（小さい）でも、実際の大きさで確かめる");
  await assert.rejects(readCapped(streamed(["あ".repeat(4)]), 10, "/k/v1/app.json"), tooLarge, "バイト数で数える（4 文字 = 12 バイト）");
  await assert.rejects(readCapped(streamed(["x".repeat(11)], { cancelFails: true }), 10, "/k/v1/app.json"), tooLarge, "cancel の失敗より上限の誤りを返す");
  await assert.rejects(readCapped(streamed(["{}"], { contentLength: 99, cancelFails: true }), 10, "/k/v1/app.json"), tooLarge);
});

test("readCapped: 本文のストリームが無い応答は読まない（全文を読んでから確かめる経路を持たない。Codex レビュー MINOR 8）。body が null なら空", async () => {
  let textCalled = false;
  const noStream = { ok: true, status: 200, text: async () => ((textCalled = true), "x".repeat(1e6)) };
  await assert.rejects(readCapped(noStream, 10, "/k/v1/app.json"), (e) => e instanceof RestError && e.code === "ResponseError" && /ストリームが無い/.test(e.message));
  assert.equal(textCalled, false, "text() を呼ばない");
  assert.equal(await readCapped({ ok: true, status: 204, body: null }, 10, "/k/v1/app.json"), "");
  assert.equal(await readCapped(new Response('{"a":1}'), 10, "/k/v1/app.json"), '{"a":1}', "Node の fetch の Response はそのまま読める");
  await assert.rejects(readCapped(new Response("x".repeat(11)), 10, "/k/v1/app.json"), tooLarge);
});

test("RECEIVE_LIMITS: 許可した API のすべてに上限がある。app は小さく、項目定義・レコードは大きなアプリでも引っかからない値", () => {
  for (const api of ALLOWED_APIS) assert.ok(RECEIVE_LIMITS[api] > 0, api);
  assert.ok(ALLOWED_APIS.includes("records"));
  assert.ok(!ALLOWED_APIS.includes("apps"), "apps.json は API トークンで使えないので足さない");
  assert.equal(RECEIVE_LIMITS.app, 64 * 1024);
  assert.equal(RECEIVE_LIMITS["app/form/fields"], 8 * 1024 * 1024);
});

test("createRestClient: 上限を超える応答は RestError（LimitError）", async () => {
  const c = createRestClient({ baseUrl: "https://a.cybozu.com", token: "t" }, async () => streamed(["x".repeat(70 * 1024)]));
  await assert.rejects(c.get("app", { id: 1 }), tooLarge);
});

test("listQueryOf: 条件と並べ替えだけ。limit / offset は止める（引用符の中の文字は数えない）、500 文字まで、末尾に limit 5", () => {
  assert.equal(listQueryOf(undefined), `limit ${LIST_LIMIT}`);
  assert.equal(listQueryOf('ステータス = "見積中" order by 更新日時 desc'), `ステータス = "見積中" order by 更新日時 desc limit ${LIST_LIMIT}`);
  assert.equal(listQueryOf('備考 like "limit offset"'), `備考 like "limit offset" limit ${LIST_LIMIT}`, "引用符の中の limit は止めない");
  assert.throws(() => listQueryOf("order by $id desc limit 500"), QueryError);
  assert.throws(() => listQueryOf("offset 10"), QueryError);
  assert.throws(() => listQueryOf("a".repeat(501)), /500 文字まで/);
  assert.equal(listQueryOf("あ".repeat(500)).startsWith("あ"), true, "500 文字は文字数（バイト数でない）");
  // 引用符の扱い（Codex レビュー: escaped quote、backslash、未閉じ、改行）
  assert.equal(listQueryOf('備考 like "a\\"limit"'), `備考 like "a\\"limit" limit ${LIST_LIMIT}`, "引用符の中の \\\" は引用符の終わりでない");
  assert.throws(() => listQueryOf('備考 like "a\\\\" limit 9'), QueryError, "\\\\ の後の \" で引用符が閉じ、その後の limit は止める");
  assert.throws(() => listQueryOf('備考 like "abc limit 9'), QueryError, "閉じていない引用符の中は除かない（limit を止める側に倒す）");
  assert.throws(() => listQueryOf("order by $id desc\nlimit 9"), QueryError, "改行の後の limit も止める");
  assert.throws(() => listQueryOf("order by $id desc\tOFFSET 1"), QueryError, "大文字・タブ");
  assert.equal(listQueryOf("limited = \"1\""), `limited = "1" limit ${LIST_LIMIT}`, "語の一部の limit は止めない（項目コード limited）");
});

test("listRecordShapes: 値・ファイル名・ユーザー名を返さず形だけ。件数はサーバーの limit 5", async () => {
  let seen;
  const client = {
    baseUrl: "https://a.cybozu.com",
    get: async (api, params) => {
      seen = { api, params };
      const rec = (id) => ({
        $id: { type: "__ID__", value: String(id) },
        顧客名: { type: "SINGLE_LINE_TEXT", value: "株式会社ひみつ" },
        備考: { type: "MULTI_LINE_TEXT", value: "1 行目\n2 行目" },
        担当: { type: "USER_SELECT", value: [{ code: "taro", name: "山田太郎" }] },
        添付: { type: "FILE", value: [{ name: "社外秘.pdf", contentType: "application/pdf", size: "10", fileKey: "k" }] },
        明細: { type: "SUBTABLE", value: [{ id: "1", value: { 品名: { type: "SINGLE_LINE_TEXT", value: "ねじ" } } }] }
      });
      return { records: [1, 2, 3, 4, 5, 6].map(rec) };
    }
  };
  const r = await listRecordShapes(client, { app: 3740, query: "order by $id desc" });
  assert.equal(seen.api, "records");
  assert.equal(seen.params.query, `order by $id desc limit ${LIST_LIMIT}`);
  assert.equal(r.records.length, LIST_LIMIT, "サーバーが余分に返しても 5 件まで");
  const text = JSON.stringify(r);
  for (const secret of ["株式会社ひみつ", "山田太郎", "taro", "社外秘.pdf", "ねじ", "1 行目"]) assert.ok(!text.includes(secret), `値を返さない: ${secret}`);
  assert.ok(r.records[0].lines.some((l) => /^備考  MULTI_LINE_TEXT  .*2 行$/.test(l)), "形（文字数・行数）は返す");
  assert.equal(r.records[0].id, "1");
  assert.equal(r.truncated, false);
});

test("listRecordShapes: 64 KiB は返す JSON の UTF-8 のバイト数（日本語の項目コード・制御文字・query を含む。Codex レビュー MINOR 7）", async () => {
  // 1 件目は小さく、2 件目は文字数では 64 Ki 未満だが UTF-8 では超える
  const big = { $id: { type: "__ID__", value: "2" } };
  for (let i = 0; i < 1200; i++) big[`日本語の長い項目コード${i}`] = { type: "SINGLE_LINE_TEXT", value: "" };
  const small = { $id: { type: "__ID__", value: "1" }, "制御\u0001文字": { type: "SINGLE_LINE_TEXT", value: "" } };
  const client = { baseUrl: "https://a.cybozu.com", get: async () => ({ records: [small, big, small] }) };
  const query = "備考 like \"" + "あ".repeat(400) + "\"";
  const r = await listRecordShapes(client, { app: 1, query });
  const withBig = JSON.stringify({ appId: 1, query: listQueryOf(query), records: [{ id: "1", lines: shapeLines(small) }, { id: "2", lines: shapeLines(big) }], truncated: true });
  assert.ok(withBig.length < 64 * 1024 && Buffer.byteLength(withBig, "utf8") > 64 * 1024, "前提: 2 件目を入れた応答は文字数では上限の内、バイト数では外");
  assert.deepEqual(r.records.map((x) => x.id), ["1"], "2 件目で打ち切る（3 件目も返さない）");
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(r), "utf8") <= 64 * 1024);
});

test("listRecordShapes: 上限ちょうどは返し、1 バイト超えれば打ち切る（truncated: false の長い方で測る。Codex 再レビュー MINOR 5）", async () => {
  const rec = { $id: { type: "__ID__", value: "1" }, 項目: { type: "SINGLE_LINE_TEXT", value: "" } };
  const client = { baseUrl: "https://a.cybozu.com", get: async () => ({ records: [rec] }) };
  const exact = Buffer.byteLength(JSON.stringify({ appId: 1, query: listQueryOf(undefined), records: [{ id: "1", lines: shapeLines(rec) }], truncated: false }), "utf8");
  const fits = await listRecordShapes(client, { app: 1, maxBytes: exact });
  assert.deepEqual([fits.records.length, fits.truncated], [1, false]);
  assert.equal(Buffer.byteLength(JSON.stringify(fits), "utf8"), exact, "返す JSON はちょうど上限");
  const over = await listRecordShapes(client, { app: 1, maxBytes: exact - 1 });
  assert.deepEqual([over.records.length, over.truncated], [0, true]);
  assert.ok(Buffer.byteLength(JSON.stringify(over), "utf8") <= exact - 1);
});

test("createRestClient: 成功の応答の本文が空・JSON でないときは決まった文の RestError（ResponseError。本文は出さない）", async () => {
  const empty = createRestClient({ baseUrl: "https://a.cybozu.com", token: "t" }, async () => ({ ok: true, status: 204, body: null }));
  await assert.rejects(empty.get("app", { id: 1 }), (e) => e instanceof RestError && e.code === "ResponseError" && /本文が空/.test(e.message));
  const html = createRestClient({ baseUrl: "https://a.cybozu.com", token: "t" }, async () => new Response("<html>secret</html>", { status: 200 }));
  await assert.rejects(html.get("app", { id: 1 }), (e) => e instanceof RestError && e.code === "ResponseError" && !/secret/.test(e.message));
});
