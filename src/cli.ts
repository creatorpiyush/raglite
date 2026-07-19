#!/usr/bin/env node
import { parseArgs } from "node:util";
import { PACKAGE_VERSION } from "./constants.js";
import { Document } from "./core/document.js";
import type {
  EmbeddingProviderConfig,
  EmbeddingProviderName,
  LLMProviderConfig,
  LLMProviderName,
  VectorStoreProviderConfig,
  VectorStoreProviderName,
} from "./types.js";

const HELP = `raglite v${PACKAGE_VERSION}

Usage:
  raglite index <file>   [--chunk-size N] [--overlap N] [--embed-provider P] [--embed-model M] [--embed-key K] [--rebuild]
                         [--vector-provider P] [--vector-url U] [--vector-key K] [--vector-index I] [--vector-store-dir D]
  raglite search <file> "query"   [--top-k N]
                         [--vector-provider P] [--vector-url U] [--vector-key K] [--vector-index I] [--vector-store-dir D]
  raglite ask <file> "question"   --llm-provider P [--llm-model M] [--llm-key K] [--stream]
                         [--vector-provider P] [--vector-url U] [--vector-key K] [--vector-index I] [--vector-store-dir D]
  raglite serve <file>            --llm-provider P [--llm-key K] [--host H] [--port N] [--token T]
                         [--vector-provider P] [--vector-url U] [--vector-key K] [--vector-index I] [--vector-store-dir D]
  raglite --help
  raglite --version

Providers:
  LLM:        openai, anthropic, google, mistral, cohere, groq, xai, ollama
  Embeddings: openai, google, mistral, cohere, voyage, ollama, local
  Vector DB:  memory, qdrant, pinecone, lancedb
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  const command = argv[0]!;
  const rest = argv.slice(1);

  switch (command) {
    case "index":
      return runIndex(rest);
    case "search":
      return runSearch(rest);
    case "ask":
      return runAsk(rest);
    case "serve":
      return runServe(rest);
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      process.exit(2);
  }
}

function parseCommonEmbedding(values: Record<string, unknown>): EmbeddingProviderConfig {
  const provider = (values["embed-provider"] as string | undefined) ?? "local";
  const config: EmbeddingProviderConfig = {
    provider: provider as EmbeddingProviderName,
  };
  if (values["embed-model"]) config.model = values["embed-model"] as string;
  if (values["embed-key"]) config.apiKey = values["embed-key"] as string;
  return config;
}

function parseLLM(values: Record<string, unknown>): LLMProviderConfig | undefined {
  const provider = values["llm-provider"] as string | undefined;
  if (!provider) return undefined;
  const config: LLMProviderConfig = { provider: provider as LLMProviderName };
  if (values["llm-model"]) config.model = values["llm-model"] as string;
  if (values["llm-key"]) config.apiKey = values["llm-key"] as string;
  return config;
}

function parseVectorStore(values: Record<string, unknown>): VectorStoreProviderConfig | undefined {
  const provider = values["vector-provider"] as string | undefined;
  if (!provider) return undefined;
  const config: VectorStoreProviderConfig = {
    provider: provider as VectorStoreProviderName,
  };
  if (values["vector-url"]) config.url = values["vector-url"] as string;
  if (values["vector-key"]) config.apiKey = values["vector-key"] as string;
  if (values["vector-index"]) config.indexName = values["vector-index"] as string;
  if (values["vector-store-dir"]) config.storeDir = values["vector-store-dir"] as string;
  return config;
}

const COMMON_VECTOR_OPTIONS = {
  "vector-provider": { type: "string" },
  "vector-url": { type: "string" },
  "vector-key": { type: "string" },
  "vector-index": { type: "string" },
  "vector-store-dir": { type: "string" },
} as const;

async function runIndex(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "chunk-size": { type: "string" },
      overlap: { type: "string" },
      "embed-provider": { type: "string" },
      "embed-model": { type: "string" },
      "embed-key": { type: "string" },
      rebuild: { type: "boolean" },
      ...COMMON_VECTOR_OPTIONS,
    },
  });
  const file = requirePositional(positionals, 0, "file");

  const doc = new Document(file, {
    embeddings: parseCommonEmbedding(values),
    vectorStore: parseVectorStore(values),
  });
  const result = await doc.build({
    ...(values["chunk-size"] ? { chunkSize: Number(values["chunk-size"]) } : {}),
    ...(values.overlap ? { overlap: Number(values.overlap) } : {}),
    ...(values.rebuild ? { rebuild: true } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runSearch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "top-k": { type: "string" },
      "embed-provider": { type: "string" },
      "embed-model": { type: "string" },
      "embed-key": { type: "string" },
      ...COMMON_VECTOR_OPTIONS,
    },
  });
  const file = requirePositional(positionals, 0, "file");
  const query = requirePositional(positionals, 1, "query");

  const doc = new Document(file, {
    embeddings: parseCommonEmbedding(values),
    vectorStore: parseVectorStore(values),
  });
  const results = await doc.search(query, {
    ...(values["top-k"] ? { topK: Number(values["top-k"]) } : {}),
  });
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

async function runAsk(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "top-k": { type: "string" },
      "embed-provider": { type: "string" },
      "embed-model": { type: "string" },
      "embed-key": { type: "string" },
      "llm-provider": { type: "string" },
      "llm-model": { type: "string" },
      "llm-key": { type: "string" },
      stream: { type: "boolean" },
      ...COMMON_VECTOR_OPTIONS,
    },
  });
  const file = requirePositional(positionals, 0, "file");
  const question = requirePositional(positionals, 1, "question");

  const llm = parseLLM(values);
  if (!llm) throw new Error("--llm-provider is required for `ask`");
  const doc = new Document(file, {
    embeddings: parseCommonEmbedding(values),
    llm,
    vectorStore: parseVectorStore(values),
  });

  const opts: Parameters<Document["ask"]>[1] = {};
  if (values["top-k"]) opts.topK = Number(values["top-k"]);

  if (values.stream) {
    for await (const chunk of doc.askStream(question, opts)) {
      process.stdout.write(chunk);
    }
    process.stdout.write("\n");
  } else {
    const answer = await doc.ask(question, opts);
    process.stdout.write(`${answer.text}\n`);
  }
}

async function runServe(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "embed-provider": { type: "string" },
      "embed-model": { type: "string" },
      "embed-key": { type: "string" },
      "llm-provider": { type: "string" },
      "llm-model": { type: "string" },
      "llm-key": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      token: { type: "string" },
      ...COMMON_VECTOR_OPTIONS,
    },
  });
  const file = requirePositional(positionals, 0, "file");
  const llm = parseLLM(values);
  const doc = new Document(file, {
    embeddings: parseCommonEmbedding(values),
    ...(llm ? { llm } : {}),
    vectorStore: parseVectorStore(values),
  });
  await doc.build();

  const serveOpts: Parameters<Document["serve"]>[0] = {};
  if (llm) serveOpts.llm = llm;
  if (values.host) serveOpts.host = values.host as string;
  if (values.port) serveOpts.port = Number(values.port);
  if (values.token) serveOpts.bearerToken = values.token as string;

  const handle = await doc.serve(serveOpts);
  process.stdout.write(`RagLite listening on ${handle.url}\n`);
}

function requirePositional(positionals: string[], index: number, name: string): string {
  const value = positionals[index];
  if (!value) {
    process.stderr.write(`Missing required argument: <${name}>\n\n${HELP}`);
    process.exit(2);
  }
  return value;
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
