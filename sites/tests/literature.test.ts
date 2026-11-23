import assert from "node:assert/strict";
import { test } from "node:test";

import { createLiteratureClient, mapCrossrefWork, type FetchLike } from "../src/web/literature.ts";

const WORK = {
  title: ["A Study of Data Augmentation"],
  author: [
    { given: "Ada", family: "Lovelace" },
    { given: "Alan", family: "Turing" },
  ],
  issued: { "date-parts": [[2024]] },
  "container-title": ["Journal of Examples"],
  DOI: "10.1234/example",
};

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

test("mapCrossrefWork：字段规范化；缺题名视为无效记录如实抛错", () => {
  assert.deepEqual(mapCrossrefWork(WORK), {
    title: "A Study of Data Augmentation",
    authors: "Ada Lovelace、Alan Turing",
    year: "2024",
    venue: "Journal of Examples",
    doi: "10.1234/example",
  });
  assert.deepEqual(mapCrossrefWork({ title: "Only Title" }), {
    title: "Only Title",
    authors: "",
    year: "",
    venue: "",
    doi: "",
  });
  assert.throws(() => mapCrossrefWork({}), /缺题名/);
  assert.throws(() => mapCrossrefWork(null), /缺题名/);
  assert.throws(() => mapCrossrefWork({ title: "" }), /缺题名/);
  assert.throws(() => mapCrossrefWork({ title: [] }), /缺题名/);
});

test("fetchByDoi：成功路径传编码 DOI 并规范化返回（mock fetch 零联网）", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return jsonResponse({ status: "ok", message: WORK });
  };
  const client = createLiteratureClient(fetchImpl);
  const info = await client.fetchByDoi(" 10.1234/example ");
  assert.deepEqual(info, mapCrossrefWork(WORK));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("/works/10.1234%2Fexample"), `实际 URL：${calls[0]}`);
});

test("fetchByDoi：空 DOI / 404 / 网络异常 / 响应缺记录 一律带原始原因抛错", async () => {
  const empty = createLiteratureClient(async () => jsonResponse({ message: {} }));
  await assert.rejects(() => empty.fetchByDoi("   "), /请填写 DOI/);
  await assert.rejects(() => empty.fetchByDoi("10.1/empty"), /缺少文献记录/);

  const notFound = createLiteratureClient(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await assert.rejects(() => notFound.fetchByDoi("10.1/none"), /抓取失败：HTTP 404/);

  const offline = createLiteratureClient(async () => {
    throw new Error("network down");
  });
  await assert.rejects(() => offline.fetchByDoi("10.1/x"), /抓取失败：network down/);
});

test("抓取超时：按 timeoutMs 中止并报「请求超时」", async () => {
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const client = createLiteratureClient(hanging, { timeoutMs: 5 });
  await assert.rejects(() => client.fetchByDoi("10.1/slow"), /抓取失败：请求超时（5ms）/);
});

test("searchByTitle：多条规范化、缺题名条目剔除、空结果与坏响应如实报错", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return jsonResponse({
      message: {
        items: [WORK, { title: ["Second"], DOI: "10.2/second" }, { note: "缺题名" }],
      },
    });
  };
  const client = createLiteratureClient(fetchImpl);
  const list = await client.searchByTitle("data augmentation");
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "A Study of Data Augmentation");
  assert.equal(list[1].title, "Second");
  assert.ok(calls[0].includes("query.bibliographic=data%20augmentation"), `实际 URL：${calls[0]}`);

  const none = createLiteratureClient(async () => jsonResponse({ message: { items: [] } }));
  assert.deepEqual(await none.searchByTitle("nothing"), []);

  const allBroken = createLiteratureClient(async () => jsonResponse({ message: { items: [{ a: 1 }, {}] } }));
  await assert.rejects(() => allBroken.searchByTitle("x"), /检索结果均缺题名/);

  const noItems = createLiteratureClient(async () => jsonResponse({ message: {} }));
  await assert.rejects(() => noItems.searchByTitle("x"), /缺少检索结果/);

  const blank = createLiteratureClient(async () => jsonResponse({}));
  await assert.rejects(() => blank.searchByTitle("   "), /请填写检索词/);
});
