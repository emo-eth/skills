import { installBugExtension, type RuntimeHost } from "./host.ts";

export default function bugPiExtension(host: RuntimeHost): void {
  installBugExtension(host, "Pi", "pi");
}
