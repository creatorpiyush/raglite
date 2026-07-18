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

async function makeReadyDoc() {
  const p = ws.file("kb.txt", SAMPLE);
  const doc = new Document(p, {
    storeDir: join(ws.root, ".raglite"),
    chunkSize: 10,
    overlap: 2,
    logLevel: "silent",
  });
  await doc.build();
  return doc;
}

describe("HTTP API", () => {
  it("GET /health is open (no auth) and reports index stats", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, { bearerToken: "secret" });
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; chunks: number };
    expect(body.status).toBe("ok");
    expect(body.chunks).toBeGreaterThan(0);
  });

  it("GET /info requires auth when token is configured", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, { bearerToken: "secret" });

    const missing = await app.fetch(new Request("http://localhost/info"));
    expect(missing.status).toBe(401);

    const wrong = await app.fetch(
      new Request("http://localhost/info", {
        headers: { authorization: "Bearer nope" },
      }),
    );
    expect(wrong.status).toBe(401);

    const ok = await app.fetch(
      new Request("http://localhost/info", {
        headers: { authorization: "Bearer secret" },
      }),
    );
    expect(ok.status).toBe(200);
    const info = (await ok.json()) as { chunks: number; embeddings: { provider: string } };
    expect(info.chunks).toBeGreaterThan(0);
    expect(info.embeddings.provider).toBe("local");
  });

  it("POST /search returns cosine-scored hits", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, {});

    const res = await app.fetch(
      new Request("http://localhost/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "refund window", topK: 3 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { text: string; score: number; distance: number }[];
    };
    expect(body.results.length).toBeGreaterThan(0);
    for (const hit of body.results) {
      expect(hit.score).toBeGreaterThanOrEqual(-1);
      expect(hit.score).toBeLessThanOrEqual(1.00001);
      expect(hit.distance).toBeCloseTo(1 - hit.score, 6);
    }
  });

  it("POST /search rejects invalid payloads with 400", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, {});
    const res = await app.fetch(
      new Request("http://localhost/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topK: 3 }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ValidationError");
  });

  it("POST /ask returns 503 when no LLM is configured on the server", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, {});
    const res = await app.fetch(
      new Request("http://localhost/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "How long is the refund window?" }),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("AskDisabled");
  });

  it("bearer-token auth exempts /health only", async () => {
    const doc = await makeReadyDoc();
    const app = buildApp(doc, { bearerToken: "s3cr3t" });

    const health = await app.fetch(new Request("http://localhost/health"));
    expect(health.status).toBe(200);

    const search = await app.fetch(
      new Request("http://localhost/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "x" }),
      }),
    );
    expect(search.status).toBe(401);
  });
});
