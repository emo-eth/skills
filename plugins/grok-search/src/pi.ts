import { installGrokTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function grokSearchPiExtension(pi: RuntimeHost): void {
  installGrokTools(pi, { consent: "context" });
}
