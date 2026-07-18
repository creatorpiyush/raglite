import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredChunk } from "../../src/types.js";
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
