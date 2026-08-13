import { installTurnSummary } from "./summary.ts";

export default function turnSummaryPiExtension(host: unknown) {
  return installTurnSummary(host);
}
