import { installWranglrCompanion } from "./companion.ts";

export default function wranglrOmpExtension(omp: unknown): void {
  installWranglrCompanion(omp as Parameters<typeof installWranglrCompanion>[0], "OMP");
}
