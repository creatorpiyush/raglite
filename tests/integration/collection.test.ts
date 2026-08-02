import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/api/server.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

const mockEmbedder = new MockEmbedder();

vi.mock("../../src/embeddings/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embeddings/index.js")>();
  return {
    ...actual,
    createEmbedder: async () => mockEmbedder,
  };
});

const { DocumentCollection } = await import("../../src/core/collection.js");

const SAMPLE1 = "Refund Policy. Refunds are issued within 30 days of purchase.";
const SAMPLE2 = "Shipping Info. Delivery takes 2 business days worldwide.";
const SAMPLE3 = JSON.stringify({ product: "Acme Widget", warranty: "1 year" });

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
  mockEmbedder.embedDocumentsCalls = 0;
  mockEmbedder.embedQueryCalls = 0;
});
afterEach(() => ws.cleanup());

describe("DocumentCollection", () => {
  it("indexes and searches across multiple mixed files in a directory", async () => {
    ws.file("policy.txt", SAMPLE1);
    ws.file("shipping.md", SAMPLE2);
    ws.file("product.json", SAMPLE3);

    const collection = new DocumentCollection(ws.root, {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });

    const result = await collection.build();

    expect(result.totalDocuments).toBe(3);
    expect(result.totalChunks).toBe(3);
    expect(result.errors.length).toBe(0);

    const hits = await collection.search("Refund policy", { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.text.includes("Refunds are issued"))).toBe(true);
  });

  it("handles empty or invalid paths gracefully in collection build", async () => {
    const collection = new DocumentCollection([ws.root, "/invalid/nonexistent/path"], {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });

    const result = await collection.build();
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.source.includes("nonexistent"))).toBe(true);
  });

  it("serves REST API endpoint over document collection via Hono fetch", async () => {
    ws.file("policy.txt", SAMPLE1);
    const collection = new DocumentCollection(ws.root, {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await collection.build();

    const app = buildApp(collection, {});

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; chunks: number };
    expect(data.status).toBe("ok");
    expect(data.chunks).toBe(1);

    const searchRes = await app.request("/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "refund policy" }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as { results: unknown[] };
    expect(searchData.results.length).toBe(1);
  });
});
