import { installLinearCapture } from "./host.ts";

export default function linearCaptureOmpExtension(host: unknown) {
  installLinearCapture(host);
}
