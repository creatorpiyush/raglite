import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PineconeVectorStore } from "../../src/vectordb/pinecone.js";
import { QdrantVectorStore } from "../../src/vectordb/qdrant.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

describe("Custom Vector DBs", () => {
  let ws: TempWorkspace;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    ws = makeTempWorkspace();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    ws.cleanup();
  });

  describe("QdrantVectorStore", () => {
    it("interacts with Qdrant REST endpoints", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/collections/raglite_test-ns")) {
          if (init?.method === "GET") return new Response(null, { status: 404 });
          if (init?.method === "PUT")
            return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
          if (init?.method === "DELETE")
            return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (url.includes("/points?wait=true")) {
          return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
        }
        if (url.includes("/points/search")) {
          return new Response(
            JSON.stringify({
              result: [
                {
                  id: "some-uuid",
                  score: 0.9,
                  payload: {
                    id: "chunk-id",
                    text: "Qdrant content",
                    metadata: { source: "doc.txt" },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/points") && init?.method === "POST") {
          // fetch metadata
          return new Response(
            JSON.stringify({
              result: [
                {
                  id: "00000000-0000-0000-0000-000000000000",
                  payload: {
                    isMetadata: true,
                    metadata: {
                      version: "1.0.0",
                      source: "doc.txt",
                      sourceHash: "hash123",
                      chunkSize: 100,
                      overlap: 10,
                      embeddingProvider: "local",
                      embeddingModel: "m",
                      embeddingDimensions: 3,
                      chunkCount: 1,
                      createdAt: new Date().toISOString(),
                    },
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      });

      globalThis.fetch = mockFetch;

      const store = new QdrantVectorStore(
        { provider: "qdrant", url: "http://qdrant:6333", apiKey: "secret" },
        "test-ns",
      );

      // read metadata
      const meta = await store.readIndexMetadata();
      expect(meta).not.toBeNull();
      expect(meta?.sourceHash).toBe("hash123");
      expect(store.count()).toBe(1);

      // add points
      await store.add([
        {
          id: "chunk-id",
          text: "hello",
          embedding: [1, 2, 3],
          metadata: { source: "doc.txt", chunk: 1, totalChunks: 1 },
        },
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/collections/raglite_test-ns/points?wait=true"),
        expect.any(Object),
      );

      // search
      const hits = await store.search([1, 2, 3], 1);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.text).toBe("Qdrant content");
      expect(hits[0]?.score).toBe(0.9);

      // reset
      await store.reset();
      expect(store.count()).toBe(0);
    });

    it("lists stored chunks across scroll pages, skipping the metadata point", async () => {
      const bodies: Record<string, unknown>[] = [];
      const point = (id: string, n: number) => ({
        id: `uuid-${id}`,
        payload: { id, text: `text ${n}`, metadata: { source: "a.txt", chunk: n, totalChunks: 3 } },
      });
      const pages = [
        { points: [point("ns_000003", 3), { id: "m", payload: { isMetadata: true } }], next: "p2" },
        { points: [point("ns_000001", 1), point("ns_000002", 2)], next: null },
      ];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        expect(url).toBe("http://qdrant:6333/collections/shared/points/scroll");
        const body = JSON.parse(init!.body as string);
        bodies.push(body);
        const page = pages[bodies.length - 1]!;
        return new Response(
          JSON.stringify({ result: { points: page.points, next_page_offset: page.next } }),
          { status: 200 },
        );
      });

      const store = new QdrantVectorStore(
        { provider: "qdrant", url: "http://qdrant:6333", indexName: "shared" },
        "ns",
      );
      const chunks = await store.listChunks();
      expect(chunks.map((c) => c.id)).toEqual(["ns_000001", "ns_000002", "ns_000003"]);
      expect(chunks[0]!.text).toBe("text 1");
      expect(bodies[0]!.with_vector).toBe(false);
      expect(JSON.stringify(bodies[0]!.filter)).toContain('"value":"ns"');
      expect(bodies[1]!.offset).toBe("p2");
    });

    it("scopes reset, search and metadata to its namespace in a shared collection", async () => {
      const calls: { url: string; method?: string; body?: Record<string, unknown> }[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        if (url.endsWith("/points/search")) {
          return new Response(JSON.stringify({ result: [] }), { status: 200 });
        }
        if (url.endsWith("/collections/shared") && init?.method === "GET") {
          return new Response(null, { status: 200 });
        }
        return new Response(JSON.stringify({ result: [] }), { status: 200 });
      });

      const config = {
        provider: "qdrant" as const,
        url: "http://qdrant:6333",
        indexName: "shared",
      };
      const a = new QdrantVectorStore(config, "ns-a");
      const b = new QdrantVectorStore(config, "ns-b");

      await a.reset();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
      const del = calls.find((c) => c.url.includes("/collections/shared/points/delete"));
      expect(JSON.stringify(del?.body)).toContain('"value":"ns-a"');

      await a.add([
        {
          id: "ns-a_000001",
          text: "hello",
          embedding: [1, 0, 0],
          metadata: { source: "a.txt", chunk: 1, totalChunks: 1 },
        },
      ]);
      const upsert = calls.find((c) => c.url.includes("/points?wait=true"));
      expect(JSON.stringify(upsert?.body)).toContain('"namespace":"ns-a"');

      await a.search([1, 0, 0], 3);
      const search = calls.find((c) => c.url.endsWith("/points/search"));
      expect(JSON.stringify(search?.body?.filter)).toContain('"value":"ns-a"');

      await a.readIndexMetadata();
      await b.readIndexMetadata();
      const metaIds = calls
        .filter((c) => c.url.endsWith("/collections/shared/points") && c.method === "POST")
        .map((c) => (c.body?.ids as string[] | undefined)?.[0]);
      expect(metaIds).toHaveLength(2);
      expect(metaIds[0]).not.toBe(metaIds[1]);
    });

    it("sends a chunk filter as payload conditions, alongside the namespace", async () => {
      const bodies: Record<string, unknown>[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/points/search")) bodies.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ result: [] }), { status: 200 });
      });
      const store = new QdrantVectorStore(
        { provider: "qdrant", url: "http://qdrant:6333", indexName: "shared" },
        "ns-a",
      );
      await store.search([1, 0, 0], 3, {
        section: "Refunds",
        chunk: { in: [1, 2] },
        page: { gte: 3, lt: 5 },
      });
      expect(bodies[0]!.filter).toEqual({
        must: [
          { key: "namespace", match: { value: "ns-a" } },
          { key: "metadata.section", match: { value: "Refunds" } },
          { key: "metadata.chunk", match: { any: [1, 2] } },
          { key: "metadata.page", range: { gte: 3, lt: 5 } },
        ],
      });
    });
  });

  describe("PineconeVectorStore", () => {
    it("interacts with Pinecone REST endpoints", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes("/vectors/upsert")) {
          return new Response(JSON.stringify({ upsertedCount: 1 }), { status: 200 });
        }
        if (url.includes("/query")) {
          return new Response(
            JSON.stringify({
              matches: [
                {
                  id: "chunk-id",
                  score: 0.95,
                  metadata: {
                    text: "Pinecone content",
                    source: "doc.txt",
                    chunk: 1,
                    totalChunks: 1,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/vectors/delete")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        if (url.includes("/vectors/fetch")) {
          return new Response(
            JSON.stringify({
              vectors: {
                __metadata__: {
                  id: "__metadata__",
                  metadata: {
                    isMetadata: true,
                    version: "1.0.0",
                    source: "doc.txt",
                    sourceHash: "pinehash",
                    chunkSize: 100,
                    overlap: 10,
                    embeddingProvider: "local",
                    embeddingModel: "m",
                    embeddingDimensions: 3,
                    chunkCount: 5,
                    createdAt: new Date().toISOString(),
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      });

      globalThis.fetch = mockFetch;

      const store = new PineconeVectorStore(
        { provider: "pinecone", url: "https://index-xyz.svc.pinecone.io", apiKey: "pin-secret" },
        "pine-ns",
      );

      const meta = await store.readIndexMetadata();
      expect(meta).not.toBeNull();
      expect(meta?.sourceHash).toBe("pinehash");
      expect(store.count()).toBe(5);

      await store.add([
        {
          id: "chunk-id",
          text: "hello",
          embedding: [1, 2, 3],
          metadata: { source: "doc.txt", chunk: 1, totalChunks: 1 },
        },
      ]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/vectors/upsert"),
        expect.any(Object),
      );

      const hits = await store.search([1, 2, 3], 1);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.text).toBe("Pinecone content");
      expect(hits[0]?.score).toBe(0.95);

      await store.reset();
      expect(store.count()).toBe(0);
    });

    it("stores page and section, returns them, and sends a chunk filter", async () => {
      let upserted: { vectors: { metadata: Record<string, unknown> }[] } | undefined;
      let query: Record<string, unknown> | undefined;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/vectors/upsert")) upserted = JSON.parse(init!.body as string);
        if (url.endsWith("/query")) {
          query = JSON.parse(init!.body as string);
          return new Response(
            JSON.stringify({
              matches: [
                {
                  id: "c1",
                  score: 0.9,
                  metadata: {
                    text: "t",
                    source: "a.pdf",
                    chunk: 1,
                    totalChunks: 2,
                    page: 3,
                    section: "Refunds",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      });
      const store = new PineconeVectorStore(
        { provider: "pinecone", url: "https://idx.pinecone.io", apiKey: "k" },
        "ns",
      );
      await store.add([
        {
          id: "c1",
          text: "t",
          embedding: [1, 0],
          metadata: { source: "a.pdf", chunk: 1, totalChunks: 2, page: 3, section: "Refunds" },
        },
        {
          id: "c2",
          text: "u",
          embedding: [0, 1],
          metadata: { source: "a.pdf", chunk: 2, totalChunks: 2 },
        },
      ]);
      expect(upserted!.vectors[0]!.metadata).toMatchObject({ page: 3, section: "Refunds" });
      expect(upserted!.vectors[1]!.metadata).not.toHaveProperty("page");

      const hits = await store.search([1, 0], 3, {
        page: { gte: 3 },
        section: { in: ["Refunds"] },
      });
      expect(query!.filter).toEqual({ page: { $gte: 3 }, section: { $in: ["Refunds"] } });
      expect(hits[0]!.metadata).toMatchObject({ page: 3, section: "Refunds" });
    });
  });
});
