// Copies the version in package.json (set by `changeset version`) into the files that repeat it:
// src/version.ts (reported to MCP clients), server.json (MCP Registry) and package-lock.json.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf-8");
const write = (path, text) => writeFileSync(new URL(path, root), text);
const writeJson = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);

const { version } = JSON.parse(read("package.json"));

write(
  "src/version.ts",
  read("src/version.ts").replace(/VERSION = "[^"]*"/, `VERSION = "${version}"`),
);

const server = JSON.parse(read("server.json"));
server.version = version;
for (const pkg of server.packages) pkg.version = version;
writeJson("server.json", server);

const lock = JSON.parse(read("package-lock.json"));
lock.version = version;
lock.packages[""].version = version;
writeJson("package-lock.json", lock);

console.log(`Synced version ${version}`);
