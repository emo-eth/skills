import { installGrokTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function grokSearchOmpExtension(omp: RuntimeHost): void {
  installGrokTools(omp);
}
