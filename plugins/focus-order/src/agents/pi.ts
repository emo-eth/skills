import { installFocusOrderCompanion } from "./companion.ts";

export default function focusOrderPiExtension(pi: unknown): void {
  installFocusOrderCompanion(pi as Parameters<typeof installFocusOrderCompanion>[0], "Pi");
}
