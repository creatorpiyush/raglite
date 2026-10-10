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

/**
 * Catch handler for a dynamic import of an optional peer dependency: turns
 * "module not found" into a ConfigError that says what to install.
 */
export function missingPackage(pkg: string, purpose: string): (err: unknown) => never {
  return (err) => {
    const code = (err as { code?: string } | null)?.code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new ConfigError(
        `${purpose} requires the '${pkg}' package. Install it with: npm install ${pkg}`,
        {
          cause: err,
        },
      );
    }
    throw err;
  };
}
