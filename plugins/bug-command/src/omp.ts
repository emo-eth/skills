import { installNoteCommands, type RuntimeHost } from "./host.ts";

export default function noteOmpExtension(host: RuntimeHost): void {
  installNoteCommands(host, "OMP", "omp");
}
