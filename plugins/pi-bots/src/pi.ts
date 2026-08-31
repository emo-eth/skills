import { installPiBots } from "./host.ts";

export default function piBotsExtension(host: unknown): void {
  installPiBots(host);
}
