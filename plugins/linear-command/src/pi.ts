import { installLinearCommand, type RuntimeHost } from "./host.ts";

export default function linearPiExtension(host: RuntimeHost): void {
  installLinearCommand(host, "Pi", "pi");
}
