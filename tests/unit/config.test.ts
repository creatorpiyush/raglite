import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config.js";
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_STORE_DIRNAME,
  DEFAULT_TOP_K,
} from "../../src/constants.js";

describe("resolveConfig", () => {
  it("applies sensible defaults", () => {
    const c = resolveConfig();
    expect(c.chunkSize).toBe(DEFAULT_CHUNK_SIZE);
    expect(c.overlap).toBe(DEFAULT_CHUNK_OVERLAP);
    expect(c.topK).toBe(DEFAULT_TOP_K);
    expect(c.scoreThreshold).toBe(DEFAULT_SCORE_THRESHOLD);
    expect(c.storeDir).toBe(DEFAULT_STORE_DIRNAME);
    expect(c.embeddings.provider).toBe("local");
    expect(c.llm).toBeUndefined();
    expect(c.logLevel).toBe("info");
    expect(c.vectorStore).toEqual({ provider: "memory", storeDir: DEFAULT_STORE_DIRNAME });
  });

  it("respects user overrides", () => {
    const c = resolveConfig({
      chunkSize: 200,
      overlap: 25,
      topK: 3,
      scoreThreshold: 0.5,
      storeDir: "/tmp/custom",
      logLevel: "debug",
      embeddings: { provider: "openai", apiKey: "sk-x" },
      llm: { provider: "anthropic", apiKey: "ak-x" },
      vectorStore: { provider: "qdrant", url: "http://localhost:6333" },
    });
    expect(c.chunkSize).toBe(200);
    expect(c.overlap).toBe(25);
    expect(c.topK).toBe(3);
    expect(c.scoreThreshold).toBe(0.5);
    expect(c.storeDir).toBe("/tmp/custom");
    expect(c.logLevel).toBe("debug");
    expect(c.embeddings.provider).toBe("openai");
    expect(c.llm?.provider).toBe("anthropic");
    expect(c.vectorStore).toEqual({ provider: "qdrant", url: "http://localhost:6333" });
  });
});
