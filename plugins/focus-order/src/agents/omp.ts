import { installFocusOrderCompanion } from "./companion.ts";

export default function focusOrderOmpExtension(omp: unknown): void {
  installFocusOrderCompanion(omp as Parameters<typeof installFocusOrderCompanion>[0], "OMP");
}
