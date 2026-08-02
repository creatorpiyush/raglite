import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";
import { getLoader, isSupportedFile } from "./index.js";

export interface DirectoryLoaderOptions {
  glob?: string;
  recursive?: boolean;
  ignoreErrors?: boolean;
}

export interface DirectoryFileResult {
  filePath: string;
  text: string;
}

export interface DirectoryLoadResult {
  loaded: DirectoryFileResult[];
  errors: { filePath: string; error: string }[];
}

/**
 * Loader for recursively scanning directories or glob patterns and loading supported document files.
 */
export class DirectoryLoader extends BaseLoader {
  private readonly options: DirectoryLoaderOptions;

  constructor(dirPath: string, options: DirectoryLoaderOptions = {}) {
    super(dirPath);
    this.options = { recursive: true, ignoreErrors: true, ...options };
  }

  /**
   * Scans directory and returns aggregated text of all supported files.
   */
  async load(): Promise<string> {
    const result = await this.loadFiles();
    return result.loaded
      .map((item) => `--- SOURCE: ${item.filePath} ---\n${item.text}`)
      .join("\n\n");
  }

  /**
   * Scans directory and returns detailed result including individual loaded files and errors.
   */
  async loadFiles(): Promise<DirectoryLoadResult> {
    const rootPath = resolve(this.filePath);
    if (!existsSync(rootPath)) {
      throw new LoaderError(`Directory or path does not exist: ${rootPath}`);
    }

    const filePaths = this.collectFilePaths(rootPath);
    const loaded: DirectoryFileResult[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const file of filePaths) {
      if (!isSupportedFile(file)) {
        const warnMsg = `Skipping unsupported file type: ${file}`;
        console.warn(`[raglite:DirectoryLoader] ${warnMsg}`);
        errors.push({ filePath: file, error: warnMsg });
        continue;
      }

      try {
        const loader = getLoader(file);
        const text = await loader.load();
        if (text && text.trim().length > 0) {
          loaded.push({ filePath: file, text });
        } else {
          const emptyMsg = `Skipping empty file: ${file}`;
          console.warn(`[raglite:DirectoryLoader] ${emptyMsg}`);
          errors.push({ filePath: file, error: emptyMsg });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[raglite:DirectoryLoader] Failed to load ${file}: ${errMsg}`);
        errors.push({ filePath: file, error: errMsg });
      }
    }

    return { loaded, errors };
  }

  private collectFilePaths(targetPath: string): string[] {
    const stat = statSync(targetPath);
    if (!stat.isDirectory()) {
      return [targetPath];
    }

    const files: string[] = [];
    const entries = readdirSync(targetPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = join(targetPath, entry.name);
      if (entry.isDirectory()) {
        if (this.options.recursive) {
          files.push(...this.collectFilePaths(fullPath));
        }
      } else if (entry.isFile()) {
        if (this.matchesGlob(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    return files.sort();
  }

  private matchesGlob(filename: string): boolean {
    if (!this.options.glob) return true;
    const pattern = this.options.glob.replace(/\*/g, ".*");
    const regex = new RegExp(`^${pattern}$`, "i");
    return regex.test(filename);
  }
}
