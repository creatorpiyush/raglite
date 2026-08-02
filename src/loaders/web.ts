import { LoaderError } from "../errors.js";
import { BaseLoader } from "./base.js";

/**
 * Loader for fetching and extracting plain text / markdown content from HTTP/HTTPS web URLs.
 */
export class WebLoader extends BaseLoader {
  constructor(private readonly url: string) {
    super(url);
  }

  async load(): Promise<string> {
    try {
      const response = await fetch(this.url, {
        headers: {
          "User-Agent": "RAGLite/1.1.0 (Mozilla/5.0 compatible)",
          Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        throw new LoaderError(
          `HTTP error ${response.status} ${response.statusText} fetching ${this.url}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawText = await response.text();

      if (contentType.includes("application/json")) {
        try {
          return JSON.stringify(JSON.parse(rawText), null, 2);
        } catch {
          return rawText;
        }
      }

      if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
        return rawText;
      }

      return this.extractTextFromHtml(rawText);
    } catch (err: unknown) {
      if (err instanceof LoaderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LoaderError(`Failed to load web URL "${this.url}": ${message}`);
    }
  }

  private extractTextFromHtml(html: string): string {
    let clean = html
      .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
      .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
      .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "")
      .replace(/<head\b[^<]*>([\s\S]*?)<\/head>/gi, "");

    clean = clean.replace(/<(h[1-6])\b[^>]*>(.*?)<\/\1>/gi, "\n\n# $2\n\n");
    clean = clean.replace(/<p\b[^>]*>(.*?)<\/p>/gi, "\n\n$1\n\n");
    clean = clean.replace(/<br\s*\/?>/gi, "\n");
    clean = clean.replace(/<li\b[^>]*>(.*?)<\/li>/gi, "\n* $1");
    clean = clean.replace(/<[^>]+>/g, "");

    clean = clean
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    return clean
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }
}
