import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecursiveChunker } from "../../src/chunking/index.js";
import { type RankedList, reciprocalRankFusion } from "../../src/retrieval/fusion.js";
import { KeywordIndex } from "../../src/retrieval/keyword-index.js";
import { tokenize } from "../../src/text/tokenizer.js";
import { hashString, namespaceFromPath } from "../../src/utils/hash.js";

// The Python SDK runs the same fixtures; see scripts/generate-shared-fixtures.ts.
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "shared");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(fixtureDir, name), "utf-8")) as T;

interface ChunkerCase {
  name: string;
  text: string;
  chunkSize: number;
  overlap: number;
  chunks?: string[];
  error?: boolean;
}

interface HashFixture {
  hashString: { input: string; sha256: string }[];
  namespaceFromPath: { input: string; namespace: string }[];
}

describe("shared fixtures: chunker", () => {
  it.each(load<ChunkerCase[]>("chunker.json"))("$name", (c) => {
    const chunker = new RecursiveChunker(c.chunkSize, c.overlap);
    if (c.error) {
      expect(() => chunker.split(c.text)).toThrow();
    } else {
      expect(chunker.split(c.text)).toEqual(c.chunks);
    }
  });
});

describe("shared fixtures: tokenizer", () => {
  it.each(load<{ name: string; text: string; tokens: string[] }[]>("tokenizer.json"))(
    "$name",
    ({ text, tokens }) => {
      expect(tokenize(text)).toEqual(tokens);
    },
  );
});

interface Bm25Fixture {
  chunks: { id: string; text: string }[];
  queries: { query: string; topK: number; hits: { id: string; score: number }[] }[];
}

describe("shared fixtures: BM25", () => {
  const fixture = load<Bm25Fixture>("bm25.json");
  const index = KeywordIndex.build(
    fixture.chunks.map((c, i) => ({
      ...c,
      metadata: { source: "corpus.txt", chunk: i + 1, totalChunks: fixture.chunks.length },
    })),
  );

  it.each(fixture.queries)("$query", ({ query, topK, hits }) => {
    const actual = index.search(query, topK);
    expect(actual.map((h) => h.id)).toEqual(hits.map((h) => h.id));
    actual.forEach((h, i) => {
      expect(h.score).toBeCloseTo(hits[i]!.score, 6);
    });
  });
});

interface RrfCase {
  name: string;
  rrfK: number;
  topK: number;
  vector: Omit<RankedList, "name">;
  keyword: Omit<RankedList, "name">;
  results: { id: string; score: number; scores: Record<string, number> }[];
}

describe("shared fixtures: RRF", () => {
  it.each(load<RrfCase[]>("rrf.json"))("$name", (c) => {
    const actual = reciprocalRankFusion(
      [
        { name: "vector", ...c.vector },
        { name: "keyword", ...c.keyword },
      ],
      c.rrfK,
      c.topK,
    );
    expect(actual.map((r) => r.id)).toEqual(c.results.map((r) => r.id));
    actual.forEach((r, i) => {
      expect(r.score).toBeCloseTo(c.results[i]!.score, 9);
      expect(Object.keys(r.scores!).sort()).toEqual(Object.keys(c.results[i]!.scores).sort());
    });
  });
});

describe("shared fixtures: hashing", () => {
  const fixture = load<HashFixture>("hash.json");

  it.each(fixture.hashString)("hashString($input)", ({ input, sha256 }) => {
    expect(hashString(input)).toBe(sha256);
  });

  it.each(fixture.namespaceFromPath)("namespaceFromPath($input)", ({ input, namespace }) => {
    expect(namespaceFromPath(input)).toBe(namespace);
  });
});
