import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "../../src/errors.js";
import {
  evaluate,
  formatReport,
  matchesExpected,
  parseQuestions,
  scoreResults,
} from "../../src/eval.js";
import type { EmbeddingProviderConfig, SearchResult } from "../../src/types.js";
import { MockEmbedder } from "../helpers/mock-embedder.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

vi.mock("../../src/embeddings/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/embeddings/index.js")>();
  return {
    ...actual,
    createEmbedder: async (config: EmbeddingProviderConfig) =>
      new MockEmbedder(config.model ?? "mock-model"),
  };
});

const { Document } = await import("../../src/core/document.js");

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

function hit(text: string, metadata: Partial<SearchResult["metadata"]> = {}): SearchResult {
  return {
    id: text,
    text,
    metadata: { source: "a.pdf", chunk: 1, totalChunks: 9, ...metadata },
    score: 1,
    distance: 0,
  };
}

describe("scoring", () => {
  it("matches text ignoring case and whitespace, and locations", () => {
    const h = hit("Refunds are  issued\nwithin 30 days.", { chunk: 4, page: 2, pageEnd: 3 });
    expect(matchesExpected(h, "refunds are issued within")).toBe(true);
    expect(matchesExpected(h, "60 days")).toBe(false);
    expect(matchesExpected(h, { source: "a.pdf" })).toBe(true);
    expect(matchesExpected(h, { source: "a.pdf", chunk: 4 })).toBe(true);
    expect(matchesExpected(h, { source: "a.pdf", chunk: 5 })).toBe(false);
    expect(matchesExpected(h, { source: "a.pdf", page: 3 })).toBe(true);
    expect(matchesExpected(h, { source: "a.pdf", page: 4 })).toBe(false);
    expect(matchesExpected(hit("x"), { source: "a.pdf", page: 1 })).toBe(false);
  });

  it("computes recall and reciprocal rank", () => {
    const hits = [hit("alpha"), hit("beta"), hit("gamma")];
    expect(scoreResults(hits, ["beta"])).toEqual([1, 1 / 2]);
    expect(scoreResults(hits, ["gamma", "delta"])).toEqual([1 / 2, 1 / 3]);
    expect(scoreResults(hits, ["delta"])).toEqual([0, 0]);
  });
});

describe("parseQuestions", () => {
  it("reads JSONL and skips blank lines", () => {
    const qs = parseQuestions(
      '{"question": "q1", "expected": ["a"]}\n\n{"question": "q2", "expected": [{"source": "a.pdf", "page": 2}]}\n',
    );
    expect(qs).toEqual([
      { question: "q1", expected: ["a"] },
      { question: "q2", expected: [{ source: "a.pdf", page: 2 }] },
    ]);
  });

  it.each([
    ["not json", "line 1: not valid JSON"],
    ['{"expected": ["a"]}', 'line 1: "question"'],
    ['{"question": "q", "expected": []}', 'line 1: "expected"'],
    ['{"question": "q", "expected": [3]}', "line 1: each"],
    ['{"question": "q", "expected": [{"source": "a", "page": "2"}]}', "line 1: each"],
  ])("rejects %s", (line, message) => {
    expect(() => parseQuestions(line)).toThrow(ConfigError);
    expect(() => parseQuestions(line)).toThrow(message);
  });
});

describe("evaluate", () => {
  it("scores each mode and each mode with rerank", async () => {
    const text = Array.from(
      { length: 20 },
      (_, i) => `Note ${i + 1} covers topic ${i + 1} in one short line.`,
    );
    text[6] = "The error code ERR_4021 means the gateway timed out.";
    const doc = new Document(ws.file("notes.txt", text.join("\n")), {
      storeDir: join(ws.root, ".raglite"),
      logLevel: "silent",
      scoreThreshold: -1,
    });
    await doc.build({ chunkSize: 9, overlap: 0 });

    const report = await evaluate(
      doc,
      [
        { question: "ERR_4021", expected: ["gateway timed out"] },
        { question: "nothing matches this", expected: ["no such passage"] },
      ],
      {
        topK: 3,
        modes: ["vector", "keyword"],
        rerank: async (_q, hits) => [...hits].reverse(),
      },
    );
    expect(report.results.map((r) => r.mode)).toEqual([
      "vector",
      "keyword",
      "vector+rerank",
      "keyword+rerank",
    ]);
    const keyword = report.results[1]!;
    expect(keyword).toMatchObject({ recall: 0.5, mrr: 0.5, hitRate: 0.5 });
    expect(keyword.missed).toEqual(["nothing matches this"]);

    const table = formatReport(report);
    expect(table).toContain("2 questions, top 3");
    expect(table).toMatch(/keyword\s+0\.500\s+0\.500\s+0\.500/);
  });
});
