import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
const { FileNotIndexedError, LoaderError, RagLiteError } = await import("../../src/errors.js");

const SAMPLE = `
Acme Corp Refund Policy. We offer a full refund within 30 days of purchase.

Shipping Policy. Standard shipping takes 3 to 5 business days.

Warranty. All products carry a one-year warranty covering manufacturing defects.

Privacy. We do not sell your personal data.
`.trim();

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
  mockEmbedder.embedDocumentsCalls = 0;
  mockEmbedder.embedQueryCalls = 0;
});
afterEach(() => ws.cleanup());

describe("Document.build", () => {
  it("chunks, embeds, and persists to a per-doc namespace", async () => {
    const p = ws.file("policy.txt", SAMPLE);
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent",
    });

    const result = await doc.build();
    expect(result.cached).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.embeddingProvider).toBe("local");
    expect(result.dimensions).toBe(16);
    expect(mockEmbedder.embedDocumentsCalls).toBe(1);

    const ns = doc.storeNamespace;
    expect(ns).toMatch(/^[0-9a-f]{16}$/);
    expect(existsSync(join(ws.root, ".raglite", ns, "chunks.json"))).toBe(true);
    expect(existsSync(join(ws.root, ".raglite", ns, "metadata.json"))).toBe(true);

    const meta = JSON.parse(
      await readFile(join(ws.root, ".raglite", ns, "metadata.json"), "utf-8"),
    );
    expect(meta.chunkSize).toBe(20);
    expect(meta.overlap).toBe(5);
    expect(meta.embeddingProvider).toBe("local");
    expect(meta.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("second build() reuses the cache and does not re-embed", async () => {
    const p = ws.file("policy.txt", SAMPLE);
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent",
    });
    await doc.build();
    expect(mockEmbedder.embedDocumentsCalls).toBe(1);

    const again = await doc.build();
    expect(again.cached).toBe(true);
    expect(mockEmbedder.embedDocumentsCalls).toBe(1);
  });

  it("invalidates cache when chunkSize changes", async () => {
    const p = ws.file("policy.txt", SAMPLE);
    const first = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent",
    });
    await first.build();
    const initialCount = mockEmbedder.embedDocumentsCalls;

    const second = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 30,
      overlap: 5,
      logLevel: "silent",
    });
    const rebuilt = await second.build();
    expect(rebuilt.cached).toBe(false);
    expect(mockEmbedder.embedDocumentsCalls).toBeGreaterThan(initialCount);
  });

  it("invalidates cache when file contents change", async () => {
    const p = ws.file("policy.txt", SAMPLE);
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent",
    });
    await doc.build();
    const before = mockEmbedder.embedDocumentsCalls;

    ws.file("policy.txt", `${SAMPLE}\n\nExtra new paragraph.`);
    const rebuilt = await doc.build();
    expect(rebuilt.cached).toBe(false);
    expect(mockEmbedder.embedDocumentsCalls).toBeGreaterThan(before);
  });

  it("rebuild: true forces re-embedding even with matching cache", async () => {
    const p = ws.file("policy.txt", SAMPLE);
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent",
    });
    await doc.build();
    const before = mockEmbedder.embedDocumentsCalls;

    const rebuilt = await doc.build({ rebuild: true });
    expect(rebuilt.cached).toBe(false);
    expect(mockEmbedder.embedDocumentsCalls).toBeGreaterThan(before);
  });

  it("assigns different namespaces to different documents", async () => {
    const a = ws.file("a.txt", "Alpha document text.");
    const b = ws.file("b.txt", "Beta document text.");
    const docA = new Document(a, { storeDir: join(ws.root, ".raglite"), logLevel: "silent" });
    const docB = new Document(b, { storeDir: join(ws.root, ".raglite"), logLevel: "silent" });
    expect(docA.storeNamespace).not.toBe(docB.storeNamespace);
  });

  it("throws LoaderError if file does not exist", async () => {
    const doc = new Document("/nonexistent/definitely-not-here.txt", {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await expect(doc.build()).rejects.toThrow(LoaderError);
  });
});

describe("Document.search", () => {
  it("returns hits ordered by cosine score", async () => {
    const p = ws.file(
      "kb.txt",
      [
        "The refund window is thirty days.",
        "Shipping to the continental US takes 3-5 business days.",
        "The warranty covers manufacturing defects only.",
        "We never sell your personal data.",
      ].join("\n\n"),
    );

    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 12,
      overlap: 2,
      logLevel: "silent",
    });
    await doc.build();

    const hits = await doc.search("refund window", { topK: 4 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits.at(-1)!.score);
    for (const h of hits) {
      expect(h.score).toBeGreaterThanOrEqual(-1);
      expect(h.score).toBeLessThanOrEqual(1.00001);
      expect(h.distance).toBeCloseTo(1 - h.score, 6);
    }
  });

  it("throws FileNotIndexedError if build() was never called", async () => {
    const p = ws.file("kb.txt", "hello");
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await expect(doc.search("hello")).rejects.toThrow(FileNotIndexedError);
  });

  it("respects scoreThreshold", async () => {
    const p = ws.file("kb.txt", "alpha\n\nbeta\n\ngamma");
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 5,
      overlap: 1,
      logLevel: "silent",
    });
    await doc.build();
    const hits = await doc.search("alpha", { topK: 3, scoreThreshold: 0.99 });
    expect(hits.every((h) => h.score >= 0.99)).toBe(true);
  });
});

describe("Document.ask", () => {
  it("throws when no LLM provider is configured", async () => {
    const p = ws.file("kb.txt", "hello");
    const doc = new Document(p, {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await doc.build();
    await expect(doc.ask("anything")).rejects.toThrow(RagLiteError);
  });
});

describe("Document.fromText", () => {
  it("indexes inline text, reuses it by id, and re-indexes changed text", async () => {
    const opts = {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent" as const,
    };

    const doc = Document.fromText("faq-42", SAMPLE, opts);
    expect((await doc.build()).cached).toBe(false);
    const hits = await doc.search("refund", { topK: 1 });
    expect(hits[0]?.metadata.source).toBe("faq-42");

    expect((await Document.fromText("faq-42", SAMPLE, opts).build()).cached).toBe(true);
    expect((await Document.fromText("faq-42", `${SAMPLE} Updated.`, opts).build()).cached).toBe(
      false,
    );
  });

  it("rejects empty text", async () => {
    const doc = Document.fromText("empty", "", {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
    });
    await expect(doc.build()).rejects.toBeInstanceOf(LoaderError);
  });
});

describe("indexes built with a shut-down embedding model", () => {
  async function retiredIndex() {
    const p = ws.file("policy.txt", SAMPLE);
    const opts = {
      storeDir: join(ws.root, ".raglite"),
      chunkSize: 20,
      overlap: 5,
      logLevel: "silent" as const,
    };
    const doc = new Document(p, opts);
    await doc.build();
    // Pretend it was built with Google's text-embedding-004, which Google has shut down.
    const metaPath = join(ws.root, ".raglite", doc.storeNamespace, "metadata.json");
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    await writeFile(
      metaPath,
      JSON.stringify({
        ...meta,
        embeddingProvider: "google",
        embeddingModel: "text-embedding-004",
      }),
    );
    mockEmbedder.embedDocumentsCalls = 0;
    return { p, opts };
  }

  it("search() without build() explains how to fix it", async () => {
    const { p, opts } = await retiredIndex();
    await expect(new Document(p, opts).search("refund")).rejects.toThrow(
      /shut down.*Call build\(\)/,
    );
  });

  it("build() re-embeds with the current default model", async () => {
    const { p, opts } = await retiredIndex();
    expect((await new Document(p, opts).build()).cached).toBe(false);
    expect(mockEmbedder.embedDocumentsCalls).toBe(1);
  });

  it("build() keeps the index when that model is requested explicitly", async () => {
    const { p, opts } = await retiredIndex();
    const embeddings = { provider: "google" as const, model: "text-embedding-004" };
    expect((await new Document(p, { ...opts, embeddings }).build()).cached).toBe(true);
    expect(mockEmbedder.embedDocumentsCalls).toBe(0);
  });
});
