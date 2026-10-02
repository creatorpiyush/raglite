# Changelog

All notable changes to this project will be documented in this file.

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
- When every document in a collection fails to search, the REST server now returns a 500 error instead of empty results.

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
