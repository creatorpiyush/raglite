import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INDEX_FORMAT_VERSION } from "../../src/constants.js";
import type { EmbeddingProviderConfig, IndexMetadata } from "../../src/types.js";
import { namespaceFromPath } from "../../src/utils/hash.js";
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

describe("Index format version", () => {
  async function buildThenEdit(
    edit: (meta: IndexMetadata) => void,
    text = "Refunds are issued within 30 days.",
  ) {
    const path = ws.file("policy.txt", text);
    const opts = { storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const };
    const doc = new Document(path, opts);
    await doc.build();
    const metaPath = join(ws.root, ".raglite", doc.storeNamespace, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as IndexMetadata;
    expect(meta.formatVersion).toBe(INDEX_FORMAT_VERSION);
    edit(meta);
    writeFileSync(metaPath, JSON.stringify(meta), "utf-8");
    return new Document(path, opts).build();
  }

  it("reuses an index built by a different package version", async () => {
    const result = await buildThenEdit((meta) => {
      meta.version = "9.9.9";
    });
    expect(result.cached).toBe(true);
  });

  it("reuses a 1.2.1 index that predates formatVersion", async () => {
    const result = await buildThenEdit((meta) => {
      meta.version = "1.2.1";
      meta.formatVersion = undefined;
    });
    expect(result.cached).toBe(true);
  });

  it("rebuilds an older index without formatVersion", async () => {
    const result = await buildThenEdit((meta) => {
      meta.version = "1.2.0";
      meta.formatVersion = undefined;
    });
    expect(result.cached).toBe(false);
  });

  it("upgrades a format-1 index in place when chunking is unchanged", async () => {
    const result = await buildThenEdit((meta) => {
      meta.formatVersion = 1;
    });
    expect(result.cached).toBe(true);
    const metaPath = join(ws.root, ".raglite", namespaceOf("policy.txt"), "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as IndexMetadata;
    expect(meta.formatVersion).toBe(INDEX_FORMAT_VERSION);
  });

  it("rebuilds a format-1 index of text written without spaces", async () => {
    const result = await buildThenEdit((meta) => {
      meta.formatVersion = 1;
    }, "返金は三十日以内に行われます。");
    expect(result.cached).toBe(false);
  });

  it("rebuilds an index with a different formatVersion", async () => {
    const result = await buildThenEdit((meta) => {
      meta.formatVersion = INDEX_FORMAT_VERSION + 1;
    });
    expect(result.cached).toBe(false);
  });
});

function namespaceOf(name: string): string {
  return namespaceFromPath(join(ws.root, name));
}

describe("Chunking defaults", () => {
  it("reuses the existing index's chunking when none is given", async () => {
    const path = ws.file("policy.txt", "one two three four five six seven eight nine ten");
    const opts = { storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const };
    const first = await new Document(path, opts).build({ chunkSize: 4, overlap: 1 });
    expect(first.chunkCount).toBe(3);

    const plain = await new Document(path, opts).build();
    expect(plain.cached).toBe(true);
    expect(plain.chunkCount).toBe(3);

    const collection = await new DocumentCollection(path, opts).build();
    expect(collection.cachedDocuments).toBe(1);
  });

  it("rebuilds when chunking is given explicitly", async () => {
    const path = ws.file("policy.txt", "one two three four five six seven eight nine ten");
    const opts = { storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const };
    await new Document(path, opts).build({ chunkSize: 4, overlap: 1 });

    const viaBuild = await new Document(path, opts).build({ chunkSize: 500 });
    expect(viaBuild.cached).toBe(false);
    expect(viaBuild.chunkCount).toBe(1);

    await new Document(path, opts).build({ chunkSize: 4, overlap: 1 });
    const viaConstructor = await new Document(path, { ...opts, chunkSize: 500 }).build();
    expect(viaConstructor.cached).toBe(false);
  });
});

describe("Embedding defaults", () => {
  const opts = () => ({ storeDir: join(ws.root, ".raglite"), logLevel: "silent" as const });

  it("keeps the existing index's provider and model when none is configured", async () => {
    const path = ws.file("policy.txt", "Refunds are issued within 30 days.");
    await new Document(path, {
      ...opts(),
      embeddings: { provider: "openai", model: "text-embedding-3-small", apiKey: "sk-test" },
    }).build();
    embedderConfigs.length = 0;

    const plain = await new Document(path, opts()).build();
    expect(plain.cached).toBe(true);
    expect(plain.embeddingProvider).toBe("openai");
    expect(embedderConfigs[0]).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
    });

    const collection = await new DocumentCollection(path, opts()).build();
    expect(collection.cachedDocuments).toBe(1);
  });

  it("rebuilds when a different provider is configured explicitly", async () => {
    const path = ws.file("policy.txt", "Refunds are issued within 30 days.");
    await new Document(path, { ...opts(), embeddings: { provider: "openai" } }).build();
    const local = await new Document(path, {
      ...opts(),
      embeddings: { provider: "local" },
    }).build();
    expect(local.cached).toBe(false);
    expect(local.embeddingProvider).toBe("local");
  });
});
