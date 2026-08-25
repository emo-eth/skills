import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const includeExtensions = process.argv.includes("--extensions");
const workerPath = fileURLToPath(new URL("./open-updater.ts", import.meta.url));
const args = ["--experimental-strip-types", workerPath];
if (includeExtensions) {
  args.push("--extensions");
}

const child = spawn(process.execPath, args, {
  detached: true,
  env: process.env,
  stdio: "ignore",
});

const { promise, resolve, reject } = Promise.withResolvers<void>();
child.once("error", reject);
child.once("spawn", resolve);
await promise;
child.unref();
console.log("update window scheduled");
