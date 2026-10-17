import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf-8"));

const pkg = readJson("package.json");

describe("release metadata", () => {
  it("reports the package.json version to MCP clients", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("keeps server.json in step with package.json", () => {
    const server = readJson("server.json");

    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([
      expect.objectContaining({ identifier: pkg.name, version: pkg.version }),
    ]);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});
