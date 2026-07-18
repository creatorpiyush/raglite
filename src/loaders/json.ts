import { readFile } from "node:fs/promises";
import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

/**
 * Loader for JSON documents.
 *
 * We flatten the JSON into a series of `key.path: value` lines rather
 * than emitting pretty-printed JSON. Pretty-printed JSON pollutes the
 * embedding with syntactic noise (braces, brackets, quotes) that hurts
 * retrieval quality.
 */
export class JsonLoader extends BaseLoader {
  async load(): Promise<string> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw);
      const lines: string[] = [];
      flatten(data, "", lines);
      return lines.join("\n").trim();
    } catch (cause) {
      throw new LoaderError(`Failed to load JSON: ${this.filePath}`, { cause });
    }
  }
}

function flatten(value: unknown, path: string, lines: string[]): void {
  if (value === null || value === undefined) {
    lines.push(`${path}: null`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${path}: []`);
      return;
    }
    value.forEach((item, index) => {
      flatten(item, `${path}[${index}]`, lines);
    });
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      lines.push(`${path}: {}`);
      return;
    }
    for (const [key, child] of entries) {
      const nextPath = path ? `${path}.${key}` : key;
      flatten(child, nextPath, lines);
    }
    return;
  }
  lines.push(`${path}: ${String(value)}`);
}
