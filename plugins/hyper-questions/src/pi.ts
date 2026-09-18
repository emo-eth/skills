import { installHyperQuestions, type RuntimeHost } from "./host.ts";

export default function hyperQuestionsPiExtension(pi: RuntimeHost): void {
  installHyperQuestions(pi);
}
