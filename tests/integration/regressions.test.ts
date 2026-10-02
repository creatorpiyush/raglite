import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingProviderConfig } from "../../src/types.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

const embedderConfigs: EmbeddingProviderConfig[] = [];

vi.mock("../../src/embeddings/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embeddings/index.js")>();
  return {
    ...actual,
    createEmbedder: async (config: EmbeddingProviderConfig) => {
      embedderConfigs.push(config);
      const embedder = new MockEmbedder(config.model ?? "mock-model");
      Object.defineProperty(embedder, "provider", { value: config.provider });
      return embedder;
    },
  };
});

const { Document } = await import("../../src/core/document.js");
const { DocumentCollection } = await import("../../src/core/collection.js");

let ws: TempWorkspace;
let originalFetch: typeof fetch;
beforeEach(() => {
  ws = makeTempWorkspace();
  originalFetch = globalThis.fetch;
  embedderConfigs.length = 0;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  ws.cleanup();
});

function servePage(body: () => string): void {
  globalThis.fetch = vi
    .fn()
    .mockImplementation(
      async () => new Response(body(), { status: 200, headers: { "content-type": "text/plain" } }),
    );
}

describe("URL sources", () => {
  it("re-indexes when the page content changes", async () => {
    let page = "Refunds are issued within 30 days.";
    servePage(() => page);
    const opts = { storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const };

    const first = await new Document("https://example.com/policy", opts).build();
    expect(first.cached).toBe(false);

    const unchanged = await new Document("https://example.com/policy", opts).build();
    expect(unchanged.cached).toBe(true);

    page = "Refunds are issued within 60 days.";
    const changed = await new Document("https://example.com/policy", opts).build();
    expect(changed.cached).toBe(false);
  });
});

describe("Query embedder after reload", () => {
  it("uses the provider and model the index was built with", async () => {
    const path = ws.file("policy.txt", "Refunds are issued within 30 days.");
    const opts = { storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const };

    await new Document(path, opts).build({
      embeddings: { provider: "openai", model: "text-embedding-3-small" },
    });

    embedderConfigs.length = 0;
    await new Document(path, opts).search("refund");

    expect(embedderConfigs).toEqual([{ provider: "openai", model: "text-embedding-3-small" }]);
  });

  it("reuses configured credentials when the provider matches", async () => {
    const path = ws.file("policy.txt", "Refunds are issued within 30 days.");
    const opts = {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent" as const,
      embeddings: { provider: "openai" as const, apiKey: "sk-test" },
    };

    await new Document(path, opts).build();
    embedderConfigs.length = 0;
    await new Document(path, opts).search("refund");

    expect(embedderConfigs[0]).toMatchObject({ provider: "openai", apiKey: "sk-test" });
  });
});

describe("DocumentCollection.search failures", () => {
  async function buildCollection() {
    ws.file("policy.txt", "Refunds are issued within 30 days.");
    ws.file("shipping.txt", "Delivery takes 2 business days.");
    const collection = new DocumentCollection(ws.root, {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await collection.build();
    return collection;
  }

  it("returns results from healthy documents when one fails", async () => {
    const collection = await buildCollection();
    const [broken] = collection.getDocuments();
    vi.spyOn(broken!, "search").mockRejectedValue(new Error("boom"));

    const hits = await collection.search("refund", { topK: 5, scoreThreshold: -1 });
    expect(hits).toHaveLength(1);
  });

  it("throws when every document fails", async () => {
    const collection = await buildCollection();
    for (const doc of collection.getDocuments()) {
      vi.spyOn(doc, "search").mockRejectedValue(new Error("bad api key"));
    }

    await expect(collection.search("refund")).rejects.toThrow("bad api key");
  });
});
