import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecursiveChunker } from "../../src/chunking/index.js";
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

describe("shared fixtures: hashing", () => {
  const fixture = load<HashFixture>("hash.json");

  it.each(fixture.hashString)("hashString($input)", ({ input, sha256 }) => {
    expect(hashString(input)).toBe(sha256);
  });

  it.each(fixture.namespaceFromPath)("namespaceFromPath($input)", ({ input, namespace }) => {
    expect(namespaceFromPath(input)).toBe(namespace);
  });
});
