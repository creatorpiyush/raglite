import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { VectorDBError } from "../errors.js";
import type {
  ChunkMetadata,
  IndexMetadata,
  StoredChunk,
  VectorStoreProviderConfig,
} from "../types.js";
import type { VectorSearchHit, VectorStore } from "./base.js";

export class LanceDbVectorStore implements VectorStore {
  readonly namespace: string;
  private readonly storeDir: string;
  private readonly dbPath: string;
  private readonly metadataPath: string;
  private cachedCount = 0;
  private db: lancedb.Connection | null = null;

  constructor(storeDir: string, namespace: string) {
    this.namespace = namespace;
    this.storeDir = join(storeDir, namespace);
    this.dbPath = join(this.storeDir, "lancedb");
    this.metadataPath = join(this.storeDir, "metadata.json");
  }

  static async create(
    config: VectorStoreProviderConfig,
    namespace: string,
  ): Promise<LanceDbVectorStore> {
    return new LanceDbVectorStore(config.storeDir ?? ".raglite", namespace);
  }

  private async ensureDb(): Promise<lancedb.Connection> {
    if (this.db) return this.db;
    try {
      await mkdir(this.dbPath, { recursive: true });
      this.db = await lancedb.connect(this.dbPath);
      return this.db;
    } catch (cause) {
      throw new VectorDBError(`Failed to connect to LanceDB at ${this.dbPath}`, { cause });
    }
  }

  async load(): Promise<void> {
    await this.readIndexMetadata();
  }

  async reset(): Promise<void> {
    this.cachedCount = 0;
    this.db = null;
    if (existsSync(this.storeDir)) {
      await rm(this.storeDir, { recursive: true, force: true });
    }
  }

  async add(chunks: StoredChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = await this.ensureDb();
    const tableName = "chunks";
    const data = chunks.map((c) => ({
      id: c.id,
      vector: c.embedding,
      text: c.text,
      metadata: c.metadata,
    }));

    try {
      const tableNames = await db.tableNames();
      if (tableNames.includes(tableName)) {
        const table = await db.openTable(tableName);
        await table.add(data);
      } else {
        await db.createTable(tableName, data);
      }
      this.cachedCount += chunks.length;
    } catch (cause) {
      throw new VectorDBError(`Failed to add chunks to LanceDB`, { cause });
    }
  }

  async search(embedding: number[], topK: number): Promise<VectorSearchHit[]> {
    const db = await this.ensureDb();
    const tableName = "chunks";
    try {
      const tableNames = await db.tableNames();
      if (!tableNames.includes(tableName)) {
        return [];
      }
      const table = await db.openTable(tableName);
      interface LanceDbSearchQuery {
        metricType(type: string): LanceDbSearchQuery;
        limit(k: number): LanceDbSearchQuery;
        toArray(): Promise<
          Array<{
            id: string;
            text: string;
            metadata: unknown;
            _distance?: number;
          }>
        >;
      }

      const results = await (table as unknown as { search(e: number[]): LanceDbSearchQuery })
        .search(embedding)
        .metricType("cosine")
        .limit(topK)
        .toArray();

      return results.map((r) => {
        const distance = r._distance ?? 0;
        const score = 1 - distance;
        return {
          id: r.id,
          text: r.text,
          metadata: r.metadata as ChunkMetadata,
          score,
          distance,
        };
      });
    } catch (cause) {
      throw new VectorDBError(`Failed to search LanceDB`, { cause });
    }
  }

  count(): number {
    return this.cachedCount;
  }

  async saveIndexMetadata(metadata: IndexMetadata): Promise<void> {
    this.cachedCount = metadata.chunkCount;
    await mkdir(dirname(this.metadataPath), { recursive: true });
    await writeFile(this.metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  async readIndexMetadata(): Promise<IndexMetadata | null> {
    if (!existsSync(this.metadataPath)) return null;
    try {
      const raw = await readFile(this.metadataPath, "utf-8");
      const meta = JSON.parse(raw) as IndexMetadata;
      this.cachedCount = meta.chunkCount;
      return meta;
    } catch (cause) {
      throw new VectorDBError(`Failed to read index metadata at ${this.metadataPath}`, {
        cause,
      });
    }
  }
}
