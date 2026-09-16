export type RuntimeHost = {
  registerTool?: (tool: unknown) => void;
  registerCommand?: (name: string, definition: unknown) => void;
  on?: (event: string, handler: unknown) => void;
};

export type RouterToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

const DEFAULT_ROUTER_URL = process.env.LOCAL_ROUTER_URL ?? "http://127.0.0.1:8080";

export function installRouterTools(host: RuntimeHost, options: { routerUrl?: string } = {}): void {
  const routerUrl = options.routerUrl ?? DEFAULT_ROUTER_URL;

  if (typeof host.registerTool === "function") {
    // 1. router_status tool
    host.registerTool({
      name: "router_status",
      description: "Inspect the local model router fleet status, active concurrency slots, and model catalog.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Optional custom router URL (defaults to LOCAL_ROUTER_URL or http://127.0.0.1:8080)",
          },
        },
      },
      execute: async (args: Record<string, unknown>): Promise<RouterToolResult> => {
        const target = typeof args.url === "string" ? args.url : routerUrl;
        try {
          const resp = await fetch(`${target.replace(/\/+$/, "")}/v1/router/status`);
          if (!resp.ok) {
            return {
              content: [{ type: "text", text: `Error checking router status: HTTP ${resp.status}` }],
            };
          }
          const data = await resp.json();
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to reach router at ${target}: ${(err as Error).message}` }],
          };
        }
      },
    });

    // 2. router_stats tool (Pi-grain operator diagnostics)
    host.registerTool({
      name: "router_stats",
      description: "Inspect Pi-grain inference telemetry and placement provenance across recent requests.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of recent records to retrieve (default 20)",
          },
          sessionId: {
            type: "string",
            description: "Optional session ID to filter telemetry records",
          },
          url: {
            type: "string",
            description: "Optional custom router URL",
          },
        },
      },
      execute: async (args: Record<string, unknown>): Promise<RouterToolResult> => {
        const target = typeof args.url === "string" ? args.url : routerUrl;
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;

        try {
          const url = new URL(`${target.replace(/\/+$/, "")}/v1/router/stats`);
          url.searchParams.set("limit", limit.toString());
          if (sessionId) url.searchParams.set("session_id", sessionId);

          const resp = await fetch(url.toString());
          if (!resp.ok) {
            return {
              content: [{ type: "text", text: `Error fetching router telemetry: HTTP ${resp.status}` }],
            };
          }
          const data = await resp.json();
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Failed to reach router telemetry at ${target}: ${(err as Error).message}` }],
          };
        }
      },
    });
  }

  if (typeof host.registerCommand === "function") {
    host.registerCommand("router", {
      description: "Inspect local model router fleet status and inference performance",
      execute: async (args: string): Promise<string> => {
        const sub = args.trim().split(/\s+/)[0] ?? "status";
        const endpoint = `${routerUrl.replace(/\/+$/, "")}/v1/router/${sub === "stats" ? "stats" : "status"}`;
        try {
          const resp = await fetch(endpoint);
          if (!resp.ok) {
            return `Router returned HTTP ${resp.status}`;
          }
          const data = await resp.json();
          return JSON.stringify(data, null, 2);
        } catch (err) {
          return `Failed to connect to router at ${endpoint}: ${(err as Error).message}`;
        }
      },
    });
  }
}
