/** 受け取る量の上限と、レコードを数件・形だけで見る（段階 0-2 の段 4。print-craft-authoring-mcp の docs/api-table.md、実装案 5.4） */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_APIS, RECEIVE_LIMITS, RestError, createRestClient, readCapped } from "../src/kintone-rest.ts";
import { LIST_LIMIT, QueryError, listQueryOf, listRecordShapes } from "../src/commands/records.ts";

const tooLarge = (e) => e instanceof RestError && e.code === "LimitError" && /応答が大きすぎる/.test(e.message);

/** 試験用の応答: 本文をいくつかの塊で流す（Content-Length は任意） */
function streamed(chunks, { contentLength } = {}) {
  let i = 0;
  let cancelled = false;
  return {
    ok: true,
    status: 200,
    text: async () => {
      throw new Error("text() は呼ばない（body があるときは流しながら読む）");
    },
    headers: { get: (n) => (n.toLowerCase() === "content-length" && contentLength !== undefined ? String(contentLength) : null) },
    body: {
      getReader: () => ({
        read: async () => (cancelled || i >= chunks.length ? { done: true } : { done: false, value: new TextEncoder().encode(chunks[i++]) }),
        cancel: async () => {
          cancelled = true;
        }
      })
    },
    get readCount() {
      return i;
    }
  };
}

test("readCapped: Content-Length が上限を超えれば読まずに止める。無くても読みながら上限 + 1 バイトで止める。body が無ければ text() の大きさで", async () => {
  await assert.rejects(readCapped(streamed(["{}"], { contentLength: 11 }), 10, "/k/v1/app.json"), tooLarge);
  const r = streamed(["12345", "67890", "x", "never"]);
  await assert.rejects(readCapped(r, 10, "/k/v1/app.json"), tooLarge);
  assert.equal(r.readCount, 3, "上限を超えた塊で止め、残りは読まない");
  assert.equal(await readCapped(streamed(["{\"a\":", "1}"], { contentLength: 7 }), 10, "/k/v1/app.json"), '{"a":1}');
  assert.equal(await readCapped(streamed(["{\"a\":", "1}"], { contentLength: 3 }), 10, "/k/v1/app.json"), '{"a":1}', "Content-Length が偽り（小さい）でも、実際の大きさで確かめる");
  await assert.rejects(readCapped({ ok: true, status: 200, text: async () => "あ".repeat(4) }, 10, "/k/v1/app.json"), tooLarge, "body の無い応答（試験の偽物）は text() のバイト数で");
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
