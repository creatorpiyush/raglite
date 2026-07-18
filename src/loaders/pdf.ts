import { readFile } from "node:fs/promises";
import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

export class PdfLoader extends BaseLoader {
  async load(): Promise<string> {
    try {
      const buffer = await readFile(this.filePath);
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      const joined = Array.isArray(text) ? text.join("\n") : text;
      return joined.trim();
    } catch (cause) {
      throw new LoaderError(`Failed to load PDF: ${this.filePath}`, { cause });
    }
  }
}
