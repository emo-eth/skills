import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installModelInvocableSkills } from "./host.ts";

export default function modelInvocableSkillsPiExtension(pi: ExtensionAPI) {
  installModelInvocableSkills(pi);
}
