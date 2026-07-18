import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VectorDBError } from "../errors.js";
import type { IndexMetadata, StoredChunk } from "../types.js";
import type { VectorSearchHit, VectorStore } from "./base.js";

/**
 * Simple in-memory vector store with JSON persistence.
 *
 * - Vectors are assumed to be L2-normalized by the embedder, so
 *   similarity is a plain dot product (== cosine similarity).
 * - Each store lives in its own namespaced directory, so two
 *   `Document` instances cannot collide.
 */
export class MemoryVectorStore implements VectorStore {
  readonly namespace: string;
  private readonly storeDir: string;
  private readonly chunksPath: string;
  private readonly metadataPath: string;
  private chunks: StoredChunk[] = [];

  constructor(storeDir: string, namespace: string) {
    this.namespace = namespace;
    this.storeDir = join(storeDir, namespace);
    this.chunksPath = join(this.storeDir, "chunks.json");
    this.metadataPath = join(this.storeDir, "metadata.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.chunksPath)) {
      this.chunks = [];
      return;
    }
    try {
      const raw = await readFile(this.chunksPath, "utf-8");
      const parsed = JSON.parse(raw) as StoredChunk[];
      this.chunks = parsed;
    } catch (cause) {
      throw new VectorDBError(`Failed to load vector store at ${this.chunksPath}`, {
        cause,
      });
    }
  }

  async reset(): Promise<void> {
    this.chunks = [];
    if (existsSync(this.storeDir)) {
      await rm(this.storeDir, { recursive: true, force: true });
    }
  }

  async add(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    this.chunks = this.chunks.concat(chunks);
    await this.persist();
  }

  async search(embedding: number[], topK: number): Promise<VectorSearchHit[]> {
    if (this.chunks.length === 0) return [];

    const scored: VectorSearchHit[] = new Array(this.chunks.length);
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i]!;
      const score = dot(embedding, c.embedding);
      scored[i] = {
        id: c.id,
        text: c.text,
        metadata: c.metadata,
        score,
        distance: 1 - score,
      };
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  count(): number {
    return this.chunks.length;
  }

  async saveIndexMetadata(metadata: IndexMetadata): Promise<void> {
    await mkdir(dirname(this.metadataPath), { recursive: true });
    await writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  async readIndexMetadata(): Promise<IndexMetadata | null> {
    if (!existsSync(this.metadataPath)) return null;
    try {
      const raw = await readFile(this.metadataPath, "utf-8");
      return JSON.parse(raw) as IndexMetadata;
    } catch (cause) {
      throw new VectorDBError(`Failed to read index metadata at ${this.metadataPath}`, {
        cause,
      });
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.chunksPath), { recursive: true });
    await writeFile(this.chunksPath, JSON.stringify(this.chunks), "utf-8");
  }
}

function dot(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i]! * b[i]!;
  return sum;
}
