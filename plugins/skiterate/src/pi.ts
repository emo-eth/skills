import { installSkiterateExtension, type RuntimeHost } from "./host.ts";

export default function skiteratePiExtension(pi: RuntimeHost): void {
  installSkiterateExtension(pi, "Pi");
}
