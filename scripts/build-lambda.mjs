// Prepares build/lambda/ for the AWS Lambda deployment: the compiled dist/ plus production
// dependencies only. Run `npm run build` first. Terraform zips this directory.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("build/lambda/", root);

if (!existsSync(new URL("dist/lambda.js", root))) {
  console.error("dist/lambda.js is missing; run `npm run build` first");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL("dist/", root), new URL("dist/", out), { recursive: true });
for (const file of ["package.json", "package-lock.json", "LICENSE"]) {
  cpSync(new URL(file, root), new URL(file, out));
}

// All production dependencies are plain JavaScript, so installing on any OS works for Linux arm64.
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: out,
  stdio: "inherit",
  shell: process.platform === "win32",
});

console.log(`Lambda bundle ready in ${out.pathname}`);
