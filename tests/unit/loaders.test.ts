import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedFileTypeError } from "../../src/errors.js";
import { getLoader } from "../../src/loaders/index.js";
import { JsonLoader } from "../../src/loaders/json.js";
import { MarkdownLoader } from "../../src/loaders/markdown.js";
import { TxtLoader } from "../../src/loaders/txt.js";
import { makeTempWorkspace, type TempWorkspace } from "../helpers/tmp.js";

let ws: TempWorkspace;
beforeEach(() => {
  ws = makeTempWorkspace();
});
afterEach(() => ws.cleanup());

describe("getLoader", () => {
  it("returns correct loader based on extension", () => {
    expect(getLoader(ws.file("a.txt", ""))).toBeInstanceOf(TxtLoader);
    expect(getLoader(ws.file("a.md", ""))).toBeInstanceOf(MarkdownLoader);
    expect(getLoader(ws.file("a.markdown", ""))).toBeInstanceOf(MarkdownLoader);
    expect(getLoader(ws.file("a.json", "{}"))).toBeInstanceOf(JsonLoader);
  });

  it("is case-insensitive on extension", () => {
    expect(getLoader(ws.file("a.TXT", ""))).toBeInstanceOf(TxtLoader);
    expect(getLoader(ws.file("a.MD", ""))).toBeInstanceOf(MarkdownLoader);
  });

  it("throws UnsupportedFileTypeError for unknown extensions", () => {
    const p = ws.file("a.xyz", "");
    expect(() => getLoader(p)).toThrow(UnsupportedFileTypeError);
  });
});

describe("TxtLoader", () => {
  it("reads UTF-8 file contents and trims", async () => {
    const p = ws.file("a.txt", "  hello world  \n");
    const loader = new TxtLoader(p);
    expect(await loader.load()).toBe("hello world");
  });
});

describe("MarkdownLoader", () => {
  it("reads markdown content", async () => {
    const p = ws.file("a.md", "# Title\n\nBody text.");
    const loader = new MarkdownLoader(p);
    expect(await loader.load()).toContain("# Title");
    expect(await loader.load()).toContain("Body text.");
  });
});

describe("JsonLoader", () => {
  it("flattens nested objects into key.path: value lines", async () => {
    const p = ws.file(
      "a.json",
      JSON.stringify({
        product: { name: "Widget", price: 9.99 },
        available: true,
      }),
    );
    const loader = new JsonLoader(p);
    const text = await loader.load();
    expect(text).toContain("product.name: Widget");
    expect(text).toContain("product.price: 9.99");
    expect(text).toContain("available: true");
  });

  it("handles arrays with indexed paths", async () => {
    const p = ws.file("arr.json", JSON.stringify({ tags: ["alpha", "beta", "gamma"] }));
    const text = await new JsonLoader(p).load();
    expect(text).toContain("tags[0]: alpha");
    expect(text).toContain("tags[1]: beta");
    expect(text).toContain("tags[2]: gamma");
  });

  it("handles empty objects and arrays", async () => {
    const p = ws.file("empty.json", JSON.stringify({ a: {}, b: [] }));
    const text = await new JsonLoader(p).load();
    expect(text).toContain("a: {}");
    expect(text).toContain("b: []");
  });

  it("handles null values", async () => {
    const p = ws.file("null.json", JSON.stringify({ x: null }));
    const text = await new JsonLoader(p).load();
    expect(text).toContain("x: null");
  });

  it("throws LoaderError on invalid JSON", async () => {
    const p = ws.file("bad.json", "{ not json ]");
    await expect(new JsonLoader(p).load()).rejects.toThrow();
  });
});
