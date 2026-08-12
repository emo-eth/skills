import { createHostCoordination, installHostExtension } from "./host.ts";
import type { HostCoordination, RuntimeContext } from "./host.ts";
import { isObservedNativeAbort } from "./native-abort.ts";
import type { ToolProposal } from "./types.ts";

const ABORTABLE_OMP_TOOLS = new Set(["bash", "read", "write", "edit", "grep", "glob", "task"]);
const COORDINATION_REGISTRY_KEY = Symbol.for("@emo-eth/wall-clock/omp-coordination");

export default function wallClockOmpExtension(omp: any) {
  const eventBus = requireEventBus(omp);
  const coordinationByEventBus = coordinationRegistry();
  let coordination = coordinationByEventBus.get(eventBus);
  if (!coordination) {
    coordination = createHostCoordination();
    coordinationByEventBus.set(eventBus, coordination);
  }
  return installHostExtension(omp, {
    coordination,
    enforcement: {
      name: "OMP",
      canBlockNew: true,
      canAbortAction: (proposal, context) => canAbort(proposal, context),
      abortRunning: abortContexts,
      abortObserved: isObservedNativeAbort,
    },
  });
}

function coordinationRegistry(): WeakMap<object, HostCoordination> {
  const existing = Reflect.get(globalThis, COORDINATION_REGISTRY_KEY);
  if (existing instanceof WeakMap) return existing as WeakMap<object, HostCoordination>;
  const registry = new WeakMap<object, HostCoordination>();
  Reflect.set(globalThis, COORDINATION_REGISTRY_KEY, registry);
  return registry;
}

function requireEventBus(omp: any): object {
  if (!omp?.events || typeof omp.events !== "object" || typeof omp.events.on !== "function") {
    throw new Error("Wall-clock requires OMP's native shared event bus");
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
