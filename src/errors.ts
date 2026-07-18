export class RagLiteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "RagLiteError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class UnsupportedFileTypeError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileNotIndexedError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FileNotIndexedError";
  }
}

export class LoaderError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoaderError";
  }
}

export class ChunkingError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChunkingError";
  }
}

export class EmbeddingError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}

export class VectorDBError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VectorDBError";
  }
}

export class LLMError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LLMError";
  }
}

export class ConfigError extends RagLiteError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigError";
  }
}
