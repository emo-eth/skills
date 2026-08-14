# Plan: move the breathing status line to the widget seam

Status: approved (all review questions resolved), not yet implemented. Today's pulse (commit aa18eb55) ships on
pi only, through the status string channel. This plan makes the pulse work on
**both hosts — OMP included** — and moves the animation to where the hosts
want it.

## Glossary

- **Status string channel**: `ctx.ui.setStatus(key, text)`. The host renders
  the text as one line in its footer. OMP strips all escape codes from this
  channel, so it cannot carry color.
- **Widget**: a small block of UI an extension can mount above or below the
  input editor with `ctx.ui.setWidget(key, content, options)`. Both hosts
  have it.
- **Component**: the TUI building block both hosts use (from the `pi-tui`
  library). It is an object with `render(width): string[]` and an optional
  `dispose()`. A widget can be a factory `(ui, theme) => Component`.
- **requestRender**: the TUI method a component calls to ask the terminal UI
  to repaint. This is how anything animates in pi and OMP.
- **Pulse**: the breathing color animation from `src/pulse.ts` — OKLCH chroma
  swings from near-gray to full saturation at constant lightness, hue taken
  from the host theme.

## What I verified in both codebases

1. **Both hosts accept a component factory as a widget.** pi:
   `setExtensionWidget` (interactive-mode.js:1641) calls
   `content(this.ui, theme)` when given a function. OMP: `setHookWidget`
   (extension-ui-controller.ts:310) does the same. Widget output is rendered
   raw — the `sanitizeStatusText` escape-stripping only applies to the status
   string channel, not to widgets. So color works on OMP through a widget.
2. **Self-animating components are the house pattern.** pi-tui's own Loader
   runs a `setInterval` that calls `ui.requestRender()` (loader.js:54-65).
   OMP's shimmer helpers restyle text on every render using `Date.now()`.
   Our current approach — pushing a new status string 10 times a second from
   the plugin's own timer — fights the framework instead of using it.
3. **`setWidget` is the portable seam.** pi also offers `setFooter` and
   `setHeader`; OMP stubs both as no-ops. Widgets are the only rich-UI seam
   both hosts implement.
4. **`dispose()` is called** when a widget is replaced or cleared on both
   hosts. That is the correct place to stop the animation timer.

## The change

1. **New `src/pulse-widget.ts`.** One factory:
   `createWallClockWidget(getStatus)` returns `(ui, theme) => Component`.
   - `render(width)` reads the live wall-clock status through the
     `getStatus` closure, formats the same line as today, and colors the
     whole line with the existing pulse math. The theme is read inside
     `render`, so theme switches apply on the next frame with no extra
     wiring. The animation phase comes from `Date.now()`, shimmer-style.
   - On creation the component starts a `setInterval(frameMs)` whose only
     job is `ui.requestRender()`, and only while the phase is active or
     wrap-up. `dispose()` clears it.
2. **`host.ts` updateStatus becomes a dispatcher.** If `ctx.ui.setWidget`
   exists: mount the widget while the timer is active, unmount
   (`setWidget(key, undefined)`) when it stops. Otherwise: today's plain
   `setStatus` text path. The 100ms `scheduleStatus` cadence added in
   aa18eb55 is deleted — the widget animates itself — and the status refresh
   loop returns to a plain 1-second tick for fallback hosts only.
3. **Wire both entry points.** `omp.ts` gets the pulse for the first time;
   `pi.ts` keeps it. The colorize try/catch stays (pi's theme getter throws
   before `initTheme` in headless mode).
4. **Excision stays cheap**: delete `pulse.ts` + `pulse-widget.ts`, remove
   the dispatcher branch in `host.ts`, one line in each entry point.

## Tests

- Fake `ctx.ui` with `setWidget` capturing the factory and a counting
  `requestRender`; instantiate the component with a fixed clock; assert two
  render calls at different times give different truecolor prefixes on the
  same text.
- Assert `dispose()` stops the interval (no `requestRender` after).
- Assert unmount on stop/expiry settlement, and that hosts without
  `setWidget` still get the plain status string.
- Native runner tests on both hosts confirm no theme-initialization crash
  and that the widget path mounts.

## Decisions (review pass 2, 2026-08-14, all resolved)

1. **Placement**: `aboveEditor`. (Reviewer: "let's go above.")
2. **Duplicate line on OMP**: drop the plain hook status line while the
   widget is mounted — one timer line, not two. (Reviewer: "yes.")
3. **Countdown granularity**: text changes once per second; only the color
   changes per frame. (Reviewer: "yes.")

## Review answers (2026-08-14 plannotator pass)

1. "need omp too" (lines 3-5): covered. The quoted sentence describes the
   current state, not the proposal. The plan wires OMP in "The change" item 3
   — the widget seam bypasses OMP's escape-stripping, so OMP gets the pulse
   for the first time. Nothing still needs input on this point.

## Cost

Repaints at 10 frames per second only while a wall-clock timer is active.
The hosts already repaint at that rate whenever the loader spinner runs, so
this is inside normal host behavior.
