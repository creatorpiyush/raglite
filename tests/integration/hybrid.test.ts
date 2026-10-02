import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProviderConfig, IndexMetadata, StoredChunk } from "../../src/types.js";
import type { VectorSearchHit, VectorStore } from "../../src/vectordb/base.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

const embedders: MockEmbedder[] = [];

vi.mock("../../src/embeddings/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embeddings/index.js")>();
  return {
    ...actual,
    createEmbedder: async (config: EmbeddingProviderConfig) => {
      const embedder = new MockEmbedder(config.model ?? "mock-model");
      embedders.push(embedder);
      return embedder;
    },
  };
});

const { Document } = await import("../../src/core/document.js");
const { DocumentCollection } = await import("../../src/core/collection.js");
const { buildApp } = await import("../../src/api/server.js");

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
  embedders.length = 0;
});
afterEach(() => ws.cleanup());

const silent = () => ({ storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const });
const embedCalls = () => embedders.reduce((n, e) => n + e.embedDocumentsCalls, 0);

/** Twenty filler sentences with one line holding the error code, one sentence per chunk. */
function runbook(): string {
  const lines = Array.from(
    { length: 20 },
    (_, i) => `Section ${i + 1} describes routine maintenance of the billing service.`,
  );
  lines[13] = "If checkout fails with ERR_4021 the payment gateway timed out, so retry later.";
  return lines.join("\n");
}

async function buildRunbook(extra: Record<string, unknown> = {}) {
  const doc = new Document(ws.file("runbook.txt", runbook()), { ...silent(), ...extra });
  await doc.build({ chunkSize: 11, overlap: 0 });
  return doc;
}

describe("hybrid search", () => {
  it("finds an exact error code that vector search misses", async () => {
    const doc = await buildRunbook();
    const vector = await doc.search("ERR_4021", { topK: 1 });
    expect(vector[0]!.text).not.toContain("ERR_4021");

    for (const mode of ["keyword", "hybrid"] as const) {
      const [top] = await doc.search("ERR_4021", { topK: 1, mode });
      expect(top!.text).toContain("ERR_4021");
      expect(top!.scores?.keyword).toBeGreaterThan(0);
      expect(top!.score).toBeGreaterThan(0);
      expect(top!.score).toBeLessThanOrEqual(1);
      expect(top!.distance).toBeCloseTo(1 - top!.score, 12);
    }
  });

  it("keeps vector mode results unchanged and without component scores", async () => {
    const doc = await buildRunbook();
    const results = await doc.search("billing", { topK: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]!.scores).toBeUndefined();
  });

  it("uses the configured default mode, including for ask()", async () => {
    const doc = await buildRunbook({ retrieval: { mode: "keyword" } });
    const [top] = await doc.search("ERR_4021", { topK: 1 });
    expect(top!.text).toContain("ERR_4021");
    expect(embedders.at(-1)!.embedQueryCalls).toBe(0);
  });

  it("applies scoreThreshold to the vector list only", async () => {
    const doc = await buildRunbook();
    const results = await doc.search("ERR_4021", { topK: 5, mode: "hybrid", scoreThreshold: 2 });
    expect(results).toHaveLength(1);
    expect(results[0]!.scores?.vector).toBeUndefined();
    expect(results[0]!.text).toContain("ERR_4021");
  });

  it("rejects unknown modes and invalid hybrid options", async () => {
    const doc = await buildRunbook();
    await expect(doc.search("x", { mode: "fuzzy" as never })).rejects.toThrow(/retrieval mode/);
    await expect(doc.search("x", { mode: "hybrid", hybrid: { rrfK: 0 } })).rejects.toThrow(/rrfK/);
    await expect(
      doc.search("x", { mode: "hybrid", hybrid: { weights: { vector: 0, keyword: 0 } } }),
    ).rejects.toThrow(/weights/);
  });

  it("writes the keyword index next to the vector index", async () => {
    const doc = await buildRunbook();
    const path = join(ws.root, ".raglite", doc.storeNamespace, "keyword.json");
    const file = JSON.parse(readFileSync(path, "utf-8"));
    expect(file.tokenizer).toBe("raglite-v1");
    expect(file.chunks).toHaveLength(doc.chunkCount);
  });
});

describe("keyword index upgrade path", () => {
  it("rebuilds a missing keyword index from a memory store without re-embedding", async () => {
    const built = await buildRunbook();
    rmSync(join(ws.root, ".raglite", built.storeNamespace, "keyword.json"));
    const before = embedCalls();

    const doc = new Document(join(ws.root, "runbook.txt"), silent());
    expect((await doc.build({ chunkSize: 11, overlap: 0 })).cached).toBe(true);
    const [top] = await doc.search("ERR_4021", { topK: 1, mode: "hybrid" });
    expect(top!.text).toContain("ERR_4021");
    expect(embedCalls()).toBe(before);
    expect(existsSync(join(ws.root, ".raglite", doc.storeNamespace, "keyword.json"))).toBe(true);
  });

  it("ignores a keyword index left over from a different build", async () => {
    const doc = await buildRunbook();
    const metaPath = join(ws.root, ".raglite", doc.storeNamespace, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as IndexMetadata;
    const store = new BareStore(doc.storeNamespace, { ...meta, createdAt: "2000-01-01T00:00:00Z" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = new Document(join(ws.root, "runbook.txt"), {
      storeDir: join(ws.root, ".raglite"),
      vectorStore: store,
      logLevel: "info",
    });
    const results = await other.search("ERR_4021", { topK: 2, mode: "hybrid" });
    expect(results.every((r) => r.scores === undefined)).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/No keyword index/);
    warn.mockRestore();
  });

  it("falls back to vector search when the store cannot list its chunks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Document(ws.file("a.txt", "alpha beta gamma"), {
      storeDir: join(ws.root, "elsewhere"),
      vectorStore: new BareStore("bare"),
      logLevel: "info",
    });
    await doc.build();
    rmSync(join(ws.root, "elsewhere"), { recursive: true, force: true });

    const fresh = new Document(join(ws.root, "a.txt"), {
      storeDir: join(ws.root, "elsewhere"),
      vectorStore: (doc as unknown as { store: VectorStore }).store,
      logLevel: "info",
    });
    const results = await fresh.search("alpha", { mode: "keyword", scoreThreshold: -1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.scores).toBeUndefined();
    await fresh.search("alpha", { mode: "keyword", scoreThreshold: -1 });
    expect(warn.mock.calls.filter((c) => /No keyword index/.test(String(c))).length).toBe(1);
    warn.mockRestore();
  });

  it("prefers a store's native keywordSearch", async () => {
    const store = new BareStore("native");
    store.keywordSearch = async (query: string) => [
      { id: "native_1", text: `native hit for ${query}`, metadata: meta1(), score: 3, distance: 0 },
    ];
    const doc = new Document(ws.file("n.txt", "alpha beta"), { ...silent(), vectorStore: store });
    await doc.build();
    const [top] = await doc.search("anything", { mode: "keyword" });
    expect(top!.id).toBe("native_1");
    expect(top!.scores?.keyword).toBe(3);
  });
});

describe("DocumentCollection hybrid search", () => {
  it("fuses across documents and survives one failing document", async () => {
    ws.file("a.txt", "Refunds are issued within 30 days of purchase.");
    ws.file("b.txt", "Error ERR_4021 means the payment gateway timed out.");
    ws.file("c.txt", "The billing page lists every payment and refund.");
    const collection = new DocumentCollection(
      ["a.txt", "b.txt", "c.txt"].map((f) => join(ws.root, f)),
      silent(),
    );
    await collection.build();

    const [top] = await collection.search("ERR_4021 payment", { topK: 3, mode: "hybrid" });
    expect(top!.metadata.source).toBe("b.txt");
    expect(top!.scores?.fused).toBeGreaterThan(0);

    const broken = collection.getDocuments().find((d) => d.filePath.endsWith("c.txt"))!;
    vi.spyOn(broken, "retrieveCandidates").mockRejectedValue(new Error("store offline"));
    const results = await collection.search("payment", { topK: 3, mode: "keyword" });
    expect(results.map((r) => r.metadata.source)).toEqual(["b.txt"]);
  });

  it("throws when every document fails", async () => {
    ws.file("a.txt", "alpha");
    const collection = new DocumentCollection(join(ws.root, "a.txt"), silent());
    await collection.build();
    for (const doc of collection.getDocuments()) {
      vi.spyOn(doc, "retrieveCandidates").mockRejectedValue(new Error("down"));
    }
    await expect(collection.search("alpha", { mode: "hybrid" })).rejects.toThrow("down");
  });
});

describe("HTTP API mode", () => {
  it("accepts mode on /search and rejects unknown modes", async () => {
    const doc = await buildRunbook();
    const app = buildApp(doc, {});
    const post = (body: unknown) =>
      app.request("/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const ok = await post({ query: "ERR_4021", topK: 1, mode: "keyword" });
    expect(ok.status).toBe(200);
    const { results } = (await ok.json()) as { results: { text: string }[] };
    expect(results[0]!.text).toContain("ERR_4021");

    expect((await post({ query: "x", mode: "fuzzy" })).status).toBe(400);
  });
});

function meta1() {
  return { source: "n.txt", chunk: 1, totalChunks: 1 };
}

/** A minimal custom store with no listChunks, like a remote store would be. */
class BareStore implements VectorStore {
  keywordSearch?: (query: string, topK: number) => Promise<VectorSearchHit[]>;
  private chunks: StoredChunk[] = [];

  constructor(
    readonly namespace: string,
    private metadata: IndexMetadata | null = null,
  ) {}

  async load() {}
  async reset() {
    this.chunks = [];
  }
  async add(chunks: StoredChunk[]) {
    this.chunks.push(...chunks);
  }
  async search(embedding: number[], topK: number): Promise<VectorSearchHit[]> {
    return this.chunks.slice(0, topK).map((c) => ({
      id: c.id,
      text: c.text,
      metadata: c.metadata,
      score: c.embedding.reduce((s, v, i) => s + v * (embedding[i] ?? 0), 0),
      distance: 0,
    }));
  }
  count() {
    return this.metadata?.chunkCount ?? this.chunks.length;
  }
  async saveIndexMetadata(metadata: IndexMetadata) {
    this.metadata = metadata;
  }
  async readIndexMetadata() {
    return this.metadata;
  }
}
