import { createHash } from "node:crypto";
import type { Embedder } from "../../src/embeddings/base.js";
import type { EmbeddingProviderName } from "../../src/types.js";

/**
 * Deterministic mock embedder for tests. Same input string always
 * produces the same normalized vector. Useful for asserting on
 * cache invalidation, retrieval ordering, and pipeline plumbing
 * without hitting any network.
 */
export class MockEmbedder implements Embedder {
  readonly provider: EmbeddingProviderName = "local";
  readonly model: string;
  dimensions: number;

  public embedDocumentsCalls = 0;
  public embedQueryCalls = 0;

  constructor(model = "mock-model", dimensions = 16) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.embedDocumentsCalls += 1;
    return texts.map((t) => this.vectorFor(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    this.embedQueryCalls += 1;
    return this.vectorFor(text);
  }

  private vectorFor(text: string): number[] {
    const hash = createHash("sha256").update(text.toLowerCase()).digest();
    const vec: number[] = new Array(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      vec[i] = (hash[i % hash.length]! / 255) * 2 - 1;
    }
    return normalize(vec);
  }
}

function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.slice();
  return vector.map((v) => v / norm);
}
