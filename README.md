# raglite-toolkit

Build semantic search, multi-provider question answering, and REST APIs over your documents, directories, or web URLs in a few lines of TypeScript.

- **PDF, TXT, JSON, Markdown, DOCX** loaders out of the box
- **Multi-document, directory, & URL ingestion** — index folders, glob patterns, or web URLs with `DocumentCollection`
- **Multi-provider LLMs** — OpenAI, Anthropic (Claude), Google (Gemini), Mistral, Cohere, Groq, xAI (Grok), Ollama
- **Multi-provider embeddings** — OpenAI, Google, Mistral, Cohere, Voyage, Ollama, or a **local** sentence-transformer
- **Cosine similarity** scoring with L2-normalized vectors
- **Content-hash cache invalidation** — reindexes only when the file actually changes
- **Per-document namespacing** — indexes are isolated, so two documents never collide
- **REST API** via Hono with optional **bearer-token auth**
- **Citations** with page numbers and section headings
- **MCP server** and **AI SDK tool** for agents
- **Streaming** answers
- **TypeScript-first**, ESM, strict types

## Install

Requires Node.js 20 or later.

```bash
npm install raglite-toolkit
```

The core install is small. Install the SDK for each provider you use; the [Supported providers](#supported-providers) tables list the package for each one. For example:

```bash
npm install @ai-sdk/openai @ai-sdk/anthropic   # OpenAI embeddings + Claude answers
npm install @huggingface/transformers          # local (offline) embeddings, the default
npm install @lancedb/lancedb                   # LanceDB vector store
```

If a package is missing, RAGLite throws a `ConfigError` that names the `npm install` command to run.

## Quick start

```ts
import { Document } from "raglite-toolkit";

const doc = new Document("./policy.pdf", {
  embeddings: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
});

await doc.build();

const hits = await doc.search("refund policy", { topK: 3 });

const answer = await doc.ask("What is the refund policy?");
console.log(answer.text);
```

## Index text you already have

No file needed: index a database row, an upload or CMS content with `Document.fromText(id, text)`. The `id` names the index (reuse it to reuse the index) and becomes each chunk's `source`. Changed text is re-indexed on the next `build()`.

```ts
const doc = Document.fromText("faq-42", faqText, { embeddings: { provider: "openai" } });
await doc.build();
```

## Multi-Document & Directory Ingestion (`DocumentCollection`)

Index entire directories (`./docs`), glob patterns, web URLs, or mixed file arrays seamlessly:

```ts
import { DocumentCollection } from "raglite-toolkit";

const collection = new DocumentCollection(["./docs", "https://example.com"], {
  embeddings: { provider: "local" },
  llm: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
});

// Concurrently index all documents in directory & web URLs
const result = await collection.build();
console.log(`Indexed ${result.totalDocuments} document(s), ${result.totalChunks} chunk(s).`);

// Search across all collection documents simultaneously
const hits = await collection.search("refund policy", { topK: 5 });

// Contextual Q&A across the entire collection
const answer = await collection.ask("What is the refund policy?");
console.log(answer.text);
```

## Hybrid search (keyword + vector)

Vector search matches meaning, but it can miss exact terms such as error codes, SKUs, function names or rare product names. Keyword search (BM25) finds those exactly. `hybrid` runs both and merges the results with Reciprocal Rank Fusion.

```ts
await doc.search("ERR_4021", { mode: "hybrid" }); // "vector" (default) | "keyword" | "hybrid"
await doc.ask("What does ERR_4021 mean?", { mode: "hybrid" });

// Or set a default once; it applies to search(), ask() and askStream().
new Document("./runbook.md", {
  retrieval: {
    mode: "hybrid",
    hybrid: { rrfK: 60, candidates: 50, weights: { vector: 1, keyword: 1 } },
  },
});
```

- In `keyword` and `hybrid` modes, `score` is the fused rank score scaled to 0..1 (1 means ranked first by every retriever). Each result also has `scores: { vector?, keyword?, fused }`. Vector mode results are unchanged.
- `scoreThreshold` is still a cosine similarity. In hybrid mode it filters the vector results before fusion; keyword matches are not filtered by it.
- The keyword index is built by `build()` from the chunk texts, with no extra embedding calls, and saved as `<storeDir>/<namespace>/keyword.json`. It works with every vector store. With Qdrant or Pinecone, keep `storeDir` on persistent disk.
- Indexes built before 1.3: the memory, LanceDB and Qdrant stores build the keyword index from the stored chunks on the first keyword or hybrid search. Other stores log a warning and use vector search until you run `build({ rebuild: true })`.
- The same options work over HTTP (`"mode"` on `/search` and `/ask`) and in the CLI (`--mode hybrid`).

The tokenizer is the same in the TypeScript and Python SDKs:

| Text | How it is indexed |
|------|-------------------|
| Latin, Cyrillic, Greek, Arabic, Devanagari and other spaced scripts | Words, lowercased and NFKC-normalised (`ﬁ` → `fi`, `ＡＢＣ` → `abc`) |
| Code identifiers | `gpt-4.1`, `snake_case` and `ERR_42` stay whole, and their parts are indexed too |
| Chinese, Japanese, Korean, Thai, Lao, Khmer, Myanmar | Overlapping character pairs (`退款处理` → `退款`, `款处`, `处理`), so no dictionary is needed |

There is no stemming or stopword list, because both are language-specific: in keyword mode `refund` does not match `refunds`. Hybrid mode's vector side covers those cases.

## Citations

`ask()` returns the passages the answer cites, with the page (PDF) and heading path (Markdown) of each:

```ts
const answer = await doc.ask("What is the refund policy?");
answer.text;       // "Refunds are issued within 30 days [1]."
answer.citations;  // [{ n: 1, source: "policy.pdf", chunk: 4, page: 12, section: "Policies > Refunds", text: "..." }]
```

- `n` is the number used in the answer. `[2]`, `[1][3]` and `[1, 3]` are all recognised; numbers that match no passage are ignored.
- Search results carry the same `page`, `pageEnd` (when a chunk crosses a page break) and `section` in `metadata`.
- Indexes built before 2.1 have no page or section until you run `build({ rebuild: true })`. Answers still get `citations`, without those fields.
- The REST `/ask` response includes `citations`, and `raglite ask` lists the sources under the answer.

## Use from AI agents (MCP)

`raglite mcp` serves your documents to any MCP client (Claude Code, Claude Desktop, Cursor, VS Code) over stdio. `npx` can fetch everything it needs, including the MCP SDK and local embeddings:

```bash
claude mcp add docs -- npx -y -p raglite-toolkit -p @modelcontextprotocol/sdk -p @huggingface/transformers \
  raglite mcp /absolute/path/to/docs --store-dir /absolute/path/to/docs/.raglite
```

Claude Desktop, Cursor and VS Code use the same command in their MCP settings:

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "-p", "raglite-toolkit", "-p", "@modelcontextprotocol/sdk", "-p", "@huggingface/transformers",
               "raglite", "mcp", "/absolute/path/to/docs", "--store-dir", "/absolute/path/to/docs/.raglite"]
    }
  }
}
```

- Use absolute paths, and pass `--store-dir`: MCP clients may start the server in any directory, and the index is kept in `./.raglite` by default.
- The first start installs the packages and indexes the documents, which can take longer than a client waits. Run the same command once in a terminal first (stop it with Ctrl+C); later starts reuse both.
- In a project that already has `raglite-toolkit` and `@modelcontextprotocol/sdk` installed, `npx raglite mcp ./docs --store-dir ./.raglite` is enough.

Tools: `search` (`query`, optional `topK` and `mode`), `list_sources`, and `ask` when you pass `--llm-provider`. Add `--embed-provider` and the other `raglite index` flags as needed. From code, `serveMcp(collection)` or `createMcpServer(collection)` (for other transports).

## Use as an agent tool

`asTool()` turns a document or collection into a [Vercel AI SDK](https://ai-sdk.dev) tool:

```ts
import { generateText, stepCountIs } from "ai";

const { text } = await generateText({
  model,
  tools: { searchPolicies: doc.asTool({ description: "Search the company policies.", topK: 5 }) },
  stopWhen: stepCountIs(3),
  prompt: "Can I return an opened item?",
});
```

The tool takes a `query` and returns passages: `source`, `chunk`, `page`, `section`, `score` and `text`.

## Progress and cancellation

```ts
const controller = new AbortController();
await collection.build({
  onProgress: ({ source, embedded, total }) => console.log(`${source}: ${embedded}/${total}`),
  signal: controller.signal,
});
await doc.ask("...", { signal: controller.signal });
```

Chunks are embedded in batches of 64, with `onProgress` called after each. An aborted build throws an `AbortError` and keeps the previous index, because the old index is replaced only once embedding finishes.

## Choose any LLM at ask-time

```ts
const openai = await doc.ask("Summarize this document", {
  llm: { provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY },
});

const claude = await doc.ask("Summarize this document", {
  llm: { provider: "anthropic", model: "claude-sonnet-5-5", apiKey: process.env.ANTHROPIC_API_KEY },
});

const gemini = await doc.ask("Summarize this document", {
  llm: { provider: "google", model: "gemini-3.8-flash", apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY },
});

const groq = await doc.ask("Summarize this document", {
  llm: { provider: "groq", model: "openai/gpt-oss-120b", apiKey: process.env.GROQ_API_KEY },
});

const local = await doc.ask("Summarize this document", {
  llm: { provider: "ollama", model: "llama3.2", baseURL: "http://localhost:11434/api" },
});
```

## Fully local with Ollama

Install the provider first: `npm install ollama-ai-provider-v2`.

```ts
const doc = new Document("./policy.pdf", {
  embeddings: {
    provider: "ollama",
    model: "embeddinggemma:latest",
    baseURL: "http://localhost:11434/api",
  },
  llm: {
    provider: "ollama",
    model: "gemma3:latest",
    baseURL: "http://localhost:11434/api",
  },
});

await doc.build();
console.log((await doc.ask("What is the refund policy?")).text);
```

## Pluggable Vector Databases

By default, `raglite` uses a lightweight, in-memory vector store that persists indexes locally as JSON files. You can configure `raglite` to use a custom local or cloud-based vector database (like Qdrant, Pinecone, or LanceDB) by passing the `vectorStore` configuration option:

### Memory Store (Default)
```ts
const doc = new Document("./policy.pdf", {
  vectorStore: { provider: "memory", storeDir: ".raglite" }
});
```

### Qdrant (Local or Cloud)
Supports both local instances (e.g. running via Docker) and Qdrant Cloud clusters.
By default each document gets its own collection (`raglite_<namespace>`). Set `indexName` to keep several documents in one shared collection; each document's points are tagged with its namespace, so rebuilding one document never affects the others.
```ts
const doc = new Document("./policy.pdf", {
  vectorStore: {
    provider: "qdrant",
    url: "http://localhost:6333", // or Qdrant Cloud URL
    apiKey: "your-qdrant-api-key", // optional
    indexName: "my_collection"   // optional
  }
});
```

### Pinecone (Cloud)
`raglite` automatically scopes document collections under Pinecone's native namespaces inside the index.
```ts
const doc = new Document("./policy.pdf", {
  vectorStore: {
    provider: "pinecone",
    url: "https://your-pinecone-index-host.svc.pinecone.io",
    apiKey: "your-pinecone-api-key"
  }
});
```

### LanceDB (Local)
Runs a high-performance local database on the filesystem. Install it first: `npm install @lancedb/lancedb`.
```ts
const doc = new Document("./policy.pdf", {
  vectorStore: {
    provider: "lancedb",
    storeDir: ".raglite"
  }
});
```

### Custom Vector Store Class
You can also supply your own custom class instance directly as long as it implements the `VectorStore` interface:
```ts
import { VectorStore } from "raglite-toolkit";

class MyCustomStore implements VectorStore {
  // Implement: namespace, load, reset, add, search, count, saveIndexMetadata, readIndexMetadata
  // Optional: listChunks() lets hybrid search rebuild a missing keyword index from your store;
  //           keywordSearch(query, topK) replaces the built-in BM25 index with your own.
}

const doc = new Document("./policy.pdf", {
  vectorStore: new MyCustomStore()
});
```

## Streaming

```ts
for await (const chunk of doc.askStream("Explain the introduction")) {
  process.stdout.write(chunk);
}
```

## Local embeddings with `@huggingface/transformers`

```ts
const doc = new Document("./policy.pdf", {
  embeddings: { provider: "local", model: "Xenova/all-MiniLM-L6-v2" },
});
await doc.build();
```

## REST API

```ts
const handle = await doc.serve({
  port: 8085,
  llm: { provider: "openai", apiKey: process.env.OPENAI_API_KEY },
  bearerToken: process.env.RAGLITE_TOKEN,
});
console.log(handle.url);
```

Endpoints:

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/health` | Liveness + index stats (auth-exempt) |
| `GET`  | `/info`   | Configuration snapshot |
| `POST` | `/search` | `{ query, topK?, scoreThreshold? }` |
| `POST` | `/ask`    | `{ question, topK?, includeCitations?, stream? }` |

```bash
curl http://127.0.0.1:8085/health

curl -X POST http://127.0.0.1:8085/search \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"query":"refund policy","topK":3}'

curl -X POST http://127.0.0.1:8085/ask \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  -d '{"question":"What is the refund policy?","stream":true}'
```

## CLI

```bash
raglite index ./policy.pdf --embed-provider openai --embed-key $OPENAI_API_KEY
raglite search ./docs "refund policy" --top-k 3
raglite search ./docs "ERR_4021" --mode hybrid
raglite ask ./docs "What is the refund policy?" \
  --llm-provider anthropic --llm-key $ANTHROPIC_API_KEY --stream
raglite mcp ./docs --llm-provider anthropic   # MCP server over stdio
raglite serve https://example.com \
  --llm-provider openai --llm-key $OPENAI_API_KEY \
  --port 8085 --token $RAGLITE_TOKEN
```

## Supported providers

**LLMs**

| Provider   | Config key   | Default model | Package to install |
| ---------- | ------------ | ------------- | ------------------ |
| OpenAI     | `openai`     | `gpt-4o-mini` | `@ai-sdk/openai` |
| Anthropic  | `anthropic`  | `claude-sonnet-5-5` | `@ai-sdk/anthropic` |
| Google     | `google`     | `gemini-3.8-flash` | `@ai-sdk/google` |
| Mistral    | `mistral`    | `mistral-large-latest` | `@ai-sdk/mistral` |
| Cohere     | `cohere`     | `command-a-03-2025` | `@ai-sdk/cohere` |
| Groq       | `groq`       | `openai/gpt-oss-120b` | `@ai-sdk/groq` |
| xAI (Grok) | `xai`        | `grok-4.7` | `@ai-sdk/xai` |
| Ollama     | `ollama`     | `llama3.2` | `ollama-ai-provider-v2` |

**Embeddings**

| Provider | Config key | Default model | Package to install |
| -------- | ---------- | ------------- | ------------------ |
| OpenAI   | `openai`   | `text-embedding-3-small` | `@ai-sdk/openai` |
| Google   | `google`   | `gemini-embedding-2` | `@ai-sdk/google` |
| Mistral  | `mistral`  | `mistral-embed` | `@ai-sdk/mistral` |
| Cohere   | `cohere`   | `embed-english-v3.0` | `@ai-sdk/cohere` |
| Voyage   | `voyage`   | `voyage-3` | `voyage-ai-provider` |
| Ollama   | `ollama`   | `nomic-embed-text` | `ollama-ai-provider-v2` |
| Local    | `local`    | `Xenova/all-MiniLM-L6-v2` | `@huggingface/transformers` |

Anthropic requests send no `temperature` unless you set one, because Claude 5 models reject non-default sampling values.

Qdrant and Pinecone need no extra package. LanceDB needs `@lancedb/lancedb`.

## Configuration

```ts
new Document(path, {
  chunkSize: 500,       // words per chunk (characters for Chinese, Japanese, Thai, ...); unset = keep the existing index's
  overlap: 50,          // words of overlap
  topK: 5,              // default results
  scoreThreshold: 0,    // cosine similarity floor (0..1)
  storeDir: ".raglite", // where indexes live
  embeddings: { provider: "local" }, // unset = keep the existing index's provider/model (local for new indexes)
  llm: { provider: "openai", apiKey: "..." },
  logLevel: "info",     // silent | info | debug
  retrieval: { mode: "vector" }, // vector | keyword | hybrid
});
```

## Development

```bash
npm install          # install dependencies
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint
npm run format       # biome format --write
npm test             # vitest run
npm run verify       # typecheck + lint + tests (runs on prepublishOnly)
npm run build        # emit dist/
npm run smoke:providers  # live call per provider whose API key is set (see the script)
```

## License

MIT
