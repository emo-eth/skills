import { installNoteCommands, type RuntimeHost } from "./host.ts";

export default function notePiExtension(host: RuntimeHost): void {
  installNoteCommands(host, "Pi", "pi");
}
