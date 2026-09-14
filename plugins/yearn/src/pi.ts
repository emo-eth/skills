import { installYearnExtension, type ExtensionApi } from "./index.ts";

export default function yearnPiExtension(api: ExtensionApi): void {
  installYearnExtension(api, "pi");
}
