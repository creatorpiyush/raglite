# raglite-toolkit

Build semantic search, multi-provider question answering, and REST APIs over your documents in a few lines of TypeScript.

- **PDF, TXT, JSON, Markdown, DOCX** loaders out of the box
- **Multi-provider LLMs** — OpenAI, Anthropic (Claude), Google (Gemini), Mistral, Cohere, Groq, xAI (Grok), Ollama
- **Multi-provider embeddings** — OpenAI, Google, Mistral, Cohere, Voyage, Ollama, or a **local** sentence-transformer
- **Cosine similarity** scoring with L2-normalized vectors
- **Content-hash cache invalidation** — reindexes only when the file actually changes
- **Per-document namespacing** — indexes are isolated, so two documents never collide
- **REST API** via Hono with optional **bearer-token auth**
- **Streaming** answers
- **TypeScript-first**, ESM, strict types

## Install

```bash
npm install raglite-toolkit
```

Provider SDKs are pulled in on demand. For local (offline) embeddings:

```bash
npm install @huggingface/transformers
```

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

## Choose any LLM at ask-time

```ts
const openai = await doc.ask("Summarize this document", {
  llm: { provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY },
});

const claude = await doc.ask("Summarize this document", {
  llm: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", apiKey: process.env.ANTHROPIC_API_KEY },
});

const gemini = await doc.ask("Summarize this document", {
  llm: { provider: "google", model: "gemini-2.0-flash", apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY },
});

const groq = await doc.ask("Summarize this document", {
  llm: { provider: "groq", model: "llama-3.3-70b-versatile", apiKey: process.env.GROQ_API_KEY },
});

const local = await doc.ask("Summarize this document", {
  llm: { provider: "ollama", model: "llama3.2", baseURL: "http://localhost:11434/api" },
});
```

## Fully local with Ollama

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
raglite search ./policy.pdf "refund policy" --top-k 3
raglite ask ./policy.pdf "What is the refund policy?" \
  --llm-provider anthropic --llm-key $ANTHROPIC_API_KEY --stream
raglite serve ./policy.pdf \
  --llm-provider openai --llm-key $OPENAI_API_KEY \
  --port 8085 --token $RAGLITE_TOKEN
```

## Supported providers

**LLMs**

| Provider   | Config key   | Default model |
| ---------- | ------------ | ------------- |
| OpenAI     | `openai`     | `gpt-4o-mini` |
| Anthropic  | `anthropic`  | `claude-3-5-sonnet-20241022` |
| Google     | `google`     | `gemini-2.0-flash` |
| Mistral    | `mistral`    | `mistral-large-latest` |
| Cohere     | `cohere`     | `command-r-plus` |
| Groq       | `groq`       | `llama-3.3-70b-versatile` |
| xAI (Grok) | `xai`        | `grok-2-latest` |
| Ollama     | `ollama`     | `llama3.2` |

**Embeddings**

| Provider | Config key | Default model |
| -------- | ---------- | ------------- |
| OpenAI   | `openai`   | `text-embedding-3-small` |
| Google   | `google`   | `text-embedding-004` |
| Mistral  | `mistral`  | `mistral-embed` |
| Cohere   | `cohere`   | `embed-english-v3.0` |
| Voyage   | `voyage`   | `voyage-3` |
| Ollama   | `ollama`   | `nomic-embed-text` |
| Local    | `local`    | `Xenova/all-MiniLM-L6-v2` |

## Configuration

```ts
new Document(path, {
  chunkSize: 500,       // words per chunk
  overlap: 50,          // words of overlap
  topK: 5,              // default results
  scoreThreshold: 0,    // cosine similarity floor (0..1)
  storeDir: ".raglite", // where indexes live
  embeddings: { provider: "local" },
  llm: { provider: "openai", apiKey: "..." },
  logLevel: "info",     // silent | info | debug
});
```

## How the index cache works

Every call to `build()` fingerprints the source file with a **SHA-256 content hash** (not mtime) and stores it alongside the vectors. The next call reuses the cached index only if all of these match:

- file content hash
- chunk size and overlap
- embedding provider (and model, if you passed one)
- library major version

Change any of them (or pass `rebuild: true`) and the index is rebuilt.

Each `Document` is scoped to its own directory under `.raglite/<sha256-prefix>/`, so multiple documents never overwrite each other.

## Advanced

- **Custom vector store.** Implement the `VectorStore` interface in `raglite/vectordb`.
- **Custom loader.** Extend `BaseLoader` and register it before calling `getLoader`.
- **Custom chunker.** Extend `BaseChunker`.
- **Raw AI SDK access.** `createLLM({...})` returns a `LanguageModel` you can use with `generateText` / `streamText` directly.

## Development

```bash
npm install          # install dependencies
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint
npm run format       # biome format --write
npm test             # vitest run  (71 tests, ~1s)
npm run test:watch   # vitest in watch mode
npm run test:coverage
npm run verify       # typecheck + lint + tests (runs on prepublishOnly)
npm run build        # emit dist/
```

The test suite (13 files, 71 tests, ~1 s) does not require network access; it uses a deterministic `MockEmbedder` and mocks the AI SDK so unit + integration tests can validate the pipeline end-to-end offline.

## License

MIT
