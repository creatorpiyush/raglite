import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "../../src/errors.js";
import type { EmbeddingProviderConfig, RetrievalMode, SearchResult } from "../../src/types.js";
import { MemoryVectorStore } from "../../src/vectordb/memory.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

vi.mock("../../src/embeddings/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embeddings/index.js")>();
  return {
    ...actual,
    createEmbedder: async (config: EmbeddingProviderConfig) =>
      new MockEmbedder(config.model ?? "mock-model"),
  };
});

const { Document } = await import("../../src/core/document.js");
const { DocumentCollection } = await import("../../src/core/collection.js");
const { buildApp } = await import("../../src/api/server.js");

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

// Mock embeddings can have negative cosine similarity; keep every hit.
const silent = () => ({
  storeDir: join(ws.root, ".raglite"),
  logLevel: "silent" as const,
  scoreThreshold: -1,
});
const MODES: RetrievalMode[] = ["vector", "keyword", "hybrid"];

/** Three sections of eight words each, so chunkSize 8 gives one chunk per section. */
const HANDBOOK = [
  "# Intro",
  "Every refund request starts here today.",
  "# Billing",
  "A refund goes back to card.",
  "# Shipping",
  "Damaged parcels get a refund too.",
].join("\n");

async function handbook(options: Record<string, unknown> = {}) {
  const doc = new Document(ws.file("handbook.md", HANDBOOK), { ...silent(), ...options });
  await doc.build({ chunkSize: 8, overlap: 0 });
  return doc;
}

const sections = (hits: SearchResult[]) => hits.map((h) => h.metadata.section).sort();

describe("Document filter", () => {
  it.each(MODES)("filters on chunk metadata in %s mode", async (mode) => {
    const doc = await handbook();
    const all = await doc.search("refund", { mode, topK: 10 });
    expect(sections(all)).toEqual(["Billing", "Intro", "Shipping"]);

    const hits = await doc.search("refund", {
      mode,
      topK: 10,
      filter: { section: { in: ["Billing", "Shipping"] } },
    });
    expect(sections(hits)).toEqual(["Billing", "Shipping"]);
  });

  it("applies the filter before the topK cut", async () => {
    const doc = await handbook();
    for (const section of ["Intro", "Billing", "Shipping"]) {
      const hits = await doc.search("refund", { topK: 1, filter: { section } });
      expect(sections(hits)).toEqual([section]);
    }
  });

  it.each(MODES)("adds custom metadata and filters on it in %s mode", async (mode) => {
    const doc = await handbook({ metadata: { tenant: "acme", tier: 2 } });
    const hits = await doc.search("refund", { mode, filter: { tenant: "acme", tier: { gte: 2 } } });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.metadata).toMatchObject({ tenant: "acme", tier: 2 });

    expect(await doc.search("refund", { mode, filter: { tenant: "globex" } })).toEqual([]);
    expect(await doc.search("refund", { mode, filter: { source: "other.md" } })).toEqual([]);
    expect(
      await doc.search("refund", { mode, filter: { source: "handbook.md", section: "Intro" } }),
    ).toHaveLength(1);
  });

  it("drops hits from a custom store that ignores the filter", async () => {
    class IgnoresFilter extends MemoryVectorStore {
      override search(embedding: number[], topK: number) {
        return super.search(embedding, topK);
      }
    }
    const store = new IgnoresFilter(join(ws.root, "custom"), "ns");
    const doc = await handbook({ vectorStore: store });
    const hits = await doc.search("refund", { topK: 10, filter: { section: "Billing" } });
    expect(sections(hits)).toEqual(["Billing"]);
  });

  it("changing custom metadata needs no rebuild", async () => {
    await handbook({ metadata: { tenant: "acme" } });
    const doc = new Document(ws.file("handbook.md", HANDBOOK), {
      ...silent(),
      metadata: { tenant: "globex" },
    });
    const result = await doc.build({ chunkSize: 8, overlap: 0 });
    expect(result.cached).toBe(true);
    expect(await doc.search("refund", { filter: { tenant: "globex" } })).not.toEqual([]);
  });

  it("rejects invalid filters and reserved or non-scalar metadata", async () => {
    const doc = await handbook();
    await expect(doc.search("refund", { filter: { page: { ne: 3 } } as never })).rejects.toThrow(
      ConfigError,
    );
    expect(() => new Document("x.md", { metadata: { page: 3 } })).toThrow(ConfigError);
    expect(() => new Document("x.md", { metadata: { tags: ["a"] } as never })).toThrow(ConfigError);
  });
});

describe("DocumentCollection filter", () => {
  it.each(MODES)("filters by source across documents in %s mode", async (mode) => {
    ws.file("docs/a.md", "# A\nThe refund window is 30 days.");
    ws.file("docs/b.md", "# B\nA refund needs a receipt.");
    const collection = new DocumentCollection(join(ws.root, "docs"), silent());
    await collection.build();

    const all = await collection.search("refund", { mode, topK: 10 });
    expect(new Set(all.map((h) => h.metadata.source))).toEqual(new Set(["a.md", "b.md"]));

    const hits = await collection.search("refund", { mode, topK: 10, filter: { source: "b.md" } });
    expect(hits.map((h) => h.metadata.source)).toEqual(["b.md"]);
  });
});

describe("HTTP API filter", () => {
  it("accepts filter on /search and answers 400 for an invalid one", async () => {
    const app = buildApp(await handbook(), {});
    const post = (body: unknown) =>
      app.request("/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const ok = await post({ query: "refund", topK: 10, filter: { section: "Billing" } });
    expect(ok.status).toBe(200);
    const { results } = (await ok.json()) as { results: SearchResult[] };
    expect(sections(results)).toEqual(["Billing"]);

    const bad = await post({ query: "refund", filter: { section: { like: "B%" } } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("ConfigError");
  });
});
