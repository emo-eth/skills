import { installNoCodeComments } from "./host.ts";

export default function noCodeCommentsPiExtension(host: unknown) {
  installNoCodeComments(host);
}
