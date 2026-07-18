import { extname } from "node:path";
import { UnsupportedFileTypeError } from "../errors.js";
import type { BaseLoader } from "./base.js";
import { DocxLoader } from "./docx.js";
import { JsonLoader } from "./json.js";
import { MarkdownLoader } from "./markdown.js";
import { PdfLoader } from "./pdf.js";
import { TxtLoader } from "./txt.js";

type LoaderCtor = new (path: string) => BaseLoader;

const LOADERS: Record<string, LoaderCtor> = {
  ".pdf": PdfLoader,
  ".txt": TxtLoader,
  ".json": JsonLoader,
  ".md": MarkdownLoader,
  ".markdown": MarkdownLoader,
  ".docx": DocxLoader,
};

export function getLoader(filePath: string): BaseLoader {
  const ext = extname(filePath).toLowerCase();
  const Ctor = LOADERS[ext];
  if (!Ctor) {
    throw new UnsupportedFileTypeError(
      `Unsupported file type: "${ext}". Supported: ${Object.keys(LOADERS).join(", ")}`,
    );
  }
  return new Ctor(filePath);
}

export { BaseLoader } from "./base.js";
export { DocxLoader } from "./docx.js";
export { JsonLoader } from "./json.js";
export { MarkdownLoader } from "./markdown.js";
export { PdfLoader } from "./pdf.js";
export { TxtLoader } from "./txt.js";
