import { installTurnReceipt } from "./receipt.ts";

export default function turnReceiptOmpExtension(host: unknown) {
  return installTurnReceipt(host);
}
