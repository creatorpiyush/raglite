import { extname } from "node:path";
import { UnsupportedFileTypeError } from "../errors.js";
import type { BaseLoader } from "./base.js";
import { DocxLoader } from "./docx.js";
import { JsonLoader } from "./json.js";
import { MarkdownLoader } from "./markdown.js";
import { PdfLoader } from "./pdf.js";
import { TxtLoader } from "./txt.js";
import { WebLoader } from "./web.js";

type LoaderCtor = new (path: string) => BaseLoader;

const LOADERS: Record<string, LoaderCtor> = {
  ".pdf": PdfLoader,
  ".txt": TxtLoader,
  ".json": JsonLoader,
  ".md": MarkdownLoader,
  ".markdown": MarkdownLoader,
  ".docx": DocxLoader,
};

export function isUrl(target: string): boolean {
  return target.startsWith("http://") || target.startsWith("https://");
}

export function isSupportedFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext in LOADERS;
}

export function getLoader(target: string): BaseLoader {
  if (isUrl(target)) {
    return new WebLoader(target);
  }
  const ext = extname(target).toLowerCase();
  const Ctor = LOADERS[ext];
  if (!Ctor) {
    throw new UnsupportedFileTypeError(
      `Unsupported file type: "${ext}". Supported: ${Object.keys(LOADERS).join(", ")}`,
    );
  }
  return new Ctor(target);
}

export { BaseLoader } from "./base.js";
export { DirectoryLoader } from "./directory.js";
export { DocxLoader } from "./docx.js";
export { JsonLoader } from "./json.js";
export { MarkdownLoader } from "./markdown.js";
export { PdfLoader } from "./pdf.js";
export { TxtLoader } from "./txt.js";
export { WebLoader } from "./web.js";
