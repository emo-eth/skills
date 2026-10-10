import { installLinearCapture } from "./host.ts";

export default function linearCapturePiExtension(host: unknown) {
  installLinearCapture(host);
}
