import { installHostExtension } from "./host.ts";

export default function wallClockOmpExtension(omp: any): void {
  installHostExtension(omp);
}
