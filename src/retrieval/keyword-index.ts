import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TOKENIZER_NAME, tokenize } from "../text/tokenizer.js";
import type { ChunkMetadata, IndexMetadata } from "../types.js";
import type { IndexedChunk } from "../vectordb/base.js";

export const KEYWORD_INDEX_FORMAT = 1;
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface KeywordHit {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  /** BM25 score. */
  score: number;
}

/** Layout of `keyword.json`. Both SDKs read and write this same format. */
export interface KeywordIndexFile {
  format: number;
  tokenizer: string;
  /** Identifies the vector index this keyword index was built for. */
  index: { sourceHash: string; createdAt: string; chunkCount: number };
  chunks: IndexedChunk[];
  /** Number of terms in each chunk. */
  lengths: number[];
  /** term -> flat [chunkIndex, termFrequency, chunkIndex, termFrequency, ...]. */
  postings: Record<string, number[]>;
}

/**
 * BM25 keyword index over a document's chunks. It is built from the chunk
 * texts alone, so it never needs extra embedding calls, and it is kept in a
 * sidecar file next to the vector index so it works with every store.
 */
export class KeywordIndex {
  private readonly avgLength: number;

  private constructor(
    private readonly chunks: IndexedChunk[],
    private readonly lengths: number[],
    private readonly postings: Map<string, number[]>,
  ) {
    const total = lengths.reduce((sum, n) => sum + n, 0);
    this.avgLength = lengths.length > 0 && total > 0 ? total / lengths.length : 1;
  }

  static build(chunks: IndexedChunk[]): KeywordIndex {
    const lengths: number[] = [];
    const postings = new Map<string, number[]>();
    chunks.forEach((chunk, index) => {
      const terms = tokenize(chunk.text);
      lengths.push(terms.length);
      const tf = new Map<string, number>();
      for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
      for (const [term, count] of tf) {
        let posting = postings.get(term);
        if (!posting) {
          posting = [];
          postings.set(term, posting);
        }
        posting.push(index, count);
      }
    });
    return new KeywordIndex(
      chunks.map(({ id, text, metadata }) => ({ id, text, metadata })),
      lengths,
      postings,
    );
  }

  static fromFile(data: KeywordIndexFile): KeywordIndex {
    return new KeywordIndex(data.chunks, data.lengths, new Map(Object.entries(data.postings)));
  }

  toFile(metadata: IndexMetadata): KeywordIndexFile {
    return {
      format: KEYWORD_INDEX_FORMAT,
      tokenizer: TOKENIZER_NAME,
      index: {
        sourceHash: metadata.sourceHash,
        createdAt: metadata.createdAt,
        chunkCount: metadata.chunkCount,
      },
      chunks: this.chunks,
      lengths: this.lengths,
      postings: Object.fromEntries(this.postings),
    };
  }

  /** Chunks matching any query term, best BM25 score first, ties broken by chunk id. */
  search(query: string, topK: number): KeywordHit[] {
    const n = this.chunks.length;
    if (n === 0 || topK <= 0) return [];

    const scores = new Map<number, number>();
    for (const term of new Set(tokenize(query))) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const df = posting.length / 2;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < posting.length; i += 2) {
        const chunk = posting[i]!;
        const tf = posting[i + 1]!;
        const norm = 1 - BM25_B + (BM25_B * this.lengths[chunk]!) / this.avgLength;
        const score = (idf * (tf * (BM25_K1 + 1))) / (tf + BM25_K1 * norm);
        scores.set(chunk, (scores.get(chunk) ?? 0) + score);
      }
    }

    const hits: KeywordHit[] = [];
    for (const [index, score] of scores) {
      const chunk = this.chunks[index]!;
      hits.push({ id: chunk.id, text: chunk.text, metadata: chunk.metadata, score });
    }
    hits.sort(byScoreThenId);
    return hits.slice(0, topK);
  }
}

export function byScoreThenId(a: { id: string; score: number }, b: { id: string; score: number }) {
  if (b.score !== a.score) return b.score - a.score;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when a keyword index file was built for exactly this vector index. */
export function keywordFileMatches(data: KeywordIndexFile, metadata: IndexMetadata): boolean {
  return (
    data.format === KEYWORD_INDEX_FORMAT &&
    data.tokenizer === TOKENIZER_NAME &&
    data.index?.sourceHash === metadata.sourceHash &&
    data.index?.createdAt === metadata.createdAt &&
    data.index?.chunkCount === metadata.chunkCount &&
    Array.isArray(data.chunks) &&
    data.chunks.length === metadata.chunkCount
  );
}

/** Reads a keyword index file, or returns null if it is missing or unreadable. */
export async function readKeywordFile(path: string): Promise<KeywordIndexFile | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf-8")) as KeywordIndexFile;
  } catch {
    return null;
  }
}

export async function writeKeywordFile(path: string, data: KeywordIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}
