import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../constants.js";
import { DocumentCollection } from "../core/collection.js";
import type { Document } from "../core/document.js";
import { missingPackage } from "../errors.js";
import { isUrl } from "../loaders/index.js";
import { toPassage } from "../tools/search-tool.js";
import type { LLMProviderConfig } from "../types.js";

export type McpTarget = Document | DocumentCollection;

export interface McpServerOptions {
  /** LLM for the `ask` tool; defaults to the target's `llm`. Without one, `ask` is not offered. */
  llm?: LLMProviderConfig;
}

const MCP_SDK = "@modelcontextprotocol/sdk";
const PURPOSE = "The MCP server";

const retrievalFields = {
  topK: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Number of passages to return (default 5)."),
  mode: z
    .enum(["vector", "keyword", "hybrid"])
    .optional()
    .describe("vector: by meaning. keyword: exact terms such as error codes. hybrid: both."),
};

/**
 * An MCP server exposing `search`, `ask` (when an LLM is configured) and
 * `list_sources` over an indexed document or collection. Call `build()` on the
 * target first. Connect it to any transport, or use `serveMcp()` for stdio.
 */
export async function createMcpServer(
  target: McpTarget,
  options: McpServerOptions = {},
): Promise<McpServer> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js").catch(
    missingPackage(MCP_SDK, PURPOSE),
  );
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });

  server.registerTool(
    "search",
    {
      title: "Search documents",
      description:
        "Find the passages in the indexed documents most relevant to a query. " +
        "Returns JSON: source, chunk, score and text for each passage.",
      inputSchema: { query: z.string().min(1).describe("What to look for."), ...retrievalFields },
    },
    ({ query, topK, mode }) =>
      run(async () => {
        const hits = await target.search(query, {
          ...(topK ? { topK } : {}),
          ...(mode ? { mode } : {}),
        });
        return JSON.stringify(hits.map(toPassage), null, 2);
      }),
  );

  const llm = options.llm ?? target.resolvedConfig.llm;
  if (llm) {
    server.registerTool(
      "ask",
      {
        title: "Ask the documents",
        description:
          "Answer a question using only the indexed documents. The answer cites passages as [1], [2], ...",
        inputSchema: {
          question: z.string().min(1).describe("The question to answer."),
          ...retrievalFields,
        },
      },
      ({ question, topK, mode }) =>
        run(async () => {
          const answer = await target.ask(question, {
            llm,
            ...(topK ? { topK } : {}),
            ...(mode ? { mode } : {}),
          });
          return answer.text;
        }),
    );
  }

  server.registerTool(
    "list_sources",
    {
      title: "List indexed sources",
      description: "List the indexed documents and how many passages each has.",
    },
    () =>
      run(async () => {
        const docs = target instanceof DocumentCollection ? target.getDocuments() : [target];
        return JSON.stringify(
          docs.map((doc) => ({
            source: isUrl(doc.filePath) ? doc.filePath : basename(doc.filePath),
            path: doc.filePath,
            chunks: doc.chunkCount,
          })),
          null,
          2,
        );
      }),
  );

  return server;
}

/**
 * Serve over stdio until the client disconnects. stdout carries the protocol,
 * so nothing else may write to it.
 */
export async function serveMcp(target: McpTarget, options: McpServerOptions = {}): Promise<void> {
  const server = await createMcpServer(target, options);
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js").catch(
    missingPackage(MCP_SDK, PURPOSE),
  );
  await server.connect(new StdioServerTransport());
}

/** Tool errors go back to the client as an error result rather than failing the request. */
async function run(fn: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
