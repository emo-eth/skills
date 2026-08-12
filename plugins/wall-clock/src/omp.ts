import { createHostCoordination, installHostExtension } from "./host.ts";
import type { HostCoordination, RuntimeContext } from "./host.ts";
import { isObservedNativeAbort } from "./native-abort.ts";
import type { ToolProposal } from "./types.ts";

const ABORTABLE_OMP_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "glob", "task"]);
const CHILD_COORDINATION_REGISTRY_KEY = Symbol.for("@emo-eth/wall-clock/omp-child-coordination");
const EVENT_BUS_COORDINATION_REGISTRY_KEY = Symbol.for("@emo-eth/wall-clock/omp-event-bus-coordination");

export default function wallClockOmpExtension(omp: any) {
  const eventBus = requireEventBus(omp);
  const childCoordinations = childCoordinationRegistry();
  return installHostExtension(omp, {
    coordination: coordinationFor(eventBus),
    publishChildCoordination: (childSessionIds, coordination) => {
      for (const childSessionId of childSessionIds) childCoordinations.set(childSessionId, coordination);
    },
    resolveChildCoordination: (childSessionId) => {
      const exact = childCoordinations.get(childSessionId);
      if (exact) return exact;
      const owner = [...childCoordinations.entries()].find(([id]) => childSessionId.startsWith(`${id}/`));
      if (!owner) return undefined;
      const [ownerId, coordination] = owner;
      const binding = coordination.childBindings.get(ownerId);
      if (binding) coordination.childBindings.set(childSessionId, binding);
      return coordination;
    },
    releaseChildCoordination: (childSessionIds) => {
      for (const childSessionId of childSessionIds) childCoordinations.delete(childSessionId);
    },
    enforcement: {
      name: "OMP",
      canBlockNew: true,
      canAbortAction: (proposal, context) => canAbort(proposal, context),
      abortRunning: abortContexts,
      abortObserved: isObservedNativeAbort,
    },
  });
}

function coordinationFor(eventBus: object): HostCoordination {
  const existing = Reflect.get(globalThis, EVENT_BUS_COORDINATION_REGISTRY_KEY);
  const registry = existing instanceof WeakMap ? existing as WeakMap<object, HostCoordination> : new WeakMap<object, HostCoordination>();
  if (!(existing instanceof WeakMap)) Reflect.set(globalThis, EVENT_BUS_COORDINATION_REGISTRY_KEY, registry);
  let coordination = registry.get(eventBus);
  if (!coordination) {
    coordination = createHostCoordination();
    registry.set(eventBus, coordination);
  }
  return coordination;
}

function childCoordinationRegistry(): Map<string, HostCoordination> {
  const existing = Reflect.get(globalThis, CHILD_COORDINATION_REGISTRY_KEY);
  if (existing instanceof Map) return existing as Map<string, HostCoordination>;
  const registry = new Map<string, HostCoordination>();
  Reflect.set(globalThis, CHILD_COORDINATION_REGISTRY_KEY, registry);
  return registry;
}

function requireEventBus(omp: any): object {
  if (!omp?.events || typeof omp.events !== "object" || typeof omp.events.on !== "function") {
    throw new Error("Wall-clock requires OMP's native event bus");
  }
  return omp.events;
}

function canAbort(proposal: ToolProposal, context: RuntimeContext | undefined): boolean {
  return ABORTABLE_OMP_TOOLS.has(proposal.toolName.toLowerCase()) && typeof context?.abort === "function";
}

async function abortContexts(request: { targets: Array<{ context: RuntimeContext }> }): Promise<void> {
  const contexts = new Set(request.targets.map((target) => target.context));
  for (const context of contexts) {
    if (typeof context.abort !== "function") throw new Error("OMP lost the abort function for an admitted action");
    await context.abort();
  }
}
