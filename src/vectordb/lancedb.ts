import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type * as lancedb from "@lancedb/lancedb";
import { missingPackage, VectorDBError } from "../errors.js";
import { filterConditions, type MetadataFilter } from "../retrieval/filter.js";
import type {
  ChunkMetadata,
  IndexMetadata,
  StoredChunk,
  VectorStoreProviderConfig,
} from "../types.js";
import type { IndexedChunk, VectorSearchHit, VectorStore } from "./base.js";

const TABLE = "chunks";

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
    const { connect } = await import("@lancedb/lancedb").catch(
      missingPackage("@lancedb/lancedb", 'The "lancedb" vector store'),
    );
    try {
      await mkdir(this.dbPath, { recursive: true });
      this.db = await connect(this.dbPath);
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
    try {
      const { makeArrowTable, schema } = await arrowTools(chunks[0]!.embedding.length);
      // Metadata is stored as JSON, plus flat typed columns for filtering:
      // LanceDB 0.4 cannot query the struct column it would otherwise infer.
      const data = makeArrowTable(
        chunks.map((c) => ({
          id: c.id,
          vector: c.embedding,
          text: c.text,
          metadata: JSON.stringify(c.metadata),
          chunk: c.metadata.chunk,
          totalChunks: c.metadata.totalChunks,
          page: c.metadata.page ?? null,
          pageEnd: c.metadata.pageEnd ?? null,
          section: c.metadata.section ?? null,
        })),
        { schema },
      );
      if ((await db.tableNames()).includes(TABLE)) {
        await (await db.openTable(TABLE)).add(data);
      } else {
        await db.createTable(TABLE, data);
      }
      this.cachedCount += chunks.length;
    } catch (cause) {
      throw new VectorDBError(`Failed to add chunks to LanceDB`, { cause });
    }
  }

  async search(
    embedding: number[],
    topK: number,
    filter?: MetadataFilter,
  ): Promise<VectorSearchHit[]> {
    const db = await this.ensureDb();
    try {
      if (!(await db.tableNames()).includes(TABLE)) return [];
      const table = await db.openTable(TABLE);
      let query = table.vectorSearch(embedding).distanceType("cosine").limit(topK);
      if (filter) query = query.where(lanceWhere(filter));
      const rows = (await query.toArray()) as Array<{
        id: string;
        text: string;
        metadata: string;
        _distance: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        metadata: JSON.parse(r.metadata) as ChunkMetadata,
        score: 1 - r._distance,
        distance: r._distance,
      }));
    } catch (cause) {
      throw new VectorDBError(`Failed to search LanceDB`, { cause });
    }
  }

  count(): number {
    return this.cachedCount;
  }

  async listChunks(): Promise<IndexedChunk[]> {
    const db = await this.ensureDb();
    try {
      if (!(await db.tableNames()).includes(TABLE)) return [];
      const table = await db.openTable(TABLE);
      const rows = (await table.query().select(["id", "text", "metadata"]).toArray()) as Array<{
        id: string;
        text: string;
        metadata: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        metadata: JSON.parse(r.metadata) as ChunkMetadata,
      }));
    } catch (cause) {
      throw new VectorDBError(`Failed to list chunks in LanceDB`, { cause });
    }
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

/**
 * lancedb's makeArrowTable and the table schema. apache-arrow is loaded
 * through lancedb so both use the same copy.
 */
async function arrowTools(dimensions: number) {
  const { makeArrowTable } = await import("@lancedb/lancedb");
  const lancedbRequire = createRequire(createRequire(import.meta.url).resolve("@lancedb/lancedb"));
  const arrow = lancedbRequire("apache-arrow") as typeof import("apache-arrow");
  const { Field, FixedSizeList, Float32, Float64, Schema, Utf8 } = arrow;
  const schema = new Schema([
    new Field("id", new Utf8(), false),
    new Field(
      "vector",
      new FixedSizeList(dimensions, new Field("item", new Float32(), true)),
      false,
    ),
    new Field("text", new Utf8(), false),
    new Field("metadata", new Utf8(), false),
    new Field("chunk", new Float64(), false),
    new Field("totalChunks", new Float64(), false),
    new Field("page", new Float64(), true),
    new Field("pageEnd", new Float64(), true),
    new Field("section", new Utf8(), true),
  ]);
  return { makeArrowTable, schema };
}

const SQL_OPS = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

function sqlValue(value: unknown): string {
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

/** SQL predicate for a chunk filter; fields are the flat columns written by add(). */
export function lanceWhere(filter: MetadataFilter): string {
  return filterConditions(filter)
    .map(([field, op, value]) =>
      // Backticks, or Lance folds pageEnd to pageend.
      op === "in"
        ? `\`${field}\` IN (${(value as unknown[]).map(sqlValue).join(", ") || "NULL"})`
        : `\`${field}\` ${SQL_OPS[op]} ${sqlValue(value)}`,
    )
    .join(" AND ");
}
