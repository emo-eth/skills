# Wall Clock Completion - 2026-08-12

## Glossary

- **Wall Clock**: The plugin that enforces a real elapsed-time limit around agent work.
- **Pi**: The `@earendil-works/pi-coding-agent` host.
- **OMP**: The `@oh-my-pi/pi-coding-agent` host.
- **Expiry policy**: The selected rule that blocks new work or also aborts supported running work at the deadline.
- **Normal OMP profile**: The default local OMP configuration that the user gets without selecting a named test profile.

## Result

Wall Clock v0 is on `origin/main` at commit `a99403bd18a3aa63dc9e3c5da0966ab037d09419`. The stable local main checkout is at the same commit.

OMP 17.2.15 has `@emo-eth/wall-clock-plugin` version 0.1.0 installed and enabled in the normal OMP profile. Its source is the wall-clock plugin checkout, and OMP installed it under the normal OMP plugin directory.

## Verification

- `npm run check` passed.
- `npm test` passed 61 Node tests and 4 Bun tests.
- `npm audit --omit=optional` reported zero vulnerabilities.
- `git diff --check origin/main...HEAD` passed before publication.
- Pi 0.84.1 and OMP 17.2.15 matched the pinned host versions.
- A clean OMP process, with no explicit extension path, reported the `/wallclock` command and started a two-second `block-new` contract.
- A second clean OMP process auto-loaded the installed extension, started a one-millisecond `block-new` contract, rejected a real shell command after expiry, returned exit code 1 with cancellation, and did not run the command body.

## Use

Start OMP normally, then run:

```text
/wallclock start 30m block-new
/wallclock status
/wallclock stop
```

Use `abort-running` only when supported running native work must stop at expiry.
