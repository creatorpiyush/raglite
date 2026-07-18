import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: async () => ({
      text: "Stubbed answer citing [1].",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
    }),
    streamText: () => ({
      textStream: (async function* () {
        yield "Stub";
        yield "bed ";
        yield "stream ";
        yield "answer.";
      })(),
    }),
  };
});

vi.mock("../../src/llm/factory.js", async () => {
  return {
    createLLM: async (config: { provider: string; model?: string; temperature?: number }) => ({
      provider: config.provider,
      model: config.model ?? "stub-model",
      languageModel: { modelId: "stub-model" },
      temperature: config.temperature ?? 0,
    }),
    DEFAULT_LLM_MODELS: {} as Record<string, string>,
  };
});

const { Document } = await import("../../src/core/document.js");
const { buildApp } = await import("../../src/api/server.js");

const SAMPLE = [
  "The refund window is thirty days from purchase.",
  "Shipping to the continental US takes three to five business days.",
  "The warranty covers manufacturing defects only.",
].join("\n\n");

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

async function makeReadyDoc(llm?: { provider: "openai" | "anthropic"; apiKey: string }) {
  const p = ws.file("kb.txt", SAMPLE);
  const doc = new Document(p, {
    storeDir: join(ws.root, ".raglite"),
    chunkSize: 10,
    overlap: 2,
    logLevel: "silent",
    ...(llm ? { llm } : {}),
  });
  await doc.build();
  return doc;
}

describe("Document.ask (with stubbed LLM)", () => {
  it("returns text, provider, model, usage", async () => {
    const doc = await makeReadyDoc({ provider: "openai", apiKey: "sk-test" });
    const result = await doc.ask("How long is the refund window?");
    expect(result.text).toBe("Stubbed answer citing [1].");
    expect(result.provider).toBe("openai");
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("accepts an ask-time override of the LLM provider", async () => {
    const doc = await makeReadyDoc({ provider: "openai", apiKey: "sk-test" });
    const result = await doc.ask("q", { llm: { provider: "anthropic", apiKey: "ak-test" } });
    expect(result.provider).toBe("anthropic");
  });

  it("passes model config through", async () => {
    const doc = await makeReadyDoc();
    const result = await doc.ask("q", {
      llm: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });
    expect(result.model).toBe("gpt-4o-mini");
  });
});

describe("Document.askStream (with stubbed LLM)", () => {
  it("yields text deltas", async () => {
    const doc = await makeReadyDoc({ provider: "openai", apiKey: "sk-test" });
    const chunks: string[] = [];
    for await (const c of doc.askStream("q")) chunks.push(c);
    expect(chunks.join("")).toBe("Stubbed stream answer.");
  });
});

describe("HTTP /ask (with stubbed LLM)", () => {
  it("returns a JSON answer", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, { llm: { provider: "openai", apiKey: "sk-test" } });
    const res = await app.fetch(
      new Request("http://localhost/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "How long is the refund window?" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; provider: string };
    expect(body.text).toBe("Stubbed answer citing [1].");
    expect(body.provider).toBe("openai");
  });

  it("streams when stream: true", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, { llm: { provider: "openai", apiKey: "sk-test" } });
    const res = await app.fetch(
      new Request("http://localhost/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "q", stream: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("Stubbed stream answer.");
  });
});
