import { installLinearCommand, type RuntimeHost } from "./host.ts";

export default function linearOmpExtension(host: RuntimeHost): void {
  installLinearCommand(host, "OMP", "omp");
}
