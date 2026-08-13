import { installSkiterateExtension, type RuntimeHost } from "./host.ts";

export default function skiterateOmpExtension(omp: RuntimeHost): void {
  installSkiterateExtension(omp, "OMP");
}
