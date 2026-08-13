import { installTurnReceipt } from "./receipt.ts";

export default function turnReceiptPiExtension(host: unknown) {
  return installTurnReceipt(host);
}
