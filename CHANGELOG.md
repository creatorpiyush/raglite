# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-10-11

### Added
- **Metadata filters:** `search()`, `ask()`, `askStream()` and the REST `/search` and `/ask` endpoints take `filter`, such as `{ source: "policy.pdf", page: { gte: 3 } }`. A plain value means equality; `in`, `gt`, `gte`, `lt` and `lte` are the operators, and every field must match. Chunk fields are filtered inside the store before the `topK` cut: in memory, in the keyword index, as Qdrant and Pinecone payload filters, and as LanceDB `where` clauses. See [Metadata filters](https://creatorpiyush.github.io/raglite/guides/filters/).
- **Custom metadata:** the `metadata` option, such as `{ tenant: "acme" }`, adds your own fields to every search result and makes them filterable. Changing it needs no rebuild.
- **Reranking:** `rerank: { provider: "cohere" | "voyage" | "llm" }` or your own function reorders `candidates` results (default 30) before the `topK` cut. Cohere and Voyage are called through the AI SDK's `rerank()`. `score` becomes the reranker's score and `scores.rerank` records it. If the reranker fails, a warning is logged and the retrieval order is kept. Off by default; set a default with the `rerank` option and turn it off per call with `rerank: false`. See [Reranking](https://creatorpiyush.github.io/raglite/guides/reranking/).
- **`raglite eval <path> questions.jsonl`** reports recall@k, MRR and hit rate for each retrieval mode side by side, plus each mode reranked with `--rerank`, and `--json` for CI. Also `evaluate()`, `parseQuestions()` and `formatReport()` from code. See [Evaluating retrieval](https://creatorpiyush.github.io/raglite/guides/evaluation/).
- `matchesFilter()` and `DEFAULT_RERANK_MODELS` are exported.

### Changed
- `VectorStore.search()` and `keywordSearch()` take an optional third argument, `filter`. Custom stores need no change: RAGLite filters their results again, though a filtered search may then return fewer than `topK`.

### Fixed
- **The LanceDB store works.** Every search failed with `table.search is not a function` on `@lancedb/lancedb` 0.4. It now uses `vectorSearch()` and stores metadata as JSON plus typed columns for filtering. Rebuild LanceDB indexes with `build({ rebuild: true })`. Its tests now run against LanceDB itself instead of a mock.
- The Pinecone store kept only `source`, `chunk` and `totalChunks`, so citations lost their page and section. It now stores and returns `page`, `pageEnd` and `section`; rebuild Pinecone indexes to add them.

## [2.1.1] - 2026-10-10

### Added
- **Documentation site:** https://creatorpiyush.github.io/raglite/ covers both SDKs, with TypeScript and Python tabs on every sample: getting started, providers, troubleshooting, guides and an options reference. The `homepage` in `package.json` now points to it.

### Changed
- The README is now a short introduction with links to the documentation, so npm shows the docs link. Nothing was removed without a matching docs page.
- The README no longer says collections accept glob patterns; they never expanded them. Pass a folder or a list of files.

## [2.1.0] - 2026-10-10

### Added
- **Citations:** `ask()` now returns `citations`, the passages the answer cites as `[n]`, in order of first citation, each with `n`, `source`, `chunk`, `page`, `pageEnd`, `section` and `text`. `[2]`, `[1][3]` and `[1, 3]` are recognised. The REST `/ask` response includes them, and `raglite ask` lists the sources under the answer.
- **Page numbers and sections:** chunks of PDFs record `page` (and `pageEnd` when they cross a page break), and chunks of Markdown files record `section`, the heading path such as `Policies > Refunds`. Chunk boundaries are unchanged, so existing indexes are not re-embedded; they get these fields after `build({ rebuild: true })`. The prompt now labels each passage with its page and section.
- **MCP server:** `raglite mcp <path>` serves a document or folder to MCP clients (Claude Code, Claude Desktop, Cursor, VS Code) over stdio, with the tools `search`, `list_sources`, and `ask` when an LLM is configured. Tool names and inputs are the same in both SDKs. Needs `npm install @modelcontextprotocol/sdk` (optional peer dependency). From code: `serveMcp()` and `createMcpServer()`.
- **`asTool()`** on `Document` and `DocumentCollection` returns a Vercel AI SDK tool that searches the documents, for `generateText({ tools })` and agents. Also exported as `searchTool()`.
- **Build progress and cancellation:** `build({ onProgress, signal })` embeds in batches of 64, reports `{ source, embedded, total }` after each, and stops between batches when the `AbortSignal` fires. `ask()` and `askStream()` accept `signal` to cancel the LLM request. Aborts throw the standard `AbortError`.
- **`--store-dir`** on every CLI command sets where indexes are kept (default `./.raglite`). MCP clients may start servers in any directory, so the MCP setup in the README passes it.
- `CONTRIBUTING.md`, `SECURITY.md`, issue forms and a pull request template.

### Changed
- **A failed or cancelled `build()` keeps the previous index.** The old index is now replaced only after every chunk is embedded. Previously it was cleared before embedding, so an embedding error left the document with no index.
- **Logs go to stderr.** `info` and `debug` messages used `console.log`; they now use `console.error`, like warnings and errors and like the Python SDK. stdout carries only your program's output, which the MCP stdio transport requires.
- `Embedder.embedDocuments()` takes an optional second argument `{ signal }`. Custom embedders need no change.

## [2.0.1] - 2026-10-10

### Fixed
- **Indexes built with a shut-down embedding model:** `build()` now re-embeds an index built with a model the provider has shut down (Google `text-embedding-004` and `embedding-001`) using the provider's current default, and logs a warning. Previously it reused the index, and every search then failed at the provider. Searching such an index without `build()` throws an error that says to call `build()`. Passing the old model explicitly in `embeddings` still keeps the index.
- **Reported version:** `raglite --version`, `/health`, `/info`, index metadata and the web loader's User-Agent reported 1.3.0 in 2.0.0. They now report the package version, and a test keeps the two in sync.

### Added
- **Provider smoke test:** `npm run smoke:providers` makes one embedding call and one answer per provider with the default models, for every provider whose API key is set (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `VOYAGE_API_KEY`, `OLLAMA_BASE_URL`), and exits 1 if any fails. The "Provider Smoke Test" GitHub workflow runs it on demand with repository secrets.

### Internal
- `scripts/` is now type-checked.

## [2.0.0] - 2026-10-10

### Breaking changes
- **Provider SDKs are now optional peer dependencies.** `npm install raglite-toolkit` no longer installs every provider SDK, LanceDB and `@huggingface/transformers`. A fresh install drops from about 617 MB to 38 MB. Install the package for each provider you use (listed in the README's provider tables). When one is missing, RAGLite throws a `ConfigError` naming the `npm install` command to run. This covers `@ai-sdk/*`, `ollama-ai-provider-v2`, `voyage-ai-provider`, `@lancedb/lancedb` and `@huggingface/transformers`.
- **The default `local` embedding provider needs `npm install @huggingface/transformers`.** Previously it came in as an optional dependency. A missing package now throws `ConfigError` rather than `EmbeddingError`.
- **Node.js 20 or later is required.** Node 18 is end-of-life.
- **Default models changed** where the provider has shut the old one down: Anthropic `claude-3-5-sonnet-20241022` → `claude-sonnet-5-5`, Google `gemini-2.0-flash` → `gemini-3.8-flash`, Cohere `command-r-plus` → `command-a-03-2025`, Groq `llama-3.3-70b-versatile` → `openai/gpt-oss-120b`, xAI `grok-2-latest` → `grok-4.7`, and Google embeddings `text-embedding-004` → `gemini-embedding-2`. Pass `model` to keep a different one.

### Added
- **`Document.fromText(id, text, options)`** indexes text you already have, such as a database row, an upload or CMS content, with no file. The `id` names the index and is each chunk's `source`; changed text is re-indexed on the next `build()`.

### Fixed
- **`maxTokens` was ignored:** the LLM `maxTokens` option was passed to the AI SDK under a name it no longer reads, so answers were never capped. It is now sent as `maxOutputTokens`.
- **Anthropic gets no `temperature` unless you set one.** Claude 5 models reject non-default sampling values, so the previous default of 0 would fail with the new default model.

### Internal
- CI runs on Node.js 20, 22 and 24.
- The LanceDB store loads `@lancedb/lancedb` on first use rather than at import time.

### Upgrade notes
- Install the SDKs you use, for example `npm install @ai-sdk/openai @huggingface/transformers`.
- Existing indexes are kept. An index built with Google embeddings and the old default model keeps using `text-embedding-004` for queries, which Google has shut down. Rebuild it with `build({ rebuild: true })` to move to `gemini-embedding-2`.

## [1.3.0] - 2026-10-03

### Added
- **Hybrid search:** `search()`, `ask()` and `askStream()` accept `mode: "vector" | "keyword" | "hybrid"` (default `"vector"`), on `Document` and `DocumentCollection`. Keyword mode uses BM25; hybrid merges vector and keyword results with Reciprocal Rank Fusion, so exact terms such as `ERR_4021`, SKUs or function names are found even when embeddings miss them. Tune it with `hybrid: { rrfK, candidates, weights }`, or set defaults with the new `retrieval` option. Results in these modes carry `scores: { vector?, keyword?, fused }`; vector-mode results are unchanged.
- **Keyword index:** `build()` now also writes a BM25 index (`<storeDir>/<namespace>/keyword.json`) from the chunk texts. It needs no extra embedding calls and works with every vector store.
- **Multilingual keyword tokenizer (`raglite-v1`):** NFKC and lowercase normalisation, code identifiers kept whole (`gpt-4.1`, `snake_case`), and character bigrams for Chinese, Japanese, Korean, Thai, Lao, Khmer and Myanmar. Exported as `tokenize()`. It produces exactly the same terms as the Python SDK.
- **HTTP and CLI:** optional `mode` on `/search` and `/ask`; `--mode` on `raglite search`, `ask` and `serve`. `/info` reports `retrievalMode`.
- **`VectorStore` extension points (optional):** `listChunks()` lets keyword and hybrid search rebuild a missing keyword index from the store, and `keywordSearch(query, topK)` replaces the built-in BM25 index. The memory, LanceDB and Qdrant stores implement `listChunks()`. Existing custom stores need no changes.

### Changed
- **Chunking of text without spaces:** Chinese, Japanese, Thai, Lao, Khmer and Myanmar text is now chunked by character instead of becoming one giant "word". Previously a document in these scripts became a single chunk of any length, which could exceed embedding model limits. `chunkSize` and `overlap` count characters for these scripts and words for everything else.

### Fixed
- **Custom chunk sizes are kept:** `build()` without `chunkSize` or `overlap` (in the call or the constructor) now reuses the existing index's values instead of the defaults. Previously `raglite search` or `raglite ask` after `raglite index --chunk-size N` silently re-embedded the whole index at the default 500 words. Defaults still apply to a new index, and explicit values still trigger a rebuild when they differ.
- **Embedding provider is kept:** with no `embeddings` configured, `build()` now keeps the existing index's provider and model (reusing configured credentials when the provider matches) instead of switching to the local default. The CLI no longer assumes `--embed-provider local` when no `--embed-*` flag is given, so `raglite search` and `raglite ask` reuse an index built with `--embed-provider openai` instead of re-embedding it locally. New indexes still default to local embeddings.
- **CLI output:** progress logs from `raglite index`, `search` and `ask` now go to stderr, so stdout holds only the command's result and can be piped (for example into `jq`).

### Upgrade notes
- The index format version is now 2. Indexes whose source contains no Chinese, Japanese, Thai, Lao, Khmer or Myanmar text are upgraded in place on the next `build()`, without re-embedding (the source file is read once to check). Indexes of sources that do contain such text are rebuilt once.
- Indexes built before 1.3.0 have no keyword index. The memory, LanceDB and Qdrant stores build it from the stored chunks on the first keyword or hybrid search. Pinecone and custom stores without `listChunks()` log a warning and use vector search until you run `build({ rebuild: true })`.
- With Qdrant or Pinecone, the keyword index lives on local disk under `storeDir`. Keep `storeDir` on persistent storage when you use keyword or hybrid search.

## [1.2.2] - 2026-10-02

### Changed
- **Upgrades keep cached indexes:** The build cache is now keyed on an index format version (`formatVersion` in `IndexMetadata`) instead of the package version, so upgrading RAGLite no longer re-embeds every index. Indexes built by 1.2.1 are reused as-is; indexes from older releases are rebuilt once.

### Fixed
- **Docs:** ARCHITECTURE.md now describes the word-based `RecursiveChunker` (500 words, 50 overlap) and the actual `VectorStore` interface. The 1.2.1 changelog now gives the correct status codes when every collection document fails.

### Internal
- Added cross-SDK fixtures (`tests/fixtures/shared/`, generated by `scripts/generate-shared-fixtures.ts`) that pin chunking and hashing output. The Python SDK runs the same fixtures.

## [1.2.1] - 2026-10-02

### Fixed
- **Qdrant shared collections:** When `indexName` is set, documents sharing one Qdrant collection no longer wipe each other. `reset()`, search and index metadata are now scoped to each document's namespace instead of the whole collection. Without `indexName`, behaviour is unchanged.
- **Shared `VectorStore` instances in collections:** `DocumentCollection.build()` now throws a `ConfigError` when a single `VectorStore` instance would be shared by more than one document, instead of each document silently resetting the previous one's index. Pass a vector store provider config instead.
- **Web URL re-indexing:** URL sources are now fingerprinted by their fetched content rather than the URL string, so a changed page is re-indexed on the next `build()`.
- **Query embedder after reload:** Searching an existing index in a new process now embeds queries with the provider and model the index was built with, rather than the constructor default. Configured credentials are reused when the provider matches.
- **Collection search errors:** `DocumentCollection.search()` (and `ask`/`askStream`) now logs per-document search failures instead of silently dropping them, and throws if every document fails.
- **Web loader User-Agent:** Now reports the actual package version.

### Upgrade notes
- As with every release, cached indexes are rebuilt once on first `build()` because the package version is part of the cache key.
- Existing Qdrant indexes created with `indexName` are rebuilt once. Their old untagged points stay in the collection but are no longer returned by search; drop and recreate the collection to remove them.
- Each `build()` on a URL source now fetches the page to check for changes, even when the cached index is reused.
- When every document in a collection fails to search, the REST server now returns an error response (400 for RAGLite errors, 500 otherwise) instead of empty results.

## [1.2.0] - 2026-08-02

### Added
- **Multi-Document & Directory Ingestion (`DocumentCollection`):**
  - Added `DocumentCollection` class to manage semantic indexing, multi-document retrieval, and Q&A across folders, glob patterns, URLs, and mixed files.
  - Parallel semantic search over collection vector stores with score-based top-$K$ merging and ranking.
  - Contextual Q&A synthesis (`ask` and `askStream`) across multi-document collections.
- **Directory Loader (`DirectoryLoader`):**
  - Recursive directory scanner (`recursive: true`) with glob pattern matching (e.g. `./docs/**/*.md`).
  - Auto-detection of supported extensions (`.pdf`, `.txt`, `.md`, `.json`, `.docx`).
  - Detailed error reporting and warning logs for unsupported/empty files.
- **Web Loader (`WebLoader`):**
  - Native loader for fetching HTTP/HTTPS web URLs directly.
  - Automatic HTML cleaning into formatted text/markdown with script and style tag stripping.
  - JSON and plain text content-type parsing.
- **CLI & REST API Support:**
  - Upgraded `raglite index`, `search`, `ask`, and `serve` CLI commands to process directories, glob patterns, and URLs.
  - Updated Hono REST server to support `DocumentCollection` and single `Document` targets.
- **Demo Examples & Tests:**
  - Added `examples/collection-demo.ts` and `npm run example:collection` script.
  - Added unit and integration tests for `DirectoryLoader`, `WebLoader`, and `DocumentCollection`.

## [1.1.0] - 2026-07-19

### Added
- **Pluggable Vector Databases:** Added support for custom local and cloud vector database backends.
  - **Memory Store:** Default in-memory DB that persists locally to JSON.
  - **Qdrant Store:** Wrapper for Qdrant local/cloud using native `fetch` REST requests.
  - **Pinecone Store:** Cloud database support leveraging Pinecone Namespaces using native `fetch` REST requests.
  - **LanceDB Store:** High-performance local file database utilizing `@lancedb/lancedb` under the hood.
- **Custom Adapters:** Allows passing custom classes implementing the `VectorStore` interface directly to `DocumentOptions`.
- **Command Line Interface (CLI):** Added new flags (`--vector-provider`, `--vector-url`, `--vector-key`, `--vector-index`, `--vector-store-dir`) to support pluggable vector DBs on all CLI operations (`index`, `search`, `ask`, `serve`).
- **Automation Scripts:** Added local verification and release scripts under `scripts/`:
  - `scripts/pre-commit.sh` for pre-commit lint, style, and test validation.
  - `scripts/pre-release.sh` for build verification and pre-publish checklist.
- **Practical Examples:** Added demo examples under `examples/` for:
  - `examples/lancedb-example.ts`
  - `examples/qdrant-example.ts`

### Changed
- **Dependencies:** Promoted `@lancedb/lancedb` to a production dependency.
- **Document Class Refactoring:** Swapped `MemoryVectorStore` hardcoding with a pluggable `VectorStore` interface resolved at instantiation time.
- **Documentation:** Updated the README with comprehensive instructions for configuring and using the pluggable vector databases.
