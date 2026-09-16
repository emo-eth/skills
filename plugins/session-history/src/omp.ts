import { installSessionHistoryTools } from "./host.ts";
import type { RuntimeHost } from "./host.ts";

export default function sessionHistoryOmpExtension(omp: RuntimeHost): void {
  installSessionHistoryTools(omp, { consent: "approval" });
}
