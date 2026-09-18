import { installTenetExtension, type ExtensionApi } from "./index.ts";

export default function tenetOmpExtension(api: ExtensionApi): void {
  installTenetExtension(api, "omp");
}
