import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { ModelRouter, RouterError } from "./router.ts";
import type { RouterConfig, ChatCompletionRequest } from "./types.ts";

export function createRouterServer(router: ModelRouter): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    // Standard CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-session-id, x-request-id");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint (always unauthenticated for probes)
    if (url.pathname === "/health" && method === "GET") {
      const status = router.getStatus();
      res.writeHead(status.status === "unhealthy" ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: status.status, version: status.version }));
      return;
    }

    // Authentication check per PRD R7
    const config = router.getConfig();
    if (config.authToken) {
      const authHeader = req.headers.authorization;
      const tailscaleUser = req.headers["tailscale-user-login"];
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

      const isAuthorized = (token && token === config.authToken) || (typeof tailscaleUser === "string" && tailscaleUser.length > 0);
      if (!isAuthorized) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Unauthorized: Missing or invalid authentication token or tailnet identity.",
              type: "authentication_error",
              code: "unauthorized",
            },
          }),
        );
        return;
      }
    }

    try {
      if (url.pathname === "/v1/models" && method === "GET") {
        const models = router.getModels();
        const responseData = {
          object: "list",
          data: models.map((m) => ({
            id: m.id,
            object: "model",
            created: 1725300000,
            owned_by: "local-fleet",
            context_window: m.contextWindow,
            capabilities: m.capabilities,
          })),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseData));
        return;
      }

      if (url.pathname === "/v1/router/status" && method === "GET") {
        const status = router.getStatus();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status, null, 2));
        return;
      }

      if (url.pathname === "/v1/router/stats" && method === "GET") {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const sessionId = url.searchParams.get("session_id") ?? undefined;
        const stats = router.getRecentStats(isNaN(limit) ? 50 : limit, sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: stats }, null, 2));
        return;
      }

      if (url.pathname === "/v1/chat/completions" && method === "POST") {
        const bodyBuffer = await readRequestBody(req);
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(bodyBuffer.toString("utf-8"));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "Malformed JSON body.",
                type: "invalid_request_error",
                code: "bad_request",
              },
            }),
          );
          return;
        }

        if (!parsedBody || typeof parsedBody !== "object" || !("model" in parsedBody) || !("messages" in parsedBody)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "Missing required 'model' or 'messages' in request body.",
                type: "invalid_request_error",
                code: "bad_request",
              },
            }),
          );
          return;
        }

        const chatReq = parsedBody as ChatCompletionRequest;
        const sessionId =
          typeof req.headers["x-session-id"] === "string"
            ? req.headers["x-session-id"]
            : undefined;
        const clientIp = req.socket.remoteAddress;
        const callerIdentity =
          typeof req.headers["tailscale-user-login"] === "string"
            ? req.headers["tailscale-user-login"]
            : undefined;

        const abortController = new AbortController();
        req.on("close", () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });

        const forwardResponse = await router.forwardChatCompletion(chatReq, {
          sessionId,
          clientIp,
          callerIdentity,
          signal: abortController.signal,
        });

        // Copy response status and headers
        const headersRecord: Record<string, string> = {
          "Content-Type": forwardResponse.headers.get("Content-Type") ?? "application/json",
        };
        const reqId = forwardResponse.headers.get("x-request-id");
        if (reqId) headersRecord["x-request-id"] = reqId;

        res.writeHead(forwardResponse.status, headersRecord);

        if (forwardResponse.body) {
          const reader = forwardResponse.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
        return;
      }

      // Route not found
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `Unrecognized route: ${method} ${url.pathname}`,
            type: "invalid_request_error",
            code: "not_found",
          },
        }),
      );
    } catch (err) {
      if (err instanceof RouterError) {
        res.writeHead(err.statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(err.toJSON()));
        return;
      }

      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: (err as Error).message || "Internal server error",
            type: "api_error",
            code: "internal_error",
          },
        }),
      );
    }
  });

  return server;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
  return promise;
}
