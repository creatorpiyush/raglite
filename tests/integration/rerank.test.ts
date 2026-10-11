import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "../../src/errors.js";
import type { EmbeddingProviderConfig, SearchResult } from "../../src/types.js";
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

const generateText = vi.fn();
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));

const { Document } = await import("../../src/core/document.js");
const { DocumentCollection } = await import("../../src/core/collection.js");
const { parseRanking } = await import("../../src/retrieval/rerank.js");

let ws: TempWorkspace;
let originalFetch: typeof fetch;
beforeEach(() => {
  ws = makeTempWorkspace();
  originalFetch = globalThis.fetch;
  generateText.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  ws.cleanup();
});

const options = (extra: Record<string, unknown> = {}) => ({
  storeDir: join(ws.root, ".raglite"),
  logLevel: "silent" as const,
  scoreThreshold: -1,
  ...extra,
});

/** Forty one-sentence chunks: "Fact 1 ..." to "Fact 40 ...". */
async function facts(extra: Record<string, unknown> = {}) {
  const text = Array.from({ length: 40 }, (_, i) => `Fact ${i + 1} is here.`).join("\n");
  const doc = new Document(ws.file("facts.txt", text), options(extra));
  await doc.build({ chunkSize: 4, overlap: 0 });
  return doc;
}

const factNumber = (hit: SearchResult) => Number(/Fact (\d+)/.exec(hit.text)![1]);

/** A reranker that puts the highest fact numbers first. */
const byFactDesc = async (_query: string, hits: SearchResult[]) =>
  [...hits].sort((a, b) => factNumber(b) - factNumber(a));

describe("rerank with a function", () => {
  it("reorders the candidates and keeps topK", async () => {
    const doc = await facts();
    const seen: number[] = [];
    const hits = await doc.search("fact", {
      topK: 3,
      rerank: async (query, candidates) => {
        seen.push(candidates.length);
        return byFactDesc(query, candidates);
      },
    });
    expect(seen).toEqual([30]);
    expect(hits).toHaveLength(3);
    const numbers = hits.map(factNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it("uses the constructor default, which rerank: false turns off", async () => {
    const doc = await facts({ rerank: byFactDesc });
    const reranked = await doc.search("fact", { topK: 40 });
    expect(reranked.map(factNumber)).toEqual(Array.from({ length: 40 }, (_, i) => 40 - i));
    const plain = await doc.search("fact", { topK: 40, rerank: false });
    expect(plain.map(factNumber)).not.toEqual(reranked.map(factNumber));
  });

  it("keeps the retrieval order and warns when the reranker fails", async () => {
    const doc = await facts({ logLevel: "warn" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const plain = await doc.search("fact", { topK: 5 });
    const hits = await doc.search("fact", {
      topK: 5,
      rerank: async () => {
        throw new Error("rate limited");
      },
    });
    expect(hits.map((h) => h.id)).toEqual(plain.map((h) => h.id));
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(" ");
    expect(logged).toContain("Reranking failed, keeping the retrieval order: rate limited");
    warn.mockRestore();
    error.mockRestore();
  });

  it("reranks a collection once, over the merged results", async () => {
    ws.file("docs/a.txt", "Fact 1 is here.\nFact 2 is here.");
    ws.file("docs/b.txt", "Fact 3 is here.\nFact 4 is here.");
    const calls: number[] = [];
    const collection = new DocumentCollection(
      join(ws.root, "docs"),
      options({ chunkSize: 4, overlap: 0 }),
    );
    const hits = await collection.search("fact", {
      topK: 2,
      rerank: async (query, candidates) => {
        calls.push(candidates.length);
        return byFactDesc(query, candidates);
      },
    });
    expect(calls).toEqual([4]);
    expect(hits.map(factNumber)).toEqual([4, 3]);
  });
});

describe("rerank providers", () => {
  it("calls Cohere's rerank API and records the score", async () => {
    const doc = await facts();
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { documents: string[] };
      requests.push({ url: String(url), body });
      const last = body.documents.length - 1;
      return new Response(
        JSON.stringify({
          results: [
            { index: last, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.4 },
          ],
          meta: {},
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const plain = await doc.search("fact", { topK: 30, rerank: false });
    const hits = await doc.search("fact", {
      topK: 2,
      rerank: { provider: "cohere", apiKey: "k", candidates: 30 },
    });
    expect(requests[0]!.url).toBe("https://api.cohere.com/v2/rerank");
    expect(requests[0]!.body).toMatchObject({ model: "rerank-v3.5", query: "fact" });
    expect(hits.map((h) => h.id)).toEqual([plain[29]!.id, plain[0]!.id]);
    expect(hits[0]).toMatchObject({ score: 0.9, scores: { rerank: 0.9 } });
    expect(hits[0]!.scores!.vector).toBeCloseTo(plain[29]!.score, 6);
    expect(hits[0]!.distance).toBeCloseTo(0.1, 6);
  });

  it("calls Voyage's rerank API", async () => {
    const doc = await facts();
    let url = "";
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      const body = JSON.parse(init!.body as string) as { model: string };
      expect(body.model).toBe("rerank-2.5");
      return new Response(
        JSON.stringify({
          object: "list",
          data: [{ index: 1, relevance_score: 0.7 }],
          model: body.model,
          usage: { total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const plain = await doc.search("fact", { topK: 30 });
    const hits = await doc.search("fact", { topK: 1, rerank: { provider: "voyage", apiKey: "k" } });
    expect(url).toBe("https://api.voyageai.com/v1/rerank");
    expect(hits.map((h) => h.id)).toEqual([plain[1]!.id]);
  });

  it("asks the LLM for an order and scores by rank", async () => {
    const doc = await facts({ llm: { provider: "openai", apiKey: "k" } });
    const plain = await doc.search("fact", { topK: 3 });
    generateText.mockResolvedValue({ text: "Sure: [3, 1]" });
    const hits = await doc.search("fact", {
      topK: 3,
      rerank: { provider: "llm", candidates: 3 },
    });
    expect(generateText).toHaveBeenCalledOnce();
    expect(hits.map((h) => h.id)).toEqual([plain[2]!.id, plain[0]!.id, plain[1]!.id]);
    expect(hits.map((h) => h.scores!.rerank)).toEqual([1, 2 / 3, 1 / 3]);
  });

  it("rejects an unknown provider, bad candidates, and llm without an LLM", async () => {
    const doc = await facts();
    await expect(doc.search("fact", { rerank: { provider: "jina" as never } })).rejects.toThrow(
      ConfigError,
    );
    await expect(
      doc.search("fact", { rerank: { provider: "cohere", candidates: 0 } }),
    ).rejects.toThrow(ConfigError);
    await expect(doc.search("fact", { rerank: { provider: "llm" } })).rejects.toThrow(ConfigError);
  });
});

describe("parseRanking", () => {
  it.each<[string, number, number[]]>([
    ["[2, 1]", 3, [1, 0]],
    ["Here you go:\n[3,3, 9, 0, 1]", 3, [2, 0]],
    ["[]", 3, []],
  ])("%j", (text, count, expected) => {
    expect(parseRanking(text, count)).toEqual(expected);
  });

  it("throws without an array", () => {
    expect(() => parseRanking("passage 2 is best", 3)).toThrow();
  });
});
