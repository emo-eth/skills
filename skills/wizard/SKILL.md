---
name: wizard
description: Create an executable TypeScript CLI that guides a human through a manual setup, migration, or other one-off procedure, opening URLs, collecting values, writing environment variables, and optionally setting GitHub Actions secrets or variables.
---

# Wizard

A wizard is a small TypeScript command-line program that guides a human through a manual procedure. Use it for third-party setup, a one-off migration, or an A-to-B state change that is tedious to repeat or explain.

The generated program is self-contained. It uses Node's built-in TypeScript stripping, has no package dependencies, and can run directly as `./path/to/wizard.ts` after it is made executable. It requires Node 22.6 or newer.

Use only erasable TypeScript syntax in the generated stages. Node's built-in runner does not transform enums, parameter properties, or other TypeScript features that need JavaScript code generation.

This skill is an adaptation of [Matt Pocock's wizard skill](https://github.com/mattpocock/skills/tree/main/skills/in-progress/wizard), translated from Bash to TypeScript. The source project is MIT licensed.

## Process

### 1. Scope the procedure

Read the repository before asking questions:

- For setup, inspect `.env`, `.env.example`, `.env.*`, `README` files, `docker-compose*`, framework configuration, and `.github/workflows/*`.
- For migrations or state changes, identify the current state, target state, and every irreversible action between them.
- Treat each `secrets.*` and `vars.*` reference in GitHub Actions as a value the wizard may need to produce.

Before writing the wizard, show the user the ordered stages and the values each stage produces. Let the user add, remove, or reorder stages.

For every captured value, record:

1. Where the human gets it.
2. Where it is written: `.env`, a GitHub secret, both, or nowhere.
3. Whether it is secret and must use hidden input.

### 2. Map each stage

Write concrete instructions for each stage. Name the URL, the page path, the action, the place where the value appears, and the variable it fills. If the UI or command is unknown, check the documentation or ask the user. Do not invent steps.

### 3. Author the TypeScript CLI

Copy [assets/template.ts](assets/template.ts) to the target path, for example `scripts/setup.ts`. Keep the shebang. Replace only the example stages below the `STAGES` marker.

Use one `wizard.stage()` call for each focused human task:

```ts
wizard.stage("Provider - API key", 5, async ({ openUrl, step, askSecret, writeEnv }) => {
  openUrl("https://example.com/settings/keys");
  step("Copy the secret key and paste it here.");
  const key = await askSecret("PROVIDER_API_KEY", "Secret key:");
  writeEnv("PROVIDER_API_KEY", key);
});
```

Use the template helpers:

- `openUrl` before asking for a value.
- `askSecret` for secrets and `ask` for public values.
- `writeEnv` for every value that must persist locally.
- `setSecret` only for values that CI really needs.
- `setVar` for non-secret GitHub Actions variables.
- `confirm` before an irreversible action.
- `pause` when the human must complete a browser or local action first.

Keep the library above the `STAGES` marker unchanged. Set an honest `totalMinutes` estimate. The template counts stages automatically.

The default environment file is `.env`. A generated wizard can use another file by passing `envFile` to `createWizard`, or by setting the `ENV_FILE` environment variable.

Wizards are ephemeral by default. Save one in `scripts/` and commit it only when the procedure is a repeatable setup path. If it is repeatable, link it from the relevant README.

### 4. Verify and hand off

- Run `chmod +x <script>`.
- Node's `--check` mode does not parse TypeScript. If the target repository has TypeScript tooling, run its no-emit checker. Otherwise, use a bounded smoke test with synthetic input, a temporary environment file, and browser opening disabled or stubbed. Do not use real credentials.
- Test the direct command with `./<script>` only when the user wants an end-to-end run. It opens browsers and waits for human input, so do not run it end to end by default.
- Trace each captured value statically from input to its `.env` or GitHub destination.
- Check that every `setSecret` name matches the corresponding `secrets.*` reference in CI.
- Tell the user the direct command and the Node version requirement.
