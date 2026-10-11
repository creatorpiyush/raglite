import { ConfigError } from "../errors.js";

export type FilterScalar = string | number | boolean;

/** A plain value means equality; an object combines its operators with AND. */
export type FilterCondition =
  | FilterScalar
  | { in?: FilterScalar[]; gt?: number; gte?: number; lt?: number; lte?: number };

/**
 * Metadata filter for search(): every field must match. A chunk without the
 * field never matches.
 *
 * ```ts
 * { source: "policy.pdf", page: { gte: 3, lte: 5 }, tenant: { in: ["acme", "globex"] } }
 * ```
 */
export type MetadataFilter = Record<string, FilterCondition>;

/** Metadata the chunker sets per chunk; filters on these run inside the store. */
export const CHUNK_FIELDS: ReadonlySet<string> = new Set([
  "chunk",
  "totalChunks",
  "page",
  "pageEnd",
  "section",
]);

/** Fields Document sets itself, so custom metadata may not use them. */
export const RESERVED_FIELDS: ReadonlySet<string> = new Set(["source", ...CHUNK_FIELDS]);

const RANGE_OPS = ["gt", "gte", "lt", "lte"] as const;
const OPS: ReadonlySet<string> = new Set(["in", ...RANGE_OPS]);

function isScalar(value: unknown): value is FilterScalar {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Throws ConfigError for anything that is not a valid MetadataFilter. */
export function validateFilter(filter: unknown): MetadataFilter {
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    throw new ConfigError("filter must be an object of field conditions");
  }
  for (const [field, cond] of Object.entries(filter)) {
    if (isScalar(cond)) continue;
    if (typeof cond !== "object" || cond === null || Array.isArray(cond)) {
      throw new ConfigError(
        `filter.${field} must be a string, number, boolean or an object of operators`,
      );
    }
    const ops = Object.keys(cond);
    if (ops.length === 0) throw new ConfigError(`filter.${field} has no operators`);
    for (const op of ops) {
      if (!OPS.has(op)) {
        throw new ConfigError(
          `Unknown filter operator "${op}" in filter.${field}. Use in, gt, gte, lt or lte.`,
        );
      }
      const value = (cond as Record<string, unknown>)[op];
      if (op === "in") {
        if (!Array.isArray(value) || !value.every(isScalar)) {
          throw new ConfigError(
            `filter.${field}.in must be an array of strings, numbers or booleans`,
          );
        }
      } else if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConfigError(`filter.${field}.${op} must be a number`);
      }
    }
  }
  return filter as MetadataFilter;
}

/** Throws ConfigError unless `metadata` is flat, scalar-valued and avoids reserved fields. */
export function validateCustomMetadata(metadata: unknown): Record<string, FilterScalar> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw new ConfigError("metadata must be an object");
  }
  for (const [field, value] of Object.entries(metadata)) {
    if (RESERVED_FIELDS.has(field)) {
      throw new ConfigError(`metadata.${field} is set by RAGLite; use another field name`);
    }
    if (!isScalar(value)) {
      throw new ConfigError(`metadata.${field} must be a string, number or boolean`);
    }
  }
  return metadata as Record<string, FilterScalar>;
}

function conditionMatches(value: unknown, cond: FilterCondition): boolean {
  if (value === undefined || value === null) return false;
  if (isScalar(cond)) return value === cond;
  if (cond.in !== undefined && !cond.in.includes(value as FilterScalar)) return false;
  for (const op of RANGE_OPS) {
    const bound = cond[op];
    if (bound === undefined) continue;
    if (typeof value !== "number") return false;
    if (op === "gt" && !(value > bound)) return false;
    if (op === "gte" && !(value >= bound)) return false;
    if (op === "lt" && !(value < bound)) return false;
    if (op === "lte" && !(value <= bound)) return false;
  }
  return true;
}

export function matchesFilter(metadata: Record<string, unknown>, filter: MetadataFilter): boolean {
  return Object.entries(filter).every(([field, cond]) => conditionMatches(metadata[field], cond));
}

/** Splits a filter into per-chunk fields and per-document fields (source and custom metadata). */
export function splitFilter(filter: MetadataFilter): {
  chunk: MetadataFilter | undefined;
  document: MetadataFilter;
} {
  const chunk: MetadataFilter = {};
  const document: MetadataFilter = {};
  for (const [field, cond] of Object.entries(filter)) {
    (CHUNK_FIELDS.has(field) ? chunk : document)[field] = cond;
  }
  return { chunk: Object.keys(chunk).length > 0 ? chunk : undefined, document };
}

/** Each field's conditions as [operator, value] pairs, with "eq" for a plain value. */
export function filterConditions(
  filter: MetadataFilter,
): Array<[field: string, op: "eq" | "in" | (typeof RANGE_OPS)[number], value: unknown]> {
  const out: Array<[string, "eq" | "in" | (typeof RANGE_OPS)[number], unknown]> = [];
  for (const [field, cond] of Object.entries(filter)) {
    if (isScalar(cond)) {
      out.push([field, "eq", cond]);
      continue;
    }
    if (cond.in !== undefined) out.push([field, "in", cond.in]);
    for (const op of RANGE_OPS) if (cond[op] !== undefined) out.push([field, op, cond[op]]);
  }
  return out;
}
