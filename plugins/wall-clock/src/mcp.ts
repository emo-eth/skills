import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WallClockController } from "./controller.ts";
import { parseDeadlineSpec } from "./time.ts";
import { isPersistedState } from "./store.ts";
import type {
  ActionClass,
  AssignmentInput,
  ChildReportInput,
  ExpiryPolicy,
  PersistedState,
  PlanItem,
  StateStore,
  ToolProposal,
} from "./types.ts";

const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonObject;
};

const PLAN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "status"],
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["pending", "active", "complete", "partial", "blocked", "deferred"] },
  },
};

const TOOLS: McpTool[] = [
  {
    name: "wallclock_start",
    description: "Request wall-clock activation. A native host must enforce the selected policy; portable MCP alone rejects activation.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "deadline", "expiryPolicy"],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        deadline: { type: "string", description: "A positive duration or future local time, for example 30m or 5pm." },
        expiryPolicy: { type: "string", enum: ["block-new", "abort-running"] },
        wrapUpMs: { type: "number", exclusiveMinimum: 0 },
        plan: { type: "array", items: PLAN_ITEM_SCHEMA },
      },
    },
  },
  {
    name: "wallclock_status",
    description: "Read the current wall-clock phase, measured elapsed-time context, deadline, policy, and assignment state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId"],
      properties: { sessionId: { type: "string", minLength: 1 }, assignmentId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "wallclock_stop",
    description: "Stop wall-clock control for a session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId"],
      properties: { sessionId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "wallclock_context",
    description: "Return measured current time, elapsed time, current phase, policy, assignment state, and the permitted next action.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId"],
      properties: { sessionId: { type: "string", minLength: 1 }, assignmentId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "wallclock_check",
    description: "Return the current wall-clock decision for a proposed action. The native host gate remains authoritative.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "toolName"],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        toolName: { type: "string", minLength: 1 },
        input: {},
        action: { type: "string", enum: ["read", "write", "destructive", "delegate", "finalize", "other"] },
        assignmentId: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "wallclock_assign",
    description: "Create a bounded assignment under an active wall-clock session.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "parentPlanItemId", "objective", "scope", "acceptance", "budgetMs"],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        id: { type: "string", minLength: 1 },
        parentPlanItemId: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        scope: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        acceptance: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        budgetMs: { type: "number", exclusiveMinimum: 0 },
        wrapUpMs: { type: "number", exclusiveMinimum: 0 },
      },
    },
  },
  {
    name: "wallclock_complete",
    description: "Mark an assignment complete, partial, blocked, or expired.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "assignmentId", "status"],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        assignmentId: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
      },
    },
  },
  {
    name: "wallclock_report",
    description: "Record assignment evidence, shortcuts, skipped validation, risks, unknowns, measured elapsed time, and the next parent action.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "sessionId",
        "assignmentId",
        "status",
        "completed",
        "evidence",
        "partial",
        "skipped",
        "validation",
        "shortcuts",
        "risks",
        "unknowns",
        "recommendedParentAction",
      ],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        assignmentId: { type: "string", minLength: 1 },
        status: { type: "string", enum: ["complete", "partial", "blocked", "expired"] },
        completed: { type: "array", items: { type: "string", minLength: 1 } },
        evidence: { type: "array", items: { type: "string", minLength: 1 } },
        partial: { type: "array", items: { type: "string", minLength: 1 } },
        skipped: { type: "array", items: { type: "string", minLength: 1 } },
        validation: { type: "array", items: { type: "string", minLength: 1 } },
        shortcuts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["choice", "tradeoff"],
            properties: { choice: { type: "string", minLength: 1 }, tradeoff: { type: "string", minLength: 1 } },
          },
        },
        risks: { type: "array", items: { type: "string", minLength: 1 } },
        unknowns: { type: "array", items: { type: "string", minLength: 1 } },
        recommendedParentAction: { type: "string", minLength: 1 },
      },
    },
  },
  {
    name: "wallclock_revise_plan",
    description: "Record a parent plan revision after a bounded result or time contraction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sessionId", "plan", "reason"],
      properties: {
        sessionId: { type: "string", minLength: 1 },
        plan: { type: "array", items: PLAN_ITEM_SCHEMA },
        reason: { type: "string", minLength: 1 },
        sourceAssignmentId: { type: "string", minLength: 1 },
      },
    },
  },
];

export class JsonFileStore implements StateStore {
  private readonly filePath: string;

  constructor(dataDirectory = process.env.PLUGIN_DATA ?? join(process.cwd(), ".wall-clock-data")) {
    this.filePath = join(dataDirectory, "state.json");
  }

  load(sessionId: string): PersistedState | undefined {
    const state = this.readStates()[sessionId];
    return state ? structuredClone(state) : undefined;
  }

  save(state: PersistedState): void {
    const states = this.readStates();
    states[state.sessionId] = structuredClone(state);
    this.writeStates(states);
  }

  delete(sessionId: string): void {
    const states = this.readStates();
    delete states[sessionId];
    this.writeStates(states);
  }

  private writeStates(states: Record<string, PersistedState>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(states, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  private readStates(): Record<string, PersistedState> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const states: Record<string, PersistedState> = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (isPersistedState(value) && value.sessionId === sessionId) states[sessionId] = value;
    }
    return states;
  }
}

export class WallClockMcpServer {
  private initialized = false;
  private protocolVersion: string = SUPPORTED_PROTOCOL_VERSIONS[0];
  private readonly controller: WallClockController;

  constructor(controller: WallClockController) {
    this.controller = controller;
  }

  handle(message: unknown): JsonRpcResponse | undefined {
    if (!message || typeof message !== "object" || Array.isArray(message)) return rpcError(null, -32600, "Invalid JSON-RPC request");
    const request = message as JsonObject;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string") return rpcError(null, -32600, "Invalid JSON-RPC request");

    const hasId = Object.prototype.hasOwnProperty.call(request, "id");
    const id = hasId && isJsonRpcId(request.id) ? request.id : null;
    const method = request.method;

    if (method === "notifications/initialized") {
      this.initialized = true;
      return undefined;
    }
    if (method.startsWith("notifications/")) return undefined;
    if (method === "initialize") return this.initialize(id, request.params);
    if (!hasId) return undefined;
    if (method === "ping") return rpcResult(id, {});
    if (!this.initialized) return rpcError(id, -32002, "Server is not initialized");

    try {
      if (method === "tools/list") return rpcResult(id, { tools: TOOLS });
      if (method === "tools/call") return rpcResult(id, this.callTool(request.params));
      return rpcError(id, -32601, `Unknown method: ${method}`);
    } catch (error) {
      return rpcError(id, -32602, errorMessage(error));
    }
  }

  private initialize(id: JsonRpcId, params: unknown): JsonRpcResponse {
    const paramsObject = params && typeof params === "object" && !Array.isArray(params) ? params as JsonObject : undefined;
    const requested = typeof paramsObject?.protocolVersion === "string" ? paramsObject.protocolVersion : undefined;
    this.protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
    this.initialized = false;
    return rpcResult(id, {
      protocolVersion: this.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "wall-clock", version: SERVER_VERSION },
      instructions: "MCP is a portable control and inspection surface. A native host must enforce wall-clock activation and pre-action decisions.",
    });
  }

  private callTool(params: unknown): JsonObject {
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("tools/call requires an object");
    const paramsObject = params as JsonObject;
    if (typeof paramsObject.name !== "string") throw new Error("tools/call requires a tool name");
    const inputValue = paramsObject.arguments === undefined ? {} : paramsObject.arguments;
    if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) throw new Error("tools/call arguments must be an object");
    const input = inputValue as JsonObject;

    try {
      const value = this.executeTool(paramsObject.name, input);
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  }

  private executeTool(name: string, input: JsonObject): unknown {
    const sessionId = requiredString(input, "sessionId");

    switch (name) {
      case "wallclock_start":
        throw new Error("MCP cannot activate wall-clock: use a native Pi or OMP adapter with host enforcement");
      case "wallclock_status": {
        const assignmentId = optionalString(input, "assignmentId");
        return this.controller.status(sessionId, assignmentId);
      }
      case "wallclock_stop":
        this.controller.stop(sessionId);
        return this.controller.status(sessionId);
      case "wallclock_context": {
        const assignmentId = optionalString(input, "assignmentId");
        return { status: this.controller.status(sessionId, assignmentId), context: this.controller.context(sessionId, assignmentId) };
      }
      case "wallclock_check": {
        const proposal: ToolProposal = {
          toolName: requiredString(input, "toolName"),
          input: input.input,
          action: optionalAction(input, "action"),
          assignmentId: optionalString(input, "assignmentId"),
          enforceable: false,
        };
        return this.controller.decideTool(sessionId, proposal);
      }
      case "wallclock_assign": {
        const assignment: AssignmentInput = {
          id: optionalString(input, "id"),
          parentPlanItemId: requiredString(input, "parentPlanItemId"),
          objective: requiredString(input, "objective"),
          scope: stringArray(input.scope, "scope"),
          acceptance: stringArray(input.acceptance, "acceptance"),
          budgetMs: positiveNumber(input.budgetMs, "budgetMs"),
          wrapUpMs: input.wrapUpMs === undefined ? undefined : positiveNumber(input.wrapUpMs, "wrapUpMs"),
        };
        const result = this.controller.assign(sessionId, assignment);
        return { assignment: result, context: this.controller.context(sessionId, result.id) };
      }
      case "wallclock_complete": {
        const assignmentId = requiredString(input, "assignmentId");
        const status = assignmentStatus(input.status);
        return this.controller.complete(sessionId, assignmentId, status);
      }
      case "wallclock_report": {
        const report: ChildReportInput = {
          assignmentId: requiredString(input, "assignmentId"),
          status: reportStatus(input.status),
          completed: stringArray(input.completed, "completed"),
          evidence: stringArray(input.evidence, "evidence"),
          partial: stringArray(input.partial, "partial"),
          skipped: stringArray(input.skipped, "skipped"),
          validation: stringArray(input.validation, "validation"),
          shortcuts: shortcuts(input.shortcuts),
          risks: stringArray(input.risks, "risks"),
          unknowns: stringArray(input.unknowns, "unknowns"),
          recommendedParentAction: requiredString(input, "recommendedParentAction"),
        };
        return { report: this.controller.report(sessionId, report), status: this.controller.status(sessionId, report.assignmentId) };
      }
      case "wallclock_revise_plan": {
        const plan = planItems(input.plan);
        const revision = this.controller.setPlan(sessionId, plan, requiredString(input, "reason"), optionalString(input, "sourceAssignmentId"));
        return { revision, status: this.controller.status(sessionId) };
      }
      default:
        throw new Error(`Unknown wall-clock tool: ${name}`);
    }
  }
}

export function createDefaultMcpServer(): WallClockMcpServer {
  return new WallClockMcpServer(new WallClockController({ now: () => Date.now() }, new JsonFileStore()));
}

export async function runMcpServer(server = createDefaultMcpServer()): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      writeResponse(rpcError(null, -32700, "Parse error"));
      continue;
    }
    const response = server.handle(message);
    if (response) writeResponse(response);
  }
}

function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  return requiredString(input, key);
}

function positiveNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number`);
  return value;
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${key} must be an array of strings`);
  return value;
}

function planItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) throw new Error("plan must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`plan[${index}] must be an object`);
    const planItem = item as JsonObject;
    const status = planItem.status;
    if (status !== "pending" && status !== "active" && status !== "complete" && status !== "partial" && status !== "blocked" && status !== "deferred") throw new Error(`plan[${index}].status is invalid`);
    return { id: requiredString(planItem, "id"), title: requiredString(planItem, "title"), status };
  });
}

function optionalAction(input: JsonObject, key: string): ActionClass | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === "read" || value === "write" || value === "destructive" || value === "delegate" || value === "finalize" || value === "other") return value;
  throw new Error(`${key} is invalid`);
}

function assignmentStatus(value: unknown): "complete" | "partial" | "blocked" | "expired" {
  if (value === "complete" || value === "partial" || value === "blocked" || value === "expired") return value;
  throw new Error("status is invalid");
}

function reportStatus(value: unknown): ChildReportInput["status"] {
  return assignmentStatus(value);
}

function shortcuts(value: unknown): ChildReportInput["shortcuts"] {
  if (!Array.isArray(value)) throw new Error("shortcuts must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`shortcuts[${index}] must be an object`);
    const shortcut = item as JsonObject;
    return { choice: requiredString(shortcut, "choice"), tradeoff: requiredString(shortcut, "tradeoff") };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  runMcpServer().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
