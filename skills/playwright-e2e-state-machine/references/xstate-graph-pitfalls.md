# XState v5 + @xstate/graph Pitfalls

Hard-won lessons from implementing state machine E2E tests.

## Pitfall 1: Event-param guards make states unreachable

`@xstate/graph`'s `getShortestPaths()` and `getSimplePaths()` traverse the machine by sending every possible event from every reachable state. But they **cannot enumerate event parameter combinations**.

### The problem

```typescript
// This machine has unreachable states
const machine = setup({
  types: {
    events: {} as
      | { type: "EXECUTE"; requiresApproval: boolean; requiresChainSwitch: boolean }
      | { type: "DONE" },
  },
  guards: {
    needsApproval: ({ event }) => event.requiresApproval,
    needsChainSwitch: ({ event }) => event.requiresChainSwitch,
  },
}).createMachine({
  initial: "idle",
  states: {
    idle: {
      on: {
        EXECUTE: [
          { target: "chainSwitch", guard: "needsChainSwitch" },
          { target: "approval", guard: "needsApproval" },
          { target: "swap" },
        ],
      },
    },
    chainSwitch: { /* ... */ },  // ← UNREACHABLE by xstate/graph
    approval: { /* ... */ },      // ← UNREACHABLE by xstate/graph
    swap: { on: { DONE: "success" } },
    success: { type: "final" },
  },
});
```

`getShortestPaths()` sends `EXECUTE` with no params (or default params), so the guards `needsChainSwitch` and `needsApproval` always return false. Only the fallback transition to `swap` is ever taken.

### The fix: Separate events per variant

```typescript
const machine = setup({
  types: {
    events: {} as
      | { type: "EXECUTE_DIRECT" }
      | { type: "EXECUTE_WITH_APPROVAL" }
      | { type: "EXECUTE_CHAIN_SWITCH" }
      | { type: "DONE" },
  },
}).createMachine({
  initial: "idle",
  states: {
    idle: {
      on: {
        EXECUTE_CHAIN_SWITCH: "chainSwitch",     // Always reaches chainSwitch
        EXECUTE_WITH_APPROVAL: "approval",        // Always reaches approval
        EXECUTE_DIRECT: "swap",                   // Always reaches swap
      },
    },
    chainSwitch: { /* ... */ },  // ✅ Reachable
    approval: { /* ... */ },      // ✅ Reachable
    swap: { on: { DONE: "success" } },
    success: { type: "final" },
  },
});
```

### Context-based guards ARE fine

Guards that check **context** (not event params) work because `@xstate/graph` can enumerate context states through `assign` actions:

```typescript
guards: {
  isWalletConnected: ({ context }) => context.isWalletConnected,  // ✅ Works
},
```

## Pitfall 2: Cycles are invisible to getSimplePaths

`getSimplePaths()` finds all non-cyclic paths. A transition like `error → idle` (RESET) creates a cycle, so it's never included.

### Fix: Test cycles explicitly

```typescript
test("error state has reset transition back to idle", () => {
  const errorState = machine.config.states?.[STATE.error];
  expect(errorState?.on).toHaveProperty("RESET");
});
```

Document expected uncovered events:
```typescript
const expectedUncovered = new Set(["RESET"]);
for (const eventType of EVENT_TYPES) {
  if (expectedUncovered.has(eventType)) continue;
  expect(covered.has(eventType)).toBe(true);
}
```

## Pitfall 3: Path explosion with complex machines

`getSimplePaths()` on a machine with many states can generate hundreds of paths. `getShortestPaths()` generates the minimum set.

### When to use which

| Method | Paths generated | Use for |
|---|---|---|
| `getShortestPaths()` | 1 per reachable state | Auto-generated E2E tests (fast, minimal) |
| `getSimplePaths()` | All non-cyclic paths | Coverage verification (are all events exercised?) |

For E2E tests, prefer `getShortestPaths()` + `allowDuplicatePaths: true`:
```typescript
const model = createTestModel(machine);
const paths = model.getShortestPaths({ allowDuplicatePaths: true });
```

## Pitfall 4: createTestModel state/event maps must be exhaustive

If your `states` or `events` map in `path.test()` is missing an entry, the test silently passes that state/event with no assertion.

### Fix: Add a coverage test

```typescript
test("all states have assertions", () => {
  const statesWithAssertions = new Set(Object.keys(stateAssertionMap));
  for (const stateId of STATE_IDS) {
    expect(statesWithAssertions.has(stateId)).toBe(true);
  }
});
```

## Pitfall 5: Parallel states and xstate/graph

`@xstate/graph` handles parallel states, but the number of paths grows multiplicatively. A machine with 3 parallel regions of 4 states each generates 4^3 = 64 state combinations.

### Recommendation

Model dimensions as **separate machines** (not parallel regions in one machine) unless they have guard dependencies between regions. Test each machine independently. Test cross-dimension interactions as manual scenario tests.

## Pitfall 6: assign actions in guards

`@xstate/graph` doesn't execute `assign` actions during traversal — it only evaluates guards. If a guard depends on context that should have been set by a previous action, it may not work.

### Fix

Make guards self-contained. Don't depend on context set by the same event's actions.
