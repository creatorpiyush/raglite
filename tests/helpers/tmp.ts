import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempWorkspace {
  root: string;
  file: (name: string, contents: string) => string;
  cleanup: () => void;
}

export function makeTempWorkspace(prefix = "raglite-"): TempWorkspace {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    file(name, contents) {
      const p = join(root, name);
      writeFileSync(p, contents, "utf-8");
      return p;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
