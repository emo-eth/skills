import type { Answer, Question, QuestionOption } from "./types.ts";

export type ThemeLike = {
  fg?: (color: string, text: string) => string;
  bg?: (color: string, text: string) => string;
  bold?: (text: string) => string;
  dim?: (text: string) => string;
};

export type TuiLike = {
  requestRender: () => void;
};

export type QuestionnaireComponentOptions = {
  title?: string;
  questions: Question[];
  initialAnswers?: Record<string, Answer>;
  stateFile: string;
  allowBacktrack?: boolean;
  theme?: ThemeLike;
  tui?: TuiLike;
  onAnswer: (questionId: string, answer: Answer) => void | Promise<void>;
  onDone: (completed: boolean, paused: boolean) => void;
};

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const CYAN = "\u001b[36m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const GRAY = "\u001b[90m";
const INVERT = "\u001b[7m";

function style(text: string, code: string): string {
  return `${code}${text}${RESET}`;
}

export class QuestionnaireComponent {
  private title?: string;
  private questions: Question[];
  private answers: Map<string, Answer>;
  private stateFile: string;
  private allowBacktrack: boolean;
  private theme?: ThemeLike;
  private tui?: TuiLike;
  private onAnswer: (questionId: string, answer: Answer) => void | Promise<void>;
  private onDone: (completed: boolean, paused: boolean) => void;

  private currentIndex = 0;
  private selectedOptionIndex = 0;
  private multiSelections = new Set<string>();
  private textInputMode = false;
  private textBuffer = "";
  private textCursor = 0;

  private cachedLines?: string[];
  private cachedWidth?: number;

  constructor(options: QuestionnaireComponentOptions) {
    this.title = options.title;
    this.questions = options.questions;
    this.answers = new Map(Object.entries(options.initialAnswers ?? {}));
    this.stateFile = options.stateFile;
    this.allowBacktrack = options.allowBacktrack !== false;
    this.theme = options.theme;
    this.tui = options.tui;
    this.onAnswer = options.onAnswer;
    this.onDone = options.onDone;

    // Start at the first unanswered question if resuming
    const firstUnanswered = this.questions.findIndex((q) => !this.answers.has(q.id));
    if (firstUnanswered !== -1) {
      this.currentIndex = firstUnanswered;
    } else {
      this.currentIndex = Math.max(0, this.questions.length - 1);
    }

    this.syncCurrentQuestionState();
  }

  private color(type: "accent" | "success" | "muted" | "warning" | "dim" | "text" | "bold", str: string): string {
    if (this.theme?.fg) {
      if (type === "bold") return this.theme.bold ? this.theme.bold(str) : style(str, BOLD);
      if (type === "dim") return this.theme.dim ? this.theme.dim(str) : style(str, DIM);
      return this.theme.fg(type, str);
    }
    switch (type) {
      case "accent":
        return style(str, CYAN);
      case "success":
        return style(str, GREEN);
      case "warning":
        return style(str, YELLOW);
      case "muted":
      case "dim":
        return style(str, GRAY);
      case "bold":
        return style(str, BOLD);
      default:
        return str;
    }
  }

  private currentQuestion(): Question {
    return this.questions[this.currentIndex];
  }

  private isMulti(): boolean {
    const q = this.currentQuestion();
    return q.type === "select" && q.multi === true;
  }

  private getEffectiveOptions(): Array<QuestionOption & { isOther?: boolean }> {
    const q = this.currentQuestion();
    const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");

    if (type === "confirm") {
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
    }

    const opts: Array<QuestionOption & { isOther?: boolean }> = [...(q.options ?? [])];
    if (q.allowOther !== false && type === "select") {
      opts.push({
        value: "__other__",
        label: "Other (type your own)",
        isOther: true,
      });
    }
    return opts;
  }

  private syncCurrentQuestionState(): void {
    const q = this.currentQuestion();
    const existing = this.answers.get(q.id);
    this.textInputMode = false;
    this.textBuffer = "";
    this.textCursor = 0;
    this.multiSelections.clear();

    const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");

    if (type === "input" || type === "editor") {
      this.textInputMode = true;
      if (existing && typeof existing.value === "string") {
        this.textBuffer = existing.value;
        this.textCursor = existing.value.length;
      }
      return;
    }

    const opts = this.getEffectiveOptions();
    if (existing) {
      if (Array.isArray(existing.value)) {
        for (const v of existing.value) this.multiSelections.add(v);
      } else if (existing.custom) {
        this.selectedOptionIndex = opts.findIndex((o) => o.isOther);
        if (this.selectedOptionIndex === -1) this.selectedOptionIndex = 0;
      } else {
        const idx = opts.findIndex((o) => (o.value ?? o.label) === existing.value);
        this.selectedOptionIndex = idx !== -1 ? idx : 0;
      }
    } else if (q.recommended !== undefined) {
      if (typeof q.recommended === "number" && q.recommended >= 0 && q.recommended < opts.length) {
        this.selectedOptionIndex = q.recommended;
      } else if (typeof q.recommended === "string") {
        const idx = opts.findIndex((o) => (o.value ?? o.label) === q.recommended);
        this.selectedOptionIndex = idx !== -1 ? idx : 0;
      } else {
        this.selectedOptionIndex = 0;
      }
    } else {
      this.selectedOptionIndex = 0;
    }
  }

  private commitCurrentAnswer(answer: Answer): void {
    const q = this.currentQuestion();
    this.answers.set(q.id, answer);
    this.onAnswer(q.id, answer);

    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex++;
      this.syncCurrentQuestionState();
      this.refresh();
    } else {
      // Completed all questions
      this.onDone(true, false);
    }
  }

  private refresh(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
    this.tui?.requestRender();
  }

  public invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
  }

  public handleInput(data: string): void {
    // 1. Text input / editor mode
    if (this.textInputMode) {
      if (data === "\u001b" || data === "\u001b\u001b") {
        // Escape cancels text mode back to options
        const q = this.currentQuestion();
        const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");
        if (type !== "input" && type !== "editor") {
          this.textInputMode = false;
          this.refresh();
          return;
        }
      }

      if (data === "\r" || data === "\n") {
        // Enter submits text input
        const val = this.textBuffer.trim();
        const q = this.currentQuestion();
        const ans: Answer = {
          id: q.id,
          value: val,
          label: val,
          custom: true,
          answeredAt: new Date().toISOString(),
        };
        this.commitCurrentAnswer(ans);
        return;
      }

      if (data === "\u007f" || data === "\b") {
        // Backspace
        if (this.textCursor > 0) {
          this.textBuffer =
            this.textBuffer.slice(0, this.textCursor - 1) +
            this.textBuffer.slice(this.textCursor);
          this.textCursor--;
          this.refresh();
        }
        return;
      }

      if (data === "\u001b[D") {
        // Left arrow
        if (this.textCursor > 0) {
          this.textCursor--;
          this.refresh();
        }
        return;
      }

      if (data === "\u001b[C") {
        // Right arrow
        if (this.textCursor < this.textBuffer.length) {
          this.textCursor++;
          this.refresh();
        }
        return;
      }

      if (data === "\u0003") {
        // Ctrl-C pauses and exits
        this.onDone(this.answers.size === this.questions.length, true);
        return;
      }

      // Printable character
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        this.textBuffer =
          this.textBuffer.slice(0, this.textCursor) +
          data +
          this.textBuffer.slice(this.textCursor);
        this.textCursor++;
        this.refresh();
        return;
      }

      return;
    }

    // 2. Global hotkeys when not typing:
    // Pause / exit
    if (data === "q" || data === "Q" || data === "\u001b" || data === "\u0003") {
      this.onDone(this.answers.size === this.questions.length, true);
      return;
    }

    // Backtrack to previous question
    if (this.allowBacktrack && (data === "b" || data === "B" || data === "\u001b[D" || data === "\u007f")) {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        this.syncCurrentQuestionState();
        this.refresh();
      }
      return;
    }

    const q = this.currentQuestion();
    const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");
    const opts = this.getEffectiveOptions();

    // Confirm shortcuts: y / n
    if (type === "confirm") {
      if (data === "y" || data === "Y") {
        this.commitCurrentAnswer({
          id: q.id,
          value: true,
          label: "Yes",
          answeredAt: new Date().toISOString(),
        });
        return;
      }
      if (data === "n" || data === "N") {
        this.commitCurrentAnswer({
          id: q.id,
          value: false,
          label: "No",
          answeredAt: new Date().toISOString(),
        });
        return;
      }
    }

    // Up / Down navigation
    if (data === "\u001b[A" || data === "k" || data === "K") {
      this.selectedOptionIndex = Math.max(0, this.selectedOptionIndex - 1);
      this.refresh();
      return;
    }
    if (data === "\u001b[B" || data === "j" || data === "J") {
      this.selectedOptionIndex = Math.min(opts.length - 1, this.selectedOptionIndex + 1);
      this.refresh();
      return;
    }

    // Space toggles multi-select
    if (data === " " && this.isMulti()) {
      const opt = opts[this.selectedOptionIndex];
      if (opt.isOther) {
        this.textInputMode = true;
        this.textBuffer = "";
        this.textCursor = 0;
        this.refresh();
        return;
      }
      const val = opt.value ?? opt.label;
      if (this.multiSelections.has(val)) {
        this.multiSelections.delete(val);
      } else {
        this.multiSelections.add(val);
      }
      this.refresh();
      return;
    }

    // Enter confirms selection
    if (data === "\r" || data === "\n") {
      if (this.isMulti()) {
        const selected = Array.from(this.multiSelections);
        if (selected.length === 0) return;
        this.commitCurrentAnswer({
          id: q.id,
          value: selected,
          label: selected,
          answeredAt: new Date().toISOString(),
        });
        return;
      }

      const opt = opts[this.selectedOptionIndex];
      if (opt.isOther) {
        this.textInputMode = true;
        this.textBuffer = "";
        this.textCursor = 0;
        this.refresh();
        return;
      }

      const val = type === "confirm"
        ? opt.value === "yes"
        : (opt.value ?? opt.label);

      this.commitCurrentAnswer({
        id: q.id,
        value: val,
        label: opt.label,
        answeredAt: new Date().toISOString(),
      });
    }
  }

  public render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const q = this.currentQuestion();
    const type = q.type ?? (q.options && q.options.length > 0 ? "select" : "input");
    const total = this.questions.length;
    const answeredCount = this.answers.size;

    lines.push("");

    // 1. Header Bar
    const progressText = `[${this.currentIndex + 1}/${total}]`;
    const headerChip = q.header ? ` • ${this.color("accent", q.header)}` : "";
    const savedChip = ` • ${this.color("dim", `saved: ${answeredCount}/${total}`)}`;
    const mainTitle = this.title ? `${this.color("bold", this.title)} ` : "";
    lines.push(`  ${mainTitle}${this.color("accent", progressText)}${headerChip}${savedChip}`);

    // Progress Bar
    const barWidth = Math.max(10, Math.min(30, width - 20));
    const filled = Math.round(((this.currentIndex + 1) / total) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
    lines.push(`  ${this.color("dim", `[${bar}]`)}`);
    lines.push("");

    // 2. Prompt Card
    lines.push(`  ${this.color("bold", q.prompt)}`);
    lines.push("");

    // 3. Inputs or Options
    if (this.textInputMode) {
      lines.push(`  ${this.color("dim", "Enter your response:")}`);
      const beforeCursor = this.textBuffer.slice(0, this.textCursor);
      const atCursor = this.textBuffer[this.textCursor] ?? " ";
      const afterCursor = this.textBuffer.slice(this.textCursor + 1);
      const cursorRendered = style(atCursor, INVERT);
      lines.push(`  ❯ ${this.color("accent", beforeCursor)}${cursorRendered}${afterCursor}`);
      lines.push("");
      lines.push(`  ${this.color("dim", "[Enter] Submit   [Esc] Cancel")}`);
    } else {
      const opts = this.getEffectiveOptions();
      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i];
        const isSelected = i === this.selectedOptionIndex;
        const val = opt.value ?? opt.label;
        const isChecked = this.isMulti() && this.multiSelections.has(val);

        let marker = "  ";
        if (this.isMulti()) {
          marker = isChecked ? "[x] " : "[ ] ";
        } else if (type === "confirm") {
          marker = "";
        } else {
          marker = isSelected ? "● " : "○ ";
        }

        const cursor = isSelected ? this.color("accent", "❯ ") : "  ";
        const labelText = isSelected ? this.color("bold", opt.label) : opt.label;

        let recBadge = "";
        if (
          !opt.isOther &&
          q.recommended !== undefined &&
          (q.recommended === i || q.recommended === val)
        ) {
          recBadge = ` ${this.color("success", "(Recommended)")}`;
        }

        lines.push(`  ${cursor}${this.color("dim", marker)}${labelText}${recBadge}`);

        if (opt.description) {
          lines.push(`      ${this.color("dim", opt.description)}`);
        }
      }
    }

    lines.push("");

    // 4. Footer & Shortcut controls
    const controls: string[] = [];
    if (!this.textInputMode) {
      controls.push("[↑/↓] Navigate");
      if (this.isMulti()) {
        controls.push("[Space] Toggle");
        controls.push("[Enter] Next");
      } else {
        controls.push("[Enter] Select");
      }
      if (type === "confirm") {
        controls.push("[y/n] Confirm");
      }
      if (this.allowBacktrack && this.currentIndex > 0) {
        controls.push("[b] Back");
      }
      controls.push("[q] Pause & Save");
    }

    lines.push(`  ${this.color("dim", "─".repeat(Math.max(10, Math.min(width - 6, 60))))}`);
    lines.push(`  ${this.color("dim", controls.join("   "))}`);
    lines.push("");

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }
}
