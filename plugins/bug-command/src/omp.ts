import { installBugExtension, type RuntimeHost } from "./host.ts";

export default function bugOmpExtension(host: RuntimeHost): void {
  installBugExtension(host, "OMP", "omp");
}
