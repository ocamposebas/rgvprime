import { spawnSync } from "node:child_process";

const candidates = [
  process.env.PHP_BINARY,
  "php",
  "C:\\xampp\\php\\php.exe",
  "C:\\laragon\\bin\\php\\php.exe",
].filter(Boolean);

let phpResult = null;
for (const executable of candidates) {
  const result = spawnSync(executable, ["scripts/verify-storewide-promotion.php"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  if (result.error?.code === "ENOENT") continue;
  phpResult = result;
  break;
}

if (!phpResult) {
  throw new Error("A PHP executable is required for the promotion pricing verification.");
}

if (phpResult.stdout) process.stdout.write(phpResult.stdout);
if (phpResult.stderr) process.stderr.write(phpResult.stderr);
if (phpResult.status !== 0) process.exit(phpResult.status ?? 1);

await import("./verify-storewide-promotion-plugin.mjs");
