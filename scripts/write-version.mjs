/**
 * Writes dist/version.json — consumed by the service worker to detect new
 * deployments and prompt users to reload.
 *
 * Version = short git SHA when available (stable per deploy), otherwise a
 * hash of package.json + timestamp (local builds without git metadata).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
mkdirSync(distDir, { recursive: true });

let version;
try {
  version = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // Fallback: hash do package.json (estável por deploy) + timestamp curto
  const pkg = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  const pkgHash = Buffer.from(pkg).toString("base64url").slice(0, 7);
  const ts = Date.now().toString(36).slice(-5);
  version = `pkg:${pkgHash}.${ts}`;
}

const payload = { version, builtAt: new Date().toISOString() };
writeFileSync(
  resolve(distDir, "version.json"),
  JSON.stringify(payload, null, 2) + "\n",
);
console.log(`[write-version] dist/version.json → ${version}`);
