export type {
  AskRequest,
  SearchRequest,
  ServeOptions,
  ServerHandle,
} from "./api/index.js";
export {
  AskRequestSchema,
  buildApp,
  createServer,
  SearchRequestSchema,
} from "./api/index.js";
export { BaseChunker, RecursiveChunker } from "./chunking/index.js";
export type { DocumentOptions } from "./config.js";
export { PACKAGE_NAME, PACKAGE_VERSION, PACKAGE_VERSION as VERSION } from "./constants.js";
export type {
  CollectionAskOptions,
  CollectionBuildResult,
} from "./core/collection.js";
export { DocumentCollection } from "./core/collection.js";
export type {
  AskOptions,
  IndexBuildResult,
  IndexOptions,
  SearchOptions,
} from "./core/document.js";
export { Document } from "./core/document.js";
export type { Embedder } from "./embeddings/index.js";

export {
  createEmbedder,
  DEFAULT_EMBEDDING_MODELS,
  LocalEmbedder,
  RemoteEmbedder,
} from "./embeddings/index.js";
export {
  ChunkingError,
  ConfigError,
  EmbeddingError,
  FileNotIndexedError,
  LLMError,
  LoaderError,
  RagLiteError,
  UnsupportedFileTypeError,
  VectorDBError,
} from "./errors.js";
export type {
  AnswerResult,
  GenerateAnswerOptions,
  PromptOptions,
  ResolvedLLM,
} from "./llm/index.js";
export {
  buildSystemPrompt,
  buildUserPrompt,
  createLLM,
  DEFAULT_LLM_MODELS,
  generateAnswer,
  streamAnswer,
} from "./llm/index.js";
export {
  BaseLoader,
  DirectoryLoader,
  DocxLoader,
  getLoader,
  isSupportedFile,
  isUrl,
  JsonLoader,
  MarkdownLoader,
  PdfLoader,
  TxtLoader,
  WebLoader,
} from "./loaders/index.js";
export type { RetrieveOptions } from "./retrieval/index.js";
export { Retriever } from "./retrieval/index.js";
export type {
  ChunkMetadata,
  EmbeddingProviderConfig,
  EmbeddingProviderName,
  IndexMetadata,
  LLMProviderConfig,
  LLMProviderName,
  SearchResult,
  StoredChunk,
  VectorStoreProviderConfig,
  VectorStoreProviderName,
} from "./types.js";
export type { VectorSearchHit, VectorStore } from "./vectordb/index.js";
export {
  createVectorStore,
  LanceDbVectorStore,
  MemoryVectorStore,
  PineconeVectorStore,
  QdrantVectorStore,
} from "./vectordb/index.js";
