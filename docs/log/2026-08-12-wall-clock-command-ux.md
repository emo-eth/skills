# Wall Clock Command UX - 2026-08-12

## Glossary

- **Direct-start command**: A native `/wallclock` command that starts enforcement and can submit the work prompt in one invocation.
- **Normal steering**: Host delivery that starts a new turn while idle and steers the active turn while work is already running.
- **Status refresh**: A display update calculated from the current host clock rather than a cached countdown value.

## Result

The native Pi and OMP adapters now accept:

```text
/wallclock [start] <deadline> [block-new|abort-running|abort] [prompt...]
```

`start` and the expiry policy are optional. The default is `abort-running`, and `abort` is its short spelling. The adapter persists the active contract before it submits a trailing prompt. Idle delivery starts a turn; active delivery uses steering.

The native status display now refreshes once per second from the host clock. A late callback recalculates the actual remaining time and phase, so callback delay does not create countdown drift. Refresh stops at completion, expiry, stop, session switch, or shutdown.

OMP 17.2.15 needs a full process restart after a new npm plugin install. `/reload-plugins` does not activate that newly installed plugin in the current process.

## Verification

- `npm run check` passed.
- `npm test` passed 69 Node tests and 6 Bun tests.
- The native OMP mock-backed session received the trailing prompt only after context showed `Expiry policy: abort-running`.
- Pi and OMP native runner tests observed the user-message API call with normal idle delivery.
- The host status test advanced the clock from active time to expiry with delayed callbacks and observed current, non-drifting values.
- The pinned Pi and OMP command-line tests, isolated OMP install test, native task-child tests, and abort-running executor tests passed.
- `npm audit --omit=optional` reported zero vulnerabilities.
