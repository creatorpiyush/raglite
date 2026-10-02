export const PACKAGE_NAME = "raglite";
export const PACKAGE_VERSION = "1.2.2";

/**
 * Version of the on-disk/in-store index layout (chunking, ids, payloads).
 * The build cache is keyed on this instead of PACKAGE_VERSION so upgrading
 * the package does not re-embed every index. Bump it only when a change
 * makes existing indexes incompatible.
 */
export const INDEX_FORMAT_VERSION = 1;

/** Releases that wrote format-1 indexes before `formatVersion` was recorded. */
export const LEGACY_FORMAT_1_VERSIONS: ReadonlySet<string> = new Set(["1.2.1"]);

export const SUPPORTED_EXTENSIONS = new Set([".pdf", ".txt", ".json", ".md", ".markdown", ".docx"]);

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_CHUNK_OVERLAP = 50;

export const DEFAULT_TOP_K = 5;
export const DEFAULT_SCORE_THRESHOLD = 0;

export const DEFAULT_TEMPERATURE = 0;

export const DEFAULT_STORE_DIRNAME = ".raglite";
export const DEFAULT_COLLECTION_NAME = "default";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8085;
