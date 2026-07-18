import { describe, expect, it } from "vitest";
import { RecursiveChunker } from "../../src/chunking/recursive.js";
import { ChunkingError } from "../../src/errors.js";

describe("RecursiveChunker", () => {
  it("returns empty array for empty input", () => {
    const chunker = new RecursiveChunker(10, 2);
    expect(chunker.split("")).toEqual([]);
    expect(chunker.split("   \n  \t")).toEqual([]);
  });

  it("returns a single chunk when text is shorter than chunkSize", () => {
    const chunker = new RecursiveChunker(50, 5);
    const chunks = chunker.split("one two three four");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("one two three four");
  });

  it("splits long text into overlapping word chunks", () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(" ");
    const chunker = new RecursiveChunker(10, 2);
    const chunks = chunker.split(words);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.split(/\s+/).length).toBeLessThanOrEqual(10);
    }

    const firstTail = chunks[0]!.split(/\s+/).slice(-2);
    const secondHead = chunks[1]!.split(/\s+/).slice(0, 2);
    expect(firstTail).toEqual(secondHead);
  });

  it("covers every word from the input at least once", () => {
    const words = Array.from({ length: 25 }, (_, i) => `word${i}`);
    const chunker = new RecursiveChunker(6, 2);
    const chunks = chunker.split(words.join(" "));
    const covered = new Set<string>();
    for (const c of chunks) {
      for (const w of c.split(/\s+/)) covered.add(w);
    }
    for (const w of words) expect(covered.has(w)).toBe(true);
  });

  it("throws when overlap >= chunkSize", () => {
    const chunker = new RecursiveChunker(5, 5);
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(() => chunker.split(words)).toThrow(ChunkingError);
  });

  it("normalizes whitespace in output", () => {
    const chunker = new RecursiveChunker(100, 10);
    const [chunk] = chunker.split("hello\n\n\n   world\t\tfoo");
    expect(chunk).toBe("hello world foo");
  });
});
