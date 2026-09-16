import { installRouterTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function localModelRouterPiExtension(pi: RuntimeHost): void {
  installRouterTools(pi);
}
