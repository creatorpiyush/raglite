import { tool } from "ai";
import { z } from "zod";
import type { RetrievalMode, SearchResult } from "../types.js";

export interface SearchToolOptions {
  /** What the model reads to decide when to call the tool. Name your documents here. */
  description?: string;
  /** Passages returned per call (default: the document's topK). */
  topK?: number;
  mode?: RetrievalMode;
}

/** A retrieved passage as tools return it: where it came from, and its text. */
export interface Passage {
  source: string;
  chunk: number;
  page?: number;
  section?: string;
  score: number;
  text: string;
}

export function toPassage(hit: SearchResult): Passage {
  const { source, chunk, page, section } = hit.metadata;
  return {
    source,
    chunk,
    ...(page !== undefined ? { page } : {}),
    ...(section !== undefined ? { section } : {}),
    score: Number(hit.score.toFixed(4)),
    text: hit.text,
  };
}

interface Searchable {
  search(query: string, options?: { topK?: number; mode?: RetrievalMode }): Promise<SearchResult[]>;
}

/** An AI SDK tool that searches `target`; see Document.asTool(). */
export function searchTool(target: Searchable, options: SearchToolOptions = {}) {
  return tool({
    description:
      options.description ??
      "Search the indexed documents for passages relevant to a query. Returns each passage's source and text.",
    inputSchema: z.object({ query: z.string().min(1).describe("What to look for.") }),
    execute: async ({ query }) => {
      const hits = await target.search(query, {
        ...(options.topK !== undefined ? { topK: options.topK } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
      });
      return hits.map(toPassage);
    },
  });
}
