import { installYearnExtension, type ExtensionApi } from "./index.ts";

export default function yearnOmpExtension(api: ExtensionApi): void {
  installYearnExtension(api, "omp");
}
