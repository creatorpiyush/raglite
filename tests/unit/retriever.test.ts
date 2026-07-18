import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Retriever } from "../../src/retrieval/index.js";
import type { StoredChunk } from "../../src/types.js";
import { MemoryVectorStore } from "../../src/vectordb/memory.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

async function seedStore(store: MemoryVectorStore, embedder: MockEmbedder, texts: string[]) {
  const vectors = await embedder.embedDocuments(texts);
  const chunks: StoredChunk[] = texts.map((text, i) => ({
    id: `c${i}`,
    text,
    embedding: vectors[i]!,
    metadata: { source: "t", chunk: i + 1, totalChunks: texts.length },
  }));
  await store.add(chunks);
}

describe("Retriever", () => {
  it("returns hits and orders by similarity", async () => {
    const store = new MemoryVectorStore(ws.root, "ns");
    await store.load();
    const embedder = new MockEmbedder();
    await seedStore(store, embedder, [
      "the quick brown fox jumps over the lazy dog",
      "hello world",
      "totally unrelated content about oranges",
    ]);

    const r = new Retriever(embedder, store);
    const hits = await r.retrieve("hello world", { topK: 3, scoreThreshold: -1 });

    expect(hits).toHaveLength(3);
    expect(hits[0]!.text).toBe("hello world");
    expect(embedder.embedQueryCalls).toBe(1);
  });

  it("respects scoreThreshold", async () => {
    const store = new MemoryVectorStore(ws.root, "ns2");
    await store.load();
    const embedder = new MockEmbedder();
    await seedStore(store, embedder, ["one", "two", "three"]);

    const r = new Retriever(embedder, store);
    const strict = await r.retrieve("one", { topK: 3, scoreThreshold: 0.99 });
    expect(strict).toHaveLength(1);
    expect(strict[0]!.text).toBe("one");
  });

  it("respects topK cap", async () => {
    const store = new MemoryVectorStore(ws.root, "ns3");
    await store.load();
    const embedder = new MockEmbedder();
    await seedStore(store, embedder, ["a", "b", "c", "d", "e"]);
    const r = new Retriever(embedder, store);
    const hits = await r.retrieve("a", { topK: 2 });
    expect(hits).toHaveLength(2);
  });
});
