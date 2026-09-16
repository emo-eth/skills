import { installSessionHistoryTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function sessionHistoryPiExtension(pi: RuntimeHost): void {
  installSessionHistoryTools(pi, { consent: "context" });
}
