export type QuestionType = "select" | "confirm" | "input" | "editor";

export type QuestionOption = {
  value?: string;
  label: string;
  description?: string;
  preview?: string;
};

export type Question = {
  id: string;
  prompt: string;
  header?: string;
  type?: QuestionType;
  options?: QuestionOption[];
  allowOther?: boolean;
  multi?: boolean;
  recommended?: number | string;
  placeholder?: string;
};

export type Answer = {
  id: string;
  value: string | string[] | boolean;
  label?: string | string[];
  custom?: boolean;
  answeredAt: string;
};

export type QuestionnaireState = {
  version: number;
  fingerprint: string;
  title?: string;
  stateFile: string;
  answers: Record<string, Answer>;
  completed: boolean;
  updatedAt: string;
};

export type HyperQuestionsParams = {
  title?: string;
  questions: Question[];
  stateFile?: string;
  resume?: boolean;
  outputFile?: string;
  allowBacktrack?: boolean;
};

export type FormattedAnswer = {
  id: string;
  header?: string;
  question: string;
  answer: string | string[] | boolean;
  custom?: boolean;
};

export type HyperQuestionsResult = {
  title?: string;
  completed: boolean;
  paused: boolean;
  cancelled: boolean;
  answers: Record<string, Answer>;
  orderedAnswers: FormattedAnswer[];
  stateFile: string;
  outputFile?: string;
};
