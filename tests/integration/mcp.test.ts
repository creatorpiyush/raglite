import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

const mockEmbedder = new MockEmbedder();

vi.mock("../../src/embeddings/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/embeddings/index.js")>()),
  createEmbedder: async () => mockEmbedder,
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: async () => ({ text: "Thirty days [1].", usage: {}, finishReason: "stop" }),
}));

const { DocumentCollection } = await import("../../src/core/collection.js");
const { createMcpServer } = await import("../../src/mcp/server.js");

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

async function connect(llm?: { provider: "openai"; apiKey: string }) {
  ws.file(
    "docs/refunds.txt",
    "The refund window is thirty days. ERR_4021 means the card was declined.",
  );
  ws.file("docs/shipping.md", "# Shipping\n\nDelivery takes three to five business days.");
  const collection = new DocumentCollection(join(ws.root, "docs"), {
    storeDir: join(ws.root, ".raglite"),
    logLevel: "silent",
    ...(llm ? { llm } : {}),
  });
  await collection.build();

  const server = await createMcpServer(collection);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = result.content as { type: string; text: string }[];
  return first!.text;
}

describe("MCP server", () => {
  it("offers search and list_sources, and ask only when an LLM is configured", async () => {
    const without = await connect();
    expect((await without.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "list_sources",
      "search",
    ]);

    const withLlm = await connect({ provider: "openai", apiKey: "sk-test" });
    expect((await withLlm.listTools()).tools.map((t) => t.name).sort()).toEqual([
      "ask",
      "list_sources",
      "search",
    ]);
  });

  it("search returns passages as JSON", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "search",
      arguments: { query: "ERR_4021", mode: "keyword", topK: 1 },
    });
    const hits = JSON.parse(textOf(result));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "refunds.txt", chunk: 1 });
    expect(hits[0].text).toContain("ERR_4021");
  });

  it("ask answers from the documents", async () => {
    const client = await connect({ provider: "openai", apiKey: "sk-test" });
    const result = await client.callTool({
      name: "ask",
      arguments: { question: "Refund window?" },
    });
    expect(textOf(result)).toBe("Thirty days [1].");
  });

  it("list_sources lists each document and its chunk count", async () => {
    const client = await connect();
    const sources = JSON.parse(
      textOf(await client.callTool({ name: "list_sources", arguments: {} })),
    );
    expect(sources.map((s: { source: string }) => s.source).sort()).toEqual([
      "refunds.txt",
      "shipping.md",
    ]);
    expect(sources.every((s: { chunks: number }) => s.chunks === 1)).toBe(true);
  });

  it("reports tool failures as error results", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search", arguments: { query: "x", topK: 999 } });
    expect(result.isError).toBe(true);
  });
});
