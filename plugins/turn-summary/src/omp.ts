import { installTurnSummary } from "./summary.ts";

export default function turnSummaryOmpExtension(host: unknown) {
  return installTurnSummary(host);
}
