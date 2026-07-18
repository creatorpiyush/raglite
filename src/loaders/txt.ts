import { readFile } from "node:fs/promises";
import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

export class TxtLoader extends BaseLoader {
  async load(): Promise<string> {
    try {
      const text = await readFile(this.filePath, "utf-8");
      return text.trim();
    } catch (cause) {
      try {
        const buffer = await readFile(this.filePath);
        return buffer.toString("latin1").trim();
      } catch {
        throw new LoaderError(`Failed to load TXT: ${this.filePath}`, { cause });
      }
    }
  }
}
