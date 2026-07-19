import { VectorDBError } from "../errors.js";
import type {
  EmbeddingProviderName,
  IndexMetadata,
  StoredChunk,
  VectorStoreProviderConfig,
} from "../types.js";
import type { VectorSearchHit, VectorStore } from "./base.js";

const METADATA_ID = "__metadata__";

export class PineconeVectorStore implements VectorStore {
  readonly namespace: string;
  private readonly url: string;
  private readonly apiKey: string;
  private cachedCount = 0;

  constructor(config: VectorStoreProviderConfig, namespace: string) {
    this.namespace = namespace;
    if (!config.url) {
      throw new VectorDBError(
        "Pinecone provider requires a 'url' (Index Host URL) in the configuration.",
      );
    }
    if (!config.apiKey) {
      throw new VectorDBError("Pinecone provider requires an 'apiKey' in the configuration.");
    }
    this.url = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Api-Key": this.apiKey,
    };
  }

  async load(): Promise<void> {
    await this.readIndexMetadata();
  }

  async reset(): Promise<void> {
    this.cachedCount = 0;
    try {
      const res = await fetch(`${this.url}/vectors/delete`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          deleteAll: true,
          namespace: this.namespace,
        }),
      });
      if (res.status !== 200) {
        const errBody = await res.text();
        throw new Error(`Delete all failed with status ${res.status}: ${errBody}`);
      }
    } catch (cause) {
      throw new VectorDBError(`Failed to reset Pinecone namespace ${this.namespace}`, { cause });
    }
  }

  async add(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const vectors = chunks.map((c) => ({
      id: c.id,
      values: c.embedding,
      metadata: {
        text: c.text,
        source: c.metadata.source,
        chunk: c.metadata.chunk,
        totalChunks: c.metadata.totalChunks,
      },
    }));

    try {
      const res = await fetch(`${this.url}/vectors/upsert`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          vectors,
          namespace: this.namespace,
        }),
      });
      if (res.status !== 200) {
        const errBody = await res.text();
        throw new Error(`Upsert returned status ${res.status}: ${errBody}`);
      }
      this.cachedCount += chunks.length;
    } catch (cause) {
      throw new VectorDBError(`Failed to upsert vectors to Pinecone namespace ${this.namespace}`, {
        cause,
      });
    }
  }

  async search(embedding: number[], topK: number): Promise<VectorSearchHit[]> {
    try {
      const res = await fetch(`${this.url}/query`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          vector: embedding,
          topK: topK + 1,
          includeMetadata: true,
          namespace: this.namespace,
        }),
      });
      if (res.status !== 200) {
        return [];
      }
      const data = (await res.json()) as {
        matches: Array<{
          id: string;
          score: number;
          metadata?: {
            text?: string;
            source?: string;
            chunk?: number;
            totalChunks?: number;
            isMetadata?: boolean;
          };
        }>;
      };

      const hits: VectorSearchHit[] = [];
      for (const m of data.matches ?? []) {
        if (m.id === METADATA_ID || m.metadata?.isMetadata) continue;
        hits.push({
          id: m.id,
          text: m.metadata?.text ?? "",
          metadata: {
            source: m.metadata?.source ?? "",
            chunk: m.metadata?.chunk ?? 1,
            totalChunks: m.metadata?.totalChunks ?? 1,
          },
          score: m.score,
          distance: 1 - m.score,
        });
      }
      return hits.slice(0, topK);
    } catch (cause) {
      throw new VectorDBError(`Failed to query Pinecone namespace ${this.namespace}`, { cause });
    }
  }

  count(): number {
    return this.cachedCount;
  }

  async saveIndexMetadata(metadata: IndexMetadata): Promise<void> {
    const dims = metadata.embeddingDimensions;
    const zeroVector = new Array(dims).fill(0);
    this.cachedCount = metadata.chunkCount;

    const vector = {
      id: METADATA_ID,
      values: zeroVector,
      metadata: {
        isMetadata: true,
        version: metadata.version,
        source: metadata.source,
        sourceHash: metadata.sourceHash,
        chunkSize: metadata.chunkSize,
        overlap: metadata.overlap,
        embeddingProvider: metadata.embeddingProvider,
        embeddingModel: metadata.embeddingModel,
        embeddingDimensions: metadata.embeddingDimensions,
        chunkCount: metadata.chunkCount,
        createdAt: metadata.createdAt,
      },
    };

    try {
      const res = await fetch(`${this.url}/vectors/upsert`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          vectors: [vector],
          namespace: this.namespace,
        }),
      });
      if (res.status !== 200) {
        const errBody = await res.text();
        throw new Error(`Save metadata returned status ${res.status}: ${errBody}`);
      }
    } catch (cause) {
      throw new VectorDBError(`Failed to save metadata to Pinecone namespace ${this.namespace}`, {
        cause,
      });
    }
  }

  async readIndexMetadata(): Promise<IndexMetadata | null> {
    try {
      const res = await fetch(
        `${this.url}/vectors/fetch?ids=${METADATA_ID}&namespace=${this.namespace}`,
        {
          method: "GET",
          headers: this.headers,
        },
      );
      if (res.status !== 200) {
        return null;
      }
      const data = (await res.json()) as {
        vectors?: Record<
          string,
          {
            id: string;
            metadata?: {
              isMetadata?: boolean;
              version?: string;
              source?: string;
              sourceHash?: string;
              chunkSize?: number;
              overlap?: number;
              embeddingProvider?: string;
              embeddingModel?: string;
              embeddingDimensions?: number;
              chunkCount?: number;
              createdAt?: string;
            };
          }
        >;
      };
      const record = data.vectors?.[METADATA_ID];
      if (record?.metadata?.isMetadata) {
        const m = record.metadata;
        const meta: IndexMetadata = {
          version: m.version ?? "",
          source: m.source ?? "",
          sourceHash: m.sourceHash ?? "",
          chunkSize: m.chunkSize ?? 0,
          overlap: m.overlap ?? 0,
          embeddingProvider: m.embeddingProvider as EmbeddingProviderName,
          embeddingModel: m.embeddingModel ?? "",
          embeddingDimensions: m.embeddingDimensions ?? 0,
          chunkCount: m.chunkCount ?? 0,
          createdAt: m.createdAt ?? "",
        };
        this.cachedCount = meta.chunkCount;
        return meta;
      }
      return null;
    } catch {
      return null;
    }
  }
}
