import { installTenetExtension, type ExtensionApi } from "./index.ts";

export default function tenetPiExtension(api: ExtensionApi): void {
  installTenetExtension(api, "pi");
}
