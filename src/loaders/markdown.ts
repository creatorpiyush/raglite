import { readFile } from "node:fs/promises";
import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

export class MarkdownLoader extends BaseLoader {
  async load(): Promise<string> {
    try {
      const text = await readFile(this.filePath, "utf-8");
      return text.trim();
    } catch (cause) {
      throw new LoaderError(`Failed to load Markdown: ${this.filePath}`, { cause });
    }
  }
}
