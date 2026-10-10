import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../src/constants.js";

describe("PACKAGE_VERSION", () => {
  it("matches package.json", () => {
    // It is reported by `raglite --version`, /health and the web loader's User-Agent.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });
});
