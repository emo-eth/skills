import { randomUUID } from "node:crypto";
import type {
  RouterConfig,
  FleetBox,
  ModelContract,
  ModelPlacement,
  PiGrainStats,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  RouterStatus,
} from "./types.ts";

export class RouterError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly errorType: string;

  constructor(statusCode: number, errorCode: string, message: string, errorType = "api_error") {
    super(message);
    this.name = "RouterError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.errorType = errorType;
  }

  toJSON(): { error: { message: string; type: string; code: string } } {
    return {
      error: {
        message: this.message,
        type: this.errorType,
        code: this.errorCode,
      },
    };
  }
}

export class ModelRouter {
  private config: RouterConfig;
  private activeBoxSlots: Map<string, number> = new Map();
  private cacheAffinityMap: Map<string, { boxId: string; timestamp: number }> = new Map();
  private statsRing: PiGrainStats[] = [];
  private totalRequests = 0;
  private completedRequests = 0;

  constructor(config: RouterConfig) {
    this.config = config;
    for (const box of config.boxes) {
      this.activeBoxSlots.set(box.id, 0);
    }
  }

  public updateConfig(newConfig: RouterConfig): void {
    this.config = newConfig;
    for (const box of newConfig.boxes) {
      if (!this.activeBoxSlots.has(box.id)) {
        this.activeBoxSlots.set(box.id, 0);
      }
    }
  }

  public getConfig(): RouterConfig {
    return this.config;
  }

  public getModels(): ModelContract[] {
    return this.config.models;
  }

  public getModel(id: string): ModelContract | undefined {
    return this.config.models.find((m) => m.id === id);
  }

  public getActiveSlots(boxId: string): number {
    return this.activeBoxSlots.get(boxId) ?? 0;
  }

  public getRecentStats(limit = 50, sessionId?: string): PiGrainStats[] {
    let list = this.statsRing;
    if (sessionId) {
      list = list.filter((s) => s.sessionId === sessionId);
    }
    return list.slice(-limit).reverse();
  }

  public getStatus(): RouterStatus {
    const fleetStatus = this.config.boxes.map((box) => {
      const active = this.activeBoxSlots.get(box.id) ?? 0;
      const servedModels = this.config.placements
        .filter((p) => p.boxId === box.id)
        .map((p) => p.modelId);

      return {
        id: box.id,
        name: box.name,
        endpoint: box.endpoint,
        healthy: box.healthy,
        activeSlots: active,
        maxConcurrency: box.maxConcurrency,
        models: servedModels,
      };
    });

    const modelStatus = this.config.models.map((model) => {
      const availablePlacements = this.config.placements
        .filter((p) => p.modelId === model.id)
        .map((p) => p.boxId)
        .filter((boxId) => {
          const box = this.config.boxes.find((b) => b.id === boxId);
          return box && box.healthy;
        });

      return {
        id: model.id,
        contract: model,
        availablePlacements,
      };
    });

    const anyHealthy = this.config.boxes.some((b) => b.healthy);
    const allHealthy = this.config.boxes.every((b) => b.healthy);

    return {
      status: allHealthy ? "healthy" : anyHealthy ? "degraded" : "unhealthy",
      version: "0.1.0",
      fleet: fleetStatus,
      models: modelStatus,
      activeRequests: Array.from(this.activeBoxSlots.values()).reduce((a, b) => a + b, 0),
      totalCompletedRequests: this.completedRequests,
    };
  }

  public selectPlacement(modelId: string, promptPrefixHash?: string): { box: FleetBox; placement: ModelPlacement } {
    const contract = this.getModel(modelId);
    if (!contract) {
      throw new RouterError(
        404,
        "model_not_found",
        `Model '${modelId}' does not exist in the router catalog.`,
        "invalid_request_error",
      );
    }

    const eligiblePlacements = this.config.placements.filter((p) => p.modelId === modelId);
    if (eligiblePlacements.length === 0) {
      throw new RouterError(
        503,
        "model_unavailable",
        `Model '${modelId}' is configured but has no registered fleet placements.`,
        "service_unavailable_error",
      );
    }

    const healthyPlacements: Array<{ box: FleetBox; placement: ModelPlacement }> = [];
    for (const p of eligiblePlacements) {
      const box = this.config.boxes.find((b) => b.id === p.boxId);
      if (box && box.healthy) {
        healthyPlacements.push({ box, placement: p });
      }
    }

    if (healthyPlacements.length === 0) {
      throw new RouterError(
        503,
        "model_unavailable",
        `Model '${modelId}' is recognized but currently unavailable across all fleet placements.`,
        "service_unavailable_error",
      );
    }

    // Check concurrency capacity on healthy candidate boxes
    const available = healthyPlacements.filter(({ box }) => {
      const active = this.activeBoxSlots.get(box.id) ?? 0;
      return active < box.maxConcurrency;
    });

    if (available.length === 0) {
      // Fail fast with 429 capacity error per PRD R4
      throw new RouterError(
        429,
        "capacity_exhausted",
        `All fleet backends serving '${modelId}' are currently at maximum concurrency. Please retry shortly.`,
        "insufficient_quota_error",
      );
    }

    // Cache affinity: if prompt prefix matches a box recently used and that box is available
    if (promptPrefixHash && this.cacheAffinityMap.has(promptPrefixHash)) {
      const cached = this.cacheAffinityMap.get(promptPrefixHash)!;
      // Valid within 15 minutes
      if (Date.now() - cached.timestamp < 15 * 60 * 1000) {
        const affinityMatch = available.find(({ box }) => box.id === cached.boxId);
        if (affinityMatch) {
          return affinityMatch;
        }
      }
    }

    // Sort by load ratio (active / maxConcurrency), then placement priority
    available.sort((a, b) => {
      const activeA = this.activeBoxSlots.get(a.box.id) ?? 0;
      const activeB = this.activeBoxSlots.get(b.box.id) ?? 0;
      const ratioA = activeA / a.box.maxConcurrency;
      const ratioB = activeB / b.box.maxConcurrency;

      if (Math.abs(ratioA - ratioB) > 0.05) {
        return ratioA - ratioB;
      }
      return (a.placement.priority ?? 10) - (b.placement.priority ?? 10);
    });

    return available[0];
  }

  public async forwardChatCompletion(
    request: ChatCompletionRequest,
    options: {
      callerIdentity?: string;
      clientIp?: string;
      sessionId?: string;
      signal?: AbortSignal;
      fetchFn?: typeof fetch;
    } = {},
  ): Promise<Response> {
    const requestId = `chatcmpl-${randomUUID()}`;
    const startTime = Date.now();
    const prefixHash = this.computePrefixHash(request.messages);

    let selected: { box: FleetBox; placement: ModelPlacement };
    try {
      selected = this.selectPlacement(request.model, prefixHash);
    } catch (err) {
      if (err instanceof RouterError) {
        this.recordStats({
          requestId,
          sessionId: options.sessionId,
          modelId: request.model,
          servingBoxId: "none",
          servingEndpoint: "none",
          callerIdentity: options.callerIdentity,
          clientIp: options.clientIp,
          startedAt: new Date(startTime).toISOString(),
          queueWaitMs: 0,
          ttftMs: 0,
          decodeDurationMs: 0,
          totalDurationMs: Date.now() - startTime,
          promptTokens: 0,
          completionTokens: 0,
          tokensPerSecond: 0,
          status: err.errorCode === "capacity_exhausted" ? "capacity_exhausted" : "model_unavailable",
          errorMessage: err.message,
        });
      }
      throw err;
    }

    const { box, placement } = selected;
    const currentActive = this.activeBoxSlots.get(box.id) ?? 0;
    this.activeBoxSlots.set(box.id, currentActive + 1);
    this.totalRequests++;

    const backendUrl = `${box.endpoint.replace(/\/+$/, "")}/chat/completions`;
    const backendModel = placement.backendModelName ?? request.model;
    const forwardBody = JSON.stringify({ ...request, model: backendModel });

    const fetchImpl = options.fetchFn ?? fetch;

    try {
      const backendResponse = await fetchImpl(backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: request.stream ? "text/event-stream" : "application/json",
        },
        body: forwardBody,
        signal: options.signal,
      });

      if (!backendResponse.ok) {
        const errorText = await backendResponse.text();
        this.releaseSlot(box.id);
        this.recordStats({
          requestId,
          sessionId: options.sessionId,
          modelId: request.model,
          servingBoxId: box.id,
          servingEndpoint: box.endpoint,
          callerIdentity: options.callerIdentity,
          clientIp: options.clientIp,
          startedAt: new Date(startTime).toISOString(),
          queueWaitMs: 0,
          ttftMs: 0,
          decodeDurationMs: 0,
          totalDurationMs: Date.now() - startTime,
          promptTokens: 0,
          completionTokens: 0,
          tokensPerSecond: 0,
          status: "backend_error",
          errorMessage: `Backend ${box.id} returned status ${backendResponse.status}: ${errorText}`,
        });

        // Fail-fast error to caller without leaking internal endpoint or machine name
        throw new RouterError(
          backendResponse.status === 429 ? 429 : 502,
          backendResponse.status === 429 ? "capacity_exhausted" : "backend_error",
          backendResponse.status === 429
            ? `Fleet capacity exhausted for model '${request.model}'.`
            : `Fleet inference backend error.`,
          backendResponse.status === 429 ? "insufficient_quota_error" : "api_error",
        );
      }

      // Record cache affinity for next turns
      if (prefixHash) {
        this.cacheAffinityMap.set(prefixHash, { boxId: box.id, timestamp: Date.now() });
      }

      if (!request.stream) {
        // Non-streaming response handling
        const json = (await backendResponse.json()) as ChatCompletionResponse;
        this.releaseSlot(box.id);
        const totalDurationMs = Math.max(1, Date.now() - startTime);
        const promptTokens = json.usage?.prompt_tokens ?? 0;
        const completionTokens = json.usage?.completion_tokens ?? 0;
        const tokensPerSecond = completionTokens > 0 ? (completionTokens / (totalDurationMs / 1000)) : 0;

        this.completedRequests++;
        this.recordStats({
          requestId,
          sessionId: options.sessionId,
          modelId: request.model,
          servingBoxId: box.id,
          servingEndpoint: box.endpoint,
          callerIdentity: options.callerIdentity,
          clientIp: options.clientIp,
          startedAt: new Date(startTime).toISOString(),
          queueWaitMs: 0,
          ttftMs: totalDurationMs,
          decodeDurationMs: 0,
          totalDurationMs,
          promptTokens,
          completionTokens,
          reasoningTokens: 0,
          tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
          cacheHit: false,
          status: "completed",
        });

        // Strip any backend internal fields from response to ensure invisibility (PRD R3)
        const sanitized: ChatCompletionResponse = {
          id: json.id ?? requestId,
          object: "chat.completion",
          created: json.created ?? Math.floor(startTime / 1000),
          model: request.model,
          choices: json.choices,
          usage: json.usage ?? {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          },
        };

        return new Response(JSON.stringify(sanitized), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
          },
        });
      }

      // Streaming response handling
      let firstChunkTime: number | null = null;
      let promptTokens = 0;
      let completionTokens = 0;
      let reasoningTokens = 0;
      let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      if (backendResponse.body) {
        streamReader = backendResponse.body.getReader();
      }

      const router = this;
      const transformStream = new TransformStream({
        async transform(chunk, controller) {
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
          }
          // Parse chunk text to count tokens and sanitize model name if needed
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
              try {
                const parsed = JSON.parse(line.slice(6)) as ChatCompletionChunk;
                if (parsed.choices?.[0]?.delta?.content) {
                  completionTokens += 1;
                }
                if (parsed.choices?.[0]?.delta?.reasoning_content) {
                  reasoningTokens += 1;
                  completionTokens += 1;
                }
                if (parsed.usage) {
                  promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
                  completionTokens = parsed.usage.completion_tokens ?? completionTokens;
                }
              } catch {
                // Ignore parse errors on individual SSE chunks
              }
            }
          }
          controller.enqueue(chunk);
        },
        flush() {
          router.releaseSlot(box.id);
          router.completedRequests++;
          const now = Date.now();
          const ttftMs = firstChunkTime !== null ? firstChunkTime - startTime : now - startTime;
          const decodeDurationMs = firstChunkTime !== null ? now - firstChunkTime : 0;
          const totalDurationMs = Math.max(1, now - startTime);
          const tokensPerSec = completionTokens > 0 && decodeDurationMs > 0
            ? completionTokens / (decodeDurationMs / 1000)
            : 0;

          router.recordStats({
            requestId,
            sessionId: options.sessionId,
            modelId: request.model,
            servingBoxId: box.id,
            servingEndpoint: box.endpoint,
            callerIdentity: options.callerIdentity,
            clientIp: options.clientIp,
            startedAt: new Date(startTime).toISOString(),
            queueWaitMs: 0,
            ttftMs,
            decodeDurationMs,
            totalDurationMs,
            promptTokens,
            completionTokens,
            reasoningTokens,
            tokensPerSecond: Math.round(tokensPerSec * 10) / 10,
            cacheHit: false,
            status: "completed",
          });
        },
      });

      const responseStream = backendResponse.body ? backendResponse.body.pipeThrough(transformStream) : null;

      return new Response(responseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-request-id": requestId,
        },
      });
    } catch (err) {
      this.releaseSlot(box.id);
      if (err instanceof RouterError) {
        throw err;
      }
      this.recordStats({
        requestId,
        sessionId: options.sessionId,
        modelId: request.model,
        servingBoxId: box.id,
        servingEndpoint: box.endpoint,
        callerIdentity: options.callerIdentity,
        clientIp: options.clientIp,
        startedAt: new Date(startTime).toISOString(),
        queueWaitMs: 0,
        ttftMs: 0,
        decodeDurationMs: 0,
        totalDurationMs: Date.now() - startTime,
        promptTokens: 0,
        completionTokens: 0,
        tokensPerSecond: 0,
        status: "backend_error",
        errorMessage: (err as Error).message,
      });

      throw new RouterError(
        502,
        "backend_unreachable",
        `Inference backend for '${request.model}' was unreachable.`,
        "api_error",
      );
    }
  }

  private releaseSlot(boxId: string): void {
    const current = this.activeBoxSlots.get(boxId) ?? 0;
    if (current > 0) {
      this.activeBoxSlots.set(boxId, current - 1);
    }
  }

  private recordStats(stats: PiGrainStats): void {
    const max = this.config.statsMaxEntries ?? 1000;
    this.statsRing.push(stats);
    if (this.statsRing.length > max) {
      this.statsRing.shift();
    }
  }

  private computePrefixHash(messages: ChatCompletionRequest["messages"]): string | undefined {
    if (!messages || messages.length === 0) return undefined;
    const firstMsg = messages[0];
    const content = typeof firstMsg.content === "string" ? firstMsg.content : JSON.stringify(firstMsg.content);
    return content.slice(0, 500);
  }
}
