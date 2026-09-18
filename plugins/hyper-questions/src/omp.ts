import { installHyperQuestions, type RuntimeHost } from "./host.ts";

export default function hyperQuestionsOmpExtension(omp: RuntimeHost): void {
  installHyperQuestions(omp);
}
