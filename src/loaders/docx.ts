import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

export class DocxLoader extends BaseLoader {
  async load(): Promise<string> {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: this.filePath });
      return result.value.trim();
    } catch (cause) {
      throw new LoaderError(`Failed to load DOCX: ${this.filePath}`, { cause });
    }
  }
}
