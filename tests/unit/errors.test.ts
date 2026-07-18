import { describe, expect, it } from "vitest";
import {
  ChunkingError,
  ConfigError,
  EmbeddingError,
  FileNotIndexedError,
  LLMError,
  LoaderError,
  RagLiteError,
  UnsupportedFileTypeError,
  VectorDBError,
} from "../../src/errors.js";

describe("error hierarchy", () => {
  it("all custom errors inherit RagLiteError which inherits Error", () => {
    const errors: RagLiteError[] = [
      new RagLiteError("x"),
      new UnsupportedFileTypeError("x"),
      new FileNotIndexedError("x"),
      new LoaderError("x"),
      new ChunkingError("x"),
      new EmbeddingError("x"),
      new VectorDBError("x"),
      new LLMError("x"),
      new ConfigError("x"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(RagLiteError);
      expect(e.message).toBe("x");
    }
  });

  it("preserves .name correctly per subclass", () => {
    expect(new RagLiteError("x").name).toBe("RagLiteError");
    expect(new LoaderError("x").name).toBe("LoaderError");
    expect(new LLMError("x").name).toBe("LLMError");
    expect(new FileNotIndexedError("x").name).toBe("FileNotIndexedError");
  });

  it("propagates cause when provided", () => {
    const cause = new Error("root");
    const err = new LoaderError("failed", { cause });
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });
});
