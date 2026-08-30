import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./open-updater.ts", import.meta.url));

const child = spawn(process.execPath, ["--experimental-strip-types", workerPath], {
  detached: true,
  env: process.env,
  stdio: "ignore",
});

const { promise, resolve, reject } = Promise.withResolvers<void>();
child.once("error", reject);
child.once("spawn", resolve);
await promise;
child.unref();
console.log("plugin updater window scheduled");
