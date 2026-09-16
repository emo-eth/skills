import { installRouterTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function localModelRouterOmpExtension(omp: RuntimeHost): void {
  installRouterTools(omp);
}
