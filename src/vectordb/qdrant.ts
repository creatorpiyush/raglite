import { createHash } from "node:crypto";
import { VectorDBError } from "../errors.js";
import type {
  ChunkMetadata,
  IndexMetadata,
  StoredChunk,
  VectorStoreProviderConfig,
} from "../types.js";
import type { VectorSearchHit, VectorStore } from "./base.js";

function stringToUuid(str: string): string {
  const hash = createHash("md5").update(str).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

const METADATA_UUID = "00000000-0000-0000-0000-000000000000";

export class QdrantVectorStore implements VectorStore {
  readonly namespace: string;
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly collectionName: string;
  private cachedCount = 0;

  constructor(config: VectorStoreProviderConfig, namespace: string) {
    this.namespace = namespace;
    this.url = (config.url ?? "http://127.0.0.1:6333").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.collectionName = config.indexName ?? `raglite_${namespace}`;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h["api-key"] = this.apiKey;
    }
    return h;
  }

  async load(): Promise<void> {
    // Attempt to pre-fetch metadata to populate cachedCount
    await this.readIndexMetadata();
  }

  async reset(): Promise<void> {
    this.cachedCount = 0;
    try {
      const res = await fetch(`${this.url}/collections/${this.collectionName}`, {
        method: "DELETE",
        headers: this.headers,
      });
      if (res.status !== 200 && res.status !== 404) {
        throw new Error(`Delete collection failed: ${res.statusText}`);
      }
    } catch (cause) {
      throw new VectorDBError(`Failed to delete Qdrant collection ${this.collectionName}`, {
        cause,
      });
    }
  }

  private async ensureCollection(dimensions: number): Promise<void> {
    try {
      const check = await fetch(`${this.url}/collections/${this.collectionName}`, {
        method: "GET",
        headers: this.headers,
      });
      if (check.status === 200) return;

      const create = await fetch(`${this.url}/collections/${this.collectionName}`, {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify({
          vectors: {
            size: dimensions,
            distance: "Cosine",
          },
        }),
      });
      if (create.status !== 200) {
        const errBody = await create.text();
        throw new Error(`Create collection returned status ${create.status}: ${errBody}`);
      }
    } catch (cause) {
      throw new VectorDBError(`Failed to ensure Qdrant collection ${this.collectionName}`, {
        cause,
      });
    }
  }

  async add(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const dims = chunks[0]!.embedding.length;
    await this.ensureCollection(dims);

    const points = chunks.map((c) => ({
      id: stringToUuid(c.id),
      vector: c.embedding,
      payload: {
        id: c.id,
        text: c.text,
        metadata: c.metadata,
      },
    }));

    try {
      const res = await fetch(`${this.url}/collections/${this.collectionName}/points?wait=true`, {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify({ points }),
      });
      if (res.status !== 200) {
        const errBody = await res.text();
        throw new Error(`Upsert returned status ${res.status}: ${errBody}`);
      }
      this.cachedCount += chunks.length;
    } catch (cause) {
      throw new VectorDBError(
        `Failed to upsert points to Qdrant collection ${this.collectionName}`,
        { cause },
      );
    }
  }

  async search(embedding: number[], topK: number): Promise<VectorSearchHit[]> {
    try {
      const res = await fetch(`${this.url}/collections/${this.collectionName}/points/search`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          vector: embedding,
          limit: topK + 1, // +1 in case metadata point matches
          with_payload: true,
        }),
      });
      if (res.status !== 200) {
        return [];
      }
      const data = (await res.json()) as {
        result: Array<{
          id: string;
          score: number;
          payload?: {
            id?: string;
            text?: string;
            metadata?: ChunkMetadata;
            isMetadata?: boolean;
          };
        }>;
      };

      const hits: VectorSearchHit[] = [];
      for (const r of data.result) {
        if (r.id === METADATA_UUID || r.payload?.isMetadata) continue;
        hits.push({
          id: r.payload?.id ?? r.id,
          text: r.payload?.text ?? "",
          metadata: r.payload?.metadata ?? { source: "", chunk: 0, totalChunks: 0 },
          score: r.score,
          distance: 1 - r.score,
        });
      }
      return hits.slice(0, topK);
    } catch (cause) {
      throw new VectorDBError(`Failed to search Qdrant collection ${this.collectionName}`, {
        cause,
      });
    }
  }

  count(): number {
    return this.cachedCount;
  }

  async saveIndexMetadata(metadata: IndexMetadata): Promise<void> {
    const dims = metadata.embeddingDimensions;
    await this.ensureCollection(dims);

    this.cachedCount = metadata.chunkCount;

    const zeroVector = new Array(dims).fill(0);
    const point = {
      id: METADATA_UUID,
      vector: zeroVector,
      payload: {
        isMetadata: true,
        metadata,
      },
    };

    try {
      const res = await fetch(`${this.url}/collections/${this.collectionName}/points?wait=true`, {
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify({ points: [point] }),
      });
      if (res.status !== 200) {
        const errBody = await res.text();
        throw new Error(`Save metadata returned status ${res.status}: ${errBody}`);
      }
    } catch (cause) {
      throw new VectorDBError(
        `Failed to save metadata in Qdrant collection ${this.collectionName}`,
        { cause },
      );
    }
  }

  async readIndexMetadata(): Promise<IndexMetadata | null> {
    try {
      const res = await fetch(`${this.url}/collections/${this.collectionName}/points`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          ids: [METADATA_UUID],
          with_payload: true,
        }),
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        return null;
      }
      const data = (await res.json()) as {
        result: Array<{
          id: string;
          payload?: {
            isMetadata?: boolean;
            metadata?: IndexMetadata;
          };
        }>;
      };
      const point = data.result[0];
      if (point?.payload?.isMetadata && point?.payload?.metadata) {
        const meta = point.payload.metadata;
        this.cachedCount = meta.chunkCount;
        return meta;
      }
      return null;
    } catch {
      return null;
    }
  }
}
