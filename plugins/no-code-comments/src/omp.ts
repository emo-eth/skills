import { installNoCodeComments } from "./host.ts";

export default function noCodeCommentsOmpExtension(host: unknown) {
  installNoCodeComments(host);
}
