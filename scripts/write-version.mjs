/**
 * Writes dist/version.json — consumed by the service worker to detect new
 * deployments and prompt users to reload.
 *
 * Version = short git SHA when available (stable per deploy), otherwise a
 * timestamp (e.g. local builds without git metadata).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
mkdirSync(distDir, { recursive: true });

let version;
try {
  version = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  version = `t${Date.now().toString(36)}`;
}

const payload = { version, builtAt: new Date().toISOString() };
writeFileSync(
  resolve(distDir, "version.json"),
  JSON.stringify(payload, null, 2) + "\n",
);
console.log(`[write-version] dist/version.json → ${version}`);
