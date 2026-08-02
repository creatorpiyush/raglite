import { describe, expect, it, vi } from "vitest";
import { WebLoader } from "../../src/loaders/web.js";

describe("WebLoader", () => {
  it("fetches HTML and extracts text content", async () => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Main Heading</h1>
          <p>This is a test paragraph with <a href="#">a link</a>.</p>
          <script>console.log("ignore script");</script>
          <style>body { color: red; }</style>
        </body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () => Promise.resolve(htmlContent),
      }),
    );

    const loader = new WebLoader("https://example.com/test");
    const text = await loader.load();

    expect(text).toContain("# Main Heading");
    expect(text).toContain("This is a test paragraph with a link.");
    expect(text).not.toContain("ignore script");
    expect(text).not.toContain("color: red");

    vi.unstubAllGlobals();
  });

  it("handles plain text responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/plain"]]),
        text: () => Promise.resolve("Plain text content from server"),
      }),
    );

    const loader = new WebLoader("https://example.com/raw.txt");
    const text = await loader.load();

    expect(text).toBe("Plain text content from server");

    vi.unstubAllGlobals();
  });
});
