import { installWranglrCompanion } from "./companion.ts";

export default function wranglrPiExtension(pi: unknown): void {
  installWranglrCompanion(pi as Parameters<typeof installWranglrCompanion>[0], "Pi");
}
