export type FleetBox = {
  id: string;
  name: string;
  endpoint: string; // e.g. http://spark0:8000/v1
  maxConcurrency: number;
  healthy: boolean;
  lastHealthCheck?: string;
  labels?: Record<string, string>;
};

export type ModelContract = {
  id: string; // e.g. qwen3.8-27b, qwen3.8-next-flash
  weights: string;
  quantization: string; // e.g. fp8, bf16, awq
  contextWindow: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
  capabilities?: Array<"chat" | "tools" | "reasoning" | "vision">;
};

export type ModelPlacement = {
  modelId: string;
  boxId: string;
  backendModelName?: string; // model name on backend if different
  priority?: number; // lower = higher preference
};

export type PiGrainStats = {
  requestId: string;
  sessionId?: string;
  modelId: string;
  servingBoxId: string;
  servingEndpoint: string;
  callerIdentity?: string;
  clientIp?: string;
  startedAt: string;
  queueWaitMs: number;
  ttftMs: number; // time to first token (prefill)
  decodeDurationMs: number; // generation duration
  totalDurationMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  tokensPerSecond: number;
  cacheHit?: boolean;
  status: "completed" | "capacity_exhausted" | "model_unavailable" | "backend_error" | "aborted";
  errorMessage?: string;
};

export type RouterConfig = {
  host: string;
  port: number;
  authToken?: string;
  tailnetOnly?: boolean;
  boxes: FleetBox[];
  models: ModelContract[];
  placements: ModelPlacement[];
  statsMaxEntries?: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  user?: string;
  [key: string]: unknown;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: unknown[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: unknown[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type RouterStatus = {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  fleet: Array<{
    id: string;
    name: string;
    endpoint: string;
    healthy: boolean;
    activeSlots: number;
    maxConcurrency: number;
    models: string[];
  }>;
  models: Array<{
    id: string;
    contract: ModelContract;
    availablePlacements: string[];
  }>;
  activeRequests: number;
  totalCompletedRequests: number;
};
