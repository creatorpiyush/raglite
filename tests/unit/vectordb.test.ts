import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MetadataFilter } from "../../src/retrieval/filter.js";
import type { StoredChunk } from "../../src/types.js";
import type { VectorStore } from "../../src/vectordb/base.js";
import { LanceDbVectorStore } from "../../src/vectordb/lancedb.js";
import { MemoryVectorStore } from "../../src/vectordb/memory.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

function unit(vec: number[]): number[] {
  let s = 0;
  for (const v of vec) s += v * v;
  const n = Math.sqrt(s);
  return vec.map((v) => v / n);
}

function chunk(id: string, text: string, embedding: number[]): StoredChunk {
  return {
    id,
    text,
    embedding: unit(embedding),
    metadata: { source: "t", chunk: 1, totalChunks: 3 },
  };
}

describe("MemoryVectorStore", () => {
  it("starts empty and can be added to", async () => {
    const store = new MemoryVectorStore(ws.root, "ns1");
    await store.load();
    expect(store.count()).toBe(0);
    await store.add([chunk("a", "a", [1, 0, 0])]);
    expect(store.count()).toBe(1);
  });

  it("returns hits ordered by cosine similarity", async () => {
    const store = new MemoryVectorStore(ws.root, "ns2");
    await store.load();
    await store.add([
      chunk("north", "n", [1, 0, 0]),
      chunk("east", "e", [0, 1, 0]),
      chunk("down", "d", [0, 0, -1]),
    ]);

    const hits = await store.search(unit([0.9, 0.1, 0]), 3);
    expect(hits.map((h) => h.id)).toEqual(["north", "east", "down"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    for (const hit of hits) {
      expect(hit.distance).toBeCloseTo(1 - hit.score, 6);
    }
  });

  it("topK limits the result count", async () => {
    const store = new MemoryVectorStore(ws.root, "ns3");
    await store.load();
    await store.add([
      chunk("a", "a", [1, 0, 0]),
      chunk("b", "b", [0.9, 0.1, 0]),
      chunk("c", "c", [0, 1, 0]),
    ]);
    const hits = await store.search(unit([1, 0, 0]), 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.id).toBe("a");
  });

  it("persists chunks and metadata to disk", async () => {
    const store = new MemoryVectorStore(ws.root, "ns4");
    await store.load();
    await store.add([chunk("x", "x", [1, 0, 0])]);
    await store.saveIndexMetadata({
      version: "0.1.0",
      source: "/tmp/foo.txt",
      sourceHash: "abc",
      chunkSize: 100,
      overlap: 10,
      embeddingProvider: "local",
      embeddingModel: "m",
      embeddingDimensions: 3,
      chunkCount: 1,
      createdAt: new Date().toISOString(),
    });

    expect(existsSync(join(ws.root, "ns4", "chunks.json"))).toBe(true);
    expect(existsSync(join(ws.root, "ns4", "metadata.json"))).toBe(true);

    const store2 = new MemoryVectorStore(ws.root, "ns4");
    await store2.load();
    expect(store2.count()).toBe(1);
    const meta = await store2.readIndexMetadata();
    expect(meta?.sourceHash).toBe("abc");
    expect(meta?.chunkCount).toBe(1);
  });

  it("reset() clears in-memory state and removes disk artifacts", async () => {
    const store = new MemoryVectorStore(ws.root, "ns5");
    await store.load();
    await store.add([chunk("y", "y", [1, 0, 0])]);
    await store.reset();
    expect(store.count()).toBe(0);
    expect(existsSync(join(ws.root, "ns5"))).toBe(false);
  });

  it("isolates namespaces", async () => {
    const a = new MemoryVectorStore(ws.root, "left");
    const b = new MemoryVectorStore(ws.root, "right");
    await a.load();
    await b.load();
    await a.add([chunk("1", "left-chunk", [1, 0, 0])]);
    expect(a.count()).toBe(1);
    expect(b.count()).toBe(0);
  });
});

// Real stores, not mocks: the same filter must select the same chunks in each.
describe.each([
  ["memory", (dir: string) => new MemoryVectorStore(dir, "filters")],
  ["lancedb", (dir: string) => new LanceDbVectorStore(dir, "filters")],
] as const)("%s store", (_name, makeStore: (dir: string) => VectorStore) => {
  const chunks: StoredChunk[] = [
    {
      id: "p1",
      text: "intro",
      embedding: unit([1, 0, 0]),
      metadata: { source: "a.pdf", chunk: 1, totalChunks: 3, page: 1, section: "Intro" },
    },
    {
      id: "p2",
      text: "refunds",
      embedding: unit([1, 1, 0]),
      metadata: {
        source: "a.pdf",
        chunk: 2,
        totalChunks: 3,
        page: 2,
        pageEnd: 3,
        section: "O'Brien",
      },
    },
    {
      id: "p3",
      text: "no location",
      embedding: unit([0, 1, 0]),
      metadata: { source: "a.pdf", chunk: 3, totalChunks: 3 },
    },
  ];

  it.each<[string, MetadataFilter | undefined, string[]]>([
    ["no filter", undefined, ["p1", "p2", "p3"]],
    ["string with a quote", { section: "O'Brien" }, ["p2"]],
    ["in", { chunk: { in: [1, 3] } }, ["p1", "p3"]],
    ["range skips chunks without the field", { page: { gte: 1 } }, ["p1", "p2"]],
    ["camelCase field", { pageEnd: { gte: 3 } }, ["p2"]],
    ["empty in", { chunk: { in: [] } }, []],
  ])("search filter: %s", async (_case, filter, ids) => {
    const store = makeStore(ws.root);
    await store.load();
    await store.add(chunks);
    const hits = await store.search(unit([1, 0.5, 0]), 10, filter);
    expect(hits.map((h) => h.id).sort()).toEqual(ids);
    for (const hit of hits) {
      expect(hit.metadata).toEqual(chunks.find((c) => c.id === hit.id)!.metadata);
      expect(hit.distance).toBeCloseTo(1 - hit.score, 5);
    }
  });

  it("orders hits by similarity and lists stored chunks", async () => {
    const store = makeStore(ws.root);
    await store.load();
    await store.add(chunks);
    const hits = await store.search(unit([1, 0, 0]), 2);
    expect(hits.map((h) => h.id)).toEqual(["p1", "p2"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    const listed = await store.listChunks!();
    expect(listed.map((c) => c.id).sort()).toEqual(["p1", "p2", "p3"]);
  });
});
