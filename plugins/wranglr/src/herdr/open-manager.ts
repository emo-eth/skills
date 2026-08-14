import { openPopup } from "./client.ts";

try {
  await openPopup({
    entrypoint: "manager",
    width: "90%",
    height: 24,
  });
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`wranglr manager failed to open: ${message}`);
  process.exitCode = 1;
}
