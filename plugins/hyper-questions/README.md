# Hyper Questions (`@emo-eth/hyper-questions-plugin`)

Interactive question runner for Pi and OMP with incremental state saving, pause/resume, and backtracking.

## Why

Built-in question tools (`ask`, `ask_user_question`) are all-or-nothing modals:
1. If the session times out, cancels, or the app closes mid-interview, all progress is lost.
2. Users cannot go back (`b` / `Back`) to fix a previous choice.
3. Users cannot pause (`q` / `Ctrl-C`) and resume later.
4. Answers are only kept in the ephemeral transcript tool result.

`hyper-questions` provides the `hyper_ask` native tool for Pi and OMP:
- **Instant auto-save**: Saves every single answer immediately to an atomic JSON state file.
- **Pause & resume**: Exit anytime (`q` or `Esc`) and resume seamlessly from the first unanswered question.
- **Backtrack**: Press `b` or `Left` to review and change previous answers.
- **Multi-modal inputs**: Supports single-choice (`select`), multi-choice checkboxes (`multi: true`), binary confirmation (`confirm`, fast `y`/`n`), and text input/editor (`input`).
- **Receipts**: Outputs structured answers and an optional Markdown or JSON receipt file (`outputFile`).

## Installation

### In Pi
Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:
```json
{
  "extensions": ["@emo-eth/hyper-questions-plugin/pi"]
}
```

### In OMP
Add to your OMP extensions configuration:
```json
{
  "extensions": ["@emo-eth/hyper-questions-plugin/omp"]
}
```

## Tool: `hyper_ask`

### Parameters

```json
{
  "title": "Architecture Setup Questionnaire",
  "stateFile": ".hyper-questions-state.json",
  "resume": true,
  "outputFile": "docs/DECISIONS-SETUP.md",
  "allowBacktrack": true,
  "questions": [
    {
      "id": "framework",
      "prompt": "Which web framework should we use?",
      "header": "Framework",
      "type": "select",
      "options": [
        { "value": "hono", "label": "Hono", "description": "Fast, lightweight web standards framework" },
        { "value": "express", "label": "Express", "description": "Classic Node.js framework" }
      ],
      "recommended": 0
    },
    {
      "id": "auth",
      "prompt": "Enable authentication?",
      "header": "Auth",
      "type": "confirm"
    },
    {
      "id": "project_name",
      "prompt": "Enter application name:",
      "header": "Name",
      "type": "input"
    }
  ]
}
```

## Interactive Controls

- `↑` / `↓` or `k` / `j`: Navigate options
- `Enter`: Select option / submit input
- `Space`: Toggle selection (in `multi: true` mode)
- `y` / `n`: Instant confirm (in `type: "confirm"` mode)
- `b` or `Left`: Go back to previous question
- `q` or `Esc`: Pause and save progress
- `/hyper-questions reset`: Clear active saved state
