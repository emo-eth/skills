# Wall Clock Plugin Future Work

## Glossary

- **Release gate**: Evidence required before moving code into a distributable package.
- **Host proof**: A test against a real OMP or Pi runtime showing that the host performs the claimed action.
- **Remote cancellation**: A provider-side operation that stops work outside the local runtime.

## Before installation

- Pin supported OMP and Pi versions.
- Run adapter tests against those versions.
- Prove session state restoration across reload, resume, compaction, and fork.
- Prove inactive-session isolation.
- Prove pre-tool blocking with the real host event API.
- Document the native installation command for each host.

## Child control

- Add a supported OMP assignment-to-child identifier mapping.
- Add a Pi SDK child adapter only if the SDK lifecycle can be owned safely.
- Test hard abort against the actual child executor.
- Test parallel sibling tools and already-running actions.
- Decide whether child assignments are model-callable tools, user commands, or both.

## Reporting

- Add durable parent-plan revision entries.
- Add a visible status display without injecting a new message on every timer tick.
- Add report export for parent and child sessions.
- Add a compact report format for expired or blocked work.

## Explicit non-goals until proven

- Do not claim that a prompt makes a child stop.
- Do not claim that a timer cancels arbitrary tools.
- Do not claim that a local deadline cancels a remote action.
- Do not install the experimental package through `npx skills`.
