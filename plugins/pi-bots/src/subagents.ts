import { randomUUID } from "node:crypto";
import type { BotDefinition, BotRoster } from "./types.ts";

export const DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
export const DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

export interface EventBus {
  on(event: string, handler: (payload: unknown) => void): (() => void) | void;
  emit(event: string, payload: unknown): void;
}

export type DelegationStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "interrupted"
  | "tool_budget_exhausted"
  | "structured_output_failed"
  | "acceptance_failed"
  | "invalid_request"
  | "unavailable_context"
  | "duplicate_node";

export interface DelegationResponse {
  requestId: string;
  ownerRunId?: string;
  nodeId?: string;
  status: DelegationStatus;
  error?: string;
  runId?: string;
  agent?: string;
  model?: string;
  thinking?: string;
  exitCode?: number;
  launchContractDigest?: string;
  result?: { kind: "text"; text: string } | { kind: "structured"; value: unknown };
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    turns: number;
    toolCalls: number;
    durationMs: number;
  };
}

export class SubagentsAdapter {
  private available: string[] = [];
  private readonly events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  activateRoster(roster: BotRoster): void {
    this.available = process.env.PI_SUBAGENT_CHILD === "1"
      ? []
      : roster.bots.filter((bot) => bot.enabled).map((bot) => bot.runtimeName);
  }

  dispose(): void {
    this.available = [];
  }

  availableNames(): string[] {
    return [...this.available];
  }

  async run(input: {
    bot: BotDefinition;
    task: string;
    cwd: string;
    ownerRunId: string;
    nodeId: string;
    signal?: AbortSignal;
  }): Promise<DelegationResponse> {
    if (process.env.PI_SUBAGENT_CHILD === "1") {
      throw new Error("A bot delegates to peers with Pi's native subagent tool, not bots run.");
    }
    if (input.signal?.aborted) throw new Error("Bot delegation was cancelled.");
    const requestId = randomUUID();
    const identity = {
      requestId,
      ownerRunId: input.ownerRunId,
      nodeId: input.nodeId,
    };
    const request = {
      ...identity,
      agent: input.bot.runtimeName,
      task: input.task,
      context: input.bot.context,
      cwd: input.cwd,
      timeoutMs: input.bot.timeoutMs,
      result: { kind: "text" as const },
    };
    const { promise, resolve, reject } = Promise.withResolvers<DelegationResponse>();
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer!: NodeJS.Timeout;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      input.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      this.events.emit(DELEGATION_CANCEL_EVENT, identity);
      finish(() => reject(new Error("Bot delegation was cancelled.")));
    };
    const listener = (payload: unknown) => {
      const response = payload as DelegationResponse;
      if (response.requestId !== requestId) return;
      if (response.ownerRunId !== input.ownerRunId || response.nodeId !== input.nodeId) return;
      finish(() => resolve(response));
    };
    const registered = this.events.on(DELEGATION_RESPONSE_EVENT, listener);
    if (typeof registered === "function") unsubscribe = registered;
    timer = setTimeout(() => {
      this.events.emit(DELEGATION_CANCEL_EVENT, identity);
      finish(() => reject(new Error("pi-subagents did not return a delegation response before the host deadline.")));
    }, input.bot.timeoutMs + 30_000);
    timer.unref?.();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      this.events.emit(DELEGATION_REQUEST_EVENT, request);
    } catch (error) {
      finish(() => reject(error));
    }
    return promise;
  }
}
