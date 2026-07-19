# Changelog

All notable changes to this project will be documented in this file.

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
